import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LaunchPlan } from "../src/agents/types";
import { CliError } from "../src/errors";
import { buildChildEnv, findExecutable, runPlan } from "../src/util/spawn";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "open-coders-spawn-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fakeAgent(directory: string, name: string, body: string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}

describe("findExecutable", () => {
  test("finds an executable on PATH", async () => {
    const directory = await tempDir();
    const path = await fakeAgent(directory, "agent", "exit 0");
    expect(findExecutable("agent", { PATH: directory })).toBe(path);
  });

  test("prefers the first match", async () => {
    const first = await tempDir();
    const second = await tempDir();
    await fakeAgent(first, "agent", "exit 0");
    await fakeAgent(second, "agent", "exit 0");
    expect(findExecutable("agent", { PATH: `${first}:${second}` })).toBe(join(first, "agent"));
  });

  test("returns null for a missing command or empty PATH", async () => {
    expect(findExecutable("definitely-not-here", { PATH: tmpdir() })).toBeNull();
    expect(findExecutable("agent", {})).toBeNull();
  });

  test("accepts an absolute path", async () => {
    const directory = await tempDir();
    const path = await fakeAgent(directory, "agent", "exit 0");
    expect(findExecutable(path, {})).toBe(path);
  });
});

describe("buildChildEnv", () => {
  test("applies unset and overrides on top of the parent env", () => {
    const plan: LaunchPlan = {
      command: "x",
      args: [],
      env: { ADDED: "1", OVERRIDE: "new" },
      unset: ["REMOVED"],
    };
    const env = buildChildEnv(plan, {
      KEPT: "yes",
      REMOVED: "no",
      OVERRIDE: "old",
      EMPTY: undefined,
    });
    expect(env).toEqual({ KEPT: "yes", ADDED: "1", OVERRIDE: "new" });
  });
});

describe("runPlan", () => {
  test("runs the agent with the built env and propagates its exit code", async () => {
    const directory = await tempDir();
    const capture = join(directory, "capture.txt");
    await fakeAgent(directory, "claude", `env | sort > "${capture}"\nexit 7`);
    const plan: LaunchPlan = {
      command: "claude",
      args: [],
      env: { FOO: "bar" },
      unset: ["PARENT_ONLY"],
    };

    const code = await runPlan(plan, {
      env: { PATH: `${directory}:${process.env.PATH ?? ""}`, PARENT_ONLY: "x" },
    });

    expect(code).toBe(7);
    const captured = await readFile(capture, "utf8");
    expect(captured).toContain("FOO=bar");
    expect(captured).not.toContain("PARENT_ONLY=");
  });

  test("propagates arguments", async () => {
    const directory = await tempDir();
    const capture = join(directory, "args.txt");
    await fakeAgent(directory, "claude", `printf '%s\\n' "$@" > "${capture}"\nexit 0`);
    const plan: LaunchPlan = {
      command: "claude",
      args: ["--model", "model-1", "-p", "hello world"],
      env: {},
      unset: [],
    };

    const code = await runPlan(plan, { env: { PATH: `${directory}:${process.env.PATH ?? ""}` } });

    expect(code).toBe(0);
    expect(await readFile(capture, "utf8")).toBe("--model\nmodel-1\n-p\nhello world\n");
  });

  test("exits 127 when the binary is missing", async () => {
    const plan: LaunchPlan = { command: "definitely-not-here", args: [], env: {}, unset: [] };
    await expect(runPlan(plan, { env: { PATH: "/nonexistent" } })).rejects.toBeInstanceOf(CliError);
    await expect(runPlan(plan, { env: { PATH: "/nonexistent" } })).rejects.toMatchObject({
      exitCode: 127,
    });
  });
});

import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "../src/cli";
import { loadConfig, saveConfig } from "../src/config/store";
import type { Output } from "../src/context";
import { makeConfig, makeProvider } from "./helpers";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function tempPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "open-coders-cli-"));
  directories.push(directory);
  return join(directory, "open-coders", "config.json");
}

function capture(): Output & { value: string } {
  const chunks: string[] = [];
  return {
    write(text) {
      chunks.push(text);
    },
    get value() {
      return chunks.join("");
    },
  };
}

interface RunOptions {
  env?: Record<string, string | undefined>;
  isTTY?: boolean;
  fetchImpl?: typeof fetch;
}

async function run(configPath: string, argv: string[], options: RunOptions = {}) {
  const stdout = capture();
  const stderr = capture();
  const code = await main(argv, {
    env: options.env ?? {},
    isTTY: options.isTTY ?? false,
    cwd: process.cwd(),
    stdout,
    stderr,
    configPath,
    fetchImpl: options.fetchImpl ?? fetch,
  });
  return { code, stdout: stdout.value, stderr: stderr.value };
}

describe("help and version", () => {
  test("prints usage and the empty-profile hint with no arguments", async () => {
    const result = await run(await tempPath(), []);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("no profiles configured");
    expect(result.stdout).toContain("Usage:");
  });

  test("prints help for --help", async () => {
    const result = await run(await tempPath(), ["--help"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("config new");
  });

  test("prints the version for --version", async () => {
    const result = await run(await tempPath(), ["--version"]);
    expect(result.stdout.trim()).toBe("0.1.0");
  });

  test("rejects an unknown option", async () => {
    const result = await run(await tempPath(), ["--nope"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown option");
  });
});

describe("profiles", () => {
  test("reports an unknown profile with the available names", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const result = await run(path, ["missing"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Available profiles: f, oc, om");
  });

  test("lists profiles non-interactively", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const result = await run(path, ["config", "list"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("NAME");
    expect(result.stdout).toContain("om");
    expect(result.stdout).toContain("claude");
  });

  test("shows the resolved plan with a masked literal key", async () => {
    const path = await tempPath();
    const config = makeConfig();
    config.providers.gw = makeProvider({
      auth: { style: "bearer", credential: { source: "literal", value: "supersecret1234" } },
    });
    await saveConfig(config, path);

    const result = await run(path, ["config", "show", "om"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ANTHROPIC_BASE_URL=https://gw.example.com/anthropic");
    expect(result.stdout).toContain("ANTHROPIC_AUTH_TOKEN=********1234");
    expect(result.stdout).not.toContain("supersecret1234");
  });

  test("warns about a missing env credential on show without failing", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const result = await run(path, ["config", "show", "om"]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("GW_KEY is not set");
    expect(result.stdout).toContain("<not set>");
  });

  test("deletes a profile with --yes", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const result = await run(path, ["config", "delete", "om", "--yes"]);
    expect(result.code).toBe(0);
    expect((await loadConfig(path)).profiles.om).toBeUndefined();
  });

  test("requires --yes for delete in a non-interactive terminal", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const result = await run(path, ["config", "delete", "om"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--yes");
  });

  test("rejects the interactive config menu without a TTY", async () => {
    const result = await run(await tempPath(), ["config"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("interactive terminal");
  });
});

describe("config new (non-interactive)", () => {
  test("creates a provider and profile and writes mode 0600", async () => {
    const path = await tempPath();
    const result = await run(path, [
      "config",
      "new",
      "--agent",
      "claude",
      "--name",
      "om",
      "--provider",
      "gw",
      "--model",
      "model-1",
      "--base-url-anthropic",
      "https://gw.example.com/anthropic",
      "--api-key-env",
      "GW_KEY",
    ]);

    expect(result.code).toBe(0);
    const config = await loadConfig(path);
    expect(config.profiles.om?.model).toBe("model-1");
    expect(config.providers.gw?.endpoints.anthropic).toBe("https://gw.example.com/anthropic");
    expect(config.providers.gw?.auth).toEqual({
      style: "bearer",
      credential: { source: "env", name: "GW_KEY" },
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  test("requires the core flags", async () => {
    const result = await run(await tempPath(), ["config", "new", "--agent", "claude"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("missing --name");
  });

  test("rejects an invalid agent", async () => {
    const result = await run(await tempPath(), ["config", "new", "--agent", "nope"]);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--agent must be one of");
  });

  test("reuses an existing provider and adds the requested model", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const result = await run(path, [
      "config",
      "new",
      "--agent",
      "claude",
      "--name",
      "new-profile",
      "--provider",
      "gw",
      "--model",
      "model-3",
    ]);
    expect(result.code).toBe(0);
    const config = await loadConfig(path);
    expect(config.profiles["new-profile"]?.model).toBe("model-3");
    expect(config.providers.gw?.models.map((entry) => entry.id)).toContain("model-3");
  });
});

describe("launching", () => {
  test("runs the agent with the profile env and propagates the exit code", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const directory = await mkdtemp(join(tmpdir(), "open-coders-bin-"));
    directories.push(directory);
    const binary = join(directory, "claude");
    await writeFile(binary, "#!/bin/sh\nexit 5\n");
    await chmod(binary, 0o755);

    const result = await run(path, ["om"], {
      env: { PATH: `${directory}:${process.env.PATH ?? ""}`, GW_KEY: "k" },
    });

    expect(result.code).toBe(5);
  });

  test("fails before spawning when the credential is missing", async () => {
    const path = await tempPath();
    await saveConfig(makeConfig(), path);
    const result = await run(path, ["om"], { env: {} });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("GW_KEY is not set");
  });
});

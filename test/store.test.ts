import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, resolveConfigPath, saveConfig } from "../src/config/store";
import { ConfigError } from "../src/errors";
import { makeConfig } from "./helpers";

const directories: string[] = [];

async function tempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "open-coders-store-"));
  directories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("resolveConfigPath", () => {
  test("uses an absolute XDG_CONFIG_HOME", () => {
    expect(resolveConfigPath({ XDG_CONFIG_HOME: "/tmp/xdg" })).toBe(
      "/tmp/xdg/open-coders/config.json",
    );
  });

  test("falls back to the home directory for a relative XDG_CONFIG_HOME", () => {
    const path = resolveConfigPath({ XDG_CONFIG_HOME: "relative/path" });
    expect(path.endsWith("/.config/open-coders/config.json")).toBe(true);
  });
});

describe("loadConfig", () => {
  test("returns an empty config when the file is missing", async () => {
    const directory = await tempDir();
    const config = await loadConfig(join(directory, "config.json"));
    expect(config).toEqual({ version: 1, providers: {}, profiles: {} });
  });

  test("rejects invalid JSON with the file path", async () => {
    const directory = await tempDir();
    const path = join(directory, "config.json");
    await writeFile(path, "{not json");
    await expect(loadConfig(path)).rejects.toThrow(ConfigError);
    await expect(loadConfig(path)).rejects.toThrow(path);
  });

  test("rejects schema violations", async () => {
    const directory = await tempDir();
    const path = join(directory, "config.json");
    await writeFile(path, JSON.stringify({ version: 1, providers: {}, profiles: {}, extra: true }));
    await expect(loadConfig(path)).rejects.toThrow(/Unrecognized key/);
  });
});

describe("saveConfig", () => {
  test("round-trips and writes mode 0600", async () => {
    const directory = await tempDir();
    const path = join(directory, "nested", "config.json");
    const config = makeConfig();
    await saveConfig(config, path);

    expect(await loadConfig(path)).toEqual(config);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect((await stat(join(directory, "nested"))).mode & 0o777).toBe(0o700);
    expect((await readFile(path, "utf8")).endsWith("\n")).toBe(true);
  });

  test("leaves no temp file behind", async () => {
    const directory = await tempDir();
    const path = join(directory, "config.json");
    await saveConfig(makeConfig(), path);
    expect(await readdir(directory)).toEqual(["config.json"]);
  });
});

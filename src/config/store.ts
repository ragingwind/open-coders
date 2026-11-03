import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { ConfigError } from "../errors";
import { type Config, emptyConfig, parseConfig } from "./schema";

export function resolveConfigPath(env: Record<string, string | undefined> = process.env): string {
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg?.startsWith("/")) {
    return join(xdg, "open-coders", "config.json");
  }
  return join(homedir(), ".config", "open-coders", "config.json");
}

export async function loadConfig(path: string = resolveConfigPath()): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if (isErrno(error, "ENOENT")) return emptyConfig();
    throw new ConfigError(`cannot read ${path}: ${errorMessage(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(`${path}: invalid JSON (${errorMessage(error)})`);
  }

  try {
    return parseConfig(raw);
  } catch (error) {
    if (error instanceof ConfigError) {
      throw new ConfigError(`${path}: ${error.message}`);
    }
    throw error;
  }
}

export async function saveConfig(
  config: Config,
  path: string = resolveConfigPath(),
): Promise<void> {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true, mode: 0o700 });

  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(temp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temp, path);
    await chmod(path, 0o600);
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(temp).catch(() => undefined);
    throw new ConfigError(`cannot write ${path}: ${errorMessage(error)}`);
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === code
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

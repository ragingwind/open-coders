import { resolveConfigPath } from "./config/store";

export interface Output {
  write(text: string): void;
}

export interface CliContext {
  env: Record<string, string | undefined>;
  cwd: string;
  stdout: Output;
  stderr: Output;
  isTTY: boolean;
  configPath: string;
  fetchImpl: typeof fetch;
}

export function createContext(overrides: Partial<CliContext> = {}): CliContext {
  return {
    env: overrides.env ?? process.env,
    cwd: overrides.cwd ?? process.cwd(),
    stdout: overrides.stdout ?? process.stdout,
    stderr: overrides.stderr ?? process.stderr,
    isTTY: overrides.isTTY ?? Boolean(process.stdin.isTTY && process.stdout.isTTY),
    configPath: overrides.configPath ?? resolveConfigPath(process.env),
    fetchImpl: overrides.fetchImpl ?? fetch,
  };
}

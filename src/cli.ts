import * as p from "@clack/prompts";
import pkg from "../package.json" with { type: "json" };
import { configCommand } from "./commands/config";
import { configList } from "./commands/config-list";
import { runCommand } from "./commands/run";
import { loadConfig } from "./config/store";
import { type CliContext, createContext } from "./context";
import { CancelledError, CliError, UsageError } from "./errors";
import { unwrap } from "./tui/prompts";

export const HELP = `open-coders v${pkg.version}

Usage:
  open-coders <profile> [agent args...]
  open-coders config [command]

Commands:
  config new        Create a profile (interactive by default)
  config update     Edit an existing profile
  config list       List profiles
  config show       Show the resolved launch settings
  config delete     Delete a profile

Options:
  -h, --help        Show this help
  -v, --version     Show the version

Run "open-coders config new" to connect a coding agent to a custom gateway.
`;

export async function main(argv: string[], overrides: Partial<CliContext> = {}): Promise<number> {
  const ctx = createContext(overrides);

  try {
    return await dispatch(argv, ctx);
  } catch (error) {
    if (error instanceof CancelledError) {
      ctx.stderr.write("cancelled\n");
      return 130;
    }
    if (error instanceof CliError) {
      if (error.message) ctx.stderr.write(`${error.message}\n`);
      return error.exitCode;
    }
    ctx.stderr.write(`open-coders: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

async function dispatch(argv: string[], ctx: CliContext): Promise<number> {
  const [first, ...rest] = argv;

  if (!first) return withoutArguments(ctx);
  if (first === "-h" || first === "--help") {
    ctx.stdout.write(HELP);
    return 0;
  }
  if (first === "-v" || first === "--version") {
    ctx.stdout.write(`${pkg.version}\n`);
    return 0;
  }
  if (first === "config") return configCommand(rest, ctx);
  if (first.startsWith("-")) throw new UsageError(`unknown option ${first}\n\n${HELP}`);

  return runCommand(first, rest, ctx);
}

async function withoutArguments(ctx: CliContext): Promise<number> {
  if (!ctx.isTTY) {
    await configList(ctx);
    ctx.stdout.write(`\n${HELP}`);
    return 0;
  }

  const config = await loadConfig(ctx.configPath);
  const names = Object.keys(config.profiles).sort();
  if (names.length === 0) {
    ctx.stdout.write('no profiles configured. Run "open-coders config new"\n');
    return 1;
  }

  const name = unwrap(
    await p.select({
      message: "실행할 프로파일",
      options: names.map((entry) => ({ value: entry, label: entry })),
    }),
  );
  return runCommand(name, [], ctx);
}

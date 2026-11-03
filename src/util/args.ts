import { UsageError } from "../errors";

export type FlagKind = "string" | "boolean" | "string[]";

export interface ParsedFlags {
  values: Record<string, string | boolean | string[]>;
  positionals: string[];
}

export function parseFlags(argv: string[], spec: Record<string, FlagKind>): ParsedFlags {
  const values: Record<string, string | boolean | string[]> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(...argv.slice(i));
      break;
    }

    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    const inline = eq === -1 ? undefined : arg.slice(eq + 1);
    const kind = spec[name];
    if (!kind) throw new UsageError(`unknown flag --${name}`);

    if (kind === "boolean") {
      if (inline !== undefined) throw new UsageError(`--${name} does not take a value`);
      values[name] = true;
      continue;
    }

    const value = inline ?? argv[++i];
    if (value === undefined) throw new UsageError(`--${name} requires a value`);
    if (kind === "string[]") {
      const list = (values[name] as string[] | undefined) ?? [];
      list.push(value);
      values[name] = list;
    } else {
      values[name] = value;
    }
  }

  return { values, positionals };
}

export function getString(values: ParsedFlags["values"], name: string): string | undefined {
  const value = values[name];
  return typeof value === "string" ? value : undefined;
}

export function getBool(values: ParsedFlags["values"], name: string): boolean {
  return values[name] === true;
}

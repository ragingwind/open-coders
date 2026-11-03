import pkg from "../package.json" with { type: "json" };

export interface Output {
  write(text: string): void;
}

const HELP = `open-coders v${pkg.version}

Usage:
  open-coders [command]

Commands:
  (none yet)

Options:
  -h, --help     Show this help.
  -v, --version  Show the version.
`;

export function main(
  argv: string[],
  out: Output = process.stdout,
  err: Output = process.stderr,
): number {
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    out.write(HELP);
    return 0;
  }

  if (argv.includes("-v") || argv.includes("--version")) {
    out.write(`${pkg.version}\n`);
    return 0;
  }

  err.write(`open-coders: unknown argument: ${argv[0] ?? ""}\n\n${HELP}`);
  return 1;
}

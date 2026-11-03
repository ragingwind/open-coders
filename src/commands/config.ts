import * as p from "@clack/prompts";
import { loadConfig } from "../config/store";
import type { CliContext } from "../context";
import { UsageError } from "../errors";
import { unwrap } from "../tui/prompts";
import { configDelete, configList, configShow } from "./config-list";
import { configNew } from "./config-new";
import { configUpdate } from "./config-update";

export async function configCommand(argv: string[], ctx: CliContext): Promise<number> {
  const [sub, ...rest] = argv;

  if (sub === "-h" || sub === "--help") {
    ctx.stdout.write(CONFIG_HELP);
    return 0;
  }
  if (!sub) return configMenu(ctx);

  switch (sub) {
    case "new":
      return configNew(rest, ctx);
    case "update":
      return configUpdate(rest, ctx);
    case "list":
      return configList(ctx);
    case "show":
      return configShow(rest[0], ctx);
    case "delete": {
      const yes = rest.includes("--yes");
      const name = rest.find((arg) => !arg.startsWith("--"));
      return configDelete(name, { yes }, ctx);
    }
    default:
      throw new UsageError(`unknown config command "${sub}"\n\n${CONFIG_HELP}`);
  }
}

async function configMenu(ctx: CliContext): Promise<number> {
  if (!ctx.isTTY) {
    throw new UsageError(
      'config needs an interactive terminal; use "open-coders config new|list|show|delete"',
    );
  }

  const config = await loadConfig(ctx.configPath);
  const names = Object.keys(config.profiles).sort();

  const action = unwrap(
    await p.select({
      message: "open-coders config",
      options: [
        { value: "new", label: "새 프로파일 만들기" },
        ...(names.length > 0
          ? [
              { value: "update", label: "프로파일 수정" },
              { value: "show", label: "프로파일 보기" },
              { value: "delete", label: "프로파일 삭제" },
            ]
          : []),
        { value: "list", label: "목록" },
        { value: "quit", label: "종료" },
      ],
    }),
  );

  if (action === "new") return configNew([], ctx);
  if (action === "list") {
    await configList(ctx);
    return 0;
  }
  if (action === "quit") return 0;

  const name = unwrap(
    await p.select({
      message: "프로파일",
      options: names.map((entry) => ({ value: entry, label: entry })),
    }),
  );

  if (action === "update") return configUpdate([name], ctx);
  if (action === "show") return configShow(name, ctx);
  return configDelete(name, { yes: false }, ctx);
}

const CONFIG_HELP = `open-coders config

Usage:
  open-coders config                      interactive menu (TTY)
  open-coders config new [flags]
  open-coders config update <profile>
  open-coders config list
  open-coders config show <profile>
  open-coders config delete <profile> [--yes]

config new flags (non-interactive):
  --agent claude|opencode|fx
  --name <profile>
  --provider <id or name>
  --protocol anthropic|openai-compatible
  --model <model id>
  --base-url-anthropic <url>
  --base-url-openai <url>
  --api-key-env <ENV_NAME>
  --yes
`;

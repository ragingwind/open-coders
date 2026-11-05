import { validateConfig } from "../config/schema";
import { loadConfig, saveConfig } from "../config/store";
import type { CliContext } from "../context";
import { ConfigError, UsageError } from "../errors";
import { updateProfileFlow } from "../tui/config-form";
import { parseFlags } from "../util/args";

export async function configUpdate(argv: string[], ctx: CliContext): Promise<number> {
  const { positionals } = parseFlags(argv, {});
  const name = positionals[0];
  if (!name) throw new UsageError("usage: open-coders config update <profile>");
  if (!ctx.isTTY) throw new UsageError("config update requires an interactive terminal");

  const config = await loadConfig(ctx.configPath);
  if (!config.profiles[name]) throw new ConfigError(`unknown profile "${name}"`);

  const draft = await updateProfileFlow(config, name, ctx);
  config.profiles[name] = draft.profile;
  if (draft.provider) config.providers[draft.providerId] = draft.provider;

  const problems = validateConfig(config);
  const errors = problems.filter((problem) => problem.severity === "error");
  if (errors.length > 0) {
    throw new ConfigError(
      `refusing to save an invalid config:\n${errors.map((problem) => `${problem.path}: ${problem.message}`).join("\n")}`,
    );
  }
  for (const warning of problems) {
    ctx.stderr.write(`warning: ${warning.path}: ${warning.message}\n`);
  }

  await saveConfig(config, ctx.configPath);
  ctx.stdout.write(`updated profile "${name}"\n`);
  return 0;
}

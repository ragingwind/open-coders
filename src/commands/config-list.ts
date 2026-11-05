import { confirm, isCancel } from "@clack/prompts";
import { buildLaunchPlan } from "../agents";
import { resolveProfile } from "../config/resolve";
import { type Auth, validateConfig } from "../config/schema";
import { loadConfig, saveConfig } from "../config/store";
import type { CliContext } from "../context";
import { ConfigError, UsageError } from "../errors";
import { maskValue } from "../util/mask";

export async function configList(ctx: CliContext): Promise<number> {
  const config = await loadConfig(ctx.configPath);
  const names = Object.keys(config.profiles).sort();

  if (names.length === 0) {
    ctx.stdout.write('no profiles configured. Run "open-coders config new"\n');
    return 0;
  }

  const rows: string[][] = [
    ["NAME", "AGENT", "PROVIDER", "MODEL"],
    ...names.flatMap((name) => {
      const profile = config.profiles[name];
      return profile ? [[name, profile.agent, profile.provider, profile.model]] : [];
    }),
  ];
  const header = rows[0] ?? [];
  const widths = header.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  for (const row of rows) {
    ctx.stdout.write(
      `${row
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join("  ")
        .trimEnd()}\n`,
    );
  }

  for (const problem of validateConfig(config)) {
    ctx.stderr.write(`${problem.severity}: ${problem.path}: ${problem.message}\n`);
  }
  return 0;
}

export async function configShow(name: string | undefined, ctx: CliContext): Promise<number> {
  if (!name) throw new UsageError("usage: open-coders config show <profile>");
  const config = await loadConfig(ctx.configPath);
  const resolved = resolveProfile(config, name, { env: ctx.env, requireCredential: false });

  const missingCredential =
    resolved.provider.auth.style !== "none" && resolved.credential === undefined;
  const credential = resolved.credential ?? (missingCredential ? "<not set>" : undefined);

  const plan = buildLaunchPlan(resolved.profile.agent, {
    profile: resolved.profile,
    provider: resolved.provider,
    providerId: resolved.providerId,
    model: resolved.model,
    roleModels: resolved.roleModels,
    credential,
    userArgs: [],
  });

  const lines = [
    `profile: ${resolved.name}`,
    `agent: ${resolved.profile.agent}`,
    `provider: ${resolved.provider.name} (${resolved.providerId})`,
    `model: ${resolved.model.name ?? resolved.model.id} (${resolved.model.key})`,
  ];

  if (resolved.profile.protocol) lines.push(`protocol: ${resolved.profile.protocol}`);
  if (resolved.profile.roles && Object.keys(resolved.profile.roles).length > 0) {
    lines.push(
      `roles: ${Object.entries(resolved.profile.roles)
        .map(([role, key]) => `${role}=${key}`)
        .join(", ")}`,
    );
  }
  if (resolved.profile.limits) lines.push(`limits: ${JSON.stringify(resolved.profile.limits)}`);

  lines.push(`command: ${[plan.command, ...plan.args].join(" ")}`);
  lines.push("env:");
  for (const [key, value] of Object.entries(plan.env)) {
    lines.push(`  ${key}=${maskValue(value, [resolved.credential])}`);
  }
  if (plan.unset.length > 0) lines.push(`unset: ${plan.unset.join(", ")}`);

  if (missingCredential) {
    lines.push(
      `warning: credential is not available (${describeCredential(resolved.provider.auth, ctx.env)})`,
    );
  }

  ctx.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}

export async function configDelete(
  name: string | undefined,
  options: { yes: boolean },
  ctx: CliContext,
): Promise<number> {
  if (!name) throw new UsageError("usage: open-coders config delete <profile>");
  const config = await loadConfig(ctx.configPath);
  if (!config.profiles[name]) throw new ConfigError(`unknown profile "${name}"`);

  if (!options.yes) {
    if (!ctx.isTTY) {
      throw new UsageError("config delete requires --yes in a non-interactive terminal");
    }
    const answer = await confirm({ message: `Delete profile "${name}"?` });
    if (isCancel(answer)) return 130;
    if (!answer) {
      ctx.stdout.write("aborted\n");
      return 0;
    }
  }

  delete config.profiles[name];
  await saveConfig(config, ctx.configPath);
  ctx.stdout.write(`deleted profile "${name}"\n`);
  return 0;
}

function describeCredential(auth: Auth, env: Record<string, string | undefined>): string {
  if (auth.style === "none") return "no credential required";
  const credential = auth.credential;
  if (credential?.source === "env" && credential.name) {
    return `${credential.name} is ${env[credential.name] ? "set" : "not set"}`;
  }
  return "literal credential not stored";
}

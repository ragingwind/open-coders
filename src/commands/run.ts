import { buildLaunchPlan } from "../agents";
import { resolveProfile } from "../config/resolve";
import { loadConfig } from "../config/store";
import type { CliContext } from "../context";
import { runPlan } from "../util/spawn";

export async function runCommand(
  profileName: string,
  userArgs: string[],
  ctx: CliContext,
): Promise<number> {
  const config = await loadConfig(ctx.configPath);
  const resolved = resolveProfile(config, profileName, { env: ctx.env });
  const plan = buildLaunchPlan(resolved.profile.agent, {
    profile: resolved.profile,
    provider: resolved.provider,
    providerId: resolved.providerId,
    model: resolved.model,
    roleModels: resolved.roleModels,
    credential: resolved.credential,
    userArgs,
  });
  return runPlan(plan, { env: ctx.env, cwd: ctx.cwd });
}

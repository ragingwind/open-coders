import { ConfigError } from "../errors";
import type { LaunchInput, LaunchPlan } from "./types";

export function planFx(input: LaunchInput): LaunchPlan {
  const { profile, provider, model, credential } = input;

  if (provider.kind !== "vercel-ai-gateway") {
    throw new ConfigError(
      `profile "${profile.name}" runs fx, which only works with a vercel-ai-gateway provider; fx 0.0.5 cannot use a custom base URL`,
    );
  }

  const env: Record<string, string> = { FX_MODEL: model.id };
  const unset: string[] = [];

  if (credential !== undefined) {
    env.AI_GATEWAY_API_KEY = credential;
    // VERCEL_OIDC_TOKEN is preferred over AI_GATEWAY_API_KEY by fx.
    unset.push("VERCEL_OIDC_TOKEN");
  }

  Object.assign(env, profile.env);

  return {
    command: "fx",
    args: [...(profile.args ?? []), ...input.userArgs],
    env,
    unset,
  };
}

import { CLAUDE_ROLES, type ClaudeRole } from "../config/schema";
import { ConfigError } from "../errors";
import type { LaunchInput, LaunchPlan } from "./types";

const ROLE_ENV: Record<ClaudeRole, string> = {
  fable: "ANTHROPIC_DEFAULT_FABLE_MODEL",
  opus: "ANTHROPIC_DEFAULT_OPUS_MODEL",
  sonnet: "ANTHROPIC_DEFAULT_SONNET_MODEL",
  haiku: "ANTHROPIC_DEFAULT_HAIKU_MODEL",
};

export function planClaude(input: LaunchInput): LaunchPlan {
  const { profile, provider, model, roleModels, credential } = input;

  if (provider.kind !== "custom") {
    throw new ConfigError(`provider "${input.providerId}" is not a custom provider`);
  }
  const endpoint = provider.endpoints.anthropic;
  if (!endpoint) {
    throw new ConfigError(`provider "${input.providerId}" has no anthropic endpoint`);
  }

  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: endpoint,
    ANTHROPIC_MODEL: model.id,
  };

  for (const role of CLAUDE_ROLES) {
    env[ROLE_ENV[role]] = roleModels[role]?.id ?? model.id;
  }

  const unset: string[] = [];
  switch (provider.auth.style) {
    case "bearer":
      if (credential === undefined) {
        throw new ConfigError(`provider "${input.providerId}" needs an API key`);
      }
      env.ANTHROPIC_AUTH_TOKEN = credential;
      break;
    case "x-api-key":
      if (credential === undefined) {
        throw new ConfigError(`provider "${input.providerId}" needs an API key`);
      }
      env.ANTHROPIC_API_KEY = credential;
      // ANTHROPIC_AUTH_TOKEN outranks ANTHROPIC_API_KEY, so a leaked parent value would win.
      unset.push("ANTHROPIC_AUTH_TOKEN");
      break;
    case "none":
      unset.push("ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_API_KEY");
      break;
  }

  const limits = profile.limits;
  if (limits?.maxContextTokens !== undefined) {
    env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = String(limits.maxContextTokens);
  }
  if (limits?.maxOutputTokens !== undefined) {
    env.CLAUDE_CODE_MAX_OUTPUT_TOKENS = String(limits.maxOutputTokens);
  }
  if (limits?.disableCompact) {
    env.DISABLE_COMPACT = "1";
  }

  Object.assign(env, profile.env);

  const userSetsModel = input.userArgs.some(
    (arg) => arg === "--model" || arg.startsWith("--model="),
  );
  const args: string[] = [];
  if (!userSetsModel) args.push("--model", model.id);
  args.push(...(profile.args ?? []), ...input.userArgs);

  return { command: "claude", args, env, unset };
}

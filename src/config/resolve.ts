import { ConfigError } from "../errors";
import {
  type Auth,
  CLAUDE_ROLES,
  type ClaudeRole,
  type Config,
  type Model,
  type Profile,
  type Protocol,
  type Provider,
} from "./schema";

export interface ResolvedProfile {
  name: string;
  profile: Profile;
  providerId: string;
  provider: Provider;
  model: Model;
  roleModels: Partial<Record<ClaudeRole, Model>>;
  credential: string | undefined;
  protocol: Protocol;
}

export interface SecretLookup {
  value?: string;
  error?: string;
}

export function lookupSecret(auth: Auth, env: Record<string, string | undefined>): SecretLookup {
  if (auth.style === "none") return {};
  if (auth.credential.source === "literal") return { value: auth.credential.value };
  const value = env[auth.credential.name];
  if (!value) {
    return { error: `environment variable ${auth.credential.name} is not set` };
  }
  return { value };
}

export function findModel(provider: Provider, reference: string): Model | undefined {
  return (
    provider.models.find((model) => model.key === reference) ??
    provider.models.find((model) => model.id === reference)
  );
}

export function protocolFor(profile: Profile): Protocol {
  return profile.protocol ?? "openai-compatible";
}

export function endpointFor(profile: Profile, provider: Provider): string {
  if (profile.agent === "claude") {
    const url = provider.endpoints.anthropic;
    if (!url) {
      throw new ConfigError(
        `provider "${profile.provider}" has no anthropic endpoint; run "open-coders config update ${profile.name}"`,
      );
    }
    return url;
  }

  if (profile.agent === "opencode") {
    const protocol = protocolFor(profile);
    const url =
      protocol === "anthropic" ? provider.endpoints.anthropic : provider.endpoints.openaiCompatible;
    if (!url) {
      throw new ConfigError(
        `provider "${profile.provider}" has no ${protocol} endpoint; run "open-coders config update ${profile.name}"`,
      );
    }
    return url;
  }

  throw new ConfigError("fx uses the Vercel AI Gateway and has no custom endpoint");
}

export function resolveProfile(
  config: Config,
  name: string,
  options: { env: Record<string, string | undefined>; requireCredential?: boolean } = {
    env: process.env,
  },
): ResolvedProfile {
  const profile = config.profiles[name];
  if (!profile) {
    throw new ConfigError(unknownProfileMessage(config, name));
  }

  const provider = config.providers[profile.provider];
  if (!provider) {
    throw new ConfigError(`profile "${name}" references unknown provider "${profile.provider}"`);
  }

  assertCompatible(profile, provider);

  const model = findModel(provider, profile.model);
  if (!model) {
    throw new ConfigError(
      `profile "${name}" references unknown model "${profile.model}" in provider "${profile.provider}"`,
    );
  }

  const roleModels: Partial<Record<ClaudeRole, Model>> = {};
  for (const role of CLAUDE_ROLES) {
    const reference = profile.roles?.[role];
    if (!reference) continue;
    const roleModel = findModel(provider, reference);
    if (!roleModel) {
      throw new ConfigError(
        `profile "${name}" maps role ${role} to unknown model "${reference}" in provider "${profile.provider}"`,
      );
    }
    roleModels[role] = roleModel;
  }

  const secret = lookupSecret(provider.auth, options.env);
  if (options.requireCredential !== false && secret.error) {
    throw new ConfigError(`${secret.error} (required by provider "${profile.provider}")`);
  }

  return {
    name,
    profile,
    providerId: profile.provider,
    provider,
    model,
    roleModels,
    credential: secret.value,
    protocol: profile.agent === "claude" ? "anthropic" : protocolFor(profile),
  };
}

export function assertCompatible(profile: Profile, provider: Provider): void {
  if (profile.agent === "claude") {
    if (provider.kind !== "custom" || !provider.endpoints.anthropic) {
      throw new ConfigError(
        `profile "${profile.name}" runs claude, which needs a custom provider with an anthropic endpoint`,
      );
    }
    return;
  }

  if (profile.agent === "opencode") {
    const protocol = protocolFor(profile);
    const endpoint =
      protocol === "anthropic" ? provider.endpoints.anthropic : provider.endpoints.openaiCompatible;
    if (provider.kind !== "custom" || !endpoint) {
      throw new ConfigError(
        `profile "${profile.name}" runs OpenCode, which needs a custom provider with a ${protocol} endpoint`,
      );
    }
    return;
  }

  if (provider.kind !== "vercel-ai-gateway") {
    throw new ConfigError(
      `profile "${profile.name}" runs fx, which only works with a vercel-ai-gateway provider`,
    );
  }
}

export function unknownProfileMessage(config: Config, name: string): string {
  const names = Object.keys(config.profiles).sort();
  if (names.length === 0) {
    return `unknown profile "${name}"; no profiles configured. Run "open-coders config new"`;
  }
  return `unknown profile "${name}". Available profiles: ${names.join(", ")}`;
}

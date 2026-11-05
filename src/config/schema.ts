import { z } from "zod";
import { ConfigError } from "../errors";

export const PROFILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
export const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/;
export const MODEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const AGENTS = ["claude", "opencode", "fx"] as const;
export const PROTOCOLS = ["anthropic", "openai-compatible"] as const;
export const PROVIDER_KINDS = ["custom", "vercel-ai-gateway"] as const;
export const CLAUDE_ROLES = ["fable", "opus", "sonnet", "haiku"] as const;

export type AgentId = (typeof AGENTS)[number];
export type Protocol = (typeof PROTOCOLS)[number];
export type ProviderKind = (typeof PROVIDER_KINDS)[number];
export type ClaudeRole = (typeof CLAUDE_ROLES)[number];

const modelSchema = z.strictObject({
  key: z.string().regex(MODEL_KEY_PATTERN),
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  contextWindow: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  toolCall: z.boolean().optional(),
  reasoning: z.boolean().optional(),
});

const credentialSchema = z.discriminatedUnion("source", [
  z.strictObject({
    source: z.literal("env"),
    name: z.string().regex(ENV_NAME_PATTERN),
  }),
  z.strictObject({
    source: z.literal("literal"),
    value: z.string().min(1),
  }),
]);

const authSchema = z.discriminatedUnion("style", [
  z.strictObject({ style: z.literal("bearer"), credential: credentialSchema }),
  z.strictObject({ style: z.literal("x-api-key"), credential: credentialSchema }),
  z.strictObject({ style: z.literal("none") }),
]);

const providerSchema = z.strictObject({
  name: z.string().min(1),
  kind: z.enum(PROVIDER_KINDS),
  auth: authSchema,
  endpoints: z.strictObject({
    anthropic: z.url().optional(),
    openaiCompatible: z.url().optional(),
  }),
  modelsUrl: z.url().optional(),
  models: z.array(modelSchema),
});

const limitsSchema = z.strictObject({
  maxContextTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  disableCompact: z.boolean().optional(),
});

const rolesSchema = z.strictObject({
  fable: z.string().optional(),
  opus: z.string().optional(),
  sonnet: z.string().optional(),
  haiku: z.string().optional(),
});

const profileSchema = z.strictObject({
  name: z.string().regex(PROFILE_NAME_PATTERN),
  agent: z.enum(AGENTS),
  provider: z.string().regex(PROVIDER_ID_PATTERN),
  protocol: z.enum(PROTOCOLS).optional(),
  model: z.string().regex(MODEL_KEY_PATTERN),
  roles: rolesSchema.optional(),
  limits: limitsSchema.optional(),
  env: z.record(z.string().regex(ENV_NAME_PATTERN), z.string()).optional(),
  args: z.array(z.string()).optional(),
});

export const configSchema = z.strictObject({
  version: z.literal(1),
  providers: z.record(z.string().regex(PROVIDER_ID_PATTERN), providerSchema),
  profiles: z.record(z.string().regex(PROFILE_NAME_PATTERN), profileSchema),
});

export type Model = z.infer<typeof modelSchema>;
export type Credential = z.infer<typeof credentialSchema>;
export type Auth = z.infer<typeof authSchema>;
export type Provider = z.infer<typeof providerSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Config = z.infer<typeof configSchema>;

export interface Problem {
  path: string;
  message: string;
}

export function parseConfig(raw: unknown): Config {
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const details = result.error.issues
      .map(
        (issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new ConfigError(`invalid config:\n${details}`);
  }
  return result.data;
}

export function validateConfig(config: Config): Problem[] {
  const problems: Problem[] = [];

  for (const [id, provider] of Object.entries(config.providers)) {
    const seen = new Set<string>();
    for (const model of provider.models) {
      if (seen.has(model.key)) {
        problems.push({
          path: `providers.${id}.models`,
          message: `duplicate model key "${model.key}"`,
        });
      }
      seen.add(model.key);
    }

    if (
      provider.kind === "custom" &&
      !provider.endpoints.anthropic &&
      !provider.endpoints.openaiCompatible
    ) {
      problems.push({
        path: `providers.${id}.endpoints`,
        message: "custom provider needs an anthropic or openaiCompatible endpoint",
      });
    }

    if (
      provider.kind === "vercel-ai-gateway" &&
      (provider.endpoints.anthropic || provider.endpoints.openaiCompatible)
    ) {
      problems.push({
        path: `providers.${id}.endpoints`,
        message: "vercel-ai-gateway providers do not use custom endpoints",
      });
    }
  }

  for (const [name, profile] of Object.entries(config.profiles)) {
    if (profile.name !== name) {
      problems.push({
        path: `profiles.${name}.name`,
        message: `profile name must match its key "${name}"`,
      });
    }

    const provider = config.providers[profile.provider];
    if (!provider) {
      problems.push({
        path: `profiles.${name}.provider`,
        message: `unknown provider "${profile.provider}"`,
      });
      continue;
    }

    const modelKeys = new Set(provider.models.map((model) => model.key));
    if (!modelKeys.has(profile.model)) {
      problems.push({
        path: `profiles.${name}.model`,
        message: `unknown model key "${profile.model}" in provider "${profile.provider}"`,
      });
    }
    for (const role of CLAUDE_ROLES) {
      const roleModel = profile.roles?.[role];
      if (roleModel && !modelKeys.has(roleModel)) {
        problems.push({
          path: `profiles.${name}.roles.${role}`,
          message: `unknown model key "${roleModel}" in provider "${profile.provider}"`,
        });
      }
    }

    if (profile.agent === "claude") {
      if (provider.kind !== "custom" || !provider.endpoints.anthropic) {
        problems.push({
          path: `profiles.${name}.agent`,
          message: "claude requires a custom provider with an anthropic endpoint",
        });
      }
    } else if (profile.agent === "opencode") {
      const protocol = profile.protocol ?? "openai-compatible";
      const endpoint =
        protocol === "anthropic"
          ? provider.endpoints.anthropic
          : provider.endpoints.openaiCompatible;
      if (provider.kind !== "custom" || !endpoint) {
        problems.push({
          path: `profiles.${name}.protocol`,
          message: `OpenCode requires a custom provider with a ${protocol} endpoint`,
        });
      }
    } else if (profile.agent === "fx") {
      if (provider.kind !== "vercel-ai-gateway") {
        problems.push({
          path: `profiles.${name}.agent`,
          message: "fx requires a vercel-ai-gateway provider",
        });
      }
    }
  }

  return problems;
}

export function emptyConfig(): Config {
  return { version: 1, providers: {}, profiles: {} };
}

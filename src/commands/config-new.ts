import { assertCompatible, findModel } from "../config/resolve";
import {
  AGENTS,
  type AgentId,
  type Auth,
  type Config,
  PROFILE_NAME_PATTERN,
  PROTOCOLS,
  PROVIDER_ID_PATTERN,
  type Profile,
  type Protocol,
  type Provider,
  validateConfig,
} from "../config/schema";
import { loadConfig, saveConfig } from "../config/store";
import type { CliContext } from "../context";
import { ConfigError, UsageError } from "../errors";
import { slugModelKey } from "../providers/fetch-models";
import {
  type NewFlags,
  newProfileFlow,
  type ProfileDraft,
  providerIdFromName,
} from "../tui/config-form";
import { getBool, getString, parseFlags } from "../util/args";

const RESERVED_PROFILE_NAMES = new Set(["config", "help", "version"]);

const SPEC = {
  agent: "string",
  name: "string",
  provider: "string",
  protocol: "string",
  model: "string",
  "base-url-anthropic": "string",
  "base-url-openai": "string",
  "api-key-env": "string",
  yes: "boolean",
} as const;

export async function configNew(argv: string[], ctx: CliContext): Promise<number> {
  const { values } = parseFlags(argv, SPEC);
  const flags: NewFlags = {
    agent: getString(values, "agent"),
    name: getString(values, "name"),
    provider: getString(values, "provider"),
    protocol: getString(values, "protocol"),
    model: getString(values, "model"),
    baseUrlAnthropic: getString(values, "base-url-anthropic"),
    baseUrlOpenai: getString(values, "base-url-openai"),
    apiKeyEnv: getString(values, "api-key-env"),
  };
  const yes = getBool(values, "yes");

  const config = await loadConfig(ctx.configPath);

  if (!ctx.isTTY) {
    await createNonInteractive(config, flags, ctx);
    return 0;
  }

  const draft = await newProfileFlow(config, ctx, flags, yes);
  applyDraft(config, draft);
  ensureValid(config);
  await saveConfig(config, ctx.configPath);
  ctx.stdout.write(`saved profile "${draft.profile.name}"\n`);
  ctx.stdout.write(`launch it with: open-coders ${draft.profile.name}\n`);
  return 0;
}

async function createNonInteractive(
  config: Config,
  flags: NewFlags,
  ctx: CliContext,
): Promise<void> {
  const agent = requireAgent(flags.agent);
  const name = requireFlag("name", flags.name);
  const providerRef = requireFlag("provider", flags.provider);
  const modelRef = requireFlag("model", flags.model);

  validateProfileName(config, name);

  let providerId = providerRef;
  let provider = config.providers[providerRef];

  if (!provider) {
    providerId = PROVIDER_ID_PATTERN.test(providerRef)
      ? providerRef
      : providerIdFromName(providerRef, config);
    provider = createProvider(providerRef, agent, flags);
    config.providers[providerId] = provider;
  }

  const protocol = agent === "opencode" ? parseProtocol(flags.protocol) : undefined;

  let model = findModel(provider, modelRef);
  if (!model) {
    const key = slugModelKey(modelRef, new Set(provider.models.map((entry) => entry.key)));
    model = { key, id: modelRef };
    provider.models.push(model);
  }

  const profile: Profile = {
    name,
    agent,
    provider: providerId,
    model: model.key,
    ...(protocol ? { protocol } : {}),
  };

  assertCompatible(profile, provider);
  config.profiles[name] = profile;
  ensureValid(config);
  await saveConfig(config, ctx.configPath);
  ctx.stdout.write(`saved profile "${name}"\n`);
  ctx.stdout.write(`launch it with: open-coders ${name}\n`);
}

function createProvider(displayName: string, agent: AgentId, flags: NewFlags): Provider {
  if (agent === "fx") {
    const auth = gatewayAuth(flags.apiKeyEnv);
    return { name: displayName, kind: "vercel-ai-gateway", auth, endpoints: {}, models: [] };
  }

  const endpoints: Provider["endpoints"] = {};
  if (agent === "claude") {
    endpoints.anthropic = requireUrl("base-url-anthropic", flags.baseUrlAnthropic);
    if (flags.baseUrlOpenai) {
      endpoints.openaiCompatible = requireUrl("base-url-openai", flags.baseUrlOpenai);
    }
  } else {
    const protocol = parseProtocol(flags.protocol);
    if (protocol === "anthropic") {
      endpoints.anthropic = requireUrl("base-url-anthropic", flags.baseUrlAnthropic);
    } else {
      endpoints.openaiCompatible = requireUrl("base-url-openai", flags.baseUrlOpenai);
    }
  }

  const auth: Auth = flags.apiKeyEnv
    ? { style: "bearer", credential: { source: "env", name: flags.apiKeyEnv } }
    : { style: "none" };

  return { name: displayName, kind: "custom", auth, endpoints, models: [] };
}

function gatewayAuth(apiKeyEnv: string | undefined): Auth {
  return {
    style: "bearer",
    credential: { source: "env", name: apiKeyEnv ?? "AI_GATEWAY_API_KEY" },
  };
}

function applyDraft(config: Config, draft: ProfileDraft): void {
  if (draft.provider) config.providers[draft.providerId] = draft.provider;
  config.profiles[draft.profile.name] = draft.profile;
}

function ensureValid(config: Config): void {
  const problems = validateConfig(config);
  if (problems.length > 0) {
    throw new ConfigError(
      `refusing to save an invalid config:\n${problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n")}`,
    );
  }
}

function validateProfileName(config: Config, name: string): void {
  if (RESERVED_PROFILE_NAMES.has(name)) {
    throw new UsageError(`profile name "${name}" is reserved`);
  }
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new UsageError(
      'profile name must start with a letter or digit and contain only letters, digits, ".", "_" or "-"',
    );
  }
  if (config.profiles[name]) {
    throw new UsageError(`profile "${name}" already exists`);
  }
}

function requireFlag(name: string, value: string | undefined): string {
  if (!value) throw new UsageError(`missing --${name}`);
  return value;
}

function requireUrl(name: string, value: string | undefined): string {
  const url = requireFlag(name, value);
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("not http(s)");
    }
  } catch {
    throw new UsageError(`--${name} must be an http(s) URL`);
  }
  return url;
}

function requireAgent(value: string | undefined): AgentId {
  const agent = requireFlag("agent", value);
  if (!(AGENTS as readonly string[]).includes(agent)) {
    throw new UsageError(`--agent must be one of: ${AGENTS.join(", ")}`);
  }
  return agent as AgentId;
}

function parseProtocol(value: string | undefined): Protocol {
  if (!value) return "openai-compatible";
  if (!(PROTOCOLS as readonly string[]).includes(value)) {
    throw new UsageError(`--protocol must be one of: ${PROTOCOLS.join(", ")}`);
  }
  return value as Protocol;
}

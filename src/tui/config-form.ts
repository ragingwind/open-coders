import * as p from "@clack/prompts";
import { findModel, lookupSecret } from "../config/resolve";
import {
  type AgentId,
  type Auth,
  CLAUDE_ROLES,
  type ClaudeRole,
  type Config,
  type Credential,
  type Model,
  PROFILE_NAME_PATTERN,
  PROVIDER_ID_PATTERN,
  type Profile,
  type Protocol,
  type Provider,
} from "../config/schema";
import type { CliContext } from "../context";
import { CancelledError, ConfigError } from "../errors";
import { fetchModels, slugModelKey } from "../providers/fetch-models";
import { requireTTY, unwrap } from "./prompts";

const RESERVED_PROFILE_NAMES = new Set(["config", "help", "version"]);

export interface ProfileDraft {
  profile: Profile;
  providerId: string;
  provider?: Provider;
}

export interface NewFlags {
  agent?: string;
  name?: string;
  provider?: string;
  protocol?: string;
  model?: string;
  baseUrlAnthropic?: string;
  baseUrlOpenai?: string;
  apiKeyEnv?: string;
}

export function providerIdFromName(name: string, config: Config): string {
  let base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  if (!base || !/^[a-z0-9]/.test(base)) base = `p-${base}`.replace(/^-+|-+$/g, "");
  if (!PROVIDER_ID_PATTERN.test(base)) base = "provider";

  let id = base;
  let suffix = 2;
  while (config.providers[id]) {
    id = `${base.slice(0, 44)}-${suffix}`;
    suffix += 1;
  }
  return id;
}

export function mergeModels(existing: Model[], fetched: Model[]): Model[] {
  const merged = [...existing];
  const keys = new Set(existing.map((model) => model.key));
  const ids = new Set(existing.map((model) => model.id));
  for (const model of fetched) {
    if (ids.has(model.id)) continue;
    let key = model.key;
    let suffix = 2;
    while (keys.has(key)) {
      key = `${model.key}-${suffix}`;
      suffix += 1;
    }
    keys.add(key);
    ids.add(model.id);
    merged.push({ ...model, key });
  }
  return merged;
}

export async function newProfileFlow(
  config: Config,
  ctx: CliContext,
  flags: NewFlags = {},
  skipConfirm = false,
): Promise<ProfileDraft> {
  requireTTY(ctx);
  p.intro("open-coders config new");

  const agent = await promptAgent(flags.agent);
  const name = await promptProfileName(config, flags.name);
  const protocol =
    agent === "opencode" ? await promptProtocol(flags.protocol, undefined) : undefined;
  const chosen = await promptProvider(config, agent, flags, protocol);

  const pool = await promptModelPool(chosen.provider, agent, protocol, ctx);
  const { selected, defaultModel } = await promptModelSelection(pool, chosen.provider.models);
  const models = mergeModels(chosen.provider.models, selected);

  let roles: Partial<Record<ClaudeRole, string>> | undefined;
  let limits: Profile["limits"];
  if (agent === "claude") {
    roles = await promptRoles(selected, defaultModel);
    limits = await promptLimits(defaultModel);
  }

  const env = await promptEnv(undefined);

  const profile: Profile = {
    name,
    agent,
    provider: chosen.id,
    model: defaultModel.key,
    ...(protocol ? { protocol } : {}),
    ...(roles && Object.keys(roles).length > 0 ? { roles } : {}),
    ...(limits && Object.keys(limits).length > 0 ? { limits } : {}),
    ...(env && Object.keys(env).length > 0 ? { env } : {}),
  };

  const provider = { ...chosen.provider, models };

  p.note(summaryFor(profile, provider, defaultModel), "요약");
  if (!skipConfirm) {
    const confirmed = unwrap(await p.confirm({ message: "저장할까요?" }));
    if (!confirmed) throw new CancelledError();
  }

  p.outro(`profile "${name}" is ready`);
  return { profile, providerId: chosen.id, provider };
}

export async function updateProfileFlow(
  config: Config,
  name: string,
  ctx: CliContext,
): Promise<ProfileDraft> {
  requireTTY(ctx);
  const profile = config.profiles[name];
  if (!profile) throw new ConfigError(`unknown profile "${name}"`);
  const provider = config.providers[profile.provider];
  if (!provider)
    throw new ConfigError(`profile "${name}" references unknown provider "${profile.provider}"`);

  p.intro(`open-coders config update ${name}`);

  const field = unwrap(
    await p.select({
      message: "무엇을 수정할까요?",
      options: [
        { value: "model", label: "기본 모델" },
        ...(profile.agent === "claude"
          ? [
              { value: "roles", label: "role별 모델 (fable/opus/sonnet/haiku)" },
              { value: "limits", label: "컨텍스트/출력 한도" },
            ]
          : []),
        { value: "models", label: "모델 목록 다시 가져오기" },
        { value: "provider", label: "프로바이더 설정 (모든 프로파일에 영향)" },
        { value: "env", label: "추가 환경변수" },
      ],
    }),
  );

  if (field === "model") {
    const model = await promptModelKey(provider, profile.model, "기본 모델");
    profile.model = model.key;
  } else if (field === "roles") {
    const selected = provider.models;
    const defaultModel = findModel(provider, profile.model) ?? selected[0];
    if (!defaultModel) throw new ConfigError("provider has no models");
    profile.roles = await promptRoles(selected, defaultModel, profile.roles);
    if (Object.keys(profile.roles).length === 0) delete profile.roles;
  } else if (field === "limits") {
    const model = findModel(provider, profile.model) ?? provider.models[0];
    if (!model) throw new ConfigError("provider has no models");
    profile.limits = await promptLimits(model, profile.limits);
    if (Object.keys(profile.limits).length === 0) delete profile.limits;
  } else if (field === "models") {
    const protocol =
      profile.agent === "opencode" ? (profile.protocol ?? "openai-compatible") : "anthropic";
    const fetched = await promptModelPool(provider, profile.agent, protocol, ctx);
    const merged = mergeModels(provider.models, fetched);
    const selected = unwrap(
      await p.autocompleteMultiselect({
        message: "프로바이더에 저장할 모델",
        options: merged.map((model) => ({
          value: model.key,
          label: model.name ?? model.id,
          hint: model.id,
        })),
        initialValues: merged.map((model) => model.key),
        required: true,
        placeholder: "모델 이름 검색",
        maxItems: 12,
      }),
    );
    const selectedSet = new Set(selected);
    const kept = merged.filter((model) => selectedSet.has(model.key));
    if (!kept.some((model) => model.key === profile.model)) {
      throw new ConfigError(
        `cannot remove model "${profile.model}" while profile "${name}" uses it`,
      );
    }
    provider.models = kept;
    p.outro("models updated");
    return { profile, providerId: profile.provider, provider };
  } else if (field === "provider") {
    const affected = Object.entries(config.profiles)
      .filter(([, entry]) => entry.provider === profile.provider)
      .map(([entryName]) => entryName);
    p.note(`affected profiles: ${affected.join(", ")}`, "provider change");
    const updated = await promptProviderDetails(provider, profile.agent);
    provider.name = updated.name;
    provider.endpoints = updated.endpoints;
    provider.auth = updated.auth;
    p.outro("provider updated");
    return { profile, providerId: profile.provider, provider };
  } else if (field === "env") {
    const env = await promptEnv(profile.env);
    profile.env = env;
    if (Object.keys(profile.env).length === 0) delete profile.env;
  }

  p.outro("profile updated");
  return { profile, providerId: profile.provider };
}

async function promptAgent(initial?: string): Promise<AgentId> {
  const choice = unwrap(
    await p.select<AgentId>({
      message: "에이전트",
      options: [
        { value: "claude", label: "Claude Code", hint: "Anthropic-compatible gateway" },
        { value: "opencode", label: "OpenCode", hint: "Anthropic or OpenAI-compatible" },
        { value: "fx", label: "Vercel fx", hint: "Vercel AI Gateway only" },
      ],
      ...(isAgent(initial) ? { initialValue: initial } : {}),
    }),
  );
  return choice;
}

async function promptProfileName(config: Config, initial?: string): Promise<string> {
  return unwrap(
    await p.text({
      message: "프로파일 이름",
      placeholder: "예: om",
      ...(initial ? { initialValue: initial } : {}),
      validate(value) {
        if (!value) return "프로파일 이름을 입력하세요";
        if (RESERVED_PROFILE_NAMES.has(value)) return `"${value}" is reserved`;
        if (!PROFILE_NAME_PATTERN.test(value)) {
          return "영문/숫자로 시작하고 영문, 숫자, '.', '_', '-'만 사용할 수 있습니다";
        }
        if (config.profiles[value]) return `profile "${value}" already exists`;
        return undefined;
      },
    }),
  );
}

interface ProviderChoice {
  id: string;
  provider: Provider;
  created: boolean;
}

async function promptProvider(
  config: Config,
  agent: AgentId,
  flags: NewFlags,
  protocol: Protocol | undefined,
): Promise<ProviderChoice> {
  const compatible = Object.entries(config.providers).filter(([, provider]) =>
    isCompatible(agent, provider, protocol),
  );

  if (compatible.length > 0) {
    const choice = unwrap(
      await p.select({
        message: "프로바이더",
        options: [
          ...compatible.map(([id, provider]) => ({
            value: id,
            label: `${provider.name} (${id})`,
            hint: provider.kind,
          })),
          { value: "__new__", label: "+ 새 프로바이더 만들기" },
        ],
      }),
    );
    if (choice !== "__new__") {
      const provider = config.providers[choice];
      if (!provider) throw new ConfigError(`unknown provider "${choice}"`);
      return { id: choice, provider, created: false };
    }
  }

  const name = unwrap(
    await p.text({
      message: "새 프로바이더 이름",
      placeholder: "예: Lablup Continuum",
      validate: (value) => (value ? undefined : "이름을 입력하세요"),
    }),
  );
  const id = providerIdFromName(name, config);
  const provider = await promptNewProviderDetails(name, agent, flags, protocol);
  return { id, provider, created: true };
}

async function promptNewProviderDetails(
  name: string,
  agent: AgentId,
  flags: NewFlags,
  protocol: Protocol | undefined,
): Promise<Provider> {
  if (agent === "fx") {
    p.log.info("fx 0.0.5 can only use the Vercel AI Gateway. A custom base URL is not supported.");
    const auth = await promptAuth("fx");
    return { name, kind: "vercel-ai-gateway", auth, endpoints: {}, models: [] };
  }

  const endpoints: Provider["endpoints"] = {};
  if (agent === "claude") {
    endpoints.anthropic = unwrap(
      await p.text({
        message: "Anthropic 엔드포인트 (Claude Code 형식, /v1 없이)",
        placeholder: "https://api.example.com/anthropic",
        ...(flags.baseUrlAnthropic ? { initialValue: flags.baseUrlAnthropic } : {}),
        validate: validateUrl,
      }),
    );
    const openai = unwrap(
      await p.text({
        message: "OpenAI-compatible 엔드포인트 (선택, /v1 포함)",
        placeholder: "https://api.example.com/v1",
        ...(flags.baseUrlOpenai ? { initialValue: flags.baseUrlOpenai } : {}),
        validate: optionalUrl,
      }),
    );
    if (openai) endpoints.openaiCompatible = openai;
  } else {
    const selectedProtocol = protocol ?? (await promptProtocol(flags.protocol, undefined));
    const url = unwrap(
      await p.text({
        message:
          selectedProtocol === "anthropic"
            ? "Anthropic 엔드포인트 (Claude Code 형식, /v1 없이)"
            : "OpenAI-compatible 엔드포인트 (/v1 포함)",
        placeholder:
          selectedProtocol === "anthropic"
            ? "https://api.example.com/anthropic"
            : "https://api.example.com/v1",
        ...(selectedProtocol === "anthropic"
          ? flags.baseUrlAnthropic
            ? { initialValue: flags.baseUrlAnthropic }
            : {}
          : flags.baseUrlOpenai
            ? { initialValue: flags.baseUrlOpenai }
            : {}),
        validate: validateUrl,
      }),
    );
    if (selectedProtocol === "anthropic") endpoints.anthropic = url;
    else endpoints.openaiCompatible = url;
  }

  const auth = await promptAuth(agent, flags.apiKeyEnv);
  return { name, kind: "custom", auth, endpoints, models: [] };
}

async function promptProviderDetails(provider: Provider, agent: AgentId): Promise<Provider> {
  const name = unwrap(
    await p.text({
      message: "프로바이더 이름",
      initialValue: provider.name,
      validate: (value) => (value ? undefined : "이름을 입력하세요"),
    }),
  );

  if (provider.kind === "vercel-ai-gateway") {
    const auth = await promptAuth("fx");
    return { ...provider, name, auth };
  }

  const endpoints: Provider["endpoints"] = {};
  const anthropic = unwrap(
    await p.text({
      message: "Anthropic 엔드포인트 (선택, /v1 없이)",
      placeholder: "https://api.example.com/anthropic",
      ...(provider.endpoints.anthropic ? { initialValue: provider.endpoints.anthropic } : {}),
      validate: optionalUrl,
    }),
  );
  if (anthropic) endpoints.anthropic = anthropic;

  const openai = unwrap(
    await p.text({
      message: "OpenAI-compatible 엔드포인트 (선택, /v1 포함)",
      placeholder: "https://api.example.com/v1",
      ...(provider.endpoints.openaiCompatible
        ? { initialValue: provider.endpoints.openaiCompatible }
        : {}),
      validate: optionalUrl,
    }),
  );
  if (openai) endpoints.openaiCompatible = openai;
  if (!endpoints.anthropic && !endpoints.openaiCompatible) {
    throw new ConfigError("at least one endpoint is required");
  }

  const auth = await promptAuth(agent);
  return { ...provider, name, endpoints, auth };
}

async function promptAuth(agent: AgentId, envDefault?: string): Promise<Auth> {
  const style = unwrap(
    await p.select<"bearer" | "x-api-key" | "none">({
      message: "인증 방식",
      options: [
        {
          value: "bearer",
          label: "Authorization: Bearer",
          hint: "프록시 게이트웨이의 일반적인 방식",
        },
        { value: "x-api-key", label: "x-api-key", hint: "Anthropic 스타일 헤더" },
        { value: "none", label: "인증 없음", hint: "로컬 게이트웨이" },
      ],
    }),
  );

  if (style === "none") return { style: "none" };

  const source = unwrap(
    await p.select<"env" | "literal">({
      message: "키 저장 방식",
      options: [
        {
          value: "env",
          label: "환경변수 이름만 저장",
          hint: "권장. 키 값은 config에 남지 않습니다",
        },
        { value: "literal", label: "config에 직접 저장", hint: "파일 권한 0600, 평문 저장" },
      ],
    }),
  );

  if (source === "env") {
    const name = unwrap(
      await p.text({
        message: "환경변수 이름",
        placeholder: agent === "fx" ? "AI_GATEWAY_API_KEY" : "MY_GATEWAY_API_KEY",
        ...(envDefault ? { initialValue: envDefault } : {}),
        validate(value) {
          if (!value) return "환경변수 이름을 입력하세요";
          if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) return "올바른 환경변수 이름이 아닙니다";
          return undefined;
        },
      }),
    );
    const credential: Credential = { source: "env", name };
    return style === "bearer"
      ? { style: "bearer", credential }
      : { style: "x-api-key", credential };
  }

  const value = unwrap(
    await p.password({
      message: "API 키",
      validate: (input) => (input ? undefined : "키를 입력하세요"),
    }),
  );
  p.log.warn("키가 config.json에 평문으로 저장됩니다. 파일 권한을 0600으로 유지하세요.");
  const credential: Credential = { source: "literal", value };
  return style === "bearer" ? { style: "bearer", credential } : { style: "x-api-key", credential };
}

async function promptProtocol(
  initial: string | undefined,
  provider: Provider | undefined,
): Promise<Protocol> {
  const preferred = isProtocol(initial)
    ? initial
    : provider?.endpoints.openaiCompatible
      ? "openai-compatible"
      : "anthropic";
  return unwrap(
    await p.select<Protocol>({
      message: "OpenCode 프로토콜",
      options: [
        {
          value: "openai-compatible",
          label: "OpenAI-compatible",
          hint: "기본값. 대부분의 커스텀 게이트웨이",
        },
        {
          value: "anthropic",
          label: "Anthropic Messages",
          hint: "baseURL에 /v1을 붙여 전달합니다",
        },
      ],
      initialValue: preferred,
    }),
  );
}

async function promptModelPool(
  provider: Provider,
  agent: AgentId,
  protocol: Protocol | undefined,
  ctx: CliContext,
): Promise<Model[]> {
  const credential = lookupSecret(provider.auth, ctx.env).value;
  if (!credential && provider.auth.style !== "none") {
    p.log.warn("API 키를 찾지 못해 모델 목록을 인증 없이 요청합니다.");
  }

  const spinner = p.spinner();
  spinner.start("모델 목록을 가져오는 중");
  try {
    const protocolForFetch: Protocol =
      agent === "claude"
        ? "anthropic"
        : agent === "fx"
          ? "openai-compatible"
          : (protocol ?? "openai-compatible");
    const fetched = await fetchModels({
      provider,
      protocol: protocolForFetch,
      credential,
      fetchImpl: ctx.fetchImpl,
    });
    spinner.stop(`모델 ${fetched.length}개를 가져왔습니다`);
    return mergeModels(provider.models, fetched);
  } catch (error) {
    spinner.stop("모델 목록을 가져오지 못했습니다");
    p.log.warn(error instanceof Error ? error.message : String(error));
    const manual = unwrap(
      await p.text({
        message: "모델 ID를 쉼표로 구분해 입력하세요",
        placeholder: "model-a, model-b",
        validate: (value) => (value ? undefined : "모델 ID를 입력하세요"),
      }),
    );
    const ids = manual
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (ids.length === 0) throw new ConfigError("no models provided");
    const used = new Set(provider.models.map((model) => model.key));
    const models = ids.map<Model>((id) => ({ key: slugModelKey(id, used), id }));
    return mergeModels(provider.models, models);
  }
}

async function promptModelSelection(
  pool: Model[],
  existing: Model[],
): Promise<{ selected: Model[]; defaultModel: Model }> {
  if (pool.length === 0) throw new ConfigError("no models available");
  const firstModel = pool[0];
  if (!firstModel) throw new ConfigError("no models available");

  const existingKeys = existing.map((model) => model.key);
  const preselected = existingKeys.filter((key) => pool.some((model) => model.key === key));
  const initialValues = preselected.length > 0 ? preselected : [firstModel.key];

  let selectedKeys: string[];
  if (pool.length === 1) {
    selectedKeys = [firstModel.key];
  } else {
    selectedKeys = unwrap(
      await p.autocompleteMultiselect<string>({
        message: "저장할 모델을 선택하세요 (스페이스: 선택, 엔터: 확정)",
        options: pool.map((model) => ({
          value: model.key,
          label: model.name ?? model.id,
          hint: model.id,
        })),
        initialValues,
        required: true,
        placeholder: "모델 이름 검색",
        maxItems: 12,
      }),
    );
  }

  const selected = pool.filter((model) => selectedKeys.includes(model.key));
  const firstSelected = selected[0];
  if (!firstSelected) throw new ConfigError("at least one model must be selected");

  const defaultKey =
    selected.length === 1
      ? firstSelected.key
      : unwrap(
          await p.select<string>({
            message: "기본 모델",
            options: selected.map((model) => ({
              value: model.key,
              label: model.name ?? model.id,
            })),
            initialValue:
              initialValues.find((key) => selected.some((model) => model.key === key)) ??
              firstSelected.key,
          }),
        );

  const defaultModel = selected.find((model) => model.key === defaultKey) ?? firstSelected;
  return { selected, defaultModel };
}

async function promptModelKey(
  provider: Provider,
  current: string,
  message: string,
): Promise<Model> {
  if (provider.models.length === 0) throw new ConfigError("provider has no models");
  const key = unwrap(
    await p.select<string>({
      message,
      options: provider.models.map((model) => ({
        value: model.key,
        label: model.name ?? model.id,
        hint: model.id,
      })),
      initialValue: current,
    }),
  );
  const model = provider.models.find((entry) => entry.key === key);
  if (!model) throw new ConfigError(`unknown model "${key}"`);
  return model;
}

async function promptRoles(
  models: Model[],
  defaultModel: Model,
  existing?: Profile["roles"],
): Promise<Partial<Record<ClaudeRole, string>>> {
  const roles: Partial<Record<ClaudeRole, string>> = {};
  for (const role of CLAUDE_ROLES) {
    const current = existing?.[role] ?? "__default__";
    const choice = unwrap(
      await p.select<string>({
        message: `${role} 모델`,
        options: [
          {
            value: "__default__",
            label: "기본과 동일",
            hint: defaultModel.name ?? defaultModel.id,
          },
          ...models
            .filter((model) => model.key !== defaultModel.key)
            .map((model) => ({
              value: model.key,
              label: model.name ?? model.id,
              hint: model.id,
            })),
        ],
        initialValue: models.some((model) => model.key === current) ? current : "__default__",
      }),
    );
    if (choice !== "__default__") roles[role] = choice;
  }
  return roles;
}

async function promptLimits(
  model: Model,
  existing?: Profile["limits"],
): Promise<NonNullable<Profile["limits"]>> {
  const wanted = unwrap(
    await p.confirm({
      message: "컨텍스트/출력 한도를 설정할까요?",
      initialValue: Boolean(existing?.maxContextTokens || existing?.maxOutputTokens),
    }),
  );
  if (!wanted) return {};

  const limits: Profile["limits"] = {};
  const contextDefault = existing?.maxContextTokens ?? model.contextWindow;
  const outputDefault = existing?.maxOutputTokens ?? model.maxOutputTokens;

  const context = unwrap(
    await p.text({
      message: "최대 컨텍스트 토큰 (빈 값: 미설정)",
      placeholder: contextDefault ? String(contextDefault) : "예: 200000",
      defaultValue: contextDefault ? String(contextDefault) : "",
    }),
  );
  const contextNumber = parsePositiveInteger(context);
  if (contextNumber !== undefined) limits.maxContextTokens = contextNumber;

  const output = unwrap(
    await p.text({
      message: "최대 출력 토큰 (빈 값: 미설정)",
      placeholder: outputDefault ? String(outputDefault) : "예: 8192",
      defaultValue: outputDefault ? String(outputDefault) : "",
    }),
  );
  const outputNumber = parsePositiveInteger(output);
  if (outputNumber !== undefined) limits.maxOutputTokens = outputNumber;

  const disableCompact = unwrap(
    await p.confirm({
      message: "자동 압축을 끌까요? (DISABLE_COMPACT=1)",
      initialValue: existing?.disableCompact ?? false,
    }),
  );
  if (disableCompact) limits.disableCompact = true;

  return limits;
}

async function promptEnv(existing?: Record<string, string>): Promise<Record<string, string>> {
  const env: Record<string, string> = { ...(existing ?? {}) };
  if (existing && Object.keys(existing).length > 0) {
    p.log.info(
      `현재 값: ${Object.keys(existing)
        .map((key) => `${key}=...`)
        .join(", ")}`,
    );
  }

  while (true) {
    const line = unwrap(
      await p.text({
        message: "추가 환경변수 KEY=VALUE (빈 값이면 종료)",
        placeholder: "KEY=VALUE",
        defaultValue: "",
      }),
    );
    if (!line) break;
    const index = line.indexOf("=");
    if (index <= 0) {
      p.log.warn("KEY=VALUE 형식이 아닙니다");
      continue;
    }
    env[line.slice(0, index).trim()] = line.slice(index + 1);
  }
  return env;
}

function summaryFor(profile: Profile, provider: Provider, model: Model): string {
  const lines = [
    `profile: ${profile.name}`,
    `agent: ${profile.agent}`,
    `provider: ${provider.name} (${profile.provider})`,
    `model: ${model.name ?? model.id} (${model.id})`,
  ];
  if (profile.roles && Object.keys(profile.roles).length > 0) {
    lines.push(
      `roles: ${Object.entries(profile.roles)
        .map(([role, key]) => `${role}=${key}`)
        .join(", ")}`,
    );
  }
  if (profile.limits) lines.push(`limits: ${JSON.stringify(profile.limits)}`);
  if (profile.env) lines.push(`env: ${Object.keys(profile.env).join(", ")}`);
  return lines.join("\n");
}

function isCompatible(agent: AgentId, provider: Provider, protocol?: Protocol): boolean {
  if (agent === "claude")
    return provider.kind === "custom" && Boolean(provider.endpoints.anthropic);
  if (agent === "opencode") {
    if (provider.kind !== "custom") return false;
    const selected = protocol ?? "openai-compatible";
    return selected === "anthropic"
      ? Boolean(provider.endpoints.anthropic)
      : Boolean(provider.endpoints.openaiCompatible);
  }
  return provider.kind === "vercel-ai-gateway";
}

function isAgent(value: string | undefined): value is AgentId {
  return value === "claude" || value === "opencode" || value === "fx";
}

function isProtocol(value: string | undefined): value is Protocol {
  return value === "anthropic" || value === "openai-compatible";
}

function validateUrl(value: string | undefined): string | undefined {
  if (!value) return "URL을 입력하세요";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "http(s) URL이어야 합니다";
    return undefined;
  } catch {
    return "올바른 URL이 아닙니다";
  }
}

function optionalUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return validateUrl(value);
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return number > 0 ? number : undefined;
}

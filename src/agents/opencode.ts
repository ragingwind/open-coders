import type { Model } from "../config/schema";
import { ConfigError } from "../errors";
import type { LaunchInput, LaunchPlan } from "./types";

export function appendV1(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

export function planOpencode(input: LaunchInput): LaunchPlan {
  const { profile, provider, model, credential } = input;
  if (provider.kind !== "custom") {
    throw new ConfigError(`provider "${input.providerId}" is not a custom provider`);
  }

  const protocol = profile.protocol ?? "openai-compatible";
  const rawEndpoint =
    protocol === "anthropic" ? provider.endpoints.anthropic : provider.endpoints.openaiCompatible;
  if (!rawEndpoint) {
    throw new ConfigError(`provider "${input.providerId}" has no ${protocol} endpoint`);
  }

  const baseURL = protocol === "anthropic" ? appendV1(rawEndpoint) : rawEndpoint;
  const npm = protocol === "anthropic" ? "@ai-sdk/anthropic" : "@ai-sdk/openai-compatible";

  const options: Record<string, unknown> = { baseURL };
  const headers: Record<string, string> = {};

  if (provider.auth.style === "none") {
    // no credential
  } else {
    if (credential === undefined) {
      throw new ConfigError(`provider "${input.providerId}" needs an API key`);
    }
    if (provider.auth.style === "bearer") {
      if (protocol === "anthropic") headers.Authorization = `Bearer ${credential}`;
      else options.apiKey = credential;
    } else if (provider.auth.style === "x-api-key") {
      if (protocol === "anthropic") options.apiKey = credential;
      else headers["x-api-key"] = credential;
    }
  }
  if (Object.keys(headers).length > 0) options.headers = headers;

  const models = Object.fromEntries(
    provider.models.map((entry) => [entry.key, toOpencodeModel(entry)]),
  );

  const config = {
    $schema: "https://opencode.ai/config.json",
    provider: {
      [input.providerId]: {
        npm,
        name: provider.name,
        options,
        models,
      },
    },
    model: `${input.providerId}/${model.key}`,
  };

  return {
    command: "opencode",
    args: [
      "--model",
      `${input.providerId}/${model.key}`,
      ...(profile.args ?? []),
      ...input.userArgs,
    ],
    env: { OPENCODE_CONFIG_CONTENT: JSON.stringify(config) },
    unset: [],
  };
}

export function toOpencodeModel(model: Model): Record<string, unknown> {
  const entry: Record<string, unknown> = { id: model.id, name: model.name ?? model.id };
  if (model.contextWindow !== undefined && model.maxOutputTokens !== undefined) {
    entry.limit = { context: model.contextWindow, output: model.maxOutputTokens };
  }
  if (model.toolCall !== undefined) entry.tool_call = model.toolCall;
  if (model.reasoning !== undefined) entry.reasoning = model.reasoning;
  return entry;
}

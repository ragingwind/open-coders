import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Model, Protocol, Provider } from "../config/schema";
import { ConfigError } from "../errors";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_PAGES = 10;

export interface FetchModelsOptions {
  provider: Provider;
  protocol: Protocol;
  credential?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  execFx?: () => Promise<string>;
}

interface ModelEntry {
  id: string;
  name?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
}

class NotFound extends Error {}

export async function fetchModels(options: FetchModelsOptions): Promise<Model[]> {
  if (options.provider.kind === "vercel-ai-gateway") {
    return fetchFxModels(options.execFx);
  }

  const { provider } = options;
  const preferred = options.protocol;
  const secondary: Protocol = preferred === "anthropic" ? "openai-compatible" : "anthropic";
  const candidates = [
    {
      protocol: preferred,
      endpoint:
        preferred === "anthropic"
          ? provider.endpoints.anthropic
          : provider.endpoints.openaiCompatible,
    },
    {
      protocol: secondary,
      endpoint:
        secondary === "anthropic"
          ? provider.endpoints.anthropic
          : provider.endpoints.openaiCompatible,
    },
  ].filter(
    (candidate): candidate is { protocol: Protocol; endpoint: string } =>
      candidate.endpoint !== undefined,
  );

  if (candidates.length === 0) {
    throw new ConfigError("provider has no endpoint to list models from");
  }
  if (provider.modelsUrl) candidates.length = 1;

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tried = new Set<string>();
  const errors: string[] = [];

  for (const candidate of candidates) {
    const urls = modelUrls(provider, candidate.endpoint, candidate.protocol);
    const headers = requestHeaders(options.credential, provider, candidate.protocol);

    for (const url of urls) {
      if (tried.has(url)) continue;
      tried.add(url);
      try {
        const entries =
          candidate.protocol === "anthropic"
            ? await fetchAnthropicEntries(url, headers, fetchImpl, timeoutMs)
            : await fetchOne(url, headers, fetchImpl, timeoutMs);
        const models = toModels(entries);
        if (models.length > 0) return models;
        errors.push(`${url}: empty model list`);
      } catch (error) {
        if (error instanceof NotFound) continue;
        errors.push(sanitize(errorMessage(error), options.credential));
      }
    }
  }

  throw new ConfigError(
    `cannot list models; tried ${[...tried].join(", ")}\n${errors.join("\n")}\nCheck the endpoint URL: the Anthropic base usually has no /v1, and the OpenAI-compatible base usually ends with /v1.`,
  );
}

function modelUrls(provider: Provider, endpoint: string, protocol: Protocol): string[] {
  if (provider.modelsUrl) return [provider.modelsUrl];
  const base = endpoint.replace(/\/+$/, "");
  const hasVersionSegment = /\/v1(?:\/|$)/.test(base);

  if (protocol === "anthropic") {
    return hasVersionSegment ? [`${base}/models`] : [`${base}/v1/models`, `${base}/models`];
  }
  return hasVersionSegment ? [`${base}/models`] : [`${base}/models`, `${base}/v1/models`];
}

function requestHeaders(
  credential: string | undefined,
  provider: Provider,
  protocol: Protocol,
): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (credential) {
    if (provider.auth.style === "x-api-key") headers["x-api-key"] = credential;
    else headers.authorization = `Bearer ${credential}`;
  }
  if (protocol === "anthropic") headers["anthropic-version"] = "2023-06-01";
  return headers;
}

async function fetchOne(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ModelEntry[]> {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (response.status === 404 || response.status === 405) throw new NotFound();
  if (!response.ok) throw await httpError(url, response, headers.authorization);
  return extractEntries(await response.json());
}

async function fetchAnthropicEntries(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<ModelEntry[]> {
  const entries: ModelEntry[] = [];
  let next: string | undefined = url;

  for (let page = 0; page < MAX_PAGES && next; page++) {
    const current: string = next;
    const response = await fetchImpl(current, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status === 404 || response.status === 405) throw new NotFound();
    if (!response.ok) throw await httpError(current, response, headers.authorization);

    const json: unknown = await response.json();
    entries.push(...extractEntries(json));

    if (isRecord(json) && json.has_more === true && typeof json.last_id === "string") {
      const nextUrl = new URL(url);
      nextUrl.searchParams.set("after_id", json.last_id);
      nextUrl.searchParams.set("limit", "1000");
      next = nextUrl.toString();
    } else {
      next = undefined;
    }
  }

  return entries;
}

async function httpError(
  url: string,
  response: Response,
  authorization?: string,
): Promise<ConfigError> {
  let body = "";
  try {
    body = (await response.text()).slice(0, 200).trim();
  } catch {
    // ignore
  }
  const secret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : undefined;
  const details = sanitize(body, secret);
  return new ConfigError(`${url}: HTTP ${response.status}${details ? `: ${details}` : ""}`);
}

function extractEntries(json: unknown): ModelEntry[] {
  if (Array.isArray(json)) return json.flatMap(toEntry);
  if (!isRecord(json)) return [];
  const list = json.data ?? json.models ?? json.ids;
  return Array.isArray(list) ? list.flatMap(toEntry) : [];
}

function toEntry(value: unknown): ModelEntry[] {
  if (typeof value === "string") return [{ id: value }];
  if (!isRecord(value)) return [];

  const id =
    typeof value.id === "string"
      ? value.id
      : typeof value.name === "string"
        ? value.name
        : undefined;
  if (!id) return [];

  const entry: ModelEntry = { id };
  const name = value.display_name ?? value.label;
  if (typeof name === "string" && name !== id) entry.name = name;

  const contextWindow = numberValue(
    value.context_window ?? value.context_length ?? value.input_token_limit,
  );
  if (contextWindow !== undefined) entry.contextWindow = contextWindow;

  const maxOutputTokens = numberValue(value.max_output_tokens ?? value.output_token_limit);
  if (maxOutputTokens !== undefined) entry.maxOutputTokens = maxOutputTokens;

  return [entry];
}

function toModels(entries: ModelEntry[]): Model[] {
  const seen = new Set<string>();
  const usedKeys = new Set<string>();
  const models: Model[] = [];
  for (const entry of entries) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const model: Model = { key: slugModelKey(entry.id, usedKeys), id: entry.id };
    if (entry.name) model.name = entry.name;
    if (entry.contextWindow !== undefined) model.contextWindow = entry.contextWindow;
    if (entry.maxOutputTokens !== undefined) model.maxOutputTokens = entry.maxOutputTokens;
    models.push(model);
  }
  return models;
}

export function slugModelKey(id: string, used: Set<string> = new Set()): string {
  let base = id
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/[^a-z0-9]+$/, "");
  if (!base) base = "model";

  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

async function fetchFxModels(execFx?: () => Promise<string>): Promise<Model[]> {
  let stdout: string;
  try {
    stdout = execFx
      ? await execFx()
      : String(
          (
            await execFileAsync("fx", ["models", "--json"], {
              timeout: 15_000,
              maxBuffer: 16 * 1024 * 1024,
            })
          ).stdout,
        );
  } catch (error) {
    throw new ConfigError(`cannot run "fx models --json": ${errorMessage(error)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(stdout);
  } catch (error) {
    throw new ConfigError(`fx models returned invalid JSON: ${errorMessage(error)}`);
  }

  const ids = isRecord(json) && Array.isArray(json.ids) ? json.ids : [];
  const entries = ids.flatMap(toEntry);
  const models = toModels(entries);
  if (models.length === 0) {
    throw new ConfigError("fx models returned no model ids");
  }
  return models;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.trunc(value);
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitize(text: string, secret: string | undefined): string {
  if (!secret) return text;
  return text.split(secret).join("***");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { afterEach, describe, expect, test } from "bun:test";
import { ConfigError } from "../src/errors";
import { fetchModels, slugModelKey } from "../src/providers/fetch-models";
import { makeProvider } from "./helpers";

const servers: Array<{ stop(force?: boolean): void }> = [];

afterEach(() => {
  for (const server of servers.splice(0)) server.stop(true);
});

async function serve(handler: (request: Request) => Response | Promise<Response>): Promise<string> {
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: handler });
  servers.push(server);
  return `http://127.0.0.1:${server.port}`;
}

describe("slugModelKey", () => {
  test("lowercases and replaces punctuation", () => {
    expect(slugModelKey("zai-org/GLM-5.3")).toBe("zai-org-glm-5.3");
  });

  test("deduplicates with a numeric suffix", () => {
    const used = new Set<string>();
    expect(slugModelKey("a/b", used)).toBe("a-b");
    expect(slugModelKey("a/b", used)).toBe("a-b-2");
  });

  test("handles an id with no usable characters", () => {
    expect(slugModelKey("한글")).toBe("model");
  });
});

describe("fetchModels", () => {
  test("reads an OpenAI-compatible model list", async () => {
    let authorization = "";
    const base = await serve((request) => {
      authorization = request.headers.get("authorization") ?? "";
      return Response.json({ data: [{ id: "alpha" }, { id: "beta" }] });
    });
    const provider = makeProvider({ endpoints: { openaiCompatible: `${base}/v1` }, models: [] });

    const models = await fetchModels({
      provider,
      protocol: "openai-compatible",
      credential: "secret",
    });

    expect(models.map((model) => model.id)).toEqual(["alpha", "beta"]);
    expect(models.map((model) => model.key)).toEqual(["alpha", "beta"]);
    expect(authorization).toBe("Bearer secret");
  });

  test("falls back to /v1/models when the base URL has no /v1", async () => {
    const paths: string[] = [];
    const base = await serve((request) => {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === "/models") return new Response("not found", { status: 404 });
      return Response.json({ data: [{ id: "x" }] });
    });
    const provider = makeProvider({ endpoints: { openaiCompatible: base }, models: [] });

    const models = await fetchModels({ provider, protocol: "openai-compatible" });

    expect(models.map((model) => model.id)).toEqual(["x"]);
    expect(paths).toEqual(["/models", "/v1/models"]);
  });

  test("follows Anthropic pagination and sends anthropic-version", async () => {
    const versions: Array<string | null> = [];
    const base = await serve((request) => {
      versions.push(request.headers.get("anthropic-version"));
      const url = new URL(request.url);
      if (!url.searchParams.has("after_id")) {
        return Response.json({
          data: [{ id: "a", display_name: "Alpha" }],
          has_more: true,
          last_id: "a",
        });
      }
      return Response.json({ data: [{ id: "b" }], has_more: false });
    });
    const provider = makeProvider({ endpoints: { anthropic: base }, models: [] });

    const models = await fetchModels({ provider, protocol: "anthropic", credential: "secret" });

    expect(models.map((model) => model.id)).toEqual(["a", "b"]);
    expect(models[0]?.name).toBe("Alpha");
    expect(versions).toEqual(["2023-06-01", "2023-06-01"]);
  });

  test("does not double /v1 for an OpenAI-compatible endpoint that already has it", async () => {
    const paths: string[] = [];
    const base = await serve((request) => {
      paths.push(new URL(request.url).pathname);
      return Response.json({ data: [{ id: "x" }] });
    });
    const provider = makeProvider({ endpoints: { openaiCompatible: `${base}/v1` }, models: [] });

    await fetchModels({ provider, protocol: "openai-compatible" });

    expect(paths).toEqual(["/v1/models"]);
  });

  test("does not add another /v1 when the Anthropic endpoint already has a v1 segment", async () => {
    const paths: string[] = [];
    const base = await serve((request) => {
      paths.push(new URL(request.url).pathname);
      return Response.json({ data: [{ id: "x" }] });
    });
    const provider = makeProvider({ endpoints: { anthropic: `${base}/v1/anthropic` }, models: [] });

    await fetchModels({ provider, protocol: "anthropic" });

    expect(paths).toEqual(["/v1/anthropic/models"]);
  });

  test("uses /models when the Anthropic endpoint ends in /v1", async () => {
    const paths: string[] = [];
    const base = await serve((request) => {
      paths.push(new URL(request.url).pathname);
      return Response.json({ data: [{ id: "x" }] });
    });
    const provider = makeProvider({
      endpoints: { anthropic: `${base}/anthropic/v1` },
      models: [],
    });

    await fetchModels({ provider, protocol: "anthropic" });

    expect(paths).toEqual(["/anthropic/v1/models"]);
  });

  test("falls back to the other endpoint when the preferred one is missing", async () => {
    const paths: string[] = [];
    const base = await serve((request) => {
      paths.push(new URL(request.url).pathname);
      return Response.json({ data: [{ id: "x" }] });
    });
    const provider = makeProvider({ endpoints: { openaiCompatible: `${base}/v1` }, models: [] });

    const models = await fetchModels({ provider, protocol: "anthropic" });

    expect(models.map((model) => model.id)).toEqual(["x"]);
    expect(paths).toEqual(["/v1/models"]);
  });

  test("rejects a provider without any endpoint", async () => {
    const provider = makeProvider({ endpoints: {}, models: [] });
    await expect(fetchModels({ provider, protocol: "openai-compatible" })).rejects.toThrow(
      /no endpoint/,
    );
  });
  test("uses an x-api-key header when configured", async () => {
    let key = "";
    const base = await serve((request) => {
      key = request.headers.get("x-api-key") ?? "";
      return Response.json({ data: [{ id: "x" }] });
    });
    const provider = makeProvider({
      endpoints: { anthropic: base },
      auth: { style: "x-api-key", credential: { source: "env", name: "GW_KEY" } },
      models: [],
    });

    await fetchModels({ provider, protocol: "anthropic", credential: "secret" });
    expect(key).toBe("secret");
  });

  test("reports an HTTP error without leaking the credential", async () => {
    const secret = "super-secret-value";
    const base = await serve(() => new Response(`bad key ${secret}`, { status: 401 }));
    const provider = makeProvider({ endpoints: { openaiCompatible: base }, models: [] });

    let message = "";
    try {
      await fetchModels({ provider, protocol: "openai-compatible", credential: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("HTTP 401");
    expect(message).not.toContain(secret);
  });

  test("times out", async () => {
    const base = await serve(async () => {
      await Bun.sleep(200);
      return Response.json({ data: [] });
    });
    const provider = makeProvider({ endpoints: { openaiCompatible: base }, models: [] });

    await expect(
      fetchModels({ provider, protocol: "openai-compatible", timeoutMs: 10 }),
    ).rejects.toThrow(ConfigError);
  });

  test("reads models from fx models --json", async () => {
    const provider = makeProvider({
      kind: "vercel-ai-gateway",
      endpoints: {},
      models: [],
    });

    const models = await fetchModels({
      provider,
      protocol: "openai-compatible",
      execFx: async () => JSON.stringify({ kind: "models", ids: ["a/1", "b/2"] }),
    });

    expect(models.map((model) => model.id)).toEqual(["a/1", "b/2"]);
    expect(models.map((model) => model.key)).toEqual(["a-1", "b-2"]);
  });

  test("reports invalid fx output", async () => {
    const provider = makeProvider({ kind: "vercel-ai-gateway", endpoints: {}, models: [] });
    await expect(
      fetchModels({
        provider,
        protocol: "openai-compatible",
        execFx: async () => "not json",
      }),
    ).rejects.toThrow(/invalid JSON/);
  });
});

import { describe, expect, test } from "bun:test";
import { appendV1, planOpencode, toOpencodeModel } from "../src/agents/opencode";
import { launchInput, makeProvider, model } from "./helpers";

interface OpencodeConfig {
  provider: Record<
    string,
    {
      npm: string;
      name: string;
      options: { baseURL?: string; apiKey?: string; headers?: Record<string, string> };
      models: Record<
        string,
        {
          id?: string;
          name?: string;
          limit?: { context: number; output: number };
          tool_call?: boolean;
          reasoning?: boolean;
        }
      >;
    }
  >;
  model: string;
}

function configOf(plan: ReturnType<typeof planOpencode>): OpencodeConfig {
  return JSON.parse(plan.env.OPENCODE_CONFIG_CONTENT ?? "{}") as OpencodeConfig;
}

describe("appendV1", () => {
  test("appends /v1 once", () => {
    expect(appendV1("https://gw.example.com/anthropic")).toBe(
      "https://gw.example.com/anthropic/v1",
    );
    expect(appendV1("https://gw.example.com/anthropic/")).toBe(
      "https://gw.example.com/anthropic/v1",
    );
    expect(appendV1("https://gw.example.com/anthropic/v1")).toBe(
      "https://gw.example.com/anthropic/v1",
    );
  });
});

describe("planOpencode", () => {
  test("builds an OpenAI-compatible provider and model reference", () => {
    const plan = planOpencode(
      launchInput({ profile: { ...launchInput().profile, agent: "opencode" } }),
    );
    const config = configOf(plan);
    const provider = config.provider.gw;

    expect(plan.command).toBe("opencode");
    expect(plan.args).toEqual(["--model", "gw/m1"]);
    expect(provider?.npm).toBe("@ai-sdk/openai-compatible");
    expect(provider?.options.baseURL).toBe("https://gw.example.com/v1");
    expect(provider?.options.apiKey).toBe("secret-key-1234");
    expect(provider?.models.m1).toEqual({ id: "model-1", name: "model-1" });
    expect(config.model).toBe("gw/m1");
  });

  test("uses the anthropic SDK and appends /v1 for the anthropic protocol", () => {
    const plan = planOpencode({
      ...launchInput(),
      profile: { ...launchInput().profile, agent: "opencode", protocol: "anthropic" },
    });
    const provider = configOf(plan).provider.gw;
    expect(provider?.npm).toBe("@ai-sdk/anthropic");
    expect(provider?.options.baseURL).toBe("https://gw.example.com/anthropic/v1");
    expect(provider?.options.headers).toEqual({ Authorization: "Bearer secret-key-1234" });
  });

  test("sends x-api-key as a header for OpenAI-compatible providers", () => {
    const provider = makeProvider({
      auth: { style: "x-api-key", credential: { source: "env", name: "GW_KEY" } },
    });
    const plan = planOpencode({
      ...launchInput({ provider }),
      profile: { ...launchInput().profile, agent: "opencode" },
    });
    const options = configOf(plan).provider.gw?.options;
    expect(options?.headers).toEqual({ "x-api-key": "secret-key-1234" });
    expect(options?.apiKey).toBeUndefined();
  });

  test("sends a bearer header for the anthropic protocol", () => {
    const plan = planOpencode({
      ...launchInput(),
      profile: { ...launchInput().profile, agent: "opencode", protocol: "anthropic" },
    });
    expect(configOf(plan).provider.gw?.options.headers).toEqual({
      Authorization: "Bearer secret-key-1234",
    });
    expect(configOf(plan).provider.gw?.options.apiKey).toBeUndefined();
  });

  test("omits the api key when auth is none", () => {
    const provider = makeProvider({ auth: { style: "none" } });
    const plan = planOpencode({
      ...launchInput({ provider, credential: undefined }),
      profile: { ...launchInput().profile, agent: "opencode" },
    });
    expect(configOf(plan).provider.gw?.options.apiKey).toBeUndefined();
  });

  test("writes model limits, tool_call and reasoning when present", () => {
    const provider = makeProvider({
      models: [
        {
          key: "m1",
          id: "model-1",
          contextWindow: 1000,
          maxOutputTokens: 100,
          toolCall: true,
          reasoning: false,
        },
      ],
    });
    const plan = planOpencode({
      ...launchInput({ provider }),
      profile: { ...launchInput().profile, agent: "opencode" },
    });
    expect(configOf(plan).provider.gw?.models.m1).toEqual({
      id: "model-1",
      name: "model-1",
      limit: { context: 1000, output: 100 },
      tool_call: true,
      reasoning: false,
    });
  });

  test("rejects a missing protocol endpoint", () => {
    const provider = makeProvider({ endpoints: { anthropic: "https://gw.example.com/anthropic" } });
    expect(() =>
      planOpencode({
        ...launchInput({ provider }),
        profile: { ...launchInput().profile, agent: "opencode" },
      }),
    ).toThrow(/openai-compatible endpoint/);
  });

  test("toOpencodeModel omits a partial limit", () => {
    expect(toOpencodeModel(model("m1", "model-1"))).toEqual({ id: "model-1", name: "model-1" });
  });
});

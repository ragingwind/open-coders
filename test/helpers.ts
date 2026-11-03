import type { LaunchInput } from "../src/agents/types";
import type { Config, Model, Profile, Provider } from "../src/config/schema";

export function model(key: string, id = key): Model {
  return { key, id };
}

export function makeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    name: "GW",
    kind: "custom",
    auth: { style: "bearer", credential: { source: "env", name: "GW_KEY" } },
    endpoints: {
      anthropic: "https://gw.example.com/anthropic",
      openaiCompatible: "https://gw.example.com/v1",
    },
    models: [model("m1", "model-1"), model("m2", "model-2")],
    ...overrides,
  };
}

export function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    name: "om",
    agent: "claude",
    provider: "gw",
    model: "m1",
    ...overrides,
  };
}

export function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    version: 1,
    providers: {
      gw: makeProvider(),
      fxgw: {
        name: "FX",
        kind: "vercel-ai-gateway",
        auth: { style: "none" },
        endpoints: {},
        models: [model("fx1", "anthropic/claude-sonnet-5.5")],
      },
    },
    profiles: {
      om: makeProfile(),
      oc: makeProfile({ name: "oc", agent: "opencode", protocol: "openai-compatible" }),
      f: makeProfile({ name: "f", agent: "fx", provider: "fxgw", model: "fx1" }),
    },
    ...overrides,
  };
}

export function launchInput(overrides: Partial<LaunchInput> = {}): LaunchInput {
  const provider = makeProvider();
  return {
    profile: makeProfile(),
    provider,
    providerId: "gw",
    model: provider.models[0] ?? model("m1", "model-1"),
    roleModels: {},
    credential: "secret-key-1234",
    userArgs: [],
    ...overrides,
  };
}

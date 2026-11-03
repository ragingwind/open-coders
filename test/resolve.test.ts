import { describe, expect, test } from "bun:test";
import { assertCompatible, findModel, lookupSecret, resolveProfile } from "../src/config/resolve";
import { ConfigError } from "../src/errors";
import { makeConfig, makeProfile, makeProvider } from "./helpers";

describe("lookupSecret", () => {
  test("reads an env credential", () => {
    const result = lookupSecret(
      { style: "bearer", credential: { source: "env", name: "GW_KEY" } },
      { GW_KEY: "abc" },
    );
    expect(result).toEqual({ value: "abc" });
  });

  test("reports a missing env credential", () => {
    const result = lookupSecret(
      { style: "bearer", credential: { source: "env", name: "GW_KEY" } },
      {},
    );
    expect(result.error).toBe("environment variable GW_KEY is not set");
  });

  test("reads a literal credential", () => {
    const result = lookupSecret(
      { style: "x-api-key", credential: { source: "literal", value: "abc" } },
      {},
    );
    expect(result).toEqual({ value: "abc" });
  });

  test("returns nothing for no auth", () => {
    expect(lookupSecret({ style: "none" }, {})).toEqual({});
  });
});

describe("findModel", () => {
  const provider = makeProvider();

  test("finds by key and by id", () => {
    expect(findModel(provider, "m1")?.id).toBe("model-1");
    expect(findModel(provider, "model-2")?.key).toBe("m2");
  });

  test("returns undefined when missing", () => {
    expect(findModel(provider, "missing")).toBeUndefined();
  });
});

describe("resolveProfile", () => {
  test("resolves the default and role models", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ roles: { opus: "m2", haiku: "model-1" } });
    const resolved = resolveProfile(config, "om", { env: { GW_KEY: "k" } });
    expect(resolved.model.key).toBe("m1");
    expect(resolved.roleModels.opus?.id).toBe("model-2");
    expect(resolved.roleModels.haiku?.id).toBe("model-1");
    expect(resolved.credential).toBe("k");
  });

  test("lists available profiles for an unknown name", () => {
    expect(() => resolveProfile(makeConfig(), "missing", { env: {} })).toThrow(
      /Available profiles: f, oc, om/,
    );
  });

  test("reports an unknown provider", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ provider: "missing" });
    expect(() => resolveProfile(config, "om", { env: {} })).toThrow(/unknown provider "missing"/);
  });

  test("reports an unknown model", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ model: "missing" });
    expect(() => resolveProfile(config, "om", { env: {} })).toThrow(/unknown model "missing"/);
  });

  test("reports an unknown role model", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ roles: { fable: "missing" } });
    expect(() => resolveProfile(config, "om", { env: {} })).toThrow(
      /role fable to unknown model "missing"/,
    );
  });

  test("requires a credential by default", () => {
    expect(() => resolveProfile(makeConfig(), "om", { env: {} })).toThrow(/GW_KEY is not set/);
  });

  test("can skip the credential check", () => {
    const resolved = resolveProfile(makeConfig(), "om", {
      env: {},
      requireCredential: false,
    });
    expect(resolved.credential).toBeUndefined();
  });
});

describe("assertCompatible", () => {
  test("accepts claude with an anthropic endpoint", () => {
    expect(() => assertCompatible(makeProfile(), makeProvider())).not.toThrow();
  });

  test("rejects claude without an anthropic endpoint", () => {
    const provider = makeProvider({ endpoints: { openaiCompatible: "https://gw.example.com/v1" } });
    expect(() => assertCompatible(makeProfile(), provider)).toThrow(/anthropic endpoint/);
  });

  test("accepts opencode with the selected protocol endpoint", () => {
    const profile = makeProfile({ agent: "opencode", protocol: "anthropic" });
    expect(() => assertCompatible(profile, makeProvider())).not.toThrow();
  });

  test("rejects opencode with a missing protocol endpoint", () => {
    const profile = makeProfile({ agent: "opencode", protocol: "openai-compatible" });
    const provider = makeProvider({ endpoints: { anthropic: "https://gw.example.com/anthropic" } });
    expect(() => assertCompatible(profile, provider)).toThrow(/openai-compatible endpoint/);
  });

  test("rejects fx with a custom provider", () => {
    const profile = makeProfile({ agent: "fx" });
    expect(() => assertCompatible(profile, makeProvider())).toThrow(/vercel-ai-gateway/);
  });

  test("rejects a non-custom provider for claude", () => {
    const provider = makeProvider({ kind: "vercel-ai-gateway", endpoints: {} });
    expect(() => assertCompatible(makeProfile(), provider)).toThrow(ConfigError);
  });
});

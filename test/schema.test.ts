import { describe, expect, test } from "bun:test";
import { type Config, emptyConfig, parseConfig, validateConfig } from "../src/config/schema";
import { makeConfig, makeProfile, makeProvider } from "./helpers";

describe("parseConfig", () => {
  test("accepts a complete config", () => {
    const parsed = parseConfig(makeConfig());
    expect(parsed.profiles.om?.model).toBe("m1");
    expect(parsed.providers.gw?.kind).toBe("custom");
  });

  test("rejects an unsupported version", () => {
    expect(() => parseConfig({ ...makeConfig(), version: 2 })).toThrow(/version/);
  });

  test("rejects missing top-level keys", () => {
    expect(() => parseConfig({ version: 1 })).toThrow(/providers/);
  });

  test("rejects unknown keys", () => {
    const raw = { ...makeConfig(), extra: true };
    expect(() => parseConfig(raw)).toThrow(/Unrecognized key/);
  });

  test("rejects an invalid URL", () => {
    const config = makeConfig();
    config.providers.gw = makeProvider({ endpoints: { anthropic: "not-a-url" } });
    expect(() => parseConfig(config)).toThrow(/Invalid URL/);
  });
});

describe("validateConfig", () => {
  test("returns no problems for a valid config", () => {
    expect(validateConfig(makeConfig())).toEqual([]);
  });

  test("reports a profile whose name does not match its key", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ name: "other" });
    expect(validateConfig(config).map((problem) => problem.path)).toContain("profiles.om.name");
  });

  test("reports an unknown provider", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ provider: "missing" });
    expect(validateConfig(config).map((problem) => problem.message)).toContain(
      'unknown provider "missing"',
    );
  });

  test("reports an unknown model key", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ model: "missing" });
    expect(validateConfig(config).map((problem) => problem.path)).toContain("profiles.om.model");
  });

  test("reports an unknown role model key", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ roles: { haiku: "missing" } });
    expect(validateConfig(config).map((problem) => problem.path)).toContain(
      "profiles.om.roles.haiku",
    );
  });

  test("reports duplicate model keys", () => {
    const config = makeConfig();
    config.providers.gw = makeProvider({
      models: [
        { key: "m1", id: "a" },
        { key: "m1", id: "b" },
      ],
    });
    expect(validateConfig(config).map((problem) => problem.message)).toContain(
      'duplicate model key "m1"',
    );
  });

  test("reports a custom provider without endpoints", () => {
    const config = makeConfig();
    config.providers.gw = makeProvider({ endpoints: {} });
    config.profiles = { om: makeProfile({ agent: "opencode", protocol: "openai-compatible" }) };
    expect(validateConfig(config).map((problem) => problem.path)).toContain(
      "providers.gw.endpoints",
    );
  });

  test("reports claude with a non-custom provider", () => {
    const config = makeConfig();
    config.profiles.om = makeProfile({ provider: "fxgw" });
    expect(validateConfig(config).map((problem) => problem.message)).toContain(
      "claude requires a custom provider with an anthropic endpoint",
    );
  });

  test("reports fx with a custom provider", () => {
    const config = makeConfig();
    config.profiles.f = makeProfile({ name: "f", agent: "fx", provider: "gw", model: "m1" });
    expect(validateConfig(config).map((problem) => problem.message)).toContain(
      "fx requires a vercel-ai-gateway provider",
    );
  });

  test("emptyConfig is valid", () => {
    const config: Config = emptyConfig();
    expect(validateConfig(config)).toEqual([]);
  });
});

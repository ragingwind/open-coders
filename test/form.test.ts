import { describe, expect, test } from "bun:test";
import { emptyConfig } from "../src/config/schema";
import {
  mergeModels,
  modelFamily,
  providerIdFromName,
  roleAlternatives,
  suggestProfileName,
} from "../src/tui/config-form";
import { makeProvider, model } from "./helpers";

describe("providerIdFromName", () => {
  test("slugifies a display name", () => {
    expect(providerIdFromName("Lablup Continuum", emptyConfig())).toBe("lablup-continuum");
  });

  test("adds a suffix when the id is taken", () => {
    const config = emptyConfig();
    config.providers["lablup-continuum"] = makeProvider();
    expect(providerIdFromName("Lablup Continuum", config)).toBe("lablup-continuum-2");
  });

  test("handles non-latin names", () => {
    expect(providerIdFromName("래럽", emptyConfig())).toBe("p");
  });

  test("handles names with only punctuation", () => {
    expect(providerIdFromName("!!!", emptyConfig())).toBe("p");
  });
});

describe("mergeModels", () => {
  test("keeps existing models and adds new ones", () => {
    const merged = mergeModels([model("m1", "a")], [model("x", "b")]);
    expect(merged.map((entry) => entry.key)).toEqual(["m1", "x"]);
  });

  test("does not duplicate an id that already exists", () => {
    const merged = mergeModels([model("m1", "a")], [model("other", "a")]);
    expect(merged.map((entry) => entry.key)).toEqual(["m1"]);
  });

  test("renames a key collision", () => {
    const merged = mergeModels([model("m1", "a")], [model("m1", "b")]);
    expect(merged.map((entry) => entry.key)).toEqual(["m1", "m1-2"]);
    expect(merged[1]?.id).toBe("b");
  });
});

describe("roleAlternatives", () => {
  test("offers every model except the default", () => {
    const first = model("m1", "a");
    const second = model("m2", "b");
    expect(roleAlternatives([first, second], first).map((entry) => entry.key)).toEqual(["m2"]);
  });

  test("returns nothing when the default is the only model", () => {
    const only = model("m1", "a");
    expect(roleAlternatives([only], only)).toEqual([]);
  });
});

describe("suggestProfileName", () => {
  test("uses the agent first", () => {
    expect(suggestProfileName({ agent: "claude", providerId: "continuum", existing: [] })).toEqual({
      name: "claude",
      basis: "agent",
    });
  });

  test("adds the provider when the agent name is taken", () => {
    expect(
      suggestProfileName({ agent: "claude", providerId: "continuum", existing: ["claude"] }),
    ).toEqual({ name: "claude-continuum", basis: "agent + provider" });
  });

  test("adds the model family when agent and provider names are taken", () => {
    expect(
      suggestProfileName({
        agent: "claude",
        providerId: "continuum",
        modelId: "DeepSeek-V4.1-Flash-B300",
        existing: ["claude", "claude-continuum"],
      }),
    ).toEqual({
      name: "claude-continuum-deepseek",
      basis: "agent + provider + model family",
    });
  });

  test("skips a model family that repeats the agent", () => {
    expect(
      suggestProfileName({
        agent: "claude",
        providerId: "continuum",
        modelId: "anthropic/claude-sonnet-5.5",
        existing: ["claude", "claude-continuum"],
      }),
    ).toEqual({ name: "claude-continuum-2", basis: "agent + provider + numeric suffix" });
  });

  test("appends a numeric suffix when every tier is taken", () => {
    expect(
      suggestProfileName({
        agent: "opencode",
        providerId: "gw",
        modelId: "glm-5",
        existing: ["opencode", "opencode-gw", "opencode-gw-glm"],
      }),
    ).toEqual({
      name: "opencode-gw-glm-2",
      basis: "agent + provider + model family + numeric suffix",
    });
  });
});

describe("modelFamily", () => {
  test("takes the first meaningful token of the last path segment", () => {
    expect(modelFamily("zai-org/GLM-5.3-Flash")).toBe("glm");
    expect(modelFamily("DeepSeek-V4.1-Flash-B300")).toBe("deepseek");
    expect(modelFamily("anthropic/claude-sonnet-5.5")).toBe("claude");
  });

  test("returns undefined for a numeric-only id", () => {
    expect(modelFamily("1234")).toBeUndefined();
  });
});

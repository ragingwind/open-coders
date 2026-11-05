import { describe, expect, test } from "bun:test";
import { emptyConfig } from "../src/config/schema";
import {
  mergeModels,
  providerIdFromName,
  roleAlternatives,
  suggestProfileName,
} from "../src/tui/config-form";
import { makeProfile, makeProvider, model } from "./helpers";

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
  test("uses the model name without the provider prefix", () => {
    const config = emptyConfig();
    expect(suggestProfileName(config, "opencode", model("glm", "zai-org/GLM-5.3-Flash"))).toBe(
      "glm-5.3-flash",
    );
  });

  test("prefixes the agent for a very short model name", () => {
    expect(suggestProfileName(emptyConfig(), "claude", model("m1", "m1"))).toBe("claude-m1");
  });

  test("falls back to the agent when the model has no usable name", () => {
    expect(suggestProfileName(emptyConfig(), "fx", model("x", "한글"))).toBe("fx");
  });

  test("adds a suffix when the name is taken", () => {
    const config = emptyConfig();
    config.profiles["glm-5.3-flash"] = makeProfile({ name: "glm-5.3-flash" });
    expect(suggestProfileName(config, "opencode", model("glm", "zai-org/GLM-5.3-Flash"))).toBe(
      "glm-5.3-flash-2",
    );
  });
});

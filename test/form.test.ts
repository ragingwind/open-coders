import { describe, expect, test } from "bun:test";
import { emptyConfig } from "../src/config/schema";
import { mergeModels, providerIdFromName } from "../src/tui/config-form";
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

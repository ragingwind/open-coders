import { describe, expect, test } from "bun:test";
import { UsageError } from "../src/errors";
import { getBool, getString, parseFlags } from "../src/util/args";

describe("parseFlags", () => {
  test("parses equals form, spaced form, repeated and boolean flags", () => {
    const parsed = parseFlags(["--name=om", "--model", "m", "--tag", "a", "--tag", "b", "--yes"], {
      name: "string",
      model: "string",
      tag: "string[]",
      yes: "boolean",
    });
    expect(parsed.values).toEqual({ name: "om", model: "m", tag: ["a", "b"], yes: true });
    expect(parsed.positionals).toEqual([]);
  });

  test("stops parsing at the first positional and keeps the rest", () => {
    const parsed = parseFlags(["--name", "om", "profile", "--agent", "claude"], { name: "string" });
    expect(parsed.values).toEqual({ name: "om" });
    expect(parsed.positionals).toEqual(["profile", "--agent", "claude"]);
  });

  test("treats tokens after -- as positionals", () => {
    const parsed = parseFlags(["--yes", "--", "--not-a-flag", "x"], { yes: "boolean" });
    expect(parsed.positionals).toEqual(["--not-a-flag", "x"]);
  });

  test("rejects unknown flags", () => {
    expect(() => parseFlags(["--nope"], {})).toThrow(UsageError);
  });

  test("rejects a missing value", () => {
    expect(() => parseFlags(["--name"], { name: "string" })).toThrow(UsageError);
  });

  test("rejects a value on a boolean flag", () => {
    expect(() => parseFlags(["--yes=1"], { yes: "boolean" })).toThrow(UsageError);
  });

  test("getString and getBool ignore other types", () => {
    const { values } = parseFlags(["--list", "a", "--yes"], { list: "string[]", yes: "boolean" });
    expect(getString(values, "list")).toBeUndefined();
    expect(getString(values, "yes")).toBeUndefined();
    expect(getBool(values, "yes")).toBe(true);
    expect(getBool(values, "list")).toBe(false);
  });
});

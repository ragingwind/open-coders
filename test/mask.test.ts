import { describe, expect, test } from "bun:test";
import { maskSecret, maskValue } from "../src/util/mask";

describe("maskSecret", () => {
  test("keeps only the last four characters of a long secret", () => {
    expect(maskSecret("supersecret1234")).toBe("********1234");
  });

  test("fully masks short secrets", () => {
    expect(maskSecret("short")).toBe("********");
    expect(maskSecret("12345678")).toBe("********");
  });

  test("handles empty input", () => {
    expect(maskSecret("")).toBe("(empty)");
  });
});

describe("maskValue", () => {
  test("replaces every occurrence of each secret", () => {
    expect(maskValue("key=a&other=a", ["a"])).toBe("key=********&other=********");
  });

  test("ignores undefined and empty secrets", () => {
    expect(maskValue("value", [undefined, ""])).toBe("value");
  });

  test("masks the secret inside JSON", () => {
    const json = JSON.stringify({ apiKey: "supersecret1234" });
    expect(maskValue(json, ["supersecret1234"])).not.toContain("supersecret1234");
  });
});

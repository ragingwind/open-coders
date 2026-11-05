import { describe, expect, test } from "bun:test";
import { generateProfileName } from "../src/tui/name-generator";

describe("generateProfileName", () => {
  test("picks a two-word codename", () => {
    const result = generateProfileName({ random: () => 0 });
    expect(result.name).toBe("amber-badger");
    expect(result.basis).toBe("random codename");
  });

  test("matches the profile name pattern", () => {
    expect(generateProfileName({ random: () => 0.99 }).name).toMatch(/^[a-z]+-[a-z]+$/);
  });

  test("avoids existing names", () => {
    const values = [0, 0, 0.5, 0.5];
    let index = 0;
    const random = () => values[index++] ?? 0;
    const result = generateProfileName({ existing: ["amber-badger"], random });
    expect(result.name).not.toBe("amber-badger");
  });

  test("falls back to a numeric suffix after repeated collisions", () => {
    const result = generateProfileName({ existing: ["amber-badger"], random: () => 0 });
    expect(result.name).toBe("amber-badger-2");
    expect(result.basis).toBe("random codename + numeric suffix");
  });

  test("can generate a pure codename without an agent prefix", () => {
    expect(generateProfileName({ random: () => 0 }).name).toBe("amber-badger");
  });
});

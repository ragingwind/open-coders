import { describe, expect, test } from "bun:test";
import { CANCEL_SYMBOL } from "@clack/prompts";
import { createContext } from "../src/context";
import { CancelledError, UsageError } from "../src/errors";
import { requireTTY, unwrap } from "../src/tui/prompts";

describe("unwrap", () => {
  test("returns a normal value", () => {
    expect(unwrap("value")).toBe("value");
    expect(unwrap(42)).toBe(42);
  });

  test("throws CancelledError on the cancel symbol", () => {
    expect(() => unwrap(CANCEL_SYMBOL)).toThrow(CancelledError);
  });
});

describe("requireTTY", () => {
  test("rejects a non-interactive context", () => {
    expect(() => requireTTY(createContext({ isTTY: false }))).toThrow(UsageError);
  });

  test("accepts an interactive context", () => {
    expect(() => requireTTY(createContext({ isTTY: true }))).not.toThrow();
  });
});

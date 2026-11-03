import { describe, expect, test } from "bun:test";
import { main, type Output } from "../src/cli";

function capture(): Output & { value: string } {
  const buffer: string[] = [];
  return {
    write(text: string) {
      buffer.push(text);
    },
    get value() {
      return buffer.join("");
    },
  };
}

describe("main", () => {
  test("prints help when no argument is given", () => {
    const out = capture();
    expect(main([], out, capture())).toBe(0);
    expect(out.value).toContain("Usage:");
  });

  test("prints help for --help", () => {
    const out = capture();
    expect(main(["--help"], out, capture())).toBe(0);
    expect(out.value).toContain("Usage:");
  });

  test("prints the package version for --version", () => {
    const out = capture();
    expect(main(["--version"], out, capture())).toBe(0);
    expect(out.value.trim()).toBe("0.1.0");
  });

  test("rejects an unknown argument", () => {
    const err = capture();
    expect(main(["nope"], capture(), err)).toBe(1);
    expect(err.value).toContain("unknown argument: nope");
  });
});

import * as p from "@clack/prompts";
import type { CliContext } from "../context";
import { CancelledError, UsageError } from "../errors";

export function unwrap<T>(value: T | typeof p.CANCEL_SYMBOL): T {
  if (p.isCancel(value)) throw new CancelledError();
  return value;
}

export function requireTTY(ctx: CliContext): void {
  if (!ctx.isTTY) {
    throw new UsageError(
      'interactive setup requires a TTY; pass flags or use "open-coders config list"',
    );
  }
}

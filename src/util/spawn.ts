import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { constants as osConstants } from "node:os";
import { delimiter, join } from "node:path";
import type { LaunchPlan } from "../agents/types";
import { CliError } from "../errors";

export interface RunOptions {
  env: Record<string, string | undefined>;
  cwd?: string;
}

export function findExecutable(
  command: string,
  env: Record<string, string | undefined>,
): string | null {
  if (command.includes("/")) {
    try {
      accessSync(command, constants.X_OK);
      return command;
    } catch {
      return null;
    }
  }

  const pathValue = env.PATH;
  if (!pathValue) return null;

  const extensions =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";") : [""];

  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }

  return null;
}

export function buildChildEnv(
  plan: LaunchPlan,
  parentEnv: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parentEnv)) {
    if (value !== undefined) env[key] = value;
  }
  for (const key of plan.unset) delete env[key];
  Object.assign(env, plan.env);
  return env;
}

export async function runPlan(plan: LaunchPlan, options: RunOptions): Promise<number> {
  if (!findExecutable(plan.command, options.env)) {
    throw new CliError(
      `agent binary "${plan.command}" was not found on PATH; install it or add it to PATH`,
      127,
    );
  }

  const env = buildChildEnv(plan, options.env);

  return new Promise<number>((resolve) => {
    const child = spawn(plan.command, plan.args, {
      stdio: "inherit",
      env,
      cwd: options.cwd,
    });

    let settled = false;
    const onSigint = () => child.kill("SIGINT");
    const onSigterm = () => child.kill("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(code);
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    child.on("error", (error: NodeJS.ErrnoException) => {
      const code = error.code === "ENOENT" ? 127 : error.code === "EACCES" ? 126 : 1;
      finish(code);
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        const number = osConstants.signals[signal];
        finish(number ? 128 + number : 1);
      } else {
        finish(code ?? 1);
      }
    });
  });
}

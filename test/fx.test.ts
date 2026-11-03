import { describe, expect, test } from "bun:test";
import { planFx } from "../src/agents/fx";
import { launchInput, makeProvider } from "./helpers";

function fxInput(overrides: Parameters<typeof launchInput>[0] = {}) {
  const base = launchInput(overrides);
  return {
    ...base,
    provider: makeProvider({ kind: "vercel-ai-gateway", endpoints: {} }),
    profile: { ...base.profile, agent: "fx" as const },
  };
}

describe("planFx", () => {
  test("sets the model and gateway key", () => {
    const plan = planFx(fxInput());
    expect(plan.command).toBe("fx");
    expect(plan.args).toEqual([]);
    expect(plan.env.FX_MODEL).toBe("model-1");
    expect(plan.env.AI_GATEWAY_API_KEY).toBe("secret-key-1234");
    expect(plan.unset).toContain("VERCEL_OIDC_TOKEN");
  });

  test("rejects a custom provider", () => {
    expect(() =>
      planFx(launchInput({ profile: { ...launchInput().profile, agent: "fx" } })),
    ).toThrow(/vercel-ai-gateway/);
  });

  test("keeps parent auth when no credential is configured", () => {
    const plan = planFx(fxInput({ credential: undefined }));
    expect(plan.env.AI_GATEWAY_API_KEY).toBeUndefined();
    expect(plan.unset).not.toContain("VERCEL_OIDC_TOKEN");
  });

  test("applies profile env and appends args", () => {
    const base = fxInput({ userArgs: ["--yolo"] });
    base.profile = {
      ...base.profile,
      env: { FX_PERMISSION_MODE: "full-access" },
      args: ["--record"],
    };
    const plan = planFx(base);
    expect(plan.env.FX_PERMISSION_MODE).toBe("full-access");
    expect(plan.args).toEqual(["--record", "--yolo"]);
  });
});

import { describe, expect, test } from "bun:test";
import { planClaude } from "../src/agents/claude";
import { ConfigError } from "../src/errors";
import { launchInput, makeProvider, model } from "./helpers";

describe("planClaude", () => {
  test("sets the base URL and maps all roles to the default model", () => {
    const plan = planClaude(launchInput());
    expect(plan.command).toBe("claude");
    expect(plan.args).toEqual(["--model", "model-1"]);
    expect(plan.env.ANTHROPIC_BASE_URL).toBe("https://gw.example.com/anthropic");
    expect(plan.env.ANTHROPIC_MODEL).toBe("model-1");
    expect(plan.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("model-1");
    expect(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("model-1");
    expect(plan.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("model-1");
    expect(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("model-1");
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBe("secret-key-1234");
    expect(plan.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test("uses role models when given", () => {
    const plan = planClaude(
      launchInput({
        roleModels: { fable: model("f", "fable-model"), opus: model("o", "opus-model") },
      }),
    );
    expect(plan.env.ANTHROPIC_DEFAULT_FABLE_MODEL).toBe("fable-model");
    expect(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("opus-model");
    expect(plan.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("model-1");
  });

  test("uses ANTHROPIC_API_KEY and unsets AUTH_TOKEN for x-api-key", () => {
    const provider = makeProvider({
      auth: { style: "x-api-key", credential: { source: "env", name: "GW_KEY" } },
    });
    const plan = planClaude(launchInput({ provider }));
    expect(plan.env.ANTHROPIC_API_KEY).toBe("secret-key-1234");
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(plan.unset).toContain("ANTHROPIC_AUTH_TOKEN");
  });

  test("unsets inherited credentials for no auth", () => {
    const provider = makeProvider({ auth: { style: "none" } });
    const plan = planClaude(launchInput({ provider, credential: undefined }));
    expect(plan.unset).toContain("ANTHROPIC_AUTH_TOKEN");
    expect(plan.unset).toContain("ANTHROPIC_API_KEY");
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
  });

  test("does not set limits by default", () => {
    const plan = planClaude(launchInput());
    expect(plan.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined();
    expect(plan.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBeUndefined();
    expect(plan.env.DISABLE_COMPACT).toBeUndefined();
  });

  test("sets requested limits", () => {
    const profile = launchInput().profile;
    profile.limits = { maxContextTokens: 200_000, maxOutputTokens: 8_192, disableCompact: true };
    const plan = planClaude(launchInput({ profile }));
    expect(plan.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBe("200000");
    expect(plan.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe("8192");
    expect(plan.env.DISABLE_COMPACT).toBe("1");
  });

  test("lets profile env override computed values", () => {
    const profile = launchInput().profile;
    profile.env = { ANTHROPIC_MODEL: "override", CUSTOM: "1" };
    const plan = planClaude(launchInput({ profile }));
    expect(plan.env.ANTHROPIC_MODEL).toBe("override");
    expect(plan.env.CUSTOM).toBe("1");
  });

  test("keeps user args and skips the default model flag when the user sets one", () => {
    const withModel = planClaude(launchInput({ userArgs: ["--model", "user-model"] }));
    expect(withModel.args).toEqual(["--model", "user-model"]);

    const withoutModel = planClaude(launchInput({ userArgs: ["-p", "hi"] }));
    expect(withoutModel.args).toEqual(["--model", "model-1", "-p", "hi"]);
  });

  test("keeps profile args before user args", () => {
    const profile = launchInput().profile;
    profile.args = ["--dangerously-skip-permissions"];
    const plan = planClaude(launchInput({ profile, userArgs: ["-p", "hi"] }));
    expect(plan.args).toEqual(["--model", "model-1", "--dangerously-skip-permissions", "-p", "hi"]);
  });

  test("rejects a provider without an anthropic endpoint", () => {
    const provider = makeProvider({ endpoints: { openaiCompatible: "https://gw.example.com/v1" } });
    expect(() => planClaude(launchInput({ provider }))).toThrow(ConfigError);
  });

  test("rejects a missing key", () => {
    expect(() => planClaude(launchInput({ credential: undefined }))).toThrow(/needs an API key/);
  });
});

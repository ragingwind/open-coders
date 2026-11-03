import type { AgentId } from "../config/schema";
import { planClaude } from "./claude";
import { planFx } from "./fx";
import { planOpencode } from "./opencode";
import type { LaunchInput, LaunchPlan } from "./types";

export function buildLaunchPlan(agent: AgentId, input: LaunchInput): LaunchPlan {
  switch (agent) {
    case "claude":
      return planClaude(input);
    case "opencode":
      return planOpencode(input);
    case "fx":
      return planFx(input);
  }
}

export type { LaunchInput, LaunchPlan };

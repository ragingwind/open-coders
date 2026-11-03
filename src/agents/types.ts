import type { ClaudeRole, Model, Profile, Provider } from "../config/schema";

export interface LaunchInput {
  profile: Profile;
  provider: Provider;
  providerId: string;
  model: Model;
  roleModels: Partial<Record<ClaudeRole, Model>>;
  credential: string | undefined;
  userArgs: string[];
}

export interface LaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  unset: string[];
}

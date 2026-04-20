export type AutoClawConfig = {
  enabled: boolean;
  rulesPath: string;
  anthropicApiKeyEnv: string;
  gatekeeperModel: string;
  defaultReviewerModel: string;
  defaultFixerModel: string;
  reviewerAgentId: string;
  fixerAgentId: string;
  maxIterations: number;
  loopTimeoutSeconds: number;
  subagentRunTimeoutSeconds: number;
  emitLivenessUpdates: boolean;
  mutatingTools: string[];
};

export const defaultConfig: AutoClawConfig = {
  enabled: true,
  rulesPath: "review-rules.md",
  anthropicApiKeyEnv: "ANTHROPIC_API_KEY",
  gatekeeperModel: "claude-haiku-4-5-20251001",
  defaultReviewerModel: "claude-sonnet-4-6",
  defaultFixerModel: "claude-sonnet-4-6",
  reviewerAgentId: "code-reviewer",
  fixerAgentId: "coder",
  maxIterations: 4,
  loopTimeoutSeconds: 600,
  subagentRunTimeoutSeconds: 180,
  emitLivenessUpdates: true,
  mutatingTools: ["edit", "write", "apply_patch"],
};

const assertInRange = (name: string, value: number, min: number, max: number): void => {
  if (value < min || value > max) {
    throw new Error(`auto-claw: ${name} must be between ${min} and ${max} (got ${value})`);
  }
};

export function loadConfig(input: Partial<AutoClawConfig> | undefined): AutoClawConfig {
  const merged: AutoClawConfig = {
    ...defaultConfig,
    ...(input ?? {}),
    mutatingTools: [...(input?.mutatingTools ?? defaultConfig.mutatingTools)],
  };

  assertInRange("maxIterations", merged.maxIterations, 1, 20);
  assertInRange("loopTimeoutSeconds", merged.loopTimeoutSeconds, 10, 3600);

  return merged;
}

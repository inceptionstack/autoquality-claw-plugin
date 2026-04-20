export type RollupKey = string;

export type Edit = {
  rollupKey: RollupKey;
  runId: string;
  tool: "edit" | "write" | "apply_patch";
  file?: string;
  params: Record<string, unknown>;
  at: number;
  iteration: number;
};

export type Decision =
  | { action: "approve"; note?: string }
  | { action: "stop"; reason: string }
  | { action: "review"; reviewerModel?: string; reviewerAgentId?: string; focus?: string }
  | { action: "fix"; fixerModel?: string; fixerAgentId?: string; fixerPrompt: string };

export type ReviewIssue = {
  severity: "info" | "warn" | "error";
  file?: string;
  line?: number;
  message: string;
};

export type ReviewResult = {
  rawText: string;
  issues: ReviewIssue[];
  verdict: "clean" | "issues" | "uncertain";
};

export type LoopHistoryItem =
  | { kind: "decision"; iteration: number; decision: Decision }
  | { kind: "review"; iteration: number; result: ReviewResult }
  | { kind: "fix"; iteration: number; summary: string; editCount: number }
  | { kind: "error"; iteration: number; error: string };

export type LoopOutcome = {
  status: "approved" | "max-iterations" | "stopped" | "timeout" | "aborted" | "error";
  history: LoopHistoryItem[];
  iterations: number;
};

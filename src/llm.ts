import Anthropic from "@anthropic-ai/sdk";

export type GatekeeperLlmOpts = {
  apiKey: string;
  model: string;
  client?: Pick<Anthropic, "messages">;
};

export type DecideInput = {
  system: string;
  user: string;
};

const DECIDE_TOOL = {
  name: "decide",
  description: "Decide what to do next in the autoquality-claw review loop.",
  input_schema: {
    type: "object",
    required: ["action"],
    properties: {
      action: { type: "string", enum: ["approve", "stop", "review", "fix"] },
      note: { type: "string" },
      reason: { type: "string" },
      reviewerModel: { type: "string" },
      reviewerAgentId: { type: "string" },
      focus: { type: "string" },
      fixerModel: { type: "string" },
      fixerAgentId: { type: "string" },
      fixerPrompt: { type: "string" },
    },
  },
} as const;

export function createGatekeeperLlm(opts: GatekeeperLlmOpts) {
  const client = opts.client ?? new Anthropic({ apiKey: opts.apiKey });

  const decide = async (input: DecideInput): Promise<Record<string, unknown>> => {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: 1024,
      system: input.system,
      tools: [DECIDE_TOOL as any],
      tool_choice: { type: "tool", name: "decide" } as any,
      messages: [{ role: "user", content: input.user }],
    });
    const block = (response as any).content?.find?.(
      (item: any) => item.type === "tool_use" && item.name === "decide",
    );

    if (!block) {
      throw new Error("gatekeeper: model did not return a tool_use block");
    }

    return block.input as Record<string, unknown>;
  };

  return { decide };
}

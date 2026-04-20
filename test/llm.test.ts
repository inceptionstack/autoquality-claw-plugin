import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { createGatekeeperLlm } from "../src/llm.js";

describe("createGatekeeperLlm.decide", () => {
  it("returns the parsed tool-use input when the model picks the decide tool", async () => {
    const fakeCreate = vi.fn().mockResolvedValue({
      content: [
        {
          type: "tool_use",
          name: "decide",
          input: { action: "approve", note: "nothing changed" },
        },
      ],
    });
    const client = { messages: { create: fakeCreate } } as unknown as Pick<Anthropic, "messages">;
    const llm = createGatekeeperLlm({
      apiKey: "k",
      model: "m",
      client,
    });

    const output = await llm.decide({ system: "sys", user: "usr" });

    expect(output).toEqual({ action: "approve", note: "nothing changed" });
    expect(fakeCreate).toHaveBeenCalledOnce();
  });

  it("throws if the model returns no tool_use block", async () => {
    const fakeCreate = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "no tool" }] });
    const client = { messages: { create: fakeCreate } } as unknown as Pick<Anthropic, "messages">;
    const llm = createGatekeeperLlm({
      apiKey: "k",
      model: "m",
      client,
    });

    await expect(llm.decide({ system: "s", user: "u" })).rejects.toThrow(/tool_use/);
  });
});

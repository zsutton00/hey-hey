import { describe, expect, it } from "vitest";

import { formatClaudeSession } from "./claudeSessionText";

const line = (value: unknown) => JSON.stringify(value);

describe("formatClaudeSession", () => {
  it("reads as a conversation and leaves out internal bookkeeping", () => {
    const raw = [
      line({ type: "queue-operation", content: "duplicate of the prompt" }),
      line({
        type: "user",
        uuid: "11111111-1111-4111-8111-111111111111",
        message: { role: "user", content: "Fix the bug" },
      }),
      line({ type: "api-request", id: "req-1", params: { model: "m" } }),
      line({
        type: "assistant",
        uuid: "22222222-2222-4222-8222-222222222222",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Look at the file first" },
            { type: "text", text: "Reading it now" },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "Read",
              input: { file_path: "/a/b.ts" },
            },
          ],
        },
      }),
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "line one\nline two",
            },
          ],
        },
      }),
      line({ type: "cost-state", totalCostUSD: 1 }),
      "{ not json",
    ].join("\n");

    const text = formatClaudeSession(raw);

    expect(text).toContain("> Fix the bug");
    expect(text).toContain("Look at the file first");
    expect(text).toContain("● Reading it now");
    expect(text).toContain("● Read\n  file_path: /a/b.ts");
    expect(text).toContain("⎿ line one\n  line two");
    expect(text).not.toMatch(
      /uuid|toolu_1|11111111|duplicate of the prompt|totalCost|req-1/,
    );
  });
});

/** @vitest-environment node */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ClaudeCodeDecoder } from "../ClaudeCodeDecoder";

const readFixture = (filename: string): string =>
  readFileSync(
    join(process.cwd(), "src/agents/node/__fixtures__", filename),
    "utf8"
  );

describe("ClaudeCodeDecoder", () => {
  it("normalizes a simple user/assistant exchange fixture", () => {
    const decoder = new ClaudeCodeDecoder();
    const fixture = readFixture("claude-0-say-lol-session.jsonl");
    const messages = [...decoder.decode(fixture), ...decoder.flush()];

    expect(messages).toHaveLength(2);
    expect(messages[0]?.type).toBe("user");
    expect(messages[0]?.sessionId).toBe("93a9705e-bc6a-406d-8dce-8acc014dedbd");
    expect(messages[1]?.type).toBe("assistant");
    expect(messages[1]?.sessionId).toBe("93a9705e-bc6a-406d-8dce-8acc014dedbd");

    const assistantPayload = messages[1]?.content[0]?.payload as {
      text?: string | null;
    };
    expect(assistantPayload.text).toContain("lol");
  });

  it("normalizes tool-use and tool-result events from a continuation fixture", () => {
    const decoder = new ClaudeCodeDecoder();
    const fixture = readFixture("claude-1-continue-run-ls-tool.jsonl");
    const messages = [...decoder.decode(fixture), ...decoder.flush()];

    expect(messages.some((message) => message.subtype === "summary")).toBe(
      true
    );
    expect(
      messages.some(
        (message) => message.type === "tool" && message.subtype === "tool_use"
      )
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.type === "tool" && message.subtype === "tool_result"
      )
    ).toBe(true);
    expect(
      messages.some(
        (message) =>
          message.type === "assistant" &&
          JSON.stringify(message.content[0]?.payload).includes("readme.md")
      )
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import { readableEvalOutput, retainedEvalOutput } from "../retainedEvalOutput";
import type { EvalAttemptReportPayload } from "../../../api";
describe("retained eval answers", () => {
  it("preserves plain text and extracts research analysis for reading", () => {
    expect(readableEvalOutput("The answer")).toBe("The answer");
    expect(
      readableEvalOutput(JSON.stringify({ analysis: "Research", frame: {} })),
    ).toBe("Research");
  });
  it("keeps structured output without analysis intact", () => {
    expect(readableEvalOutput('{"result":42}')).toBe('{"result":42}');
  });
  it("distinguishes absent output from a retained answer", () => {
    const payload = { summary: "Attempt queued" } as EvalAttemptReportPayload;
    expect(retainedEvalOutput(payload)).toBeNull();
    expect(
      retainedEvalOutput({
        ...payload,
        summary: { outputText: "Saved answer" },
      }),
    ).toBe("Saved answer");
  });
});

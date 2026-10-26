import type { EvalAttemptReportPayload } from "../../api";

/** The runner retains the exact judged answer here, even for handlers without messages. */
export function retainedEvalOutput(
  payload: EvalAttemptReportPayload,
): string | null {
  const summary: unknown = payload.summary;
  if (
    typeof summary !== "object" ||
    summary === null ||
    !("outputText" in summary) ||
    typeof summary.outputText !== "string"
  )
    return null;
  return summary.outputText;
}

export function readableEvalOutput(output: string): string {
  try {
    const parsed: unknown = JSON.parse(output);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "analysis" in parsed &&
      typeof parsed.analysis === "string"
    )
      return parsed.analysis;
  } catch {
    // Ordinary handler answers are Markdown, not structured research reports.
  }
  return output;
}

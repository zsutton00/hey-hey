import type { CodingPlanContext } from "../../../api";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import type { FieldComponentProps } from "./types";

/** Earlier snapshots remain readable but cannot authorize a complete plan. */
export function HistoricalCodingPlanContextField({
  config,
}: FieldComponentProps) {
  const planning = config.payload as CodingPlanContext;
  return (
    <MarkdownRenderer>
      {[
        planning.sessionTitle,
        planning.intent,
        planning.technicalContext,
        ...planning.issues.map((issue) => issue.resolution),
      ].join("\n\n")}
    </MarkdownRenderer>
  );
}

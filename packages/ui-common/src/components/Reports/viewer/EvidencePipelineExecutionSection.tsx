import React from "react";
import { ReportSection } from "./ReportSection";
import type { EvidencePipelineReportExecution } from "./evidencePipelineTypes";

export interface EvidencePipelineExecutionSectionProps {
  execution: EvidencePipelineReportExecution;
}

export const EvidencePipelineExecutionSection: React.FC<
  EvidencePipelineExecutionSectionProps
> = ({ execution }) => {
  const items = [
    {
      id: "started-at",
      title: "Started at",
      detail: execution.startedAt,
    },
    {
      id: "completed-at",
      title: "Completed at",
      detail: execution.completedAt,
    },
    {
      id: "duration",
      title: "Duration (ms)",
      detail: String(execution.durationMs),
    },
    {
      id: "total-steps",
      title: "Total search steps",
      detail: String(execution.totalSearchSteps),
    },
    {
      id: "cache-split",
      title: "Cache usage",
      detail: `${String(execution.cachedStepCount)} cached; ${String(
        execution.uncachedStepCount
      )} uncached`,
    },
    {
      id: "errors",
      title: "Errors",
      detail: String(execution.errorCount),
    },
  ];

  return (
    <ReportSection
      emptyMessage="No execution summary available"
      items={items}
      testId="report-viewer-evidence-pipeline-execution"
      title="Execution Summary"
    />
  );
};

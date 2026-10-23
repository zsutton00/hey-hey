import React from "react";
import { ReportSection } from "./ReportSection";
import {
  formatSearchStepTitle,
  type EvidencePipelineReportSearchStep,
} from "./evidencePipelineTypes";

export interface EvidencePipelineSearchStepsSectionProps {
  searchSteps: EvidencePipelineReportSearchStep[];
  title?: string;
  emptyMessage?: string;
}

export const EvidencePipelineSearchStepsSection: React.FC<
  EvidencePipelineSearchStepsSectionProps
> = ({
  searchSteps,
  title = "Search Terms Executed",
  emptyMessage = "No search terms executed",
}) => {
  const items = searchSteps.map((step, index) => ({
    id: `search-step-${index}`,
    title: formatSearchStepTitle(step.query, index),
    detail: `Why: ${step.why}; Perspective: ${step.queryPerspective}; Tool: ${step.tool}`,
  }));

  return (
    <ReportSection
      emptyMessage={emptyMessage}
      items={items}
      testId="report-viewer-evidence-pipeline-search-steps"
      title={title}
    />
  );
};

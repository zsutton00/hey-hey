import React from "react";
import { ReportSection } from "./ReportSection";
import type { EvidencePipelineReportPlannerInput } from "./evidencePipelineTypes";

export interface EvidencePipelinePlannerInputSectionProps {
  plannerInput: EvidencePipelineReportPlannerInput;
}

export const EvidencePipelinePlannerInputSection: React.FC<
  EvidencePipelinePlannerInputSectionProps
> = ({ plannerInput }) => {
  const items = [
    {
      id: "message-count",
      title: "Conversation messages",
      detail: String(plannerInput.messageCount),
    },
    {
      id: "option-keys",
      title: "Planner option keys",
      detail:
        plannerInput.optionKeys.length > 0
          ? plannerInput.optionKeys.join(", ")
          : "None",
    },
    {
      id: "max-rounds",
      title: "Maximum rounds",
      detail: String(plannerInput.maxRounds),
    },
    {
      id: "scaffolded-focus",
      title: "Scaffolded QA answer focus",
      detail: plannerInput.scaffoldedQaAnswerFocus ? "Enabled" : "Disabled",
    },
  ];

  return (
    <ReportSection
      emptyMessage="No planner input summary available"
      items={items}
      testId="report-viewer-evidence-pipeline-planner"
      title="Planner Input Summary"
    />
  );
};

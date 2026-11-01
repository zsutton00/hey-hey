import { Stack } from "@mui/material";
import React, { useState } from "react";
import type { CodingResearchReportPayload, ReportDto } from "../../../api";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { CodingResearchFrameSection } from "./CodingResearchFrameSection";
import { CodingResearchProvenanceSections } from "./CodingResearchProvenanceSections";
import { CodingResearchUpdatesSection } from "./CodingResearchUpdatesSection";
import { createCodingResearchFrameModel } from "./codingResearchReportModel";
import { ReportDisclosure, ReportLabeledText } from "./reportPrimitives";

export interface CodingResearchReportProps {
  payload: CodingResearchReportPayload;
  /**
   * The saved report. Absent for saved eval output that no report record
   * holds; the action that opens a conversation about the report needs one.
   */
  report?: ReportDto;
  reportTestId: string;
  /** Saved eval output is display only: no action may start new work. */
  evaluationOutput?: boolean;
}

export const CodingResearchReport: React.FC<CodingResearchReportProps> = ({
  payload,
  report,
  reportTestId,
  evaluationOutput = false,
}) => {
  const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(false);
  // Older or malformed reports can lack `provenance` despite the typed contract.
  const discoveryCalls = payload.provenance?.discoveryCalls ?? [];
  const edgesTraversed = payload.provenance?.edgesTraversed ?? [];
  const frameModel = createCodingResearchFrameModel(payload.frame);

  return (
    <Stack data-testid={`${reportTestId}-coding-research`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-coding-research-summary`}
        value={payload.summary}
      />
      <CodingResearchUpdatesSection
        frameModel={frameModel}
        report={evaluationOutput ? undefined : report}
        reportTestId={reportTestId}
        updates={payload.updates}
      />
      <ReportDisclosure
        onExpandedChange={setIsAnalysisExpanded}
        testId={`${reportTestId}-coding-research-analysis`}
        title="Analysis"
      >
        <MarkdownRenderer mentionMode="minimal" sx={{ fontSize: "0.875rem" }}>
          {payload.analysis}
        </MarkdownRenderer>
      </ReportDisclosure>
      {isAnalysisExpanded ? (
        <ReportDisclosure
          testId={`${reportTestId}-coding-research-details`}
          title="Research details"
        >
          <Stack spacing={1.5}>
            <CodingResearchFrameSection
              frameModel={frameModel}
              reportTestId={reportTestId}
            />
            <CodingResearchProvenanceSections
              discoveryCalls={discoveryCalls}
              edgesTraversed={edgesTraversed}
              reportTestId={reportTestId}
            />
          </Stack>
        </ReportDisclosure>
      ) : null}
    </Stack>
  );
};

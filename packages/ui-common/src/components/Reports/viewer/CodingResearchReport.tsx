import { Stack } from "@mui/material";
import React, { useMemo, useState } from "react";
import type { CodingResearchReportPayload, ReportDto } from "../../../api";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { CodingResearchFrameSection } from "./CodingResearchFrameSection";
import { CodingResearchProvenanceSections } from "./CodingResearchProvenanceSections";
import { CodingResearchUpdatesSection } from "./CodingResearchUpdatesSection";
import { CodingResearchUncertaintiesSection } from "./CodingResearchUncertaintiesSection";
import { parseCodingResearchSubagentParentAnalysis } from "./codingResearchSubagentParentUncertainties";
import {
  createCodingResearchFrameModel,
  type CodingResearchFrameModel,
} from "./codingResearchReportModel";
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
  /** Render the open-questions block inside this report body. */
  renderOpenQuestions?: boolean;
  /** Render the proposed-changes panel inside this report body. */
  renderUpdates?: boolean;
}

export const CodingResearchReport: React.FC<CodingResearchReportProps> = ({
  payload,
  report,
  reportTestId,
  evaluationOutput = false,
  renderOpenQuestions = true,
  renderUpdates = true,
}) => {
  const [isAnalysisExpanded, setIsAnalysisExpanded] = useState(false);
  const frame =
    payload.format === "SUBAGENT_PARENT" ? undefined : payload.frame;
  // Written reports carry no frame, so there is nothing to read or to log.
  const frameModel = useMemo<CodingResearchFrameModel>(
    () =>
      payload.format === "SUBAGENT_PARENT"
        ? { state: "unavailable" }
        : createCodingResearchFrameModel(frame, report?.id),
    [frame, payload.format, report?.id],
  );
  const reportData =
    payload.format === "SUBAGENT_PARENT"
      ? {
          format: payload.format,
          discoveryCalls: [],
          edgesTraversed: [],
          updates: [],
          ...parseCodingResearchSubagentParentAnalysis(payload.analysis),
        }
      : {
          // Reports saved before the format discriminator existed are self-research reports.
          // These optional reads are only for that persisted legacy shape.
          format: payload.format,
          discoveryCalls: payload.provenance?.discoveryCalls ?? [],
          edgesTraversed: payload.provenance?.edgesTraversed ?? [],
          updates: payload.updates ?? [],
          uncertainties: payload.uncertainties ?? [],
          analysis: payload.analysis,
        };

  return (
    <Stack data-testid={`${reportTestId}-coding-research`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-coding-research-summary`}
        value={payload.summary}
      />
      {renderUpdates ? (
        <CodingResearchUpdatesSection
          frameModel={frameModel}
          report={evaluationOutput ? undefined : report}
          reportTestId={reportTestId}
          updates={reportData.updates}
        />
      ) : null}
      <ReportDisclosure
        onExpandedChange={setIsAnalysisExpanded}
        testId={`${reportTestId}-coding-research-analysis`}
        title="Analysis"
      >
        <MarkdownRenderer mentionMode="minimal" sx={{ fontSize: "0.875rem" }}>
          {reportData.analysis}
        </MarkdownRenderer>
      </ReportDisclosure>
      {renderOpenQuestions ? (
        <CodingResearchUncertaintiesSection
          reportTestId={reportTestId}
          uncertainties={reportData.uncertainties}
        />
      ) : null}
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
              discoveryCalls={reportData.discoveryCalls}
              edgesTraversed={reportData.edgesTraversed}
              reportTestId={reportTestId}
            />
          </Stack>
        </ReportDisclosure>
      ) : null}
    </Stack>
  );
};

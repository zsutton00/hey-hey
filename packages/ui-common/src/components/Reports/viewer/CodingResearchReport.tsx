import { Stack } from "@mui/material";
import { useState } from "react";
import type { CodingResearchReportPayload } from "../../../api";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { CodingResearchFrameSection } from "./CodingResearchFrameSection";
import { CodingResearchProvenanceSections } from "./CodingResearchProvenanceSections";
import { CodingResearchUpdatesSection } from "./CodingResearchUpdatesSection";
import { createCodingResearchFrameModel } from "./codingResearchReportModel";
import { ReportDisclosure, ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const CodingResearchReport: ReportRenderer<
  CodingResearchReportPayload
> = ({ payload, report, reportTestId }) => {
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
        report={report}
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

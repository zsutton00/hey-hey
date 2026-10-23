import { Stack } from "@mui/material";
import type { FeatureTreeAnalysisReportPayload } from "../../../api";
import { ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const FeatureTreeAnalysisReport: ReportRenderer<
  FeatureTreeAnalysisReportPayload
> = ({ payload, reportTestId }) => (
  <Stack data-testid={`${reportTestId}-feature-tree-analysis`} spacing={1.5}>
    <ReportLabeledText
      label="Summary"
      renderMentions
      testId={`${reportTestId}-feature-tree-analysis-summary`}
      value={payload.summary}
    />
    {payload.title ? (
      <ReportLabeledText
        label="Title"
        renderMentions
        testId={`${reportTestId}-feature-tree-analysis-title`}
        value={payload.title}
      />
    ) : null}
    <ReportLabeledText
      label="Analysis"
      renderMentions
      testId={`${reportTestId}-feature-tree-analysis-text`}
      value={payload.text}
    />
  </Stack>
);

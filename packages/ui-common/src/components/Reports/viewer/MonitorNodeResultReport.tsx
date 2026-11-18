import { Stack } from "@mui/material";
import type { MonitorNodeResultReportPayload } from "../../../api";
import { ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

const OUTCOME_LABELS: Record<
  MonitorNodeResultReportPayload["outcome"],
  string
> = {
  ACCEPTED: "Accepted",
  FAILED: "Failed",
};

export const MonitorNodeResultReport: ReportRenderer<
  MonitorNodeResultReportPayload
> = ({ payload, reportTestId }) => (
  <Stack data-testid={`${reportTestId}-monitor-node-result`} spacing={1.5}>
    <ReportLabeledText
      label="Outcome"
      testId={`${reportTestId}-monitor-node-result-outcome`}
      value={OUTCOME_LABELS[payload.outcome]}
    />
    <ReportLabeledText
      label="Reason"
      renderMentions
      testId={`${reportTestId}-monitor-node-result-reason`}
      value={payload.reason}
    />
    <ReportLabeledText
      label="Summary"
      renderMentions
      testId={`${reportTestId}-monitor-node-result-summary`}
      value={payload.summary}
    />
  </Stack>
);

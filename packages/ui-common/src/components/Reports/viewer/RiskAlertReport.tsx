import { Stack } from "@mui/material";
import type { RiskAlertReportPayload } from "../../../api";
import { ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const RiskAlertReport: ReportRenderer<RiskAlertReportPayload> = ({
  payload,
  reportTestId,
}) => (
  <Stack data-testid={`${reportTestId}-risk-alert`} spacing={1.5}>
    <ReportLabeledText
      label="Summary"
      renderMentions
      testId={`${reportTestId}-risk-alert-summary`}
      value={payload.summary}
    />
    {payload.title ? (
      <ReportLabeledText
        label="Title"
        testId={`${reportTestId}-risk-alert-title`}
        value={payload.title}
      />
    ) : null}
    <ReportLabeledText
      label="Risk"
      renderMentions
      testId={`${reportTestId}-risk-alert-text`}
      value={payload.text}
    />
  </Stack>
);

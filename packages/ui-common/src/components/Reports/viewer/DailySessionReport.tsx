import { Stack } from "@mui/material";
import type { DailySessionReportPayload } from "../../../api";
import { ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const DailySessionReport: ReportRenderer<DailySessionReportPayload> = ({
  payload,
  reportTestId,
}) => (
  <Stack data-testid={`${reportTestId}-daily-session`} spacing={1}>
    <ReportLabeledText
      label="Summary"
      renderMentions
      testId={`${reportTestId}-daily-session-summary`}
      value={payload.summary}
    />
  </Stack>
);

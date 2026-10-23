import { Stack } from "@mui/material";
import type { SessionMonitorDeferralReportPayload } from "../../../api";
import { ReportLabeledText, ReportPanel } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const SessionMonitorDeferralReport: ReportRenderer<
  SessionMonitorDeferralReportPayload
> = ({ payload, reportTestId }) => (
  <Stack data-testid={`${reportTestId}-session-monitor-deferral`} spacing={1.5}>
    <ReportLabeledText
      label="Summary"
      renderMentions
      testId={`${reportTestId}-session-monitor-deferral-summary`}
      value={payload.summary}
    />
    <ReportPanel
      isEmpty={false}
      testId={`${reportTestId}-session-monitor-deferral-context`}
      title="Review context"
    >
      <Stack spacing={1}>
        <ReportLabeledText
          label="Assessed session"
          testId={`${reportTestId}-session-monitor-deferral-assessed-session`}
          value={payload.assessedSessionId}
        />
        <ReportLabeledText
          label="Assessed turn"
          testId={`${reportTestId}-session-monitor-deferral-assessed-turn`}
          value={payload.assessedTurnId}
        />
        <ReportLabeledText
          label="Assessed reports"
          testId={`${reportTestId}-session-monitor-deferral-assessed-report`}
          value={payload.assessedReportIds.join(", ")}
        />
      </Stack>
    </ReportPanel>
    <ReportLabeledText
      label="Reasoning"
      renderMentions
      testId={`${reportTestId}-session-monitor-deferral-reasoning`}
      value={payload.reasoning}
    />
  </Stack>
);

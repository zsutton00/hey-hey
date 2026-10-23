import { Stack } from "@mui/material";
import type { SessionSummaryReportPayload } from "../../../api";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import { ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const SessionSummaryReport: ReportRenderer<
  SessionSummaryReportPayload
> = ({ payload, reportTestId }) => {
  const summaryText =
    payload.summary === null || payload.summary === undefined
      ? undefined
      : typeof payload.summary === "string"
      ? payload.summary
      : String(payload.summary);

  return (
    <Stack data-testid={`${reportTestId}-session-summary`} spacing={1}>
      <ReportLabeledText
        label="Summary"
        testId={`${reportTestId}-session-summary-text`}
        value={
          <MarkdownRenderer
            mentionMode="minimal"
            sx={{ fontSize: "0.875rem" }}
          >
            {payload.text}
          </MarkdownRenderer>
        }
      />
      {summaryText === undefined ? null : (
        <ReportLabeledText
          label="Details"
          testId={`${reportTestId}-session-summary-summary`}
          value={
            <MarkdownRenderer
              mentionMode="minimal"
              sx={{ fontSize: "0.875rem" }}
            >
              {summaryText}
            </MarkdownRenderer>
          }
        />
      )}
    </Stack>
  );
};

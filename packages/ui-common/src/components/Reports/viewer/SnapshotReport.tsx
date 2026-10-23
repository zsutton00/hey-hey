import { Stack } from "@mui/material";
import type { SnapshotReportPayload } from "../../../api";
import { ReportLabeledText } from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const SnapshotReport: ReportRenderer<SnapshotReportPayload> = ({
  payload,
  reportTestId,
}) => (
  <Stack data-testid={`${reportTestId}-snapshot`} spacing={1}>
    <ReportLabeledText
      label="Summary"
      renderMentions
      testId={`${reportTestId}-snapshot-summary`}
      value={payload.summary ?? ""}
    />
  </Stack>
);

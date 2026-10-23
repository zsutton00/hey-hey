import { Stack } from "@mui/material";
import type { GoalProgressReportPayload } from "../../../api";
import { ReportRelatedEntityType } from "../../../api";
import {
  ReportEntityMention,
  ReportLabeledText,
  ReportPanel,
} from "./reportPrimitives";
import type { ReportRenderer } from "./rendererContract";

export const GoalProgressReport: ReportRenderer<GoalProgressReportPayload> = ({
  payload,
  reportTestId,
}) => {
  const summaryText =
    typeof payload.summary === "string"
      ? payload.summary
      : JSON.stringify(payload.summary);
  const goalAnchor = payload.goalAnchor;

  return (
    <Stack data-testid={`${reportTestId}-goal-progress`} spacing={1.5}>
      <ReportLabeledText
        label="Summary"
        renderMentions
        testId={`${reportTestId}-goal-progress-summary`}
        value={summaryText}
      />
      {payload.title ? (
        <ReportLabeledText
          label="Title"
          testId={`${reportTestId}-goal-progress-title`}
          value={payload.title}
        />
      ) : null}
      <ReportLabeledText
        label="Progress"
        renderMentions
        testId={`${reportTestId}-goal-progress-text`}
        value={payload.text}
      />
      {goalAnchor ? (
        <ReportPanel
          testId={`${reportTestId}-goal-progress-anchor`}
          title="Goal"
        >
          <ReportEntityMention
            entityId={goalAnchor.entityId}
            entityType={ReportRelatedEntityType.Goal}
          />
        </ReportPanel>
      ) : null}
    </Stack>
  );
};

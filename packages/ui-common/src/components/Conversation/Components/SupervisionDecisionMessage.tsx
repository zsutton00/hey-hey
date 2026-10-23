import { Box, Chip, Stack, Typography } from "@mui/material";
import type { TaskMonitorSupervisionSystemMessageData } from "../../../api";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";

interface SupervisionDecisionMessageProps {
  data: TaskMonitorSupervisionSystemMessageData;
}

const assertNever = (value: never): never => {
  throw new Error(`Unsupported Task Monitor supervision outcome: ${value}`);
};

const getOutcomePresentation = (
  data: TaskMonitorSupervisionSystemMessageData
) => {
  switch (data.outcome) {
    case "REQUESTING_REVIEW":
      return {
        label: "Requesting review",
        color: "info" as const,
      };
    case "AWAITING_REVIEW":
      return {
        label: "Awaiting review",
        color: "info" as const,
      };
    case "REVIEW_REQUEST_FAILED":
      return {
        label: "Review request failed",
        color: "error" as const,
        detail: {
          label: "Failure context",
          testId: "supervision-decision-failure-context",
          value: data.failureContext,
        },
      };
    case "REVIEW_REQUEST_RECONCILING":
      return {
        label: "Reconciling review request",
        color: "warning" as const,
        detail: {
          label: "Recovery context",
          testId: "supervision-decision-recovery-context",
          value: data.recoveryContext,
        },
      };
    case "REVIEW_RECOVERY_JUDGMENT_REQUIRED":
      return {
        label: "Review recovery judgment required",
        color: "secondary" as const,
        detail: {
          label: "Recovery context",
          testId: "supervision-decision-recovery-context",
          value: data.recoveryContext,
        },
      };
    case "CHANGES_REQUESTED":
      return {
        label: "Changes requested",
        color: "warning" as const,
        detail: {
          label: "Guidance",
          testId: "supervision-decision-guidance",
          value: data.guidance,
        },
      };
    case "ACCEPTED":
      return { label: "Accepted", color: "success" as const };
    case "WAITING":
      return { label: "Waiting", color: "default" as const };
    case "JUDGMENT_REQUESTED":
      return {
        label: "Judgment requested",
        color: "secondary" as const,
        detail: {
          label: "Guidance",
          testId: "supervision-decision-guidance",
          value: data.guidance,
        },
      };
    case "HALTED":
      return {
        label: "Halted",
        color: "error" as const,
        detail: {
          label: "Failure context",
          testId: "supervision-decision-failure-context",
          value: data.failureContext,
        },
      };
    default:
      return assertNever(data);
  }
};

export const SupervisionDecisionMessage = ({
  data,
}: SupervisionDecisionMessageProps) => {
  const outcome = getOutcomePresentation(data);

  return (
    <Box
      data-testid="supervision-decision-message"
      sx={(theme) => ({
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: theme.spacing(2),
      })}
    >
      <Stack spacing={1.5}>
        <Chip
          color={outcome.color}
          data-testid="supervision-decision-outcome"
          label={outcome.label}
          size="small"
          sx={{ alignSelf: "flex-start" }}
        />
        <Typography
          component="div"
          data-testid="supervision-decision-rationale"
        >
          <MarkdownRenderer allowMentionEscapes>
            {data.rationale}
          </MarkdownRenderer>
        </Typography>
        {outcome.detail && (
          <Stack spacing={0.5} data-testid={outcome.detail.testId}>
            <Typography color="text.secondary" variant="caption">
              {outcome.detail.label}
            </Typography>
            <Typography component="div">
              <MarkdownRenderer allowMentionEscapes>
                {outcome.detail.value}
              </MarkdownRenderer>
            </Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  );
};

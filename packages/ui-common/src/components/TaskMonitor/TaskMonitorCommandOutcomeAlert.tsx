import { Alert, Stack, Typography } from "@mui/material";
import {
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  type SubmitTaskMonitorCommandResponseDto,
} from "../../api";

export interface TaskMonitorCommandOutcomeAlertProps {
  outcome: SubmitTaskMonitorCommandResponseDto;
}

export const TaskMonitorCommandOutcomeAlert = ({
  outcome,
}: TaskMonitorCommandOutcomeAlertProps) => {
  if (
    outcome.status !== SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected
  ) {
    return null;
  }
  return (
    <Alert severity="warning" data-testid="task-monitor-command-outcome">
      <Stack spacing={0.5}>
        {outcome.stage ? (
          <Typography variant="body2">Stage: {outcome.stage}</Typography>
        ) : null}
        {outcome.reason ? (
          <Typography variant="body2">Reason: {outcome.reason}</Typography>
        ) : null}
        {outcome.message ? (
          <Typography variant="body2">{outcome.message}</Typography>
        ) : null}
      </Stack>
    </Alert>
  );
};

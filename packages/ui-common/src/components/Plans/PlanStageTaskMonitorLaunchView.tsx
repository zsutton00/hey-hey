import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from "@mui/material";
import type { PlanStageTaskMonitorSetupDraft } from "./planStageTaskMonitorSetup";
import type { PlanStageTaskMonitorSetupState } from "./usePlanStageTaskMonitorSetup";
import { PlanStageTaskMonitorExecutionVisualization } from "./PlanStageTaskMonitorExecutionVisualization";

export interface PlanStageTaskMonitorLaunchViewProps {
  state: PlanStageTaskMonitorSetupState;
  onContinue: (draft: PlanStageTaskMonitorSetupDraft) => void;
  onRetry?: () => void;
}

export const PlanStageTaskMonitorLaunchView = ({
  state,
  onContinue,
  onRetry,
}: PlanStageTaskMonitorLaunchViewProps) => {
  if (state.status === "read-error") {
    return (
      <Alert
        severity="error"
        data-testid="plan-stage-task-monitor-read-error"
        action={
          onRetry ? (
            <Button color="inherit" size="small" onClick={onRetry}>
              Retry
            </Button>
          ) : undefined
        }
      >
        {state.message}
      </Alert>
    );
  }

  if (state.status === "invalid-source") {
    return (
      <Alert
        severity="error"
        data-testid="plan-stage-task-monitor-invalid-source"
      >
        <Stack spacing={0.5}>
          <Typography variant="subtitle2">
            The selected plan stage is invalid.
          </Typography>
          {state.messages.map((message) => (
            <Typography key={message} variant="body2">
              {message}
            </Typography>
          ))}
        </Stack>
      </Alert>
    );
  }

  if (state.status === "no-executable-work") {
    return (
      <Alert
        severity="warning"
        data-testid="plan-stage-task-monitor-no-executable-work"
      >
        {state.messages[0] ?? "This stage has no executable STANDARD Tasks."}
      </Alert>
    );
  }

  const { draft } = state;
  return (
    <Stack spacing={3} data-testid="plan-stage-task-monitor-launch">
      <Box data-testid="plan-stage-task-monitor-provenance">
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Typography variant="h5">Prepare Task Monitor</Typography>
          <Chip label="Plan stage" size="small" />
        </Stack>
        <Typography color="text.secondary" sx={{ mt: 0.5 }}>
          {draft.provenance.planLabel} · {draft.provenance.stageLabel}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Prepared {draft.provenance.preparedAt}
        </Typography>
      </Box>

      <PlanStageTaskMonitorExecutionVisualization
        definition={draft.definition}
        executableTasks={draft.executableTasks}
      />

      <Divider />
      <Button
        variant="contained"
        data-testid="plan-stage-task-monitor-continue"
        onClick={() => onContinue(draft)}
      >
        Continue to monitor setup
      </Button>
    </Stack>
  );
};

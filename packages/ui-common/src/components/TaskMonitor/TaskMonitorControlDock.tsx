import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";
import { Button, CircularProgress, Paper, Stack } from "@mui/material";
import { WorkStatus } from "../../api";
import {
  resolveTaskMonitorLifecycleAction,
  type TaskMonitorStartPresentation,
} from "./taskMonitorStartPresentation";
import type { TaskMonitorPauseResumeAction } from "./useTaskMonitorPauseResume";

const primaryControlButtonSx = {
  width: 40,
  minWidth: 40,
  height: 40,
  minHeight: 40,
  p: 0,
  justifyContent: "center",
} as const;

export interface TaskMonitorControlDockProps {
  monitorStatus: WorkStatus;
  presentation: TaskMonitorStartPresentation;
  pendingAction: TaskMonitorPauseResumeAction | null;
  controlsDisabled?: boolean;
  onStart: () => void;
  onPause: () => void;
}

export const TaskMonitorControlDock = ({
  monitorStatus,
  presentation,
  pendingAction,
  controlsDisabled = false,
  onStart,
  onPause,
}: TaskMonitorControlDockProps) => {
  const lifecycleAction = resolveTaskMonitorLifecycleAction(monitorStatus);
  const lifecyclePending =
    presentation.status === "starting" || pendingAction !== null;
  const disabled = controlsDisabled || lifecyclePending;
  const startDisabled =
    lifecycleAction !== "START" || presentation.status !== "ready" || disabled;
  const pauseDisabled = lifecycleAction !== "PAUSE" || disabled;

  return (
    <Paper
      elevation={8}
      data-testid="task-monitor-control-dock"
      sx={{
        px: 2,
        py: 1.5,
        bgcolor: "background.paper",
        border: 1,
        borderColor: "divider",
        borderRadius: 3,
        width: "max-content",
        maxWidth: "calc(100% - 32px)",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        useFlexGap
        flexWrap="nowrap"
        data-testid="task-monitor-primary-controls"
      >
        <Button
          size="small"
          variant="contained"
          sx={primaryControlButtonSx}
          disabled={startDisabled}
          onClick={onStart}
          aria-label="Start"
          data-testid="task-monitor-start"
        >
          {presentation.status === "starting" || pendingAction === "RESUME" ? (
            <CircularProgress
              color="inherit"
              size={16}
              data-testid="task-monitor-start-progress"
            />
          ) : (
            <PlayArrowIcon />
          )}
        </Button>
        <Button
          size="small"
          variant="contained"
          sx={primaryControlButtonSx}
          disabled={pauseDisabled}
          onClick={onPause}
          aria-label="Pause"
          data-testid="task-monitor-pause"
        >
          {pendingAction === "PAUSE" ? (
            <CircularProgress
              color="inherit"
              size={16}
              data-testid="task-monitor-pause-progress"
            />
          ) : (
            <PauseIcon />
          )}
        </Button>
      </Stack>
    </Paper>
  );
};

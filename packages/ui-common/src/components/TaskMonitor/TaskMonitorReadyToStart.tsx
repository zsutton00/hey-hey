import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { alpha, Box, Button, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { screenButtonColors } from "../ActionsCapsule/capsuleActionButtonColors";
import type { TaskMonitorStartReadiness } from "./taskMonitorStartReadiness";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

const tasksLabel = (count: number): string =>
  count === 1 ? "1 task" : `${count} tasks`;

const stepLabel = (node: TaskMonitorProjectedNode): string =>
  node.task.kind === "loaded"
    ? `${node.position + 1}. ${node.task.task.name}`
    : `Step ${node.position + 1}`;

const joinedSteps = (nodes: readonly TaskMonitorProjectedNode[]): ReactNode =>
  nodes.map((node, index) => (
    <span key={node.taskId}>
      {index > 0 ? ", " : null}
      <strong>{stepLabel(node)}</strong>
    </span>
  ));

interface BlockedReason {
  key: string;
  text: ReactNode;
}

const blockedReasons = ({
  readiness,
  machineSelected,
  hasTasks,
}: {
  readiness: TaskMonitorStartReadiness;
  machineSelected: boolean;
  hasTasks: boolean;
}): BlockedReason[] => {
  const reasons: BlockedReason[] = [];
  const needingService = readiness.tasksNeedingService;
  if (needingService.length > 0) {
    reasons.push({
      key: "service",
      text: (
        <>
          {needingService.length === 1
            ? "1 task needs"
            : `${needingService.length} tasks need`}{" "}
          a Service: {joinedSteps(needingService)}. Choose one on{" "}
          {needingService.length === 1 ? "its card" : "each card"} to enable
          Start.
        </>
      ),
    });
  }
  if (readiness.unloadedTasks.length > 0) {
    reasons.push({
      key: "unloaded",
      text: (
        <>
          {tasksLabel(readiness.unloadedTasks.length)} could not be loaded:{" "}
          {joinedSteps(readiness.unloadedTasks)}. Reload the page to try again.
        </>
      ),
    });
  }
  if (readiness.savingServices) {
    reasons.push({ key: "saving-service", text: "Saving a Service change…" });
  }
  if (readiness.savingWorktreeBranch) {
    reasons.push({
      key: "saving-branch",
      text: "Saving the worktree branch…",
    });
  }
  if (readiness.emptyWorktreeBranch) {
    reasons.push({
      key: "empty-branch",
      text: "Enter a branch name for the shared worktree, or switch it off.",
    });
  }
  if (!machineSelected) {
    reasons.push({
      key: "machine",
      text: "Choose the machine the sessions run on.",
    });
  }
  if (!hasTasks) {
    reasons.push({ key: "tasks", text: "Add tasks to this Task Monitor." });
  }

  return reasons;
};

/**
 * Before Start: how the run works, what still holds Start back, and a Start
 * button that submits the same action as the Action Capsule's.
 */
export function TaskMonitorReadyToStart({
  readiness,
  machineSelected,
  hasTasks,
  startDisabled,
  onStart,
}: {
  readiness: TaskMonitorStartReadiness;
  machineSelected: boolean;
  hasTasks: boolean;
  /** The Action Capsule Start button's own disabled state. */
  startDisabled: boolean;
  onStart: () => void;
}) {
  const reasons = blockedReasons({ readiness, machineSelected, hasTasks });
  const blocked = reasons.length > 0;

  return (
    <Stack
      spacing={1}
      data-testid="task-monitor-coordinator-prestart"
      data-blocked={blocked || undefined}
      sx={{
        p: 2,
        border: 1,
        borderRadius: 1,
        borderColor: blocked ? "warning.light" : "divider",
        bgcolor: (theme) =>
          blocked
            ? alpha(theme.palette.warning.main, 0.08)
            : theme.palette.action.hover,
      }}
    >
      <Typography variant="subtitle1" component="h3" fontWeight={600}>
        {blocked ? "Not ready to start" : "Ready to start"}
      </Typography>
      {reasons.map((reason) => (
        <Typography
          key={reason.key}
          color="text.secondary"
          data-testid="task-monitor-start-blocked-reason"
          data-reason={reason.key}
        >
          {reason.text}
        </Typography>
      ))}
      <Typography variant="subtitle2" component="h4">
        How it works
      </Typography>
      <Box
        component="ol"
        sx={{
          m: 0,
          pl: 2.5,
          color: "text.secondary",
          "& li + li": { mt: 0.5 },
        }}
      >
        <li>
          The monitor works through the selected tasks in order, starting a
          session for each.
        </li>
        <li>Follow its live updates and reply to guide it when needed.</li>
        <li>Active Session shows the session for the current task.</li>
        <li data-testid="task-monitor-automation-note">
          Sessions use the coding provider&apos;s auto mode when available.
        </li>
      </Box>
      <Box>
        <Button
          variant="contained"
          disableElevation
          startIcon={<PlayArrowIcon />}
          aria-label="Start the Task Monitor"
          data-testid="task-monitor-ready-start"
          disabled={startDisabled}
          onClick={onStart}
          sx={(theme) => ({
            mt: 1,
            bgcolor: screenButtonColors[theme.palette.mode].background,
            color: screenButtonColors[theme.palette.mode].foreground,
            "&:hover": {
              bgcolor: screenButtonColors[theme.palette.mode].background,
            },
            // Solid grey at full opacity, never a pale tint.
            "&.Mui-disabled": {
              bgcolor:
                theme.palette.mode === "dark"
                  ? theme.palette.grey[700]
                  : theme.palette.grey[400],
              color:
                theme.palette.mode === "dark"
                  ? theme.palette.grey[400]
                  : theme.palette.grey[800],
            },
          })}
        >
          Start
        </Button>
      </Box>
    </Stack>
  );
}

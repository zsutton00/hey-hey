import { Alert, Box, Stack } from "@mui/material";
import { EntityListItem, taskAdapter } from "../Entity";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

export interface TaskMonitorStepsPaneProps {
  nodes: readonly TaskMonitorProjectedNode[];
  projectId: string;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}

export const TaskMonitorStepsPane = ({
  nodes,
  projectId,
  selectedTaskId,
  onSelectTask,
}: TaskMonitorStepsPaneProps) => {
  if (nodes.length === 0) {
    return (
      <Alert severity="info" data-testid="task-monitor-steps-empty">
        No execution work has been selected.
      </Alert>
    );
  }

  return (
    <Stack
      spacing={1}
      data-testid="task-monitor-steps-pane"
      sx={{ flex: 1, minHeight: 0, overflowY: "auto", p: 2 }}
    >
      {nodes.map((node) => {
        if (node.task.kind === "missing") {
          return (
            <Alert
              key={node.taskId}
              severity="error"
              data-testid="task-monitor-step-missing"
              data-task-id={node.taskId}
            >
              The canonical selected task could not be loaded.
            </Alert>
          );
        }

        const isActive = selectedTaskId
          ? node.taskId === selectedTaskId
          : node.isCursor;
        const itemProps = taskAdapter.toEntityListItemProps(node.task.task, {
          projectId,
          onClick: () => onSelectTask(node.taskId),
        });

        return (
          <Box
            key={node.taskId}
            data-task-id={node.taskId}
            data-active={isActive || undefined}
            sx={{ position: "relative", flexShrink: 0 }}
          >
            <Box
              component="span"
              aria-label={`Step ${node.position + 1}`}
              data-testid="task-monitor-step-number"
              sx={{
                position: "absolute",
                top: -10,
                left: -10,
                zIndex: 1,
                width: 24,
                height: 24,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: 1,
                borderColor: "divider",
                borderRadius: "50%",
                bgcolor: "background.paper",
                color: "text.secondary",
                fontSize: "0.75rem",
                fontWeight: 700,
                lineHeight: 1,
                pointerEvents: "none",
              }}
            >
              {node.position + 1}
            </Box>
            <EntityListItem
              {...itemProps}
              href={undefined}
              displayMode="minimal"
              statusLeadingAdornment={
                isActive ? (
                  <Box
                    component="span"
                    aria-label="Active step"
                    data-testid="task-monitor-active-step"
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      bgcolor: "primary.main",
                      flexShrink: 0,
                    }}
                  />
                ) : undefined
              }
            />
          </Box>
        );
      })}
    </Stack>
  );
};

import { Alert, Box, Stack } from "@mui/material";
import type { ReactNode } from "react";
import { TaskMonitorResultEvidence } from "./TaskMonitorResultEvidence";
import { EntityListItem, taskAdapter } from "../Entity";
import { needsServiceBeforeStart } from "./taskMonitorStartReadiness";
import {
  TaskMonitorTaskSetup,
  type TaskMonitorTaskSetupContext,
} from "./TaskMonitorTaskSetup";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

export interface TaskMonitorStepsPaneProps {
  results?: boolean;
  organizationId?: string;
  nodes: readonly TaskMonitorProjectedNode[];
  projectId: string;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  /** Each card's own session setup; null where cards show no setup. */
  taskSetup: TaskMonitorTaskSetupContext | null;
  /** Controls that act on the cards below, such as applying one setup to all. */
  header: ReactNode;
}

export const TaskMonitorStepsPane = ({
  nodes,
  results = false,
  organizationId,
  projectId,
  selectedTaskId,
  onSelectTask,
  taskSetup,
  header,
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
      {header}
      {nodes.map((node) => {
        if (node.task.kind === "missing") {
          return (
            <Box key={node.taskId}>
              <Alert
                severity="error"
                data-testid="task-monitor-step-missing"
                data-task-id={node.taskId}
              >
                The canonical selected task could not be loaded. Start stays off
                until it loads.
              </Alert>
              {results && organizationId ? (
                <TaskMonitorResultEvidence
                  organizationId={organizationId}
                  projectId={projectId}
                  node={node}
                />
              ) : null}
            </Box>
          );
        }

        const isActive = selectedTaskId
          ? node.taskId === selectedTaskId
          : node.isCursor;
        const itemProps = taskAdapter.toEntityListItemProps(node.task.task, {
          projectId,
          onClick: () => onSelectTask(node.taskId),
        });

        const needsService =
          taskSetup !== null &&
          taskSetup.editable &&
          needsServiceBeforeStart(node);

        return (
          <Box
            key={node.taskId}
            data-testid="task-monitor-task-card"
            data-task-id={node.taskId}
            data-active={isActive || undefined}
            sx={{
              position: "relative",
              flexShrink: 0,
              mb: 1.5,
              border: 1,
              borderColor: needsService ? "warning.main" : "divider",
              borderRadius: 1,
              bgcolor: "background.paper",
            }}
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
              displayMode="list"
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
            {taskSetup ? (
              <Box sx={{ px: 1.25, pb: 1.25 }}>
                <TaskMonitorTaskSetup
                  node={node}
                  projectId={projectId}
                  setup={taskSetup}
                  onOpenSession={() => onSelectTask(node.taskId)}
                />
              </Box>
            ) : null}
            {results && organizationId ? (
              <TaskMonitorResultEvidence
                organizationId={organizationId}
                projectId={projectId}
                node={node}
              />
            ) : null}
          </Box>
        );
      })}
    </Stack>
  );
};

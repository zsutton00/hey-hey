import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  WorkStatus,
} from "../../api";
import {
  Alert,
  Box,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  Typography,
} from "@mui/material";
import React, { useMemo, useState } from "react";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { EntityListItem } from "../Entity";

const TASK_MONITOR_TYPE = "TASK_MONITOR" as const;
const ACTIVE_ONLY_STORAGE_KEY = "task-monitors-active-only";

const readInitialActiveOnly = (): boolean => {
  try {
    return localStorage.getItem(ACTIVE_ONLY_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
};

export interface TaskMonitorActivityTabProps {
  organizationId: string;
  projectId: string;
  buildTaskMonitorPath: (target: TaskMonitorActivityRouteTarget) => string;
}

export type TaskMonitorActivityRouteTarget =
  | { kind: "plan"; planId: string; taskId: string }
  | { kind: "task"; taskId: string };

const resolveTaskMonitorRouteTarget = (
  monitor: WorkItemResponseDto
): TaskMonitorActivityRouteTarget => {
  const owningPlanEdge = monitor.edges?.find((edge) => {
    const isMonitorSource = edge.sourceNodeId === monitor.id;

    return (
      edge.type === AgentEdgeType.RelatedTo &&
      isMonitorSource &&
      edge.targetEntityType === AgentEdgeEndpointEntityType.Task &&
      edge.targetNodeType === "PLAN"
    );
  });

  if (!owningPlanEdge) {
    return { kind: "task", taskId: monitor.id };
  }

  const planId = owningPlanEdge.targetNodeId;

  return { kind: "plan", planId, taskId: monitor.id };
};

const selectUniqueTaskMonitors = (
  workItems: readonly WorkItemResponseDto[]
): WorkItemResponseDto[] => {
  const monitorsById = new Map<string, WorkItemResponseDto>();

  for (const workItem of workItems) {
    if (workItem.type === TASK_MONITOR_TYPE && !monitorsById.has(workItem.id)) {
      monitorsById.set(workItem.id, workItem);
    }
  }

  return [...monitorsById.values()];
};

const TaskMonitorActivityLoadingState = () => (
  <Stack
    alignItems="center"
    spacing={2}
    sx={{ py: 8 }}
    data-testid="task-monitor-activity-loading"
  >
    <CircularProgress />
    <Typography color="text.secondary">Loading automation…</Typography>
  </Stack>
);

const TaskMonitorActivityEmptyState = () => (
  <Box
    sx={{ p: 4, textAlign: "center" }}
    data-testid="task-monitor-activity-empty"
  >
    <Typography color="text.secondary">
      No Task Monitors are available for this project yet.
    </Typography>
  </Box>
);

export const TaskMonitorActivityTab: React.FC<TaskMonitorActivityTabProps> = ({
  buildTaskMonitorPath,
  organizationId,
  projectId,
}) => {
  const [activeOnly, setActiveOnly] = useState(readInitialActiveOnly);
  const { workItems, error, isFetched, isLoading } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      edgeTypes: [AgentEdgeType.RelatedTo],
      includeEdges: true,
      taskType: TASK_MONITOR_TYPE,
      ...(activeOnly ? { status: WorkStatus.Active } : {}),
    }
  );
  const monitors = useMemo(
    () => selectUniqueTaskMonitors(workItems),
    [workItems]
  );

  const activeOnlyControl = (
    <FormControlLabel
      control={
        <Switch
          checked={activeOnly}
          onChange={(event) => {
            const nextActiveOnly = event.target.checked;
            setActiveOnly(nextActiveOnly);
            try {
              localStorage.setItem(
                ACTIVE_ONLY_STORAGE_KEY,
                String(nextActiveOnly)
              );
            } catch {
              // localStorage unavailable
            }
          }}
        />
      }
      label="Active only"
    />
  );

  if (isLoading || !isFetched) {
    return (
      <Stack spacing={1.5}>
        {activeOnlyControl}
        <TaskMonitorActivityLoadingState />
      </Stack>
    );
  }

  if (error) {
    return (
      <Stack spacing={1.5}>
        {activeOnlyControl}
        <Alert severity="error" data-testid="task-monitor-activity-error">
          {error.message}
        </Alert>
      </Stack>
    );
  }

  if (monitors.length === 0) {
    return (
      <Stack spacing={1.5}>
        {activeOnlyControl}
        <TaskMonitorActivityEmptyState />
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      {activeOnlyControl}
      <Stack spacing={1} data-testid="task-monitor-activity-list">
        {monitors.map((monitor) => (
          <EntityListItem
            key={monitor.id}
            title={monitor.name}
            entityKindLabel="Task Monitor"
            entityKindIcon="task"
            status={monitor.status}
            createdAt={monitor.createdAt}
            href={buildTaskMonitorPath(resolveTaskMonitorRouteTarget(monitor))}
          />
        ))}
      </Stack>
    </Stack>
  );
};

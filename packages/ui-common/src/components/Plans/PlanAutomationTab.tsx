import { Alert, Box, CircularProgress, Stack, Typography } from "@mui/material";
import React, { useCallback, useMemo, useState } from "react";
import { AgentEdgeEndpointEntityType, AgentEdgeType } from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { EntityListItem } from "../Entity";
import { TASK_MONITOR_TYPE } from "./PlanStageTaskMonitorCreateOrReopen.utils";

export interface PlanAutomationTabProps {
  organizationId: string;
  projectId: string;
  planId: string;
  buildTaskMonitorPath: (monitorId: string) => string;
}

export const selectUniqueTaskMonitors = (
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

const PlanAutomationLoadingState = () => (
  <Stack
    alignItems="center"
    spacing={2}
    sx={{ py: 8 }}
    data-testid="plan-automation-loading"
  >
    <CircularProgress />
    <Typography color="text.secondary">Loading automation…</Typography>
  </Stack>
);

const PlanAutomationEmptyState = () => (
  <Box sx={{ p: 4, textAlign: "center" }} data-testid="plan-automation-empty">
    <Typography color="text.secondary">
      No Task Monitors are related to this plan yet.
    </Typography>
  </Box>
);

const toMutationError = (error: unknown): Error => {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string") {
    return new Error(error);
  }

  return new Error("Unable to delete the Task Monitor.");
};

export const PlanAutomationTab: React.FC<PlanAutomationTabProps> = ({
  organizationId,
  projectId,
  planId,
  buildTaskMonitorPath,
}) => {
  const { workItems, error, isFetched, isLoading, refetch, remove } =
    useWorkItems(organizationId, "task", projectId, undefined, {
      taskType: TASK_MONITOR_TYPE,
      relatedEntityId: planId,
      relatedEntityType: AgentEdgeEndpointEntityType.Task,
      edgeTypes: [AgentEdgeType.RelatedTo],
    });
  const [mutationError, setMutationError] = useState<Error | null>(null);
  const monitors = useMemo(
    () => selectUniqueTaskMonitors(workItems),
    [workItems]
  );

  const handleDelete = useCallback(
    (monitorId: string) => {
      setMutationError(null);

      void remove(monitorId)
        .then(() => refetch())
        .catch((mutationFailure: unknown) => {
          setMutationError(toMutationError(mutationFailure));
        });
    },
    [refetch, remove]
  );

  if (isLoading || !isFetched) {
    return <PlanAutomationLoadingState />;
  }

  if (error) {
    return (
      <Alert severity="error" data-testid="plan-automation-error">
        {error.message}
      </Alert>
    );
  }

  if (monitors.length === 0) {
    return <PlanAutomationEmptyState />;
  }

  return (
    <Stack spacing={1} data-testid="plan-automation-list">
      {mutationError && (
        <Alert severity="error" data-testid="plan-automation-delete-error">
          {mutationError.message}
        </Alert>
      )}
      {monitors.map((monitor) => (
        <EntityListItem
          key={monitor.id}
          title={monitor.name}
          entityKindLabel="Task Monitor"
          entityKindIcon="task"
          createdAt={monitor.createdAt}
          href={buildTaskMonitorPath(monitor.id)}
          onDelete={() => handleDelete(monitor.id)}
        />
      ))}
    </Stack>
  );
};

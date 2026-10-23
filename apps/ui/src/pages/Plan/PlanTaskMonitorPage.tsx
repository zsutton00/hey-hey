import { createNavigationLineageEntry } from "@hey-hey/ui-common";
import type { TaskResponseDto } from "@hey-hey/ui-common/api";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
} from "@hey-hey/ui-common/context";
import { useWorkItem } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { useParams } from "react-router-dom";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";
import { TaskMonitorResponsiveWorkspace } from "../../components/TaskMonitorResponsiveWorkspace";
import { PlanPage } from "./PlanPage";

export const PlanTaskMonitorPage = () => {
  const identity = useUserIdentity();
  const { projectId, planId, stageId, monitorId } = useParams<{
    projectId?: string;
    planId?: string;
    stageId?: string;
    monitorId?: string;
  }>();
  const organizationId = identity?.currentOrgId?.trim() ?? "";
  const resolvedProjectId = projectId?.trim() ?? "";
  const resolvedPlanId = planId?.trim() ?? "";
  const resolvedStageId = stageId?.trim() ?? "";
  const resolvedMonitorId = monitorId?.trim() ?? "";
  const { workItem, isLoading, error } = useWorkItem(
    organizationId,
    "task",
    resolvedMonitorId,
    {
      projectId: resolvedProjectId,
      enabled:
        !!organizationId && !!resolvedProjectId && !!resolvedMonitorId,
    },
  );

  if (
    !organizationId ||
    !resolvedProjectId ||
    !resolvedPlanId ||
    !resolvedMonitorId
  ) {
    return (
      <Alert severity="error" data-testid="plan-task-monitor-missing-context">
        Organization, project, plan, and Task Monitor context are required to
        open this Task Monitor.
      </Alert>
    );
  }

  if (error) {
    return (
      <Alert severity="error" data-testid="plan-task-monitor-unavailable">
        Unable to resolve the requested Task Monitor.
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "50vh",
          gap: 2,
        }}
      >
        <CircularProgress
          size={40}
          data-testid="plan-task-monitor-loading"
        />
        <Typography variant="body1" color="text.secondary">
          Loading Task Monitor...
        </Typography>
      </Box>
    );
  }

  const monitor = workItem as TaskResponseDto | null;
  if (!monitor || monitor.type !== WORK_ITEM_TYPE_KEYS.TaskMonitor) {
    return (
      <Alert severity="error" data-testid="plan-task-monitor-unavailable">
        Unable to resolve the requested Task Monitor.
      </Alert>
    );
  }

  const lineage = [
    createNavigationLineageEntry("plan", resolvedPlanId),
    ...(resolvedStageId
      ? [createNavigationLineageEntry("plan_stage", resolvedStageId)]
      : []),
  ];

  const monitorContent = (
    <CanonicalPageBoundary
      composition={{
        kind: "canonical",
        descriptor: createCanonicalPageDescriptor(
          "task",
          resolvedMonitorId,
          lineage,
          { kind: "task", label: monitor.name, taskType: monitor.type },
        ),
      }}
    >
      <TaskMonitorResponsiveWorkspace
        organizationId={organizationId}
        projectId={resolvedProjectId}
        monitorId={resolvedMonitorId}
      />
    </CanonicalPageBoundary>
  );

  return (
    <PlanPage
      organizationId={organizationId}
      projectId={resolvedProjectId}
      planId={resolvedPlanId}
      stageId={resolvedStageId || undefined}
      view="automation"
      automationHeightMode="remaining-viewport"
      automationContent={monitorContent}
    />
  );
};

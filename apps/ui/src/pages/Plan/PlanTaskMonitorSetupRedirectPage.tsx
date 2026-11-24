import { Alert, Box, CircularProgress } from "@mui/material";
import {
  isRelatedNonTerminalTaskMonitor,
  TASK_MONITOR_TYPE,
} from "@hey-hey/ui-common/components";
import { useWorkItems } from "@hey-hey/ui-common/data";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
} from "@hey-hey/contracts/api";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { Navigate, useParams } from "react-router-dom";
import {
  buildPlanTabPath,
  buildPlanTaskMonitorPath,
} from "./planSessionRoutes";

/**
 * The retired stage setup address. It never creates a monitor: it opens the
 * stage's monitor when exactly one unfinished monitor is related to the stage,
 * and the Plan's Automation tab otherwise, where the monitors are listed.
 */
export const PlanTaskMonitorSetupRedirectPage = () => {
  const identity = useUserIdentity();
  const { projectId, planId, stageId } = useParams<{
    projectId?: string;
    planId?: string;
    stageId?: string;
  }>();
  const organizationId = identity?.currentOrgId?.trim() ?? "";
  const resolvedProjectId = projectId?.trim() ?? "";
  const resolvedPlanId = planId?.trim() ?? "";
  const resolvedStageId = stageId?.trim() ?? "";
  const hasRequiredContext = Boolean(
    organizationId && resolvedProjectId && resolvedPlanId && resolvedStageId,
  );
  const { workItems, isFetched, error } = useWorkItems(
    organizationId,
    "task",
    resolvedProjectId,
    undefined,
    {
      enabled: hasRequiredContext,
      taskType: TASK_MONITOR_TYPE,
      relatedEntityId: resolvedStageId,
      relatedEntityType: AgentEdgeEndpointEntityType.Task,
      edgeTypes: [AgentEdgeType.RelatedTo],
    },
  );

  if (!hasRequiredContext) {
    return (
      <Alert severity="error" data-testid="plan-task-monitor-missing-context">
        Organization, project, plan, and stage context are required to open this
        stage&apos;s Task Monitor.
      </Alert>
    );
  }

  const automationTab = buildPlanTabPath(
    resolvedProjectId,
    resolvedPlanId,
    resolvedStageId,
    "automation",
  );
  if (error) {
    return <Navigate replace to={automationTab} />;
  }
  if (!isFetched) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress data-testid="plan-task-monitor-setup-redirect-loading" />
      </Box>
    );
  }

  const openMonitorIds = [
    ...new Set(
      workItems
        .filter(isRelatedNonTerminalTaskMonitor)
        .map((monitor) => monitor.id),
    ),
  ];
  const [onlyMonitorId] = openMonitorIds;
  if (openMonitorIds.length === 1 && onlyMonitorId) {
    return (
      <Navigate
        replace
        to={buildPlanTaskMonitorPath(
          resolvedProjectId,
          resolvedPlanId,
          resolvedStageId,
          onlyMonitorId,
        )}
      />
    );
  }

  return <Navigate replace to={automationTab} />;
};

import { Alert, Box } from "@mui/material";
import { PlanStageTaskMonitorCreateOrReopen } from "@hey-hey/ui-common/components";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { PlanPage } from "./PlanPage";
import { buildPlanTaskMonitorPath } from "./planSessionRoutes";

export const PlanTaskMonitorSetupPage = () => {
  const identity = useUserIdentity();
  const navigate = useNavigate();
  const { projectId, planId, stageId } = useParams<{
    projectId?: string;
    planId?: string;
    stageId?: string;
  }>();
  const organizationId = identity?.currentOrgId?.trim() ?? "";
  const userId = identity?.userId?.trim() ?? "";
  const resolvedProjectId = projectId?.trim() ?? "";
  const resolvedPlanId = planId?.trim() ?? "";
  const resolvedStageId = stageId?.trim() ?? "";
  const hasRequiredContext = Boolean(
    organizationId &&
    userId &&
    resolvedProjectId &&
    resolvedPlanId &&
    resolvedStageId,
  );

  const handleMonitorReady = useCallback(
    (monitorId: string) => {
      if (!monitorId || !hasRequiredContext) return;
      navigate(
        buildPlanTaskMonitorPath(
          resolvedProjectId,
          resolvedPlanId,
          resolvedStageId,
          monitorId,
        ),
      );
    },
    [
      hasRequiredContext,
      navigate,
      resolvedPlanId,
      resolvedProjectId,
      resolvedStageId,
    ],
  );

  if (!hasRequiredContext) {
    return (
      <Alert severity="error" data-testid="plan-task-monitor-missing-context">
        Authenticated user, organization, project, plan, and stage context are
        required to prepare a Task Monitor.
      </Alert>
    );
  }

  return (
    <PlanPage
      organizationId={organizationId}
      projectId={resolvedProjectId}
      planId={resolvedPlanId}
      stageId={resolvedStageId}
      view="automation"
      automationHeightMode="auto"
      automationContent={
        <Box sx={{ maxWidth: 960, mx: "auto" }}>
          <PlanStageTaskMonitorCreateOrReopen
            organizationId={organizationId}
            projectId={resolvedProjectId}
            planId={resolvedPlanId}
            stageId={resolvedStageId}
            onMonitorReady={handleMonitorReady}
          />
        </Box>
      }
    />
  );
};

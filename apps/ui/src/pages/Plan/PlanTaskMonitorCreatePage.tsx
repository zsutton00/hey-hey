import { Alert, Box } from "@mui/material";
import { PlanStageTaskMonitorCreateOrReopen } from "@hey-hey/ui-common/components";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { useCallback } from "react";
import {
  Navigate,
  NavigationType,
  useLocation,
  useNavigate,
  useNavigationType,
  useParams,
} from "react-router-dom";
import { PlanPage } from "./PlanPage";
import {
  buildPlanTabPath,
  buildPlanTaskMonitorPath,
  hasPlanTaskMonitorCreateIntent,
} from "./planSessionRoutes";

/**
 * Creates a stage's Task Monitor for one Automate click and opens its
 * workspace. Only a new push carrying the click's intent starts creation.
 * Reloads and history traversal can retain the state but arrive as POPs.
 */
export const PlanTaskMonitorCreatePage = () => {
  const identity = useUserIdentity();
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const createRequested =
    navigationType === NavigationType.Push &&
    hasPlanTaskMonitorCreateIntent(location.state);
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
        { replace: true },
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

  if (!createRequested) {
    return (
      <Navigate
        replace
        to={buildPlanTabPath(
          resolvedProjectId,
          resolvedPlanId,
          resolvedStageId,
          "automation",
        )}
      />
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

import {
  createNavigationLineageEntry,
  type NavigationLineage,
} from "@hey-hey/ui-common";

export const buildAgentSessionNavigationLineage = ({
  planId,
  stageId,
  taskId,
}: {
  routeFamily: "project" | "plan" | "task";
  planId?: string;
  stageId?: string;
  stepId?: string;
  taskId?: string;
}): NavigationLineage | null => {
  if (planId) {
    return [
      createNavigationLineageEntry("task", planId),
      ...(stageId ? [createNavigationLineageEntry("task", stageId)] : []),
      ...(taskId ? [createNavigationLineageEntry("task", taskId)] : []),
    ];
  }

  if (taskId) {
    return [createNavigationLineageEntry("task", taskId)];
  }

  return null;
};

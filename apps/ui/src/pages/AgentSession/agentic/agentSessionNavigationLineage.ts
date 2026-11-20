import {
  createNavigationLineageEntry,
  type NavigationLineage,
} from "@hey-hey/ui-common";

export const buildAgentSessionNavigationLineage = ({
  planId,
  stageId,
  taskId,
  parentAgentSessionId,
}: {
  routeFamily: "project" | "plan" | "task";
  planId?: string;
  stageId?: string;
  stepId?: string;
  taskId?: string;
  parentAgentSessionId?: string;
}): NavigationLineage | null => {
  const entries = [
    ...(planId ? [createNavigationLineageEntry("task", planId)] : []),
    ...(planId && stageId
      ? [createNavigationLineageEntry("task", stageId)]
      : []),
    ...(taskId ? [createNavigationLineageEntry("task", taskId)] : []),
    ...(parentAgentSessionId
      ? [createNavigationLineageEntry("agent_session", parentAgentSessionId)]
      : []),
  ];

  return entries.length > 0 ? entries : null;
};

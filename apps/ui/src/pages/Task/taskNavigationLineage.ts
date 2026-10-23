import {
  createNavigationLineageEntry,
  type NavigationLineage,
} from "@hey-hey/ui-common";

export const buildTaskNavigationLineage = ({
  taskId,
  parentTaskId,
  planId,
  stageId,
}: {
  taskId: string;
  parentTaskId?: string | null;
  planId?: string;
  stageId?: string;
}): NavigationLineage => [
  ...(planId ? [createNavigationLineageEntry("task", planId)] : []),
  ...(stageId ? [createNavigationLineageEntry("task", stageId)] : []),
  ...(parentTaskId && parentTaskId !== stageId && parentTaskId !== planId
    ? [createNavigationLineageEntry("task", parentTaskId)]
    : []),
  createNavigationLineageEntry("task", taskId),
];

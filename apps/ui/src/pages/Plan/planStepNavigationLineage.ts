import {
  createNavigationLineageEntry,
  type NavigationLineage,
} from "@hey-hey/ui-common";

export const buildPlanStepNavigationLineage = ({
  planId,
  stageId,
  stepId,
  taskId,
}: {
  planId: string;
  stageId: string;
  stepId: string;
  taskId?: string;
}): NavigationLineage => [
  createNavigationLineageEntry("plan", planId),
  createNavigationLineageEntry("plan_stage", stageId),
  createNavigationLineageEntry("plan_step", stepId),
  ...(taskId ? [createNavigationLineageEntry("task", taskId)] : []),
];

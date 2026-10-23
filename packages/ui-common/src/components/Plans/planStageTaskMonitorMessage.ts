export interface PlanStageTaskMonitorMessageSource {
  organizationId: string;
  projectId: string;
  planId: string;
  stageId: string;
}

export const buildPlanStageTaskMonitorUserMessageStorageKey = ({
  organizationId,
  projectId,
  planId,
  stageId,
}: PlanStageTaskMonitorMessageSource): string =>
  [
    "plan-stage-task-monitor-message",
    organizationId,
    projectId,
    planId,
    stageId,
  ].join(":");

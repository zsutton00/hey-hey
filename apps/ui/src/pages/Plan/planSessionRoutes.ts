export type PlanStepTab =
  "details" | "data-debug" | "agent-sessions" | "conversations";

export const buildPlansIndexPath = (projectId: string): string =>
  `/projects/${projectId}/plans`;

export const buildPlanDetailPath = (
  projectId: string,
  planId: string,
): string => `${buildPlansIndexPath(projectId)}/${planId}`;

export type PlanTab =
  | "plan"
  | "updates"
  | "documents"
  | "data-debug"
  | "conversations"
  | "admin"
  | "automation";

const buildPlanStagePath = (
  projectId: string,
  planId: string,
  stageId?: string,
): string =>
  stageId
    ? `${buildPlanDetailPath(projectId, planId)}/stages/${stageId}`
    : buildPlanDetailPath(projectId, planId);

export const buildPlanTabPath = (
  projectId: string,
  planId: string,
  stageId: string | undefined,
  tab: PlanTab,
): string => {
  const planPath = buildPlanStagePath(projectId, planId, stageId);
  if (tab === "plan") {
    return planPath;
  }

  const searchParams = new URLSearchParams();
  searchParams.set("tab", tab);
  return `${planPath}?${searchParams.toString()}`;
};

/**
 * Where an Automate click creates a stage's Task Monitor. Only a new push
 * carrying {@link PLAN_TASK_MONITOR_CREATE_INTENT} creates one; a refresh,
 * bookmark or Back to this address opens the Automation tab instead.
 */
export const buildPlanTaskMonitorCreatePath = (
  projectId: string,
  planId: string,
  stageId: string,
): string =>
  `${buildPlanStagePath(projectId, planId, stageId)}/task-monitor/new`;

export const PLAN_TASK_MONITOR_CREATE_INTENT = {
  createTaskMonitor: true,
} as const;

/** History state is untyped; this is the one place it is read. */
export const hasPlanTaskMonitorCreateIntent = (
  state: unknown,
): state is typeof PLAN_TASK_MONITOR_CREATE_INTENT =>
  typeof state === "object" &&
  state !== null &&
  "createTaskMonitor" in state &&
  state.createTaskMonitor === true;

export const buildPlanTaskMonitorPath = (
  projectId: string,
  planId: string,
  stageId: string | undefined,
  monitorId: string,
): string =>
  `${buildPlanStagePath(projectId, planId, stageId)}/task-monitor/${monitorId}`;

export const buildPlanStepPath = (
  projectId: string,
  planId: string,
  stageId?: string,
  stepId?: string,
): string => {
  if (stageId && stepId) {
    return `${buildPlanDetailPath(projectId, planId)}/stages/${stageId}/steps/${stepId}`;
  }

  return buildPlanDetailPath(projectId, planId);
};

export const buildPlanAgentSessionPath = (
  projectId: string,
  planId: string,
  agentSessionId: string,
  stageId?: string,
  stepId?: string,
): string => {
  if (stageId && stepId) {
    return `${buildPlanStepPath(
      projectId,
      planId,
      stageId,
      stepId,
    )}/agent-sessions/${agentSessionId}`;
  }

  return `${buildPlanDetailPath(projectId, planId)}/agent-sessions/${agentSessionId}`;
};

export const buildPlanStepTabPath = (
  projectId: string,
  planId: string,
  stageId: string,
  stepId: string,
  tab: PlanStepTab,
): string => {
  const stepPath = buildPlanStepPath(projectId, planId, stageId, stepId);
  if (tab === "details") {
    return stepPath;
  }

  const searchParams = new URLSearchParams();
  searchParams.set("tab", tab);
  return `${stepPath}?${searchParams.toString()}`;
};

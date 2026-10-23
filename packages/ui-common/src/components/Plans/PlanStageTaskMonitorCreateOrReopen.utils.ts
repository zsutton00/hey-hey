import type { CreateTaskDto, TaskMonitorExecutionDefinition } from "../../api";

export const TASK_MONITOR_TYPE = "TASK_MONITOR" as const;
export const TASK_MONITOR_SUMMARY_SECTION_KEY = "summary" as const;
export const TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY =
  "executionDefinition" as const;

export interface PlanStageTaskMonitorSourceContext {
  organizationId: string;
  projectId: string;
  planId: string;
  planParentTaskId: string;
  stageId: string;
  planLabel: string;
  stageLabel: string;
  createdBySessionId?: string | null;
}

export const buildPlanStageTaskMonitorCreateDto = (
  context: PlanStageTaskMonitorSourceContext,
  definition: TaskMonitorExecutionDefinition,
): CreateTaskDto => {
  const name = `${context.planLabel} — ${context.stageLabel} monitor`;
  return {
    name,
    type: TASK_MONITOR_TYPE,
    parentTaskId: context.planParentTaskId,
    sections: [
      {
        key: TASK_MONITOR_SUMMARY_SECTION_KEY,
        content: `Monitors the reviewed execution definition for ${context.planLabel} — ${context.stageLabel}.`,
        order: 0,
      },
      {
        key: TASK_MONITOR_EXECUTION_DEFINITION_SECTION_KEY,
        content: definition,
        order: 1,
      },
    ],
  };
};

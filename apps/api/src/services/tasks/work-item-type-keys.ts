export type WorkItemTypeKey = string;

export const WORK_ITEM_TYPE_KEYS = {
  Standard: 'STANDARD',
  Bug: 'BUG',
  Feature: 'FEATURE',
  Goal: 'GOAL',
  Plan: 'PLAN',
  PlanStage: 'PLAN_STAGE',
  Contract: 'CONTRACT',
  Diagram: 'DIAGRAM',
  DiagramElement: 'DIAGRAM_ELEMENT',
  Workflow: 'workflow',
  WorkflowStep: 'workflow_step',
  TaskMonitor: 'TASK_MONITOR',
  Mode: 'MODE',
  Eval: 'EVAL',
  EvalCase: 'EVAL_CASE',
  Decision: 'decision',
  Mockup: 'mockup',
} as const;

export type BuiltInWorkItemTypeKey =
  (typeof WORK_ITEM_TYPE_KEYS)[keyof typeof WORK_ITEM_TYPE_KEYS];

/** Work-item types that may sit directly under a Plan Stage as executable work. */
export const PLAN_STAGE_WORK_TYPE_KEYS: readonly string[] = [
  WORK_ITEM_TYPE_KEYS.Standard,
  WORK_ITEM_TYPE_KEYS.Bug,
];

export function isPlanStageWorkType(type: string | null | undefined): boolean {
  return type != null && PLAN_STAGE_WORK_TYPE_KEYS.includes(type);
}

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
} as const;

export type BuiltInWorkItemTypeKey =
  (typeof WORK_ITEM_TYPE_KEYS)[keyof typeof WORK_ITEM_TYPE_KEYS];

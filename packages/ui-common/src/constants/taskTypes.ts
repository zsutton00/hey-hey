export const STANDARD_TASK_TYPE = "STANDARD" as const;
export const BUG_TASK_TYPE = "BUG" as const;
export const FEATURE_TASK_TYPE = "FEATURE" as const;
export const GOAL_TASK_TYPE = "GOAL" as const;
export const DIAGRAM_TASK_TYPE = "DIAGRAM" as const;
export const DIAGRAM_ELEMENT_TASK_TYPE = "DIAGRAM_ELEMENT" as const;
/** Historical aliases accepted at read/navigation boundaries only. */
export const WORKFLOW_TASK_TYPE = "workflow" as const;
export const WORKFLOW_STEP_TASK_TYPE = "workflow_step" as const;
export type WorkItemTypeKey = string;

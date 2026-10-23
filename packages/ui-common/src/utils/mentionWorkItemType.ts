import {
  BUG_TASK_TYPE,
  FEATURE_TASK_TYPE,
  GOAL_TASK_TYPE,
  STANDARD_TASK_TYPE,
  WORKFLOW_STEP_TASK_TYPE,
  WORKFLOW_TASK_TYPE,
} from "../constants/taskTypes";

const MENTION_TYPE_TO_WORK_ITEM_TYPE_KEY: Readonly<Record<string, string>> = {
  standard: STANDARD_TASK_TYPE,
  bug: BUG_TASK_TYPE,
  feature: FEATURE_TASK_TYPE,
  goal: GOAL_TASK_TYPE,
  contract: "CONTRACT",
  workflow: WORKFLOW_TASK_TYPE,
  workflow_step: WORKFLOW_STEP_TASK_TYPE,
  workflowstep: WORKFLOW_STEP_TASK_TYPE,
  task_monitor: "TASK_MONITOR",
  taskmonitor: "TASK_MONITOR",
};

/** Platform mention kinds whose registry key is a fixed alias. */
export const resolveMentionWorkItemTypeAlias = (
  entityType: string
): string | undefined =>
  MENTION_TYPE_TO_WORK_ITEM_TYPE_KEY[entityType.toLowerCase()];

/**
 * Maps a mention kind to a registered work-item type key: a platform alias, or
 * a registry key the kind names directly (custom types mention by their key).
 * Kinds that name no registered type, such as the generic `task`, resolve to
 * `undefined`; callers wait for the work item's own `type` instead of
 * requesting a key the registry does not have.
 */
export const resolveMentionWorkItemTypeKey = (
  entityType: string,
  registeredKeys: readonly string[]
): string | undefined => {
  const alias = resolveMentionWorkItemTypeAlias(entityType);
  if (alias) return alias;
  const kind = entityType.toLowerCase();
  return registeredKeys.find((key) => key.toLowerCase() === kind);
};

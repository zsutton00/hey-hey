import {
  RelationshipValue,
  WorkStatus,
  type ContextRelatedEntityDto,
} from "@hey-hey/ui-common/api";
import { WORK_ITEM_TYPE_KEYS } from "../../types/workItemTypes";

const SATISFIED_DEPENDENCY_STATUSES: ReadonlySet<string> = new Set([
  WorkStatus.Completed,
  WorkStatus.Verifying,
]);

const DEPENDENCY_PREFLIGHT_TASK_TYPES: ReadonlySet<string> = new Set([
  WORK_ITEM_TYPE_KEYS.Standard,
  WORK_ITEM_TYPE_KEYS.Bug,
]);

export type TaskSessionLaunchState =
  | { kind: "idle" }
  | {
      kind: "dependencyWarning";
      dependencies: readonly ContextRelatedEntityDto[];
    }
  | { kind: "inactiveTaskCheck" }
  | { kind: "creating" };

export interface TaskSessionLaunchContext {
  relatedEntities: readonly ContextRelatedEntityDto[];
  taskType: string;
  taskNeedsActivation: boolean;
}

export const selectUnfinishedTaskDependencies = (
  relatedEntities: readonly ContextRelatedEntityDto[],
): ContextRelatedEntityDto[] =>
  relatedEntities.filter(
    (entity) =>
      entity.entityType === "TASK" &&
      entity.relationship === RelationshipValue.DependsOn &&
      DEPENDENCY_PREFLIGHT_TASK_TYPES.has(entity.taskType ?? "") &&
      !SATISFIED_DEPENDENCY_STATUSES.has(entity.status ?? ""),
  );

const stateAfterDependencyWarning = (
  taskNeedsActivation: boolean,
): TaskSessionLaunchState =>
  taskNeedsActivation ? { kind: "inactiveTaskCheck" } : { kind: "creating" };

export const startTaskSessionLaunch = ({
  relatedEntities,
  taskNeedsActivation,
}: TaskSessionLaunchContext): TaskSessionLaunchState => {
  const dependencies = selectUnfinishedTaskDependencies(relatedEntities);

  return dependencies.length > 0
    ? { kind: "dependencyWarning", dependencies }
    : stateAfterDependencyWarning(taskNeedsActivation);
};

export const continueTaskSessionLaunch = (
  state: TaskSessionLaunchState,
  taskNeedsActivation: boolean,
): TaskSessionLaunchState => {
  switch (state.kind) {
    case "dependencyWarning":
      return stateAfterDependencyWarning(taskNeedsActivation);
    case "inactiveTaskCheck":
      return { kind: "creating" };
    case "idle":
    case "creating":
      return state;
  }
};

export const cancelTaskSessionLaunch = (): TaskSessionLaunchState => ({
  kind: "idle",
});

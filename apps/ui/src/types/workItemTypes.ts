import {
  WorkItemTypeRole,
  type WorkItemIconKey,
  type WorkItemTypeCapabilities,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";

export type WorkItemSectionSelection =
  | {
      status: "resolved";
      typeKey: string;
      sections: WorkItemTypeDefinitionDto["sections"];
    }
  | {
      status: "unavailable";
      reason: "missing-type" | "loading" | "unresolved";
    };

export const WORK_ITEM_TYPE_KEYS = {
  Standard: "STANDARD",
  Bug: "BUG",
  Feature: "FEATURE",
  Goal: "GOAL",
  Eval: "EVAL",
  EvalCase: "EVAL_CASE",
  Contract: "CONTRACT",
  Diagram: "DIAGRAM",
  DiagramElement: "DIAGRAM_ELEMENT",
  // Historical persisted discriminators remain readable aliases.
  Workflow: "workflow",
  WorkflowStep: "workflow_step",
  TaskMonitor: "TASK_MONITOR",
} as const;

export type KnownWorkItemType =
  (typeof WORK_ITEM_TYPE_KEYS)[keyof typeof WORK_ITEM_TYPE_KEYS];

const BUILT_IN_WORK_ITEM_ICON_KEYS: Partial<
  Record<KnownWorkItemType, WorkItemIconKey>
> = {
  [WORK_ITEM_TYPE_KEYS.Standard]: "task",
  [WORK_ITEM_TYPE_KEYS.Bug]: "bug",
  [WORK_ITEM_TYPE_KEYS.Feature]: "feature",
  [WORK_ITEM_TYPE_KEYS.Goal]: "goal",
  [WORK_ITEM_TYPE_KEYS.Contract]: "contract",
  [WORK_ITEM_TYPE_KEYS.Diagram]: "workflow",
  [WORK_ITEM_TYPE_KEYS.Workflow]: "workflow",
  [WORK_ITEM_TYPE_KEYS.TaskMonitor]: "task",
};

/**
 * Compatibility for built-in registry rows created before iconKey was
 * persisted. A definition must still be present and keyed exactly; unknown
 * or unresolved work-item types remain fail-closed.
 */
export const getBuiltInWorkItemIconKey = (
  typeKey: string,
  definition: WorkItemTypeDefinitionDto | undefined,
): WorkItemIconKey | undefined => {
  if (
    !definition ||
    definition.key !== typeKey ||
    definition.iconKey !== undefined
  ) {
    return undefined;
  }

  return BUILT_IN_WORK_ITEM_ICON_KEYS[typeKey as KnownWorkItemType];
};

const WORK_ITEM_TYPE_LABELS: Record<KnownWorkItemType, string> = {
  [WORK_ITEM_TYPE_KEYS.Standard]: "Task",
  [WORK_ITEM_TYPE_KEYS.Bug]: "Bug",
  [WORK_ITEM_TYPE_KEYS.Feature]: "Feature",
  [WORK_ITEM_TYPE_KEYS.Goal]: "Goal",
  [WORK_ITEM_TYPE_KEYS.Eval]: "Eval",
  [WORK_ITEM_TYPE_KEYS.EvalCase]: "Eval Case",
  [WORK_ITEM_TYPE_KEYS.Contract]: "Contract",
  [WORK_ITEM_TYPE_KEYS.Diagram]: "Diagram",
  [WORK_ITEM_TYPE_KEYS.DiagramElement]: "Diagram Element",
  [WORK_ITEM_TYPE_KEYS.Workflow]: "Diagram",
  [WORK_ITEM_TYPE_KEYS.WorkflowStep]: "Diagram Element",
  [WORK_ITEM_TYPE_KEYS.TaskMonitor]: "Task Monitor",
};

export const getWorkItemTypeLabel = (type: string): string | undefined =>
  WORK_ITEM_TYPE_LABELS[type as KnownWorkItemType];

export const getWorkItemTypeDisplayName = (
  definition: WorkItemTypeDefinitionDto | undefined,
): string | undefined => definition?.name.trim() || undefined;

export const getWorkItemTypePluralDisplayName = (
  definition: WorkItemTypeDefinitionDto | undefined,
): string | undefined => {
  const name = getWorkItemTypeDisplayName(definition);
  if (!name) return undefined;

  switch (definition?.key) {
    case WORK_ITEM_TYPE_KEYS.Standard:
      return "Tasks";
    case WORK_ITEM_TYPE_KEYS.Feature:
      return "Features";
    case WORK_ITEM_TYPE_KEYS.Bug:
      return "Bugs";
    case WORK_ITEM_TYPE_KEYS.Goal:
      return "Goals";
    case WORK_ITEM_TYPE_KEYS.Contract:
      return "Contracts";
    default:
      return name;
  }
};

export const indexWorkItemTypeDefinitions = (
  summaries: readonly WorkItemTypeSummaryDto[],
): ReadonlyMap<string, WorkItemTypeDefinitionDto> =>
  new Map(
    summaries.map((summary) => [summary.definition.key, summary.definition]),
  );

/**
 * Index definitions that can be used for new child navigation and creation.
 * Every effective definition must belong to the project whose registry is
 * being consumed. Missing project context and legacy global rows fail closed.
 */
export const selectActiveWorkItemTypeDefinitions = (
  summaries: readonly WorkItemTypeSummaryDto[],
  projectId?: string,
): ReadonlyMap<string, WorkItemTypeDefinitionDto> =>
  new Map(
    summaries
      .filter(
        (summary) =>
          summary.status === "ACTIVE" &&
          Boolean(projectId?.trim()) &&
          summary.projectId === projectId,
      )
      .map((summary) => [summary.definition.key, summary.definition]),
  );

export const selectResolvedWorkItemSections = (input: {
  typeKey: string | null | undefined;
  definition: WorkItemTypeDefinitionDto | undefined;
  isFetched: boolean;
}): WorkItemSectionSelection => {
  if (!input.typeKey) return { status: "unavailable", reason: "missing-type" };
  if (!input.isFetched) return { status: "unavailable", reason: "loading" };
  if (!input.definition || input.definition.key !== input.typeKey) {
    return { status: "unavailable", reason: "unresolved" };
  }

  return {
    status: "resolved",
    typeKey: input.typeKey,
    sections: input.definition.sections,
  };
};

type BooleanWorkItemTypeCapability = {
  [Key in keyof WorkItemTypeCapabilities]-?: NonNullable<
    WorkItemTypeCapabilities[Key]
  > extends boolean
    ? Key
    : never;
}[keyof WorkItemTypeCapabilities];

const hasWorkItemTypeCapability = (
  definition: WorkItemTypeDefinitionDto | undefined,
  capability: BooleanWorkItemTypeCapability,
): boolean => definition?.capabilities?.[capability] === true;

export const workItemTypeSurfacesLifecycleScalars = (
  definition: WorkItemTypeDefinitionDto | undefined,
): boolean => hasWorkItemTypeCapability(definition, "planEligible");

export const workItemTypeOffersStatusChoice = (
  definition: WorkItemTypeDefinitionDto | undefined,
): boolean => (definition?.allowedStatuses.length ?? 0) > 1;

export const canWorkItemTypeOwnAgentSessions = (
  definition: WorkItemTypeDefinitionDto | undefined,
): boolean => definition?.role === WorkItemTypeRole.WorkItem;

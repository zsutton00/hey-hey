import {
  AgentEdgeType,
  PlanConfigurationV1SchemaVersionEnum,
  PlanType,
  type ProposalValidationIssue,
  type PlanConfigurationV1,
  type WorkItemTypeDefinitionDto,
  type WorkItemTypeSummaryDto,
} from "../../api";
import type { WorkItemResponseDto } from "../collections/workItems";

export const PLAN_WORK_ITEM_TYPE = "PLAN" as const;
export const PLAN_STAGE_WORK_ITEM_TYPE = "PLAN_STAGE" as const;
export const STANDARD_WORK_ITEM_TYPE = "STANDARD" as const;
export const PLAN_CONFIGURATION_SECTION_KEY = "planConfiguration" as const;

export interface PlanWorkItem extends WorkItemResponseDto {
  type: typeof PLAN_WORK_ITEM_TYPE;
}

export interface PlanStageWorkItem extends WorkItemResponseDto {
  type: typeof PLAN_STAGE_WORK_ITEM_TYPE;
  parentTaskId: string;
}

export interface PlanStageStandardTask extends WorkItemResponseDto {
  type: typeof STANDARD_WORK_ITEM_TYPE;
  parentTaskId: string;
}

export interface CanonicalPlanStageSource {
  plan: PlanWorkItem;
  stage: PlanStageWorkItem;
  tasks: readonly PlanStageStandardTask[];
  configuration: PlanConfigurationV1;
}

export interface CanonicalPlanSourceError {
  code: "invalid-source";
  messages: string[];
}

export interface CanonicalPlanRecoveryContext {
  plan: PlanWorkItem;
  configuration: PlanConfigurationV1;
}

export interface CanonicalPlanAggregateError extends CanonicalPlanSourceError {
  issues: ProposalValidationIssue[];
  recovery: CanonicalPlanRecoveryContext | null;
}

export type CanonicalPlanStageSourceResult =
  | { ok: true; source: CanonicalPlanStageSource }
  | { ok: false; error: CanonicalPlanSourceError };

export interface CanonicalPlanTaskGraph {
  orderedTasks: PlanStageStandardTask[];
  dependenciesByTaskId: ReadonlyMap<string, readonly string[]>;
}

export interface CanonicalPlanAggregateStage extends CanonicalPlanTaskGraph {
  stage: PlanStageWorkItem;
}

export interface CanonicalPlanAggregate {
  plan: PlanWorkItem;
  configuration: PlanConfigurationV1;
  stages: CanonicalPlanAggregateStage[];
}

export type CanonicalPlanAggregateResult =
  | { ok: true; aggregate: CanonicalPlanAggregate }
  | { ok: false; error: CanonicalPlanAggregateError };

interface RequiredPlanTypeContract {
  key: string;
  parentType: string;
  requiredSectionKey?: string;
  dependencyTargetType?: string;
}

const REQUIRED_PLAN_TYPE_CONTRACTS: readonly RequiredPlanTypeContract[] = [
  {
    key: PLAN_WORK_ITEM_TYPE,
    parentType: "FEATURE",
    requiredSectionKey: PLAN_CONFIGURATION_SECTION_KEY,
  },
  {
    key: PLAN_STAGE_WORK_ITEM_TYPE,
    parentType: PLAN_WORK_ITEM_TYPE,
    dependencyTargetType: PLAN_STAGE_WORK_ITEM_TYPE,
  },
  {
    key: STANDARD_WORK_ITEM_TYPE,
    parentType: PLAN_STAGE_WORK_ITEM_TYPE,
    dependencyTargetType: STANDARD_WORK_ITEM_TYPE,
  },
] as const;

const isNonEmpty = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const addMessage = (messages: string[], message: string): void => {
  if (!messages.includes(message)) messages.push(message);
};

const addValidationIssue = (
  issues: ProposalValidationIssue[],
  issue: ProposalValidationIssue
): void => {
  if (
    !issues.some(
      (existing) =>
        existing.field === issue.field && existing.code === issue.code
    )
  ) {
    issues.push(issue);
  }
};

const compareWorkItems = (
  first: WorkItemResponseDto,
  second: WorkItemResponseDto
): number => {
  const createdAtComparison = (first.createdAt ?? "").localeCompare(
    second.createdAt ?? ""
  );
  return createdAtComparison !== 0
    ? createdAtComparison
    : first.id.localeCompare(second.id);
};

const dependencyIdsFor = (
  item: WorkItemResponseDto,
  allowedTargetIds: ReadonlySet<string>
): string[] => [
  ...new Set(
    (item.edges ?? []).flatMap((edge) =>
      edge.type === AgentEdgeType.DependsOn &&
      edge.sourceNodeId === item.id &&
      allowedTargetIds.has(edge.targetNodeId)
        ? [edge.targetNodeId]
        : []
    )
  ),
];

const topologicallyOrder = <T extends WorkItemResponseDto>(input: {
  items: readonly T[];
  dependenciesById: ReadonlyMap<string, readonly string[]>;
  cycleMessage: string;
  messages: string[];
}): T[] | null => {
  const itemsById = new Map(input.items.map((item) => [item.id, item]));
  if (itemsById.size !== input.items.length) {
    addMessage(
      input.messages,
      "Canonical Plan Work Item identities must be unique."
    );
    return null;
  }
  const dependentsById = new Map<string, string[]>();
  const remainingById = new Map<string, number>();
  for (const item of input.items) {
    const dependencies = input.dependenciesById.get(item.id) ?? [];
    if (dependencies.includes(item.id)) {
      addMessage(input.messages, "A Work Item cannot depend on itself.");
      return null;
    }
    remainingById.set(item.id, dependencies.length);
    for (const dependencyId of dependencies) {
      const dependents = dependentsById.get(dependencyId) ?? [];
      dependents.push(item.id);
      dependentsById.set(dependencyId, dependents);
    }
  }
  const ready = input.items
    .filter((item) => remainingById.get(item.id) === 0)
    .sort(compareWorkItems);
  const ordered: T[] = [];
  while (ready.length > 0) {
    const item = ready.shift();
    if (!item) break;
    ordered.push(item);
    for (const dependentId of dependentsById.get(item.id) ?? []) {
      const remaining = (remainingById.get(dependentId) ?? 0) - 1;
      remainingById.set(dependentId, remaining);
      if (remaining === 0) {
        const dependent = itemsById.get(dependentId);
        if (dependent) {
          ready.push(dependent);
          ready.sort(compareWorkItems);
        }
      }
    }
  }
  if (ordered.length !== input.items.length) {
    addMessage(input.messages, input.cycleMessage);
    return null;
  }
  return ordered;
};

export const buildCanonicalPlanTaskGraph = (
  tasks: readonly PlanStageStandardTask[],
  messages: string[] = []
): CanonicalPlanTaskGraph | null => {
  const taskIds = new Set(tasks.map((task) => task.id));
  const dependenciesByTaskId = new Map(
    tasks.map((task) => [task.id, dependencyIdsFor(task, taskIds)])
  );
  const orderedTasks = topologicallyOrder({
    items: tasks,
    dependenciesById: dependenciesByTaskId,
    cycleMessage: "Plan Stage Task dependencies must be acyclic.",
    messages,
  });
  return orderedTasks ? { orderedTasks, dependenciesByTaskId } : null;
};

const supportsDependencyTarget = (
  definition: WorkItemTypeDefinitionDto,
  targetType: string
): boolean =>
  definition.edgeTargets?.some(
    (target) =>
      target.edgeType === AgentEdgeType.DependsOn &&
      (target.targetTypeKeys.length === 0 ||
        target.targetTypeKeys.includes(targetType))
  ) ?? false;

export const validateCanonicalPlanRegistry = (
  snapshot: readonly WorkItemTypeSummaryDto[]
): string[] => {
  const definitionsByKey = new Map(
    snapshot.map((item) => [item.definition.key, item.definition])
  );
  const messages: string[] = [];
  const missingKeys = REQUIRED_PLAN_TYPE_CONTRACTS.map(
    (contract) => contract.key
  ).filter((key) => !definitionsByKey.has(key));
  if (missingKeys.length > 0) {
    messages.push(
      `The effective Work Item type registry is missing ${missingKeys.join(
        ", "
      )}.`
    );
  }
  for (const contract of REQUIRED_PLAN_TYPE_CONTRACTS) {
    const definition = definitionsByKey.get(contract.key);
    if (!definition) continue;
    if (
      (contract.key !== PLAN_WORK_ITEM_TYPE &&
        definition.capabilities?.requiresParent !== true) ||
      !definition.allowedParentTypes?.includes(contract.parentType)
    ) {
      messages.push(
        `${contract.key} must require a ${contract.parentType} parent in the effective Work Item type registry.`
      );
    }
    if (
      contract.requiredSectionKey &&
      !definition.sections.some(
        (section) => section.key === contract.requiredSectionKey
      )
    ) {
      messages.push(
        `${contract.key} is missing its ${contract.requiredSectionKey} section in the effective Work Item type registry.`
      );
    }
    if (
      contract.dependencyTargetType &&
      !supportsDependencyTarget(definition, contract.dependencyTargetType)
    ) {
      messages.push(
        `${contract.key} cannot create DEPENDS_ON edges to ${contract.dependencyTargetType} in the effective Work Item type registry.`
      );
    }
  }
  return messages;
};

export const isPlanWorkItem = (
  item: WorkItemResponseDto
): item is PlanWorkItem => item.type === PLAN_WORK_ITEM_TYPE;

export const isPlanStageWorkItem = (
  item: WorkItemResponseDto
): item is PlanStageWorkItem =>
  item.type === PLAN_STAGE_WORK_ITEM_TYPE && isNonEmpty(item.parentTaskId);

export const isPlanStageStandardTask = (
  item: WorkItemResponseDto
): item is PlanStageStandardTask =>
  item.type === STANDARD_WORK_ITEM_TYPE && isNonEmpty(item.parentTaskId);

const isPlanType = (value: unknown): value is PlanType =>
  value === PlanType.Standard || value === PlanType.Mini;

const isPlanConfiguration = (value: unknown): value is PlanConfigurationV1 => {
  if (typeof value !== "object" || value === null) return false;
  const configuration = value as Record<string, unknown>;
  return (
    configuration.schemaVersion ===
      PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1 &&
    isPlanType(configuration.planType) &&
    (configuration.worktreeBranch === null ||
      isNonEmpty(
        typeof configuration.worktreeBranch === "string"
          ? configuration.worktreeBranch
          : undefined
      ))
  );
};

const readPlanConfiguration = (
  plan: WorkItemResponseDto
): PlanConfigurationV1 | null => {
  const serialized = plan.sections?.find(
    (section) => section.key === PLAN_CONFIGURATION_SECTION_KEY
  )?.materializedMarkdown;
  if (!isNonEmpty(serialized)) return null;
  try {
    const value: unknown = JSON.parse(serialized);
    return isPlanConfiguration(value) ? value : null;
  } catch {
    return null;
  }
};

export const parseCanonicalPlanStageSource = (input: {
  plan: WorkItemResponseDto | null;
  stageId: string;
  descendants: readonly WorkItemResponseDto[];
}): CanonicalPlanStageSourceResult => {
  const messages: string[] = [];
  if (!input.plan) {
    return {
      ok: false,
      error: {
        code: "invalid-source",
        messages: ["The selected Plan is unavailable."],
      },
    };
  }
  if (!isPlanWorkItem(input.plan)) {
    addMessage(messages, "The selected item must be a PLAN.");
  }
  const stageCandidate = input.descendants.find(
    (item) => item.id === input.stageId
  );
  if (!stageCandidate || !isPlanStageWorkItem(stageCandidate)) {
    addMessage(messages, "The selected Plan Stage is unavailable.");
  } else if (stageCandidate.parentTaskId !== input.plan.id) {
    addMessage(
      messages,
      "The selected Plan Stage is not a direct child of the selected Plan."
    );
  }
  const configuration = readPlanConfiguration(input.plan);
  if (!configuration) {
    addMessage(
      messages,
      "The Plan is missing a valid planConfiguration section."
    );
  }
  if (messages.length > 0 || !isPlanWorkItem(input.plan) || !stageCandidate) {
    return { ok: false, error: { code: "invalid-source", messages } };
  }
  if (!isPlanStageWorkItem(stageCandidate) || !configuration) {
    return { ok: false, error: { code: "invalid-source", messages } };
  }
  const tasks: PlanStageStandardTask[] = [];
  for (const descendant of input.descendants) {
    if (descendant.parentTaskId !== stageCandidate.id) continue;
    if (!isPlanStageStandardTask(descendant)) {
      addMessage(
        messages,
        "Every direct Plan Stage child must be a STANDARD Task."
      );
      continue;
    }
    tasks.push(descendant);
  }
  return messages.length > 0
    ? { ok: false, error: { code: "invalid-source", messages } }
    : {
        ok: true,
        source: {
          plan: input.plan,
          stage: stageCandidate,
          tasks,
          configuration,
        },
      };
};

export const composeCanonicalPlanAggregate = (input: {
  plan: WorkItemResponseDto | null;
  descendants: readonly WorkItemResponseDto[];
}): CanonicalPlanAggregateResult => {
  const messages: string[] = [];
  const issues: ProposalValidationIssue[] = [];
  if (!input.plan || !isPlanWorkItem(input.plan)) {
    return {
      ok: false,
      error: {
        code: "invalid-source",
        messages: ["The selected item must be a PLAN."],
        issues,
        recovery: null,
      },
    };
  }
  const configuration = readPlanConfiguration(input.plan);
  if (!configuration) {
    addMessage(
      messages,
      "The Plan is missing a valid planConfiguration section."
    );
  }
  const stageCandidates = input.descendants.filter(
    (item) => item.parentTaskId === input.plan?.id
  );
  const stages: PlanStageWorkItem[] = [];
  for (const candidate of stageCandidates) {
    if (!isPlanStageWorkItem(candidate)) {
      addMessage(messages, "Every direct Plan child must be a PLAN_STAGE.");
    } else {
      stages.push(candidate);
    }
  }
  const allItems = [input.plan, ...input.descendants];
  if (
    allItems.some(
      (item) =>
        item.organizationId !== input.plan?.organizationId ||
        item.projectId !== input.plan?.projectId
    )
  ) {
    addMessage(
      messages,
      "Every canonical Plan Work Item must share organization and project scope."
    );
  }

  const stageIds = new Set(stages.map((stage) => stage.id));
  const stageDependencies = new Map(
    stages.map((stage) => [stage.id, dependencyIdsFor(stage, stageIds)])
  );
  const externalStageDependency = stages.some((stage) =>
    (stage.edges ?? []).some(
      (edge) =>
        edge.type === AgentEdgeType.DependsOn &&
        edge.sourceNodeId === stage.id &&
        !stageIds.has(edge.targetNodeId)
    )
  );
  if (externalStageDependency) {
    addMessage(
      messages,
      "Plan Stages may depend only on Stages in the same Plan."
    );
    for (const stage of stages) {
      for (const edge of stage.edges ?? []) {
        if (
          edge.type === AgentEdgeType.DependsOn &&
          edge.sourceNodeId === stage.id &&
          !stageIds.has(edge.targetNodeId)
        ) {
          addValidationIssue(issues, {
            field: `stages.${stage.id}.dependencies.${edge.targetNodeId}`,
            code: "PLAN_STAGE_DEPENDENCY_SCOPE",
            reason: "Plan Stages may depend only on Stages in the same Plan.",
            layer: "structural",
            suggestion:
              "Remove the relationship to the external Work Item or make the target a direct Stage in this Plan.",
          });
        }
      }
    }
  }
  if (stages.length > 0) {
    const rootCount = stages.filter(
      (stage) => (stageDependencies.get(stage.id) ?? []).length === 0
    ).length;
    const hasInvalidPredecessorCount = stages.some(
      (stage) => (stageDependencies.get(stage.id) ?? []).length > 1
    );
    const dependentCounts = new Map<string, number>();
    for (const dependencies of stageDependencies.values()) {
      for (const dependencyId of dependencies) {
        dependentCounts.set(
          dependencyId,
          (dependentCounts.get(dependencyId) ?? 0) + 1
        );
      }
    }
    if (
      rootCount !== 1 ||
      hasInvalidPredecessorCount ||
      [...dependentCounts.values()].some((count) => count > 1)
    ) {
      addMessage(
        messages,
        "Plan Stage dependencies must form one linear chain."
      );

      const addLinearChainIssue = (field: string): void => {
        addValidationIssue(issues, {
          field,
          code: "PLAN_STAGE_LINEAR_CHAIN",
          reason: "Plan Stage dependencies must form one linear chain.",
          layer: "structural",
          suggestion:
            "Each Plan Stage must have at most one immediate predecessor, and each predecessor must have at most one direct successor.",
        });
      };

      if (rootCount !== 1) {
        const rootStages = stages.filter(
          (stage) => (stageDependencies.get(stage.id) ?? []).length === 0
        );
        for (const stage of rootStages) {
          addLinearChainIssue(`stages.${stage.id}.dependencies`);
        }
        if (rootStages.length === 0) addLinearChainIssue("stages");
      }

      for (const stage of stages) {
        const dependencies = stageDependencies.get(stage.id) ?? [];
        if (dependencies.length > 1) {
          for (const dependencyId of dependencies) {
            addLinearChainIssue(
              `stages.${stage.id}.dependencies.${dependencyId}`
            );
          }
        }
      }

      for (const [dependencyId, dependentCount] of dependentCounts) {
        if (dependentCount <= 1) continue;
        for (const stage of stages) {
          if ((stageDependencies.get(stage.id) ?? []).includes(dependencyId)) {
            addLinearChainIssue(
              `stages.${stage.id}.dependencies.${dependencyId}`
            );
          }
        }
      }
    }
  }
  const orderedStages = topologicallyOrder({
    items: stages,
    dependenciesById: stageDependencies,
    cycleMessage: "Plan Stage dependencies must be acyclic.",
    messages,
  });
  const aggregateStages: CanonicalPlanAggregateStage[] = [];
  for (const stage of orderedStages ?? []) {
    const directChildren = input.descendants.filter(
      (item) => item.parentTaskId === stage.id
    );
    const tasks: PlanStageStandardTask[] = [];
    for (const child of directChildren) {
      if (!isPlanStageStandardTask(child)) {
        addMessage(
          messages,
          "Every direct Plan Stage child must be a STANDARD Task."
        );
      } else {
        tasks.push(child);
      }
    }
    const graph = buildCanonicalPlanTaskGraph(tasks, messages);
    if (graph) aggregateStages.push({ stage, ...graph });
  }
  return messages.length > 0 || !configuration || !orderedStages
    ? {
        ok: false,
        error: {
          code: "invalid-source",
          messages,
          issues,
          recovery: configuration ? { plan: input.plan, configuration } : null,
        },
      }
    : {
        ok: true,
        aggregate: { plan: input.plan, configuration, stages: aggregateStages },
      };
};

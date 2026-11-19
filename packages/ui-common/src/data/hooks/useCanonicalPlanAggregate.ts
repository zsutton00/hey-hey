import { AgentEdgeType, type ProposalValidationIssue } from "../../api";
import {
  composeCanonicalPlanAggregate,
  PLAN_STAGE_WORK_ITEM_TYPE,
  BUG_WORK_ITEM_TYPE,
  STANDARD_WORK_ITEM_TYPE,
  validateCanonicalPlanRegistry,
  type CanonicalPlanAggregate,
  type CanonicalPlanRecoveryContext,
} from "../plans/canonicalPlan";
import { useWorkItem } from "./useWorkItem";
import { useWorkItems } from "./useWorkItems";
import { useWorkItemTypes } from "./useWorkItemTypes";

export type { CanonicalPlanAggregate } from "../plans/canonicalPlan";

const MAX_PARENT_TASK_IDS = 200;
const MAX_TASK_RESULTS = 500;

export type UseCanonicalPlanAggregateReturn =
  | { status: "loading"; aggregate: null; error: null }
  | { status: "ready"; aggregate: CanonicalPlanAggregate; error: null }
  | {
      status: "error";
      aggregate: null;
      error: Error;
      validationIssues: ProposalValidationIssue[];
      recovery: CanonicalPlanRecoveryContext | null;
    };

const sectionKeysFor = (
  workItemTypes: ReturnType<typeof useWorkItemTypes>["workItemTypes"],
  typeKey: string,
): string[] =>
  workItemTypes
    .find((item) => item.definition.key === typeKey)
    ?.definition.sections.map((section) => section.key) ?? [];

const errorResult = (message: string): UseCanonicalPlanAggregateReturn => ({
  status: "error",
  aggregate: null,
  error: new Error(message),
  validationIssues: [],
  recovery: null,
});

export const useCanonicalPlanAggregate = (
  organizationId: string,
  projectId: string,
  planId: string,
): UseCanonicalPlanAggregateReturn => {
  const hasScope = Boolean(organizationId && projectId && planId);
  const registryQuery = useWorkItemTypes(organizationId || undefined, {
    projectId: projectId || undefined,
    enabled: hasScope,
  });
  const registryMessages = registryQuery.isReady
    ? validateCanonicalPlanRegistry(registryQuery.workItemTypes)
    : [];
  const registryIsValid =
    registryQuery.isReady && registryMessages.length === 0;

  const planQuery = useWorkItem(
    organizationId || "__noop__",
    "task",
    planId || "__noop__",
    {
      projectId: projectId || undefined,
      includeEdges: true,
      enabled: hasScope,
    },
  );

  const stageQuery = useWorkItems(
    organizationId || "__noop__",
    "task",
    projectId || "__noop__",
    undefined,
    {
      enabled: hasScope && registryIsValid,
      parentTaskId: planId || undefined,
      taskType: PLAN_STAGE_WORK_ITEM_TYPE,
      includeSectionKeys: sectionKeysFor(
        registryQuery.workItemTypes,
        PLAN_STAGE_WORK_ITEM_TYPE,
      ),
      includeEdges: true,
      edgeTypes: [AgentEdgeType.DependsOn],
      limit: MAX_PARENT_TASK_IDS + 1,
    },
  );

  const stageIds = stageQuery.workItems.map((stage) => stage.id);
  const canLoadTasks =
    registryIsValid &&
    stageQuery.isFetched &&
    stageIds.length > 0 &&
    stageIds.length <= MAX_PARENT_TASK_IDS;
  // Query each supported stage-work type by itself so a custom type that is
  // allowed under a stage neither invalidates the Plan nor consumes the limit.
  const stageWorkQueryOptions = (typeKey: string) => ({
    enabled: canLoadTasks,
    parentTaskIds: stageIds,
    taskType: typeKey,
    includeSectionKeys: sectionKeysFor(registryQuery.workItemTypes, typeKey),
    includeServiceRelations: true,
    includeEdges: true,
    edgeTypes: [AgentEdgeType.DependsOn],
    limit: MAX_TASK_RESULTS,
  });
  const taskQuery = useWorkItems(
    organizationId || "__noop__",
    "task",
    projectId || "__noop__",
    undefined,
    stageWorkQueryOptions(STANDARD_WORK_ITEM_TYPE),
  );
  const bugQuery = useWorkItems(
    organizationId || "__noop__",
    "task",
    projectId || "__noop__",
    undefined,
    stageWorkQueryOptions(BUG_WORK_ITEM_TYPE),
  );
  const stageWorkQueries = [taskQuery, bugQuery];

  if (!hasScope) return errorResult("Plan scope identifiers are required.");
  if (registryQuery.error) return errorResult(registryQuery.error.message);
  if (planQuery.error) return errorResult(planQuery.error.message);
  if (stageQuery.error) return errorResult(stageQuery.error.message);
  const failedQuery = stageWorkQueries.find((query) => query.error);
  if (failedQuery?.error) return errorResult(failedQuery.error.message);
  if (!registryQuery.isReady || !planQuery.isFetched) {
    return { status: "loading", aggregate: null, error: null };
  }
  if (registryMessages.length > 0) {
    return errorResult(registryMessages.join(" "));
  }
  if (!planQuery.workItem)
    return errorResult("The selected Plan is unavailable.");
  if (!stageQuery.isFetched) {
    return { status: "loading", aggregate: null, error: null };
  }
  if (stageIds.length > MAX_PARENT_TASK_IDS) {
    return errorResult(
      `A Plan may contain at most ${MAX_PARENT_TASK_IDS} Stages for one aggregate read.`,
    );
  }
  if (
    stageIds.length > 0 &&
    !stageWorkQueries.every((query) => query.isFetched)
  ) {
    return { status: "loading", aggregate: null, error: null };
  }
  if (
    stageWorkQueries.some((query) => query.workItems.length >= MAX_TASK_RESULTS)
  ) {
    return errorResult(
      `The Plan Task batch reached the ${MAX_TASK_RESULTS}-item response limit, so aggregate completeness cannot be verified.`,
    );
  }

  const result = composeCanonicalPlanAggregate({
    plan: planQuery.workItem,
    descendants: [
      ...stageQuery.workItems,
      ...stageWorkQueries.flatMap((query) => query.workItems),
    ],
  });
  return result.ok
    ? { status: "ready", aggregate: result.aggregate, error: null }
    : {
        status: "error",
        aggregate: null,
        error: new Error(result.error.messages.join(" ")),
        validationIssues: result.error.issues,
        recovery: result.error.recovery,
      };
};

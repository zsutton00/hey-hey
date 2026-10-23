import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeType,
  PlanConfigurationV1SchemaVersionEnum,
  PlanType,
  TaskSource,
  WorkStatus,
  type WorkItemTypeSummaryDto,
} from "../../../api";
import type {
  PlanStageStandardTask,
  PlanStageWorkItem,
  PlanWorkItem,
} from "../../plans/canonicalPlan";
import { useCanonicalPlanAggregate } from "../useCanonicalPlanAggregate";

const mocks = vi.hoisted(() => ({
  useWorkItem: vi.fn(),
  useWorkItems: vi.fn(),
  useWorkItemTypes: vi.fn(),
}));

vi.mock("../useWorkItem", () => ({ useWorkItem: mocks.useWorkItem }));
vi.mock("../useWorkItems", () => ({ useWorkItems: mocks.useWorkItems }));
vi.mock("../useWorkItemTypes", () => ({
  useWorkItemTypes: mocks.useWorkItemTypes,
}));

const plan: PlanWorkItem = {
  id: "plan-1",
  name: "Canonical Plan",
  type: "PLAN",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
  sections: [
    {
      id: "configuration",
      key: "planConfiguration",
      order: 0,
      materializedMarkdown: JSON.stringify({
        schemaVersion: PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1,
        planType: PlanType.Standard,
        worktreeBranch: null,
      }),
    },
  ],
};

const stage: PlanStageWorkItem = {
  id: "stage-1",
  name: "Build",
  type: "PLAN_STAGE",
  parentTaskId: plan.id,
  organizationId: plan.organizationId,
  projectId: plan.projectId,
  status: WorkStatus.Active,
  source: TaskSource.System,
};

const task: PlanStageStandardTask = {
  id: "task-1",
  name: "Implement",
  type: "STANDARD",
  parentTaskId: stage.id,
  organizationId: plan.organizationId,
  projectId: plan.projectId,
  status: WorkStatus.Ready,
  source: TaskSource.System,
};

const registryItem = (key: string): WorkItemTypeSummaryDto => ({
  id: `${key}-definition`,
  projectId: plan.projectId,
  effectiveSource: "CANONICAL",
  status: "ACTIVE",
  definition: {
    key,
    name: key,
    sections:
      key === "PLAN"
        ? [{ key: "planConfiguration", label: "Plan configuration" }]
        : key === "PLAN_STAGE"
        ? [{ key: "description", label: "Description" }]
        : [{ key: "acceptanceCriteria", label: "Acceptance criteria" }],
    allowedStatuses: [WorkStatus.Backlog],
    allowedParentTypes:
      key === "PLAN"
        ? ["FEATURE"]
        : key === "PLAN_STAGE"
        ? ["PLAN"]
        : ["PLAN_STAGE"],
    capabilities: { requiresParent: key !== "PLAN" },
    edgeTargets:
      key === "PLAN_STAGE" || key === "STANDARD"
        ? [{ edgeType: AgentEdgeType.DependsOn, targetTypeKeys: [key] }]
        : [],
  },
});

const registry = [
  registryItem("PLAN"),
  registryItem("PLAN_STAGE"),
  registryItem("STANDARD"),
];

const collectionResult = (
  workItems: readonly (PlanStageWorkItem | PlanStageStandardTask)[]
) => ({
  workItems,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  error: null,
});

describe("useCanonicalPlanAggregate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useWorkItemTypes.mockReturnValue({
      workItemTypes: registry,
      isReady: true,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    });
    mocks.useWorkItem.mockReturnValue({
      workItem: plan,
      isFetched: true,
      isLoading: false,
      error: null,
    });
    mocks.useWorkItems.mockImplementation(
      (_organizationId, _entityType, _projectId, _conversationId, options) =>
        options?.parentTaskIds
          ? collectionResult([task])
          : collectionResult([stage])
    );
  });

  it("loads a standalone Plan under the optional-parent registry", () => {
    mocks.useWorkItem.mockReturnValue({
      workItem: { ...plan, parentTaskId: undefined },
      isFetched: true,
      isLoading: false,
      error: null,
    });
    const { result } = renderHook(() =>
      useCanonicalPlanAggregate("org-1", "project-1", "plan-1")
    );
    expect(result.current.status).toBe("ready");
    expect(result.current.aggregate?.plan.parentTaskId).toBeUndefined();
    expect(result.current.aggregate?.stages[0]?.orderedTasks).toEqual([task]);
  });

  it("loads all direct Stage children and Standard grandchildren in batches", () => {
    const { result } = renderHook(() =>
      useCanonicalPlanAggregate("org-1", "project-1", "plan-1")
    );

    expect(result.current.status).toBe("ready");
    expect(result.current.aggregate?.stages[0]?.orderedTasks).toEqual([task]);
    expect(mocks.useWorkItems).toHaveBeenNthCalledWith(
      1,
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        parentTaskId: "plan-1",
        taskType: "PLAN_STAGE",
        includeEdges: true,
        limit: 201,
      })
    );
    expect(mocks.useWorkItems).toHaveBeenNthCalledWith(
      2,
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({
        parentTaskIds: ["stage-1"],
        taskType: "STANDARD",
        includeServiceRelations: true,
        limit: 500,
      })
    );
  });

  it("fails closed before hierarchy reads when the registry is incomplete", () => {
    mocks.useWorkItemTypes.mockReturnValue({
      workItemTypes: registry.slice(0, 2),
      isReady: true,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    });

    const { result } = renderHook(() =>
      useCanonicalPlanAggregate("org-1", "project-1", "plan-1")
    );

    expect(result.current.status).toBe("error");
    expect(result.current.error?.message).toContain("missing STANDARD");
    expect(mocks.useWorkItems).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      undefined,
      expect.objectContaining({ enabled: false })
    );
  });
});

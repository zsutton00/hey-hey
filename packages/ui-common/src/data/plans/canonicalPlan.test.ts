import { describe, expect, it } from "vitest";
import {
  AgentEdgeType,
  PlanConfigurationV1SchemaVersionEnum,
  PlanType,
  TaskSource,
  WorkStatus,
  type AgentEdgeResponseDto,
} from "../../api";
import type { WorkItemResponseDto } from "../collections/workItems";
import { applyTaskSectionInputsToMaterialized } from "../../utils/workItemSections";
import {
  composeCanonicalPlanAggregate,
  type PlanStageStandardTask,
  type PlanStageWorkItem,
  type PlanWorkItem,
} from "./canonicalPlan";

const edge = (
  sourceNodeId: string,
  targetNodeId: string
): AgentEdgeResponseDto => ({
  id: `${sourceNodeId}-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
  type: AgentEdgeType.DependsOn,
});

const plan: PlanWorkItem = {
  id: "plan-1",
  name: "Canonical plan",
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

const stage = (id: string, dependencies: string[] = []): PlanStageWorkItem => ({
  id,
  name: id,
  type: "PLAN_STAGE",
  parentTaskId: plan.id,
  organizationId: plan.organizationId,
  projectId: plan.projectId,
  status: WorkStatus.Backlog,
  source: TaskSource.System,
  edges: dependencies.map((dependencyId) => edge(id, dependencyId)),
});

const task = (
  id: string,
  parentTaskId: string,
  dependencies: string[] = []
): PlanStageStandardTask => ({
  id,
  name: id,
  type: "STANDARD",
  parentTaskId,
  organizationId: plan.organizationId,
  projectId: plan.projectId,
  status: WorkStatus.Backlog,
  source: TaskSource.System,
  edges: dependencies.map((dependencyId) => edge(id, dependencyId)),
});

describe("composeCanonicalPlanAggregate", () => {
  it("keeps a Plan valid during the optimistic generation worktree update", () => {
    const configuration = {
      schemaVersion: PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1,
      planType: PlanType.Standard,
      worktreeBranch: "plan-generation",
    };
    const optimisticPlan = {
      ...plan,
      sections: applyTaskSectionInputsToMaterialized(plan.sections, [
        { key: "planConfiguration", content: configuration },
      ]),
    };
    const result = composeCanonicalPlanAggregate({
      plan: optimisticPlan,
      descendants: [],
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.aggregate.configuration).toEqual(configuration);
  });
  it.each([undefined, null])(
    "composes a standalone Plan with parent %s",
    (parentTaskId) => {
      const result = composeCanonicalPlanAggregate({
        plan: { ...plan, parentTaskId },
        descendants: [stage("stage-1"), task("task-1", "stage-1")],
      });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect(result.aggregate.plan.parentTaskId).toBe(parentTaskId);
    }
  );

  it("orders the Stage chain and preserves parallel Task eligibility", () => {
    const firstStage = stage("stage-1");
    const secondStage = stage("stage-2", [firstStage.id]);
    const firstTask = task("task-1", firstStage.id);
    const parallelTask = task("task-2", firstStage.id);
    const dependentTask = task("task-3", firstStage.id, [
      firstTask.id,
      parallelTask.id,
    ]);

    const result = composeCanonicalPlanAggregate({
      plan,
      descendants: [
        secondStage,
        dependentTask,
        parallelTask,
        firstStage,
        firstTask,
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.aggregate.stages.map(({ stage: item }) => item.id)).toEqual([
      firstStage.id,
      secondStage.id,
    ]);
    expect(result.aggregate.stages[0].orderedTasks.map(({ id }) => id)).toEqual(
      [firstTask.id, parallelTask.id, dependentTask.id]
    );
    expect(
      result.aggregate.stages[0].dependenciesByTaskId.get(dependentTask.id)
    ).toEqual([firstTask.id, parallelTask.id]);
  });

  it("rejects a branching Stage graph because Stage order must be linear", () => {
    const descendants: WorkItemResponseDto[] = [
      stage("stage-1"),
      stage("stage-2", ["stage-1"]),
      stage("stage-3", ["stage-1"]),
    ];

    const result = composeCanonicalPlanAggregate({ plan, descendants });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.messages).toEqual([
      "Plan Stage dependencies must form one linear chain.",
    ]);
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "stages.stage-2.dependencies.stage-1",
          code: "PLAN_STAGE_LINEAR_CHAIN",
          reason: "Plan Stage dependencies must form one linear chain.",
          layer: "structural",
        }),
        expect.objectContaining({
          field: "stages.stage-3.dependencies.stage-1",
          code: "PLAN_STAGE_LINEAR_CHAIN",
          reason: "Plan Stage dependencies must form one linear chain.",
          layer: "structural",
        }),
      ])
    );
    expect(result.error.recovery).toEqual({
      plan,
      configuration: expect.objectContaining({
        schemaVersion: PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1,
        planType: PlanType.Standard,
      }),
    });
  });

  it("rejects a cyclic Task dependency graph", () => {
    const onlyStage = stage("stage-1");
    const result = composeCanonicalPlanAggregate({
      plan,
      descendants: [
        onlyStage,
        task("task-1", onlyStage.id, ["task-2"]),
        task("task-2", onlyStage.id, ["task-1"]),
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.messages).toContain(
      "Plan Stage Task dependencies must be acyclic."
    );
  });
});

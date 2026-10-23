import { describe, expect, it } from "vitest";
import {
  PlanConfigurationV1SchemaVersionEnum,
  PlanType,
  TaskSource,
  WorkStatus,
  type AgentEdgeResponseDto,
  type PlanConfigurationV1,
} from "../../api";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import {
  parseTaskMonitorExecutionDefinition,
  taskMonitorExecutionDefinitionSchema,
} from "../TaskMonitor/taskMonitorSchema";
import {
  composePlanStageTaskMonitorSetup,
  parseCanonicalPlanStageSource,
  type PlanStageStandardTask,
  type PlanStageWorkItem,
  type PlanWorkItem,
} from "./planStageTaskMonitorSetup";

const organizationId = "org-1";
const projectId = "project-1";
const featureId = "feature-1";
const planId = "plan-1";
const stageId = "stage-1";

const configuration: PlanConfigurationV1 = {
  schemaVersion: PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1,
  planType: PlanType.Standard,
  worktreeBranch: null,
};

const plan: PlanWorkItem = {
  id: planId,
  name: "Feature delivery",
  type: "PLAN",
  parentTaskId: featureId,
  organizationId,
  projectId,
  status: WorkStatus.Active,
  source: TaskSource.User,
  sections: [
    {
      id: "plan-config",
      key: "planConfiguration",
      order: 0,
      materializedMarkdown: JSON.stringify(configuration),
    },
  ],
};

const stage: PlanStageWorkItem = {
  id: stageId,
  name: "Build the feature",
  type: "PLAN_STAGE",
  parentTaskId: planId,
  organizationId,
  projectId,
  status: WorkStatus.Active,
  source: TaskSource.User,
};

const dependency = (
  sourceNodeId: string,
  targetNodeId: string
): AgentEdgeResponseDto => ({
  id: `${sourceNodeId}-depends-on-${targetNodeId}`,
  sourceNodeId,
  targetNodeId,
  type: "DEPENDS_ON",
  reasoning: "The prerequisite must finish first.",
  createdAt: "2026-07-14T00:00:00.000Z",
  updatedAt: "2026-07-14T00:00:00.000Z",
});

const task = (
  id: string,
  name: string,
  options: {
    status?: WorkStatus;
    createdAt?: string;
    dependencies?: string[];
  } = {}
): PlanStageStandardTask => ({
  id,
  name,
  type: "STANDARD",
  parentTaskId: stageId,
  organizationId,
  projectId,
  status: options.status ?? WorkStatus.Ready,
  source: TaskSource.User,
  createdAt: options.createdAt ?? "2026-07-14T00:00:00.000Z",
  edges: options.dependencies?.map((targetId) => dependency(id, targetId)),
});

const compose = (
  tasks: readonly PlanStageStandardTask[],
  planConfiguration: PlanConfigurationV1 = configuration,
  sourcePlan: PlanWorkItem = plan
) =>
  composePlanStageTaskMonitorSetup({
    organizationId,
    projectId,
    plan: sourcePlan,
    stage,
    tasks,
    configuration: planConfiguration,
    launchConfiguration: {
      method: "quick",
      provider: "codex",
      model: "gpt-5.5",
      reasoningEffort: "medium",
    },
    launchPolicy: {
      terminalSupervision: { mode: "AGENT_DECIDES" },
    },
    preparedAt: "2026-07-14T01:02:03.000Z",
    preparedByAgentSessionId: "session-1",
  });

describe("composePlanStageTaskMonitorSetup", () => {
  it("reports the existing Task Monitor parent requirement for standalone Plans", () => {
    const result = compose([task("task-1", "Implement")], configuration, {
      ...plan,
      parentTaskId: undefined,
    });
    expect(result).toMatchObject({
      ok: false,
      error: {
        messages: expect.arrayContaining([
          "Task Monitor creation requires a parent Feature.",
        ]),
      },
    });
  });

  it("uses deterministic topological order while preserving parallel roots", () => {
    const first = task("11111111-1111-4111-8111-111111111111", "First", {
      createdAt: "2026-07-14T00:00:01.000Z",
    });
    const parallel = task("22222222-2222-4222-8222-222222222222", "Parallel", {
      createdAt: "2026-07-14T00:00:00.000Z",
    });
    const dependent = task(
      "33333333-3333-4333-8333-333333333333",
      "Dependent",
      {
        dependencies: [first.id, parallel.id],
      }
    );

    const result = compose([dependent, first, parallel]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.definition.executionPlan).toEqual([
      expect.objectContaining({ taskId: parallel.id, dependsOnTaskIds: [] }),
      expect.objectContaining({ taskId: first.id, dependsOnTaskIds: [] }),
      expect.objectContaining({
        taskId: dependent.id,
        dependsOnTaskIds: [first.id, parallel.id],
      }),
    ]);
    expect(result.draft.executableTasks).toEqual([
      expect.objectContaining({ taskId: parallel.id }),
      expect.objectContaining({ taskId: first.id }),
      expect.objectContaining({ taskId: dependent.id }),
    ]);
    expect(taskMonitorExecutionDefinitionSchema(result.draft.definition)).toBe(
      true
    );
    expect(
      parseTaskMonitorExecutionDefinition(
        JSON.stringify(result.draft.definition)
      )
    ).toEqual(result.draft.definition);
  });

  it("uses canonical Task identity and service relationships directly", () => {
    const selectedTask = task("task-1", "Task");
    selectedTask.sections = [
      {
        id: "description",
        key: "description",
        order: 0,
        materializedMarkdown: "Implement the canonical Task.",
      },
    ];
    selectedTask.serviceRelations = [
      {
        id: "relation-1",
        taskId: selectedTask.id,
        serviceId: "service-1",
        createdAt: "2026-07-14T00:00:00.000Z",
      },
    ];

    const result = compose([selectedTask]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.executableTasks).toEqual([
      {
        taskId: selectedTask.id,
        label: selectedTask.name,
        description: "Implement the canonical Task.",
        serviceIds: ["service-1"],
      },
    ]);
    expect(result.draft.provenance).toMatchObject({
      planId,
      stageId,
      planParentTaskId: featureId,
      planWorktreeBranch: null,
    });
  });

  it("omits completed prerequisites from the execution plan", () => {
    const complete = task("task-complete", "Complete", {
      status: WorkStatus.Completed,
    });
    const pending = task("task-pending", "Pending", {
      dependencies: [complete.id],
    });

    const result = compose([pending, complete]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.definition.executionPlan).toEqual([
      expect.objectContaining({
        taskId: pending.id,
        dependsOnTaskIds: [],
      }),
    ]);
  });

  it("rejects a cyclic dependency graph", () => {
    const first = task("task-1", "First", { dependencies: ["task-2"] });
    const second = task("task-2", "Second", { dependencies: ["task-1"] });

    expect(compose([first, second])).toEqual({
      ok: false,
      error: {
        code: "invalid-source",
        messages: ["Plan Stage Task dependencies must be acyclic."],
      },
    });
  });

  it("rejects a Task that is not a direct child of the selected Stage", () => {
    const misplaced = task("task-1", "Misplaced");
    misplaced.parentTaskId = "another-stage";

    expect(compose([misplaced])).toMatchObject({
      ok: false,
      error: {
        code: "invalid-source",
        messages: [
          "Every selected Task must be a direct child of the Plan Stage.",
        ],
      },
    });
  });

  it("reports no executable work when every Task is terminal", () => {
    const result = compose([
      task("task-complete", "Complete", { status: WorkStatus.Completed }),
      task("task-cancelled", "Cancelled", { status: WorkStatus.Cancelled }),
    ]);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "no-executable-work",
        messages: ["This Plan Stage has no executable STANDARD Tasks."],
      },
    });
  });
});

describe("parseCanonicalPlanStageSource", () => {
  it("establishes the canonical Plan hierarchy and configuration at runtime", () => {
    const selectedTask = task("task-1", "Task");

    const result = parseCanonicalPlanStageSource({
      plan,
      stageId,
      descendants: [selectedTask, stage],
    });

    expect(result).toEqual({
      ok: true,
      source: {
        plan,
        stage,
        tasks: [selectedTask],
        configuration,
      },
    });
  });

  it("fails closed for an invalid registry subtype or configuration section", () => {
    const invalidPlan: WorkItemResponseDto = {
      ...plan,
      type: "FEATURE",
      sections: [],
    };

    const result = parseCanonicalPlanStageSource({
      plan: invalidPlan,
      stageId,
      descendants: [stage],
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "invalid-source",
        messages: [
          "The selected item must be a PLAN.",
          "The Plan is missing a valid planConfiguration section.",
        ],
      },
    });
  });
});

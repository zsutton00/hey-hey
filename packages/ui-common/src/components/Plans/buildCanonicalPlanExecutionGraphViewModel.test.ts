import { AgentEdgeType, TaskSource, WorkStatus } from "../../api";
import type {
  CanonicalPlanAggregateStage,
  PlanStageStandardTask,
} from "../../data";
import { buildCanonicalPlanExecutionGraphViewModel } from "./buildCanonicalPlanExecutionGraphViewModel";

const task = (
  id: string,
  status: WorkStatus,
  dependencies: string[] = [],
): PlanStageStandardTask => ({
  id,
  name: id,
  type: "STANDARD",
  parentTaskId: "stage-1",
  organizationId: "org-1",
  projectId: "project-1",
  status,
  source: TaskSource.System,
  edges: dependencies.map((dependencyId) => ({
    id: `${id}-${dependencyId}`,
    sourceNodeId: id,
    sourceEntityType: "TASK",
    targetNodeId: dependencyId,
    targetEntityType: "TASK",
    type: AgentEdgeType.DependsOn,
    category: "structural",
  })),
});

describe("buildCanonicalPlanExecutionGraphViewModel", () => {
  it("renders canonical dependencies with execution state", () => {
    const complete = task("complete", WorkStatus.Completed);
    const ready = task("ready", WorkStatus.Backlog, [complete.id]);
    const blocked = task("blocked", WorkStatus.Backlog, [ready.id]);
    const stage = {
      orderedTasks: [complete, ready, blocked],
      dependenciesByTaskId: new Map([
        [complete.id, []],
        [ready.id, [complete.id]],
        [blocked.id, [ready.id]],
      ]),
    } as unknown as CanonicalPlanAggregateStage;

    const viewModel = buildCanonicalPlanExecutionGraphViewModel(stage);

    expect(viewModel.nodes.map(({ id, state }) => ({ id, state }))).toEqual([
      { id: "complete", state: "completed" },
      { id: "ready", state: "eligible" },
      { id: "blocked", state: "blocked" },
    ]);
    expect(viewModel.dependencyEdges).toEqual([
      {
        id: "complete-ready",
        sourceNodeId: "complete",
        targetNodeId: "ready",
      },
      {
        id: "ready-blocked",
        sourceNodeId: "ready",
        targetNodeId: "blocked",
      },
    ]);
  });

  it.each([
    [WorkStatus.Verifying, "taskStatus"],
    [WorkStatus.Cancelled, "taskStatus"],
    [WorkStatus.Superseded, "taskStatus"],
    [WorkStatus.Archived, "taskStatus"],
    [WorkStatus.OnHold, "taskStatus"],
    [WorkStatus.Backlog, "taskStatus"],
  ])("carries the real %s status on the node", (status) => {
    const only = task("only", status);
    const viewModel = buildCanonicalPlanExecutionGraphViewModel({
      orderedTasks: [only],
      dependenciesByTaskId: new Map([[only.id, []]]),
    } as unknown as CanonicalPlanAggregateStage);

    expect(viewModel.nodes[0].taskStatus).toBe(status);
  });

  it("flags dependency waits without replacing the status", () => {
    const dep = task("dep", WorkStatus.Active);
    const waiting = task("waiting", WorkStatus.Verifying, [dep.id]);
    const viewModel = buildCanonicalPlanExecutionGraphViewModel({
      orderedTasks: [dep, waiting],
      dependenciesByTaskId: new Map([
        [dep.id, []],
        [waiting.id, [dep.id]],
      ]),
    } as unknown as CanonicalPlanAggregateStage);

    expect(viewModel.nodes[1].taskStatus).toBe(WorkStatus.Verifying);
    expect(viewModel.nodes[1].notices?.[0].text).toBe(
      "Waiting on dependencies",
    );
  });
});

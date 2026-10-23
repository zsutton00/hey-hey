import { AgentEdgeType, TaskSource, WorkStatus } from "../../api";
import type {
  CanonicalPlanAggregateStage,
  PlanStageStandardTask,
} from "../../data";
import { buildCanonicalPlanExecutionGraphViewModel } from "./buildCanonicalPlanExecutionGraphViewModel";

const task = (
  id: string,
  status: WorkStatus,
  dependencies: string[] = []
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
});

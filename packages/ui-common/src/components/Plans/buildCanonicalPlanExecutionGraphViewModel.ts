import { WorkStatus } from "../../api";
import type {
  CanonicalPlanAggregateStage,
  PlanStageStandardTask,
} from "../../data";
import type {
  ExecutionGraphNodeState,
  ExecutionGraphViewModel,
} from "../shared/ExecutionGraph";

const isTerminal = (task: PlanStageStandardTask): boolean =>
  task.status === WorkStatus.Completed;

const stateForTask = (
  task: PlanStageStandardTask,
  dependencies: readonly string[],
  tasksById: ReadonlyMap<string, PlanStageStandardTask>
): ExecutionGraphNodeState => {
  if (task.status === WorkStatus.Completed) return "completed";
  if (
    task.status === WorkStatus.Cancelled ||
    task.status === WorkStatus.Archived ||
    task.status === WorkStatus.Superseded
  ) {
    return "stopped";
  }
  if (task.status === WorkStatus.Blocked) return "blocked";
  if (task.status === WorkStatus.Active) return "active";
  if (
    dependencies.some((dependencyId) => {
      const dependency = tasksById.get(dependencyId);
      return dependency !== undefined && !isTerminal(dependency);
    })
  ) {
    return "blocked";
  }
  return "eligible";
};

const taskSummary = (task: PlanStageStandardTask): string | undefined =>
  task.sections
    ?.find((section) => section.key === "description")
    ?.materializedMarkdown.trim() || undefined;

export const buildCanonicalPlanExecutionGraphViewModel = (
  stage: CanonicalPlanAggregateStage
): ExecutionGraphViewModel => {
  const tasksById = new Map(
    stage.orderedTasks.map((task) => [task.id, task])
  );

  return {
    nodes: stage.orderedTasks.map((task) => {
      const dependencies = stage.dependenciesByTaskId.get(task.id) ?? [];
      return {
        id: task.id,
        title: task.name,
        summary: taskSummary(task),
        state: stateForTask(task, dependencies, tasksById),
        entityType: task.type,
        metadata: [],
      };
    }),
    dependencyEdges: stage.orderedTasks.flatMap((task) =>
      (stage.dependenciesByTaskId.get(task.id) ?? []).map((dependencyId) => ({
        id: `${dependencyId}-${task.id}`,
        sourceNodeId: dependencyId,
        targetNodeId: task.id,
      }))
    ),
  };
};

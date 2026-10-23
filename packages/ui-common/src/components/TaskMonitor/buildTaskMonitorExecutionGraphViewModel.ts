import type {
  ExecutionGraphViewModel,
  ExecutionGraphViewModelNode,
} from "../shared/ExecutionGraph/executionGraphViewModel";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

export const buildTaskMonitorExecutionGraphViewModel = (
  projectedNodes: readonly TaskMonitorProjectedNode[]
): ExecutionGraphViewModel => {
  const nodes = projectedNodes.map<ExecutionGraphViewModelNode>((node) => ({
    id: node.taskId,
    title:
      node.task.kind === "loaded" && node.task.task.name.trim()
        ? node.task.task.name
        : "Task unavailable",
    state: node.visualStatus,
    entityType: "TASK",
    metadata: [],
  }));
  const renderedNodeIds = new Set(nodes.map((node) => node.id));
  const dependencyEdges = projectedNodes.flatMap((node) =>
    node.dependsOnTaskIds.flatMap((dependencyTaskId, index) =>
      renderedNodeIds.has(dependencyTaskId)
        ? [
            {
              id: `${dependencyTaskId}:${node.taskId}:${index}`,
              sourceNodeId: dependencyTaskId,
              targetNodeId: node.taskId,
            },
          ]
        : []
    )
  );
  return { nodes, dependencyEdges };
};

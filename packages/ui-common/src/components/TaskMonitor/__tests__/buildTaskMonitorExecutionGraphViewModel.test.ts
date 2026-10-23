import { describe, expect, it } from "vitest";
import { buildTaskMonitorExecutionGraphViewModel } from "../buildTaskMonitorExecutionGraphViewModel";
import type { TaskMonitorProjectedNode } from "../useTaskMonitorProjection";
import {
  createTask,
  firstTaskId,
  secondTaskId,
} from "./taskMonitorTestFixtures";

const nodes: TaskMonitorProjectedNode[] = [
  {
    position: 0,
    taskId: firstTaskId,
    dependsOnTaskIds: [],
    isCursor: true,
    task: { kind: "loaded", task: createTask(firstTaskId, "First task") },
    session: { kind: "none" },
    visualStatus: "idle",
  },
  {
    position: 1,
    taskId: secondTaskId,
    dependsOnTaskIds: [firstTaskId],
    isCursor: false,
    task: { kind: "missing" },
    session: { kind: "missing" },
    visualStatus: "errored",
  },
];

describe("buildTaskMonitorExecutionGraphViewModel", () => {
  it("uses task identity, execution order, and dependency identities only", () => {
    const graph = buildTaskMonitorExecutionGraphViewModel(nodes);
    expect(graph.nodes).toEqual([
      expect.objectContaining({
        id: firstTaskId,
        title: "First task",
        state: "idle",
        metadata: [],
      }),
      expect.objectContaining({
        id: secondTaskId,
        title: "Task unavailable",
        state: "errored",
        metadata: [],
      }),
    ]);
    expect(graph.dependencyEdges).toEqual([
      {
        id: `${firstTaskId}:${secondTaskId}:0`,
        sourceNodeId: firstTaskId,
        targetNodeId: secondTaskId,
      },
    ]);
    expect(JSON.stringify(graph)).not.toContain("eligible");
    expect(JSON.stringify(graph)).not.toContain("checkpoint");
  });
});

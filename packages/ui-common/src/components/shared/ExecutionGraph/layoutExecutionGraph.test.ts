import { describe, expect, it } from "vitest";
import type { ExecutionGraphViewModel } from "./executionGraphViewModel";
import { layoutExecutionGraph } from "./layoutExecutionGraph";

const graph = (
  nodeIds: string[],
  dependencies: Array<[string, string]>
): ExecutionGraphViewModel => ({
  nodes: nodeIds.map((id) => ({
    id,
    title: id,
    state: "idle",
    metadata: [],
  })),
  dependencyEdges: dependencies.map(([sourceNodeId, targetNodeId]) => ({
    id: `${sourceNodeId}-${targetNodeId}`,
    sourceNodeId,
    targetNodeId,
  })),
});

describe("layoutExecutionGraph", () => {
  it("stacks split children and top-aligns their parent", () => {
    const layout = layoutExecutionGraph(
      graph(
        ["root", "left", "right"],
        [
          ["root", "left"],
          ["root", "right"],
        ]
      )
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get("left")?.position.x).toBe(byId.get("right")?.position.x);
    expect(byId.get("left")?.position.y).not.toBe(
      byId.get("right")?.position.y
    );
    expect(byId.get("root")?.position.y).toBe(
      Math.min(
        byId.get("left")?.position.y ?? 0,
        byId.get("right")?.position.y ?? 0
      )
    );
    expect(
      [byId.get("left"), byId.get("right")].map((node) => ({
        index: node?.siblingIndex,
        count: node?.siblingCount,
      }))
    ).toEqual([
      { index: 0, count: 2 },
      { index: 1, count: 2 },
    ]);
  });

  it("top-aligns merge nodes with the upper parent lane", () => {
    const layout = layoutExecutionGraph(
      graph(
        ["upper", "lower", "merge"],
        [
          ["upper", "merge"],
          ["lower", "merge"],
        ]
      )
    );
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    expect(byId.get("merge")?.position.y).toBe(
      Math.min(
        byId.get("upper")?.position.y ?? 0,
        byId.get("lower")?.position.y ?? 0
      )
    );
  });

  it("removes transitive dependencies", () => {
    const layout = layoutExecutionGraph(
      graph(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
          ["a", "c"],
        ]
      )
    );
    expect(layout.dependencyEdges.map((edge) => edge.id)).toEqual([
      "a-b",
      "b-c",
    ]);
  });

  it("uses measured heights for collision-free lane spacing and bounds", () => {
    const layout = layoutExecutionGraph(graph(["a", "b"], []), {
      a: 360,
      b: 220,
    });
    const [first, second] = [...layout.nodes].sort(
      (left, right) => left.position.y - right.position.y
    );
    expect(
      (second?.position.y ?? 0) - (first?.position.y ?? 0)
    ).toBeGreaterThanOrEqual(410);
    expect(layout.totalHeight).toBeGreaterThan(second?.position.y ?? 0);
  });
});

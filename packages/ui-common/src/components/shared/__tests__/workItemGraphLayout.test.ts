import { describe, expect, it } from "vitest";
import type {
  ProjectedWorkItem,
  ProjectedWorkItemRelationship,
  WorkItemChangeSetIdentity,
} from "../../../api";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
} from "../../../api";
import { computePreferredWorkItemGraphLayout } from "../workItemGraphLayout";

const identityKey = (identity: WorkItemChangeSetIdentity): string =>
  identity.refType === "existing" ? identity.id : identity.tempId;

const makeChild = (
  identity: WorkItemChangeSetIdentity,
  name: string
): ProjectedWorkItem => ({
  identity,
  label: name,
  type: "workflow_step",
  name,
  sections: [],
  deleted: false,
});

const makeFlowRelationship = (
  id: string,
  source: WorkItemChangeSetIdentity,
  target: WorkItemChangeSetIdentity,
  edgeType: AgentEdgeType = AgentEdgeType.Standard
): ProjectedWorkItemRelationship => ({
  identity: { refType: "existing", id },
  label: edgeType,
  source,
  target,
  edgeType,
  category: AgentEdgeCategory.Flow,
  direction: AgentEdgeDirection.Forward,
  predicate: null,
  deleted: false,
});

const makeLinearGraph = (
  count: number,
  identityForIndex: (index: number) => WorkItemChangeSetIdentity = (index) => ({
    refType: "existing",
    id: `step-${index + 1}`,
  })
) => {
  const children = Array.from({ length: count }, (_, index) =>
    makeChild(
      identityForIndex(index),
      `Step ${String(index + 1).padStart(2, "0")}`
    )
  );
  const relationships = children
    .slice(0, -1)
    .map((child, index) =>
      makeFlowRelationship(
        `edge-${index + 1}`,
        child.identity,
        children[index + 1]?.identity ?? child.identity
      )
    );
  return { children, relationships };
};

const positionsByName = (
  children: readonly ProjectedWorkItem[],
  layout: ReturnType<typeof computePreferredWorkItemGraphLayout>
): Map<string, { x: number; y: number }> => {
  const namesByIdentity = new Map(
    children.map((child) => [identityKey(child.identity), child.name])
  );
  return new Map(
    layout.layout.nodes.flatMap((entry) => {
      const name = namesByIdentity.get(identityKey(entry.node));
      return name ? [[name, entry.position] as const] : [];
    })
  );
};

describe("preferred work-item graph layout", () => {
  it.each([
    { count: 10, rows: 2, columns: 5 },
    { count: 15, rows: 5, columns: 3 },
  ])("creates a complete $rows-by-$columns map for $count steps", ({ count, rows, columns }) => {
    const graph = makeLinearGraph(count);
    const result = computePreferredWorkItemGraphLayout(graph, {
      rows,
      columns,
    });

    expect(result.requested).toEqual({ rows, columns });
    expect(result.actual).toEqual({ rows, columns });
    expect(result.departures).toEqual([]);
    expect(result.layout.nodes).toHaveLength(count);

    const positions = positionsByName(graph.children, result);
    const positionsByRow = new Map<number, Array<{ x: number; y: number }>>();
    positions.forEach((position) => {
      positionsByRow.set(position.y, [
        ...(positionsByRow.get(position.y) ?? []),
        position,
      ]);
    });
    expect(positionsByRow.size).toBe(rows);
    expect(
      [...positionsByRow.values()].map((row) => row.length).sort()
    ).toEqual(Array.from({ length: rows }, () => columns));
    expect(
      [...positionsByRow.values()].every(
        (row) => new Set(row.map((position) => position.x)).size === columns
      )
    ).toBe(true);
  });

  it("is invariant to child and relationship retrieval order", () => {
    const graph = makeLinearGraph(15);
    const reordered = {
      children: [...graph.children].reverse(),
      relationships: [...graph.relationships].reverse(),
    };

    expect(
      positionsByName(
        graph.children,
        computePreferredWorkItemGraphLayout(graph, { rows: 5, columns: 3 })
      )
    ).toEqual(
      positionsByName(
        reordered.children,
        computePreferredWorkItemGraphLayout(reordered, {
          rows: 5,
          columns: 3,
        })
      )
    );
  });

  it("is invariant when equivalent identities change from persisted to temporary", () => {
    const persisted = makeLinearGraph(15);
    const temporary = makeLinearGraph(15, (index) => ({
      refType: "temporary",
      tempId: `step-${index + 1}`,
    }));

    expect(
      positionsByName(
        persisted.children,
        computePreferredWorkItemGraphLayout(persisted, { rows: 5, columns: 3 })
      )
    ).toEqual(
      positionsByName(
        temporary.children,
        computePreferredWorkItemGraphLayout(temporary, {
          rows: 5,
          columns: 3,
        })
      )
    );
  });

  it("keeps branch lanes together and reports an unattainable narrow target", () => {
    const start = makeChild({ refType: "existing", id: "start" }, "Start");
    const firstBranch = makeChild(
      { refType: "existing", id: "first-branch" },
      "First branch"
    );
    const secondBranch = makeChild(
      { refType: "existing", id: "second-branch" },
      "Second branch"
    );
    const finish = makeChild({ refType: "existing", id: "finish" }, "Finish");
    const graph = {
      children: [start, firstBranch, secondBranch, finish],
      relationships: [
        makeFlowRelationship(
          "start-first",
          start.identity,
          firstBranch.identity
        ),
        makeFlowRelationship(
          "start-second",
          start.identity,
          secondBranch.identity
        ),
        makeFlowRelationship(
          "first-finish",
          firstBranch.identity,
          finish.identity
        ),
        makeFlowRelationship(
          "second-finish",
          secondBranch.identity,
          finish.identity
        ),
      ],
    };
    const result = computePreferredWorkItemGraphLayout(graph, {
      rows: 1,
      columns: 2,
    });
    const positions = positionsByName(graph.children, result);

    expect(positions.get("First branch")?.x).toBe(
      positions.get("Second branch")?.x
    );
    expect(positions.get("First branch")?.y).not.toBe(
      positions.get("Second branch")?.y
    );
    expect(result.departures).toEqual([
      "branch-lanes-preserved",
      "requested-shape-unattainable",
    ]);
    expect(result.actual).toEqual({ rows: 1, columns: 3 });
  });

  it("keeps a strongly connected group intact and reports cycle routing", () => {
    const first = makeChild({ refType: "existing", id: "first" }, "First");
    const second = makeChild({ refType: "existing", id: "second" }, "Second");
    const third = makeChild({ refType: "existing", id: "third" }, "Third");
    const graph = {
      children: [first, second, third],
      relationships: [
        makeFlowRelationship("first-second", first.identity, second.identity),
        makeFlowRelationship("second-third", second.identity, third.identity),
        makeFlowRelationship("third-first", third.identity, first.identity),
      ],
    };
    const result = computePreferredWorkItemGraphLayout(graph, {
      rows: 1,
      columns: 1,
    });

    expect(result.actual).toEqual({ rows: 1, columns: 2 });
    expect(result.departures).toEqual([
      "atomic-group-preserved",
      "cycle-routing-preserved",
      "requested-shape-unattainable",
    ]);
    expect(result.layout.nodes).toHaveLength(3);
  });

  it("returns a deterministic readable arrangement and explains an incompatible target", () => {
    const graph = makeLinearGraph(15);
    const result = computePreferredWorkItemGraphLayout(graph, {
      rows: 1,
      columns: 1,
    });
    const positions = positionsByName(graph.children, result);
    const orderedPositions = graph.children.map((child) =>
      positions.get(child.name)
    );

    expect(result.actual).not.toEqual({ rows: 1, columns: 1 });
    expect(result.departures).toContain("requested-shape-unattainable");
    expect(
      orderedPositions.every((position, index) => {
        const next = orderedPositions[index + 1];
        return !next || position!.x < next.x || position!.y < next.y;
      })
    ).toBe(true);
  });
});

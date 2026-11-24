import type { WorkItemChangeSetPosition } from "../../api";
import {
  DIAGRAM_BOUNDARY_LABEL_HEIGHT,
  DIAGRAM_BOUNDARY_PADDING,
  type DiagramLayoutGroupHints,
} from "./diagramGroupBoundaries";

export interface DiagramLayoutInput {
  nodes: readonly {
    id: string;
    title: string;
    width: number;
    height: number;
  }[];
  edges: readonly { source: string; target: string; label: string }[];
  /**
   * Optional authored groups. Factual boundaries are mandatory containment;
   * visual associations are soft proximity hints. Omitted means today's
   * ungrouped layout, unchanged.
   */
  groups?: DiagramLayoutGroupHints;
}

// Engine identities are local to the evaluation. Persisted and proposal IDs
// never participate in ordering; authoritative endpoints remain unchanged.
const normalizeInput = (input: DiagramLayoutInput) => {
  const titles = new Map(input.nodes.map((node) => [node.id, node.title]));
  const signature = (id: string) =>
    JSON.stringify(
      input.edges
        .flatMap((edge) =>
          edge.source === id
            ? [["out", titles.get(edge.target), edge.label]]
            : edge.target === id
              ? [["in", titles.get(edge.source), edge.label]]
              : [],
        )
        .sort(),
    );
  const nodes = [...input.nodes].sort(
    (a, b) =>
      a.title.localeCompare(b.title) ||
      signature(a.id).localeCompare(signature(b.id)),
  );
  const ids = new Map(nodes.map((node, index) => [node.id, `n${index}`]));
  const edges = input.edges
    .flatMap((edge) => {
      const source = ids.get(edge.source);
      const target = ids.get(edge.target);
      return source && target ? [{ source, target, label: edge.label }] : [];
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { nodes, ids, edges, groups: normalizeGroups(input.groups, ids) };
};

interface NormalizedGroups {
  /** Boundary id -> parent boundary id (engine-local identities). */
  boundaries: ReadonlyMap<string, string | undefined>;
  /** Engine node id -> innermost boundary id. */
  boundaryOf: ReadonlyMap<string, string>;
  associations: readonly (readonly string[])[];
}

const normalizeGroups = (
  hints: DiagramLayoutGroupHints | undefined,
  ids: ReadonlyMap<string, string>,
): NormalizedGroups | undefined => {
  if (!hints) return undefined;
  const boundaryIds = new Map(
    [...hints.boundaries]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((boundary, index) => [boundary.id, `b${index}`]),
  );
  const boundaryOf = new Map(
    Object.entries(hints.boundaryOf).flatMap(([nodeId, boundaryId]) => {
      const node = ids.get(nodeId);
      const boundary = boundaryIds.get(boundaryId);
      return node && boundary ? [[node, boundary] as const] : [];
    }),
  );
  // Keep only boundaries that enclose something, directly or nested.
  const parents = new Map(
    hints.boundaries.map((boundary) => [
      boundaryIds.get(boundary.id)!,
      boundary.parentId ? boundaryIds.get(boundary.parentId) : undefined,
    ]),
  );
  const used = new Set<string>();
  for (const boundary of boundaryOf.values()) {
    let current: string | undefined = boundary;
    while (current && !used.has(current)) {
      used.add(current);
      current = parents.get(current);
    }
  }
  const associations = hints.associations
    .map((association) =>
      association.nodeIds
        .flatMap((nodeId) => {
          const id = ids.get(nodeId);
          return id ? [id] : [];
        })
        .sort(),
    )
    .filter((nodeIds) => nodeIds.length > 1);
  if (used.size === 0 && associations.length === 0) return undefined;
  return {
    boundaries: new Map(
      [...used].sort().map((id) => [id, parents.get(id)] as const),
    ),
    boundaryOf,
    associations,
  };
};

/** Consecutive association members become weak proximity hints. */
const associationPairs = (groups: NormalizedGroups | undefined) =>
  (groups?.associations ?? []).flatMap((nodeIds) =>
    nodeIds.slice(1).map((target, index) => ({
      source: nodeIds[index]!,
      target,
    })),
  );

type NormalizedInput = ReturnType<typeof normalizeInput>;

async function computeDagreLayout({
  nodes,
  ids,
  edges,
  groups,
}: NormalizedInput): Promise<ReadonlyMap<string, WorkItemChangeSetPosition>> {
  const { default: dagre } = await import("dagre");
  const graph = new dagre.graphlib.Graph({
    multigraph: true,
    ...(groups ? { compound: true } : {}),
  });
  graph.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: 120,
    marginx: 32,
    marginy: 32,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  nodes.forEach((node) =>
    graph.setNode(ids.get(node.id)!, {
      width: node.width,
      height: node.height,
    }),
  );
  edges.forEach((edge, index) =>
    graph.setEdge(edge.source, edge.target, {}, `e${index}`),
  );
  if (groups) {
    // Compound clusters keep every member inside its boundary.
    groups.boundaries.forEach((_parent, boundary) =>
      graph.setNode(boundary, {
        paddingTop: DIAGRAM_BOUNDARY_PADDING + DIAGRAM_BOUNDARY_LABEL_HEIGHT,
        paddingBottom: DIAGRAM_BOUNDARY_PADDING,
        paddingLeft: DIAGRAM_BOUNDARY_PADDING,
        paddingRight: DIAGRAM_BOUNDARY_PADDING,
      }),
    );
    groups.boundaries.forEach((parent, boundary) => {
      if (parent) graph.setParent(boundary, parent);
    });
    groups.boundaryOf.forEach((boundary, node) =>
      graph.setParent(node, boundary),
    );
    associationPairs(groups).forEach((pair, index) =>
      graph.setEdge(
        pair.source,
        pair.target,
        { minlen: 0, weight: 1 },
        `a${index}`,
      ),
    );
  }
  dagre.layout(graph);
  return new Map(
    nodes.map((node) => {
      const position: { x: number; y: number } = graph.node(ids.get(node.id)!);
      return [
        node.id,
        { x: position.x - node.width / 2, y: position.y - node.height / 2 },
      ];
    }),
  );
}

/**
 * The one automatic arrangement for Diagrams without saved positions: Flow
 * (Dagre), left to right.
 */
export async function computeAutomaticDiagramLayout(
  input: DiagramLayoutInput,
): Promise<ReadonlyMap<string, WorkItemChangeSetPosition>> {
  const normalized = normalizeInput(input);
  if (!normalized.nodes.length) {
    return new Map();
  }

  return computeDagreLayout(normalized);
}

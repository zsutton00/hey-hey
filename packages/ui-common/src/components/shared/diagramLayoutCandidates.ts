import type { WorkItemChangeSetPosition } from "../../api";
import {
  DIAGRAM_BOUNDARY_LABEL_HEIGHT,
  DIAGRAM_BOUNDARY_PADDING,
  type DiagramLayoutGroupHints,
} from "./diagramGroupBoundaries";

export const DIAGRAM_LAYOUT_CANDIDATES = [
  { key: "dagre", label: "Flow", testId: "diagram-layout-dagre" },
  {
    key: "elk-layered",
    label: "Layered",
    testId: "diagram-layout-elk-layered",
  },
  {
    key: "elk-stress",
    label: "Network",
    testId: "diagram-layout-elk-stress",
  },
] as const;

export type DiagramLayoutCandidate =
  (typeof DIAGRAM_LAYOUT_CANDIDATES)[number]["key"];
export type DiagramLayoutDirection = "RIGHT" | "DOWN";

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
  ids: ReadonlyMap<string, string>
): NormalizedGroups | undefined => {
  if (!hints) return undefined;
  const boundaryIds = new Map(
    [...hints.boundaries]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((boundary, index) => [boundary.id, `b${index}`])
  );
  const boundaryOf = new Map(
    Object.entries(hints.boundaryOf).flatMap(([nodeId, boundaryId]) => {
      const node = ids.get(nodeId);
      const boundary = boundaryIds.get(boundaryId);
      return node && boundary ? [[node, boundary] as const] : [];
    })
  );
  // Keep only boundaries that enclose something, directly or nested.
  const parents = new Map(
    hints.boundaries.map((boundary) => [
      boundaryIds.get(boundary.id)!,
      boundary.parentId ? boundaryIds.get(boundary.parentId) : undefined,
    ])
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
        .sort()
    )
    .filter((nodeIds) => nodeIds.length > 1);
  if (used.size === 0 && associations.length === 0) return undefined;
  return {
    boundaries: new Map(
      [...used].sort().map((id) => [id, parents.get(id)] as const)
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
    }))
  );

type NormalizedInput = ReturnType<typeof normalizeInput>;

async function computeDagreLayout(
  { nodes, ids, edges, groups }: NormalizedInput,
  direction: DiagramLayoutDirection,
): Promise<ReadonlyMap<string, WorkItemChangeSetPosition>> {
  const { default: dagre } = await import("dagre");
  const graph = new dagre.graphlib.Graph({
    multigraph: true,
    ...(groups ? { compound: true } : {}),
  });
  graph.setGraph({
    rankdir: direction === "RIGHT" ? "LR" : "TB",
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
      graph.setEdge(pair.source, pair.target, { minlen: 0, weight: 1 }, `a${index}`),
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

type ElkInputNode = {
  id: string;
  width?: number;
  height?: number;
  layoutOptions?: Record<string, string>;
  children?: ElkInputNode[];
  edges?: ElkInputEdge[];
};
type ElkInputEdge = { id: string; sources: string[]; targets: string[] };
type ElkOutputNode = {
  id: string;
  x?: number;
  y?: number;
  children?: ElkOutputNode[];
};

const BOUNDARY_PADDING_OPTION = `[top=${
  DIAGRAM_BOUNDARY_PADDING + DIAGRAM_BOUNDARY_LABEL_HEIGHT
},left=${DIAGRAM_BOUNDARY_PADDING},bottom=${DIAGRAM_BOUNDARY_PADDING},right=${DIAGRAM_BOUNDARY_PADDING}]`;

/**
 * Nest nodes inside boundary compounds. Layered keeps real edges at the root
 * and lays out across hierarchy levels; Stress cannot, so each level is laid
 * out inner-first and cross-level edges become proxy edges between the
 * level's own items, giving stress over clusters.
 */
function buildElkHierarchy(
  { nodes, ids, edges, groups }: NormalizedInput,
  candidate: "elk-layered" | "elk-stress",
): { children: ElkInputNode[]; edges: ElkInputEdge[] } {
  const leaves = nodes.map((node) => ({
    id: ids.get(node.id)!,
    width: node.width,
    height: node.height,
  }));
  const extraEdges = associationPairs(groups);
  if (!groups || groups.boundaries.size === 0) {
    return {
      children: leaves,
      edges: [...edges, ...extraEdges].map((edge, index) => ({
        id: `e${index}`,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };
  }
  const parentOf = new Map<string, string | undefined>();
  groups.boundaries.forEach((parent, boundary) =>
    parentOf.set(boundary, parent),
  );
  leaves.forEach((leaf) => parentOf.set(leaf.id, groups.boundaryOf.get(leaf.id)));
  const compounds = new Map<string, ElkInputNode>(
    [...groups.boundaries.keys()].map((id) => [
      id,
      {
        id,
        layoutOptions: {
          "elk.padding": BOUNDARY_PADDING_OPTION,
          ...(candidate === "elk-stress"
            ? { "elk.algorithm": "stress", "elk.stress.iterationLimit": "300" }
            : {}),
        },
        children: [],
        edges: [],
      },
    ]),
  );
  const root: ElkInputNode = { id: "root", children: [], edges: [] };
  const containerOf = (id: string) => {
    const parent = parentOf.get(id);
    return parent ? compounds.get(parent)! : root;
  };
  [...compounds.values()].forEach((compound) =>
    containerOf(compound.id).children!.push(compound),
  );
  leaves.forEach((leaf) => containerOf(leaf.id).children!.push(leaf));
  const allEdges = [...edges, ...extraEdges];
  if (candidate === "elk-layered") {
    return {
      children: root.children!,
      edges: allEdges.map((edge, index) => ({
        id: `e${index}`,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };
  }
  const ancestors = (id: string) => {
    const chain = [id];
    let current = parentOf.get(id);
    while (current) {
      chain.push(current);
      current = parentOf.get(current);
    }
    return chain.reverse();
  };
  const seen = new Set<string>();
  allEdges.forEach((edge) => {
    const source = ancestors(edge.source);
    const target = ancestors(edge.target);
    let depth = 0;
    while (
      depth < source.length &&
      depth < target.length &&
      source[depth] === target[depth]
    ) {
      depth += 1;
    }
    const from = source[depth];
    const to = target[depth];
    if (!from || !to || from === to) return;
    const container = depth === 0 ? root : compounds.get(source[depth - 1]!)!;
    const key = `${container.id}:${from}:${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    container.edges!.push({
      id: `e${seen.size - 1}`,
      sources: [from],
      targets: [to],
    });
  });
  return { children: root.children!, edges: root.edges! };
}

async function computeElkLayout(
  normalized: NormalizedInput,
  candidate: "elk-layered" | "elk-stress",
  direction: DiagramLayoutDirection,
): Promise<ReadonlyMap<string, WorkItemChangeSetPosition>> {
  const { nodes, ids, groups } = normalized;
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js");
  const hierarchy = buildElkHierarchy(normalized, candidate);
  const result = (await new ELK().layout({
    id: "comparison",
    layoutOptions: {
      "elk.algorithm": candidate === "elk-layered" ? "layered" : "stress",
      "elk.direction": direction,
      "elk.randomSeed": "1",
      "elk.spacing.nodeNode": "80",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
      "elk.stress.desiredEdgeLength": String(
        Math.max(...nodes.map((node) => Math.max(node.width, node.height))) +
          120,
      ),
      "elk.stress.iterationLimit": "300",
      ...(candidate === "elk-layered" && groups?.boundaries.size
        ? { "elk.hierarchyHandling": "INCLUDE_CHILDREN" }
        : {}),
    },
    children: hierarchy.children,
    edges: hierarchy.edges,
  })) as ElkOutputNode;
  // Child coordinates are relative to their compound parent.
  const positions = new Map<string, { x?: number; y?: number }>();
  const collect = (
    children: readonly ElkOutputNode[] | undefined,
    offsetX: number,
    offsetY: number,
  ) =>
    children?.forEach((child) => {
      const x = child.x === undefined ? undefined : child.x + offsetX;
      const y = child.y === undefined ? undefined : child.y + offsetY;
      positions.set(child.id, { x, y });
      if (child.children?.length && x !== undefined && y !== undefined) {
        collect(child.children, x, y);
      }
    });
  collect(result.children, 0, 0);
  return new Map(
    nodes.map((node) => {
      const position = positions.get(ids.get(node.id)!);
      if (
        position?.x === undefined ||
        position.y === undefined ||
        !Number.isFinite(position.x) ||
        !Number.isFinite(position.y)
      ) {
        throw new Error("Layout returned an invalid node position.");
      }
      return [node.id, { x: position.x, y: position.y }];
    }),
  );
}

export async function computeDiagramLayoutCandidate(
  input: DiagramLayoutInput,
  candidate: DiagramLayoutCandidate,
  direction: DiagramLayoutDirection,
): Promise<ReadonlyMap<string, WorkItemChangeSetPosition>> {
  const normalized = normalizeInput(input);
  if (!normalized.nodes.length) return new Map();
  return candidate === "dagre"
    ? computeDagreLayout(normalized, direction)
    : computeElkLayout(normalized, candidate, direction);
}

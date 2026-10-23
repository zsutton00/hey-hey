import dagre from "dagre";
import type {
  ExecutionGraphDependencyEdge,
  ExecutionGraphViewModelNode,
  ExecutionGraphViewModel,
} from "./executionGraphViewModel";

const DEFAULT_NODE_WIDTH = 400;
const DEFAULT_NODE_HEIGHT = 150;
const HORIZONTAL_SPACING = 120;
const VERTICAL_GAP = 50;

export interface PositionedExecutionGraphNode
  extends ExecutionGraphViewModelNode {
  position: { x: number; y: number };
  width: number;
  height: number;
  hasIncomingEdges: boolean;
  hasOutgoingEdges: boolean;
  siblingIndex: number;
  siblingCount: number;
}

export interface LayoutedExecutionGraph {
  nodes: PositionedExecutionGraphNode[];
  dependencyEdges: ExecutionGraphDependencyEdge[];
  depth: number;
  totalHeight: number;
  totalWidth: number;
}

const reduceTransitiveEdges = (
  edges: readonly ExecutionGraphDependencyEdge[]
): ExecutionGraphDependencyEdge[] => {
  const outgoing = new Map<string, string[]>();
  edges.forEach((edge) => {
    outgoing.set(edge.sourceNodeId, [
      ...(outgoing.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
  });

  const canReach = (source: string, target: string, skippedEdgeId: string) => {
    const visited = new Set<string>();
    const pending = [source];
    while (pending.length > 0) {
      const nodeId = pending.pop();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      for (const nextNodeId of outgoing.get(nodeId) ?? []) {
        const candidate = edges.find(
          (edge) =>
            edge.sourceNodeId === nodeId && edge.targetNodeId === nextNodeId
        );
        if (candidate?.id === skippedEdgeId) continue;
        if (nextNodeId === target) return true;
        pending.push(nextNodeId);
      }
    }
    return false;
  };

  return edges.filter(
    (edge) => !canReach(edge.sourceNodeId, edge.targetNodeId, edge.id)
  );
};

const resolveLanesFromTargets = (
  orderedNodeIds: string[],
  targetLaneByNode: ReadonlyMap<string, number>
): Map<string, number> => {
  const inputIndex = new Map(orderedNodeIds.map((id, index) => [id, index]));
  const sorted = [...orderedNodeIds].sort((left, right) => {
    const targetDifference =
      (targetLaneByNode.get(left) ?? 0) - (targetLaneByNode.get(right) ?? 0);
    return targetDifference !== 0
      ? targetDifference
      : (inputIndex.get(left) ?? 0) - (inputIndex.get(right) ?? 0);
  });
  const laneByNode = new Map<string, number>();
  let previousLane: number | null = null;
  sorted.forEach((nodeId) => {
    const target = targetLaneByNode.get(nodeId) ?? 0;
    const lane =
      previousLane === null ? target : Math.max(target, previousLane + 1);
    laneByNode.set(nodeId, lane);
    previousLane = lane;
  });
  return laneByNode;
};

export const layoutExecutionGraph = (
  viewModel: ExecutionGraphViewModel,
  measuredHeights: Readonly<Record<string, number>> = {}
): LayoutedExecutionGraph => {
  if (viewModel.nodes.length === 0) {
    return {
      nodes: [],
      dependencyEdges: [],
      depth: 0,
      totalHeight: 0,
      totalWidth: 0,
    };
  }

  const nodeIds = new Set(viewModel.nodes.map((node) => node.id));
  const dependencyEdges = reduceTransitiveEdges(
    viewModel.dependencyEdges.filter(
      (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId)
    )
  );
  const nodeOrder = new Map(
    viewModel.nodes.map((node, index) => [node.id, index])
  );
  const childrenByNode = new Map<string, string[]>();
  const parentsByNode = new Map<string, string[]>();
  dependencyEdges.forEach((edge) => {
    childrenByNode.set(edge.sourceNodeId, [
      ...(childrenByNode.get(edge.sourceNodeId) ?? []),
      edge.targetNodeId,
    ]);
    parentsByNode.set(edge.targetNodeId, [
      ...(parentsByNode.get(edge.targetNodeId) ?? []),
      edge.sourceNodeId,
    ]);
  });
  const sortByInputOrder = (left: string, right: string) =>
    (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0);
  childrenByNode.forEach((children, id) =>
    childrenByNode.set(id, [...children].sort(sortByInputOrder))
  );
  parentsByNode.forEach((parents, id) =>
    parentsByNode.set(id, [...parents].sort(sortByInputOrder))
  );

  const levelByNode = new Map<string, number>(
    viewModel.nodes.map((node) => [node.id, 0])
  );
  for (let pass = 0; pass < viewModel.nodes.length; pass += 1) {
    let changed = false;
    dependencyEdges.forEach((edge) => {
      const nextLevel = Math.min(
        viewModel.nodes.length - 1,
        (levelByNode.get(edge.sourceNodeId) ?? 0) + 1
      );
      if (nextLevel > (levelByNode.get(edge.targetNodeId) ?? 0)) {
        levelByNode.set(edge.targetNodeId, nextLevel);
        changed = true;
      }
    });
    if (!changed) break;
  }

  const nodesByLevel = new Map<number, string[]>();
  viewModel.nodes.forEach((node) => {
    const level = levelByNode.get(node.id) ?? 0;
    nodesByLevel.set(level, [...(nodesByLevel.get(level) ?? []), node.id]);
  });
  nodesByLevel.forEach((nodes, level) =>
    nodesByLevel.set(level, [...nodes].sort(sortByInputOrder))
  );
  const levels = [...nodesByLevel.keys()].sort((left, right) => left - right);

  const widthByNode = new Map(
    viewModel.nodes.map((node) => [node.id, DEFAULT_NODE_WIDTH])
  );
  const heightByNode = new Map(
    viewModel.nodes.map((node) => [
      node.id,
      measuredHeights[node.id] > 0
        ? measuredHeights[node.id]
        : DEFAULT_NODE_HEIGHT +
          (node.summary ? 50 : 0) +
          (node.notices?.length ?? 0) * 36 +
          Math.max(0, Math.ceil(node.metadata.length / 3) - 1) * 32,
    ])
  );
  const widthByLevel = new Map<number, number>();
  levels.forEach((level) => {
    widthByLevel.set(
      level,
      Math.max(
        DEFAULT_NODE_WIDTH,
        ...(nodesByLevel.get(level) ?? []).map(
          (nodeId) => widthByNode.get(nodeId) ?? DEFAULT_NODE_WIDTH
        )
      )
    );
  });
  const xByLevel = new Map<number, number>();
  let nextX = 0;
  levels.forEach((level) => {
    xByLevel.set(level, nextX);
    nextX +=
      (widthByLevel.get(level) ?? DEFAULT_NODE_WIDTH) + HORIZONTAL_SPACING;
  });

  const tallestNodeHeight = Math.max(
    DEFAULT_NODE_HEIGHT,
    ...heightByNode.values()
  );
  const rowPitch = tallestNodeHeight + VERTICAL_GAP;
  const dagreGraph = new dagre.graphlib.Graph({ directed: true });
  dagreGraph.setGraph({
    rankdir: "LR",
    nodesep: 80,
    ranksep: HORIZONTAL_SPACING,
  });
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  viewModel.nodes.forEach((node) => {
    dagreGraph.setNode(node.id, {
      width: widthByNode.get(node.id),
      height: heightByNode.get(node.id),
    });
  });
  dependencyEdges.forEach((edge) =>
    dagreGraph.setEdge(edge.sourceNodeId, edge.targetNodeId)
  );
  dagre.layout(dagreGraph);

  const dagreY = new Map<string, number>();
  viewModel.nodes.forEach((node) => {
    const dagreNode = dagreGraph.node(node.id) as { y?: number } | undefined;
    dagreY.set(
      node.id,
      typeof dagreNode?.y === "number"
        ? dagreNode.y
        : nodeOrder.get(node.id) ?? 0
    );
  });

  const laneByNode = new Map<string, number>();
  levels.forEach((level) => {
    const ordered = [...(nodesByLevel.get(level) ?? [])].sort(
      (left, right) =>
        (dagreY.get(left) ?? 0) - (dagreY.get(right) ?? 0) ||
        sortByInputOrder(left, right)
    );
    const baseLane = new Map(ordered.map((id, index) => [id, index]));
    const targets = new Map(
      ordered.map((nodeId) => {
        const parentLanes = (parentsByNode.get(nodeId) ?? [])
          .map((parentId) => laneByNode.get(parentId))
          .filter((lane): lane is number => lane !== undefined);
        return [
          nodeId,
          parentLanes.length > 0
            ? Math.min(...parentLanes)
            : baseLane.get(nodeId) ?? 0,
        ];
      })
    );
    resolveLanesFromTargets(ordered, targets).forEach((lane, nodeId) =>
      laneByNode.set(nodeId, lane)
    );
  });

  levels.forEach((level) => {
    const ordered = [...(nodesByLevel.get(level) ?? [])].sort(
      (left, right) =>
        (laneByNode.get(left) ?? 0) - (laneByNode.get(right) ?? 0) ||
        sortByInputOrder(left, right)
    );
    const targets = new Map<string, number>();
    ordered.forEach((nodeId) => {
      const currentLane = laneByNode.get(nodeId) ?? 0;
      const parentLanes = (parentsByNode.get(nodeId) ?? [])
        .map((id) => laneByNode.get(id))
        .filter((lane): lane is number => lane !== undefined);
      const childLanes = (childrenByNode.get(nodeId) ?? [])
        .map((id) => laneByNode.get(id))
        .filter((lane): lane is number => lane !== undefined);
      const mergeTop = parentLanes.length > 1 ? Math.min(...parentLanes) : null;
      const splitTop = childLanes.length > 1 ? Math.min(...childLanes) : null;
      if (mergeTop !== null && splitTop !== null) {
        targets.set(nodeId, Math.min(mergeTop, splitTop));
      } else if (mergeTop !== null) {
        targets.set(nodeId, mergeTop);
      } else if (splitTop !== null) {
        targets.set(
          nodeId,
          parentLanes.length === 1 ? parentLanes[0] : splitTop
        );
      } else {
        targets.set(nodeId, currentLane);
      }
    });
    resolveLanesFromTargets(ordered, targets).forEach((lane, nodeId) =>
      laneByNode.set(nodeId, lane)
    );
  });

  const minLane = Math.min(0, ...laneByNode.values());
  const nodes = viewModel.nodes.map<PositionedExecutionGraphNode>((node) => {
    const parents = parentsByNode.get(node.id) ?? [];
    const siblings =
      parents.length > 0 ? childrenByNode.get(parents[0]) ?? [] : [];
    const siblingIndex = siblings.findIndex(
      (siblingId) => siblingId === node.id
    );
    return {
      ...node,
      width: widthByNode.get(node.id) ?? DEFAULT_NODE_WIDTH,
      height: heightByNode.get(node.id) ?? DEFAULT_NODE_HEIGHT,
      position: {
        x: xByLevel.get(levelByNode.get(node.id) ?? 0) ?? 0,
        y: ((laneByNode.get(node.id) ?? 0) - minLane) * rowPitch,
      },
      hasIncomingEdges: parents.length > 0,
      hasOutgoingEdges: (childrenByNode.get(node.id)?.length ?? 0) > 0,
      siblingIndex: siblingIndex >= 0 ? siblingIndex : 0,
      siblingCount: siblings.length > 0 ? siblings.length : 1,
    };
  });
  const totalHeight = Math.max(
    400,
    ...nodes.map(
      (node) =>
        node.position.y +
        (heightByNode.get(node.id) ?? DEFAULT_NODE_HEIGHT) +
        100
    )
  );
  const totalWidth = Math.max(
    0,
    ...nodes.map(
      (node) =>
        node.position.x + (widthByNode.get(node.id) ?? DEFAULT_NODE_WIDTH) + 100
    )
  );

  return {
    nodes,
    dependencyEdges,
    depth: levels.length,
    totalHeight,
    totalWidth,
  };
};

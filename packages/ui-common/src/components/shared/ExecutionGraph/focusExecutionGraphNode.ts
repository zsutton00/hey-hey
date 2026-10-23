import type { ReactFlowInstance } from "reactflow";
import type { ExecutionGraphNodeData } from "./ExecutionGraphNode";

export type ExecutionGraphViewportInstance = Pick<
  ReactFlowInstance<ExecutionGraphNodeData, never>,
  "getNode" | "getNodes" | "getZoom" | "setCenter"
>;

export interface ExecutionGraphViewportSize {
  width: number;
  height: number;
}

interface ExecutionGraphBounds {
  maxX: number;
  maxY: number;
  minX: number;
  minY: number;
}

type ExecutionGraphNode = NonNullable<
  ReturnType<ExecutionGraphViewportInstance["getNode"]>
>;
type MeasuredExecutionGraphNode = ExecutionGraphNode & {
  height: number;
  width: number;
};

const isMeasuredNode = (
  node: ReturnType<ExecutionGraphViewportInstance["getNode"]>
): node is MeasuredExecutionGraphNode =>
  Boolean(
    node &&
      node.width !== null &&
      node.width !== undefined &&
      node.height !== null &&
      node.height !== undefined &&
      node.width > 0 &&
      node.height > 0 &&
      Number.isFinite(node.width) &&
      Number.isFinite(node.height) &&
      Number.isFinite(node.position.x) &&
      Number.isFinite(node.position.y)
  );

const getExecutionGraphBounds = (
  nodes: ReturnType<ExecutionGraphViewportInstance["getNodes"]>
): ExecutionGraphBounds | null => {
  const measuredNodes = nodes.filter(isMeasuredNode);
  if (measuredNodes.length === 0) return null;

  return {
    minX: Math.min(...measuredNodes.map((node) => node.position.x)),
    minY: Math.min(...measuredNodes.map((node) => node.position.y)),
    maxX: Math.max(
      ...measuredNodes.map((node) => node.position.x + node.width)
    ),
    maxY: Math.max(
      ...measuredNodes.map((node) => node.position.y + node.height)
    ),
  };
};

const clampCenterToBounds = (
  desiredCenter: number,
  min: number,
  max: number,
  viewportSize: number,
  zoom: number
): number => {
  const viewportSizeInGraphUnits = viewportSize / zoom;
  const graphSize = max - min;

  if (graphSize <= viewportSizeInGraphUnits) {
    return min + graphSize / 2;
  }

  const halfViewport = viewportSizeInGraphUnits / 2;
  return Math.min(
    Math.max(desiredCenter, min + halfViewport),
    max - halfViewport
  );
};

export const focusExecutionGraphNode = (
  reactFlow: ExecutionGraphViewportInstance,
  nodeId: string,
  viewportSize: ExecutionGraphViewportSize
): boolean => {
  const node = reactFlow.getNode(nodeId);
  if (!isMeasuredNode(node)) {
    return false;
  }

  const zoom = reactFlow.getZoom();
  if (
    !Number.isFinite(zoom) ||
    zoom <= 0 ||
    !Number.isFinite(viewportSize.width) ||
    !Number.isFinite(viewportSize.height) ||
    viewportSize.width <= 0 ||
    viewportSize.height <= 0
  ) {
    return false;
  }

  const bounds = getExecutionGraphBounds(reactFlow.getNodes());
  if (!bounds) return false;

  const centerX = clampCenterToBounds(
    node.position.x + node.width / 2,
    bounds.minX,
    bounds.maxX,
    viewportSize.width,
    zoom
  );
  const centerY = clampCenterToBounds(
    node.position.y + node.height / 2,
    bounds.minY,
    bounds.maxY,
    viewportSize.height,
    zoom
  );

  reactFlow.setCenter(centerX, centerY, {
    duration: 0,
    zoom,
  });
  return true;
};

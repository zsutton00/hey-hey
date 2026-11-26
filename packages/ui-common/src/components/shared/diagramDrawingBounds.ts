import { Position } from "@xyflow/react";
import type { DiagramGroup } from "../../api";
import { computeBoundaryBoxes } from "./diagramGroupBoundaries";
import type {
  getWorkflowEdgeLabelPosition,
  WorkflowGraphModel,
} from "./WorkflowMentionInlineRenderer";

/** Space between a boundary's left edge and its label. */
export const DIAGRAM_BOUNDARY_LABEL_INSET = 10;
/** Tallest a connection label renders: two caption lines. */
export const DIAGRAM_EDGE_LABEL_HEIGHT = 36;
/** How far a stepped connection runs out from an element before it turns. */
const CONNECTION_STUB_LENGTH = 20;

export interface DiagramRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type DrawingNode = WorkflowGraphModel["nodes"][number];
type DrawingEdge = WorkflowGraphModel["edges"][number];

interface HandleAnchor {
  x: number;
  y: number;
  side: Position;
}

const pointRect = (x: number, y: number): DiagramRect => ({
  x,
  y,
  width: 0,
  height: 0,
});

const elementRect = ({ position, data }: DrawingNode): DiagramRect => ({
  ...position,
  width: data.sizeConfig.nodeSize,
  height: data.sizeConfig.nodeSize,
});

/** Where a connection meets an element, matching the element's handles. */
const getHandleAnchor = (node: DrawingNode, handleId: string): HandleAnchor => {
  const { x, y } = node.position;
  const { sizeConfig, handles } = node.data;
  const size = sizeConfig.nodeSize;
  const spread = (ids: readonly string[]) =>
    (size * (ids.indexOf(handleId) + 1)) / (ids.length + 1);

  if (handleId === "left") {
    return { x, y: y + size / 2, side: Position.Left };
  }
  if (handleId === "right") {
    return { x: x + size, y: y + size / 2, side: Position.Right };
  }
  if (handleId === "cross-band-target") {
    return { x: x + size / 2, y, side: Position.Top };
  }
  if (handles.forwardSourceHandleIds.includes(handleId)) {
    return {
      x: x + size,
      y: y + spread(handles.forwardSourceHandleIds),
      side: Position.Right,
    };
  }
  if (handles.returnSourceHandleIds.includes(handleId)) {
    return {
      x: x + spread(handles.returnSourceHandleIds),
      y: y + size,
      side: Position.Bottom,
    };
  }
  if (handles.returnTargetHandleIds.includes(handleId)) {
    return {
      x: x + spread(handles.returnTargetHandleIds),
      y: y + size,
      side: Position.Bottom,
    };
  }
  const loopOffset = handleId === "loop-source" ? 0.35 : 0.65;
  return { x: x + size * loopOffset, y: y + size, side: Position.Bottom };
};

const stubEnd = ({ x, y, side }: HandleAnchor): DiagramRect => {
  switch (side) {
    case Position.Left:
      return pointRect(x - CONNECTION_STUB_LENGTH, y);
    case Position.Right:
      return pointRect(x + CONNECTION_STUB_LENGTH, y);
    case Position.Top:
      return pointRect(x, y - CONNECTION_STUB_LENGTH);
    case Position.Bottom:
      return pointRect(x, y + CONNECTION_STUB_LENGTH);
  }
};

/** The outermost points of a connection's path, plus its label. */
const getConnectionRects = (
  edge: DrawingEdge,
  nodesById: ReadonlyMap<string, DrawingNode>,
  getLabelPosition: typeof getWorkflowEdgeLabelPosition,
): DiagramRect[] => {
  const sourceNode = nodesById.get(edge.source);
  const targetNode = nodesById.get(edge.target);
  if (!edge.data || !sourceNode || !targetNode) {
    return [];
  }

  const { route, sizeConfig, label } = edge.data;
  const source = getHandleAnchor(sourceNode, edge.sourceHandle ?? "right");
  const target = getHandleAnchor(targetNode, edge.targetHandle ?? "left");

  const pathRects =
    route.kind === "return"
      ? [pointRect(source.x, route.gutterY)]
      : route.kind === "local-return"
        ? [pointRect(route.gutterX, source.y)]
        : route.kind === "cross-band"
          ? [pointRect(route.gutterX, route.gutterY)]
          : [stubEnd(source), stubEnd(target)];
  if (!label?.trim()) {
    return pathRects;
  }

  const [labelX, labelY] = getLabelPosition({
    route,
    sourceX: source.x,
    sourceY: source.y,
    sourcePosition: source.side,
    targetX: target.x,
    targetY: target.y,
    pathLabelX: (source.x + target.x) / 2,
    pathLabelY: (source.y + target.y) / 2,
    sizeConfig,
  });
  const labelRect = {
    x: labelX - sizeConfig.edgeLabelWidth / 2,
    y: labelY + sizeConfig.edgeLabelYOffset,
    width: sizeConfig.edgeLabelWidth,
    height: DIAGRAM_EDGE_LABEL_HEIGHT,
  };
  return [...pathRects, labelRect];
};

/**
 * Bounds of everything a Diagram draws: element squares, group boxes and their
 * labels, and routed connections with their labels. It reads only the graph
 * model, so the result is known before the canvas has measured anything.
 * Group labels do not wrap, so their rendered widths are passed in once known;
 * they can only widen the drawing to the right.
 */
export function computeDiagramDrawingBounds({
  model,
  groups,
  groupLabelWidths,
  getLabelPosition,
}: {
  model: Pick<WorkflowGraphModel, "nodes" | "edges" | "canvasHeight">;
  groups: readonly DiagramGroup[];
  groupLabelWidths: ReadonlyMap<string, number>;
  getLabelPosition: typeof getWorkflowEdgeLabelPosition;
}): DiagramRect | undefined {
  if (model.nodes.length === 0) {
    return undefined;
  }

  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const elements = model.nodes.map((node) => ({
    id: node.id,
    ...elementRect(node),
  }));
  const boxes = computeBoundaryBoxes(groups, elements);
  const groupLabels = boxes.map((box) => ({
    x: box.x,
    y: box.y,
    width: DIAGRAM_BOUNDARY_LABEL_INSET + (groupLabelWidths.get(box.id) ?? 0),
    height: 0,
  }));
  const connections = model.edges.flatMap((edge) =>
    getConnectionRects(edge, nodesById, getLabelPosition),
  );
  // The model reserves room below the elements for return and loop gutters.
  const usesBottomGutter = model.edges.some(
    ({ data }) => data?.route.kind === "return" || data?.route.kind === "loop",
  );
  const rects: DiagramRect[] = [
    ...elements,
    ...boxes,
    ...groupLabels,
    ...connections,
  ];

  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(
    ...rects.map((rect) => rect.y + rect.height),
    ...(usesBottomGutter ? [model.canvasHeight] : []),
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

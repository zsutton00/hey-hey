import type { DiagramGroup } from "../../api";
import { computeBoundaryBoxes } from "./diagramGroupBoundaries";
import {
  type DiagramRect,
  getDiagramConnectionRects,
  getDiagramElementRect,
  getDiagramGroupRects,
  unionDiagramRects,
} from "./diagramDrawingBounds";
import type {
  getWorkflowEdgeLabelPosition,
  WorkflowGraphModel,
} from "./WorkflowMentionInlineRenderer";

/**
 * How a Diagram close-up is framed around its highlighted elements: what it
 * zooms to, how far it may shrink, and which connections run out of view.
 */

/** Space kept between the framed drawing and the close-up's edges. */
export const DIAGRAM_CLOSEUP_MARGIN = 24;
/** Element names stop reading comfortably below this zoom. */
export const DIAGRAM_CLOSEUP_MIN_ZOOM = 0.8;
export const DIAGRAM_CLOSEUP_MIN_HEIGHT = 220;
export const DIAGRAM_CLOSEUP_MAX_HEIGHT = 480;

/** Absorbs sub-pixel rounding when testing whether something is in view. */
const VIEW_TOLERANCE = 0.5;

export interface DiagramCloseupViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface DiagramCloseupFrame {
  height: number;
  viewport: DiagramCloseupViewport;
}

export interface DiagramCloseupConnection {
  source: string;
  target: string;
}

/** Whether a region shows whole, at a readable zoom, in a close-up this wide. */
export const fitsDiagramCloseup = (
  region: DiagramRect,
  width: number,
): boolean =>
  region.width * DIAGRAM_CLOSEUP_MIN_ZOOM <=
    width - DIAGRAM_CLOSEUP_MARGIN * 2 &&
  region.height * DIAGRAM_CLOSEUP_MIN_ZOOM <=
    DIAGRAM_CLOSEUP_MAX_HEIGHT - DIAGRAM_CLOSEUP_MARGIN * 2;

/**
 * Where the drawing sits along one axis. The whole focus is centred when it
 * fits; otherwise the highlighted elements are, and when even they do not fit,
 * their start (and so a name) stays in view.
 */
const placeAxis = ({
  focus,
  highlight,
  frameLength,
  zoom,
}: {
  focus: { start: number; length: number };
  highlight: { start: number; length: number };
  frameLength: number;
  zoom: number;
}): number => {
  const available = frameLength - DIAGRAM_CLOSEUP_MARGIN * 2 + VIEW_TOLERANCE;
  const centred = ({ start, length }: { start: number; length: number }) =>
    frameLength / 2 - (start + length / 2) * zoom;

  if (focus.length * zoom <= available) {
    return centred(focus);
  }
  if (highlight.length * zoom <= available) {
    return centred(highlight);
  }
  return DIAGRAM_CLOSEUP_MARGIN - highlight.start * zoom;
};

/**
 * Zooms to the focus region without enlarging past natural size or shrinking
 * past the readable zoom. A focus that does not fit runs off the edges around
 * the highlighted region.
 */
export const frameDiagramCloseup = ({
  width,
  focus,
  highlight,
}: {
  width: number;
  focus: DiagramRect;
  highlight: DiagramRect;
}): DiagramCloseupFrame => {
  const margins = DIAGRAM_CLOSEUP_MARGIN * 2;
  const fittingZoom = Math.min(
    1,
    (width - margins) / focus.width,
    (DIAGRAM_CLOSEUP_MAX_HEIGHT - margins) / focus.height,
  );
  const zoom = Math.max(DIAGRAM_CLOSEUP_MIN_ZOOM, fittingZoom);
  const height = Math.min(
    DIAGRAM_CLOSEUP_MAX_HEIGHT,
    Math.max(DIAGRAM_CLOSEUP_MIN_HEIGHT, focus.height * zoom + margins),
  );

  return {
    height,
    viewport: {
      zoom,
      x: placeAxis({
        focus: { start: focus.x, length: focus.width },
        highlight: { start: highlight.x, length: highlight.width },
        frameLength: width,
        zoom,
      }),
      y: placeAxis({
        focus: { start: focus.y, length: focus.height },
        highlight: { start: highlight.y, length: highlight.height },
        frameLength: height,
        zoom,
      }),
    },
  };
};

/** Direct connections of the highlighted elements that lead out of view. */
export const countHiddenConnections = ({
  connections,
  highlightedIds,
  elementRects,
  frame,
  width,
}: {
  connections: readonly DiagramCloseupConnection[];
  highlightedIds: ReadonlySet<string>;
  elementRects: ReadonlyMap<string, DiagramRect>;
  frame: DiagramCloseupFrame;
  width: number;
}): number => {
  const { x, y, zoom } = frame.viewport;
  const isInView = (rect: DiagramRect) =>
    x + rect.x * zoom >= -VIEW_TOLERANCE &&
    y + rect.y * zoom >= -VIEW_TOLERANCE &&
    x + (rect.x + rect.width) * zoom <= width + VIEW_TOLERANCE &&
    y + (rect.y + rect.height) * zoom <= frame.height + VIEW_TOLERANCE;

  return connections.filter(({ source, target }) => {
    if (!highlightedIds.has(source) && !highlightedIds.has(target)) {
      return false;
    }
    const otherEnd = highlightedIds.has(source) ? target : source;
    const rect = elementRects.get(otherEnd);
    return rect !== undefined && !isInView(rect);
  }).length;
};

/**
 * The region a flow or structure close-up zooms to: the highlighted elements,
 * their direct neighbours, the connections and labels between them, and any
 * group frame around a highlighted element. Undefined when none of the
 * highlighted elements is drawn.
 */
export const getDiagramCloseupRegions = ({
  model,
  groups,
  groupLabelWidths,
  highlightedIds,
  getLabelPosition,
}: {
  model: Pick<WorkflowGraphModel, "nodes" | "edges">;
  groups: readonly DiagramGroup[];
  groupLabelWidths: ReadonlyMap<string, number>;
  highlightedIds: ReadonlySet<string>;
  getLabelPosition: typeof getWorkflowEdgeLabelPosition;
}):
  | {
      focus: DiagramRect;
      highlight: DiagramRect;
      elementRects: ReadonlyMap<string, DiagramRect>;
    }
  | undefined => {
  const nodesById = new Map(model.nodes.map((node) => [node.id, node]));
  const elementRects = new Map(
    model.nodes.map((node) => [node.id, getDiagramElementRect(node)]),
  );
  const highlight = unionDiagramRects(
    model.nodes
      .filter((node) => highlightedIds.has(node.id))
      .map(getDiagramElementRect),
  );
  if (!highlight) {
    return undefined;
  }

  const directConnections = model.edges.filter(
    ({ source, target }) =>
      highlightedIds.has(source) || highlightedIds.has(target),
  );
  const focusIds = new Set([
    ...highlightedIds,
    ...directConnections.flatMap(({ source, target }) => [source, target]),
  ]);
  const surroundingGroups = computeBoundaryBoxes(
    groups,
    [...elementRects].map(([id, rect]) => ({ id, ...rect })),
  ).filter((box) => box.memberNodeIds.some((id) => highlightedIds.has(id)));

  const focus = unionDiagramRects([
    ...model.nodes
      .filter((node) => focusIds.has(node.id))
      .map(getDiagramElementRect),
    ...directConnections.flatMap((edge) =>
      getDiagramConnectionRects(edge, nodesById, getLabelPosition),
    ),
    ...getDiagramGroupRects(surroundingGroups, groupLabelWidths),
  ])!;

  return { focus, highlight, elementRects };
};

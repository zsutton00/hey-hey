import React, {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Box } from "@mui/material";
import type { WorkflowGraphSurfaceData } from "../shared/WorkflowMentionInlineRenderer";
import { JOURNEY_SCREEN_WIDTH } from "./JourneyScreen";
import { findUxFlowStartScreenId } from "../shared/diagramElementMetadata";
import { layoutJourneyScreens } from "./layoutJourneyScreens";
import {
  gutterHeights,
  routeJourneyConnectors,
  type ScreenBox,
} from "./routeJourneyConnectors";

type Step = WorkflowGraphSurfaceData["steps"][number];

/** Plain canvas gray: the UX Flow Grid View mockup's light gray, or a dark gray in dark mode. */
const CANVAS_COLOR = { light: "#f0f2f5", dark: "#1e2126" };
const TRANSITION_COLOR = { light: "#5f6670", dark: "#a3aab4" };
const SCREEN_WIDTH = JOURNEY_SCREEN_WIDTH;
const DEFAULT_SCREEN_HEIGHT = 450;
const COLUMN_GAP = 160;
const ROW_GAP = 96;
const ARROW_INSET = 12;
/** Arrowheads scale with this, so thicker lines also give larger arrows. */
const CONNECTOR_WIDTH = 2.5;
/** Keeps horizontal arrows near the top of tall screens. */
const MAX_ANCHOR_OFFSET = 180;

/** Pointer travel (px) before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD = 4;

/**
 * Lets a mouse drag scroll the element. A press that moved is a drag, and the
 * click that follows it is swallowed so it does not open a screen or follow a
 * link.
 */
function useDragScroll(container: React.RefObject<HTMLElement | null>) {
  const [dragging, setDragging] = useState(false);
  const moved = useRef(false);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const element = container.current;
      if (!element || event.pointerType !== "mouse" || event.button !== 0) {
        return;
      }

      const start = {
        x: event.clientX,
        y: event.clientY,
        left: element.scrollLeft,
        top: element.scrollTop,
      };
      moved.current = false;

      const onMove = (move: PointerEvent) => {
        const dx = move.clientX - start.x;
        const dy = move.clientY - start.y;
        if (!moved.current) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) {
            return;
          }
          moved.current = true;
          setDragging(true);
        }
        element.scrollLeft = start.left - dx;
        element.scrollTop = start.top - dy;
      };
      const onEnd = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onEnd);
        window.removeEventListener("pointercancel", onEnd);
        setDragging(false);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    },
    [container],
  );

  const onClickCapture = useCallback((event: React.MouseEvent) => {
    if (moved.current) {
      moved.current = false;
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  // Native link and image dragging would cancel the pointer stream.
  const onDragStart = useCallback((event: React.DragEvent) => {
    event.preventDefault();
  }, []);

  return { dragging, onPointerDown, onClickCapture, onDragStart };
}

export const JourneyCanvas: React.FC<{
  steps: WorkflowGraphSurfaceData["steps"];
  edges: WorkflowGraphSurfaceData["edges"];
  /** Positions saved on the Diagram, keyed by step id. */
  savedPositions: ReadonlyMap<string, { x: number; y: number }>;
  renderScreen: (step: Step) => React.ReactNode;
  /** Static presentation at natural size: no scrolling, dragging or grab cursor. */
  readOnly?: boolean;
}> = ({ steps, edges, savedPositions, renderScreen, readOnly = false }) => {
  const markerId = useId();
  const container = useRef<HTMLDivElement>(null);
  const dragScroll = useDragScroll(container);
  const [heights, setHeights] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const elements = container.current?.querySelectorAll<HTMLElement>(
      '[data-testid="journey-screen"]',
    );
    if (!elements || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver((entries) => {
      setHeights((previous) => {
        const next = { ...previous };
        let changed = false;
        entries.forEach((entry) => {
          const id = entry.target.getAttribute("data-step-id");
          if (id && next[id] !== entry.contentRect.height) {
            next[id] = entry.contentRect.height;
            changed = true;
          }
        });
        return changed ? next : previous;
      });
    });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, [steps]);
  const cells = layoutJourneyScreens(
    steps.map(({ id, name }) => ({ id, name })),
    edges.map((edge) => ({
      id: edge.id,
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
      role: edge.transitionRole ?? null,
      actionLabel: edge.actionLabel ?? null,
    })),
    savedPositions,
    findUxFlowStartScreenId(steps),
  );
  const connectorEdges = edges.map((edge) => ({
    id: edge.id,
    sourceId: edge.sourceNodeId,
    targetId: edge.targetNodeId,
  }));
  const gaps = gutterHeights(cells, connectorEdges, ROW_GAP);
  const rowCount = Math.max(
    0,
    ...[...cells.values()].map(({ row }) => row + 1),
  );
  const columnCount = Math.max(
    0,
    ...[...cells.values()].map(({ column }) => column + 1),
  );
  const rowHeights = Array.from({ length: rowCount }, (_, row) =>
    Math.max(
      0,
      ...steps
        .filter((step) => cells.get(step.id)?.row === row)
        .map((step) => heights[step.id] ?? DEFAULT_SCREEN_HEIGHT),
    ),
  );
  const rowGap = (row: number) => gaps.get(row) ?? ROW_GAP;
  const rowTops = rowHeights.map((_, row) =>
    rowHeights
      .slice(0, row)
      .reduce((top, height, index) => top + height + rowGap(index), 0),
  );
  const totalWidth = Math.max(
    0,
    columnCount * (SCREEN_WIDTH + COLUMN_GAP) - COLUMN_GAP,
  );
  // The last row only needs room below it when connectors run through its gutter.
  const lastRow = rowCount - 1;
  const totalHeight = Math.max(
    0,
    rowHeights.reduce(
      (sum, height, row) =>
        sum + height + (row < lastRow ? rowGap(row) : (gaps.get(row) ?? 0)),
      0,
    ),
  );
  const positions = new Map(
    steps.flatMap((step) => {
      const cell = cells.get(step.id);
      if (!cell) {
        return [];
      }
      const box: ScreenBox = {
        x: cell.column * (SCREEN_WIDTH + COLUMN_GAP),
        y: rowTops[cell.row],
        width: SCREEN_WIDTH,
        height: heights[step.id] ?? DEFAULT_SCREEN_HEIGHT,
      };
      return [[step.id, box] as const];
    }),
  );
  return (
    <Box
      ref={container}
      data-testid="journey-canvas"
      onPointerDown={readOnly ? undefined : dragScroll.onPointerDown}
      onClickCapture={readOnly ? undefined : dragScroll.onClickCapture}
      onDragStart={readOnly ? undefined : dragScroll.onDragStart}
      sx={{
        ...(readOnly
          ? { width: "max-content" }
          : {
              overflow: "auto",
              cursor: dragScroll.dragging ? "grabbing" : "grab",
              userSelect: dragScroll.dragging ? "none" : undefined,
            }),
        bgcolor: (theme) => CANVAS_COLOR[theme.palette.mode],
        p: 3,
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: totalWidth,
          height: totalHeight,
        }}
      >
        <Box
          component="svg"
          width={totalWidth}
          height={totalHeight}
          sx={{
            position: "absolute",
            inset: 0,
            overflow: "visible",
            color: (theme) => TRANSITION_COLOR[theme.palette.mode],
            "& text": {
              stroke: (theme) => CANVAS_COLOR[theme.palette.mode],
            },
          }}
        >
          <defs>
            <marker
              id={markerId}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {routeJourneyConnectors(cells, positions, connectorEdges, {
            columnGap: COLUMN_GAP,
            inset: ARROW_INSET,
            maxAnchorOffset: MAX_ANCHOR_OFFSET,
          }).map(({ edgeId, path, label }) => {
            const edge = edges.find(({ id }) => id === edgeId)!;
            return (
              <g
                key={edge.id}
                data-testid="journey-transition"
                data-edge-id={edge.id}
                data-transition-role={edge.transitionRole ?? undefined}
              >
                <path
                  d={path}
                  stroke="currentColor"
                  strokeWidth={CONNECTOR_WIDTH}
                  fill="none"
                  markerEnd={`url(#${markerId})`}
                />
                <text
                  x={label.x}
                  y={label.y}
                  textAnchor={label.anchor}
                  fill="currentColor"
                  fontSize="12"
                  paintOrder="stroke"
                  strokeWidth="4"
                >
                  {edge.actionLabel ?? edge.predicate}
                </text>
              </g>
            );
          })}
        </Box>
        {steps.map((step) => {
          const box = positions.get(step.id);
          return box ? (
            <Box
              key={step.id}
              data-testid="journey-screen"
              data-step-id={step.id}
              sx={{
                position: "absolute",
                left: box.x,
                top: box.y,
                width: box.width,
              }}
            >
              {renderScreen(step)}
            </Box>
          ) : null;
        })}
      </Box>
    </Box>
  );
};

import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import type { WorkflowGraphSurfaceData } from "../shared/WorkflowMentionInlineRenderer";
import { placeJourneyScreens } from "./placeJourneyScreens";

type Step = WorkflowGraphSurfaceData["steps"][number];

/** Plain canvas gray: the UX Flow Grid View mockup's light gray, or a dark gray in dark mode. */
const CANVAS_COLOR = { light: "#f0f2f5", dark: "#1e2126" };
const TRANSITION_COLOR = { light: "#5f6670", dark: "#a3aab4" };
const SCREEN_WIDTH = 400;
const DEFAULT_SCREEN_HEIGHT = 600;
const COLUMN_GAP = 160;
const ROW_GAP = 96;
const ARROW_INSET = 8;
/** Keeps horizontal arrows near the top of tall screens. */
const MAX_ANCHOR_OFFSET = 180;

interface ScreenBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Joins the facing sides of two screens: left/right across columns, top/bottom within one. */
function transitionAnchors(source: ScreenBox, target: ScreenBox) {
  const horizontal = source.x !== target.x;
  if (horizontal) {
    const eastward = target.x > source.x;
    return {
      start: {
        horizontal,
        x: eastward
          ? source.x + source.width + ARROW_INSET
          : source.x - ARROW_INSET,
        y: source.y + Math.min(source.height / 2, MAX_ANCHOR_OFFSET),
      },
      end: {
        x: eastward
          ? target.x - ARROW_INSET
          : target.x + target.width + ARROW_INSET,
        y: target.y + Math.min(target.height / 2, MAX_ANCHOR_OFFSET),
      },
    };
  }
  const southward = target.y > source.y;
  return {
    start: {
      horizontal,
      x: source.x + source.width / 2,
      y: southward
        ? source.y + source.height + ARROW_INSET
        : source.y - ARROW_INSET,
    },
    end: {
      x: target.x + target.width / 2,
      y: southward
        ? target.y - ARROW_INSET
        : target.y + target.height + ARROW_INSET,
    },
  };
}

export const JourneyCanvas: React.FC<{
  steps: WorkflowGraphSurfaceData["steps"];
  edges: WorkflowGraphSurfaceData["edges"];
  /** Positions saved on the Diagram, keyed by step id. */
  savedPositions: ReadonlyMap<string, { x: number; y: number }>;
  renderScreen: (step: Step) => React.ReactNode;
}> = ({ steps, edges, savedPositions, renderScreen }) => {
  const markerId = useId();
  const container = useRef<HTMLDivElement>(null);
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
  const cells = placeJourneyScreens(
    steps.map((step) => step.id),
    edges.map((edge) => ({
      sourceId: edge.sourceNodeId,
      targetId: edge.targetNodeId,
    })),
    savedPositions,
  );
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
  const rowTops = rowHeights.map((_, row) =>
    rowHeights.slice(0, row).reduce((top, height) => top + height + ROW_GAP, 0),
  );
  const totalWidth = Math.max(
    0,
    columnCount * (SCREEN_WIDTH + COLUMN_GAP) - COLUMN_GAP,
  );
  const totalHeight = Math.max(
    0,
    rowHeights.reduce((sum, height) => sum + height + ROW_GAP, 0) - ROW_GAP,
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
      sx={{
        overflow: "auto",
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
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const source = positions.get(edge.sourceNodeId);
            const target = positions.get(edge.targetNodeId);
            if (!source || !target) {
              return null;
            }
            const { start, end } = transitionAnchors(source, target);
            const midX = (start.x + end.x) / 2;
            const midY = (start.y + end.y) / 2;
            const horizontal = start.horizontal;
            const curve = horizontal
              ? `C ${midX} ${start.y}, ${midX} ${end.y}`
              : `C ${start.x} ${midY}, ${end.x} ${midY}`;
            return (
              <g
                key={edge.id}
                data-testid="journey-transition"
                data-edge-id={edge.id}
              >
                <path
                  d={`M ${start.x} ${start.y} ${curve}, ${end.x} ${end.y}`}
                  stroke="currentColor"
                  fill="none"
                  markerEnd={`url(#${markerId})`}
                />
                <text
                  x={horizontal ? midX : midX + 8}
                  y={horizontal ? midY - 12 : midY}
                  textAnchor={horizontal ? "middle" : "start"}
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

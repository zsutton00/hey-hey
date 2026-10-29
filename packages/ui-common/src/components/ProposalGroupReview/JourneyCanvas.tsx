import React, { useId, useLayoutEffect, useRef, useState } from "react";
import { Box } from "@mui/material";
import { layoutExecutionGraph } from "../shared/ExecutionGraph/layoutExecutionGraph";
import type { WorkflowGraphSurfaceData } from "../shared/WorkflowMentionInlineRenderer";

type Step = WorkflowGraphSurfaceData["steps"][number];

export const JourneyCanvas: React.FC<{
  steps: WorkflowGraphSurfaceData["steps"];
  edges: WorkflowGraphSurfaceData["edges"];
  renderScreen: (step: Step) => React.ReactNode;
}> = ({ steps, edges, renderScreen }) => {
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
  const layout = layoutExecutionGraph(
    {
      nodes: steps.map((step) => ({
        id: step.id,
        title: step.name,
        state: "idle",
        metadata: [],
      })),
      dependencyEdges: edges.map((edge) => ({
        id: edge.id,
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
      })),
    },
    Object.fromEntries(steps.map((step) => [step.id, heights[step.id] ?? 600])),
  );
  const positions = new Map(layout.nodes.map((node) => [node.id, node]));
  return (
    <Box
      ref={container}
      sx={{
        overflow: "auto",
        bgcolor: "background.default",
        backgroundImage: (theme) =>
          `radial-gradient(${theme.palette.divider} 1px, transparent 1px)`,
        backgroundSize: "16px 16px",
        p: 3,
      }}
    >
      <Box
        sx={{
          position: "relative",
          width: layout.totalWidth,
          height: layout.totalHeight,
        }}
      >
        <Box
          component="svg"
          width={layout.totalWidth}
          height={layout.totalHeight}
          sx={(theme) => ({
            position: "absolute",
            inset: 0,
            overflow: "visible",
            color: "text.secondary",
            "& text": { stroke: theme.palette.background.default },
          })}
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
            const x1 = source.position.x + source.width + 8;
            const x2 = target.position.x - 8;
            const y1 = source.position.y + Math.min(source.height / 2, 180);
            const y2 = target.position.y + Math.min(target.height / 2, 180);
            const mid = (x1 + x2) / 2;
            return (
              <g
                key={edge.id}
                data-testid="journey-transition"
                data-edge-id={edge.id}
              >
                <path
                  d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
                  stroke="currentColor"
                  fill="none"
                  markerEnd={`url(#${markerId})`}
                />
                <text
                  x={mid}
                  y={(y1 + y2) / 2 - 12}
                  textAnchor="middle"
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
        {layout.nodes.map((node) => {
          const step = steps.find((step) => step.id === node.id);
          return step ? (
            <Box
              key={node.id}
              data-testid="journey-screen"
              data-step-id={node.id}
              sx={{
                position: "absolute",
                left: node.position.x,
                top: node.position.y,
                width: node.width,
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

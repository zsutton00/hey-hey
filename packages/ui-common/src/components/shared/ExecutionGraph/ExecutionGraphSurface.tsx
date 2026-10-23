import { Box, useTheme } from "@mui/material";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Controls,
  useNodesInitialized,
  useReactFlow,
  useStore,
  type NodeTypes,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  ExecutionGraphNode,
  type ExecutionGraphNodeData,
} from "./ExecutionGraphNode";
import type { ExecutionGraphViewModel } from "./executionGraphViewModel";
import {
  focusExecutionGraphNode,
  type ExecutionGraphViewportSize,
} from "./focusExecutionGraphNode";
import { layoutExecutionGraph } from "./layoutExecutionGraph";

export interface ExecutionGraphSurfaceProps {
  viewModel: ExecutionGraphViewModel;
  selectedNodeId: string | null;
  onNodeSelect: (nodeId: string) => void;
  initialFocusNodeId?: string | null;
  selectable?: boolean;
  animateCurrentTask?: boolean;
  fitView?: boolean;
  minHeight?: number;
}

const nodeTypes: NodeTypes = { executionGraphNode: ExecutionGraphNode };

const ExecutionGraphInitialFocus = ({
  nodeId,
  layoutMeasured,
}: {
  nodeId: string | null;
  layoutMeasured: boolean;
}) => {
  const reactFlow = useReactFlow<ExecutionGraphNodeData, never>();
  const viewportSize = useStore<ExecutionGraphViewportSize>(
    (state) => ({ width: state.width, height: state.height }),
    (left, right) =>
      left.width === right.width && left.height === right.height
  );
  const nodesInitialized = useNodesInitialized({ includeHiddenNodes: false });
  const focusedNodeIdRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (
      !nodeId ||
      focusedNodeIdRef.current === nodeId ||
      !layoutMeasured ||
      !nodesInitialized ||
      !reactFlow.viewportInitialized ||
      viewportSize.width <= 0 ||
      viewportSize.height <= 0
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (focusExecutionGraphNode(reactFlow, nodeId, viewportSize)) {
        focusedNodeIdRef.current = nodeId;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [layoutMeasured, nodeId, nodesInitialized, reactFlow, viewportSize]);

  return null;
};

export const ExecutionGraphSurface = ({
  viewModel,
  selectedNodeId,
  onNodeSelect,
  initialFocusNodeId = null,
  selectable = true,
  animateCurrentTask = true,
  fitView = false,
  minHeight = 400,
}: ExecutionGraphSurfaceProps) => {
  const theme = useTheme();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [measuredHeights, setMeasuredHeights] = useState<
    Record<string, number>
  >({});
  const layout = useMemo(
    () => layoutExecutionGraph(viewModel, measuredHeights),
    [viewModel, measuredHeights]
  );
  const layoutMeasured = viewModel.nodes.every(
    (node) => measuredHeights[node.id] > 0
  );

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const frame = requestAnimationFrame(() => {
      const nextHeights: Record<string, number> = {};
      container
        .querySelectorAll<HTMLElement>(".react-flow__node")
        .forEach((element) => {
          const nodeId = element.dataset.id;
          const height = Math.ceil(element.getBoundingClientRect().height);
          if (nodeId && height > 0) nextHeights[nodeId] = height;
        });
      const changed = Object.entries(nextHeights).some(
        ([nodeId, height]) => measuredHeights[nodeId] !== height
      );
      if (changed) setMeasuredHeights(nextHeights);
    });
    return () => cancelAnimationFrame(frame);
  }, [layout.nodes, measuredHeights]);

  const nodes = useMemo(
    () =>
      layout.nodes.map((node) => ({
        id: node.id,
        type: "executionGraphNode",
        position: node.position,
        width: node.width,
        height: node.height,
        selected: selectable && node.id === selectedNodeId,
        data: {
          node,
          hasIncomingEdges: node.hasIncomingEdges,
          hasOutgoingEdges: node.hasOutgoingEdges,
          siblingIndex: node.siblingIndex,
          siblingCount: node.siblingCount,
          animateCurrentTask,
        } satisfies ExecutionGraphNodeData,
      })),
    [animateCurrentTask, layout.nodes, selectable, selectedNodeId]
  );
  const edges = useMemo(() => {
    const stateByNodeId = new Map(
      layout.nodes.map((node) => [node.id, node.state])
    );
    return layout.dependencyEdges.map((edge) => {
      const targetState = stateByNodeId.get(edge.targetNodeId);
      const blocked = targetState === "blocked";
      const emphasized = targetState === "eligible" || targetState === "active";
      return {
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        type: "default",
        animated: false,
        style: {
          strokeWidth: blocked ? 2 : 3,
          strokeDasharray: blocked ? "8 4" : undefined,
          stroke: blocked
            ? theme.palette.action.disabled
            : emphasized
            ? theme.palette.mode === "dark"
              ? "rgba(126, 182, 224, 0.82)"
              : "rgba(25, 118, 210, 0.6)"
            : theme.palette.mode === "dark"
            ? "rgba(255, 255, 255, 0.42)"
            : "rgba(33, 33, 33, 0.28)",
        },
      };
    });
  }, [
    layout.dependencyEdges,
    layout.nodes,
    theme.palette.action.disabled,
    theme.palette.mode,
  ]);
  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: { id: string }) => onNodeSelect(node.id),
    [onNodeSelect]
  );
  const translateExtent = useMemo<[[number, number], [number, number]]>(
    () => [
      [-100, -100],
      [
        Math.max(layout.totalWidth, 100),
        Math.max(layout.totalHeight, minHeight),
      ],
    ],
    [layout.totalHeight, layout.totalWidth, minHeight]
  );

  return (
    <Box
      ref={containerRef}
      data-testid="execution-graph-surface"
      sx={{
        width: "100%",
        height: Math.max(layout.totalHeight, minHeight),
        minHeight,
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={handleNodeClick}
        fitView={fitView}
        fitViewOptions={{ padding: 0.25 }}
        minZoom={0.35}
        maxZoom={1.5}
        defaultViewport={{ x: 0, y: 0, zoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll={fitView}
        zoomOnPinch={fitView}
        zoomOnDoubleClick={false}
        translateExtent={translateExtent}
        preventScrolling={fitView}
        proOptions={{ hideAttribution: true }}
      >
        <ExecutionGraphInitialFocus
          nodeId={initialFocusNodeId ?? null}
          layoutMeasured={layoutMeasured}
        />
        <Controls showFitView={fitView} showInteractive={false} />
      </ReactFlow>
    </Box>
  );
};

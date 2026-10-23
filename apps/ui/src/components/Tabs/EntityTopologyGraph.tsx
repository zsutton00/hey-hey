import {
  Alert,
  Box,
  Card,
  Chip,
  CircularProgress,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { useTheme, type Theme } from "@mui/material/styles";
import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  TopologyEntityGraphEdge,
  TopologyEntityGraphNode,
} from "@hey-hey/ui-common/data";
import { getEntityColors } from "@hey-hey/ui-common/utils";

export interface EntityTopologyGraphProps {
  nodes: TopologyEntityGraphNode[];
  edges: TopologyEntityGraphEdge[];
  isLoading?: boolean;
  error?: Error | null;
  height?: number;
  selectedNodeId?: string;
  onNodeSelect?: (node: TopologyEntityGraphNode) => void;
}

interface PositionedNode {
  node: TopologyEntityGraphNode;
  x: number;
  y: number;
}

const NODE_DIAMETER = 16;
const NODE_SELECTED_DIAMETER = 20;
const NODE_SEED_DIAMETER = 24;
const INNER_RING_RADIUS = 96;
const RING_GAP = 118;
const RING_NODE_SPACING = 24;
const MIN_SVG_WIDTH = 760;
const MIN_SVG_HEIGHT = 520;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 3.2;

function resolveThemeToken(theme: Theme, token: string): string {
  if (token === "transparent") {
    return "transparent";
  }
  if (!token.includes(".")) {
    return token;
  }

  const path = token.split(".");
  let current: unknown = theme.palette;

  for (const segment of path) {
    if (
      typeof current === "object" &&
      current !== null &&
      segment in (current as Record<string, unknown>)
    ) {
      current = (current as Record<string, unknown>)[segment];
      continue;
    }
    return token;
  }

  return typeof current === "string" ? current : token;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const EntityTopologyGraph: React.FC<EntityTopologyGraphProps> = ({
  nodes,
  edges,
  isLoading = false,
  error = null,
  height = MIN_SVG_HEIGHT,
  selectedNodeId,
  onNodeSelect,
}) => {
  const theme = useTheme();
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const hasInteractedRef = useRef(false);
  const dragStateRef = useRef<{
    active: boolean;
    moved: boolean;
    startX: number;
    startY: number;
    panX: number;
    panY: number;
  }>({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    panX: 0,
    panY: 0,
  });

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const layout = useMemo(() => {
    const depthMap = new Map<number, TopologyEntityGraphNode[]>();

    nodes.forEach((node) => {
      const depth = node.isSeed ? 0 : Math.max(1, node.pathDepth);
      const bucket = depthMap.get(depth);
      if (bucket) {
        bucket.push(node);
      } else {
        depthMap.set(depth, [node]);
      }
    });

    const sortedDepths = Array.from(depthMap.keys()).sort((a, b) => a - b);
    const ringRadiusByDepth = new Map<number, number>();
    let maxRadius = 0;

    sortedDepths.forEach((depth) => {
      if (depth === 0) return;
      const depthNodes = depthMap.get(depth) ?? [];
      const baselineRadius = INNER_RING_RADIUS + (depth - 1) * RING_GAP;
      const densityRadius =
        (Math.max(depthNodes.length, 1) * RING_NODE_SPACING) / (Math.PI * 2);
      const ringRadius = Math.max(baselineRadius, densityRadius);
      ringRadiusByDepth.set(depth, ringRadius);
      maxRadius = Math.max(maxRadius, ringRadius);
    });

    const svgWidth = Math.max(MIN_SVG_WIDTH, maxRadius * 2 + 260);
    const svgHeight = Math.max(height, MIN_SVG_HEIGHT, maxRadius * 2 + 260);
    const centerX = svgWidth / 2;
    const centerY = svgHeight / 2;
    const positioned: PositionedNode[] = [];

    sortedDepths.forEach((depth) => {
      const depthNodes = depthMap.get(depth) ?? [];

      if (depth === 0) {
        const seedNode = depthNodes.find((node) => node.isSeed) ?? depthNodes[0];
        if (seedNode) {
          positioned.push({ node: seedNode, x: centerX, y: centerY });
        }
        return;
      }

      const ringRadius = ringRadiusByDepth.get(depth) ?? INNER_RING_RADIUS;
      const step = (Math.PI * 2) / Math.max(depthNodes.length, 1);
      depthNodes.forEach((node, index) => {
        const angle = -Math.PI / 2 + step * index;
        const x = centerX + Math.cos(angle) * ringRadius;
        const y = centerY + Math.sin(angle) * ringRadius;
        positioned.push({ node, x, y });
      });
    });

    const layoutById = new Map<string, PositionedNode>();
    positioned.forEach((item) => {
      layoutById.set(item.node.id, item);
    });

    const normalizedEdges = edges
      .map((edge) => {
        const source = layoutById.get(edge.source);
        const target = layoutById.get(edge.target);
        if (!source || !target) {
          return null;
        }
        const midX = (source.x + target.x) / 2;
        const midY = (source.y + target.y) / 2;
        const isConnectedToSelection =
          selectedNodeId === edge.source || selectedNodeId === edge.target;
        return {
          edge,
          source,
          target,
          midX,
          midY,
          isConnectedToSelection,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const showAllEdgeLabels = normalizedEdges.length <= 120;

    return {
      positioned,
      normalizedEdges,
      svgWidth,
      svgHeight,
      centerX,
      centerY,
      maxDepth: sortedDepths.length > 0 ? Math.max(...sortedDepths) : 0,
      ringRadiusByDepth,
      showAllEdgeLabels,
    };
  }, [edges, height, nodes, selectedNodeId]);

  useEffect(() => {
    if (!viewportRef.current || hasInteractedRef.current) {
      return;
    }

    const viewport = viewportRef.current.getBoundingClientRect();
    const fitScale = Math.min(
      viewport.width / layout.svgWidth,
      viewport.height / layout.svgHeight,
    );
    const initialZoom = clamp(fitScale * 1.18, 0.9, 1.8);
    const centeredPanX = (viewport.width - layout.svgWidth * initialZoom) / 2;
    const centeredPanY = (viewport.height - layout.svgHeight * initialZoom) / 2;

    setZoom(initialZoom);
    setPan({ x: centeredPanX, y: centeredPanY });
  }, [layout.svgHeight, layout.svgWidth]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragStateRef.current.active) return;
      const deltaX = event.clientX - dragStateRef.current.startX;
      const deltaY = event.clientY - dragStateRef.current.startY;
      if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
        dragStateRef.current.moved = true;
      }
      const nextX = dragStateRef.current.panX + deltaX;
      const nextY = dragStateRef.current.panY + deltaY;
      setPan({ x: nextX, y: nextY });
    };

    const handleMouseUp = () => {
      if (!dragStateRef.current.active) return;
      dragStateRef.current.active = false;
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  if (isLoading) {
    return (
      <Card variant="outlined">
        <Box
          sx={{
            minHeight: 240,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Stack spacing={1.5} alignItems="center">
            <CircularProgress size={24} />
            <Typography variant="body2" color="text.secondary">
              Loading topology graph...
            </Typography>
          </Stack>
        </Box>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert severity="error" variant="outlined">
        {error.message}
      </Alert>
    );
  }

  if (nodes.length === 0) {
    return (
      <Alert severity="info" variant="outlined">
        No topology graph nodes were returned for this entity.
      </Alert>
    );
  }

  return (
    <Card variant="outlined" sx={{ overflow: "hidden" }}>
      <Box sx={{ p: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap>
          <Typography variant="subtitle2" fontWeight={700}>
            Entity Topology Graph
          </Typography>
          <Chip size="small" label={`${nodes.length} nodes`} />
          <Chip size="small" label={`${edges.length} edges`} />
          <Chip size="small" label="Drag to pan, wheel to zoom" />
        </Stack>
      </Box>

      <Box
        ref={viewportRef}
        sx={{
          position: "relative",
          height: layout.svgHeight,
          overflow: "hidden",
          bgcolor: "background.default",
          cursor: isDragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          hasInteractedRef.current = true;
          dragStateRef.current = {
            active: true,
            moved: false,
            startX: event.clientX,
            startY: event.clientY,
            panX: pan.x,
            panY: pan.y,
          };
          setIsDragging(true);
        }}
        onWheel={(event) => {
          event.preventDefault();
          if (!viewportRef.current) return;

          hasInteractedRef.current = true;
          const rect = viewportRef.current.getBoundingClientRect();
          const pointX = event.clientX - rect.left;
          const pointY = event.clientY - rect.top;
          const zoomDelta = Math.exp(-event.deltaY * 0.0014);
          const nextZoom = clamp(zoom * zoomDelta, MIN_ZOOM, MAX_ZOOM);

          const worldX = (pointX - pan.x) / zoom;
          const worldY = (pointY - pan.y) / zoom;
          const nextPanX = pointX - worldX * nextZoom;
          const nextPanY = pointY - worldY * nextZoom;

          setZoom(nextZoom);
          setPan({ x: nextPanX, y: nextPanY });
        }}
      >
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            width: layout.svgWidth,
            minHeight: layout.svgHeight,
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
          }}
        >
          <svg
            width={layout.svgWidth}
            height={layout.svgHeight}
            style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
          >
            {Array.from({ length: layout.maxDepth + 1 }).map((_, depth) => {
              if (depth === 0) {
                return (
                  <circle
                    key="center-dot"
                    cx={layout.centerX}
                    cy={layout.centerY}
                    r={2}
                    fill={theme.palette.divider}
                  />
                );
              }

              const radius = layout.ringRadiusByDepth.get(depth) ?? INNER_RING_RADIUS;
              return (
                <circle
                  key={`ring-${depth}`}
                  cx={layout.centerX}
                  cy={layout.centerY}
                  r={radius}
                  fill="none"
                  stroke={theme.palette.divider}
                  strokeDasharray="3 7"
                  strokeWidth={1}
                  opacity={0.45}
                />
              );
            })}

            {layout.normalizedEdges.map(
              ({ edge, source, target, midX, midY, isConnectedToSelection }) => {
                const isSelected =
                  selectedNodeId === edge.source || selectedNodeId === edge.target;
                const showLabel = layout.showAllEdgeLabels || isConnectedToSelection;

                return (
                  <g key={edge.id}>
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={isSelected ? theme.palette.primary.main : "#90a4ae"}
                      strokeWidth={isSelected ? 1.8 : 1}
                      strokeOpacity={0.85}
                    />
                    {showLabel ? (
                      <>
                        <rect
                          x={midX - 34}
                          y={midY - 8}
                          width={68}
                          height={16}
                          rx={8}
                          fill={theme.palette.background.paper}
                          opacity={0.94}
                        />
                        <text
                          x={midX}
                          y={midY + 3.5}
                          textAnchor="middle"
                          style={{
                            fontSize: "9px",
                            fill: theme.palette.text.secondary,
                            fontWeight: 700,
                          }}
                        >
                          {edge.relationshipType}
                        </text>
                      </>
                    ) : null}
                  </g>
                );
              },
            )}
          </svg>

          {layout.positioned.map(({ node, x, y }) => {
            const colors = getEntityColors(node.entityType);
            const nodeFill = resolveThemeToken(theme, colors.background);
            const nodeBorder = resolveThemeToken(theme, colors.color);
            const isSelected = selectedNodeId === node.id;
            const diameter = node.isSeed
              ? NODE_SEED_DIAMETER
              : isSelected
                ? NODE_SELECTED_DIAMETER
                : NODE_DIAMETER;

            const tooltipTitle = `${node.label}\n${node.entityId}\n${node.entityType}`;

            return (
              <Tooltip key={node.id} title={tooltipTitle} placement="top" arrow>
                <button
                  onClick={(event) => {
                    if (dragStateRef.current.active || dragStateRef.current.moved) {
                      event.preventDefault();
                      dragStateRef.current.moved = false;
                      return;
                    }
                    onNodeSelect?.(node);
                  }}
                  type="button"
                  aria-label={`${node.label} (${node.entityId})`}
                  style={{
                    position: "absolute",
                    left: x - diameter / 2,
                    top: y - diameter / 2,
                    width: diameter,
                    height: diameter,
                    borderRadius: "50%",
                    border: isSelected
                      ? `2px solid ${theme.palette.primary.main}`
                      : `1.5px solid ${nodeBorder}`,
                    background: nodeFill,
                    cursor: "pointer",
                    padding: 0,
                    boxShadow: isSelected ? "0 0 0 3px rgba(25,118,210,0.2)" : "none",
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
      </Box>
    </Card>
  );
};

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
import { useMemo } from "react";
import type {
  TopologyEntityGraphEdge,
  TopologyEntityGraphNode,
} from "../../data/hooks/useTopologyEntityGraph";
import { getEntityColors } from "../../utils/entityIcons";

export interface EntityTopologyVisualizerProps {
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

interface ConnectedEdgeSummary {
  relationshipType: string;
  directionLabel: "in" | "out" | "link";
  otherNodeId: string;
  otherNodeLabel: string;
}

interface ParsedNodeId {
  entityType?: string;
  entityId?: string;
}

const NODE_DIAMETER = 16;
const NODE_SELECTED_DIAMETER = 20;
const NODE_SEED_DIAMETER = 24;
const INNER_RING_RADIUS = 68;
const RING_GAP = 74;
const MIN_SVG_WIDTH = 760;
const MIN_SVG_HEIGHT = 520;

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

function parseGraphNodeId(nodeId: string): ParsedNodeId {
  const parts = nodeId.split(":");
  if (parts.length !== 3 || parts[0] !== "entity") {
    return {};
  }

  return {
    entityType: parts[1],
    entityId: parts[2],
  };
}

function getConnectedEdges(
  directConnectedEdges: ConnectedEdgeSummary[],
  layout: {
    positioned: PositionedNode[];
    connectedEdgesByNodeId: Map<string, ConnectedEdgeSummary[]>;
    normalizedEdges: {
      edge: TopologyEntityGraphEdge;
      source: PositionedNode;
      target: PositionedNode;
      midX: number;
      midY: number;
      isConnectedToSelection: boolean;
    }[];
    svgWidth: number;
    svgHeight: number;
    centerX: number;
    centerY: number;
    maxDepth: number;
    showAllEdgeLabels: boolean;
  },
  node: TopologyEntityGraphNode
) {
  return directConnectedEdges.length > 0
    ? directConnectedEdges
    : layout.normalizedEdges.flatMap(({ edge }) => {
        const sourceParsed = parseGraphNodeId(edge.source);
        const targetParsed = parseGraphNodeId(edge.target);

        const matchesSource =
          edge.source === node.id ||
          (sourceParsed.entityId === node.entityId &&
            sourceParsed.entityType === node.entityType);
        const matchesTarget =
          edge.target === node.id ||
          (targetParsed.entityId === node.entityId &&
            targetParsed.entityType === node.entityType);

        if (!matchesSource && !matchesTarget) {
          return [];
        }

        const otherNodeId = matchesSource
          ? targetParsed.entityId ?? edge.target
          : sourceParsed.entityId ?? edge.source;
        const otherNodeLabel =
          layout.positioned.find(
            (positionedNode) =>
              positionedNode.node.id ===
              (matchesSource ? edge.target : edge.source)
          )?.node.title ??
          layout.positioned.find(
            (positionedNode) =>
              positionedNode.node.id ===
              (matchesSource ? edge.target : edge.source)
          )?.node.label ??
          otherNodeId;

        return [
          {
            relationshipType: edge.relationshipType,
            directionLabel:
              edge.direction === "INCOMING"
                ? matchesSource
                  ? "in"
                  : "out"
                : edge.direction === "OUTGOING"
                ? matchesSource
                  ? "out"
                  : "in"
                : "link",
            otherNodeId,
            otherNodeLabel,
          } satisfies ConnectedEdgeSummary,
        ];
      });
}

export function EntityTopologyVisualizer({
  nodes,
  edges,
  isLoading = false,
  error = null,
  height = MIN_SVG_HEIGHT,
  selectedNodeId,
  onNodeSelect,
}: EntityTopologyVisualizerProps) {
  const theme = useTheme();

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
    const maxDepth = sortedDepths.length > 0 ? Math.max(...sortedDepths) : 0;
    const svgWidth = Math.max(MIN_SVG_WIDTH, maxDepth * RING_GAP * 2 + 220);
    const svgHeight = Math.max(height, MIN_SVG_HEIGHT);
    const centerX = svgWidth / 2;
    const centerY = svgHeight / 2;
    const positioned: PositionedNode[] = [];

    sortedDepths.forEach((depth) => {
      const depthNodes = depthMap.get(depth) ?? [];

      if (depth === 0) {
        const seedNode =
          depthNodes.find((node) => node.isSeed) ?? depthNodes[0];
        if (seedNode) {
          positioned.push({ node: seedNode, x: centerX, y: centerY });
        }
        return;
      }

      const ringRadius = INNER_RING_RADIUS + (depth - 1) * RING_GAP;
      const step = (Math.PI * 2) / Math.max(depthNodes.length, 1);
      depthNodes.forEach((node, index) => {
        const angle = -Math.PI / 2 + step * index;
        const x = centerX + Math.cos(angle) * ringRadius;
        const y = centerY + Math.sin(angle) * ringRadius;
        positioned.push({ node, x, y });
      });
    });

    const layoutById = new Map<string, PositionedNode>();
    const nodeById = new Map<string, TopologyEntityGraphNode>();
    positioned.forEach((item) => {
      layoutById.set(item.node.id, item);
      nodeById.set(item.node.id, item.node);
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

    const connectedEdgesByNodeId = new Map<string, ConnectedEdgeSummary[]>();
    normalizedEdges.forEach(({ edge }) => {
      const sourceNode = nodeById.get(edge.source);
      const targetNode = nodeById.get(edge.target);
      if (!sourceNode || !targetNode) {
        return;
      }

      const sourceEntry: ConnectedEdgeSummary = {
        relationshipType: edge.relationshipType,
        directionLabel:
          edge.direction === "INCOMING"
            ? "in"
            : edge.direction === "OUTGOING"
            ? "out"
            : "link",
        otherNodeId: targetNode.entityId,
        otherNodeLabel: targetNode.title ?? targetNode.label,
      };
      const targetEntry: ConnectedEdgeSummary = {
        relationshipType: edge.relationshipType,
        directionLabel:
          edge.direction === "INCOMING"
            ? "out"
            : edge.direction === "OUTGOING"
            ? "in"
            : "link",
        otherNodeId: sourceNode.entityId,
        otherNodeLabel: sourceNode.title ?? sourceNode.label,
      };

      const sourceList = connectedEdgesByNodeId.get(edge.source) ?? [];
      sourceList.push(sourceEntry);
      connectedEdgesByNodeId.set(edge.source, sourceList);

      const targetList = connectedEdgesByNodeId.get(edge.target) ?? [];
      targetList.push(targetEntry);
      connectedEdgesByNodeId.set(edge.target, targetList);
    });

    const showAllEdgeLabels = normalizedEdges.length <= 120;

    return {
      positioned,
      connectedEdgesByNodeId,
      normalizedEdges,
      svgWidth,
      svgHeight,
      centerX,
      centerY,
      maxDepth,
      showAllEdgeLabels,
    };
  }, [edges, height, nodes, selectedNodeId]);

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
          <Chip size="small" label="Hover nodes for details" />
        </Stack>
      </Box>

      <Box
        sx={{
          position: "relative",
          height: layout.svgHeight,
          overflow: "auto",
          bgcolor: "background.default",
        }}
      >
        <Box
          sx={{
            position: "relative",
            width: layout.svgWidth,
            minHeight: layout.svgHeight,
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

              const radius = INNER_RING_RADIUS + (depth - 1) * RING_GAP;
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
              ({
                edge,
                source,
                target,
                midX,
                midY,
                isConnectedToSelection,
              }) => {
                const isSelected =
                  selectedNodeId === edge.source ||
                  selectedNodeId === edge.target;
                const showLabel =
                  layout.showAllEdgeLabels || isConnectedToSelection;

                return (
                  <g key={edge.id}>
                    <line
                      x1={source.x}
                      y1={source.y}
                      x2={target.x}
                      y2={target.y}
                      stroke={
                        isSelected ? theme.palette.primary.main : "#90a4ae"
                      }
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
              }
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

            const directConnectedEdges =
              layout.connectedEdgesByNodeId.get(node.id) ?? [];

            const connectedEdges = getConnectedEdges(
              directConnectedEdges,
              layout,
              node
            );
            const maxTooltipEdges = 10;
            const visibleEdges = connectedEdges.slice(0, maxTooltipEdges);
            const hiddenEdgeCount = Math.max(
              0,
              connectedEdges.length - maxTooltipEdges
            );

            const tooltipTitle = (
              <Box sx={{ maxWidth: 420 }}>
                <Typography variant="caption" fontWeight={700}>
                  {node.title ? `Title: ${node.title}` : `Name: ${node.label}`}
                </Typography>
                <Typography variant="caption" display="block">
                  Type: {node.entityType}
                </Typography>
                <Typography variant="caption" display="block" sx={{ mb: 0.75 }}>
                  ID: {node.entityId}
                </Typography>
                <Typography variant="caption" fontWeight={700} display="block">
                  Edges ({connectedEdges.length})
                </Typography>
                {visibleEdges.map((edgeSummary, index) => (
                  <Typography
                    key={`${node.id}-edge-${index}`}
                    variant="caption"
                    display="block"
                  >
                    {edgeSummary.directionLabel} {edgeSummary.relationshipType}{" "}
                    {edgeSummary.otherNodeLabel} ({edgeSummary.otherNodeId})
                  </Typography>
                ))}
                {hiddenEdgeCount > 0 ? (
                  <Typography variant="caption" display="block">
                    +{hiddenEdgeCount} more...
                  </Typography>
                ) : null}
              </Box>
            );

            return (
              <Tooltip key={node.id} title={tooltipTitle} placement="top" arrow>
                <button
                  onClick={() => onNodeSelect?.(node)}
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
                    boxShadow: isSelected
                      ? "0 0 0 3px rgba(25,118,210,0.2)"
                      : "none",
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
      </Box>
    </Card>
  );
}

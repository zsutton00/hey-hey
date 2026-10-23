import {
  useTopologyEntityGraph,
  type TopologyEntityGraphEdge,
  type TopologyEntityGraphNode,
} from "@hey-hey/ui-common/data";
import {
  Box,
  Button,
  ButtonGroup,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  Stack,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { EntityTopologyGraph } from "./EntityTopologyGraph";

export interface EntityRelationshipsTabProps {
  organizationId: string;
  projectId: string;
  entityId: string;
}

function formatFilterLabel(value: string): string {
  return value
    .split("_")
    .map((segment) => {
      const normalized = segment.trim().toLowerCase();
      if (!normalized) {
        return "";
      }
      return normalized.charAt(0).toUpperCase() + normalized.slice(1);
    })
    .join(" ");
}

function toggleFilterValue(
  currentValues: string[],
  value: string,
  checked: boolean,
): string[] {
  if (checked) {
    return currentValues.includes(value)
      ? currentValues
      : [...currentValues, value].sort();
  }

  return currentValues.filter((currentValue) => currentValue !== value);
}

function filterTopologyGraph(
  nodes: TopologyEntityGraphNode[],
  edges: TopologyEntityGraphEdge[],
  maxHops: number,
  visibleNodeTypes: string[],
  visibleEdgeTypes: string[],
): {
  nodes: TopologyEntityGraphNode[];
  edges: TopologyEntityGraphEdge[];
} {
  const visibleNodeTypeSet = new Set(visibleNodeTypes);
  const visibleEdgeTypeSet = new Set(visibleEdgeTypes);
  const filteredNodes = nodes.filter((node) => {
    const depth = node.isSeed ? 0 : Math.max(1, node.pathDepth);
    return depth <= maxHops && visibleNodeTypeSet.has(node.entityType);
  });
  const visibleNodeIds = new Set(filteredNodes.map((node) => node.id));
  const filteredEdges = edges.filter(
    (edge) =>
      visibleEdgeTypeSet.has(edge.relationshipType) &&
      visibleNodeIds.has(edge.source) &&
      visibleNodeIds.has(edge.target),
  );

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
  };
}

const TopologyPanel: React.FC<EntityRelationshipsTabProps> = ({
  organizationId,
  projectId,
  entityId,
}) => {
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(560);
  const [maxHops, setMaxHops] = useState<1 | 2>(2);
  const [visibleNodeTypes, setVisibleNodeTypes] = useState<string[]>([]);
  const [visibleEdgeTypes, setVisibleEdgeTypes] = useState<string[]>([]);

  const graph = useTopologyEntityGraph(organizationId, projectId, entityId, {
    depth: 2,
  });
  const availableNodeTypes = useMemo(
    () =>
      Array.from(new Set(graph.nodes.map((node) => node.entityType))).sort(),
    [graph.nodes],
  );
  const availableEdgeTypes = useMemo(
    () =>
      Array.from(
        new Set(graph.edges.map((edge) => edge.relationshipType)),
      ).sort(),
    [graph.edges],
  );
  const availableNodeTypesKey = availableNodeTypes.join("|");
  const availableEdgeTypesKey = availableEdgeTypes.join("|");
  const filteredGraph = useMemo(
    () =>
      filterTopologyGraph(
        graph.nodes,
        graph.edges,
        maxHops,
        visibleNodeTypes,
        visibleEdgeTypes,
      ),
    [graph.edges, graph.nodes, maxHops, visibleEdgeTypes, visibleNodeTypes],
  );
  const hasFiltersApplied =
    maxHops !== 2 ||
    visibleNodeTypes.length !== availableNodeTypes.length ||
    visibleEdgeTypes.length !== availableEdgeTypes.length;

  useEffect(() => {
    const recalculateHeight = () => {
      if (!containerRef.current) return;
      const { top } = containerRef.current.getBoundingClientRect();
      const availableHeight = Math.floor(window.innerHeight - top - 16);
      setHeight(Math.max(560, availableHeight));
    };

    recalculateHeight();
    window.addEventListener("resize", recalculateHeight);

    return () => {
      window.removeEventListener("resize", recalculateHeight);
    };
  }, []);

  useEffect(() => {
    setMaxHops(2);
    setSelectedNodeId(undefined);
  }, [entityId]);

  useEffect(() => {
    setVisibleNodeTypes(availableNodeTypes);
  }, [entityId, availableNodeTypesKey]);

  useEffect(() => {
    setVisibleEdgeTypes(availableEdgeTypes);
  }, [entityId, availableEdgeTypesKey]);

  useEffect(() => {
    if (
      selectedNodeId &&
      !filteredGraph.nodes.some((node) => node.id === selectedNodeId)
    ) {
      setSelectedNodeId(undefined);
    }
  }, [filteredGraph.nodes, selectedNodeId]);

  return (
    <Box ref={containerRef} sx={{ width: "100%", p: 0, m: 0 }}>
      <Box
        sx={{
          mb: 2,
          p: 2,
          border: 1,
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "background.paper",
        }}
      >
        <Stack spacing={2}>
          <Stack
            direction={{ xs: "column", md: "row" }}
            spacing={2}
            useFlexGap
            alignItems={{ xs: "stretch", md: "flex-start" }}
          >
            <Box>
              <Typography variant="subtitle2" gutterBottom>
                Hops
              </Typography>
              <ButtonGroup size="small" aria-label="Hop filter">
                <Button
                  variant={maxHops === 1 ? "contained" : "outlined"}
                  onClick={() => setMaxHops(1)}
                >
                  1 hop
                </Button>
                <Button
                  variant={maxHops === 2 ? "contained" : "outlined"}
                  onClick={() => setMaxHops(2)}
                >
                  2 hops
                </Button>
              </ButtonGroup>
            </Box>

            <Box sx={{ flex: 1, minWidth: 220 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 0.5 }}
              >
                <Typography variant="subtitle2">Node Types</Typography>
                <Button
                  size="small"
                  onClick={() => setVisibleNodeTypes(availableNodeTypes)}
                  disabled={
                    visibleNodeTypes.length === availableNodeTypes.length
                  }
                >
                  Show all
                </Button>
              </Stack>
              <FormGroup row>
                {availableNodeTypes.map((nodeType) => (
                  <FormControlLabel
                    key={nodeType}
                    control={
                      <Checkbox
                        size="small"
                        checked={visibleNodeTypes.includes(nodeType)}
                        onChange={(_, checked) => {
                          setVisibleNodeTypes((currentValues) =>
                            toggleFilterValue(currentValues, nodeType, checked),
                          );
                        }}
                      />
                    }
                    label={formatFilterLabel(nodeType)}
                  />
                ))}
              </FormGroup>
            </Box>

            <Box sx={{ flex: 1, minWidth: 220 }}>
              <Stack
                direction="row"
                justifyContent="space-between"
                alignItems="center"
                sx={{ mb: 0.5 }}
              >
                <Typography variant="subtitle2">Edge Types</Typography>
                <Button
                  size="small"
                  onClick={() => setVisibleEdgeTypes(availableEdgeTypes)}
                  disabled={
                    visibleEdgeTypes.length === availableEdgeTypes.length
                  }
                >
                  Show all
                </Button>
              </Stack>
              <FormGroup row>
                {availableEdgeTypes.map((edgeType) => (
                  <FormControlLabel
                    key={edgeType}
                    control={
                      <Checkbox
                        size="small"
                        checked={visibleEdgeTypes.includes(edgeType)}
                        onChange={(_, checked) => {
                          setVisibleEdgeTypes((currentValues) =>
                            toggleFilterValue(currentValues, edgeType, checked),
                          );
                        }}
                      />
                    }
                    label={formatFilterLabel(edgeType)}
                  />
                ))}
              </FormGroup>
            </Box>
          </Stack>

          <Stack direction="row" spacing={1} useFlexGap alignItems="center">
            <Chip
              size="small"
              label={`${filteredGraph.nodes.length}/${graph.nodes.length} nodes shown`}
            />
            <Chip
              size="small"
              label={`${filteredGraph.edges.length}/${graph.edges.length} edges shown`}
            />
            {hasFiltersApplied && (
              <Button
                size="small"
                onClick={() => {
                  setMaxHops(2);
                  setVisibleNodeTypes(availableNodeTypes);
                  setVisibleEdgeTypes(availableEdgeTypes);
                }}
              >
                Reset filters
              </Button>
            )}
          </Stack>
        </Stack>
      </Box>

      <EntityTopologyGraph
        nodes={filteredGraph.nodes}
        edges={filteredGraph.edges}
        isLoading={graph.isLoading}
        error={graph.error}
        selectedNodeId={selectedNodeId}
        onNodeSelect={(node) => setSelectedNodeId(node.id)}
        height={height}
      />
    </Box>
  );
};

export const EntityRelationshipsTab: React.FC<EntityRelationshipsTabProps> = (
  props,
) => {
  return <TopologyPanel {...props} />;
};

import { Alert, Box } from "@mui/material";
import { useMemo } from "react";
import { ExecutionGraphSurface } from "../shared/ExecutionGraph/ExecutionGraphSurface";
import { buildTaskMonitorExecutionGraphViewModel } from "./buildTaskMonitorExecutionGraphViewModel";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

export interface TaskMonitorExecutionGraphProps {
  nodes: readonly TaskMonitorProjectedNode[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
}

export const TaskMonitorExecutionGraph = ({
  nodes,
  selectedNodeId,
  onSelectNode,
}: TaskMonitorExecutionGraphProps) => {
  const viewModel = useMemo(
    () => buildTaskMonitorExecutionGraphViewModel(nodes),
    [nodes]
  );

  if (viewModel.nodes.length === 0) {
    return (
      <Alert severity="warning" data-testid="task-monitor-graph-empty">
        No execution work is available in the graph.
      </Alert>
    );
  }

  return (
    <Box
      data-testid="task-monitor-execution-graph"
      sx={{ width: "100%", minHeight: 200 }}
    >
      <ExecutionGraphSurface
        viewModel={viewModel}
        selectedNodeId={selectedNodeId}
        onNodeSelect={onSelectNode}
        initialFocusNodeId={selectedNodeId}
        minHeight={200}
      />
    </Box>
  );
};

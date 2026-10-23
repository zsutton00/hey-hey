export type ExecutionGraphNodeState =
  | "idle"
  | "eligible"
  | "active"
  | "blocked"
  | "waiting_for_user"
  | "completed"
  | "stopped"
  | "errored";

export interface ExecutionGraphMetadataBadge {
  id: string;
  label: string;
}

export interface ExecutionGraphNotice {
  id: string;
  text: string;
  tone: "info" | "success" | "warning" | "error";
}

export interface ExecutionGraphViewModelNode {
  id: string;
  title: string;
  summary?: string;
  state: ExecutionGraphNodeState;
  entityType?: string;
  metadata: ExecutionGraphMetadataBadge[];
  notices?: ExecutionGraphNotice[];
}

export interface ExecutionGraphDependencyEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface ExecutionGraphViewModel {
  nodes: ExecutionGraphViewModelNode[];
  dependencyEdges: ExecutionGraphDependencyEdge[];
}

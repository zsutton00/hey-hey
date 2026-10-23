import { WorkStatus } from "../../api";
import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

export type TaskMonitorInspectorPresentation =
  | { kind: "session" }
  | { kind: "waiting-for-session" };

export interface ResolveTaskMonitorInspectorPresentationOptions {
  monitorStatus: WorkStatus;
  node: TaskMonitorProjectedNode;
}

export const resolveTaskMonitorInspectorNode = (
  nodes: readonly TaskMonitorProjectedNode[],
  explicitTaskId: string | null
): TaskMonitorProjectedNode | null => {
  const explicit = explicitTaskId
    ? nodes.find((node) => node.taskId === explicitTaskId)
    : null;
  return explicit ?? nodes.find((node) => node.isCursor) ?? nodes[0] ?? null;
};

export const resolveTaskMonitorInspectorPresentation = ({
  monitorStatus,
  node,
}: ResolveTaskMonitorInspectorPresentationOptions): TaskMonitorInspectorPresentation => {
  if (
    monitorStatus === WorkStatus.Active &&
    node.isCursor &&
    node.session.kind === "none"
  ) {
    return { kind: "waiting-for-session" };
  }
  return { kind: "session" };
};

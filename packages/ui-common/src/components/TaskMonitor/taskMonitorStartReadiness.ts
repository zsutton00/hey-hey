import type { TaskMonitorProjectedNode } from "./useTaskMonitorProjection";

/**
 * The Services linked to the task itself. Nothing is inherited from the plan,
 * the parent feature, project defaults or the monitor's own saved state.
 */
export const taskServiceIds = (node: TaskMonitorProjectedNode): string[] => {
  if (node.task.kind !== "loaded") {
    return [];
  }

  const relations = node.task.task.serviceRelations ?? [];
  return [...new Set(relations.map((relation) => relation.serviceId))];
};

/** An unstarted task that cannot launch until it has a Service of its own. */
export const needsServiceBeforeStart = (
  node: TaskMonitorProjectedNode,
): boolean =>
  node.task.kind === "loaded" &&
  node.session.kind === "none" &&
  taskServiceIds(node).length === 0;

/** How each task card shows and changes the task's own Service links. */
export interface TaskMonitorTaskServicesControl {
  /** Tasks whose Service links are being written and read back. */
  updatingTaskIds: readonly string[];
  /** The last failed Service save for a task, with its cause. */
  errorsByTaskId: Readonly<Record<string, string>>;
  onChange: (taskId: string, serviceIds: string[]) => void;
}

/** Everything that holds Start back before the monitor has started. */
export interface TaskMonitorStartReadiness {
  tasksNeedingService: readonly TaskMonitorProjectedNode[];
  /** Selected tasks whose details could not be loaded. */
  unloadedTasks: readonly TaskMonitorProjectedNode[];
  savingServices: boolean;
  /** Start reads the saved branch, so an unsaved edit must land first. */
  savingWorktreeBranch: boolean;
  emptyWorktreeBranch: boolean;
  blocked: boolean;
}

export const resolveTaskMonitorStartReadiness = ({
  nodes,
  updatingServiceTaskIds,
  worktreeBranch,
  worktreeBranchPending,
}: {
  nodes: readonly TaskMonitorProjectedNode[];
  updatingServiceTaskIds: readonly string[];
  worktreeBranch: string | null;
  worktreeBranchPending: boolean;
}): TaskMonitorStartReadiness => {
  const tasksNeedingService = nodes.filter(needsServiceBeforeStart);
  const unloadedTasks = nodes.filter((node) => node.task.kind === "missing");
  const savingServices = updatingServiceTaskIds.length > 0;
  const emptyWorktreeBranch =
    worktreeBranch !== null && worktreeBranch.trim().length === 0;

  return {
    tasksNeedingService,
    unloadedTasks,
    savingServices,
    savingWorktreeBranch: worktreeBranchPending,
    emptyWorktreeBranch,
    blocked:
      tasksNeedingService.length > 0 ||
      unloadedTasks.length > 0 ||
      savingServices ||
      worktreeBranchPending ||
      emptyWorktreeBranch,
  };
};

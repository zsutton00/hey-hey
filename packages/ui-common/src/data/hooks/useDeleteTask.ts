import { useCallback } from "react";
import type { MutationCallbacks } from "../core/types";
import { useWorkItems } from "./useWorkItems";

export interface UseDeleteTaskOptions {
  organizationId: string;
  initiativeId: string;
  projectId: string;
}

export interface UseDeleteTaskReturn {
  deleteTask: (
    taskId: string,
    callbacks?: MutationCallbacks<void>
  ) => Promise<void>;
  isLoading: boolean;
  error: Error | null;
}

export function useDeleteTask(
  options: UseDeleteTaskOptions
): UseDeleteTaskReturn {
  const { organizationId, initiativeId, projectId } = options;

  const { remove, isLoading, error } = useWorkItems(
    organizationId,
    "task",
    projectId,
    undefined,
    {
      initiativeId,
    }
  );

  const deleteTask = useCallback(
    async (
      taskId: string,
      callbacks?: MutationCallbacks<void>
    ): Promise<void> => {
      return remove(taskId, callbacks);
    },
    [remove]
  );

  return {
    deleteTask,
    isLoading,
    error,
  };
}

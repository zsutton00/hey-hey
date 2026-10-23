import { useCallback, useMemo, useState } from "react";
import type { UpdateTaskResponseDto } from "../../api";
import { tasksClient } from "../../clients/serviceClients";

export interface UseSupersedeTaskParams {
  organizationId: string;
  projectId: string;
}

export interface UseSupersedeTaskReturn {
  /**
   * Runs the atomic supersede transition: a single proposal that sets the
   * task to SUPERSEDED and declares a SUPERSEDES edge to the successor. The
   * status change and the edge are inseparable, so SUPERSEDED can never be
   * produced through the plain status-edit path.
   */
  supersede: (
    taskId: string,
    successorTaskId: string
  ) => Promise<UpdateTaskResponseDto>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Mutation hook for the supersede transition endpoint. The response carries
 * `status: APPLIED` when the proposal auto-applied (the task is now
 * SUPERSEDED) or `status: PENDING` with the proposal awaiting review.
 */
export function useSupersedeTask({
  organizationId,
  projectId,
}: UseSupersedeTaskParams): UseSupersedeTaskReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supersede = useCallback(
    async (
      taskId: string,
      successorTaskId: string
    ): Promise<UpdateTaskResponseDto> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await tasksClient.supersedeTask({
          organizationId: organizationId,
          projectId: projectId,
          taskId: taskId,
          supersedeTaskDto: { successorTaskId },
        });
        const data = response.data?.data;
        if (!data) {
          throw new Error("Supersede transition returned no result.");
        }
        return data;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to supersede the task.";
        setError(message);
        throw err instanceof Error ? err : new Error(message);
      } finally {
        setIsLoading(false);
      }
    },
    [organizationId, projectId]
  );

  return useMemo(
    () => ({ supersede, isLoading, error }),
    [supersede, isLoading, error]
  );
}

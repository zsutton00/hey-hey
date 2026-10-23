import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachToGoalResponseDto, EntityType } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

export interface AttachToGoalVariables {
  goalId: string;
  targetEntityId: string;
  targetEntityType: EntityType;
}

export interface UseAttachToGoalParams {
  organizationId: string;
  projectId: string;
}

export interface UseAttachToGoalReturn {
  attach: (
    variables: AttachToGoalVariables
  ) => Promise<AttachToGoalResponseDto>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Wraps the generated `attachToGoal` (POST /tasks/{goalId}/tracks). The call is
 * idempotent — the backend returns `created:false` on re-attach — so consumers
 * can surface a silent no-op when an existing edge is hit.
 */
export function useAttachToGoal({
  organizationId,
  projectId,
}: UseAttachToGoalParams): UseAttachToGoalReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const attach = useCallback(
    async ({
      goalId,
      targetEntityId,
      targetEntityType,
    }: AttachToGoalVariables): Promise<AttachToGoalResponseDto> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await unifiedApiClient.attachToGoal({
          organizationId,
          projectId,
          taskId: goalId,
          attachToGoalDto: { targetEntityId, targetEntityType },
        });
        const result = response.data?.data;
        if (!result) {
          throw new Error("No attach result returned from server.");
        }
        if (!cancelledRef.current) setIsLoading(false);
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to attach to goal.";
        if (!cancelledRef.current) {
          setError(message);
          setIsLoading(false);
        }
        throw err;
      }
    },
    [organizationId, projectId]
  );

  return { attach, isLoading, error };
}

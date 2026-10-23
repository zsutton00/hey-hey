import { useCallback, useEffect, useRef, useState } from "react";
import type { DetachFromGoalResponseDto, EntityType } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

export interface DetachFromGoalVariables {
  goalId: string;
  targetEntityId: string;
  targetEntityType: EntityType;
}

export interface UseDetachFromGoalParams {
  organizationId: string;
  projectId: string;
}

export interface UseDetachFromGoalReturn {
  detach: (
    variables: DetachFromGoalVariables
  ) => Promise<DetachFromGoalResponseDto>;
  isLoading: boolean;
  error: string | null;
}

/**
 * Wraps the generated `detachFromGoal` operation. The endpoint is idempotent,
 * so a missing TRACKS relationship remains a successful no-op.
 */
export function useDetachFromGoal({
  organizationId,
  projectId,
}: UseDetachFromGoalParams): UseDetachFromGoalReturn {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const detach = useCallback(
    async ({
      goalId,
      targetEntityId,
      targetEntityType,
    }: DetachFromGoalVariables): Promise<DetachFromGoalResponseDto> => {
      setIsLoading(true);
      setError(null);
      try {
        const response = await unifiedApiClient.detachFromGoal({
          organizationId,
          projectId,
          taskId: goalId,
          detachFromGoalDto: { targetEntityId, targetEntityType },
        });
        const result = response.data?.data;
        if (!result) {
          throw new Error("No detach result returned from server.");
        }
        if (!cancelledRef.current) setIsLoading(false);
        return result;
      } catch (err: unknown) {
        const message =
          err instanceof Error ? err.message : "Failed to detach from goal.";
        if (!cancelledRef.current) {
          setError(message);
          setIsLoading(false);
        }
        throw err;
      }
    },
    [organizationId, projectId]
  );

  return { detach, isLoading, error };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActiveGoalDto } from "../../api";
import { entityContextClient } from "../../clients/serviceClients";
import { useAuth } from "../../contexts/AuthContext";

export interface UseActiveGoalsParams {
  organizationId: string;
  projectId: string;
  windowDays?: number;
}

export interface UseActiveGoalsReturn {
  data: ActiveGoalDto[] | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
}

/**
 * Lazily fetches active goals for the current user. Call `fetch()` to trigger
 * the request — the hook does not auto-fetch on mount so the picker only loads
 * goals for entities that actually open the picker. The server already returns
 * member-of goals first, then project-wide; consumers should preserve order.
 */
export function useActiveGoals({
  organizationId,
  projectId,
  windowDays,
}: UseActiveGoalsParams): UseActiveGoalsReturn {
  const { user } = useAuth();
  const userId = user?.id ?? "";

  const [data, setData] = useState<ActiveGoalDto[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const fetch = useCallback(() => {
    if (!organizationId || !projectId || !userId) return;

    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);

    entityContextClient
      .listActiveGoals({
        organizationId: organizationId,
        projectId: projectId,
        userId: userId,
        windowDays: windowDays,
      })
      .then((response) => {
        if (cancelledRef.current) return;
        setData(response.data?.data?.items ?? []);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load active goals."
        );
        setIsLoading(false);
      });
  }, [organizationId, projectId, userId, windowDays]);

  return useMemo(
    () => ({ data, isLoading, error, fetch }),
    [data, isLoading, error, fetch]
  );
}

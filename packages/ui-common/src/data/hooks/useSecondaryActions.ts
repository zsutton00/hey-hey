import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SecondaryActionConfig } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

export interface UseSecondaryActionsReturn {
  actions: SecondaryActionConfig[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Fetches secondary actions from the API. Consumed by DynamicForm via
 * the `dynamicSecondaryActions` config in Registry.tsx — avoid calling
 * directly from field components unless there is no alternative.
 */
export function useSecondaryActions(
  organizationId: string | undefined,
  uiElement: string | undefined,
  options: { enabled?: boolean; actionHint?: string } = {}
): UseSecondaryActionsReturn {
  const { enabled = true, actionHint } = options;
  const [actions, setActions] = useState<SecondaryActionConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchCount, setFetchCount] = useState(0);
  const cancelledRef = useRef(false);

  const canFetch = enabled && !!organizationId && (!!uiElement || !!actionHint);

  useEffect(() => {
    if (!canFetch) {
      setActions([]);
      return;
    }

    cancelledRef.current = false;
    setIsLoading(true);
    setError(null);
    setActions([]);

    unifiedApiClient
      // actionHint maps to the API's actionType query parameter
      .getSecondaryActions({
        organizationId,
        uiElement,
        actionType: actionHint,
      })
      .then((response) => {
        if (cancelledRef.current) return;
        setActions(response.data?.data ?? []);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load secondary actions."
        );
        setIsLoading(false);
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [canFetch, organizationId, uiElement, actionHint, fetchCount]);

  const refetch = useCallback(() => {
    setFetchCount((c) => c + 1);
  }, []);

  return useMemo(
    () => ({ actions, isLoading, error, refetch }),
    [actions, isLoading, error, refetch]
  );
}

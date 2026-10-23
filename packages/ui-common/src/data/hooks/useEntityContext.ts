import { useCallback, useMemo, useState } from "react";
import type { EntityContextDto, EntityType } from "../../api";
import { useFullEntityContext } from "./useFullEntityContext";

export interface UseEntityContextParams {
  organizationId: string;
  projectId: string;
  entityType: EntityType;
  entityId: string;
}

export interface UseEntityContextReturn {
  data: EntityContextDto | null;
  isLoading: boolean;
  error: string | null;
  fetch: () => void;
}

/**
 * Lazily fetches full entity context for a given entity through the shared
 * collection. Call `fetch()` to trigger the request; the hook does not fetch
 * on mount. Related entities are included so consumers opened from the
 * context menu can reuse the same cached response without another request.
 */
export function useEntityContext({
  organizationId,
  projectId,
  entityType,
  entityId,
}: UseEntityContextParams): UseEntityContextReturn {
  const [requested, setRequested] = useState(false);
  const fullContext = useFullEntityContext({
    organizationId,
    projectId,
    entityType,
    entityId,
    enabled: requested,
    includeRelatedEntities: true,
    includeFeatureHierarchy: true,
    includeProposals: true,
    includeAvailableMcpTools: true,
  });

  const fetch = useCallback(() => {
    if (!organizationId || !entityType || !entityId || !projectId) return;
    if (requested) {
      fullContext.refetch();
      return;
    }
    setRequested(true);
  }, [entityId, entityType, fullContext, organizationId, projectId, requested]);

  return useMemo(
    () => ({
      data: fullContext.data,
      isLoading: fullContext.isLoading,
      error: fullContext.error,
      fetch,
    }),
    [fetch, fullContext.data, fullContext.error, fullContext.isLoading]
  );
}

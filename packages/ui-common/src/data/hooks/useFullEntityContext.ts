import { useCallback } from "react";
import type { EntityType, FullEntityContextDto } from "../../api";
import { entityContextQueryOptions } from "../collections/entityContext";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export interface UseFullEntityContextParams {
  organizationId: string;
  projectId: string;
  entityType: EntityType;
  entityId: string;
  enabled?: boolean;
  includeRelatedEntities?: boolean;
  includeFeatureHierarchy?: boolean;
  includeProposals?: boolean;
  includeAvailableMcpTools?: boolean;
}

export interface UseFullEntityContextReturn {
  data: FullEntityContextDto | null;
  isLoading: boolean;
  isFetched: boolean;
  error: string | null;
  refetch: () => void;
}

export function useFullEntityContext(
  params: UseFullEntityContextParams
): UseFullEntityContextReturn {
  const {
    organizationId,
    projectId,
    entityType,
    entityId,
    enabled = true,
  } = params;
  const { result, state } = useDataLayerQuery(
    entityContextQueryOptions(params),
    {
      enabled:
        enabled &&
        Boolean(organizationId && projectId && entityType && entityId),
    }
  );
  const { refetch: refetchQuery } = state;
  const refetch = useCallback(() => {
    void refetchQuery();
  }, [refetchQuery]);
  return {
    data: result.data ?? null,
    isLoading: state.isLoading,
    isFetched: state.isFetched,
    error: state.error?.message ?? null,
    refetch,
  };
}

import {
  adminProjectHintsQueryOptions,
  type AdminProjectHintsFilters,
} from "../collections/adminProjectHints";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export function useAdminProjectHints(
  organizationId: string,
  projectId: string,
  filters: AdminProjectHintsFilters = {},
) {
  const { result } = useDataLayerQuery(
    adminProjectHintsQueryOptions(organizationId, projectId, filters),
    { enabled: Boolean(organizationId && projectId) },
  );
  return {
    hints: result.data?.hints ?? [],
    matchingCount: result.data?.matchingCount ?? 0,
    totalCount: result.data?.totalCount ?? 0,
    isLoading: result.isPending,
    error: result.error,
  };
}

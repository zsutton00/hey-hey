import { adminProjectHintsQueryOptions } from "../collections/adminProjectHints";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export function useAdminProjectHints(
  organizationId: string,
  projectId: string,
) {
  const { result } = useDataLayerQuery(
    adminProjectHintsQueryOptions(organizationId, projectId),
    { enabled: Boolean(organizationId && projectId) },
  );
  return {
    hints: result.data?.hints ?? [],
    isLoading: result.isPending,
    error: result.error,
  };
}

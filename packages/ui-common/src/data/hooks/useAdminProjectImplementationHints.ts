import { adminProjectImplementationHintsQueryOptions } from "../collections/adminProjectImplementationHints";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export function useAdminProjectImplementationHints(
  projectId: string,
  options: { enabled?: boolean } = {},
) {
  const { result } = useDataLayerQuery(
    adminProjectImplementationHintsQueryOptions(projectId),
    { enabled: options.enabled ?? projectId !== "" },
  );
  return {
    services: result.data?.services ?? [],
    isLoading: result.isPending,
    error: result.error,
  };
}

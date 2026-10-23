import type {
  IntegrationResponseDto,
  IntegrationType,
  IntegrationState,
  IntegrationConnectionStatus,
} from "../../api";
import { integrationsQueryOptions } from "../collections/integrations";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export interface UseIntegrationsOptions
  extends CollectionHookOptions<IntegrationResponseDto> {
  type?: IntegrationType;
  state?: IntegrationState;
  connectionStatus?: IntegrationConnectionStatus;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export function useIntegrations(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseIntegrationsOptions = {}
): DataHookReturn<IntegrationResponseDto[]> {
  const {
    type,
    state: integrationState,
    connectionStatus,
    page,
    limit,
    sortBy,
    sortOrder,
  } = options;
  const { result, state } = useDataLayerQuery(
    integrationsQueryOptions(organizationId ?? "", projectId ?? "", {
      type,
      state: integrationState,
      connectionStatus,
      page,
      limit,
      sortBy,
      sortOrder,
    }),
    {
      ...options,
      enabled: (options.enabled ?? true) && !!organizationId && !!projectId,
    }
  );
  return {
    ...state,
    data: result.data ?? [],
    refetch: async () => {
      try {
        return await state.refetch();
      } catch {
        return null;
      }
    },
  };
}

import type { IntegrationResponseDto } from "../../api";
import { integrationQueryOptions } from "../collections/integrations";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseIntegrationReturn = DataHookReturn<IntegrationResponseDto>;
export type UseIntegrationOptions =
  CollectionHookOptions<IntegrationResponseDto>;
export function useIntegration(
  organizationId: string | undefined,
  projectId: string | undefined,
  integrationId: string | undefined,
  options: CollectionHookOptions<IntegrationResponseDto> = {}
): UseIntegrationReturn {
  const { result, state } = useDataLayerQuery(
    integrationQueryOptions(
      organizationId ?? "",
      projectId ?? "",
      integrationId ?? ""
    ),
    {
      ...options,
      enabled:
        (options.enabled ?? true) &&
        !!organizationId &&
        !!projectId &&
        !!integrationId,
    }
  );

  return {
    ...state,
    data: result.data ?? null,
    refetch: async () => {
      try {
        return await state.refetch();
      } catch {
        return null;
      }
    },
  };
}

import { useMemo } from "react";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { serviceQueryOptions } from "../collections/services";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import type { ServiceDto } from "../../api";

export type UseServiceReturn = DataHookReturn<ServiceDto>;

const DISABLED_SCOPE = "__noop__";

export function useService(
  organizationId: string | undefined,
  serviceId: string | undefined,
  options: CollectionHookOptions<ServiceDto> = {}
): UseServiceReturn {
  const isEnabled =
    (options.enabled ?? true) && !!organizationId && !!serviceId;
  const queryOptions = useMemo(
    () =>
      serviceQueryOptions(
        organizationId || DISABLED_SCOPE,
        serviceId || DISABLED_SCOPE
      ),
    [organizationId, serviceId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled: isEnabled,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
  });

  return { ...state, data: result.data ?? null };
}

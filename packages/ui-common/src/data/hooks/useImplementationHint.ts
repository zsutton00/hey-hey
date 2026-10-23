import type { ImplementationHintDto } from "../../api";
import { implementationHintQueryOptions } from "../collections/implementationHints";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UseImplementationHintReturn = DataHookReturn<ImplementationHintDto>;
export function useImplementationHint(
  organizationId: string | undefined,
  serviceId: string | undefined,
  hintId: string | undefined,
  options: CollectionHookOptions<ImplementationHintDto> = {}
): UseImplementationHintReturn {
  const { result, state: query } = useDataLayerQuery(
    implementationHintQueryOptions(
      organizationId ?? "__noop__",
      serviceId ?? "__noop__",
      hintId ?? "__noop__"
    ),
    {
      ...options,
      enabled:
        !!organizationId &&
        !!serviceId &&
        !!hintId &&
        options.enabled !== false,
    }
  );
  return { ...query, data: result.data ?? null };
}

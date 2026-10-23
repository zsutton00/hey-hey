import { useMemo } from "react";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import type { DesignDocResponseDto } from "../../api";
import { designDocQueryOptions } from "../collections/designDocs";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseDesignDocReturn = DataHookReturn<DesignDocResponseDto>;

export function useDesignDoc(
  organizationId: string | undefined,
  designDocId: string | undefined,
  options: CollectionHookOptions<DesignDocResponseDto> = {}
): UseDesignDocReturn {
  const queryOptions = useMemo(
    () =>
      designDocQueryOptions(
        organizationId ?? "__noop__",
        designDocId ?? "__noop__"
      ),
    [organizationId, designDocId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled: (options.enabled ?? true) && !!organizationId && !!designDocId,
  });
  return { ...state, data: result.data ?? null };
}

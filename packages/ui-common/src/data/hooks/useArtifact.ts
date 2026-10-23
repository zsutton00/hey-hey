import { useCallback } from "react";
import type { ArtifactResponseDto } from "../../api";
import { artifactQueryOptions } from "../collections/artifacts";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UseArtifactOptions = CollectionHookOptions<ArtifactResponseDto>;
export function useArtifact(
  organizationId: string | undefined,
  artifactId: string | undefined,
  options: UseArtifactOptions = {}
): DataHookReturn<ArtifactResponseDto> {
  const { result, state: query } = useDataLayerQuery(
    artifactQueryOptions(
      organizationId ?? "__noop__",
      artifactId ?? "__noop__"
    ),
    {
      ...options,
      enabled: !!organizationId && !!artifactId && options.enabled !== false,
    }
  );
  const refetchRead = query.refetch;
  const refetch = useCallback(async () => {
    try {
      return await refetchRead();
    } catch {
      return null;
    }
  }, [refetchRead]);
  return { ...query, data: result.data ?? null, refetch };
}

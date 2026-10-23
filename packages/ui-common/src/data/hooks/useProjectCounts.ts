import type { ProjectCountsResponseDto } from "../../api";
import { projectCountsQueryOptions } from "../collections/projectCounts";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseProjectCountsReturn = DataHookReturn<ProjectCountsResponseDto>;

export function useProjectCounts(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: CollectionHookOptions<ProjectCountsResponseDto> = {}
): UseProjectCountsReturn {
  const { result, state } = useDataLayerQuery(
    projectCountsQueryOptions(organizationId ?? "", projectId ?? ""),
    {
      ...options,
      enabled: (options.enabled ?? true) && !!organizationId && !!projectId,
    }
  );

  return { ...state, data: result.data ?? null };
}

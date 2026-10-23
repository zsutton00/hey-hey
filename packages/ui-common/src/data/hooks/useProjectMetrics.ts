import {
  ActivityActorScopeMode,
  type ProjectMetricsResponseDto,
} from "../../api";
import { projectMetricsQueryOptions } from "../collections/projectMetrics";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UseProjectMetricsReturn = DataHookReturn<ProjectMetricsResponseDto>;
export function useProjectMetrics(
  organizationId: string | undefined,
  projectId?: string,
  options: CollectionHookOptions<ProjectMetricsResponseDto> = {},
  actorScope: ActivityActorScopeMode = ActivityActorScopeMode.Organization,
  actorUserId?: string
): UseProjectMetricsReturn {
  const { result, state } = useDataLayerQuery(
    projectMetricsQueryOptions({
      organizationId: organizationId ?? "",
      projectId,
      actorScope,
      actorUserId,
    }),
    {
      ...options,
      enabled:
        (options.enabled ?? true) &&
        !!organizationId &&
        (actorScope !== ActivityActorScopeMode.Personal || !!actorUserId),
    }
  );
  return { ...state, data: result.data ?? null };
}

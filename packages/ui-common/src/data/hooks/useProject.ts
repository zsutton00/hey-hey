import type { ProjectResponseDto } from "../../api";
import { projectQueryOptions } from "../collections/projects";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export type UseProjectReturn = DataHookReturn<ProjectResponseDto>;

export function useProject(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: CollectionHookOptions<ProjectResponseDto> = {}
): UseProjectReturn {
  const { result, state } = useDataLayerQuery(
    projectQueryOptions(organizationId ?? "", projectId ?? ""),
    {
      ...options,
      enabled: (options.enabled ?? true) && !!organizationId && !!projectId,
    }
  );
  useWebsocketSubscriptions(
    { projectIds: projectId ? [projectId] : [] },
    { enabled: options.enabled ?? true }
  );
  return { ...state, data: result.data ?? null };
}

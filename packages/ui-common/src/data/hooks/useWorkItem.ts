import { useMemo } from "react";
import type { WorkItemResponseDto } from "../collections/workItems";
import { workItemDetailQueryOptions } from "../collections/workItemLists";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";
import { useWorkItemAuthoritativeMount } from "./useWorkItemMountPolicy";
import type { AgentEdgeType } from "../../api";

type UseWorkItemOptions = CollectionHookOptions<WorkItemResponseDto> & {
  projectId?: string;
  includeServiceRelations?: boolean;
  includeEdges?: boolean;
  edgeTypes?: AgentEdgeType[];
};

export interface UseWorkItemReturn
  extends Omit<DataHookReturn<WorkItemResponseDto>, "data"> {
  workItem: WorkItemResponseDto | null;
}

/**
 * Fetches a single work item (task) by ID. Every consumer passing the same
 * project and variant shares one cached read.
 * The entityType parameter is accepted for backward compatibility but
 * only tasks are supported (initiatives have been removed).
 */
export function useWorkItem(
  organizationId: string,
  _entityType: "initiative" | "task",
  workItemId: string,
  options: UseWorkItemOptions = {}
): UseWorkItemReturn {
  const { projectId, includeServiceRelations, includeEdges, edgeTypes } =
    options;
  const authoritativeMount = useWorkItemAuthoritativeMount();
  const edgeTypesKey = edgeTypes?.join(",") ?? "";

  const queryOptions = useMemo(
    () =>
      workItemDetailQueryOptions(organizationId, projectId ?? "", workItemId, {
        includeServiceRelations,
        includeEdges,
        edgeTypes: edgeTypesKey
          ? (edgeTypesKey.split(",") as AgentEdgeType[])
          : undefined,
      }),
    [
      organizationId,
      projectId,
      workItemId,
      includeServiceRelations,
      includeEdges,
      edgeTypesKey,
    ]
  );

  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled: (options.enabled ?? true) && !!organizationId && !!workItemId,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
    authoritativeMount,
  });

  useWebsocketSubscriptions(
    {
      projectIds: projectId ? [projectId] : [],
      initiativeIds: [],
    },
    {
      enabled: options.enabled ?? true,
    }
  );

  return { ...state, workItem: result.data ?? null };
}

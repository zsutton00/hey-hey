import { useMemo } from "react";
import type { WorkItemResponseDto } from "../collections/workItems";
import { workItemDetailRead } from "../collections/workItemLists";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useGraphQLRead } from "../graphql/useGraphQLRead";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";
import type { AgentEdgeType } from "../../api";

type UseWorkItemOptions = CollectionHookOptions<WorkItemResponseDto> & {
  projectId?: string;
  includeServiceRelations?: boolean;
  includeEdges?: boolean;
  edgeTypes?: AgentEdgeType[];
};

export interface UseWorkItemReturn extends Omit<
  DataHookReturn<WorkItemResponseDto>,
  "data"
> {
  workItem: WorkItemResponseDto | null;
}

/**
 * Reads a single work item (task) by ID from the project's GraphQL cache.
 * Every view of the same work item shows the one cached record, which is
 * refreshed when the server reports a change.
 * The entityType parameter is accepted for backward compatibility but
 * only tasks are supported (initiatives have been removed).
 */
export function useWorkItem(
  organizationId: string,
  _entityType: "initiative" | "task",
  workItemId: string,
  options: UseWorkItemOptions = {},
): UseWorkItemReturn {
  const { projectId, includeServiceRelations, includeEdges, edgeTypes } =
    options;
  const edgeTypesKey = edgeTypes?.join(",") ?? "";

  const spec = useMemo(
    () =>
      workItemDetailRead(
        { organizationId, projectId: projectId ?? "" },
        workItemId,
        {
          includeServiceRelations,
          includeEdges,
          edgeTypes: edgeTypesKey
            ? (edgeTypesKey.split(",") as AgentEdgeType[])
            : undefined,
        },
      ),
    [
      organizationId,
      projectId,
      workItemId,
      includeServiceRelations,
      includeEdges,
      edgeTypesKey,
    ],
  );

  // The endpoint is project-scoped, so a read needs the project.
  const { data, ...state } = useGraphQLRead(spec, {
    enabled:
      (options.enabled ?? true) &&
      !!organizationId &&
      !!projectId &&
      !!workItemId,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
  });

  useWebsocketSubscriptions(
    {
      projectIds: projectId ? [projectId] : [],
      initiativeIds: [],
    },
    {
      enabled: options.enabled ?? true,
    },
  );

  return { ...state, workItem: data };
}

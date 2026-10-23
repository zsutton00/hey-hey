import { useMemo } from "react";
import type { TaskHierarchyResponseDto, TaskResponseDto } from "../../api";
import type { WorkItemResponseDto } from "../collections/workItems";
import { workItemHierarchyQueryOptions } from "../collections/workItemLists";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";
import { useWorkItemAuthoritativeMount } from "./useWorkItemMountPolicy";

export type UseTaskHierarchyOptions =
  CollectionHookOptions<WorkItemResponseDto> & {
    projectId?: string;
    includeDesignDocCounts?: boolean;
    includeAgentSessionCounts?: boolean;
  };

export interface UseTaskHierarchyReturn
  extends Omit<DataHookReturn<TaskHierarchyResponseDto>, "data"> {
  hierarchy: TaskHierarchyResponseDto | null;
  parent?: TaskResponseDto | null;
  task: TaskResponseDto | null;
  children: TaskResponseDto[];
  refetch: () => Promise<TaskHierarchyResponseDto | null>;
}

export function useTaskHierarchy(
  organizationId: string,
  projectId: string,
  taskId: string,
  options: UseTaskHierarchyOptions = {}
): UseTaskHierarchyReturn {
  const { includeDesignDocCounts, includeAgentSessionCounts } = options;
  const authoritativeMount = useWorkItemAuthoritativeMount();
  const queryOptions = useMemo(
    () =>
      workItemHierarchyQueryOptions(organizationId, projectId, taskId, {
        includeDesignDocCounts,
        includeAgentSessionCounts,
      }),
    [
      organizationId,
      projectId,
      taskId,
      includeDesignDocCounts,
      includeAgentSessionCounts,
    ]
  );

  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled:
      options.enabled !== false && !!organizationId && !!projectId && !!taskId,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
    authoritativeMount,
  });

  useWebsocketSubscriptions(
    {
      projectIds: options.projectId ? [options.projectId] : [],
      initiativeIds: [],
    },
    {
      enabled: options.enabled ?? true,
    }
  );

  // A failed read presents no hierarchy, as before.
  const hierarchy = state.error ? null : (result.data ?? null);

  return {
    ...state,
    hierarchy,
    parent: hierarchy ? hierarchy.parent : undefined,
    task: hierarchy ? (hierarchy.task ?? null) : null,
    children: hierarchy ? (hierarchy.children ?? []) : [],
  };
}

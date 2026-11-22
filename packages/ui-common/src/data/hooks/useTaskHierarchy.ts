import { useMemo } from "react";
import type { TaskHierarchyResponseDto, TaskResponseDto } from "../../api";
import type { WorkItemResponseDto } from "../collections/workItems";
import { workItemHierarchyRead } from "../collections/workItemLists";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useGraphQLRead } from "../graphql/useGraphQLRead";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export type UseTaskHierarchyOptions =
  CollectionHookOptions<WorkItemResponseDto> & {
    projectId?: string;
    includeDesignDocCounts?: boolean;
    includeAgentSessionCounts?: boolean;
  };

export interface UseTaskHierarchyReturn extends Omit<
  DataHookReturn<TaskHierarchyResponseDto>,
  "data"
> {
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
  options: UseTaskHierarchyOptions = {},
): UseTaskHierarchyReturn {
  const { includeDesignDocCounts, includeAgentSessionCounts } = options;
  const spec = useMemo(
    () =>
      workItemHierarchyRead({ organizationId, projectId }, taskId, {
        includeDesignDocCounts,
        includeAgentSessionCounts,
      }),
    [
      organizationId,
      projectId,
      taskId,
      includeDesignDocCounts,
      includeAgentSessionCounts,
    ],
  );

  const { data, ...state } = useGraphQLRead(spec, {
    enabled:
      options.enabled !== false && !!organizationId && !!projectId && !!taskId,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
  });

  useWebsocketSubscriptions(
    {
      projectIds: options.projectId ? [options.projectId] : [],
      initiativeIds: [],
    },
    {
      enabled: options.enabled ?? true,
    },
  );

  // A failed read presents no hierarchy, as before.
  const hierarchy = state.error ? null : data;

  return {
    ...state,
    hierarchy,
    parent: hierarchy ? hierarchy.parent : undefined,
    task: hierarchy ? (hierarchy.task ?? null) : null,
    children: hierarchy ? (hierarchy.children ?? []) : [],
  };
}

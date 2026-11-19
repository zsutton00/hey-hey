import { useQuery } from "@tanstack/react-query";
import { unifiedApiClient } from "../../clients/serviceClients";
import type { WorkItemResponseDto } from "../collections/workItems";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

export interface UseWorkItemWithoutProjectReturn {
  workItem: WorkItemResponseDto | null;
  isLoading: boolean;
  isFetched: boolean;
  error: Error | null;
}

/**
 * Reads one work item by id when the caller does not yet know its project, so
 * the redirect pages (`tasks/:taskId`, `work-items/:id`) can learn the project
 * and send the user to the canonical path.
 *
 * This is the one documented exception to "work items are read through
 * GraphQL": the GraphQL endpoint is project-scoped and cannot answer without a
 * project. The record is not put in the shared cache; use `useWorkItem` once
 * the project is known. The page-migration task replaces this lookup.
 */
export function useWorkItemWithoutProject(
  organizationId: string,
  workItemId: string,
  options: { enabled?: boolean } = {},
): UseWorkItemWithoutProjectReturn {
  const query = useQuery({
    ...dataLayerQueryPolicy,
    queryKey: ["workItemWithoutProject", organizationId, workItemId],
    queryFn: async ({ signal }): Promise<WorkItemResponseDto | null> => {
      const response = await unifiedApiClient.getTask(
        { organizationId, projectId: "", taskId: workItemId },
        { ...captureRequestOptions(), signal },
      );

      return (
        (response.data.data as WorkItemResponseDto | null | undefined) ?? null
      );
    },
    enabled: (options.enabled ?? true) && !!organizationId && !!workItemId,
  });

  return {
    workItem: query.data ?? null,
    isLoading: query.isLoading,
    isFetched: query.isFetched,
    error: query.error,
  };
}

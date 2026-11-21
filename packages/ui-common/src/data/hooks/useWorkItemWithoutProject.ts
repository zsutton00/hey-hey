import { useApolloClient } from "@apollo/client/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWorkItem } from "../collections/workItemLists";
import type { WorkItemResponseDto } from "../collections/workItems";
import { projectsQueryOptions } from "../collections/projects";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { extractErrorCode } from "../../utils/errorUtils";

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
 * The GraphQL endpoint is project-scoped, so the organization's projects are
 * asked in turn until one holds the item. The item is written to that
 * project's shared cache like any other read; a project that does not hold it
 * answers not found and is skipped, while any other failure is reported.
 */
export function useWorkItemWithoutProject(
  organizationId: string,
  workItemId: string,
  options: { enabled?: boolean } = {},
): UseWorkItemWithoutProjectReturn {
  const apollo = useApolloClient();
  const queryClient = useQueryClient();

  const query = useQuery({
    ...dataLayerQueryPolicy,
    queryKey: ["workItemWithoutProject", organizationId, workItemId],
    queryFn: async (): Promise<WorkItemResponseDto | null> => {
      const projects = await queryClient.fetchQuery(
        projectsQueryOptions(organizationId),
      );

      for (const { id: projectId } of projects) {
        const found = await readIfHeld(apollo, {
          organizationId,
          projectId,
          workItemId,
        });
        if (found) {
          return found;
        }
      }

      return null;
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

const NOT_FOUND = "NOT_FOUND";

async function readIfHeld(
  apollo: ReturnType<typeof useApolloClient>,
  {
    organizationId,
    projectId,
    workItemId,
  }: {
    organizationId: string;
    projectId: string;
    workItemId: string;
  },
): Promise<WorkItemResponseDto | null> {
  try {
    return await fetchWorkItem(
      apollo,
      { organizationId, projectId },
      workItemId,
    );
  } catch (error) {
    if (extractErrorCode(error) === NOT_FOUND) {
      return null;
    }
    throw error;
  }
}

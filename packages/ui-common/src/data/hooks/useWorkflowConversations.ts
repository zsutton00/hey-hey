import { useMemo } from "react";
import type { ConversationResponseDto, ConversationStatus } from "../../api";
import { workflowConversationListQueryOptions } from "../collections/conversations";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type GetWorkflowConversationsSortByEnum = "createdAt" | "updatedAt";
export type GetWorkflowConversationsSortOrderEnum = "asc" | "desc";

export interface UseWorkflowConversationsOptions
  extends CollectionHookOptions<ConversationResponseDto> {
  /** Sort field (default: 'createdAt') */
  sortBy?: GetWorkflowConversationsSortByEnum;
  /** Sort order (default: 'desc') */
  sortOrder?: GetWorkflowConversationsSortOrderEnum;
  /** Filter by conversation status */
  status?: ConversationStatus;
  /** Page number for pagination (default: 1) */
  page?: number;
  /** Items per page (default: 50) */
  limit?: number;
}

const NO_CONVERSATIONS: ConversationResponseDto[] = [];

/**
 * Hook to fetch all conversations for a specific workflow and entity.
 * Useful for displaying conversation history for a task, initiative, etc.
 *
 * @example
 * ```typescript
 * const { data: conversations, isLoading } = useWorkflowConversations(
 *   organizationId,
 *   projectId,
 *   'task_workflow',
 *   taskId,
 *   { sortBy: 'createdAt', sortOrder: 'desc' }
 * );
 * ```
 */
export function useWorkflowConversations(
  organizationId: string | undefined,
  projectId: string | undefined,
  workflowName: string | undefined,
  workflowAboutId: string | undefined,
  options: UseWorkflowConversationsOptions = {}
): DataHookReturn<ConversationResponseDto[]> {
  const {
    sortBy = "createdAt",
    sortOrder = "desc",
    status,
    page = 1,
    limit = 50,
    ...baseOptions
  } = options;

  const queryOptions = useMemo(
    () =>
      workflowConversationListQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        {
          workflowName: workflowName ?? "__noop__",
          workflowAboutId: workflowAboutId ?? "__noop__",
          sortBy,
          sortOrder,
          status,
          page,
          limit,
        }
      ),
    [
      organizationId,
      projectId,
      workflowName,
      workflowAboutId,
      sortBy,
      sortOrder,
      status,
      page,
      limit,
    ]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    enabled:
      baseOptions.enabled !== false &&
      !!organizationId &&
      !!projectId &&
      !!workflowName &&
      !!workflowAboutId,
    refetchOnMount: baseOptions.refetchOnMount,
    refetchOnWindowFocus: baseOptions.refetchOnWindowFocus,
    staleTimeMs: baseOptions.staleTimeMs,
    maxCacheAgeMs: baseOptions.maxCacheAgeMs,
  });

  return { ...state, data: result.data ?? NO_CONVERSATIONS };
}

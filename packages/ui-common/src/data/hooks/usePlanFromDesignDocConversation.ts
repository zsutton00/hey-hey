import { useMemo } from "react";
import type { ConversationResponseDto } from "../../api";
import { WorkflowName } from "../../api";
import {
  useWorkflowConversations,
  type UseWorkflowConversationsOptions,
} from "./useWorkflowConversations";

export interface UsePlanFromDesignDocConversationReturn {
  conversation: ConversationResponseDto | null;
  isFetched: boolean;
  isLoading: boolean;
  error: Error | null;
  markStale: () => void;
}

/**
 * Returns the most recent plan-from-design-doc workflow conversation for a
 * given plan, if one exists. Plan-from-design-doc conversations are
 * materialized server-side at create_plan approval or when generation is
 * prepared for an existing PLAN work item. Reset invalidates this query;
 * an empty result is a valid draft state until the user prepares generation.
 */
export function usePlanFromDesignDocConversation(
  organizationId: string | undefined,
  projectId: string | undefined,
  planId: string | undefined,
  options: Pick<UseWorkflowConversationsOptions, "enabled"> = {}
): UsePlanFromDesignDocConversationReturn {
  const { enabled = true } = options;

  const query = useWorkflowConversations(
    organizationId,
    projectId,
    WorkflowName.PlanFromDesignDoc,
    planId,
    {
      sortBy: "createdAt",
      sortOrder: "desc",
      enabled,
    }
  );

  const conversation = useMemo<ConversationResponseDto | null>(
    () => (query.data && query.data.length > 0 ? query.data[0] : null),
    [query.data]
  );

  return {
    conversation,
    isFetched: query.isFetched,
    isLoading: query.isLoading,
    error: query.error,
    markStale: query.markStale,
  };
}

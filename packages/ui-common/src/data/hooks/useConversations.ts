import { useCallback, useMemo } from "react";
import type { ConversationResponseDto, ConversationStatus } from "../../api";
import { conversationListQueryOptions } from "../collections/conversations";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export const ENTITY_TYPE = "Conversation";

export interface UseConversationsOptions
  extends CollectionHookOptions<ConversationResponseDto> {
  workflowName?: string | string[];
  workflowAboutId?: string;
  workflowAboutType?: string;
  statuses?: ConversationStatus[];
  search?: string;
  includeSuggestionDecisions?: boolean;
}

export interface UseConversationsReturn
  extends Omit<DataCollectionHookReturn<ConversationResponseDto>, "data"> {
  data: ConversationResponseDto[] | null; // Allow null for backwards compatibility
}

export function useConversations(
  organizationId: string | undefined,
  projectId: string | undefined,
  options: UseConversationsOptions = {}
): UseConversationsReturn {
  const {
    workflowName,
    workflowAboutId,
    workflowAboutType,
    statuses,
    search,
    includeSuggestionDecisions,
    enabled: enabledOption,
    ...baseOptions
  } = options;

  const isEnabled = enabledOption !== false && !!organizationId && !!projectId;

  const workflowNameFilter = Array.isArray(workflowName)
    ? workflowName.join(",")
    : workflowName;

  // Callers often rebuild the statuses array each render; key by content.
  const statusesKey = statuses?.join(",");
  const queryOptions = useMemo(
    () =>
      conversationListQueryOptions(
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        {
          workflowName: workflowNameFilter,
          search,
          workflowAboutId,
          workflowAboutType,
          statuses: statusesKey
            ? (statusesKey.split(",") as ConversationStatus[])
            : undefined,
          includeSuggestionDecisions,
        }
      ),
    [
      organizationId,
      projectId,
      workflowNameFilter,
      search,
      workflowAboutId,
      workflowAboutType,
      statusesKey,
      includeSuggestionDecisions,
    ]
  );
  const { result, state: query } = useDataLayerQuery(queryOptions, {
    enabled: isEnabled,
    refetchOnMount: baseOptions.refetchOnMount,
    refetchOnWindowFocus: baseOptions.refetchOnWindowFocus,
    staleTimeMs: baseOptions.staleTimeMs,
    maxCacheAgeMs: baseOptions.maxCacheAgeMs,
  });
  const data = result.data ?? null;

  useWebsocketSubscriptions(
    {
      conversationIds: Array.isArray(data) ? data.map((conv) => conv.id) : [],
    },
    {
      enabled: isEnabled,
    }
  );

  const { refetch: refetchList } = query;
  const refetch = useCallback(
    (): Promise<ConversationResponseDto[] | null> => refetchList(),
    [refetchList]
  );

  return { ...query, data, refetch };
}

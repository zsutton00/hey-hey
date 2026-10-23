import {
  inputScope,
  observeCanonicalInputs,
} from "../collections/optimisticConversationInputs";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { MessageRecordDto, MessageResponseDto } from "../../api";
import {
  conversationMessagesQueryOptions,
  isTimelineMessage,
  loadOlderConversationMessages,
} from "../collections/messages";
import {
  buildConversationMessageHistoryKey,
  getConversationMessageHistorySnapshot,
  getPendingOlderConversationMessageCursor,
  loadOlderConversationMessageHistory,
  recordOlderConversationMessageHistoryPage,
  subscribeConversationMessageHistory,
} from "../collections/conversationMessageHistoryState";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseConversationMessagesOptions =
  CollectionHookOptions<MessageResponseDto>;

export interface UseConversationMessagesReturn
  extends DataCollectionHookReturn<MessageResponseDto> {
  /** Conversation timeline, oldest first. Excludes undated queued inputs. */
  orderedData: readonly MessageResponseDto[];
  /**
   * Inputs that have not entered the timeline (queued, or cancelled or failed
   * before starting), in send order.
   */
  undatedInputs: readonly MessageRecordDto[];
  hasOlder: boolean;
  isLoadingOlder: boolean;
  olderError: Error | null;
  loadOlder: () => Promise<void>;
}

const EMPTY_MESSAGES: MessageResponseDto[] = [];
const EMPTY_RECORDS: MessageRecordDto[] = [];

/**
 * Threads a flat list of messages into the tree shape the conversation UI
 * expects: only top-level messages (no parent) at the root, each with their
 * descendants populated under `responses`. Mirrors the server-side build in
 * `mapToDto` so consumers of the messages collection see the same shape they
 * used to get from the conversation envelope.
 */
const buildMessageTree = (
  flat: readonly MessageResponseDto[]
): MessageResponseDto[] => {
  if (flat.length === 0) return EMPTY_MESSAGES;

  const cloned = new Map<string, MessageResponseDto>();
  for (const message of flat) {
    cloned.set(message.id, { ...message, responses: [] });
  }

  const roots: MessageResponseDto[] = [];
  for (const message of flat) {
    const node = cloned.get(message.id);
    if (!node) continue;
    const parentId = message.parentMessageId;
    const parent = parentId ? cloned.get(parentId) : null;
    if (parent) {
      parent.responses!.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
};

export function useConversationMessages(
  organizationId: string | undefined,
  projectId: string | undefined,
  conversationId: string | undefined,
  options: UseConversationMessagesOptions = {}
): UseConversationMessagesReturn {
  const enabled =
    options.enabled !== false &&
    !!organizationId &&
    !!projectId &&
    !!conversationId;

  const queryClient = useQueryClient();
  const queryOptions = useMemo(
    () =>
      conversationMessagesQueryOptions(
        queryClient,
        organizationId ?? "__noop__",
        projectId ?? "__noop__",
        conversationId ?? "__noop__"
      ),
    [queryClient, organizationId, projectId, conversationId]
  );
  const { result, state: query } = useDataLayerQuery(queryOptions, {
    enabled,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
    maxCacheAgeMs: options.maxCacheAgeMs,
  });
  // Realtime keeps the list current only while a view holds the conversation
  // subscription. When the last view unmounts, mark the list stale so the next
  // mount reads what arrived meanwhile (one `since` read).
  useEffect(() => {
    if (!enabled) return;
    const { queryKey } = queryOptions;
    return () => {
      queueMicrotask(() => {
        const query = queryClient
          .getQueryCache()
          .find({ queryKey, exact: true });
        if (query && query.getObserversCount() === 0) {
          void queryClient.invalidateQueries({
            queryKey,
            exact: true,
            refetchType: "none",
          });
        }
      });
    };
  }, [enabled, queryClient, queryOptions]);

  const historyKey = useMemo(
    () =>
      buildConversationMessageHistoryKey({
        organizationId: organizationId ?? "__noop__",
        projectId: projectId ?? "__noop__",
        conversationId: conversationId ?? "__noop__",
      }),
    [conversationId, organizationId, projectId]
  );
  const historySnapshot = useSyncExternalStore(
    useCallback(
      (listener) => subscribeConversationMessageHistory(historyKey, listener),
      [historyKey]
    ),
    useCallback(
      () => getConversationMessageHistorySnapshot(historyKey),
      [historyKey]
    ),
    useCallback(
      () => getConversationMessageHistorySnapshot(historyKey),
      [historyKey]
    )
  );

  const records = result.data ?? EMPTY_RECORDS;
  // One rule: a message is in the timeline exactly when it has a createdAt.
  const orderedData = useMemo(
    () => (records.length ? records.filter(isTimelineMessage) : EMPTY_MESSAGES),
    [records]
  );
  const scope = inputScope(
    organizationId ?? "",
    projectId ?? "",
    conversationId ?? ""
  );
  const undatedInputs = useMemo(
    () =>
      records.length
        ? records.filter((message) => !isTimelineMessage(message))
        : EMPTY_RECORDS,
    [records]
  );
  useEffect(() => {
    if (enabled) observeCanonicalInputs(scope, records);
  }, [enabled, scope, records]);
  const data = useMemo(() => buildMessageTree(orderedData), [orderedData]);
  const loadOlder = useCallback(async (): Promise<void> => {
    if (!enabled || !organizationId || !projectId || !conversationId) return;

    await loadOlderConversationMessageHistory(historyKey, async () => {
      const cursor = getPendingOlderConversationMessageCursor(historyKey);
      if (!cursor) return;
      const nextCursor = await loadOlderConversationMessages(
        queryClient,
        organizationId,
        projectId,
        conversationId,
        cursor
      );
      recordOlderConversationMessageHistoryPage(historyKey, nextCursor);
    });
  }, [conversationId, enabled, historyKey, organizationId, projectId, queryClient]);

  return {
    data,
    orderedData,
    undatedInputs,
    ...query,
    refetch: query.refetch as () => Promise<MessageResponseDto[] | null>,
    hasOlder: historySnapshot.nextCursor !== null,
    isLoadingOlder: historySnapshot.isLoadingOlder,
    olderError: historySnapshot.error,
    loadOlder,
  };
}

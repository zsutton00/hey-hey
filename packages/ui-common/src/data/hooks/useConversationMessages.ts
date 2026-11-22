import { useApolloClient, useQuery } from "@apollo/client/react";
import {
  useQuery as useTanStackQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { MessageRecordDto, MessageResponseDto } from "../../api";
import { GetConversationMessageHistoryDocument } from "../../graphql/generated/graphql";
import {
  buildConversationMessageHistoryKey,
  getConversationMessageHistorySnapshot,
  loadOlderConversationMessageHistory,
  subscribeConversationMessageHistory,
} from "../collections/conversationMessageHistoryState";
import {
  isTimelineMessage,
  loadOlderConversationMessages,
  MESSAGE_PAGE_SIZE,
  mergeQueueIntoTimeline,
  messageKeys,
  queuedInputsQueryOptions,
  readLoadedMessages,
  refreshConversationMessages,
} from "../collections/messages";
import {
  inputScope,
  observeCanonicalInputs,
} from "../collections/optimisticConversationInputs";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { getProjectGraphQLClient } from "../graphql/client";
import { toMessageResponse } from "../graphql/records";

export type UseConversationMessagesOptions =
  CollectionHookOptions<MessageResponseDto>;

export interface UseConversationMessagesReturn extends DataCollectionHookReturn<MessageResponseDto> {
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
  flat: readonly MessageResponseDto[],
): MessageResponseDto[] => {
  if (flat.length === 0) {
    return EMPTY_MESSAGES;
  }

  const cloned = new Map<string, MessageResponseDto>();
  for (const message of flat) {
    cloned.set(message.id, { ...message, responses: [] });
  }

  const roots: MessageResponseDto[] = [];
  for (const message of flat) {
    const node = cloned.get(message.id);
    if (!node) {
      continue;
    }
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

interface RefreshState {
  isFetching: boolean;
  error: Error | null;
  hasSettled: boolean;
}

const toError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/**
 * The conversation's messages. The thread is the one list the GraphQL cache
 * keeps for the conversation: this hook observes it and asks for it to be
 * brought up to date when it mounts, regains focus, or is refetched. Live
 * message events update the same list, so every view of it stays current.
 */
export function useConversationMessages(
  organizationId: string | undefined,
  projectId: string | undefined,
  conversationId: string | undefined,
  options: UseConversationMessagesOptions = {},
): UseConversationMessagesReturn {
  const enabled =
    options.enabled !== false &&
    !!organizationId &&
    !!projectId &&
    !!conversationId;
  const orgId = organizationId ?? "__noop__";
  const projId = projectId ?? "__noop__";
  const convId = conversationId ?? "__noop__";

  const queryClient = useQueryClient();
  const scope = useMemo(
    () => ({ organizationId: orgId, projectId: projId }),
    [orgId, projId],
  );

  const client = getProjectGraphQLClient(useApolloClient(), scope);

  // Cache-only: what has been loaded, whichever read loaded it.
  const thread = useQuery(GetConversationMessageHistoryDocument, {
    client,
    variables: { id: convId, last: MESSAGE_PAGE_SIZE },
    context: scope,
    fetchPolicy: "cache-only",
    skip: !enabled,
  });
  const queuedOptions = useMemo(
    () => queuedInputsQueryOptions(orgId, projId, convId),
    [orgId, projId, convId],
  );
  const queued = useTanStackQuery({ ...queuedOptions, enabled });

  const [refresh, setRefresh] = useState<RefreshState>({
    isFetching: false,
    error: null,
    hasSettled: false,
  });
  const refreshMessages = useCallback(async (): Promise<
    MessageResponseDto[] | null
  > => {
    setRefresh((current) => ({ ...current, isFetching: true }));
    try {
      await refreshConversationMessages(client, scope, convId);
      setRefresh({ isFetching: false, error: null, hasSettled: true });
    } catch (cause) {
      setRefresh({
        isFetching: false,
        error: toError(cause),
        hasSettled: true,
      });
    }

    return readLoadedMessages(client, convId);
  }, [client, scope, convId]);

  useEffect(() => {
    if (enabled) {
      void refreshMessages();
    }
  }, [enabled, refreshMessages]);

  const refetchOnFocus = options.refetchOnWindowFocus !== false;
  useEffect(() => {
    if (!enabled || !refetchOnFocus) {
      return;
    }
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshMessages();
        void queryClient.invalidateQueries({
          queryKey: messageKeys.queuedInputs(orgId, projId, convId),
          exact: true,
        });
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [
    enabled,
    refetchOnFocus,
    refreshMessages,
    queryClient,
    orgId,
    projId,
    convId,
  ]);

  const historyKey = useMemo(
    () =>
      buildConversationMessageHistoryKey({
        organizationId: orgId,
        projectId: projId,
        conversationId: convId,
      }),
    [orgId, projId, convId],
  );
  const historySnapshot = useSyncExternalStore(
    useCallback(
      (listener) => subscribeConversationMessageHistory(historyKey, listener),
      [historyKey],
    ),
    useCallback(
      () => getConversationMessageHistorySnapshot(historyKey),
      [historyKey],
    ),
  );

  const messages = thread.data?.conversation.messages;
  const loadedMessages = useMemo(
    () => messages?.nodes.map(toMessageResponse) ?? EMPTY_MESSAGES,
    [messages],
  );
  const queuedInputs = queued.data ?? EMPTY_RECORDS;
  // One rule: a message is in the timeline exactly when it has a createdAt.
  const records = useMemo(
    () =>
      queuedInputs.length
        ? mergeQueueIntoTimeline(loadedMessages, queuedInputs)
        : loadedMessages,
    [loadedMessages, queuedInputs],
  );
  const orderedData = useMemo(
    () => (records.length ? records.filter(isTimelineMessage) : EMPTY_MESSAGES),
    [records],
  );
  const undatedInputs = useMemo(
    () =>
      records.length
        ? records.filter((message) => !isTimelineMessage(message))
        : EMPTY_RECORDS,
    [records],
  );
  const scopeKey = inputScope(
    organizationId ?? "",
    projectId ?? "",
    conversationId ?? "",
  );
  useEffect(() => {
    if (enabled) {
      observeCanonicalInputs(scopeKey, records);
    }
  }, [enabled, scopeKey, records]);
  const data = useMemo(() => buildMessageTree(orderedData), [orderedData]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!enabled) {
      return;
    }

    await loadOlderConversationMessageHistory(historyKey, () =>
      loadOlderConversationMessages(client, scope, convId),
    );
  }, [client, convId, enabled, historyKey, scope]);

  const isFetched =
    enabled &&
    (messages !== undefined || refresh.hasSettled) &&
    queued.status !== "pending";
  const error = enabled ? (refresh.error ?? queued.error) : null;
  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({
      queryKey: messageKeys.queuedInputs(orgId, projId, convId),
      exact: true,
    });

    return refreshMessages();
  }, [convId, orgId, projId, queryClient, refreshMessages]);

  return {
    data,
    orderedData,
    undatedInputs,
    isLoading: enabled && !isFetched && !error,
    isFetching: enabled && (refresh.isFetching || queued.isFetching),
    isFetched,
    isReady: isFetched && !error,
    error,
    isStale: queued.isStale,
    refetch,
    markStale: () => void refetch(),
    hasOlder: messages?.startCursor != null,
    isLoadingOlder: historySnapshot.isLoadingOlder,
    olderError: historySnapshot.error,
    loadOlder,
  };
}

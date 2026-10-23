import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import axios from "axios";
import {
  MessageReadMode,
  MessageStatus,
  type ConversationMessageHistoryPageDto,
  type MessageRecordDto,
  type MessageResponseDto,
} from "../../api";
import { platformClient, projectsClient } from "../../clients/serviceClients";
import logger from "../../utils/logger";
import {
  captureRequestOptions,
  initiatorRequestOptions,
} from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import {
  buildConversationMessageHistoryKey,
  preserveConversationMessageHistoryOnRefresh,
  recordInitialConversationMessageHistoryPage,
} from "./conversationMessageHistoryState";

export class ConversationMessagesNotFoundError extends Error {
  /** The server's answer for this key; the query policy does not retry it. */
  readonly status = 404;

  constructor(conversationId: string) {
    super(`Conversation messages not found: ${conversationId}`);
    this.name = "ConversationMessagesNotFoundError";
  }
}

/**
 * Prefix tree for message reads. A conversation's message list and its
 * latest-message read share the `conversation` prefix, so one invalidation
 * covers both; the latest read only runs when the list is not loaded.
 *
 * Keys: [root, org, project, "conversation", conversationId, "list" | "latest"]
 *       [root, org, project, "byId", messageId]
 */
export const messageKeys = {
  root: () => ["messages"] as const,
  all: (organizationId: string) =>
    [...messageKeys.root(), organizationId] as const,
  project: (organizationId: string, projectId: string) =>
    [...messageKeys.all(organizationId), projectId] as const,
  conversation: (
    organizationId: string,
    projectId: string,
    conversationId: string,
  ) =>
    [
      ...messageKeys.project(organizationId, projectId),
      "conversation",
      conversationId,
    ] as const,
  list: (organizationId: string, projectId: string, conversationId: string) =>
    [
      ...messageKeys.conversation(organizationId, projectId, conversationId),
      "list",
    ] as const,
  latest: (organizationId: string, projectId: string, conversationId: string) =>
    [
      ...messageKeys.conversation(organizationId, projectId, conversationId),
      "latest",
    ] as const,
  byId: (organizationId: string, projectId: string, messageId: string) =>
    [
      ...messageKeys.project(organizationId, projectId),
      "byId",
      messageId,
    ] as const,
};

/**
 * A message in the conversation timeline. A queued input has no `createdAt`
 * until the agent starts on it; until then it lives only in the queue areas.
 */
export const isTimelineMessage = (
  message: MessageRecordDto,
): message is MessageResponseDto => message.createdAt !== null;

// Timeline order. Only dated messages are ever ordered.
const compareMessageOrder = (
  a: MessageResponseDto,
  b: MessageResponseDto,
): number => {
  const aMs = Date.parse(a.createdAt);
  const bMs = Date.parse(b.createdAt);
  if (aMs !== bMs) return aMs - bMs;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
};

const TERMINAL_MESSAGE_STATUSES: ReadonlySet<MessageStatus> = new Set([
  MessageStatus.Completed,
  MessageStatus.Failed,
]);

const isTerminalMessage = (message: MessageResponseDto): boolean =>
  !!message.status && TERMINAL_MESSAGE_STATUSES.has(message.status);

/** The newest timeline message in a loaded list. Undated inputs never count. */
export const selectLatestTimelineMessage = (
  messages: readonly MessageRecordDto[],
): MessageResponseDto | null => {
  let latest: MessageResponseDto | null = null;
  for (const message of messages) {
    if (!isTimelineMessage(message)) continue;
    if (!latest || compareMessageOrder(latest, message) < 0) latest = message;
  }
  return latest;
};

/**
 * Computes the `since=` cursor for an incremental conversation-messages
 * refetch, backed up by one terminal message to give a one-message overlap.
 *
 * Without the overlap the cursor would sit exactly on the most recent
 * eligible terminal message, and because `since=<cursor>` is exclusive that
 * message would never be re-fetched — so a server-side update to an
 * already-terminal message (e.g. a coalesced interstitial body finalised
 * after completion, the missing-last-message case) is invisible. Returning
 * the terminal message one position *earlier* means the boundary message is
 * always pulled back in and merged.
 *
 * Concretely: of the terminal cached messages strictly older than the oldest
 * non-terminal message (or all terminal messages, when every cached message
 * is terminal), this returns the id of the one immediately preceding the most
 * recent. Returns `null` when no such earlier cursor exists (no cache, fewer
 * than two eligible terminal messages, or the anchor is stuck non-terminal at
 * the head), signalling the read must fall back to a full fetch.
 *
 * Picking the cursor this way means a `since=<cursor>` query always returns
 * every cached non-terminal message *plus* the most recent terminal one, so
 * both in-flight status transitions and late edits to the boundary message
 * are picked up without needing a side-channel single-message refetch.
 */
export function getDeltaFetchCursorId(
  cached: readonly MessageRecordDto[] | undefined,
): string | null {
  if (!cached || cached.length === 0) return null;

  // Undated queued inputs are not in the timeline and never anchor a cursor.
  const sorted = cached.filter(isTimelineMessage).sort(compareMessageOrder);
  const oldestNonTerminal =
    sorted.find((message) => !isTerminalMessage(message)) ?? null;

  let cursor: MessageResponseDto | null = null;
  let prevCursor: MessageResponseDto | null = null;
  for (const message of sorted) {
    if (!isTerminalMessage(message)) continue;
    if (
      oldestNonTerminal &&
      compareMessageOrder(message, oldestNonTerminal) >= 0
    ) {
      break;
    }
    prevCursor = cursor;
    cursor = message;
  }
  return prevCursor?.id ?? null;
}

function mergeAndSortConversationMessages(
  cached: readonly MessageResponseDto[],
  delta: readonly MessageResponseDto[],
): MessageResponseDto[] {
  const byId = new Map<string, MessageResponseDto>();
  for (const message of cached) {
    byId.set(message.id, message);
  }
  // Delta wins on collision so status updates from the server replace the
  // cached copy when an in-flight message transitions.
  for (const message of delta) {
    byId.set(message.id, message);
  }
  return [...byId.values()].sort(compareMessageOrder);
}

/**
 * Dated messages form the timeline. Undated inputs follow in the order
 * queued-inputs returned them (send order). Each identity appears once: a
 * dated record always wins over an undated snapshot of the same id, because
 * createdAt is written once at execution start and never cleared.
 */
function mergeQueueIntoTimeline(
  timeline: readonly MessageRecordDto[],
  queueUpdates: readonly MessageRecordDto[],
): MessageRecordDto[] {
  const dated = mergeAndSortConversationMessages(
    timeline.filter(isTimelineMessage),
    queueUpdates.filter(isTimelineMessage),
  );
  const seen = new Set(dated.map((message) => message.id));
  const waiting: MessageRecordDto[] = [];
  for (const message of queueUpdates) {
    if (isTimelineMessage(message) || seen.has(message.id)) continue;
    seen.add(message.id);
    waiting.push(message);
  }
  return [...dated, ...waiting];
}

const requestOptionsWith = (signal: AbortSignal): AxiosRequestConfig => ({
  ...captureRequestOptions(),
  signal,
});

async function fetchMessage(
  organizationId: string,
  projectId: string,
  messageId: string,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<MessageRecordDto | null> {
  const response = await platformClient.getMessage(
    { id: messageId, projectId, organizationId },
    requestOptions,
  );
  return response.data?.data ?? null;
}

async function fetchLatestMessage(
  organizationId: string,
  projectId: string,
  conversationId: string,
  requestOptions: AxiosRequestConfig,
): Promise<MessageResponseDto | null> {
  const response = await platformClient.getLatestMessage(
    { organizationId, projectId, conversationId },
    requestOptions,
  );
  return response.data?.data ?? null;
}

async function fetchConversationMessageHistoryPage(
  organizationId: string,
  projectId: string,
  conversationId: string,
  historyCursor?: string,
  requestOptions: AxiosRequestConfig = captureRequestOptions(),
): Promise<ConversationMessageHistoryPageDto> {
  try {
    const response = await platformClient.getMessages(
      {
        organizationId,
        projectId,
        conversationId,
        mode: MessageReadMode.ReverseHistory,
        limit: 8,
        historyCursor,
        includeProposals: true,
        includeReports: true,
      },
      requestOptions,
    );
    const data = response.data?.data;
    if (!data || Array.isArray(data)) {
      throw new Error(
        "Reverse conversation Message history returned an invalid response",
      );
    }
    return data;
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      throw new ConversationMessagesNotFoundError(conversationId);
    }
    throw error;
  }
}

/**
 * Issues `GET /conversations/:id/messages?since=<cursor>` and returns the
 * delta, or `cursorInvalid` when the server rejected the cursor (cursor
 * message gone or no longer in the conversation) so the caller can fall back
 * to one full read instead of surfacing the 404.
 */
async function fetchConversationMessageDelta(
  organizationId: string,
  projectId: string,
  conversationId: string,
  since: string,
  requestOptions: AxiosRequestConfig,
): Promise<
  { kind: "delta"; messages: MessageResponseDto[] } | { kind: "cursorInvalid" }
> {
  try {
    const response = await platformClient.getMessages(
      {
        organizationId,
        projectId,
        conversationId,
        since,
        includeProposals: true,
        includeReports: true,
      },
      requestOptions,
    );
    const data = response.data?.data;
    if (data !== undefined && !Array.isArray(data)) {
      throw new Error("Forward Message delta returned an invalid response");
    }
    return { kind: "delta", messages: data ?? [] };
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return { kind: "cursorInvalid" };
    }
    throw error;
  }
}

/**
 * Reads the timeline for one conversation. With no cached list it reads the
 * most recent history page. With a cached list it reads only `since=<cursor>`
 * (cursor from `getDeltaFetchCursorId`), falling back to the recent page when
 * there is no usable cursor or the server rejects it with 404.
 *
 * The cursor is computed from the cache when this read starts, so a read
 * restarted by an invalidation uses the cache as it is at restart. The result
 * is merged into the cache as it is when the read finishes, so older pages
 * loaded in the meantime are kept.
 */
async function fetchConversationMessageList(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  conversationId: string,
  signal: AbortSignal,
): Promise<MessageRecordDto[]> {
  const queryKey = messageKeys.list(organizationId, projectId, conversationId);
  const historyKey = buildConversationMessageHistoryKey({
    organizationId,
    projectId,
    conversationId,
  });
  const requestOptions = requestOptionsWith(signal);
  const cached = queryClient.getQueryData<MessageRecordDto[]>(queryKey);

  // Queue membership is independent of the reverse-history window.
  const pendingResponse = await projectsClient.getQueuedConversationInputs(
    { organizationId, projectId, conversationId },
    requestOptions,
  );
  const pending = pendingResponse.data.data ?? [];

  const readRecentPage = async (): Promise<MessageResponseDto[]> => {
    const page = await fetchConversationMessageHistoryPage(
      organizationId,
      projectId,
      conversationId,
      undefined,
      requestOptions,
    );
    if (cached) {
      preserveConversationMessageHistoryOnRefresh(historyKey, page.nextCursor);
    } else {
      recordInitialConversationMessageHistoryPage(historyKey, page.nextCursor);
    }
    return page.messages;
  };

  let fetched: MessageResponseDto[];
  const cursor = getDeltaFetchCursorId(cached);
  if (!cached || !cursor) {
    logger.info("data_collections", "[messages] GET /messages (recent page)", {
      cid: conversationId,
      cached: !!cached,
    });
    fetched = await readRecentPage();
  } else {
    logger.info("data_collections", "[messages] GET /messages (delta)", {
      cid: conversationId,
      since: cursor,
    });
    const result = await fetchConversationMessageDelta(
      organizationId,
      projectId,
      conversationId,
      cursor,
      requestOptions,
    );
    if (result.kind === "cursorInvalid") {
      logger.info(
        "data_collections",
        "[messages] GET /messages (recent page after cursor 404)",
        { cid: conversationId, since: cursor },
      );
      fetched = await readRecentPage();
    } else {
      fetched = result.messages;
    }
  }

  // Queue was read before the timeline; reconcile once the timeline is known
  // so an earlier undated snapshot never regresses a started input.
  const knownIds = new Set([
    ...pending.map((message) => message.id),
    ...fetched.map((message) => message.id),
  ]);
  const unresolved = (cached ?? []).filter(
    (message) =>
      message.executionStatus === "queued" && !knownIds.has(message.id),
  );
  const completed = await Promise.all(
    unresolved.map((message) =>
      fetchMessage(organizationId, projectId, message.id, requestOptions),
    ),
  );

  const current = queryClient.getQueryData<MessageRecordDto[]>(queryKey) ?? [];
  const timeline = mergeAndSortConversationMessages(
    current.filter(isTimelineMessage),
    fetched,
  );
  return mergeQueueIntoTimeline(timeline, [
    ...pending,
    ...completed.filter(
      (message): message is MessageRecordDto => message !== null,
    ),
  ]);
}

/**
 * Loads one older history page and merges it into the cached list. Used by
 * `loadOlder`; it does not re-read the recent window.
 */
export async function loadOlderConversationMessages(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  conversationId: string,
  historyCursor: string,
): Promise<string | undefined> {
  const page = await fetchConversationMessageHistoryPage(
    organizationId,
    projectId,
    conversationId,
    historyCursor,
    initiatorRequestOptions("conversation-load-older"),
  );
  queryClient.setQueryData<MessageRecordDto[]>(
    messageKeys.list(organizationId, projectId, conversationId),
    (current = []) =>
      mergeQueueIntoTimeline(
        mergeAndSortConversationMessages(
          current.filter(isTimelineMessage),
          page.messages,
        ),
        current.filter((message) => !isTimelineMessage(message)),
      ),
  );
  return page.nextCursor;
}

export function conversationMessagesQueryOptions(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  conversationId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: messageKeys.list(organizationId, projectId, conversationId),
    queryFn: ({ signal }) =>
      fetchConversationMessageList(
        queryClient,
        organizationId,
        projectId,
        conversationId,
        signal,
      ),
  });
}

/**
 * The latest-message read for a conversation whose list is not loaded. If a
 * list read for the same conversation has data or is in flight when this read
 * runs, the latest message is taken from it instead of a second request. The
 * read yields once first so list reads mounted in the same render start first.
 */
export function latestMessageQueryOptions(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  conversationId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: messageKeys.latest(organizationId, projectId, conversationId),
    queryFn: async ({ signal }) => {
      await Promise.resolve();
      const listOptions = conversationMessagesQueryOptions(
        queryClient,
        organizationId,
        projectId,
        conversationId,
      );
      const listState = queryClient.getQueryState(listOptions.queryKey);
      if (listState?.data || listState?.fetchStatus === "fetching") {
        return selectLatestTimelineMessage(
          await queryClient.ensureQueryData(listOptions),
        );
      }
      return fetchLatestMessage(
        organizationId,
        projectId,
        conversationId,
        requestOptionsWith(signal),
      );
    },
  });
}

export function messageQueryOptions(
  organizationId: string,
  projectId: string,
  messageId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: messageKeys.byId(organizationId, projectId, messageId),
    queryFn: async ({ signal }) => {
      const message = await fetchMessage(
        organizationId,
        projectId,
        messageId,
        requestOptionsWith(signal),
      );
      if (!message) throw new Error(`Message not found: ${messageId}`);
      return message;
    },
  });
}

/**
 * A conversation's messages changed: its list and latest-message reads are
 * invalidated. Only mounted reads re-run, and the latest read is disabled
 * while the list is loaded, so a mounted conversation costs one list read.
 */
export function invalidateConversationMessages(
  queryClient: QueryClient,
  organizationId: string,
  projectId: string,
  conversationId: string,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: messageKeys.conversation(
      organizationId,
      projectId,
      conversationId,
    ),
  });
}

/** Every cached message for one conversation, across list, latest and by-id reads. */
export function getCachedMessagesForConversation(
  queryClient: QueryClient,
  conversationId: string,
): MessageRecordDto[] {
  const byId = new Map<string, MessageRecordDto>();
  for (const [, data] of queryClient.getQueriesData<
    MessageRecordDto[] | MessageRecordDto | null
  >({ queryKey: messageKeys.root() })) {
    const records = Array.isArray(data) ? data : data ? [data] : [];
    for (const message of records) {
      if (message.conversationId === conversationId) {
        byId.set(message.id, message);
      }
    }
  }
  return [...byId.values()];
}

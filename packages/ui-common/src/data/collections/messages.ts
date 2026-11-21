import type { ApolloClient } from "@apollo/client";
import { queryOptions } from "@tanstack/react-query";
import {
  MessageCursorNotFoundErrorDto,
  MessageStatus,
  type MessageRecordDto,
  type MessageResponseDto,
} from "../../api";
import { projectsClient } from "../../clients/serviceClients";
import {
  GetConversationMessageHistoryDocument,
  GetConversationMessagesDocument,
  GetLatestMessageDocument,
  GetMessageDocument,
  type GetConversationMessageHistoryQuery,
  type GetLatestMessageQuery,
  type GetLatestMessageQueryVariables,
  type GetMessageQuery,
  type GetMessageQueryVariables,
} from "../../graphql/generated/graphql";
import { extractErrorCode } from "../../utils/errorUtils";
import logger from "../../utils/logger";
import { captureRequestOptions } from "../core/requestInitiator";
import {
  getProjectGraphQLClient,
  type GraphQLProjectScope,
} from "../graphql/client";
import { toMessageDetail, toMessageResponse } from "../graphql/records";
import type { GraphQLReadSpec } from "../graphql/useGraphQLRead";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

/** How many of a conversation's newest messages it opens with, and each older page. */
export const MESSAGE_PAGE_SIZE = 8;

/**
 * Queued inputs are the one conversation read that stays on REST. They are
 * the undated inputs waiting to enter the thread, so they have no
 * counterpart in the message list the GraphQL client holds.
 *
 * Keys: [root, org, project, "conversation", conversationId, "queued"]
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
  queuedInputs: (
    organizationId: string,
    projectId: string,
    conversationId: string,
  ) =>
    [
      ...messageKeys.conversation(organizationId, projectId, conversationId),
      "queued",
    ] as const,
};

export function queuedInputsQueryOptions(
  organizationId: string,
  projectId: string,
  conversationId: string,
) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: messageKeys.queuedInputs(
      organizationId,
      projectId,
      conversationId,
    ),
    queryFn: async ({ signal }): Promise<MessageRecordDto[]> => {
      const response = await projectsClient.getQueuedConversationInputs(
        { organizationId, projectId, conversationId },
        { ...captureRequestOptions(), signal },
      );

      return response.data.data ?? [];
    },
  });
}

/**
 * A message in the conversation timeline. A queued input has no `createdAt`
 * until the agent starts on it; until then it lives only in the queue areas.
 */
export const isTimelineMessage = (
  message: MessageRecordDto,
): message is MessageResponseDto => message.createdAt !== null;

/** What the delta cursor needs to know about a loaded message. */
export interface ThreadPosition {
  id: string;
  status?: string;
  createdAt: string | null;
}

const compareThreadPosition = (
  a: ThreadPosition,
  b: ThreadPosition,
): number => {
  const aMs = Date.parse(a.createdAt ?? "");
  const bMs = Date.parse(b.createdAt ?? "");
  if (aMs !== bMs) {
    return aMs - bMs;
  }

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
};

const TERMINAL_MESSAGE_STATUSES: ReadonlySet<string> = new Set([
  MessageStatus.Completed,
  MessageStatus.Failed,
]);

const isTerminal = (message: ThreadPosition): boolean =>
  !!message.status && TERMINAL_MESSAGE_STATUSES.has(message.status);

/**
 * Computes the `after` cursor for an incremental refresh, backed up by one
 * terminal message to give a one-message overlap.
 *
 * The cursor is exclusive, so a cursor sitting exactly on the newest settled
 * message would never re-fetch it, and a late edit to that message (for
 * example a coalesced interstitial finalised after completion) would stay
 * invisible. Returning the terminal message one position earlier pulls the
 * boundary message back in, together with every cached non-terminal message.
 *
 * Of the terminal messages strictly older than the oldest non-terminal one
 * (or all of them, when every message is terminal) this returns the one just
 * before the newest. `null` means there is no such cursor and the caller
 * reads the recent page instead.
 */
export function getDeltaFetchCursorId(
  loaded: readonly ThreadPosition[] | undefined,
): string | null {
  if (!loaded || loaded.length === 0) {
    return null;
  }

  // Undated queued inputs are not in the timeline and never anchor a cursor.
  const sorted = loaded
    .filter((message) => message.createdAt !== null)
    .sort(compareThreadPosition);
  const oldestNonTerminal = sorted.find((message) => !isTerminal(message));

  let cursor: ThreadPosition | null = null;
  let previous: ThreadPosition | null = null;
  for (const message of sorted) {
    if (!isTerminal(message)) {
      continue;
    }
    if (
      oldestNonTerminal &&
      compareThreadPosition(message, oldestNonTerminal) >= 0
    ) {
      break;
    }
    previous = cursor;
    cursor = message;
  }

  return previous?.id ?? null;
}

const compareMessageOrder = (
  a: MessageResponseDto,
  b: MessageResponseDto,
): number => compareThreadPosition(a, b);

function mergeAndSortConversationMessages(
  cached: readonly MessageResponseDto[],
  delta: readonly MessageResponseDto[],
): MessageResponseDto[] {
  const byId = new Map<string, MessageResponseDto>();
  for (const message of [...cached, ...delta]) {
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
export function mergeQueueIntoTimeline(
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
    if (isTimelineMessage(message) || seen.has(message.id)) {
      continue;
    }
    seen.add(message.id);
    waiting.push(message);
  }

  return [...dated, ...waiting];
}

/** The newest timeline message in a loaded list. Undated inputs never count. */
export const selectLatestTimelineMessage = (
  messages: readonly MessageRecordDto[],
): MessageResponseDto | null => {
  let latest: MessageResponseDto | null = null;
  for (const message of messages) {
    if (!isTimelineMessage(message)) {
      continue;
    }
    if (!latest || compareMessageOrder(latest, message) < 0) {
      latest = message;
    }
  }

  return latest;
};

export const messageRead = (
  scope: GraphQLProjectScope,
  messageId: string,
): GraphQLReadSpec<
  GetMessageQuery,
  GetMessageQueryVariables,
  MessageRecordDto
> => ({
  document: GetMessageDocument,
  variables: { id: messageId },
  scope,
  select: (data) => toMessageDetail(data.message),
});

export const latestMessageRead = (
  scope: GraphQLProjectScope,
  conversationId: string,
): GraphQLReadSpec<
  GetLatestMessageQuery,
  GetLatestMessageQueryVariables,
  MessageResponseDto
> => ({
  document: GetLatestMessageDocument,
  variables: { conversationId },
  scope,
  select: (data) =>
    data.latestMessage ? toMessageResponse(data.latestMessage) : null,
});

/** The thread as the cache holds it right now; never reads the network. */
export function readLoadedThread(client: ApolloClient, conversationId: string) {
  const loaded = client.readQuery({
    query: GetConversationMessageHistoryDocument,
    variables: { id: conversationId, last: MESSAGE_PAGE_SIZE },
  });

  return loaded?.conversation.messages ?? null;
}

/** Every loaded message in thread order, or null while no thread is loaded. */
export function readLoadedMessages(
  client: ApolloClient,
  conversationId: string,
): MessageResponseDto[] | null {
  const loaded = client.readQuery({
    query: GetConversationMessageHistoryDocument,
    variables: { id: conversationId, last: MESSAGE_PAGE_SIZE },
  });

  return loaded?.conversation.messages.nodes.map(toMessageResponse) ?? null;
}

const isRejectedCursor = (error: unknown): boolean =>
  extractErrorCode(error) ===
  MessageCursorNotFoundErrorDto.CodeEnum.MessageCursorNotFound;

type HistoryPage =
  GetConversationMessageHistoryQuery["conversation"]["messages"];

async function recoverRecentHistory(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  conversationId: string,
  retained: readonly ThreadPosition[],
): Promise<void> {
  const query = GetConversationMessageHistoryDocument;
  const variables = { id: conversationId, last: MESSAGE_PAGE_SIZE };
  const retainedIds = new Set(retained.map(({ id }) => id));
  const pages: HistoryPage[] = [];
  let before: string | null = null;

  // Keep the previous timeline visible until the entire gap has been read.
  while (true) {
    const { data } = await client.query({
      query,
      variables: { ...variables, ...(before && { before }) },
      context: scope,
      fetchPolicy: "no-cache",
    });
    if (!data) {
      throw new Error("Message history read returned no data");
    }

    const page: HistoryPage = data.conversation.messages;
    pages.push(page);
    if (
      !retainedIds.size ||
      page.nodes.some(({ id }) => retainedIds.has(id)) ||
      !page.hasOlder
    ) {
      client.writeQuery({
        query,
        variables,
        data: {
          conversation: {
            ...data.conversation,
            messages: {
              ...page,
              endCursor: pages[0].endCursor,
              nodes: pages.reverse().flatMap(({ nodes }) => nodes),
            },
          },
        },
      });

      return;
    }

    before = page.startCursor;
    if (!before) {
      throw new Error("Message history read did not return an older cursor");
    }
  }
}

/**
 * Brings the conversation's loaded thread up to date. With nothing loaded it
 * reads the newest page. With a thread loaded it reads only the messages
 * after the delta cursor, and falls back to the newest page when the server
 * rejects that cursor. Recovery reads backward until it reaches the loaded
 * history or the start of the thread.
 */
async function refreshThread(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  conversationId: string,
): Promise<void> {
  const retained = readLoadedThread(client, conversationId)?.nodes ?? [];
  const cursor = getDeltaFetchCursorId(retained);
  if (!cursor) {
    logger.info("data_collections", "[messages] recent page", {
      cid: conversationId,
    });
    await recoverRecentHistory(client, scope, conversationId, retained);

    return;
  }

  try {
    await client.query({
      query: GetConversationMessagesDocument,
      variables: { id: conversationId, after: cursor },
      context: scope,
      fetchPolicy: "network-only",
    });
  } catch (error) {
    if (!isRejectedCursor(error)) {
      throw error;
    }
    logger.info("data_collections", "[messages] recent page after cursor", {
      cid: conversationId,
      since: cursor,
    });
    await recoverRecentHistory(client, scope, conversationId, retained);
  }
}

interface ThreadRefresh {
  running: Promise<void>;
  /** Starts when `running` ends; covers every request made meanwhile. */
  waiting: Promise<void> | null;
}

const clientRefreshes = new WeakMap<ApolloClient, Map<string, ThreadRefresh>>();
const ignore = () => undefined;

/**
 * One refresh at a time per conversation. A request made while a refresh runs
 * waits for one more run that starts after it, so a read that began before an
 * event never stands in for the read that event asked for.
 */
export function refreshConversationMessages(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  conversationId: string,
): Promise<void> {
  client = getProjectGraphQLClient(client, scope);
  let refreshes = clientRefreshes.get(client);
  if (!refreshes) {
    refreshes = new Map();
    clientRefreshes.set(client, refreshes);
  }
  const entries = refreshes;
  const key = JSON.stringify([
    scope.organizationId,
    scope.projectId,
    conversationId,
  ]);
  const start = () => refreshThread(client, scope, conversationId);
  const retire = (finished: Promise<void>) => () => {
    const entry = entries.get(key);
    if (entry?.running === finished && !entry.waiting) {
      entries.delete(key);
    }
  };
  const run = (): Promise<void> => {
    const running = start();
    void running.then(retire(running), retire(running));

    return running;
  };

  const entry = entries.get(key);
  if (!entry) {
    const running = run();
    entries.set(key, { running, waiting: null });

    return running;
  }
  if (entry.waiting) {
    return entry.waiting;
  }

  const waiting = entry.running.then(ignore, ignore).then(() => {
    entry.waiting = null;
    entry.running = run();

    return entry.running;
  });
  entry.waiting = waiting;

  return waiting;
}

/** Loads the page before the oldest loaded message into the same list. */
export async function loadOlderConversationMessages(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  conversationId: string,
): Promise<void> {
  const before = readLoadedThread(client, conversationId)?.startCursor;
  if (!before) {
    return;
  }

  await client.query({
    query: GetConversationMessageHistoryDocument,
    variables: { id: conversationId, last: MESSAGE_PAGE_SIZE, before },
    context: scope,
    fetchPolicy: "network-only",
  });
}

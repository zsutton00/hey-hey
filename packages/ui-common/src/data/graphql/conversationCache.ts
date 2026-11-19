import {
  isReference,
  type ApolloClient,
  type ObservableQuery,
} from "@apollo/client";
import {
  GetMessageDocument,
  MessageProposalLinksFragmentDoc,
  type MessageProposalLinksFragment,
} from "../../graphql/generated/graphql";
import {
  readLoadedThread,
  refreshConversationMessages,
} from "../collections/messages";
import { activeReads, holdsEntity, isObject, variableOf } from "./activeReads";
import {
  getGraphQLClients,
  getProjectGraphQLClient,
  type GraphQLProjectScope,
} from "./client";
import type { StoredMessageConnection } from "./conversationMessagesPolicy";

/**
 * Keeps conversations and messages in the GraphQL cache current. Each change
 * either refetches the active reads that hold the entity, or removes it from
 * the cache. Nothing here builds a record: an entity enters the cache only
 * through a read of the server.
 */

const CONVERSATION_READS: ReadonlySet<string> = new Set([
  "GetConversation",
  "GetConversationWithDecisions",
]);

const CONVERSATION_LIST_READS: ReadonlySet<string> = new Set([
  "GetConversations",
  "GetConversationsWithDecisions",
  "GetActiveConversations",
  "GetActiveConversationsWithDecisions",
  "GetWorkflowConversations",
]);

/** Refetches the detail and the lists affected by a conversation change. */
export async function refreshConversation(
  client: ApolloClient,
  conversationId: string,
  membershipScope?: GraphQLProjectScope,
): Promise<void> {
  const listClient = membershipScope
    ? getProjectGraphQLClient(client, membershipScope)
    : client;
  const lists = activeReads(listClient, CONVERSATION_LIST_READS).filter(
    (query) =>
      membershipScope ||
      holdsEntity(query.getCurrentResult().data, conversationId),
  );
  const details = activeReads(listClient, CONVERSATION_READS).filter(
    (query) => variableOf(query, "id") === conversationId,
  );

  await Promise.all(
    [...details, ...lists].map((query) => query.refetch().catch(() => null)),
  );
}

/** A conversation joined or left a project: its active lists read again. */
export async function refreshConversationLists(
  client: ApolloClient,
): Promise<void> {
  await Promise.all(
    activeReads(client, CONVERSATION_LIST_READS).map((query) =>
      query.refetch().catch(() => null),
    ),
  );
}

/** Brings a conversation's loaded thread up to date, when a view shows it. */
export async function refreshConversationThread(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  conversationId: string,
): Promise<void> {
  client = getProjectGraphQLClient(client, scope);
  const fullThreadReads = activeReads(
    client,
    new Set(["GetConversationMessages"]),
  ).filter((query) => variableOf(query, "id") === conversationId);
  if (fullThreadReads.length) {
    await Promise.all(
      fullThreadReads.map((query) => query.refetch().catch(() => null)),
    );
    return;
  }

  const isShown = [...client.getObservableQueries("active")].some(
    (query) =>
      query.queryName === "GetConversationMessageHistory" &&
      variableOf(query, "id") === conversationId,
  );
  if (isShown) {
    await refreshConversationMessages(client, scope, conversationId).catch(
      () => undefined,
    );
  }
}

/** Refetches the active latest-message reads of one conversation. */
export async function refreshLatestMessage(
  client: ApolloClient,
  conversationId: string,
): Promise<void> {
  await Promise.all(
    activeReads(client, new Set(["GetLatestMessage"]))
      .filter((query) => variableOf(query, "conversationId") === conversationId)
      .map((query) => query.refetch().catch(() => null)),
  );
}

/** A created event has no parent ID, so refetch details in its conversation. */
export async function refreshMessageReplies(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  conversationId: string,
): Promise<void> {
  const project = getProjectGraphQLClient(client, scope);
  const details = activeReads(project, new Set(["GetMessage"])).filter(
    (query) => {
      const id = variableOf(query, "id");
      if (typeof id !== "string") {
        return false;
      }
      return (
        project.readQuery({ query: GetMessageDocument, variables: { id } })
          ?.message.conversationId === conversationId
      );
    },
  );
  await Promise.all(details.map((query) => query.refetch().catch(() => null)));
}

/** Updates a message shown in a thread or in an active detail read. */
export async function refreshMessage(
  client: ApolloClient,
  scope: GraphQLProjectScope,
  conversationId: string,
  messageId: string,
): Promise<void> {
  const project = getProjectGraphQLClient(client, scope);
  const details = activeReads(project, new Set(["GetMessage"]));
  const matchingDetails = details.filter(
    (query) =>
      variableOf(query, "id") === messageId ||
      holdsEntity(query.getCurrentResult().data, messageId),
  );
  const refreshes = matchingDetails.map((query) =>
    query.refetch().catch(() => null),
  );

  const threadIsShown = activeReads(
    project,
    new Set(["GetConversationMessageHistory"]),
  ).some((query) => variableOf(query, "id") === conversationId);
  if (
    !matchingDetails.some((query) => variableOf(query, "id") === messageId) &&
    threadIsShown &&
    readLoadedThread(project, conversationId)?.nodes.some(
      (message) => message.id === messageId,
    )
  ) {
    refreshes.push(
      project
        .query({
          query: GetMessageDocument,
          variables: { id: messageId },
          context: scope,
          fetchPolicy: "network-only",
        })
        .catch(() => null),
    );
  }
  await Promise.all(refreshes);
}

/** The proposals a cached message carries or suggests, for review refreshes. */
export function cachedMessageProposalIds(
  client: ApolloClient,
  messageId: string,
): string[] {
  const message: MessageProposalLinksFragment | null =
    client.cache.readFragment({
      id: client.cache.identify({ __typename: "Message", id: messageId }),
      fragment: MessageProposalLinksFragmentDoc,
    });
  if (!message) {
    return [];
  }

  const attached = (message.proposals ?? []).flatMap((proposal) =>
    isObject(proposal) && typeof proposal.id === "string" ? [proposal.id] : [],
  );
  const data = message.data;
  const suggested =
    message.type === "SYSTEM" &&
    isObject(data) &&
    isObject(data.proposalSuggestion) &&
    typeof data.proposalSuggestion.proposalId === "string"
      ? [data.proposalSuggestion.proposalId]
      : [];

  return [...attached, ...suggested];
}

/**
 * A message was deleted: it leaves the conversation's thread and every other
 * view of it, and the reads that depended on it ask the server again.
 */
export function evictMessage(
  client: ApolloClient,
  conversationId: string | undefined,
  messageId: string,
): void {
  const { cache } = client;

  if (conversationId) {
    cache.modify<{ messages: StoredMessageConnection }>({
      id: cache.identify({ __typename: "Conversation", id: conversationId }),
      fields: {
        messages(existing, { readField }) {
          if (isReference(existing)) {
            return existing;
          }

          return {
            ...existing,
            nodes: existing.nodes.filter(
              (node) => readField("id", node) !== messageId,
            ),
          };
        },
      },
    });
  }
  cache.evict({ id: cache.identify({ __typename: "Message", id: messageId }) });
  cache.gc();
}

/** A conversation was deleted: it leaves every view and read of it. */
export function evictConversation(
  client: ApolloClient,
  conversationId: string,
): void {
  const { cache } = client;
  const id = cache.identify({ __typename: "Conversation", id: conversationId });
  if (id) {
    cache.evict({ id });
    cache.gc();
  }
}

const projectScopeOf = (query: ObservableQuery): GraphQLProjectScope | null => {
  const { context } = query.options;
  if (
    isObject(context) &&
    typeof context.organizationId === "string" &&
    typeof context.projectId === "string"
  ) {
    return {
      organizationId: context.organizationId,
      projectId: context.projectId,
    };
  }

  return null;
};

/** After a reconnect, events may have been missed: every shown read asks again. */
export async function refreshShownConversationReads(
  client: ApolloClient,
): Promise<void> {
  const refetched = new Set([
    ...CONVERSATION_READS,
    ...CONVERSATION_LIST_READS,
    "GetLatestMessage",
    "GetMessage",
    "GetConversationMessages",
  ]);
  const shown = [...getGraphQLClients(client)].flatMap((project) =>
    [...project.getObservableQueries("active")].map((query) => ({
      project,
      query,
    })),
  );

  await Promise.all(
    shown.map(({ project, query }) => {
      if (query.queryName === "GetConversationMessageHistory") {
        const scope = projectScopeOf(query);
        const conversationId = variableOf(query, "id");

        return scope && typeof conversationId === "string"
          ? refreshConversationMessages(project, scope, conversationId).catch(
              () => undefined,
            )
          : undefined;
      }

      return query.queryName !== undefined && refetched.has(query.queryName)
        ? query.refetch().catch(() => null)
        : undefined;
    }),
  );
}

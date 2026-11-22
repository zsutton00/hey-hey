import { useApolloClient, useReactiveVar } from "@apollo/client/react";
import {
  deniedConversations,
  getProjectGraphQLClient,
  GraphQLRequestError,
} from "../graphql/client";
import { isConversationReadDenied } from "../query/queryPolicy";
import { useMemo } from "react";
import type { MessageResponseDto } from "../../api";
import { latestMessageRead } from "../collections/messages";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useGraphQLRead } from "../graphql/useGraphQLRead";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

export type UseLatestMessageReturn = DataHookReturn<MessageResponseDto>;
export type UseLatestMessageOptions = Omit<
  CollectionHookOptions<MessageResponseDto>,
  "preferStale"
> & {
  /** Kept for compatibility; cached data is always reused while fresh. */
  skipInitialFetchIfCached?: boolean;
};

/**
 * The newest timeline message of a conversation, read through GraphQL. Live
 * message events refresh it, and the message is the same cached record every
 * other view of it shows.
 */
export function useLatestMessage(
  organizationId: string | undefined,
  projectId: string | undefined,
  conversationId: string | undefined,
  options: UseLatestMessageOptions = {},
): UseLatestMessageReturn {
  const enabled =
    (options.enabled ?? true) &&
    !!organizationId &&
    !!projectId &&
    !!conversationId;
  const spec = useMemo(
    () =>
      latestMessageRead(
        {
          organizationId: organizationId ?? "__noop__",
          projectId: projectId ?? "__noop__",
        },
        conversationId ?? "__noop__",
      ),
    [organizationId, projectId, conversationId],
  );
  const state = useGraphQLRead(spec, {
    enabled,
    refetchOnMount: options.refetchOnMount,
    refetchOnWindowFocus: options.refetchOnWindowFocus,
    staleTimeMs: options.staleTimeMs,
  });

  // Keeps the conversation subscribed so message events reach the cache.
  useWebsocketSubscriptions(
    { conversationIds: conversationId ? [conversationId] : [] },
    { enabled },
  );

  const client = getProjectGraphQLClient(useApolloClient(), spec.scope);
  const denied = useReactiveVar(deniedConversations(client.cache)).has(
    conversationId ?? "",
  );
  return denied || isConversationReadDenied(state.error)
    ? {
        ...state,
        error:
          state.error ??
          new GraphQLRequestError("Conversation is private", "FORBIDDEN"),
        data: null,
        isReady: false,
      }
    : state;
}

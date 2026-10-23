import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type {
  ConversationResponseDto,
  ConversationStatus,
  MessageResponseDto,
} from "../../api";
import {
  conversationMessagesQueryOptions,
  isTimelineMessage,
} from "../collections/messages";
import { useConversations } from "./useConversations";
import { useConversationMessages } from "./useConversationMessages";
import { areConversationMessagesReady } from "./conversationMessageReadiness";

export interface UseConversationByCategoryOptions {
  enabled?: boolean;
  /** Prefer one known conversation identity when a page has already selected it. */
  conversationId?: string;
  /** Restrict selection to a specific entry trigger after the API scope filter. */
  triggerEvent?: string;
  /** Require that the conversation has at least one message */
  requireFirstMessage?: boolean;
  requireUiElements?: boolean;
  includeSuggestionDecisions?: boolean;
  workflowAboutId?: string;
  workflowAboutType?: string;
  statuses?: ConversationStatus[];
}

export interface UseConversationByCategoryReturn {
  data: ConversationResponseDto | null;
  messages: MessageResponseDto[];
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  refetch: () => Promise<ConversationResponseDto | null>;
  markStale: () => void;
}

const newestConversation = (
  conversations: readonly ConversationResponseDto[]
) =>
  conversations.reduce<ConversationResponseDto | null>(
    (latest, current) =>
      !latest || Date.parse(current.createdAt) > Date.parse(latest.createdAt)
        ? current
        : latest,
    null
  );

export function useConversationByWorkflow(
  organizationId: string | undefined,
  projectId: string | undefined,
  workflowName: string,
  options: UseConversationByCategoryOptions = {}
): UseConversationByCategoryReturn {
  const {
    conversationId,
    triggerEvent,
    requireFirstMessage = false,
    requireUiElements = false,
    ...collectionOptions
  } = options;
  const enabled = options.enabled !== false && !!organizationId && !!projectId;
  const conversations = useConversations(organizationId, projectId, {
    ...collectionOptions,
    workflowName,
    enabled,
  });
  const scopedConversations = (conversations.data ?? []).filter(
    (conversation) =>
      (conversationId === undefined || conversation.id === conversationId) &&
      (triggerEvent === undefined || conversation.triggerEvent === triggerEvent)
  );
  const candidate = newestConversation(scopedConversations);
  const messageQuery = useConversationMessages(
    organizationId,
    projectId,
    candidate?.id,
    { enabled }
  );
  const queryClient = useQueryClient();
  const ready =
    !!candidate &&
    messageQuery.isReady &&
    areConversationMessagesReady(messageQuery.data, {
      requireFirstMessage,
      requireUiElements,
    });
  const scope = JSON.stringify([
    organizationId,
    projectId,
    workflowName,
    options.workflowAboutId,
    options.workflowAboutType,
    options.statuses,
    conversationId,
    triggerEvent,
  ]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;

  const refetch = useCallback(async () => {
    if (!enabled || !organizationId || !projectId) return null;
    const result = await conversations.refetch();
    if (scopeRef.current !== scope) return null;
    const refreshed = newestConversation(
      (result ?? []).filter(
        (conversation) =>
          (conversationId === undefined ||
            conversation.id === conversationId) &&
          (triggerEvent === undefined ||
            conversation.triggerEvent === triggerEvent)
      )
    );
    if (!refreshed) return null;
    const messageOptions = conversationMessagesQueryOptions(
      queryClient,
      organizationId,
      projectId,
      refreshed.id
    );
    // An explicit refresh needs a read that starts now, not one in flight.
    await queryClient.cancelQueries({
      queryKey: messageOptions.queryKey,
      exact: true,
    });
    const messages = await queryClient.fetchQuery({
      ...messageOptions,
      staleTime: 0,
    });
    if (scopeRef.current !== scope) return null;
    return areConversationMessagesReady(messages.filter(isTimelineMessage), {
      requireFirstMessage,
      requireUiElements,
    })
      ? refreshed
      : null;
  }, [
    enabled,
    organizationId,
    projectId,
    conversations.refetch,
    scope,
    queryClient,
    requireFirstMessage,
    requireUiElements,
    conversationId,
    triggerEvent,
  ]);

  usePendingConversationRecovery(scope, enabled && !ready, async () => {
    if (candidate) await messageQuery.refetch();
    else await conversations.refetch();
  });

  const error = conversations.error ?? (candidate ? messageQuery.error : null);
  const isFetched =
    conversations.isFetched && (!candidate || messageQuery.isFetched);
  return {
    data: ready ? candidate : null,
    messages: messageQuery.data,
    isLoading:
      enabled &&
      !error &&
      (!conversations.isFetched || (!!candidate && !messageQuery.isFetched)),
    isFetching:
      conversations.isFetching || (!!candidate && messageQuery.isFetching),
    isFetched,
    isReady: isFetched && !error && ready,
    error,
    refetch,
    markStale: () => {
      conversations.markStale();
      if (candidate) messageQuery.markStale();
    },
  };
}

function usePendingConversationRecovery(
  scope: string,
  waiting: boolean,
  recover: () => Promise<void>
) {
  const recoveryRef = useRef(recover);
  recoveryRef.current = recover;
  useEffect(() => {
    if (!waiting) return;
    let inFlight = false;
    // Events update the callback, never the deadline.
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void recoveryRef
        .current()
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    }, 3000);
    return () => clearInterval(timer);
  }, [scope, waiting]);
}

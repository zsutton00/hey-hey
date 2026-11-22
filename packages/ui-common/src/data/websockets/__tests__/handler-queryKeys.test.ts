import { createUnreachableGraphQLClient } from "../../../test/graphqlTestClient";
/**
 * WebSocket handler conversation invalidation against the TanStack Query
 * cache: conversation events invalidate by conversation id, so every cached
 * envelope variant and every list holding the conversation re-reads,
 * whatever filters those lists were read with.
 */

import { createStore } from "jotai";
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { vi } from "vitest";
import { WebSocketHandler } from "../handler";
import { WebSocketDebugger } from "../debug";
import { subscribeProposalReconciliation } from "../../../components/ProposalReconciliation/reconciliationInvalidation";
import type {
  ProposalResponseDto,
  WebSocketConversationStatusChangedEvent,
} from "../../../api";
import { proposalKeys } from "../../collections/proposals";
import { MessageProposalLinksFragmentDoc } from "../../../graphql/generated/graphql";
import { getProjectGraphQLClient } from "../../graphql/client";

const ORG = "org-123";
const PROJECT = "project-456";

const isInvalidated = (queryClient: QueryClient, key: QueryKey) =>
  queryClient.getQueryState(key)?.isInvalidated ?? false;

describe("WebSocket handler with queryKeys", () => {
  let store: ReturnType<typeof createStore>;
  let handler: WebSocketHandler;
  let queryClient: QueryClient;
  let graphql: ReturnType<typeof createUnreachableGraphQLClient>;
  let mockDebugger: WebSocketDebugger;
  let logEventSpy: ReturnType<typeof vi.spyOn>;
  let logQueryInvalidationSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    store = createStore();

    // Create proper debugger instance with mocked methods
    mockDebugger = new WebSocketDebugger();
    logEventSpy = vi
      .spyOn(mockDebugger, "logEvent")
      .mockImplementation(() => {});
    logQueryInvalidationSpy = vi
      .spyOn(mockDebugger, "logQueryInvalidation")
      .mockImplementation(() => {});

    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    graphql = createUnreachableGraphQLClient();
    handler = new WebSocketHandler(store, mockDebugger, queryClient, graphql);

    // Clear mock calls
    logEventSpy.mockClear();
    logQueryInvalidationSpy.mockClear();
  });

  afterEach(() => {
    queryClient.clear();
  });

  it.each(["attachment", "suggestion", "standalone", "list"])(
    "refreshes only the proposal affected by a message update (%s)",
    (source) => {
      const affected = proposalKeys.detail(ORG, PROJECT, "affected");
      const unrelated = proposalKeys.detail(ORG, PROJECT, "unrelated");
      const foreign = proposalKeys.detail(ORG, "other-project", "foreign");
      queryClient.setQueryData(affected, {
        id: "affected",
        messageId: source === "standalone" ? "changed" : "owner",
      } as ProposalResponseDto);
      queryClient.setQueryData(unrelated, {
        id: "unrelated",
        messageId: "unrelated-message",
      } as ProposalResponseDto);
      queryClient.setQueryData(foreign, {
        id: "foreign",
        messageId: "changed",
      } as ProposalResponseDto);
      if (source === "attachment" || source === "suggestion") {
        const client = getProjectGraphQLClient(graphql, {
          organizationId: ORG,
          projectId: PROJECT,
        });
        client.cache.writeFragment({
          id: client.cache.identify({ __typename: "Message", id: "changed" }),
          fragment: MessageProposalLinksFragmentDoc,
          data: {
            __typename: "Message",
            type: "SYSTEM",
            proposals: source === "attachment" ? [{ id: "affected" }] : [],
            data:
              source === "suggestion"
                ? {
                    type: "AGENT",
                    proposalSuggestion: { proposalId: "affected" },
                  }
                : { type: "AGENT" },
          },
        });
      }
      const affectedList = proposalKeys.list(ORG, PROJECT, { status: "DRAFT" });
      const unrelatedList = proposalKeys.list(ORG, PROJECT, {
        status: "APPROVED",
      });
      queryClient.setQueryData(affectedList, {
        proposals: [
          {
            id: "affected",
            messageId: source === "list" ? "changed" : "owner",
          },
        ],
      });
      queryClient.setQueryData(unrelatedList, {
        proposals: [{ id: "unrelated", messageId: "other" }],
      });
      const refreshAffected = vi.fn();
      const refreshUnrelated = vi.fn();
      const refreshForeign = vi.fn();
      const unsubscribe = [
        subscribeProposalReconciliation("affected", refreshAffected),
        subscribeProposalReconciliation("unrelated", refreshUnrelated),
        subscribeProposalReconciliation("foreign", refreshForeign),
      ];
      try {
        handler.handleEvent({
          type: "message.updated",
          timestamp: new Date().toISOString(),
          organizationId: ORG,
          projectId: PROJECT,
          conversationId: "conversation",
          messageId: "unrelated-message-with-no-proposals",
        });
        expect(refreshAffected).not.toHaveBeenCalled();
        expect(refreshUnrelated).not.toHaveBeenCalled();
        expect(isInvalidated(queryClient, affected)).toBe(false);
        handler.handleEvent({
          type: "message.updated",
          timestamp: new Date().toISOString(),
          organizationId: ORG,
          projectId: PROJECT,
          conversationId: "conversation",
          messageId: "changed",
        });
        expect(refreshAffected).toHaveBeenCalledTimes(1);
        expect(refreshUnrelated).not.toHaveBeenCalled();
        expect(refreshForeign).not.toHaveBeenCalled();
        expect(isInvalidated(queryClient, affected)).toBe(true);
        expect(isInvalidated(queryClient, unrelated)).toBe(false);
        expect(isInvalidated(queryClient, foreign)).toBe(false);
        expect(isInvalidated(queryClient, affectedList)).toBe(true);
        expect(isInvalidated(queryClient, unrelatedList)).toBe(false);
      } finally {
        unsubscribe.forEach((stop) => stop());
      }
    },
  );

  describe("handleConversationUpdated invalidation ownership", () => {
    it("invalidates project-ready lists after remote future approval while isolating other projects", () => {
      const ready = [...proposalKeys.lists(ORG, PROJECT), "ready-futures", 1];
      const other = [
        ...proposalKeys.lists(ORG, "other-project"),
        "ready-futures",
        1,
      ];
      queryClient.setQueryData(ready, { items: [] });
      queryClient.setQueryData(other, { items: [] });
      handler.handleEvent({
        type: "proposal.approved",
        timestamp: "2026-10-01T00:00:00Z",
        organizationId: ORG,
        projectId: PROJECT,
        proposalId: "proposal",
        targetEntityId: "target",
        targetEntityType: "TASK",
        action: "VERSIONED_UPDATE",
      });
      expect(isInvalidated(queryClient, ready)).toBe(true);
      expect(isInvalidated(queryClient, other)).toBe(false);
    });
  });

  describe("Debugging and logging", () => {
    it("should log collection actions with proper metadata", () => {
      const event: WebSocketConversationStatusChangedEvent = {
        type: "conversation.status_changed",
        conversationId: "conv-debug-test",
        organizationId: "org-123",
        timestamp: "2024-01-01T00:00:00Z",
        previousStatus: "ACTIVE",
        newStatus: "COMPLETED",
      };

      handler.handleEvent(event);

      // Should log the collection action
      expect(logQueryInvalidationSpy).toHaveBeenCalledWith(
        "conversations",
        "item:conv-debug-test",
        expect.objectContaining({
          eventType: "conversation.status_changed",
          reason:
            "Conversation status changed, marking cached envelope queries stale",
          conversationId: "conv-debug-test",
          timestamp: "2024-01-01T00:00:00Z",
        }),
      );
    });

    it("should log main event processing", () => {
      const event: WebSocketConversationStatusChangedEvent = {
        type: "conversation.status_changed",
        conversationId: "conv-log-test",
        organizationId: "org-123",
        timestamp: "2024-01-01T00:00:00Z",
        previousStatus: "ACTIVE",
        newStatus: "COMPLETED",
      };

      handler.handleEvent(event);

      // Should log the initial event
      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "conversation.status_changed",
          source: "websocket-handler",
          data: event,
        }),
      );

      // Should log successful processing
      expect(logEventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "conversation.status_changed",
          source: "websocket-handler-success",
        }),
      );
    });
  });
});

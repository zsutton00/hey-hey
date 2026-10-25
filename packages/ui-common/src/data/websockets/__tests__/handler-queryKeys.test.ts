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
import { proposalKeys } from "../../collections/proposals";
import { conversationKeys } from "../../collections/conversations";
import type {
  ConversationResponseDto,
  WebSocketConversationUpdatedEvent,
  WebSocketConversationStatusChangedEvent,
  WebSocketConversationCreatedEvent,
} from "../../../api";

const ORG = "org-123";
const PROJECT = "project-456";

const conversation = (id: string) => ({ id }) as ConversationResponseDto;

/** Seeds envelopes (both variants) and lists for the given conversations. */
function seedConversations(queryClient: QueryClient, ids: string[]) {
  const keys: Record<string, QueryKey[]> = {};
  for (const id of ids) {
    const base = conversationKeys.envelope(ORG, PROJECT, id);
    const variant = conversationKeys.envelope(ORG, PROJECT, id, true);
    queryClient.setQueryData(base, conversation(id));
    queryClient.setQueryData(variant, conversation(id));
    keys[id] = [base, variant];
  }
  return keys;
}

const isInvalidated = (queryClient: QueryClient, key: QueryKey) =>
  queryClient.getQueryState(key)?.isInvalidated ?? false;

const invalidatedKeys = (queryClient: QueryClient) =>
  queryClient
    .getQueryCache()
    .getAll()
    .filter((query) => query.state.isInvalidated)
    .map((query) => query.queryKey);

describe("WebSocket handler with queryKeys", () => {
  let store: ReturnType<typeof createStore>;
  let handler: WebSocketHandler;
  let queryClient: QueryClient;
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
    handler = new WebSocketHandler(store, mockDebugger, queryClient);

    // Clear mock calls
    logEventSpy.mockClear();
    logQueryInvalidationSpy.mockClear();
  });

  afterEach(() => {
    queryClient.clear();
  });

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

    it("does not invalidate conversation envelope variants for conversation.updated", () => {
      const event: WebSocketConversationUpdatedEvent = {
        type: "conversation.updated",
        conversationId: "conv-123",
        projectId: "project-456",
        organizationId: "org-789",
        timestamp: "2024-01-01T00:00:00Z",
        changedFields: ["messages"],
        totalFieldsChanged: 1,
      };
      queryClient.setQueryData(
        conversationKeys.envelope("org-789", "project-456", "conv-123"),
        conversation("conv-123"),
      );
      queryClient.setQueryData(
        conversationKeys.envelope("org-789", "project-456", "conv-123", true),
        conversation("conv-123"),
      );
      queryClient.setQueryData(
        conversationKeys.list("org-789", "project-456", {}),
        [conversation("conv-123")],
      );

      handler.handleEvent(event);

      expect(invalidatedKeys(queryClient)).toEqual([]);
    });

    it("invalidates the conversation's envelopes and containing lists for conversation.status_changed", () => {
      const event: WebSocketConversationStatusChangedEvent = {
        type: "conversation.status_changed",
        conversationId: "conv-456",
        projectId: PROJECT,
        organizationId: ORG,
        timestamp: "2024-01-01T00:00:00Z",
        previousStatus: "ACTIVE",
        newStatus: "COMPLETED",
      };
      const keys = seedConversations(queryClient, ["conv-456", "conv-other"]);
      const containingList = conversationKeys.list(ORG, PROJECT, {});
      const unrelatedList = conversationKeys.list(ORG, PROJECT, {
        search: "x",
      });
      queryClient.setQueryData(containingList, [
        conversation("conv-456"),
        conversation("conv-other"),
      ]);
      queryClient.setQueryData(unrelatedList, [conversation("conv-other")]);

      handler.handleEvent(event);

      expect(invalidatedKeys(queryClient)).toHaveLength(3);
      for (const key of keys["conv-456"]) {
        expect(isInvalidated(queryClient, key)).toBe(true);
      }
      expect(isInvalidated(queryClient, containingList)).toBe(true);
      for (const key of keys["conv-other"]) {
        expect(isInvalidated(queryClient, key)).toBe(false);
      }
      expect(isInvalidated(queryClient, unrelatedList)).toBe(false);
    });

    it("does not fall back to broad envelope invalidation without message scope", () => {
      const event: WebSocketConversationUpdatedEvent = {
        type: "conversation.updated",
        conversationId: "conv-789",
        organizationId: "org-123",
        timestamp: "2024-01-01T00:00:00Z",
        // No projectId provided
        changedFields: ["title"],
        totalFieldsChanged: 1,
      };
      seedConversations(queryClient, ["conv-789"]);

      handler.handleEvent(event);

      expect(invalidatedKeys(queryClient)).toEqual([]);
    });

    it("should handle missing conversationId gracefully", () => {
      const event: WebSocketConversationStatusChangedEvent = {
        type: "conversation.status_changed",
        conversationId: "", // Empty conversationId
        projectId: "project-456",
        organizationId: "org-789",
        timestamp: "2024-01-01T00:00:00Z",
        changedFields: ["title"],
        totalFieldsChanged: 1,
      };

      seedConversations(queryClient, ["conv-a"]);
      queryClient.setQueryData(conversationKeys.list(ORG, PROJECT, {}), [
        conversation("conv-a"),
      ]);

      handler.handleEvent(event);

      expect(invalidatedKeys(queryClient)).toEqual([]);
    });
  });

  describe("handleConversationCreated", () => {
    it("invalidates every conversation list in the project on conversation creation", () => {
      const event: WebSocketConversationCreatedEvent = {
        type: "conversation.created",
        conversationId: "conv-new-123",
        projectId: PROJECT,
        organizationId: ORG,
        timestamp: "2024-01-01T00:00:00Z",
      };
      const keys = seedConversations(queryClient, ["conv-existing"]);
      const list = conversationKeys.list(ORG, PROJECT, {});
      const emptyFilteredList = conversationKeys.list(ORG, PROJECT, {
        workflowName: "ONBOARDING",
      });
      const workflowList = conversationKeys.workflowList(ORG, PROJECT, {
        workflowName: "ONBOARDING",
        workflowAboutId: "about-1",
      });
      const otherProjectList = conversationKeys.list(ORG, "project-other", {});
      queryClient.setQueryData(list, [conversation("conv-existing")]);
      queryClient.setQueryData(emptyFilteredList, []);
      queryClient.setQueryData(workflowList, []);
      queryClient.setQueryData(otherProjectList, []);

      handler.handleEvent(event);

      expect(isInvalidated(queryClient, list)).toBe(true);
      expect(isInvalidated(queryClient, emptyFilteredList)).toBe(true);
      expect(isInvalidated(queryClient, workflowList)).toBe(true);
      expect(isInvalidated(queryClient, otherProjectList)).toBe(false);
      for (const key of keys["conv-existing"]) {
        expect(isInvalidated(queryClient, key)).toBe(false);
      }
    });

    it("should handle missing projectId in conversation creation", () => {
      const event: WebSocketConversationCreatedEvent = {
        type: "conversation.created",
        conversationId: "conv-new-456",
        organizationId: "org-789",
        timestamp: "2024-01-01T00:00:00Z",
        // No projectId
      };
      queryClient.setQueryData(conversationKeys.list(ORG, PROJECT, {}), []);

      handler.handleEvent(event);

      expect(invalidatedKeys(queryClient)).toEqual([]);
    });
  });

  describe("Integration scenarios", () => {
    it("should solve the original invalidation problem", () => {
      // This test simulates the exact scenario that was failing before:
      // - useConversations hook uses query: "conversations:org:project:onboarding:"
      // - WebSocket event only knows the conversationId
      // - Old system couldn't match "conversations:org:project" with "conversations:org:project:onboarding:"
      // - New system invalidates by itemId, automatically affecting all queries

      const event: WebSocketConversationStatusChangedEvent = {
        type: "conversation.status_changed",
        conversationId: "conv-onboarding-123", // This is all WebSocket knows
        projectId: PROJECT,
        organizationId: ORG,
        timestamp: "2024-01-01T00:00:00Z",
        previousStatus: "ACTIVE",
        newStatus: "COMPLETED",
      };

      const keys = seedConversations(queryClient, ["conv-onboarding-123"]);
      const onboardingList = conversationKeys.list(ORG, PROJECT, {
        workflowName: "ONBOARDING",
      });
      const allList = conversationKeys.list(ORG, PROJECT, {});
      const workflowList = conversationKeys.workflowList(ORG, PROJECT, {
        workflowName: "ONBOARDING",
        workflowAboutId: "about-1",
      });
      for (const key of [onboardingList, allList, workflowList]) {
        queryClient.setQueryData(key, [conversation("conv-onboarding-123")]);
      }

      handler.handleEvent(event);

      // Regardless of which filters the lists were read with, every list
      // holding the conversation and every envelope variant is invalidated.
      for (const key of [
        ...keys["conv-onboarding-123"],
        onboardingList,
        allList,
        workflowList,
      ]) {
        expect(isInvalidated(queryClient, key)).toBe(true);
      }
    });

    it("should work with multiple conversation events", () => {
      const events = [
        {
          type: "conversation.updated" as const,
          conversationId: "conv-1",
          organizationId: "org-123",
          timestamp: "2024-01-01T00:00:00Z",
          changedFields: ["title"],
          totalFieldsChanged: 1,
        },
        {
          type: "conversation.status_changed" as const,
          conversationId: "conv-2",
          organizationId: "org-123",
          timestamp: "2024-01-01T00:00:01Z",
          previousStatus: "ACTIVE",
          newStatus: "COMPLETED",
        },
        {
          type: "conversation.updated" as const,
          conversationId: "conv-1", // Same conversation as first event
          organizationId: "org-123",
          timestamp: "2024-01-01T00:00:02Z",
          changedFields: ["description"],
          totalFieldsChanged: 1,
        },
      ];

      const keys = seedConversations(queryClient, ["conv-1", "conv-2"]);

      events.forEach((event) => handler.handleEvent(event));

      // Only the explicit status event invalidates conversation envelopes.
      expect(invalidatedKeys(queryClient)).toHaveLength(2);
      for (const key of keys["conv-2"]) {
        expect(isInvalidated(queryClient, key)).toBe(true);
      }
      for (const key of keys["conv-1"]) {
        expect(isInvalidated(queryClient, key)).toBe(false);
      }
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

  describe("Architecture benefits verification", () => {
    it("should demonstrate elimination of query pattern guessing", () => {
      // Before: WebSocket handler had to guess query patterns
      // const singleQueryKey = `conversation:${orgId}:${projectId}:${conversationId}`;
      // const listQueryKey = `conversations:${orgId}:${projectId}`;
      // But what about: `conversations:${orgId}:${projectId}:${category}:${search}`?

      const event: WebSocketConversationStatusChangedEvent = {
        type: "conversation.status_changed",
        conversationId: "conv-no-guessing",
        // Even without organizationId or projectId, we can still invalidate!
        timestamp: "2024-01-01T00:00:00Z",
        previousStatus: "ACTIVE",
        newStatus: "COMPLETED",
      };

      const keys = seedConversations(queryClient, ["conv-no-guessing"]);
      const filteredList = conversationKeys.list(ORG, PROJECT, {
        search: "anything",
        statuses: ["ACTIVE"] as never,
      });
      queryClient.setQueryData(filteredList, [
        conversation("conv-no-guessing"),
      ]);

      handler.handleEvent(event);

      // After: invalidate by conversation id across the whole cache
      for (const key of [...keys["conv-no-guessing"], filteredList]) {
        expect(isInvalidated(queryClient, key)).toBe(true);
      }

      // No need to know:
      // - What query patterns exist
      // - What parameters were used in queries
      // - Whether it's a single query or list query
      // - What category/search filters were applied
      // The collection automatically finds all affected queries!
    });

    it("should show simplified handler logic", () => {
      // Measure the simplicity: only conversationId needed, single action dispatched
      const event: WebSocketConversationStatusChangedEvent = {
        type: "conversation.status_changed",
        conversationId: "conv-simple",
        organizationId: "org-123",
        timestamp: "2024-01-01T00:00:00Z",
        previousStatus: "ACTIVE",
        newStatus: "COMPLETED",
      };

      const keys = seedConversations(queryClient, ["conv-simple", "conv-x"]);

      handler.handleEvent(event);

      // Precise: only conv-simple's envelopes
      expect(invalidatedKeys(queryClient)).toEqual(
        expect.arrayContaining(keys["conv-simple"]),
      );
      expect(invalidatedKeys(queryClient)).toHaveLength(2);
    });
  });
});

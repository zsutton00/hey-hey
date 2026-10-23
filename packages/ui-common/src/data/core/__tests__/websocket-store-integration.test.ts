import { createStore } from "jotai";
import { QueryClient } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WebSocketHandler } from "../../websockets/handler";
import { WebSocketDebugger } from "../../websockets/debug";
import { conversationKeys } from "../../collections/conversations";
import { messageKeys } from "../../collections/messages";
import type { ConversationResponseDto } from "../../types";
import { logger } from "../../../utils/logger";

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

const isInvalidated = (
  queryClient: QueryClient,
  queryKey: readonly unknown[]
) => queryClient.getQueryState(queryKey)?.isInvalidated ?? false;

const createConversation = (
  id: string,
  projectId: string,
  organizationId = "org-789"
): ConversationResponseDto => ({
  id,
  projectId,
  organizationId,
  workflowId: "workflow-001",
  initiatedBy: "SYSTEM",
  triggerEvent: "test_event",
  status: "IN_PROGRESS",
  title: `Test Conversation ${id}`,
  version: 1,
  category: "test",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/** Seeds what useConversations + useConversation leave in the cache. */
function seedConversation(
  queryClient: QueryClient,
  conversation: ConversationResponseDto
) {
  const listKey = conversationKeys.list(
    conversation.organizationId,
    conversation.projectId,
    {}
  );
  const singleKey = conversationKeys.envelope(
    conversation.organizationId,
    conversation.projectId,
    conversation.id
  );
  queryClient.setQueryData<ConversationResponseDto[]>(listKey, (current) => [
    ...(current ?? []),
    conversation,
  ]);
  queryClient.setQueryData(singleKey, conversation);
  return { listKey, singleKey };
}

describe("WebSocket Store Integration", () => {
  let mockDebugger: WebSocketDebugger;

  beforeEach(() => {
    mockDebugger = new WebSocketDebugger();
    vi.spyOn(mockDebugger, "logEvent").mockImplementation(() => {});
    vi.spyOn(mockDebugger, "logCollectionAction").mockImplementation(
      () => {}
    );
  });

  it("should successfully mark conversation stale with a shared QueryClient", () => {
    const sharedQueryClient = createQueryClient();
    const { listKey, singleKey } = seedConversation(
      sharedQueryClient,
      createConversation("conv-123", "proj-456")
    );

    const wsHandler = new WebSocketHandler(
      createStore(),
      mockDebugger,
      sharedQueryClient
    );
    const loggerSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    wsHandler.handleEvent({
      type: "conversation.status_changed",
      conversationId: "conv-123",
      organizationId: "org-789",
      projectId: "proj-456",
      timestamp: new Date().toISOString(),
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    } as any);

    expect(loggerSpy).not.toHaveBeenCalled();
    expect(isInvalidated(sharedQueryClient, listKey)).toBe(true);
    expect(isInvalidated(sharedQueryClient, singleKey)).toBe(true);
    // Invalidation keeps the cached data readable.
    expect(sharedQueryClient.getQueryData(singleKey)).toMatchObject({
      id: "conv-123",
    });

    loggerSpy.mockRestore();
  });

  it("does not reach queries held by a different QueryClient (for comparison)", () => {
    const reactQueryClient = createQueryClient();
    const handlerQueryClient = createQueryClient();
    const { listKey, singleKey } = seedConversation(
      reactQueryClient,
      createConversation("conv-123", "proj-456")
    );

    const wsHandler = new WebSocketHandler(
      createStore(),
      mockDebugger,
      handlerQueryClient
    );

    wsHandler.handleEvent({
      type: "conversation.status_changed",
      conversationId: "conv-123",
      organizationId: "org-789",
      projectId: "proj-456",
      timestamp: new Date().toISOString(),
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    } as any);

    expect(isInvalidated(reactQueryClient, listKey)).toBe(false);
    expect(isInvalidated(reactQueryClient, singleKey)).toBe(false);
    expect(handlerQueryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it("warns instead of silently dropping conversation invalidation without a QueryClient", () => {
    const wsHandler = new WebSocketHandler(createStore(), mockDebugger);
    const loggerSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    for (const id of ["conv-1", "conv-2", "conv-3"]) {
      wsHandler.handleEvent({
        type: "conversation.status_changed",
        conversationId: id,
        organizationId: "org-789",
        projectId: "proj-1",
        timestamp: new Date().toISOString(),
        previousStatus: "ACTIVE",
        newStatus: "COMPLETED",
      } as any);
    }

    for (const id of ["conv-1", "conv-2", "conv-3"]) {
      expect(loggerSpy).toHaveBeenCalledWith(
        "data_websockets",
        expect.stringContaining("No QueryClient"),
        { conversationId: id }
      );
    }

    loggerSpy.mockRestore();
  });

  it("invalidates only the shared client's matching conversations across projects", () => {
    const sharedQueryClient = createQueryClient();
    const seeded = [
      createConversation("conv-1", "proj-1"),
      createConversation("conv-2", "proj-1"),
      createConversation("conv-3", "proj-2"),
    ].map((conversation) => ({
      id: conversation.id,
      ...seedConversation(sharedQueryClient, conversation),
    }));
    const wsHandler = new WebSocketHandler(
      createStore(),
      mockDebugger,
      sharedQueryClient
    );

    wsHandler.handleEvent({
      type: "conversation.status_changed",
      conversationId: "conv-3",
      organizationId: "org-789",
      projectId: "proj-2",
      timestamp: new Date().toISOString(),
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    } as any);

    const [conv1, conv2, conv3] = seeded;
    expect(isInvalidated(sharedQueryClient, conv3.listKey)).toBe(true);
    expect(isInvalidated(sharedQueryClient, conv3.singleKey)).toBe(true);
    // conv-1 and conv-2 share the proj-1 list, which does not hold conv-3.
    expect(isInvalidated(sharedQueryClient, conv1.listKey)).toBe(false);
    expect(isInvalidated(sharedQueryClient, conv1.singleKey)).toBe(false);
    expect(isInvalidated(sharedQueryClient, conv2.singleKey)).toBe(false);
  });

  it("routes conversation.updated to the handler's own client only", () => {
    const reactQueryClient = createQueryClient();
    const handlerQueryClient = createQueryClient();
    const messagesKey = messageKeys.list("test-org", "test-proj", "test-conv");
    reactQueryClient.setQueryData(messagesKey, []);
    handlerQueryClient.setQueryData(messagesKey, []);

    const wsHandler = new WebSocketHandler(
      createStore(),
      mockDebugger,
      handlerQueryClient
    );

    wsHandler.handleEvent({
      type: "conversation.updated",
      conversationId: "test-conv",
      organizationId: "test-org",
      projectId: "test-proj",
      timestamp: new Date().toISOString(),
      changedFields: ["status"],
    } as any);

    expect(isInvalidated(handlerQueryClient, messagesKey)).toBe(true);
    expect(isInvalidated(reactQueryClient, messagesKey)).toBe(false);
  });
});

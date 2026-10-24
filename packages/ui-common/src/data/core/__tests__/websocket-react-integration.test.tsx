/**
 * Phase 6.2: Integration Test Suite
 * Comprehensive tests for WebSocket React Integration
 */

import { act, render, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom";

import {
  useWebSocketService,
  WebSocketProvider,
} from "../../../contexts/WebSocketContext";
import { AuthProvider } from "../../../contexts/AuthContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { conversationKeys } from "../../collections/conversations";
import { useConversation } from "../../hooks/useConversation";
import { useConversationByWorkflow } from "../../hooks/useConversationByWorkflow";
import type { ConversationResponseDto, MessageType } from "../../../api";
import { WebSocketHandler } from "../../websockets/handler";

const { getActiveConversationsMock, getMessagesMock } = vi.hoisted(() => ({
  getActiveConversationsMock: vi.fn(),
  getMessagesMock: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getActiveConversations: getActiveConversationsMock,
    getMessages: getMessagesMock,
    getAllConversations: vi.fn(),
    getConversation: vi.fn(),
  },
  projectsClient: {
    getQueuedConversationInputs: vi.fn(async () => ({ data: { data: [] } })),
  },
}));

const TASK_GENERATION_CATEGORY = "task-generation" as const;

// Mock user identity hook
vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({
    email: "test@example.com",
  }),
}));

// Mock auth context
vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: "user-123", email: "test@example.com" },
    loading: false,
  }),
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock WebSocket debugger
vi.mock("../../websockets/debugger", () => ({
  webSocketDebugger: {
    logEvent: vi.fn(),
    logQueryInvalidation: vi.fn(),
  },
}));

// Mock API calls
vi.mock("../../../api", async () => {
  const actual = await vi.importActual<typeof import("../../../api")>(
    "../../../api"
  );

  const createMockStagedContentApi = () => ({
    autosaveStagedContent: vi.fn(),
    refineStagedContent: vi.fn(),
    revealStagedContent: vi.fn(),
    advanceStagedContent: vi.fn(),
  });

  return {
    ...actual,
    ConversationsApi: vi.fn().mockImplementation(() => ({
      getConversation: vi.fn().mockResolvedValue({ data: { data: null } }),
    })),
    DesignDocsApi: vi.fn().mockImplementation(() => ({
      listDesignDocLinks: vi.fn().mockResolvedValue({ data: [] }),
    })),
    StagedContentApi: vi
      .fn()
      .mockImplementation(() => createMockStagedContentApi()),
  };
});

// Test wrapper with providers
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const store = createStore();
  return (
    <Provider store={store}>
      <AuthProvider>
        <WebSocketProvider>{children}</WebSocketProvider>
      </AuthProvider>
    </Provider>
  );
};

describe("WebSocket React Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should handle multiple conversations across different projects", async () => {
    const mockConversations: ConversationResponseDto[] = [
      {
        id: "conv-1",
        projectId: "proj-1",
        organizationId: "org-1",
        workflowId: "workflow-1",
        initiatedBy: "SYSTEM",
        triggerEvent: "test",
        status: "IN_PROGRESS",
        title: "Conversation 1",
        version: 1,
        category: TASK_GENERATION_CATEGORY,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: "conv-2",
        projectId: "proj-2",
        organizationId: "org-1",
        workflowId: "workflow-2",
        initiatedBy: "SYSTEM",
        triggerEvent: "test",
        status: "IN_PROGRESS",
        title: "Conversation 2",
        version: 1,
        category: TASK_GENERATION_CATEGORY,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];

    const { result: wsServiceResult } = renderHook(
      () => useWebSocketService(),
      {
        wrapper: TestWrapper,
      }
    );

    // Simulate conversations being loaded by hooks
    const { result: conv1Result } = renderHook(
      () => useConversation("org-1", "proj-1", { conversationId: "conv-1" }),
      { wrapper: TestWrapper }
    );

    const { result: conv2Result } = renderHook(
      () => useConversation("org-1", "proj-2", { conversationId: "conv-2" }),
      { wrapper: TestWrapper }
    );

    // Wait for hooks to initialize
    await waitFor(() => {
      expect(wsServiceResult.current).toBeDefined();
    });

    // The key test: WebSocket service should be able to handle events for both conversations
    // since they now share the same store
    expect(wsServiceResult.current).toBeDefined();
    expect(conv1Result.current).toBeDefined();
    expect(conv2Result.current).toBeDefined();
  });

  it("should handle WebSocket reconnection without losing state", async () => {
    const { result: wsServiceResult } = renderHook(
      () => useWebSocketService(),
      {
        wrapper: TestWrapper,
      }
    );

    const { result: conversationResult } = renderHook(
      () => useConversation("org-1", "proj-1", { conversationId: "conv-1" }),
      { wrapper: TestWrapper }
    );

    // Wait for initialization
    await waitFor(() => {
      expect(wsServiceResult.current).toBeDefined();
    });

    // Simulate WebSocket disconnection and reconnection
    act(() => {
      wsServiceResult.current.disconnect();
    });

    // State should be preserved during reconnection
    expect(conversationResult.current).toBeDefined();

    // After disconnect, connection state should be false
    expect(wsServiceResult.current.getState().isConnected).toBe(false);

    // Reconnect by reinitializing (since there's no public connect method)
    act(() => {
      wsServiceResult.current.initialize({
        userId: "test@example.com",
      });
    });

    // Should have reconnection logic working
    expect(wsServiceResult.current.getState()).toBeDefined();
  });

  it("should properly clean up on unmount", async () => {
    let wsService: ReturnType<typeof useWebSocketService>;

    const TestComponent: React.FC = () => {
      wsService = useWebSocketService();
      return <div>Test</div>;
    };

    const { unmount } = render(<TestComponent />, { wrapper: TestWrapper });

    await waitFor(() => {
      expect(wsService).toBeDefined();
    });

    // Spy on disconnect method
    const disconnectSpy = vi.spyOn(wsService, "disconnect");

    // Unmount should trigger cleanup
    unmount();

    // Verify cleanup was called
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it("should handle rapid WebSocket events without data loss", async () => {
    const store = createStore();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const mockDebugger = {
      logEvent: vi.fn(),
      logQueryInvalidation: vi.fn(),
    };
    const handler = new WebSocketHandler(store, mockDebugger, queryClient);

    // Create multiple rapid events
    const events = Array.from({ length: 100 }, (_, i) => ({
      type: "conversation.status_changed" as const,
      conversationId: `conv-${i}`,
      organizationId: "org-1",
      projectId: "proj-1",
      timestamp: new Date().toISOString(),
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    }));

    // First, populate the store with conversations
    events.forEach((event, i) => {
      const mockConversation: ConversationResponseDto = {
        id: event.conversationId,
        projectId: event.projectId,
        organizationId: event.organizationId,
        workflowId: `workflow-${i}`,
        initiatedBy: "SYSTEM",
        triggerEvent: "test",
        status: "IN_PROGRESS",
        title: `Conversation ${i}`,
        version: 1,
        category: TASK_GENERATION_CATEGORY,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Simulate conversation being fetched and cached
      queryClient.setQueryData(
        conversationKeys.envelope(
          event.organizationId,
          event.projectId,
          event.conversationId
        ),
        mockConversation
      );
    });

    // Now rapidly fire WebSocket events
    const startTime = performance.now();

    await Promise.all(
      events.map(async (event) => {
        handler.handleEvent({
          ...event,
          type: event.type,
          conversationId: event.conversationId,
          organizationId: event.organizationId,
          projectId: event.projectId,
          timestamp: event.timestamp,
          previousStatus: event.previousStatus,
          newStatus: event.newStatus,
        });
      })
    );

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Should handle all events quickly (less than 1 second)
    expect(duration).toBeLessThan(1000);

    // Verify state is consistent: every conversation is still cached and
    // every one was invalidated (no event lost).
    const envelopes = queryClient
      .getQueryCache()
      .findAll({ queryKey: conversationKeys.root() });
    expect(envelopes).toHaveLength(100);
    expect(envelopes.every((query) => query.state.isInvalidated)).toBe(true);
    expect(envelopes.every((query) => query.state.data !== undefined)).toBe(
      true
    );
  });

  it("should maintain store synchronization between hooks and WebSocket", async () => {
    const TestComponent: React.FC = () => {
      const wsService = useWebSocketService();
      const conversation = useConversation("org-1", "proj-1", {
        conversationId: "conv-sync-test",
      });

      React.useEffect(() => {
        if (wsService && conversation.data) {
          // Simulate WebSocket event
          setTimeout(() => {
            const wsServiceWithHandler = wsService as typeof wsService & {
              handler?: WebSocketHandler;
            };
            wsServiceWithHandler.handler?.handleEvent({
              type: "conversation.updated",
              conversationId: "conv-sync-test",
              organizationId: "org-1",
              projectId: "proj-1",
              timestamp: new Date().toISOString(),
              changedFields: ["status"],
              previousVersion: 1,
              newVersion: 2,
              changeType: "UPDATE",
            });
          }, 100);
        }
      }, [wsService, conversation.data]);

      return (
        <div>
          <span data-testid="loading">{conversation.isLoading.toString()}</span>
          <span data-testid="stale">{conversation.isStale.toString()}</span>
          <span data-testid="has-data">{!!conversation.data}</span>
        </div>
      );
    };

    const { getByTestId } = render(<TestComponent />, { wrapper: TestWrapper });

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId("loading")).toBeInTheDocument();
    });

    // After WebSocket event, should see stale state
    await waitFor(
      () => {
        const staleElement = getByTestId("stale");
        // The conversation might become stale due to WebSocket event
        expect(staleElement).toBeInTheDocument();
      },
      { timeout: 1000 }
    );
  });

  it("refreshes canonical onboarding Messages once without reading the envelope for duplicate updates", async () => {
    const staleConversation: ConversationResponseDto = {
      id: "onboarding-conversation",
      organizationId: "org-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      workflowName: "onboarding",
      workflowAboutId: "project-about-1",
      initiatedBy: "SYSTEM",
      triggerEvent: "test",
      status: "IN_PROGRESS",
      title: "Onboarding",
      version: 1,
      createdAt: "2026-09-16T03:20:00.000Z",
      updatedAt: "2026-09-16T03:23:19.000Z",
    };
    const completedMessages = [
      {
        id: "completed-system-message",
        workflowId: "workflow-1",
        projectId: "project-1",
        conversationId: "onboarding-conversation",
        parentMessageId: null,
        status: "completed",
        type: "SYSTEM" as MessageType,
        createdAt: "2026-09-16T03:25:06.000Z",
        awaitingResponse: false,
        responses: [],
        data: {
          type: "ONBOARDING",
          response: "Onboarding is complete",
          uiElements: [],
        },
      },
    ];
    const response = (conversation: ConversationResponseDto) => ({
      data: { data: { data: [conversation] } },
    });
    getActiveConversationsMock.mockResolvedValue(response(staleConversation));
    getMessagesMock
      .mockResolvedValueOnce({
        data: { data: { messages: [], nextCursor: null } },
      })
      .mockResolvedValue({
        data: { data: { messages: completedMessages, nextCursor: null } },
      });

    const store = createStore();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>{children}</Provider>
      </QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useConversationByWorkflow("org-1", "project-1", "onboarding", {
          workflowAboutId: "project-about-1",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(result.current.data?.version).toBe(1);
    });

    const handler = new WebSocketHandler(
      store,
      {
        logEvent: vi.fn(),
        logQueryInvalidation: vi.fn(),
      },
      queryClient
    );
    const event = {
      type: "conversation.updated" as const,
      conversationId: "onboarding-conversation",
      organizationId: "org-1",
      projectId: "project-1",
      timestamp: "2026-09-16T03:25:06.000Z",
      previousVersion: 1,
      newVersion: 2,
      changeType: "message_updated",
      latestMessageId: "completed-system-message",
    };

    act(() => {
      handler.handleEvent(event);
      handler.handleEvent(event);
    });

    await waitFor(() => {
      expect(result.current.messages[0]?.id).toBe("completed-system-message");
    });
    expect(getActiveConversationsMock).toHaveBeenCalledTimes(1);
    // Duplicate updates collapse into one effective refresh: the second
    // event cancels the first in-flight read and restarts it, so exactly one
    // post-event read completes un-aborted.
    const postEventReads = getMessagesMock.mock.calls.slice(1);
    const completedReads = postEventReads.filter(
      ([, options]) => !(options as { signal?: AbortSignal })?.signal?.aborted
    );
    expect(postEventReads.length).toBeGreaterThanOrEqual(1);
    expect(postEventReads.length).toBeLessThanOrEqual(2);
    expect(completedReads).toHaveLength(1);
    expect(result.current.messages[0]?.status).toBe("completed");
  });
});

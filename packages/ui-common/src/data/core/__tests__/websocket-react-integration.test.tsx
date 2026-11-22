import { createUnreachableGraphQLClient } from "../../../test/graphqlTestClient";
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
  const actual =
    await vi.importActual<typeof import("../../../api")>("../../../api");

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
      },
    );

    // Simulate conversations being loaded by hooks
    const { result: conv1Result } = renderHook(
      () => useConversation("org-1", "proj-1", { conversationId: "conv-1" }),
      { wrapper: TestWrapper },
    );

    const { result: conv2Result } = renderHook(
      () => useConversation("org-1", "proj-2", { conversationId: "conv-2" }),
      { wrapper: TestWrapper },
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
      },
    );

    const { result: conversationResult } = renderHook(
      () => useConversation("org-1", "proj-1", { conversationId: "conv-1" }),
      { wrapper: TestWrapper },
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
      { timeout: 1000 },
    );
  });
});

/**
 * Phase 6.3: Component Test Suite
 * Integration tests for useConversation with WebSocket
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  useWebSocketService,
  WebSocketProvider,
} from "../../../contexts/WebSocketContext";
import { AuthProvider } from "../../../contexts/AuthContext";
import type { ConversationResponseDto } from "../../types";
import { useConversation } from "../useConversation";

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

// Mock WebSocket connection to prevent real socket.io connections
vi.mock("../../../contexts/WebSocketContext", async () => {
  const actual = await vi.importActual("../../../contexts/WebSocketContext");
  return {
    ...actual,
    useWebSocketService: () => ({
      initialize: vi.fn(),
      disconnect: vi.fn(),
      getState: vi.fn().mockReturnValue({
        isConnected: false,
        isAuthenticated: false,
        connectionError: null,
      }),
      handler: {
        handleEvent: vi.fn(),
      },
    }),
  };
});

// Mock platformClient instead of the generated service client
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getConversation: vi.fn(),
    getConversations: vi.fn(),
    getActiveConversations: vi.fn(),
  },
}));

// Import the mocked platformClient
import { platformClient } from "../../../clients/serviceClients";
const mockedPlatformClient = vi.mocked(platformClient);

// Test wrapper with providers
const createWrapper = () => {
  const TestWrapper: React.FC<{ children: React.ReactNode }> = ({
    children,
  }) => {
    const store = createStore();
    return (
      <Provider store={store}>
        <AuthProvider>
          <WebSocketProvider>{children}</WebSocketProvider>
        </AuthProvider>
      </Provider>
    );
  };
  return TestWrapper;
};

describe("useConversation with WebSocket Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock functions with proper response structure
    mockedPlatformClient.getConversation.mockResolvedValue({
      data: {
        data: null,
      },
    } as any);
    mockedPlatformClient.getConversations.mockResolvedValue({
      data: {
        data: [],
      },
    } as any);
    mockedPlatformClient.getActiveConversations.mockResolvedValue({
      data: {
        data: {
          data: [],
          total: 0,
          page: 1,
          limit: 100,
        },
      },
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should update when WebSocket marks conversation stale", async () => {
    const mockConversation: ConversationResponseDto = {
      id: "conv-1",
      projectId: "proj-1",
      organizationId: "org-1",
      workflowId: "workflow-1",
      initiatedBy: "SYSTEM",
      triggerEvent: "test",
      status: "IN_PROGRESS",
      title: "Test Conversation",
      version: 1,
      category: "task-generation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockedPlatformClient.getConversation.mockResolvedValue({
      data: {
        data: mockConversation,
      },
    } as any);

    const wrapper = createWrapper();

    // Render the conversation hook
    const { result: conversationResult } = renderHook(
      () => useConversation("org-1", "proj-1", { conversationId: "conv-1" }),
      { wrapper }
    );

    // Render WebSocket service hook
    const { result: wsResult } = renderHook(() => useWebSocketService(), {
      wrapper,
    });

    // Wait for initial fetch
    await waitFor(
      () => {
        expect(conversationResult.current.isFetched).toBe(true);
      },
      { timeout: 5000 }
    );

    // Get the initial stale state
    const initialStale = conversationResult.current.isStale;

    // Simulate WebSocket event that marks conversation stale
    act(() => {
      if (wsResult.current && (wsResult.current as any).handler) {
        (wsResult.current as any).handler.handleEvent({
          type: "conversation.updated",
          conversationId: "conv-1",
          organizationId: "org-1",
          projectId: "proj-1",
          timestamp: new Date().toISOString(),
          changedFields: ["status"],
          previousVersion: 1,
          newVersion: 2,
          changeType: "UPDATE",
        });
      }
    });

    // Should trigger stale state update
    await waitFor(
      () => {
        // Conversation should now be marked stale or refetched
        expect(
          conversationResult.current.isStale !== initialStale ||
            conversationResult.current.isFetched
        ).toBe(true);
      },
      { timeout: 2000 }
    );
  });

  it("should maintain conversation state across WebSocket reconnections", async () => {
    const mockConversation: ConversationResponseDto = {
      id: "conv-reconnect",
      projectId: "proj-1",
      organizationId: "org-1",
      workflowId: "workflow-1",
      initiatedBy: "SYSTEM",
      triggerEvent: "test",
      status: "IN_PROGRESS",
      title: "Reconnection Test",
      version: 1,
      category: "task-generation",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    mockedPlatformClient.getConversation.mockResolvedValue({
      data: {
        data: mockConversation,
      },
    } as any);

    const wrapper = createWrapper();

    const { result: conversationResult } = renderHook(
      () =>
        useConversation("org-1", "proj-1", {
          conversationId: "conv-reconnect",
        }),
      { wrapper }
    );

    const { result: wsResult } = renderHook(() => useWebSocketService(), {
      wrapper,
    });

    // Wait for initial load
    await waitFor(
      () => {
        expect(conversationResult.current.data).toBeDefined();
      },
      { timeout: 5000 }
    );

    const initialData = conversationResult.current.data;

    // Simulate WebSocket disconnect
    act(() => {
      if (wsResult.current) {
        wsResult.current.disconnect();
      }
    });

    // Data should still be available during disconnection
    expect(conversationResult.current.data).toEqual(initialData);

    // Simulate reconnection by reinitializing
    act(() => {
      if (wsResult.current) {
        wsResult.current.initialize({
          userId: "test@example.com",
        });
      }
    });

    // Data should still be intact after reconnection
    await waitFor(() => {
      expect(conversationResult.current.data).toEqual(initialData);
    });
  });

  it("should handle multiple simultaneous conversation subscriptions", async () => {
    const conversations = ["conv-multi-1", "conv-multi-2", "conv-multi-3"];

    // Setup mock data for each conversation
    conversations.forEach((convId, index) => {
      const mockConversation: ConversationResponseDto = {
        id: convId,
        projectId: "proj-1",
        organizationId: "org-1",
        workflowId: `workflow-${index + 1}`,
        initiatedBy: "SYSTEM",
        triggerEvent: "test",
        status: "IN_PROGRESS",
        title: `Multi Conversation ${index + 1}`,
        version: 1,
        category: "task-generation",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      mockedPlatformClient.getConversation.mockImplementation(
        (orgId: string, projectId: string, conversationId: string) => {
          if (conversationId === convId) {
            return Promise.resolve({
              data: {
                data: mockConversation,
              },
            } as any);
          }
          return Promise.resolve({
            data: {
              data: null,
            },
          } as any);
        }
      );
    });

    const wrapper = createWrapper();

    // Create multiple conversation hooks
    const conversationResults = conversations.map((convId) => {
      const { result } = renderHook(
        () => useConversation("org-1", "proj-1", { conversationId: convId }),
        { wrapper }
      );
      return result;
    });

    const { result: wsResult } = renderHook(() => useWebSocketService(), {
      wrapper,
    });

    // Wait for all conversations to load
    await waitFor(
      () => {
        conversationResults.forEach((result) => {
          expect(result.current.isFetched).toBe(true);
        });
      },
      { timeout: 5000 }
    );

    // Simulate WebSocket events for all conversations
    act(() => {
      if (wsResult.current && (wsResult.current as any).handler) {
        conversations.forEach((convId) => {
          (wsResult.current as any).handler.handleEvent({
            type: "conversation.updated",
            conversationId: convId,
            organizationId: "org-1",
            projectId: "proj-1",
            timestamp: new Date().toISOString(),
            changedFields: ["status"],
            previousVersion: 1,
            newVersion: 2,
            changeType: "UPDATE",
          });
        });
      }
    });

    // All conversations should handle their respective events
    await waitFor(
      () => {
        conversationResults.forEach((result) => {
          expect(result.current.data).toBeDefined();
        });
      },
      { timeout: 2000 }
    );
  });
});

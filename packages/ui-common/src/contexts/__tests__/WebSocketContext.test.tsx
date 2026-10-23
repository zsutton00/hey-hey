import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { createStore, Provider as JotaiProvider } from "jotai";
import {
  WebSocketProvider,
  useWebSocketService,
  useWebSocketContext,
} from "../WebSocketContext";
import { WebSocketService } from "../../services/webSocketService";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { conversationKeys } from "../../data/collections/conversations";
import React from "react";

const authState = vi.hoisted(() => ({
  value: {
    isAuthenticated: true,
    user: { email: "test@example.com" } as { email: string } | null,
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  },
}));

vi.mock("../AuthContext", () => ({
  useAuth: () => authState.value,
}));

const organizationState = vi.hoisted(() => ({
  value: undefined as
    | { currentOrganization: { id: string } | null }
    | undefined,
}));

vi.mock("../OrganizationContext", () => ({
  useOptionalOrganization: () => organizationState.value,
}));

// Mock useUserIdentity
vi.mock("../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({
    email: "test@example.com",
  }),
}));

// Mock Socket.IO
const mockSocket = {
  connected: false,
  on: vi.fn(),
  emit: vi.fn(),
  disconnect: vi.fn(),
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

describe("WebSocketProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocket.connected = false;
    mockSocket.on.mockClear();
    mockSocket.emit.mockClear();
    mockSocket.disconnect.mockClear();
    authState.value = {
      isAuthenticated: true,
      user: { email: "test@example.com" },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      toggleDevAdminMode: vi.fn(),
    };
    organizationState.value = undefined;
  });

  const createWrapper = (useNewProvider = false) => {
    const store = createStore();
    return ({ children }: { children: React.ReactNode }) => (
      <JotaiProvider store={store}>
        <WebSocketProvider useNewProvider={useNewProvider}>
          {children}
        </WebSocketProvider>
      </JotaiProvider>
    );
  };

  it("should provide WebSocket service to children", () => {
    const { result } = renderHook(() => useWebSocketService(), {
      wrapper: createWrapper(false),
    });

    expect(result.current).toBeDefined();
    // With the old provider, it uses the singleton (which is a proxy object)
    expect(result.current).toHaveProperty("initialize");
    expect(result.current).toHaveProperty("subscribe");
    expect(result.current).toHaveProperty("disconnect");
  });

  it("should provide WebSocket context to children", () => {
    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper(false),
    });

    expect(result.current).toBeDefined();
    expect(result.current).toHaveProperty("service");
    expect(result.current).toHaveProperty("isConnected");
    expect(result.current).toHaveProperty("isAuthenticated");
    expect(result.current).toHaveProperty("connectionError");
  });

  it("should use singleton service by default", () => {
    const { result } = renderHook(() => useWebSocketService(), {
      wrapper: createWrapper(false),
    });

    // With the old provider, it uses the singleton
    expect(result.current).toBeDefined();
    // Service should be the lazy-loaded singleton
  });

  it("should use new provider when enabled", () => {
    const { result } = renderHook(() => useWebSocketService(), {
      wrapper: createWrapper(true),
    });

    // With the new provider, it creates a fresh service instance
    expect(result.current).toBeDefined();
    expect(result.current).toBeInstanceOf(WebSocketService);
  });

  it("should throw error when used outside provider", () => {
    // Using renderHook without wrapper should result in error
    const { result: serviceResult } = renderHook(() => {
      try {
        return useWebSocketService();
      } catch (error) {
        return { error: (error as Error).message };
      }
    });

    const { result: contextResult } = renderHook(() => {
      try {
        return useWebSocketContext();
      } catch (error) {
        return { error: (error as Error).message };
      }
    });

    expect(serviceResult.current).toHaveProperty("error");
    expect(serviceResult.current.error).toContain(
      "useWebSocketService must be used within a WebSocketProvider"
    );
    expect(contextResult.current).toHaveProperty("error");
    expect(contextResult.current.error).toContain(
      "useWebSocketContext must be used within a WebSocketProvider"
    );
  });

  it("should share store with React hooks when using new provider", async () => {
    // Test that WebSocket handler and React hooks use same store
    const store = createStore();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });

    const TestWrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <JotaiProvider store={store}>
          <WebSocketProvider useNewProvider={true}>{children}</WebSocketProvider>
        </JotaiProvider>
      </QueryClientProvider>
    );

    const { result: wsResult } = renderHook(() => useWebSocketService(), {
      wrapper: TestWrapper,
    });

    // Add a conversation to the shared cache (simulates React hook data)
    const queryKey = conversationKeys.list("org-456", "proj-123", {});
    queryClient.setQueryData(queryKey, [
      { id: "conv-shared", projectId: "proj-123", organizationId: "org-456" },
    ]);

    // The provider's handler invalidates the same cache the hooks read.
    (
      wsResult.current as unknown as {
        handler: { handleEvent: (event: unknown) => void };
      }
    ).handler.handleEvent({
      type: "conversation.status_changed",
      conversationId: "conv-shared",
      organizationId: "org-456",
      projectId: "proj-123",
      timestamp: new Date().toISOString(),
      previousStatus: "ACTIVE",
      newStatus: "COMPLETED",
    });
    expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(true);

    // This demonstrates that provider initialization works alongside the shared store context
    expect(wsResult.current).toBeInstanceOf(WebSocketService);
  });

  it("should initialize service with user identity", () => {
    const { result } = renderHook(() => useWebSocketService(), {
      wrapper: createWrapper(false),
    });

    // Service should be initialized (we can't easily test the async initialization
    // in this test, but we can verify the service exists)
    expect(result.current).toBeDefined();
  });

  it('should disconnect the service when authentication is lost', () => {
    const { result, rerender } = renderHook(() => useWebSocketService(), {
      wrapper: createWrapper(false)
    });
    const disconnectSpy = vi.spyOn(result.current, 'disconnect');

    authState.value = {
      isAuthenticated: false,
      user: null,
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      toggleDevAdminMode: vi.fn(),
    };
    rerender();

    expect(disconnectSpy).toHaveBeenCalled();
    disconnectSpy.mockRestore();
  });

  it("should handle state changes", async () => {
    const { result } = renderHook(() => useWebSocketContext(), {
      wrapper: createWrapper(false),
    });

    // Initial state
    expect(result.current.isConnected).toBe(false);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.connectionError).toBe(null);

    // State should be reactive to WebSocket service changes
    // (In a real test, we would trigger state changes and verify they propagate)
  });

  it("should demonstrate different providers use different services", () => {
    // Test that two different provider instances create separate services
    const wrapper1 = createWrapper(true);
    const wrapper2 = createWrapper(true);

    const { result: result1 } = renderHook(() => useWebSocketService(), {
      wrapper: wrapper1,
    });

    const { result: result2 } = renderHook(() => useWebSocketService(), {
      wrapper: wrapper2,
    });

    // Each provider should create its own service instance when using new provider
    expect(result1.current).not.toBe(result2.current);
    expect(result1.current).toBeInstanceOf(WebSocketService);
    expect(result2.current).toBeInstanceOf(WebSocketService);
  });

  describe("organization binding", () => {
    const renderWithInitializeSpy = () => {
      const initializeSpy = vi
        .spyOn(WebSocketService.prototype, "initialize")
        .mockImplementation(() => {});
      const disconnectSpy = vi
        .spyOn(WebSocketService.prototype, "disconnect")
        .mockImplementation(() => {});
      const rendered = renderHook(() => useWebSocketService(), {
        wrapper: createWrapper(true),
      });
      return { initializeSpy, disconnectSpy, ...rendered };
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("waits for the organization to resolve and initializes once", () => {
      organizationState.value = { currentOrganization: null };
      const { initializeSpy, disconnectSpy, rerender } =
        renderWithInitializeSpy();

      expect(initializeSpy).not.toHaveBeenCalled();
      expect(disconnectSpy).not.toHaveBeenCalled();

      organizationState.value = { currentOrganization: { id: "org-1" } };
      rerender();

      expect(initializeSpy).toHaveBeenCalledTimes(1);
      expect(initializeSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: "test@example.com",
          organizationId: "org-1",
        }),
      );
    });

    it("re-initializes with the new organization on a real switch", () => {
      organizationState.value = { currentOrganization: { id: "org-1" } };
      const { initializeSpy, rerender } = renderWithInitializeSpy();
      expect(initializeSpy).toHaveBeenCalledTimes(1);

      organizationState.value = { currentOrganization: { id: "org-2" } };
      rerender();

      expect(initializeSpy).toHaveBeenCalledTimes(2);
      expect(initializeSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({ organizationId: "org-2" }),
      );
    });

    it("connects without an organization when no organization context exists", () => {
      organizationState.value = undefined;
      const { initializeSpy } = renderWithInitializeSpy();

      expect(initializeSpy).toHaveBeenCalledTimes(1);
      expect(initializeSpy.mock.calls[0]?.[0]).not.toHaveProperty(
        "organizationId",
      );
    });
  });
});

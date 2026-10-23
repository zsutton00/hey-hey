import { renderHook, act, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { createStore, Provider } from "jotai";
import React from "react";
import { useProject } from "../useProject";
import { platformClient } from "../../../clients/serviceClients";
import { webSocketService } from "../../../services/webSocketService";
import { WebSocketProvider } from "../../../contexts/WebSocketContext";

// This is an integration test that tests the actual data flow
// without mocking the internal collection system

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

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    findOneProject: vi.fn(),
  },
}));

vi.mock("../../../services/webSocketService", () => ({
  webSocketService: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
    initialize: vi.fn(),
    getState: vi.fn().mockReturnValue({
      isConnected: false,
      isAuthenticated: false,
      connectionError: null,
    }),
    onStateChange: vi.fn().mockReturnValue(() => {}), // Returns unsubscribe function
  },
  WebSocketService: vi.fn().mockImplementation(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    disconnect: vi.fn(),
    initialize: vi.fn(),
    getState: vi.fn().mockReturnValue({
      isConnected: false,
      isAuthenticated: false,
      connectionError: null,
    }),
    onStateChange: vi.fn().mockReturnValue(() => {}), // Returns unsubscribe function
  })),
}));

const mockPlatformClient = platformClient.findOneProject as Mock;
const mockWebSocketSubscribe = webSocketService.subscribe as Mock;

// Test wrapper with providers
const createWrapper = () => {
  const TestWrapper: React.FC<{ children: React.ReactNode }> = ({
    children,
  }) => {
    const store = createStore();
    return (
      <Provider store={store}>
        <WebSocketProvider>{children}</WebSocketProvider>
      </Provider>
    );
  };
  return TestWrapper;
};

describe("useProject integration", () => {
  const mockProject = {
    id: "project-123",
    name: "Test Project",
    organizationId: "org-123",
    status: "ACTIVE",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockWebSocketSubscribe.mockReturnValue("subscription-123");
  });

  it("should load project data successfully through the collection system", async () => {
    console.log("starting test...");
    mockPlatformClient.mockResolvedValue({
      data: { data: mockProject },
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useProject("org-123", "project-123"), {
      wrapper,
    });
    console.log("rendered hook...");

    // Initially may be loading (depending on timing)
    expect(result.current.data).toBeNull();
    expect(result.current.isFetched).toBe(false);

    // Wait for data to load
    await waitFor(
      () => {
        expect(result.current.data).toEqual(mockProject);
      },
      { timeout: 5000 }
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetched).toBe(true);
    expect(result.current.error).toBeNull();
    expect(mockPlatformClient).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-123",
        projectId: "project-123",
      }), {}
    );
  });

  it("should handle API errors correctly", async () => {
    const apiError = new Error("Project not found");
    mockPlatformClient.mockRejectedValue(apiError);

    const wrapper = createWrapper();
    const { result } = renderHook(() => useProject("org-123", "nonexistent"), {
      wrapper,
    });

    await waitFor(
      () => {
        expect(result.current.error).toBeTruthy();
      },
      { timeout: 5000 }
    );

    expect(result.current.data).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isFetched).toBe(true); // Error means fetch was attempted
  });

  it("should not make API calls when disabled", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(
      () => useProject("org-123", "project-disabled", { enabled: false }),
      { wrapper }
    );

    // Wait a bit to ensure no API calls are made
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockPlatformClient).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.isFetched).toBe(false);
  });

  it("should refetch when refetch is called", async () => {
    // Use a unique project ID to avoid cache conflicts
    const testProjectId = "project-refetch-test";
    const initialProject = { ...mockProject, id: testProjectId };
    const updatedProject = {
      ...mockProject,
      id: testProjectId,
      name: "Updated Project",
    };

    mockPlatformClient.mockResolvedValue({
      data: { data: initialProject },
    });

    const wrapper = createWrapper();
    const { result } = renderHook(() => useProject("org-123", testProjectId), {
      wrapper,
    });

    // Wait for initial load
    await waitFor(() => {
      expect(result.current.data).toEqual(initialProject);
    });

    // Update the mock to return different data for refetch
    mockPlatformClient.mockResolvedValue({
      data: { data: updatedProject },
    });

    // Get current call count before refetch
    const callCountBeforeRefetch = mockPlatformClient.mock.calls.length;

    // Mark as stale first, then call refetch
    await act(async () => {
      result.current.markStale();
      await result.current.refetch();
    });

    // Verify refetch was called (should have at least one more call)
    await waitFor(() => {
      expect(mockPlatformClient.mock.calls.length).toBeGreaterThan(
        callCountBeforeRefetch
      );
    });

    await waitFor(() => {
      expect(result.current.data).toEqual(updatedProject);
    });
  });

  it("should handle missing organizationId gracefully", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProject(undefined, "project-123"), {
      wrapper,
    });

    // Should not make API calls
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockPlatformClient).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });

  it("should handle missing projectId gracefully", async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useProject("org-123", undefined), {
      wrapper,
    });

    // Should not make API calls
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockPlatformClient).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isLoading).toBe(false);
  });
});

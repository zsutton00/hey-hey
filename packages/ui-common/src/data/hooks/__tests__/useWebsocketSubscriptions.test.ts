import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { useWebsocketSubscriptions } from "../useWebsocketSubscriptions";
import { useOptionalWebSocketService } from "../../../contexts/WebSocketContext";

// Mock WebSocket context
vi.mock("../../../contexts/WebSocketContext", () => ({
  useOptionalWebSocketService: vi.fn(),
}));

const mockUseWebSocketService = useOptionalWebSocketService as Mock;

describe("useWebsocketSubscriptions", () => {
  const mockWebSocketService = {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseWebSocketService.mockReturnValue(mockWebSocketService);
    mockWebSocketService.subscribe.mockReturnValue("subscription-123");
  });

  describe("conversation subscriptions", () => {
    it("should subscribe to WebSocket for conversation IDs", async () => {
      renderHook(() =>
        useWebsocketSubscriptions(
          { conversationIds: ["conv-123", "conv-456"] },
          { enabled: true }
        )
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalledWith({
          conversationIds: ["conv-123", "conv-456"],
        });
      });
    });

    it("should not subscribe when conversation IDs array is empty", () => {
      renderHook(() =>
        useWebsocketSubscriptions({ conversationIds: [] }, { enabled: true })
      );

      expect(mockWebSocketService.subscribe).not.toHaveBeenCalled();
    });

    it("should unsubscribe on unmount", async () => {
      const { unmount } = renderHook(() =>
        useWebsocketSubscriptions(
          { conversationIds: ["conv-123"] },
          { enabled: true }
        )
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalled();
      });

      unmount();

      await waitFor(() => {
        expect(mockWebSocketService.unsubscribe).toHaveBeenCalledWith(
          "subscription-123"
        );
      });
    });
  });

  describe("project subscriptions", () => {
    it("should subscribe to WebSocket for project IDs", async () => {
      renderHook(() =>
        useWebsocketSubscriptions(
          { projectIds: ["proj-123", "proj-456"] },
          { enabled: true }
        )
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalledWith({
          projectIds: ["proj-123", "proj-456"],
        });
      });
    });

    it("should not subscribe when project IDs array is empty", () => {
      renderHook(() =>
        useWebsocketSubscriptions({ projectIds: [] }, { enabled: true })
      );

      expect(mockWebSocketService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("initiative subscriptions", () => {
    it("should subscribe to WebSocket for initiative IDs", async () => {
      renderHook(() =>
        useWebsocketSubscriptions(
          { initiativeIds: ["init-123", "init-456"] },
          { enabled: true }
        )
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalledWith({
          initiativeIds: ["init-123", "init-456"],
        });
      });
    });

    it("should not subscribe when initiative IDs array is empty", () => {
      renderHook(() =>
        useWebsocketSubscriptions({ initiativeIds: [] }, { enabled: true })
      );

      expect(mockWebSocketService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("mixed subscriptions", () => {
    it("should subscribe with mixed ID types", async () => {
      renderHook(() =>
        useWebsocketSubscriptions(
          {
            conversationIds: ["conv-123"],
            projectIds: ["proj-456"],
            initiativeIds: ["init-789"],
          },
          { enabled: true }
        )
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalledWith({
          conversationIds: ["conv-123"],
          projectIds: ["proj-456"],
          initiativeIds: ["init-789"],
        });
      });
    });

    it("should not subscribe when all ID arrays are empty", () => {
      renderHook(() =>
        useWebsocketSubscriptions(
          {
            conversationIds: [],
            projectIds: [],
            initiativeIds: [],
          },
          { enabled: true }
        )
      );

      expect(mockWebSocketService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("enabled option", () => {
    it("should not subscribe when enabled is false", () => {
      renderHook(() =>
        useWebsocketSubscriptions(
          { conversationIds: ["conv-123"] },
          { enabled: false }
        )
      );

      expect(mockWebSocketService.subscribe).not.toHaveBeenCalled();
    });

    it("should unsubscribe when enabled changes from true to false", async () => {
      const { rerender } = renderHook(
        ({ enabled }: { enabled: boolean }) =>
          useWebsocketSubscriptions(
            { conversationIds: ["conv-123"] },
            { enabled }
          ),
        { initialProps: { enabled: true } }
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalled();
      });

      // Reset mock to track new calls
      vi.clearAllMocks();
      mockWebSocketService.subscribe.mockReturnValue("subscription-456");

      // Change enabled to false
      rerender({ enabled: false });

      // Should not create new subscription
      expect(mockWebSocketService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("dependency changes", () => {
    it("should resubscribe when conversation IDs change", async () => {
      const { rerender } = renderHook(
        ({ conversationIds }: { conversationIds: string[] }) =>
          useWebsocketSubscriptions({ conversationIds }, { enabled: true }),
        { initialProps: { conversationIds: ["conv-123"] } }
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalledWith({
          conversationIds: ["conv-123"],
        });
      });

      // Clear mocks to track new calls
      vi.clearAllMocks();
      mockWebSocketService.subscribe.mockReturnValue("subscription-456");

      // Change conversation IDs
      rerender({ conversationIds: ["conv-456", "conv-789"] });

      await waitFor(() => {
        expect(mockWebSocketService.unsubscribe).toHaveBeenCalledWith(
          "subscription-123"
        );
        expect(mockWebSocketService.subscribe).toHaveBeenCalledWith({
          conversationIds: ["conv-456", "conv-789"],
        });
      });
    });

    it("should handle ID arrays being sorted for dependency tracking", async () => {
      const { rerender } = renderHook(
        ({ conversationIds }: { conversationIds: string[] }) =>
          useWebsocketSubscriptions({ conversationIds }, { enabled: true }),
        { initialProps: { conversationIds: ["conv-456", "conv-123"] } }
      );

      await waitFor(() => {
        expect(mockWebSocketService.subscribe).toHaveBeenCalledWith({
          conversationIds: ["conv-456", "conv-123"],
        });
      });

      // Clear mocks
      vi.clearAllMocks();

      // Rerender with same IDs in different order - should not resubscribe
      rerender({ conversationIds: ["conv-123", "conv-456"] });

      // Wait a bit to ensure no new calls were made
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Should not have made new subscription calls since sorted arrays are same
      expect(mockWebSocketService.unsubscribe).not.toHaveBeenCalled();
      expect(mockWebSocketService.subscribe).not.toHaveBeenCalled();
    });
  });

  describe("error handling", () => {
    it("should handle WebSocket service errors gracefully", () => {
      mockWebSocketService.subscribe.mockImplementation(() => {
        throw new Error("WebSocket connection failed");
      });

      // Should not throw error
      expect(() => {
        renderHook(() =>
          useWebsocketSubscriptions(
            { conversationIds: ["conv-123"] },
            { enabled: true }
          )
        );
      }).not.toThrow();
    });
  });
});

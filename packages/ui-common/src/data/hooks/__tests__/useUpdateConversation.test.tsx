import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { useUpdateConversation } from "../useUpdateConversation";
import { platformClient } from "../../../clients/serviceClients";
import {
  ConversationStatus,
  type ConversationResponseDto,
} from "../../../api";
import { conversationKeys } from "../../collections/conversations";

const TASK_GENERATION_CATEGORY = "task-generation" as const;

// Mock the dependencies
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    updateConversation: vi.fn(),
  },
}));

const mockPlatformClient = platformClient.updateConversation as Mock;

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe("useUpdateConversation", () => {
  const mockConversation = {
    id: "conv-123",
    projectId: "project-123",
    organizationId: "org-123",
    status: ConversationStatus.Completed,
    category: TASK_GENERATION_CATEGORY,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-02T00:00:00Z",
  };

  const mockUpdateDto = {
    status: ConversationStatus.Completed,
    expectedVersion: 1,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatformClient.mockResolvedValue({
      data: {
        success: true,
        message: "Conversation updated successfully",
        data: mockConversation,
        timestamp: "2023-01-02T00:00:00Z",
        statusCode: 200,
        path: "/conversations",
      },
    });
  });

  describe("successful update", () => {
    it("should update conversation and update collection state", async () => {
      const onSuccess = vi.fn();
      const { queryClient, wrapper } = createHarness();
      const listKey = conversationKeys.list("org-123", "project-123", {});
      const otherRow = { ...mockConversation, id: "conv-other" };
      queryClient.setQueryData(listKey, [
        { ...mockConversation, status: ConversationStatus.Started },
        otherRow,
      ]);
      const variantKey = conversationKeys.envelope(
        "org-123",
        "project-123",
        "conv-123",
        true
      );
      queryClient.setQueryData(variantKey, mockConversation);
      const { result } = renderHook(() => useUpdateConversation({ onSuccess }), {
        wrapper,
      });

      // Initial state should be idle
      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();

      // Call the mutate function
      const resultPromise = result.current.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        conversationId: "conv-123",
        updateDto: mockUpdateDto,
      });

      // Wait for the mutation to complete
      const updatedConversation = await resultPromise;

      expect(updatedConversation).toEqual(mockConversation);
      expect(mockPlatformClient).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          projectId: "project-123",
          conversationId: "conv-123",
          updateConversationDto: mockUpdateDto,
        })
      );

      // The returned conversation is written to its base envelope and to
      // every cached list row with the same id.
      expect(
        queryClient.getQueryData(
          conversationKeys.envelope("org-123", "project-123", "conv-123")
        )
      ).toEqual(mockConversation);
      expect(
        queryClient.getQueryData<ConversationResponseDto[]>(listKey)
      ).toEqual([mockConversation, otherRow]);
      // The suggestion-decisions variant carries fields this body lacks.
      expect(queryClient.getQueryState(variantKey)?.isInvalidated).toBe(true);

      expect(onSuccess).toHaveBeenCalledWith(mockConversation);
    });

    it("should call onSuccess callback when provided", async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useUpdateConversation({ onSuccess }));

      await result.current.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        conversationId: "conv-123",
        updateDto: mockUpdateDto,
      });

      expect(onSuccess).toHaveBeenCalledWith(mockConversation);
    });
  });

  describe("error handling", () => {
    it("should handle API errors correctly", async () => {
      const errorMessage = "Update failed";
      const onError = vi.fn();
      mockPlatformClient.mockRejectedValue(new Error(errorMessage));

      const { result } = renderHook(() => useUpdateConversation({ onError }));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationId: "conv-123",
          updateDto: mockUpdateDto,
        })
      ).rejects.toThrow(errorMessage);

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should call onError callback when provided", async () => {
      const error = new Error("Test error");
      const onError = vi.fn();
      mockPlatformClient.mockRejectedValue(error);

      const { result } = renderHook(() => useUpdateConversation({ onError }));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationId: "conv-123",
          updateDto: mockUpdateDto,
        })
      ).rejects.toThrow("Test error");

      expect(onError).toHaveBeenCalledWith(error);
    });

    it("should handle missing conversation data in response", async () => {
      mockPlatformClient.mockResolvedValue({
        data: {
          success: false,
          message: "No data returned",
          data: null,
          timestamp: "2023-01-02T00:00:00Z",
          statusCode: 200,
          path: "/conversations",
        },
      });

      const { result } = renderHook(() => useUpdateConversation());

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationId: "conv-123",
          updateDto: mockUpdateDto,
        })
      ).rejects.toThrow("No conversation data returned from API");
    });
  });

  describe("state management", () => {
    it("should return initial state values", () => {
      const { result } = renderHook(() => useUpdateConversation());

      // Initial state should be idle
      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.mutate).toBe("function");
    });

    it("should call onSettled callback", async () => {
      const onSettled = vi.fn();
      const { result } = renderHook(() => useUpdateConversation({ onSettled }));

      await result.current.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        conversationId: "conv-123",
        updateDto: mockUpdateDto,
      });

      expect(onSettled).toHaveBeenCalled();
    });

    it("should call onSettled even when there's an error", async () => {
      const onSettled = vi.fn();
      mockPlatformClient.mockRejectedValue(new Error("Test error"));

      const { result } = renderHook(() => useUpdateConversation({ onSettled }));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationId: "conv-123",
          updateDto: mockUpdateDto,
        })
      ).rejects.toThrow();

      expect(onSettled).toHaveBeenCalled();
    });
  });
});

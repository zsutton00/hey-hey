import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { useUpdateConversation } from "../useUpdateConversation";
import { platformClient } from "../../../clients/serviceClients";
import { ConversationStatus } from "../../../api";
import {
  conversationNode,
  FakeConversationServer,
  threadOf,
} from "../../../test/conversationGraphQL";
import { useConversations } from "../useConversations";

const TASK_GENERATION_CATEGORY = "task-generation" as const;

// Mock the dependencies
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    updateConversation: vi.fn(),
  },
}));

const mockPlatformClient = platformClient.updateConversation as Mock;

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
      const server = new FakeConversationServer(threadOf(1));
      const { result } = renderHook(
        () => ({
          update: useUpdateConversation({ onSuccess }),
          list: useConversations("org-123", "project-123"),
        }),
        { wrapper: server.wrapper },
      );
      await waitFor(() => expect(result.current.list.isReady).toBe(true));
      expect(result.current.list.data?.map((c) => c.id)).toEqual([
        conversationNode.id,
      ]);

      // Initial state should be idle
      expect(result.current.update.isPending).toBe(false);
      expect(result.current.update.isSuccess).toBe(false);
      expect(result.current.update.isError).toBe(false);
      expect(result.current.update.error).toBeNull();

      server.conversations = [
        { ...conversationNode, status: ConversationStatus.Completed },
      ];
      const updatedConversation = await result.current.update.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        conversationId: conversationNode.id,
        updateDto: mockUpdateDto,
      });

      expect(updatedConversation).toEqual(mockConversation);
      expect(mockPlatformClient).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          projectId: "project-123",
          conversationId: conversationNode.id,
          updateConversationDto: mockUpdateDto,
        }),
      );

      // The mounted active list re-reads and drops the completed conversation.
      await waitFor(() => expect(result.current.list.data).toEqual([]));
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
        }),
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
        }),
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
        }),
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
        }),
      ).rejects.toThrow();

      expect(onSettled).toHaveBeenCalled();
    });
  });
});

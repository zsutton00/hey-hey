import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { useCreateConversation } from "../useCreateConversation";
import { platformClient } from "../../../clients/serviceClients";
import { ConversationStatus, InitiationType } from "../../../api";
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
    createConversation: vi.fn(),
  },
}));

const mockPlatformClient = platformClient.createConversation as Mock;

describe("useCreateConversation", () => {
  const mockConversation = {
    id: "conv-123",
    projectId: "project-123",
    organizationId: "org-123",
    status: ConversationStatus.Started,
    category: TASK_GENERATION_CATEGORY,
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  };

  const mockCreateDto = {
    projectId: "project-123",
    initiatedBy: InitiationType.User,
    triggerEvent: "task_generation_requested",
    title: "Test Conversation",
    category: TASK_GENERATION_CATEGORY,
    status: ConversationStatus.Started,
    workflowName: "task-generation",
    workflowAboutId: "initiative-123",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPlatformClient.mockResolvedValue({
      data: {
        success: true,
        message: "Conversation created successfully",
        data: mockConversation,
        timestamp: "2023-01-01T00:00:00Z",
        statusCode: 201,
        path: "/conversations",
      },
    });
  });

  describe("successful creation", () => {
    it("should create conversation and update collection state", async () => {
      const onSuccess = vi.fn();
      const server = new FakeConversationServer(threadOf(1));
      const { result } = renderHook(
        () => ({
          create: useCreateConversation({ onSuccess }),
          list: useConversations("org-123", "project-123"),
        }),
        { wrapper: server.wrapper },
      );
      await waitFor(() => expect(result.current.list.isReady).toBe(true));
      expect(result.current.list.data?.map((c) => c.id)).toEqual([
        conversationNode.id,
      ]);

      // Initial state should be idle
      expect(result.current.create.isPending).toBe(false);
      expect(result.current.create.isSuccess).toBe(false);
      expect(result.current.create.isError).toBe(false);
      expect(result.current.create.error).toBeNull();

      server.conversations = [
        conversationNode,
        { ...conversationNode, id: mockConversation.id },
      ];
      const createdConversation = await result.current.create.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        conversationDto: mockCreateDto,
      });

      expect(createdConversation).toEqual(mockConversation);
      expect(mockPlatformClient).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          projectId: "project-123",
          createConversationDto: mockCreateDto,
        }),
      );

      // Mounted conversation lists re-read so the new conversation joins them.
      await waitFor(() =>
        expect(result.current.list.data?.map((c) => c.id)).toEqual([
          conversationNode.id,
          mockConversation.id,
        ]),
      );
      expect(onSuccess).toHaveBeenCalledWith(mockConversation);
    });

    it("should call onSuccess callback when provided", async () => {
      const onSuccess = vi.fn();
      const { result } = renderHook(() => useCreateConversation({ onSuccess }));

      await result.current.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        conversationDto: mockCreateDto,
      });

      expect(onSuccess).toHaveBeenCalledWith(mockConversation);
    });
  });

  describe("error handling", () => {
    it("should handle API errors correctly", async () => {
      const errorMessage = "Creation failed";
      const onError = vi.fn();
      mockPlatformClient.mockRejectedValue(new Error(errorMessage));

      const { result } = renderHook(() => useCreateConversation({ onError }));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationDto: mockCreateDto,
        }),
      ).rejects.toThrow(errorMessage);

      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it("should call onError callback when provided", async () => {
      const error = new Error("Test error");
      const onError = vi.fn();
      mockPlatformClient.mockRejectedValue(error);

      const { result } = renderHook(() => useCreateConversation({ onError }));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationDto: mockCreateDto,
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
          timestamp: "2023-01-01T00:00:00Z",
          statusCode: 201,
          path: "/conversations",
        },
      });

      const { result } = renderHook(() => useCreateConversation());

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationDto: mockCreateDto,
        }),
      ).rejects.toThrow("No conversation data returned from API");
    });
  });

  describe("state management", () => {
    it("should return initial state values", () => {
      const { result } = renderHook(() => useCreateConversation());

      // Initial state should be idle
      expect(result.current.isPending).toBe(false);
      expect(result.current.isSuccess).toBe(false);
      expect(result.current.isError).toBe(false);
      expect(result.current.error).toBeNull();
      expect(typeof result.current.mutate).toBe("function");
    });

    it("should call onSettled callback", async () => {
      const onSettled = vi.fn();
      const { result } = renderHook(() => useCreateConversation({ onSettled }));

      await result.current.mutate({
        organizationId: "org-123",
        projectId: "project-123",
        conversationDto: mockCreateDto,
      });

      expect(onSettled).toHaveBeenCalled();
    });

    it("should call onSettled even when there's an error", async () => {
      const onSettled = vi.fn();
      mockPlatformClient.mockRejectedValue(new Error("Test error"));

      const { result } = renderHook(() => useCreateConversation({ onSettled }));

      await expect(
        result.current.mutate({
          organizationId: "org-123",
          projectId: "project-123",
          conversationDto: mockCreateDto,
        }),
      ).rejects.toThrow();

      expect(onSettled).toHaveBeenCalled();
    });
  });
});

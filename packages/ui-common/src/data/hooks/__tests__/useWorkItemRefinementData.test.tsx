import { vi, beforeEach, describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { ReactNode } from "react";
import { useWorkItemRefinementData } from "../useWorkItemRefinementData";
import type {
  ConversationResponseDto,
  InitiativeResponseDto,
} from "../../../api";

// Mock all the dependencies
vi.mock("../../../clients/serviceClients", () => ({
  workItemRefinementClient: {
    refineWorkItem: vi.fn(),
  },
}));

vi.mock("../useProject", () => ({
  useProject: vi.fn(),
}));

vi.mock("../useWorkItems", () => ({
  useWorkItems: vi.fn(),
}));

vi.mock("../useConversation", () => ({
  useConversation: vi.fn(),
}));

vi.mock("../useConversationPolling", () => ({
  useConversationPolling: vi.fn(),
}));

vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

import { useProject } from "../useProject";
import { useWorkItems } from "../useWorkItems";
import { useConversation } from "../useConversation";
import { useConversationPolling } from "../useConversationPolling";
import { workItemRefinementClient } from "../../../clients/serviceClients";

const mockUseProject = useProject as ReturnType<typeof vi.fn>;
const mockUseWorkItems = useWorkItems as ReturnType<typeof vi.fn>;
const mockUseConversation = useConversation as ReturnType<typeof vi.fn>;
const mockUseConversationPolling = useConversationPolling as ReturnType<
  typeof vi.fn
>;
const mockRefineWorkItem =
  workItemRefinementClient.refineWorkItem as ReturnType<typeof vi.fn>;

describe("useWorkItemRefinementData", () => {
  let store: ReturnType<typeof createStore>;
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element;

  beforeEach(() => {
    store = createStore();
    wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    vi.clearAllMocks();

    // Default mock implementations
    mockUseProject.mockReturnValue({
      data: {
        id: "project-1",
        name: "Test Project",
        organizationId: "org-1",
        status: "active",
      },
      isLoading: false,
      error: null,
    });

    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseConversation.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetched: false,
      isReady: false,
      isFetching: false,
      isStale: false,
      markStale: vi.fn(),
      state: null,
    });

    mockUseConversationPolling.mockReturnValue({
      isWaitingForFirstMessage: false,
    });

    mockRefineWorkItem.mockResolvedValue({
      data: { data: { conversationId: "conversation-1" } },
    });
  });

  it("should return initial state with loading states", () => {
    const { result } = renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          entityType: "initiative",
        }),
      { wrapper }
    );

    expect(result.current.isProjectLoading).toBe(false);
    expect(result.current.isWorkItemLoading).toBe(false);
    expect(result.current.isConversationLoading).toBe(false);
    expect(result.current.workItemData).toBeNull();
    expect(result.current.conversation).toBeNull();
    expect(result.current.refinementData).toBeNull();
  });

  it("should return project data when available", () => {
    const mockProject = {
      id: "project-1",
      name: "Test Project",
      organizationId: "org-1",
      status: "active" as const,
    };

    mockUseProject.mockReturnValue({
      data: mockProject,
      isLoading: false,
      error: null,
    });

    const { result } = renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          entityType: "initiative",
        }),
      { wrapper }
    );

    expect(result.current.project).toEqual(mockProject);
    expect(result.current.isProjectLoading).toBe(false);
  });

  it("should return work item data when found in collection", () => {
    const mockWorkItem: InitiativeResponseDto = {
      id: "workitem-1",
      title: "Test Work Item",
      description: "Test description",
      details: "Test details",
      acceptanceCriteria: "Test criteria",
      organizationId: "org-1",
      projectId: "project-1",
      status: "DRAFT",
      priority: "MEDIUM",
      createdAt: "2024-01-01T10:00:00Z",
      updatedAt: "2024-01-01T10:00:00Z",
    };

    mockUseWorkItems.mockReturnValue({
      workItems: [mockWorkItem],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          entityType: "initiative",
        }),
      { wrapper }
    );

    expect(result.current.workItemData).toEqual(mockWorkItem);
    expect(result.current.isWorkItemLoading).toBe(false);
  });

  it("should return conversation data when available", async () => {
    const mockConversation: ConversationResponseDto = {
      id: "conv-1",
      organizationId: "org-1",
      projectId: "project-1",
      title: "Test Conversation",
      status: "ACTIVE",
      createdAt: "2024-01-01T10:00:00Z",
      updatedAt: "2024-01-01T10:00:00Z",
    };

    mockUseConversation.mockImplementation((orgId, projId, params, options) => {
      const hasConversation = Boolean(
        options?.enabled && params?.conversationId
      );

      return {
        data: hasConversation ? mockConversation : null,
        isLoading: !hasConversation,
        error: null,
        refetch: vi.fn(),
        isFetched: hasConversation,
        isReady: hasConversation,
        isFetching: !hasConversation,
        isStale: false,
        markStale: vi.fn(),
        state: null,
        retryCount: 0,
      };
    });

    const { result } = renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          entityType: "initiative",
        }),
      { wrapper }
    );

    await waitFor(() => {
      expect(mockRefineWorkItem).toHaveBeenCalled();
      expect(mockUseConversation).toHaveBeenCalledWith(
        "org-1",
        "project-1",
        { conversationId: "conversation-1" },
        { enabled: true }
      );
      expect(result.current.conversation).toEqual(mockConversation);
      expect(result.current.isConversationLoading).toBe(false);
    });
  });

  it("should handle loading states correctly", () => {
    mockUseProject.mockReturnValue({
      data: null,
      isLoading: true,
      error: null,
    });

    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    mockUseConversation.mockReturnValue({
      conversation: null,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          entityType: "task",
        }),
      { wrapper }
    );

    expect(result.current.isProjectLoading).toBe(true);
    expect(result.current.isWorkItemLoading).toBe(true);
    expect(result.current.isConversationLoading).toBe(true);
  });

  it("should handle error states correctly", () => {
    const projectError = new Error("Project error");
    const workItemError = new Error("Work item error");
    const conversationError = new Error("Conversation error");

    mockUseProject.mockReturnValue({
      data: null,
      isLoading: false,
      error: projectError,
    });

    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      error: workItemError,
      refetch: vi.fn(),
    });

    mockUseConversation.mockReturnValue({
      conversation: null,
      isLoading: false,
      error: conversationError,
      refetch: vi.fn(),
    });

    const { result } = renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          entityType: "initiative",
        }),
      { wrapper }
    );

    expect(result.current.projectError).toEqual(projectError);
    expect(result.current.workItemError).toEqual(workItemError);
    expect(result.current.conversationError).toEqual(conversationError);
  });

  it("should support both initiative and task entity types", () => {
    renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "initiative-1",
          entityType: "initiative",
        }),
      { wrapper }
    );

    expect(mockUseWorkItems).toHaveBeenNthCalledWith(
      1,
      "org-1",
      "initiative",
      "project-1",
      undefined,
      undefined
    );

    renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "task-1",
          entityType: "task",
        }),
      { wrapper }
    );

    expect(mockUseWorkItems).toHaveBeenNthCalledWith(
      3,
      "org-1",
      "task",
      "project-1",
      undefined,
      { enabled: false }
    );
  });

  it("should provide refetch functions", () => {
    const mockRefetchWorkItems = vi.fn();
    const mockRefetchConversation = vi.fn();

    mockUseWorkItems.mockReturnValue({
      workItems: [],
      isLoading: false,
      error: null,
      refetch: mockRefetchWorkItems,
    });

    mockUseConversation.mockReturnValue({
      conversation: null,
      isLoading: false,
      error: null,
      refetch: mockRefetchConversation,
    });

    const { result } = renderHook(
      () =>
        useWorkItemRefinementData({
          organizationId: "org-1",
          projectId: "project-1",
          workItemId: "workitem-1",
          entityType: "initiative",
        }),
      { wrapper }
    );

    expect(typeof result.current.refetchWorkItem).toBe("function");
    expect(typeof result.current.refetchConversation).toBe("function");
  });
});

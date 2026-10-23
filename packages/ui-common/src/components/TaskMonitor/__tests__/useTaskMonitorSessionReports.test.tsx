import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSession } from "./taskMonitorTestFixtures";
import {
  useTaskMonitorConversation,
  useTaskMonitorCoordinatorConversation,
} from "../useTaskMonitorSessionReports";

const {
  useConversationMock,
  useConversationMessagesMock,
  useProjectMock,
  coordinatorMutateMock,
  useResolveWorkItemCoordinatorMock,
} = vi.hoisted(() => ({
  useConversationMock: vi.fn(),
  useConversationMessagesMock: vi.fn(),
  useProjectMock: vi.fn(),
  coordinatorMutateMock: vi.fn(),
  useResolveWorkItemCoordinatorMock: vi.fn(),
}));

vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: useConversationMock,
}));
vi.mock("../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: useConversationMessagesMock,
}));
vi.mock("../../../data/hooks/useProject", () => ({
  useProject: useProjectMock,
}));
vi.mock("../../../data/hooks/useResolveWorkItemCoordinator", () => ({
  useResolveWorkItemCoordinator: useResolveWorkItemCoordinatorMock,
}));

const readyQuery = {
  data: null,
  isLoading: false,
  isFetched: true,
  error: null,
};

const readyMessagesQuery = {
  ...readyQuery,
  data: [],
};

describe("Task Monitor canonical conversations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConversationMock.mockReturnValue(readyQuery);
    useConversationMessagesMock.mockReturnValue(readyMessagesQuery);
    useProjectMock.mockReturnValue(readyQuery);
    coordinatorMutateMock.mockResolvedValue({
      created: false,
      agentSession: createSession(),
    });
    useResolveWorkItemCoordinatorMock.mockReturnValue({
      mutate: coordinatorMutateMock,
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    });
  });

  it("loads the linked conversation only when the session owns one", () => {
    const session = {
      ...createSession(),
      conversationId: "44444444-4444-4444-8444-444444444444",
    };
    renderHook(() =>
      useTaskMonitorConversation({
        organizationId: "org-1",
        projectId: "project-1",
        session,
      })
    );

    expect(useConversationMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      { conversationId: session.conversationId },
      expect.objectContaining({ enabled: true })
    );
    expect(useConversationMessagesMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      session.conversationId,
      expect.objectContaining({
        enabled: true,
        refetchOnWindowFocus: true,
      })
    );
    expect(useProjectMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ enabled: true })
    );
  });

  it("exposes coordinator metadata separately from the live message collection", () => {
    const session = {
      ...createSession(),
      conversationId: "44444444-4444-4444-8444-444444444444",
    };
    useConversationMock.mockReturnValue({
      ...readyQuery,
      data: {
        id: session.conversationId,
        projectId: "project-1",
      },
    });
    useConversationMessagesMock.mockReturnValue({
      ...readyMessagesQuery,
      data: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          conversationId: session.conversationId,
          type: "SYSTEM",
          status: "completed",
          createdAt: "2026-07-28T03:06:02.855Z",
          responses: [],
          data: { type: "TASK_MONITOR_SUPERVISION" },
        },
      ],
    });

    const { result } = renderHook(() =>
      useTaskMonitorConversation({
        organizationId: "org-1",
        projectId: "project-1",
        session,
      })
    );

    expect(result.current.conversation).not.toHaveProperty("messages");
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.data.type).toBe(
      "TASK_MONITOR_SUPERVISION"
    );
  });

  it("treats a session without a conversation as a completed empty read", () => {
    const { result } = renderHook(() =>
      useTaskMonitorConversation({
        organizationId: "org-1",
        projectId: "project-1",
        session: createSession(),
      })
    );

    expect(result.current.fetched).toBe(true);
    expect(result.current.loading).toBe(false);
    expect(useConversationMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      { conversationId: "" },
      expect.objectContaining({ enabled: false })
    );
    expect(useConversationMessagesMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      undefined,
      expect.objectContaining({ enabled: false })
    );
    expect(useProjectMock).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ enabled: false })
    );
  });

  it("preserves the no-conversation state independently of disabled queries", () => {
    useConversationMock.mockReturnValue({
      ...readyQuery,
      error: new Error("Disabled conversation query"),
    });
    useProjectMock.mockReturnValue({
      ...readyQuery,
      error: new Error("Disabled project query"),
    });

    const { result } = renderHook(() =>
      useTaskMonitorConversation({
        organizationId: "org-1",
        projectId: "project-1",
        session: createSession(),
      })
    );

    expect(result.current.fetched).toBe(true);
    expect(result.current.errorMessage).toBeNull();
  });

  it("resolves Monitor activity through the durable work-item coordinator", async () => {
    renderHook(() =>
      useTaskMonitorCoordinatorConversation({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "66666666-6666-4666-8666-666666666666",
        sessionDate: "2026-07-20T00:00:00.000Z",
      })
    );

    await waitFor(() =>
      expect(coordinatorMutateMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "project-1",
        body: expect.objectContaining({
          workItemType: "TASK_MONITOR",
          workItemId: "66666666-6666-4666-8666-666666666666",
        }),
      })
    );
  });

  it("surfaces a missing coordinator session date without resolving", () => {
    const { result } = renderHook(() =>
      useTaskMonitorCoordinatorConversation({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "66666666-6666-4666-8666-666666666666",
        sessionDate: null,
      })
    );

    expect(coordinatorMutateMock).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toContain("session date");
    expect(result.current.fetched).toBe(true);
  });
});

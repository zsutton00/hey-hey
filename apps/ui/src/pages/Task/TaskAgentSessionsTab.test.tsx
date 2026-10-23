import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  RelationshipValue,
  WorkStatus,
  type ContextRelatedEntityDto,
} from "@hey-hey/ui-common/api";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskAgentSessionsTab } from "./TaskAgentSessionsTab";

const mockNavigate = vi.fn();
const mockCreateAgentSession = vi.fn();
const mockRemoveAgentSession = vi.fn();
const mockTaskStatusChange = vi.fn();
const mockUseAgentSessions = vi.fn();
const mockPaginatedFeed = vi.fn();
const mockDeleteAgentSession = vi.fn();

vi.mock("@hey-hey/ui-common/clients", () => ({
  unifiedApiClient: {
    deleteAgentSession: (...args: unknown[]) =>
      mockDeleteAgentSession(...args),
  },
}));

const dependency = (
  entityId: string,
  displayName: string,
  taskType = "STANDARD",
): ContextRelatedEntityDto => ({
  entityId,
  entityType: "TASK",
  displayName,
  relationship: RelationshipValue.DependsOn,
  status: WorkStatus.Active,
  taskType,
});

vi.mock("@hey-hey/ui-common/data", () => ({
  useAgentSessions: (...args: unknown[]) => mockUseAgentSessions(...args),
  useCreateAgentSession: () => ({
    mutate: mockCreateAgentSession,
  }),
}));

vi.mock("../../components/Activity/PaginatedCodingSessionsFeed", () => ({
  PaginatedCodingSessionsFeed: (props: Record<string, unknown>) => {
    mockPaginatedFeed(props);
    return <div data-testid="task-paginated-coding-sessions-feed" />;
  },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  EntityFilters: () => null,
  EntityGrid: ({ emptyMessage }: { emptyMessage?: string }) => (
    <div>{emptyMessage}</div>
  ),
  EntityListItem: () => null,
  agentSessionAdapter: {
    toEntityListItemProps: () => ({}),
  },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

describe("TaskAgentSessionsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRemoveAgentSession.mockResolvedValue(undefined);
    mockDeleteAgentSession.mockResolvedValue(undefined);
    mockTaskStatusChange.mockResolvedValue(undefined);
    mockUseAgentSessions.mockReturnValue({
      agentSessions: [],
      isLoading: false,
      remove: mockRemoveAgentSession,
    });
  });

  it("renders the task-scoped paginated feed and disables the legacy list", () => {
    render(
      <TaskAgentSessionsTab
        organizationId="org-1"
        projectId="project-1"
        initiativeId="initiative-1"
        taskId="task-1"
        taskType="STANDARD"
        relatedEntities={[]}
      />,
    );

    expect(
      screen.getByTestId("task-paginated-coding-sessions-feed"),
    ).toBeInTheDocument();
    expect(mockPaginatedFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        taskId: "task-1",
        buildSessionPath: expect.any(Function),
      }),
    );
    expect(mockUseAgentSessions).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      expect.objectContaining({ enabled: false }),
    );
  });

  it("passes a session deletion callback to the paginated feed", async () => {
    render(
      <TaskAgentSessionsTab
        organizationId="org-1"
        projectId="project-1"
        initiativeId="initiative-1"
        taskId="task-1"
        taskType="STANDARD"
        relatedEntities={[]}
      />,
    );

    const { onSessionDelete } = mockPaginatedFeed.mock.calls[0]?.[0] as {
      onSessionDelete: (sessionId: string) => Promise<void>;
    };
    await onSessionDelete("session-1");

    expect(mockDeleteAgentSession).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "session-1",
    );
  });

  it("creates a coding session with the task context and navigates to the task route", async () => {
    mockCreateAgentSession.mockResolvedValue({
      id: "session-1",
    });

    render(
      <TaskAgentSessionsTab
        organizationId="org-1"
        projectId="project-1"
        initiativeId="initiative-1"
        taskId="task-1"
        taskType="STANDARD"
        relatedEntities={[]}
        taskName="Task title"
        enableFilters={true}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));

    await waitFor(() => {
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          agentSession: expect.objectContaining({
            projectId: "project-1",
            entityType: "TASK",
            entityId: "task-1",
            title: "Task title",
            sessionDate: expect.any(String),
          }),
        }),
      );
    });

    expect(mockNavigate).toHaveBeenCalledWith(
      "/projects/project-1/tasks/task-1/agent-sessions/session-1",
    );
  });

  it("shows the create-session error inline when session creation fails", async () => {
    mockCreateAgentSession.mockRejectedValue(new Error("Creation failed"));

    render(
      <TaskAgentSessionsTab
        organizationId="org-1"
        projectId="project-1"
        initiativeId="initiative-1"
        taskId="task-1"
        taskType="STANDARD"
        relatedEntities={[]}
        taskName="Task title"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));

    expect(await screen.findByText("Creation failed")).toBeInTheDocument();
  });

  it("prompts to move backlog tasks to active before creating a session", async () => {
    mockCreateAgentSession.mockResolvedValue({
      id: "session-1",
    });

    render(
      <TaskAgentSessionsTab
        organizationId="org-1"
        projectId="project-1"
        initiativeId="initiative-1"
        taskId="task-1"
        taskType="STANDARD"
        relatedEntities={[]}
        taskName="Task title"
        taskStatus="BACKLOG"
        onTaskStatusChange={mockTaskStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));

    expect(
      screen.getByText(
        "Do you want to set this task to Active before starting a coding session?",
      ),
    ).toBeInTheDocument();
    expect(mockCreateAgentSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Set to Active" }));

    await waitFor(() => {
      expect(mockTaskStatusChange).toHaveBeenCalledWith("ACTIVE");
    });

    await waitFor(() => {
      expect(mockCreateAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          agentSession: expect.objectContaining({
            projectId: "project-1",
            entityType: "TASK",
            entityId: "task-1",
            title: "Task title",
          }),
        }),
      );
    });
  });

  it("lists every unfinished dependency and cancels without creating", () => {
    render(
      <TaskAgentSessionsTab
        organizationId="org-1"
        projectId="project-1"
        initiativeId="initiative-1"
        taskId="task-1"
        taskType="STANDARD"
        relatedEntities={[
          dependency("dependency-1", "API contract"),
          dependency("dependency-2", "Database migration"),
        ]}
        taskName="Task title"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));

    expect(screen.getByText("API contract")).toBeInTheDocument();
    expect(screen.getByText("Database migration")).toBeInTheDocument();
    expect(mockCreateAgentSession).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByTestId("task-session-dependency-warning-cancel-button"),
    );

    expect(screen.queryByText("API contract")).not.toBeInTheDocument();
    expect(mockCreateAgentSession).not.toHaveBeenCalled();
  });

  it("continues from the dependency warning into the backlog check before creation", async () => {
    mockCreateAgentSession.mockResolvedValue({ id: "session-1" });

    render(
      <TaskAgentSessionsTab
        organizationId="org-1"
        projectId="project-1"
        initiativeId="initiative-1"
        taskId="task-1"
        taskType="STANDARD"
        relatedEntities={[dependency("dependency-1", "API contract")]}
        taskName="Task title"
        taskStatus="BACKLOG"
        onTaskStatusChange={mockTaskStatusChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));
    const continueButton = screen.getByTestId(
      "task-session-dependency-warning-continue-button",
    );
    expect(continueButton).toHaveClass("MuiButton-colorWarning");
    fireEvent.click(continueButton);

    expect(
      screen.getByText(
        "Do you want to set this task to Active before starting a coding session?",
      ),
    ).toBeInTheDocument();
    expect(mockTaskStatusChange).not.toHaveBeenCalled();
    expect(mockCreateAgentSession).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Set to Active" }));

    await waitFor(() => {
      expect(mockTaskStatusChange).toHaveBeenCalledWith("ACTIVE");
      expect(mockCreateAgentSession).toHaveBeenCalledOnce();
    });
  });

  it.each(["FEATURE", "CONTRACT"])(
    "still warns for an unfinished implementation dependency when launching a %s work item",
    async (taskType) => {
      render(
        <TaskAgentSessionsTab
          organizationId="org-1"
          projectId="project-1"
          initiativeId="initiative-1"
          taskId="task-1"
          taskType={taskType}
          relatedEntities={[
            dependency("dependency-1", "Unfinished implementation"),
          ]}
          taskName="Task title"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));

      expect(screen.getByText("Unfinished implementation")).toBeInTheDocument();
      expect(mockCreateAgentSession).not.toHaveBeenCalled();
      expect(
        screen.getByTestId("task-session-dependency-warning-dialog"),
      ).toBeInTheDocument();
    },
  );

  it.each(["FEATURE", "CONTRACT"])(
    "does not warn for an unfinished %s dependency",
    async (dependencyType) => {
      mockCreateAgentSession.mockResolvedValue({ id: "session-1" });

      render(
        <TaskAgentSessionsTab
          organizationId="org-1"
          projectId="project-1"
          initiativeId="initiative-1"
          taskId="task-1"
          taskType="STANDARD"
          relatedEntities={[
            dependency("dependency-1", "Expected dependency", dependencyType),
          ]}
          taskName="Task title"
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Start New Session" }));

      await waitFor(() => {
        expect(mockCreateAgentSession).toHaveBeenCalledOnce();
      });
      expect(
        screen.queryByTestId("task-session-dependency-warning-dialog"),
      ).not.toBeInTheDocument();
    },
  );
});

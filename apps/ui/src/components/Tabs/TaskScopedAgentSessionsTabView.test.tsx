import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "@hey-hey/ui-common/api";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { TaskScopedAgentSessionsTabView } from "./TaskScopedAgentSessionsTabView";

const entityListItemMock = vi.fn();
const currentStateIndicatorMock = vi.fn();
const entityActionButtonMock = vi.fn();

vi.mock("@hey-hey/ui-common/components", () => ({
  MINI_DEMO_TARGETS: {
    startNewSessionButton: "start-new-session-button",
  },
  AgentSessionCurrentStateIndicator: (props: Record<string, unknown>) => {
    currentStateIndicatorMock(props);
    return <span data-testid="current-state-indicator" />;
  },
  EntityActionButton: ({
    verb,
    noun,
    entityType,
    loading,
    loadingLabel,
    ...buttonProps
  }: {
    verb: string;
    noun: string;
    entityType: string;
    loading?: boolean;
    loadingLabel?: string;
    onClick?: () => void;
    disabled?: boolean;
    "data-testid"?: string;
    "data-demo-target"?: string;
  }) => {
    entityActionButtonMock({ verb, noun, entityType, loading, loadingLabel });
    return (
      <button
        type="button"
        data-testid={buttonProps["data-testid"]}
        data-demo-target={buttonProps["data-demo-target"]}
        onClick={buttonProps.onClick}
        disabled={buttonProps.disabled}
      >
        {loading && loadingLabel ? loadingLabel : `${verb} ${noun}`}
      </button>
    );
  },
  EntityFilters: () => null,
  EntityGrid: ({
    items,
    renderItem,
  }: {
    items: AgentSessionDto[];
    renderItem: (session: AgentSessionDto) => React.ReactNode;
  }) => (
    <>
      {items.map((item) => (
        <React.Fragment key={item.id}>{renderItem(item)}</React.Fragment>
      ))}
    </>
  ),
  EntityListItem: (props: Record<string, unknown>) => {
    entityListItemMock(props);
    return <div>{props.statusLeadingAdornment as React.ReactNode}</div>;
  },
  agentSessionAdapter: {
    toEntityListItemProps: (session: AgentSessionDto) => ({
      status: "In Progress",
      title: session.title,
    }),
  },
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  TERMS: { AgentSession: "Agent session" },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const session: AgentSessionDto = {
  id: "session-1",
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  status: AgentSessionStatus.InProgress,
  currentState: AgentSessionCurrentState.Thinking,
  conversationId: null,
  sessionDate: "2026-08-13T00:00:00.000Z",
  title: "Coding session",
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
  type: AgentSessionType.Coding,
};

describe("TaskScopedAgentSessionsTabView", () => {
  it("composes lifecycle status, current state, and deletion on session rows", () => {
    const onDelete = vi.fn();

    render(
      <TaskScopedAgentSessionsTabView
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
        sessions={[session]}
        isLoading={false}
        searchTerm=""
        onSearchTermChange={vi.fn()}
        sortBy="created-desc"
        onSortByChange={vi.fn()}
        enableFilters={false}
        isCreatingNew={false}
        isUpdatingTaskStatus={false}
        unfinishedDependencies={[]}
        isBacklogDialogOpen={false}
        error={null}
        onStartNewSession={vi.fn()}
        onContinueDependencyWarning={vi.fn()}
        onCancelDependencyWarning={vi.fn()}
        onConfirmBacklogDialog={vi.fn()}
        onCancelBacklogDialog={vi.fn()}
        buildSessionPath={(sessionId) => `/sessions/${sessionId}`}
        onDeleteSession={() => onDelete}
      />,
    );

    expect(currentStateIndicatorMock).toHaveBeenCalledWith({
      currentState: AgentSessionCurrentState.Thinking,
      presentation: "icon",
    });
    expect(entityListItemMock).toHaveBeenCalledWith(
      expect.objectContaining({
        href: "/sessions/session-1",
        onDelete,
        status: "In Progress",
        statusLeadingAdornment: expect.anything(),
      }),
    );
  });

  const renderView = (
    overrides: Partial<
      React.ComponentProps<typeof TaskScopedAgentSessionsTabView>
    > = {},
  ) =>
    render(
      <TaskScopedAgentSessionsTabView
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
        sessions={[]}
        isLoading={false}
        searchTerm=""
        onSearchTermChange={vi.fn()}
        sortBy="created-desc"
        onSortByChange={vi.fn()}
        enableFilters={false}
        isCreatingNew={false}
        isUpdatingTaskStatus={false}
        unfinishedDependencies={[]}
        isBacklogDialogOpen={false}
        error={null}
        onStartNewSession={vi.fn()}
        onContinueDependencyWarning={vi.fn()}
        onCancelDependencyWarning={vi.fn()}
        onConfirmBacklogDialog={vi.fn()}
        onCancelBacklogDialog={vi.fn()}
        buildSessionPath={(sessionId) => `/sessions/${sessionId}`}
        onDeleteSession={() => vi.fn()}
        {...overrides}
      />,
    );

  it("starts a session from the shared Start action for an agent session", () => {
    const onStartNewSession = vi.fn();
    renderView({ onStartNewSession });

    const button = screen.getByTestId(
      "task-agent-sessions-start-new-session-button",
    );
    expect(button.getAttribute("data-demo-target")).toBe(
      "start-new-session-button",
    );
    expect(entityActionButtonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        verb: "start",
        noun: "Agent session",
        entityType: "agent_session",
      }),
    );

    fireEvent.click(button);
    expect(onStartNewSession).toHaveBeenCalledTimes(1);
  });

  it("shows the pending label and disables the action while creating or updating", () => {
    const creating = renderView({ isCreatingNew: true });
    const creatingButton = screen.getByTestId(
      "task-agent-sessions-start-new-session-button",
    ) as HTMLButtonElement;
    expect(creatingButton.textContent).toBe("Creating...");
    expect(creatingButton.disabled).toBe(true);
    creating.unmount();

    renderView({ isUpdatingTaskStatus: true });
    const updatingButton = screen.getByTestId(
      "task-agent-sessions-start-new-session-button",
    ) as HTMLButtonElement;
    expect(updatingButton.textContent).toBe("Updating...");
    expect(updatingButton.disabled).toBe(true);
  });
});

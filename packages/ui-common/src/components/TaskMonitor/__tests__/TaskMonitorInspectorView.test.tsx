import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionConfigEntityConversationV1TypeEnum,
  AgentSessionConfigEntityConversationV1VersionEnum,
  AgentSessionConfigEntityConversationV1EffortEnum,
  AgentSessionDtoProviderEnum,
  WorkStatus,
} from "../../../api";
import type { AgentSessionMetadataValues } from "../../AgentSession/AgentSessionMetadata";
import {
  readSurfaceSelection,
  TASK_MONITOR_SETUP_SURFACE_ID,
} from "../../AgentSession/surfaceSelectionMemory";
import {
  resetModelSelectionFavoritesForTests,
  saveModelSelectionFavorite,
} from "../../AgentSession/modelSelectionFavorites";
import { ConversationStartRunRequestDtoProviderEnum } from "../../../api";
import { TaskMonitorInspectorView } from "../TaskMonitorInspectorView";
import type { TaskMonitorProjectedNode } from "../useTaskMonitorProjection";
import {
  createSession,
  createTask,
  firstTaskId,
  sessionId,
} from "./taskMonitorTestFixtures";

const { useTaskMonitorConversationMock } = vi.hoisted(() => ({
  useTaskMonitorConversationMock: vi.fn(),
}));

vi.mock("../useTaskMonitorSessionReports", () => ({
  useTaskMonitorConversation: useTaskMonitorConversationMock,
}));

vi.mock("../TaskMonitorConversationPane", () => ({
  TaskMonitorConversationPane: (props: {
    title: string;
    loading: boolean;
    fetched: boolean;
    errorMessage: string | null;
    emptyMessage: string;
    sessionHref?: string;
    agentSessionMetadata?: AgentSessionMetadataValues;
    contentAfter?: ReactNode;
  }) => (
    <div
      data-testid="mock-conversation-pane"
      data-loading={String(props.loading)}
      data-fetched={String(props.fetched)}
      data-error={props.errorMessage ?? ""}
      data-session-href={props.sessionHref ?? ""}
    >
      {props.sessionHref ? (
        <a
          href={props.sessionHref}
          data-testid="task-monitor-session-title-link"
        >
          {props.title}
        </a>
      ) : (
        props.title
      )}
      {props.agentSessionMetadata ? (
        <div
          data-testid="mock-session-metadata"
          data-model={props.agentSessionMetadata.model}
          data-effort={props.agentSessionMetadata.effort ?? ""}
        />
      ) : null}
      <span>{props.emptyMessage}</span>
      {props.contentAfter}
    </div>
  ),
}));

vi.mock("../TaskMonitorSessionActivityIndicator", () => ({
  TaskMonitorSessionActivityIndicator: ({
    agentSessionId,
  }: {
    agentSessionId: string | null;
  }) => (
    <div data-testid="mock-session-activity">{agentSessionId ?? "none"}</div>
  ),
}));

const node = (
  overrides: Partial<TaskMonitorProjectedNode> = {}
): TaskMonitorProjectedNode => ({
  position: 0,
  taskId: firstTaskId,
  dependsOnTaskIds: [],
  isCursor: true,
  task: { kind: "loaded", task: createTask(firstTaskId, "Canonical task") },
  session: { kind: "loaded", session: createSession() },
  visualStatus: "active",
  launchConfiguration: {
    method: "quick",
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    fastMode: false,
  },
  ...overrides,
});

describe("TaskMonitorInspectorView", () => {
  const saveLaunchConfiguration = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    resetModelSelectionFavoritesForTests();
    useTaskMonitorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      loading: false,
      fetched: true,
      errorMessage: null,
    });
  });

  it("renders the selected session through the canonical conversation pane", () => {
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node()}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    expect(
      screen.getByTestId("task-monitor-session-title-link")
    ).toHaveTextContent("Second task session");
    expect(
      screen.getByTestId("task-monitor-session-title-link")
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
    );
    expect(
      screen.queryByTestId("task-monitor-open-session")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("task-monitor-waiting-for-session")
    ).not.toBeInTheDocument();
  });

  it("preserves loading and failed-read state from the conversation query", () => {
    useTaskMonitorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      loading: true,
      fetched: false,
      errorMessage: "The canonical conversation could not be loaded.",
    });
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node()}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    expect(screen.getByTestId("mock-conversation-pane")).toHaveAttribute(
      "data-loading",
      "true"
    );
    expect(screen.getByTestId("mock-conversation-pane")).toHaveAttribute(
      "data-error",
      "The canonical conversation could not be loaded."
    );
  });

  it("passes durable session metadata to the conversation pane", () => {
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node({
          session: {
            kind: "loaded",
            session: {
              ...createSession(),
              provider: AgentSessionDtoProviderEnum.Codex,
              config: {
                type: AgentSessionConfigEntityConversationV1TypeEnum.EntityConversation,
                version: AgentSessionConfigEntityConversationV1VersionEnum.V1,
                model: "gpt-5-codex",
                effort: AgentSessionConfigEntityConversationV1EffortEnum.High,
              },
            },
          },
        })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    expect(screen.getByTestId("mock-session-metadata")).toHaveAttribute(
      "data-model",
      "gpt-5-codex"
    );
    expect(screen.getByTestId("mock-session-metadata")).toHaveAttribute(
      "data-effort",
      "high"
    );
  });

  it("keeps session navigation available when no conversation exists", () => {
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node()}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    expect(screen.getByTestId("mock-conversation-pane")).toHaveTextContent(
      "This session does not have a conversation."
    );
    expect(
      screen.getByTestId("task-monitor-session-title-link")
    ).toHaveAttribute(
      "href",
      "/projects/project-1/resolve-agent-session-by-id/33333333-3333-4333-8333-333333333333"
    );
  });

  it("binds activity presentation to the selected session conversation", () => {
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node({
          session: {
            kind: "loaded",
            session: {
              ...createSession(),
              conversationId: "44444444-4444-4444-8444-444444444444",
            },
          },
        })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    expect(screen.getByTestId("mock-session-activity")).toHaveTextContent(
      sessionId
    );
  });

  it("shows waiting progress for a running monitor cursor without a session", () => {
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node({ session: { kind: "none" } })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    expect(
      screen.getByTestId("task-monitor-waiting-for-session")
    ).toHaveTextContent("Waiting for session to start");
    expect(
      screen.getByRole("progressbar", {
        name: "Waiting for session to start",
      })
    ).toBeVisible();
    expect(
      screen.queryByTestId("mock-conversation-pane")
    ).not.toBeInTheDocument();
  });

  it("saves method changes against the selected task's canonical configuration", async () => {
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Backlog}
        node={node({ session: { kind: "none" } })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Method" }));
    fireEvent.click(screen.getByRole("option", { name: "Plan" }));

    await waitFor(() =>
      expect(saveLaunchConfiguration).toHaveBeenCalledWith(firstTaskId, {
        method: "plan",
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        fastMode: false,
      })
    );
    expect(readSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID)).toEqual({
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
      fastMode: false,
    });
  });

  it("saves explicit Fast mode against the reopened task configuration", async () => {
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Backlog}
        node={node({ session: { kind: "none" } })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    fireEvent.click(
      screen.getByTestId("task-monitor-node-runtime-fast-mode-switch")
    );

    await waitFor(() =>
      expect(saveLaunchConfiguration).toHaveBeenCalledWith(
        firstTaskId,
        expect.objectContaining({ fastMode: true })
      )
    );
  });

  it("applies a shared favorite through the canonical queued save path", async () => {
    saveModelSelectionFavorite("Claude focused", {
      provider: ConversationStartRunRequestDtoProviderEnum.Claude,
      model: "claude-sonnet-5-5",
      reasoningEffort: "medium",
    });
    render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Backlog}
        node={node({ session: { kind: "none" } })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );

    fireEvent.mouseDown(
      screen.getByRole("combobox", { name: "Favorite" })
    );
    fireEvent.click(screen.getByRole("option", { name: "Claude focused" }));

    await waitFor(() =>
      expect(saveLaunchConfiguration).toHaveBeenLastCalledWith(firstTaskId, {
        method: "quick",
        provider: "claude",
        model: "claude-sonnet-5-5",
        reasoningEffort: "medium",
      })
    );
  });

  it("renders explicit missing canonical records", () => {
    const { rerender } = render(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node({ task: { kind: "missing" } })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );
    expect(
      screen.getByTestId("task-monitor-inspector-missing-task")
    ).toBeVisible();

    rerender(
      <TaskMonitorInspectorView
        organizationId="org-1"
        projectId="project-1"
        monitorStatus={WorkStatus.Active}
        node={node({ session: { kind: "missing" } })}
        isSavingLaunchConfiguration={false}
        onSaveLaunchConfiguration={saveLaunchConfiguration}
      />
    );
    expect(
      screen.getByTestId("task-monitor-inspector-missing-session")
    ).toBeVisible();
  });
});

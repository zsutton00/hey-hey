import type { WorkItemExecutionStateResult } from "../../../data/hooks/useWorkItemExecutionState";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageType,
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  WorkStatus,
  type CreateUserMessage,
} from "../../../api";
import { TaskMonitorWorkspaceView } from "../TaskMonitorWorkspaceView";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../api";
import type { TaskMonitorProjectedNode } from "../useTaskMonitorProjection";
import type { ConversationFormResolver } from "../../Conversation/Components/conversationFormTypes";
import {
  createSession,
  createTask,
  createTaskMonitorDefinition,
  firstTaskId,
  sessionId,
} from "./taskMonitorTestFixtures";

const {
  bindGraphConversationAgentSessionMachineMock,
  submitStopRunViaPlatformMock,
  useTaskMonitorCoordinatorConversationMock,
  useTaskMonitorConversationFormResolverMock,
  capturedReplyMessages,
  randomUUIDMock,
  useReportsMock,
  captureFormResolver,
} = vi.hoisted(() => ({
  bindGraphConversationAgentSessionMachineMock: vi.fn(),
  submitStopRunViaPlatformMock: vi.fn(),
  useTaskMonitorCoordinatorConversationMock: vi.fn(),
  useTaskMonitorConversationFormResolverMock: vi.fn(),
  capturedReplyMessages: [] as CreateUserMessage[],
  randomUUIDMock: vi.fn(),
  useReportsMock: vi.fn(),
  captureFormResolver: vi.fn(),
}));

vi.mock("../../../data/hooks/useReports", () => ({
  useReports: useReportsMock,
}));
vi.mock(
  "../../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({
    bindGraphConversationAgentSessionMachine:
      bindGraphConversationAgentSessionMachineMock,
  }),
);

vi.mock("../../AgentSession/runtime/hooks/submitStopRunViaPlatform", () => ({
  submitStopRunViaPlatform: submitStopRunViaPlatformMock,
}));

vi.mock("../useTaskMonitorSessionReports", () => ({
  useTaskMonitorCoordinatorConversation:
    useTaskMonitorCoordinatorConversationMock,
  useTaskMonitorConversation: () => ({
    conversation: null,
    project: null,
    session: null,
    loading: false,
    fetched: true,
    errorMessage: null,
  }),
}));

vi.mock("../useTaskMonitorConversationFormResolver", () => ({
  useTaskMonitorConversationFormResolver:
    useTaskMonitorConversationFormResolverMock,
}));

vi.mock("../TaskMonitorSessionActivityIndicator", () => ({
  TaskMonitorSessionActivityIndicator: ({
    agentSessionId,
  }: {
    agentSessionId: string | null;
  }) => (
    <div
      data-testid="task-monitor-session-activity"
      data-agent-session-id={agentSessionId ?? ""}
    />
  ),
}));

vi.mock("../../AgentSession", () => ({
  AgentConversationView: ({
    agentSessionId,
    conversationId,
    taskMonitorId,
    conversationFormResolver,
    buildReplyMessage,
    onStopRun,
    scrollable,
    stoppingRun,
    onDraftChange,
  }: {
    agentSessionId: string;
    conversationId: string;
    taskMonitorId?: string;
    conversationFormResolver?: ConversationFormResolver;
    buildReplyMessage?: (text: string) => CreateUserMessage;
    onStopRun: () => void;
    scrollable: boolean;
    stoppingRun: boolean;
    onDraftChange?: (draft: string) => void;
  }) => {
    captureFormResolver(conversationFormResolver);
    return (
      <div
        data-testid="agent-conversation-view"
        data-agent-session-id={agentSessionId}
        data-conversation-id={conversationId}
        data-task-monitor-id={taskMonitorId}
        data-form-resolver={conversationFormResolver ? "provided" : "missing"}
        data-scrollable={scrollable || undefined}
      >
        <textarea
          data-testid="workspace-draft"
          onChange={(event) => onDraftChange?.(event.target.value)}
        />
        Reply composer
        <button
          data-testid="task-monitor-reply-submit"
          onClick={() => {
            const message = buildReplyMessage?.("  Check the next task  ");
            if (message) capturedReplyMessages.push(message);
          }}
        >
          Send reply
        </button>
        <button onClick={onStopRun} disabled={stoppingRun}>
          Stop
        </button>
      </div>
    );
  },
}));

const selectedNode: TaskMonitorProjectedNode = {
  position: 0,
  taskId: firstTaskId,
  dependsOnTaskIds: [],
  launchConfiguration: {
    method: "quick",
    provider: "codex",
    model: "gpt-5.5",
    reasoningEffort: "high",
  },
  isCursor: true,
  task: { kind: "loaded", task: createTask(firstTaskId, "Current task") },
  session: { kind: "loaded", session: createSession() },
  visualStatus: "active",
};

const readyMachine: MachineDto = {
  machineId: "machine-1",
  name: "Ready machine",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};

const retainedState = (
  phase: "running" | "paused" | "attention" | "done" | "halted",
): WorkItemExecutionStateResult => ({
  status: "retained",
  delivery: "LIVE",
  revision: 1,
  ownerMachineId: "machine-1",
  acceptedAt: "2026-11-18T12:00:00Z",
  freshness: { status: "CURRENT", changedAt: "2026-11-18T12:00:00Z" },
  state: {
    type: "TASK_MONITOR",
    projection: {
      execution: {
        lifecycle:
          phase === "done"
            ? "COMPLETED"
            : phase === "halted"
              ? "HALTED"
              : "RUNNING",
        control:
          phase === "done" || phase === "halted"
            ? null
            : phase === "paused"
              ? "PAUSED"
              : "ACTIVE",
        work: phase === "done" || phase === "halted" ? null : "OBSERVING_RUN",
        intervention:
          phase === "done" || phase === "halted"
            ? null
            : phase === "attention"
              ? "PENDING"
              : "CLEAR",
      },
      availableActions:
        phase === "paused"
          ? [{ kind: "PAUSED_CONTINUATION", command: "RESUME" }]
          : phase === "done" || phase === "halted"
            ? []
            : [{ kind: "PAUSE", command: "PAUSE" }],
    },
  },
});

const workspaceElement = (
  overrides: Partial<
    React.ComponentProps<typeof TaskMonitorWorkspaceView>
  > = {},
) => (
  <TaskMonitorWorkspaceView
    organizationId="org-1"
    projectId="project-1"
    monitorId="66666666-6666-4666-8666-666666666666"
    monitorSessionDate="2026-07-20T00:00:00.000Z"
    monitorName="Release monitor"
    monitorStatus={WorkStatus.Active}
    definition={createTaskMonitorDefinition()}
    nodes={[selectedNode]}
    isLoading={false}
    startPresentation={{ status: "ready" }}
    isSavingLaunchConfiguration={false}
    onSaveLaunchConfiguration={vi.fn()}
    pendingLifecycleAction={null}
    errorMessage={null}
    operationalErrorMessage={null}
    commandOutcome={null}
    machines={[readyMachine]}
    selectedMachineId={readyMachine.machineId}
    onSelectMachine={vi.fn()}
    onStart={vi.fn()}
    onPause={vi.fn()}
    activePane="monitor"
    {...overrides}
  />
);

const renderWorkspace = (
  overrides: Partial<
    React.ComponentProps<typeof TaskMonitorWorkspaceView>
  > = {},
) => render(workspaceElement(overrides));

const generatedStylesFor = (element: HTMLElement) => {
  const classNames = element.className.split(/\s+/).filter(Boolean);
  return [...document.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .filter((text) =>
      classNames.some((className) => text.includes(`.${className}`)),
    )
    .join("\n");
};

describe("TaskMonitorWorkspaceView", () => {
  beforeEach(() => {
    useReportsMock.mockReturnValue({
      reports: [],
      isLoading: false,
      error: null,
    });
    bindGraphConversationAgentSessionMachineMock.mockReset();
    bindGraphConversationAgentSessionMachineMock.mockResolvedValue(
      createSession(),
    );
    submitStopRunViaPlatformMock.mockReset();
    submitStopRunViaPlatformMock.mockResolvedValue({ ok: true });
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: null,
      loading: false,
      fetched: true,
      errorMessage: null,
    });
    useTaskMonitorConversationFormResolverMock.mockReturnValue(vi.fn());
    capturedReplyMessages.length = 0;
    randomUUIDMock.mockReset();
    randomUUIDMock
      .mockReturnValueOnce("correlation-1")
      .mockReturnValueOnce("correlation-2");
    vi.stubGlobal("crypto", { randomUUID: randomUUIDMock });
  });

  it("does not offer setup selection after the launch choice is saved", () => {
    renderWorkspace();

    expect(
      screen.queryByTestId("task-monitor-review-mode"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("task-monitor-launch-configuration"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("task-monitor-runtime-model"),
    ).not.toBeInTheDocument();
  });

  it("does not render redundant cursor labels", () => {
    renderWorkspace();

    expect(screen.queryByText("Cursor 0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-monitor-cursor")).not.toBeInTheDocument();
  });

  it("renders no monitor title or status chip, leaving lifecycle state to the control dock", () => {
    renderWorkspace();

    expect(screen.queryByTestId("task-monitor-name")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-monitor-status")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-monitor-control-dock")).toBeVisible();
  });

  it("orders Steps, Task Monitor, and Active Session for responsive layout", () => {
    renderWorkspace();

    expect(screen.getByTestId("task-monitor-workspace")).toHaveStyle({
      height: "100%",
      minHeight: 0,
    });
    const layout = screen.getByTestId("task-monitor-workspace-layout");
    expect(generatedStylesFor(layout)).toMatch(
      /grid-template-columns:minmax\(0, 28%\) minmax\(0, 1fr\) minmax\(0, 1fr\);/,
    );
    expect(layout.children[0]).toBe(
      screen.getByTestId("task-monitor-steps-surface"),
    );
    expect(layout.children[1]).toBe(
      screen.getByTestId("task-monitor-coordinator-pane"),
    );
    expect(layout.children[2]).toBe(
      screen.getByTestId("task-monitor-inspector-pane"),
    );
  });

  it.each([
    ["steps", "task-monitor-steps-surface"],
    ["monitor", "task-monitor-coordinator-pane"],
    ["session", "task-monitor-inspector-pane"],
  ] as const)(
    "keeps %s as the active compact pane",
    (activePane, activeSurfaceTestId) => {
      renderWorkspace({ activePane });

      for (const surfaceTestId of [
        "task-monitor-steps-surface",
        "task-monitor-coordinator-pane",
        "task-monitor-inspector-pane",
      ]) {
        const styles = generatedStylesFor(screen.getByTestId(surfaceTestId));
        const expectedDisplay =
          surfaceTestId === activeSurfaceTestId
            ? "display:flex"
            : "display:none";

        expect(styles).toContain("@media (min-width:0px)");
        expect(styles).toContain(expectedDisplay);
      }
    },
  );

  it("places the machine picker with monitor setup and Start", () => {
    renderWorkspace({ monitorStatus: WorkStatus.Backlog });

    const stepsPane = screen.getByTestId("task-monitor-coordinator-pane");
    const start = screen.getByTestId("task-monitor-start");
    const machinePicker = screen.getByTestId("machine-picker");

    expect(stepsPane).toContainElement(start);
    expect(stepsPane).toContainElement(machinePicker);
    expect(
      start.compareDocumentPosition(machinePicker) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("binds the coordinator session to the selected machine before Start", async () => {
    const onStart = vi.fn();
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: createSession(),
      loading: false,
      fetched: true,
      errorMessage: null,
    });
    renderWorkspace({ monitorStatus: WorkStatus.Backlog, onStart });

    fireEvent.click(screen.getByTestId("task-monitor-start"));

    await waitFor(() =>
      expect(bindGraphConversationAgentSessionMachineMock).toHaveBeenCalledWith(
        {
          organizationId: "org-1",
          projectId: "project-1",
          agentSessionId: sessionId,
          machineId: "machine-1",
        },
      ),
    );
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(
      bindGraphConversationAgentSessionMachineMock.mock.invocationCallOrder[0],
    ).toBeLessThan(onStart.mock.invocationCallOrder[0]);
  });

  it("does not submit Start when coordinator machine binding fails", async () => {
    const onStart = vi.fn();
    bindGraphConversationAgentSessionMachineMock.mockRejectedValue(
      new Error("Coordinator binding was rejected."),
    );
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: createSession(),
      loading: false,
      fetched: true,
      errorMessage: null,
    });
    renderWorkspace({ monitorStatus: WorkStatus.Backlog, onStart });

    fireEvent.click(screen.getByTestId("task-monitor-start"));

    expect(
      await screen.findByTestId("task-monitor-start-error"),
    ).toHaveTextContent("Coordinator binding was rejected.");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("explains how to start the coordinator before its conversation exists", () => {
    renderWorkspace({ monitorStatus: WorkStatus.Backlog });

    const prestartGuide = screen.getByTestId(
      "task-monitor-coordinator-prestart",
    );
    expect(prestartGuide).toHaveTextContent("Ready to start");
    expect(prestartGuide).toHaveTextContent("How it works");
    expect(prestartGuide).toHaveTextContent(
      "Choose a paired CLI machine, and press Start.",
    );
    expect(prestartGuide).toHaveTextContent(
      "The coordinator works through the steps you've selected in order",
    );
    expect(prestartGuide).toHaveTextContent(
      "Follow its live updates and reply to guide it when needed.",
    );
    expect(prestartGuide).toHaveTextContent(
      "Active Session shows the session for the current step.",
    );
    expect(
      screen.queryByText(
        "The coordinator conversation could not be loaded after the monitor started.",
      ),
    ).not.toBeInTheDocument();
  });

  it("keeps the selected session conversation in its owned scroll container", () => {
    renderWorkspace();

    expect(
      screen.getByTestId("task-monitor-current-session-scroll-container"),
    ).toBeVisible();
  });

  it("renders the coordinator through the shared conversation surface", () => {
    const coordinatorConversationId = "44444444-4444-4444-8444-444444444444";
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: {
        ...createSession(),
        conversationId: coordinatorConversationId,
      },
      loading: false,
      fetched: true,
      errorMessage: null,
    });

    renderWorkspace();

    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-agent-session-id",
      sessionId,
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-conversation-id",
      coordinatorConversationId,
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-task-monitor-id",
      "66666666-6666-4666-8666-666666666666",
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-form-resolver",
      "provided",
    );
    expect(useTaskMonitorConversationFormResolverMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "66666666-6666-4666-8666-666666666666",
      selectedMachineId: "machine-1",
    });
    expect(screen.getByText("Reply composer")).toBeVisible();
  });

  it("builds canonical human Task Monitor USER messages with fresh correlations", () => {
    const coordinatorConversationId = "44444444-4444-4444-8444-444444444444";
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: {
        ...createSession(),
        conversationId: coordinatorConversationId,
      },
      loading: false,
      fetched: true,
      errorMessage: null,
    });

    renderWorkspace();
    fireEvent.click(screen.getByTestId("task-monitor-reply-submit"));
    fireEvent.click(screen.getByTestId("task-monitor-reply-submit"));

    expect(capturedReplyMessages).toHaveLength(2);
    expect(capturedReplyMessages[0]).toMatchObject({
      projectId: "project-1",
      conversationId: coordinatorConversationId,
      type: MessageType.User,
      data: {
        agentInput: {
          monitorId: "66666666-6666-4666-8666-666666666666",
          userMessage: "Check the next task",
          cause: "CONTINUE",
          promptType: "task_monitor",
          correlationId: "correlation-1",
        },
      },
    });
    expect(capturedReplyMessages[1]).toMatchObject({
      data: {
        agentInput: expect.objectContaining({
          correlationId: "correlation-2",
        }),
      },
    });
    expect(capturedReplyMessages[0].data.agentInput).not.toHaveProperty(
      "provenance",
    );
    expect(capturedReplyMessages[0].data.agentInput).not.toHaveProperty(
      "sourceUserMessageId",
    );
    expect(capturedReplyMessages[0].data.agentInput).not.toHaveProperty(
      "handlerPromptType",
    );
    expect(capturedReplyMessages[0].data).not.toHaveProperty("triggersAgent");
  });

  it("routes coordinator stop requests through the platform lifecycle", async () => {
    const coordinatorConversationId = "44444444-4444-4444-8444-444444444444";
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: {
        ...createSession(),
        conversationId: coordinatorConversationId,
      },
      loading: false,
      fetched: true,
      errorMessage: null,
    });

    renderWorkspace();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    await waitFor(() => {
      expect(submitStopRunViaPlatformMock).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          projectId: "project-1",
          agentSessionId: sessionId,
          conversationId: coordinatorConversationId,
          runId: sessionId,
        }),
      );
    });
  });

  it("shows waiting progress for the running cursor task before its session exists", () => {
    renderWorkspace({
      nodes: [{ ...selectedNode, session: { kind: "none" } }],
    });

    expect(
      screen.getByTestId("task-monitor-waiting-for-session"),
    ).toHaveTextContent("Waiting for session to start");
    expect(
      screen.getByRole("progressbar", {
        name: "Waiting for session to start",
      }),
    ).toBeVisible();
  });

  it("passes transient Start progress to the control", () => {
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      startPresentation: { status: "starting" },
    });

    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
    expect(screen.getByTestId("task-monitor-start-progress")).toBeVisible();
  });

  it("passes canonical Pause presentation and callback through the workspace", () => {
    const onPause = vi.fn();
    renderWorkspace({ onPause, executionState: retainedState("running") });
    fireEvent.click(screen.getByTestId("task-monitor-open-monitor"));

    fireEvent.click(screen.getByTestId("task-monitor-pause"));

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
  });

  it("passes pending Resume presentation through Start without changing canonical status", () => {
    renderWorkspace({
      monitorStatus: WorkStatus.OnHold,
      pendingLifecycleAction: "RESUME",
    });

    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
    expect(screen.getByTestId("task-monitor-start-progress")).toBeVisible();
    expect(screen.queryByTestId("task-monitor-resume")).not.toBeInTheDocument();
  });

  it("reuses the typed outcome alert for rejected lifecycle commands", () => {
    renderWorkspace({
      commandOutcome: {
        commandId: "command-1",
        status: SubmitTaskMonitorCommandResponseDtoStatusEnum.Rejected,
        message: "The lifecycle command was rejected.",
      },
    });

    expect(
      screen.getByTestId("task-monitor-command-outcome"),
    ).toHaveTextContent("The lifecycle command was rejected.");
  });

  it("keeps refresh failures explicit and retryable from canonical pre-start state", () => {
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      startPresentation: { status: "ready" },
      operationalErrorMessage: "Canonical monitor refresh failed.",
    });

    expect(screen.getByTestId("task-monitor-start-error")).toHaveTextContent(
      "Canonical monitor refresh failed.",
    );
    expect(screen.getByTestId("task-monitor-start")).toBeEnabled();
  });
  it("moves from setup to running, signals attention without opening, and exposes completion evidence", async () => {
    const { rerender } = renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      executionState: { status: "missing", delivery: "LIVE" },
    });
    expect(
      screen.queryByTestId("task-monitor-open-session"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-monitor-pause")).not.toBeInTheDocument();
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    rerender(
      workspaceElement({
        monitorStatus: WorkStatus.Active,
        executionState: { status: "missing", delivery: "LIVE" },
        startPresentation: { status: "starting" },
      }),
    );
    expect(screen.getByTestId("task-monitor-workspace")).toHaveAttribute(
      "data-phase",
      "setup",
    );
    expect(
      screen.queryByTestId("task-monitor-open-session"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();

    rerender(workspaceElement({ executionState: retainedState("running") }));
    await waitFor(() =>
      expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
        "aria-pressed",
        "false",
      ),
    );
    const inspector = screen.getByTestId("task-monitor-current-session");
    rerender(workspaceElement({ executionState: retainedState("attention") }));
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    fireEvent.click(screen.getByTestId("task-monitor-open-monitor"));
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("task-monitor-open-steps")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("task-monitor-current-session")).toBe(inspector);
    // A new delivery of the same meaningful state must preserve manual expansion.
    rerender(
      workspaceElement({
        executionState: { ...retainedState("attention"), revision: 9 },
      }),
    );
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByTestId("task-monitor-close-monitor"));
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    rerender(workspaceElement({ executionState: retainedState("done") }));
    await waitFor(() =>
      expect(screen.getByTestId("task-monitor-workspace")).toHaveAttribute(
        "data-phase",
        "done",
      ),
    );
    expect(screen.getByTestId("task-monitor-open-session")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("task-monitor-result-session")).toHaveAttribute(
      "href",
      expect.stringContaining(sessionId),
    );
    expect(
      screen.getByTestId("task-monitor-result-evidence"),
    ).toHaveTextContent("No report available");
    expect(
      screen.getByTestId("task-monitor-result-evidence"),
    ).not.toHaveTextContent("Accepted");
  });

  it("keeps a focused draft and session identity through cursor advance, attention and completion", async () => {
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      session: {
        ...createSession(),
        conversationId: "coordinator-conversation",
      },
      loading: false,
      fetched: true,
      errorMessage: null,
    });
    const { rerender } = renderWorkspace({
      executionState: retainedState("running"),
    });
    fireEvent.click(screen.getByTestId("task-monitor-open-monitor"));
    const draft = screen.getByTestId("workspace-draft");
    const inspector = screen.getByTestId("task-monitor-current-session");
    draft.focus();
    fireEvent.change(draft, { target: { value: "Unsent guidance" } });
    fireEvent.compositionStart(draft);
    const nextNode = {
      ...selectedNode,
      taskId: "next-task",
      session: {
        kind: "loaded" as const,
        session: { ...createSession(), id: "next-session" },
      },
    };
    rerender(
      workspaceElement({
        executionState: retainedState("attention"),
        nodes: [nextNode],
      }),
    );
    rerender(
      workspaceElement({
        executionState: retainedState("done"),
        nodes: [nextNode],
      }),
    );
    expect(screen.getByTestId("task-monitor-workspace")).toHaveAttribute(
      "data-phase",
      "running",
    );
    expect(screen.getByTestId("task-monitor-current-session")).toBe(inspector);
    expect(draft).toHaveFocus();
    expect(draft).toHaveValue("Unsent guidance");
    fireEvent.change(draft, { target: { value: "" } });
    fireEvent.compositionEnd(draft);
    draft.blur();
    await waitFor(() =>
      expect(screen.getByTestId("task-monitor-workspace")).toHaveAttribute(
        "data-phase",
        "done",
      ),
    );
    expect(screen.getByTestId("workspace-draft")).toBe(draft);
  });

  it("does not offer lifecycle actions from a stale snapshot or session completion", () => {
    const state = retainedState("paused");
    if (state.status !== "retained") {
      throw new Error("Expected retained fixture");
    }
    renderWorkspace({ executionState: { ...state, delivery: "INTERRUPTED" } });
    fireEvent.click(screen.getByTestId("task-monitor-open-monitor"));
    expect(screen.getByTestId("task-monitor-state-stale")).toBeVisible();
    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
    expect(screen.getByTestId("task-monitor-pause")).toBeDisabled();
  });
  it("redocks only after an accepted guidance response and preserves rejected drafts", async () => {
    const submit = vi
      .fn()
      .mockRejectedValueOnce(new Error("Judgment is stale"))
      .mockResolvedValueOnce(undefined);
    useTaskMonitorConversationFormResolverMock.mockReturnValue(() => ({
      uiElements: [],
      disabled: false,
      isSubmitted: false,
      submit,
    }));
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      session: {
        ...createSession(),
        conversationId: "coordinator-conversation",
      },
      loading: false,
      fetched: true,
      errorMessage: null,
    });
    renderWorkspace({ executionState: retainedState("attention") });
    fireEvent.click(screen.getByTestId("task-monitor-open-monitor"));
    const draft = screen.getByTestId("workspace-draft");
    fireEvent.change(draft, { target: { value: "Preserve this discussion" } });
    fireEvent.click(screen.getByTestId("task-monitor-reply-submit"));
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const message = {
      message: {
        id: "judgment-request",
        projectId: "project-1",
        conversationId: "coordinator-conversation",
        type: "SYSTEM",
        status: "OPEN",
        data: {
          type: "TASK_MONITOR_SUPERVISION",
          agentIdentity: "task-monitor-coordinator",
          response: "Review the access-control evidence",
          outcome: "JUDGMENT_REQUESTED",
          rationale: "Access-control evidence is inconclusive",
          guidance: "Choose whether to request changes",
        },
        createdAt: "2026-11-18T12:00:00Z",
        awaitingResponse: true,
        responses: [],
      },
      state: "awaiting_response",
      canEdit: true,
      data: {},
    };
    const resolve = captureFormResolver.mock.lastCall?.[0];
    const form = resolve(message);
    await expect(form.submit({ decision: "request_changes" })).rejects.toThrow(
      "Judgment is stale",
    );
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(draft).toHaveValue("Preserve this discussion");
    await act(async () => {
      await form.submit({ decision: "request_changes" });
    });
    expect(screen.getByTestId("task-monitor-open-monitor")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByTestId("workspace-draft")).toBe(draft);
    expect(draft).toHaveValue("Preserve this discussion");
  });
  it("links available canonical reports without turning session completion into acceptance", () => {
    useReportsMock.mockReturnValue({
      isLoading: false,
      error: null,
      reports: [
        {
          id: "canonical-report",
          organizationId: "org-1",
          projectId: "project-1",
          title: "Access-control implementation evidence",
          reportType: "IMPLEMENT",
          audience: "PROJECT_VISIBLE",
          version: 1,
          schemaVersion: 1,
          sourceExecutionId: sessionId,
          createdAt: "2026-11-18T12:00:00Z",
          expiresAt: null,
          payload: {
            reportType: "IMPLEMENT",
            summary:
              "Access-control checks pass for owner and non-owner accounts with realistic stored conversations.",
            filesChanged: ["src/conversations.ts"],
          },
          entities: [
            {
              entityId: sessionId,
              entityType: "AGENT_SESSION",
              relation: "PRIMARY",
            },
          ],
        },
      ],
    });
    renderWorkspace({ executionState: retainedState("done") });
    expect(screen.getByTestId("task-monitor-result-report")).toHaveAttribute(
      "href",
      "/projects/project-1/reports/canonical-report",
    );
    expect(screen.getByTestId("task-monitor-result-report")).toHaveTextContent(
      "Access-control implementation evidence",
    );
    expect(
      screen.getByTestId("task-monitor-result-evidence"),
    ).not.toHaveTextContent("Accepted");
  });
});

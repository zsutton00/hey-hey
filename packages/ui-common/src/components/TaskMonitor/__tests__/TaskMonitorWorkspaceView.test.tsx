import type { WorkItemExecutionStateResult } from "../../../data/hooks/useWorkItemExecutionState";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageType,
  SubmitTaskMonitorCommandResponseDtoStatusEnum,
  TaskMonitorReviewMode,
  WorkStatus,
  type CreateUserMessage,
  type TaskMonitorExecutionDefinition,
} from "../../../api";
import { TaskMonitorWorkspaceView } from "../TaskMonitorWorkspaceView";
import { CapsuleScreenButtonControl } from "../../ActionsCapsule/CapsuleScreenButtonControl";
import { useActionsCapsule } from "../../ActionsCapsule/ActionsCapsuleContext";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../api";
import type { TaskMonitorProjectedNode } from "../useTaskMonitorProjection";
import type { TaskMonitorTaskServicesControl } from "../taskMonitorStartReadiness";
import { http, HttpResponse } from "msw";
import type { ConversationFormResolver } from "../../Conversation/Components/conversationFormTypes";
import { setCapabilityCatalogForTests } from "../../AgentSession/capabilityCatalog";
import { TEST_CAPABILITY_CATALOG } from "../../../test/capabilityCatalogFixture";
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

const CapsuleScreenButtons = () => {
  const { screenButtons } = useActionsCapsule();
  return screenButtons.map((button) => (
    <CapsuleScreenButtonControl
      key={button.key}
      button={button}
      onClick={button.onClick}
    />
  ));
};

const noMissingServices: TaskMonitorTaskServicesControl = {
  updatingTaskIds: [],
  errorsByTaskId: {},
  onChange: vi.fn(),
};

// Every task card reads the project's Services to name the task's own.
beforeEach(() => {
  globalThis.mswServer.use(
    http.get("*/organizations/:organizationId/services", () =>
      HttpResponse.json({ data: [] }),
    ),
  );
});

const workspaceElement = (
  overrides: Partial<
    React.ComponentProps<typeof TaskMonitorWorkspaceView>
  > = {},
) => (
  <ActionsCapsuleProvider>
    <CapsuleScreenButtons />
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
      onSaveCoordinatorRuntime={vi.fn()}
      onSaveReviewRuntime={vi.fn()}
      onSaveLaunchPolicy={vi.fn().mockResolvedValue(undefined)}
      onApplyToUnstartedTasks={vi.fn()}
      startMessage=""
      onChangeStartMessage={vi.fn()}
      taskServices={noMissingServices}
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
  </ActionsCapsuleProvider>
);

const lifecycleButton = (label: "Start" | "Pause") =>
  screen.getByRole("button", { name: label });

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

  it("shows Review mode read-only and offers no setup selection after Start", () => {
    renderWorkspace();

    const reviewMode = screen.getByTestId("task-monitor-review-mode");
    for (const option of within(reviewMode).getAllByRole("radio")) {
      expect(option).toBeDisabled();
    }
    expect(
      screen.queryByTestId("task-monitor-prestart-settings"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("task-monitor-apply-unstarted"),
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
    expect(
      screen.queryByTestId("task-monitor-control-dock"),
    ).not.toBeInTheDocument();
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

  it("offers Start in the Action Capsule and on the Ready card, enabled together", () => {
    renderWorkspace({ monitorStatus: WorkStatus.Backlog });

    const start = lifecycleButton("Start");
    const readyStart = screen.getByTestId("task-monitor-ready-start");

    expect(start).toBeEnabled();
    expect(readyStart).toBeEnabled();
    expect(start).toHaveAttribute(
      "data-screen-key",
      expect.stringMatching(/^task-monitor-lifecycle:/),
    );
    expect(screen.getByTestId("task-monitor-workspace")).not.toContainElement(
      start,
    );
    expect(
      screen.getByTestId("task-monitor-coordinator-prestart"),
    ).toContainElement(readyStart);
    expect(screen.getByTestId("machine-picker")).toBeVisible();
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

    fireEvent.click(lifecycleButton("Start"));

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

    fireEvent.click(lifecycleButton("Start"));

    expect(
      await screen.findByTestId("task-monitor-start-error"),
    ).toHaveTextContent("Coordinator binding was rejected.");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("submits the same Start from the Ready card as from the Action Capsule", async () => {
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

    fireEvent.click(screen.getByTestId("task-monitor-ready-start"));

    await waitFor(() =>
      expect(bindGraphConversationAgentSessionMachineMock).toHaveBeenCalledWith(
        expect.objectContaining({ machineId: "machine-1" }),
      ),
    );
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
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

    expect(lifecycleButton("Start")).toBeDisabled();
    expect(
      within(lifecycleButton("Start")).getByTestId(
        "capsule-screen-button-pending",
      ),
    ).toBeVisible();
  });

  it("removes the lifecycle button when the workspace unmounts", () => {
    const { unmount } = renderWorkspace({ monitorStatus: WorkStatus.Backlog });
    expect(lifecycleButton("Start")).toBeVisible();
    unmount();
    expect(
      screen.queryByRole("button", { name: "Start" }),
    ).not.toBeInTheDocument();
  });

  it("passes canonical Pause presentation and callback through the workspace", () => {
    const onPause = vi.fn();
    renderWorkspace({ onPause, executionState: retainedState("running") });

    fireEvent.click(lifecycleButton("Pause"));

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Start" }),
    ).not.toBeInTheDocument();
  });

  it("passes pending Resume presentation through Start without changing canonical status", () => {
    renderWorkspace({
      monitorStatus: WorkStatus.OnHold,
      pendingLifecycleAction: "RESUME",
    });

    expect(lifecycleButton("Start")).toBeDisabled();
    expect(
      within(lifecycleButton("Start")).getByTestId(
        "capsule-screen-button-pending",
      ),
    ).toBeVisible();
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
    expect(lifecycleButton("Start")).toBeEnabled();
  });
  it("moves from setup to running, signals attention without opening, and exposes completion evidence", async () => {
    const { rerender } = renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      executionState: { status: "missing", delivery: "LIVE" },
    });
    expect(
      screen.queryByTestId("task-monitor-open-session"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Pause" }),
    ).not.toBeInTheDocument();
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
    expect(lifecycleButton("Start")).toBeDisabled();

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
    expect(lifecycleButton("Start")).toBeDisabled();
  });
  it("keeps Pause, disabled with a spinner, when live updates drop during a pending Pause", () => {
    const state = retainedState("running");
    if (state.status !== "retained") {
      throw new Error("Expected retained fixture");
    }
    renderWorkspace({
      executionState: { ...state, delivery: "INTERRUPTED" },
      pendingLifecycleAction: "PAUSE",
    });

    const pause = lifecycleButton("Pause");
    expect(pause).toBeDisabled();
    expect(
      within(pause).getByTestId("capsule-screen-button-pending"),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Start" }),
    ).not.toBeInTheDocument();
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

describe("TaskMonitorWorkspaceView Monitor runs on", () => {
  const savedRuntime = {
    provider: "claude" as const,
    model: "claude-sonnet-5-5",
    reasoningEffort: "medium" as const,
  };

  beforeEach(() => {
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
    useReportsMock.mockReturnValue({
      reports: [],
      isLoading: false,
      error: null,
    });
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: null,
      loading: false,
      fetched: true,
      errorMessage: null,
    });
    useTaskMonitorConversationFormResolverMock.mockReturnValue(vi.fn());
  });

  it("shows the saved choice before Start and saves a change through the update path", async () => {
    const onSaveCoordinatorRuntime = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({
      definition: {
        ...createTaskMonitorDefinition(),
        coordinatorRuntime: savedRuntime,
      },
      monitorStatus: WorkStatus.Backlog,
      onSaveCoordinatorRuntime,
    });

    const group = screen.getByTestId("task-monitor-coordinator-runtime");
    // The supervising agent's model sits in its own section, apart from Review's.
    expect(screen.getByTestId("task-monitor-agent-section")).toContainElement(
      group,
    );
    expect(group).toHaveTextContent("Runs on");
    expect(
      within(group).getByTestId(
        "task-monitor-coordinator-runtime-runtime-model-input",
      ),
    ).toHaveValue("Sonnet 5.5");
    expect(onSaveCoordinatorRuntime).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(
      within(
        within(group).getByTestId(
          "task-monitor-coordinator-runtime-runtime-effort-select",
        ),
      ).getByRole("combobox"),
    );
    await user.click(
      screen.getByTestId(
        "task-monitor-coordinator-runtime-runtime-effort-option-high",
      ),
    );

    await waitFor(() =>
      expect(onSaveCoordinatorRuntime).toHaveBeenCalledWith({
        ...savedRuntime,
        reasoningEffort: "high",
      }),
    );
  });

  it("does not save anything when a monitor without the setting is only opened", async () => {
    const onSaveCoordinatorRuntime = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      onSaveCoordinatorRuntime,
    });

    expect(
      await screen.findByTestId(
        "task-monitor-coordinator-runtime-runtime-catalog-ready",
      ),
    ).toBeInTheDocument();
    expect(onSaveCoordinatorRuntime).not.toHaveBeenCalled();
  });

  const reviewDefinition = (
    reviewRuntime?: typeof savedRuntime,
  ): TaskMonitorExecutionDefinition => {
    const base = createTaskMonitorDefinition();
    return {
      ...base,
      launchPolicy: {
        ...base.launchPolicy,
        terminalSupervision: {
          mode: TaskMonitorReviewMode.RequireReview,
          ...(reviewRuntime ? { reviewRuntime } : {}),
        },
      },
    };
  };

  it("offers Reviewer runs on only when Review is required", () => {
    renderWorkspace({ monitorStatus: WorkStatus.Backlog });
    expect(
      screen.queryByTestId("task-monitor-review-runtime"),
    ).not.toBeInTheDocument();
  });

  it("shows the saved Review runtime and saves a change through the update path", async () => {
    const onSaveReviewRuntime = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({
      definition: reviewDefinition(savedRuntime),
      monitorStatus: WorkStatus.Backlog,
      onSaveReviewRuntime,
    });

    const group = screen.getByTestId("task-monitor-review-runtime");
    expect(screen.getByTestId("task-monitor-review")).toContainElement(group);
    expect(group).toHaveTextContent("Reviewer runs on");
    expect(
      within(group).getByTestId(
        "task-monitor-review-runtime-runtime-model-input",
      ),
    ).toHaveValue("Sonnet 5.5");
    expect(onSaveReviewRuntime).not.toHaveBeenCalled();

    const user = userEvent.setup();
    await user.click(
      within(
        within(group).getByTestId(
          "task-monitor-review-runtime-runtime-effort-select",
        ),
      ).getByRole("combobox"),
    );
    await user.click(
      screen.getByTestId(
        "task-monitor-review-runtime-runtime-effort-option-high",
      ),
    );
    await waitFor(() =>
      expect(onSaveReviewRuntime).toHaveBeenCalledWith({
        ...savedRuntime,
        reasoningEffort: "high",
      }),
    );

    await user.click(screen.getByTestId("task-monitor-review-runtime-clear"));
    await waitFor(() => expect(onSaveReviewRuntime).toHaveBeenCalledWith(null));
  });

  it("shows the saved Review runtime read-only after Start", () => {
    renderWorkspace({
      definition: reviewDefinition(savedRuntime),
      monitorStatus: WorkStatus.Active,
    });

    expect(
      screen.getByTestId("task-monitor-review-runtime-readonly"),
    ).toHaveTextContent(savedRuntime.model);
    expect(
      screen.queryByTestId("task-monitor-review-runtime-clear"),
    ).not.toBeInTheDocument();
  });

  const chooseEffort = async (effort: string) => {
    const user = userEvent.setup();
    const group = screen.getByTestId("task-monitor-coordinator-runtime");
    await user.click(
      within(
        within(group).getByTestId(
          "task-monitor-coordinator-runtime-runtime-effort-select",
        ),
      ).getByRole("combobox"),
    );
    await user.click(
      screen.getByTestId(
        `task-monitor-coordinator-runtime-runtime-effort-option-${effort}`,
      ),
    );
  };

  const savedDefinition = () => ({
    ...createTaskMonitorDefinition(),
    coordinatorRuntime: savedRuntime,
  });

  it("keeps Start unavailable until the runtime save has finished", async () => {
    let finishSave: () => void = () => undefined;
    const onSaveCoordinatorRuntime = vi.fn(
      () => new Promise<void>((resolve) => (finishSave = resolve)),
    );
    renderWorkspace({
      definition: savedDefinition(),
      monitorStatus: WorkStatus.Backlog,
      onSaveCoordinatorRuntime,
    });

    await chooseEffort("high");

    await waitFor(() => expect(lifecycleButton("Start")).toBeDisabled());
    finishSave();
    await waitFor(() => expect(lifecycleButton("Start")).toBeEnabled());
  });

  it("returns the picker to the saved choice when the save is rejected", async () => {
    const onSaveCoordinatorRuntime = vi
      .fn()
      .mockRejectedValue(new Error("Save failed"));
    renderWorkspace({
      definition: savedDefinition(),
      monitorStatus: WorkStatus.Backlog,
      onSaveCoordinatorRuntime,
    });

    await chooseEffort("high");

    expect(await screen.findByText("Save failed")).toBeInTheDocument();
    await waitFor(() => expect(lifecycleButton("Start")).toBeEnabled());
    expect(
      within(
        screen.getByTestId(
          "task-monitor-coordinator-runtime-runtime-effort-select",
        ),
      ).getByRole("combobox"),
    ).toHaveTextContent(/medium/i);
  });

  it("saves a model that offers no effort choices without an effort", async () => {
    const onSaveCoordinatorRuntime = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({
      definition: {
        ...createTaskMonitorDefinition(),
        coordinatorRuntime: {
          provider: "opencode",
          model: "glm-5.3",
          reasoningEffort: "high",
        },
      },
      monitorStatus: WorkStatus.Backlog,
      onSaveCoordinatorRuntime,
    });
    const user = userEvent.setup();
    const input = await screen.findByTestId(
      "task-monitor-coordinator-runtime-runtime-model-input",
    );

    await user.click(input);
    await user.click(await screen.findByRole("option", { name: /Default/ }));

    await waitFor(() =>
      expect(onSaveCoordinatorRuntime).toHaveBeenLastCalledWith({
        provider: "opencode",
        model: "opencode-default",
      }),
    );
  });

  it("shows the Claude default for a monitor saved before this setting existed", async () => {
    setCapabilityCatalogForTests([
      ...TEST_CAPABILITY_CATALOG.filter((row) => row.provider !== "claude"),
      ...TEST_CAPABILITY_CATALOG.filter((row) => row.provider === "claude"),
    ]);
    renderWorkspace({ monitorStatus: WorkStatus.Backlog });

    const input = await screen.findByTestId(
      "task-monitor-coordinator-runtime-runtime-model-input",
    );
    const claudeModel = TEST_CAPABILITY_CATALOG.find(
      (row) => row.provider === "claude",
    )?.models[0];
    expect(input).toHaveValue(claudeModel?.label);
  });

  it("shows the saved choice read-only after Start", () => {
    renderWorkspace({
      definition: {
        ...createTaskMonitorDefinition(),
        coordinatorRuntime: savedRuntime,
      },
      monitorStatus: WorkStatus.Active,
      startPresentation: { status: "active" },
    });

    const group = screen.getByTestId("task-monitor-coordinator-runtime");
    expect(
      within(group).getByTestId("task-monitor-coordinator-runtime-readonly"),
    ).toHaveTextContent("claude · claude-sonnet-5-5 · medium");
    expect(
      within(group).queryByTestId(
        "task-monitor-coordinator-runtime-runtime-model-input",
      ),
    ).not.toBeInTheDocument();
  });
});

describe("TaskMonitorWorkspaceView setup before Start", () => {
  const sonnet = {
    method: "quick" as const,
    provider: "claude" as const,
    model: "claude-sonnet-5-5",
    reasoningEffort: "medium" as const,
  };
  const unstartedNode = (
    taskId: string,
    position: number,
    launchConfiguration = sonnet,
  ): TaskMonitorProjectedNode => ({
    position,
    taskId,
    dependsOnTaskIds: [],
    launchConfiguration,
    isCursor: position === 0,
    task: { kind: "loaded", task: createTask(taskId, `Task ${position + 1}`) },
    session: { kind: "none" },
    visualStatus: "idle",
  });
  const startedNode: TaskMonitorProjectedNode = {
    ...unstartedNode("33333333-3333-4333-8333-333333333333", 2),
    session: { kind: "loaded", session: createSession() },
    visualStatus: "active",
  };
  const mixedNodes = [
    unstartedNode("11111111-1111-4111-8111-111111111111", 0),
    unstartedNode("22222222-2222-4222-8222-222222222222", 1, {
      ...sonnet,
      method: "plan",
      reasoningEffort: "low",
    }),
    startedNode,
  ];

  beforeEach(() => {
    setCapabilityCatalogForTests(TEST_CAPABILITY_CATALOG);
    useReportsMock.mockReturnValue({
      reports: [],
      isLoading: false,
      error: null,
    });
    useTaskMonitorCoordinatorConversationMock.mockReturnValue({
      conversation: null,
      project: null,
      session: null,
      loading: false,
      fetched: true,
      errorMessage: null,
    });
    useTaskMonitorConversationFormResolverMock.mockReturnValue(vi.fn());
  });

  const chooseEffort = async (effort: "high" | "max") => {
    const user = userEvent.setup();
    const group = screen.getByTestId("task-monitor-apply-unstarted");
    await user.click(
      within(
        within(group).getByTestId(
          "task-monitor-apply-unstarted-runtime-effort-select",
        ),
      ).getByRole("combobox"),
    );
    await user.click(
      screen.getByTestId(
        `task-monitor-apply-unstarted-runtime-effort-option-${effort}`,
      ),
    );
    return user;
  };

  it("tells the user how many unstarted tasks will be replaced and writes nothing until Apply", async () => {
    const onApplyToUnstartedTasks = vi.fn().mockResolvedValue({
      updatedTaskIds: [mixedNodes[0]?.taskId, mixedNodes[1]?.taskId],
      skippedTaskIds: [startedNode.taskId],
    });
    const onSaveLaunchConfiguration = vi.fn();
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      nodes: mixedNodes,
      onApplyToUnstartedTasks,
      onSaveLaunchConfiguration,
    });

    const user = await chooseEffort("high");
    expect(onApplyToUnstartedTasks).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("task-monitor-apply-unstarted-open"));
    expect(
      screen.getByTestId("task-monitor-apply-unstarted-confirm"),
    ).toHaveTextContent(
      "Replace session settings on 2 tasks that haven't started.",
    );
    expect(onApplyToUnstartedTasks).not.toHaveBeenCalled();

    await user.click(screen.getByTestId("task-monitor-apply-unstarted-submit"));

    await waitFor(() =>
      expect(
        screen.getByTestId("task-monitor-apply-unstarted-result"),
      ).toHaveTextContent(
        "Updated 2 tasks. 1 task already had a session and was left unchanged.",
      ),
    );
    expect(onApplyToUnstartedTasks).toHaveBeenCalledTimes(1);
    expect(onApplyToUnstartedTasks).toHaveBeenCalledWith({
      ...sonnet,
      reasoningEffort: "high",
    });
    // The bulk draft never goes through any per-task save path.
    expect(onSaveLaunchConfiguration).not.toHaveBeenCalled();
  });

  it("writes nothing when the confirmation is cancelled", async () => {
    const onApplyToUnstartedTasks = vi.fn();
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      nodes: mixedNodes,
      onApplyToUnstartedTasks,
    });

    const user = await chooseEffort("max");
    await user.click(screen.getByTestId("task-monitor-apply-unstarted-open"));
    await user.click(screen.getByTestId("task-monitor-apply-unstarted-cancel"));

    expect(
      screen.queryByTestId("task-monitor-apply-unstarted-confirm"),
    ).not.toBeInTheDocument();
    expect(onApplyToUnstartedTasks).not.toHaveBeenCalled();
  });

  it("rejects a combination the machine's catalog no longer offers and sends nothing", async () => {
    const onApplyToUnstartedTasks = vi.fn();
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      nodes: mixedNodes,
      onApplyToUnstartedTasks,
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("task-monitor-apply-unstarted-open"));

    // The machine's catalog drops the chosen model as Apply is pressed,
    // before the picker can reshape the draft.
    act(() => {
      setCapabilityCatalogForTests(
        TEST_CAPABILITY_CATALOG.filter((row) => row.provider !== "claude"),
      );
      fireEvent.click(
        screen.getByTestId("task-monitor-apply-unstarted-submit"),
      );
    });

    expect(
      screen.getByTestId("task-monitor-apply-unstarted-error"),
    ).toHaveTextContent("not available in the runtime catalog");
    expect(onApplyToUnstartedTasks).not.toHaveBeenCalled();
  });

  it("rejects a confirmed Fast mode the model no longer offers instead of sending a setup without it", async () => {
    const onApplyToUnstartedTasks = vi.fn();
    const opusFast = {
      ...sonnet,
      model: "claude-opus-5-5",
      fastMode: true,
    };
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      nodes: [
        unstartedNode("11111111-1111-4111-8111-111111111111", 0, opusFast),
      ],
      onApplyToUnstartedTasks,
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("task-monitor-apply-unstarted-open"));

    // The machine stops offering Fast mode for the model as Apply is pressed.
    act(() => {
      setCapabilityCatalogForTests(
        TEST_CAPABILITY_CATALOG.map((row) => ({
          ...row,
          models: row.models.map(({ serviceTiers: _tiers, ...model }) => model),
        })),
      );
      fireEvent.click(
        screen.getByTestId("task-monitor-apply-unstarted-submit"),
      );
    });

    expect(
      screen.getByTestId("task-monitor-apply-unstarted-error"),
    ).toHaveTextContent("Fast mode choice is not supported");
    expect(onApplyToUnstartedTasks).not.toHaveBeenCalled();
  });

  it("keeps Start unavailable until an edited worktree branch is saved", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const definition = {
        ...createTaskMonitorDefinition(),
        launchPolicy: {
          ...createTaskMonitorDefinition().launchPolicy,
          worktree: { enabled: true, branch: "feature/old" },
        },
      };
      let finishSave: () => void = () => undefined;
      const onSaveLaunchPolicy = vi.fn(
        () => new Promise<void>((resolve) => (finishSave = resolve)),
      );
      const { rerender } = renderWorkspace({
        definition,
        monitorStatus: WorkStatus.Backlog,
        onSaveLaunchPolicy,
      });
      expect(lifecycleButton("Start")).toBeEnabled();

      const branchInput = screen.getByTestId(
        "task-monitor-worktree-branch-name",
      );
      fireEvent.change(branchInput, { target: { value: "feature/new" } });

      // Waiting to save, then saving: Start would still read the old branch.
      expect(lifecycleButton("Start")).toBeDisabled();
      await act(() => vi.advanceTimersByTimeAsync(600));
      expect(onSaveLaunchPolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          worktree: { enabled: true, branch: "feature/new" },
        }),
      );
      expect(lifecycleButton("Start")).toBeDisabled();

      finishSave();
      rerender(
        workspaceElement({
          definition: {
            ...definition,
            launchPolicy: {
              ...definition.launchPolicy,
              worktree: { enabled: true, branch: "feature/new" },
            },
          },
          monitorStatus: WorkStatus.Backlog,
          onSaveLaunchPolicy,
        }),
      );
      await waitFor(() => expect(lifecycleButton("Start")).toBeEnabled());
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows the server's rejection and reports that no task changed", async () => {
    const onApplyToUnstartedTasks = vi
      .fn()
      .mockRejectedValue(new Error("Task monitor uses a disallowed method"));
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      nodes: mixedNodes,
      onApplyToUnstartedTasks,
    });
    const user = userEvent.setup();
    await user.click(screen.getByTestId("task-monitor-apply-unstarted-open"));
    await user.click(screen.getByTestId("task-monitor-apply-unstarted-submit"));

    await waitFor(() =>
      expect(
        screen.getByTestId("task-monitor-apply-unstarted-error"),
      ).toHaveTextContent("Task monitor uses a disallowed method"),
    );
  });

  it("is offered while paused for tasks that have not started, and hidden once none remain", () => {
    const { rerender } = renderWorkspace({
      monitorStatus: WorkStatus.Active,
      executionState: retainedState("paused"),
      nodes: mixedNodes,
    });

    expect(screen.getByTestId("task-monitor-apply-unstarted")).toBeVisible();
    // The monitor-wide setup stays read-only once started.
    expect(
      screen.queryByTestId("task-monitor-prestart-settings"),
    ).not.toBeInTheDocument();
    rerender(
      workspaceElement({
        monitorStatus: WorkStatus.Active,
        executionState: retainedState("paused"),
        nodes: [startedNode],
      }),
    );

    expect(
      screen.queryByTestId("task-monitor-apply-unstarted"),
    ).not.toBeInTheDocument();
  });

  it("saves Review mode and the worktree before Start, and blocks Start while a task has no Service", async () => {
    const onSaveLaunchPolicy = vi.fn().mockResolvedValue(undefined);
    const onChangeServices = vi.fn();
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      nodes: mixedNodes,
      onSaveLaunchPolicy,
      taskServices: {
        ...noMissingServices,
        tasksMissingServices: [
          {
            taskId: mixedNodes[0]?.taskId ?? "",
            label: "Task 1",
            serviceIds: [],
          },
        ],
        onChange: onChangeServices,
      },
    });
    const user = userEvent.setup();

    await user.click(screen.getByRole("radio", { name: /Require review/ }));
    expect(onSaveLaunchPolicy).toHaveBeenCalledWith({
      terminalSupervision: { mode: TaskMonitorReviewMode.RequireReview },
    });

    expect(
      screen.getByTestId("task-monitor-missing-services"),
    ).toHaveTextContent("Task 1");
    expect(lifecycleButton("Start")).toBeDisabled();
    expect(
      screen.getByTestId("task-monitor-start-message"),
    ).toBeInTheDocument();
  });
});

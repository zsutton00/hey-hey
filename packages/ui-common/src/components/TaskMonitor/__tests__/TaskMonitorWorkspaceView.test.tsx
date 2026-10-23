import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
} = vi.hoisted(() => ({
  bindGraphConversationAgentSessionMachineMock: vi.fn(),
  submitStopRunViaPlatformMock: vi.fn(),
  useTaskMonitorCoordinatorConversationMock: vi.fn(),
  useTaskMonitorConversationFormResolverMock: vi.fn(),
  capturedReplyMessages: [] as CreateUserMessage[],
  randomUUIDMock: vi.fn(),
}));

vi.mock(
  "../../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({
    bindGraphConversationAgentSessionMachine:
      bindGraphConversationAgentSessionMachineMock,
  })
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
  }: {
    agentSessionId: string;
    conversationId: string;
    taskMonitorId?: string;
    conversationFormResolver?: ConversationFormResolver;
    buildReplyMessage?: (text: string) => CreateUserMessage;
    onStopRun: () => void;
    scrollable: boolean;
    stoppingRun: boolean;
  }) => (
    <div
      data-testid="agent-conversation-view"
      data-agent-session-id={agentSessionId}
      data-conversation-id={conversationId}
      data-task-monitor-id={taskMonitorId}
      data-form-resolver={conversationFormResolver ? "provided" : "missing"}
      data-scrollable={scrollable || undefined}
    >
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
  ),
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

const renderWorkspace = (
  overrides: Partial<React.ComponentProps<typeof TaskMonitorWorkspaceView>> = {}
) =>
  render(
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

const generatedStylesFor = (element: HTMLElement) => {
  const classNames = element.className.split(/\s+/).filter(Boolean);
  return [...document.querySelectorAll("style")]
    .map((style) => style.textContent ?? "")
    .filter((text) =>
      classNames.some((className) => text.includes(`.${className}`))
    )
    .join("\n");
};

describe("TaskMonitorWorkspaceView", () => {
  beforeEach(() => {
    bindGraphConversationAgentSessionMachineMock.mockReset();
    bindGraphConversationAgentSessionMachineMock.mockResolvedValue(
      createSession()
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
      screen.queryByTestId("task-monitor-review-mode")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("task-monitor-launch-configuration")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("task-monitor-runtime-model")
    ).not.toBeInTheDocument();
  });

  it("does not render redundant cursor labels", () => {
    renderWorkspace();

    expect(screen.queryByText("Cursor 0")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-monitor-cursor")).not.toBeInTheDocument();
  });

  it("hides the monitor name below md while keeping the status chip visible", () => {
    renderWorkspace();

    const monitorName = screen.getByTestId("task-monitor-name");
    const monitorNameStyles = generatedStylesFor(monitorName);

    expect(monitorName).toHaveTextContent("Release monitor");
    expect(monitorNameStyles).toMatch(
      /@media \(min-width:0px\)\{[^}]*display:none;/
    );
    expect(monitorNameStyles).toMatch(
      /@media \(min-width:900px\)\{[^}]*display:block;/
    );
    expect(screen.getByTestId("task-monitor-status")).toBeVisible();
  });

  it("orders Steps, Task Monitor, and Active Session for responsive layout", () => {
    renderWorkspace();

    expect(screen.getByTestId("task-monitor-workspace")).toHaveStyle({
      height: "100%",
      minHeight: 0,
    });
    const layout = screen.getByTestId("task-monitor-workspace-layout");
    expect(generatedStylesFor(layout)).toMatch(
      /@media \(min-width:1200px\)\{[^}]*grid-template-columns:minmax\(0, 1fr\) minmax\(0, 1\.5fr\) minmax\(0, 1\.5fr\);/
    );
    expect(layout.children[0]).toBe(
      screen.getByTestId("task-monitor-steps-surface")
    );
    expect(layout.children[1]).toBe(
      screen.getByTestId("task-monitor-coordinator-pane")
    );
    expect(layout.children[2]).toBe(
      screen.getByTestId("task-monitor-inspector-pane")
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
    }
  );

  it("places the CLI machine picker below Start inside the Steps pane", () => {
    renderWorkspace({ monitorStatus: WorkStatus.Backlog });

    const stepsPane = screen.getByTestId("task-monitor-steps-surface");
    const start = screen.getByTestId("task-monitor-start");
    const machinePicker = screen.getByTestId("machine-picker");

    expect(stepsPane).toContainElement(start);
    expect(stepsPane).toContainElement(machinePicker);
    expect(
      start.compareDocumentPosition(machinePicker) &
        Node.DOCUMENT_POSITION_FOLLOWING
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
        }
      )
    );
    await waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
    expect(
      bindGraphConversationAgentSessionMachineMock.mock.invocationCallOrder[0]
    ).toBeLessThan(onStart.mock.invocationCallOrder[0]);
  });

  it("does not submit Start when coordinator machine binding fails", async () => {
    const onStart = vi.fn();
    bindGraphConversationAgentSessionMachineMock.mockRejectedValue(
      new Error("Coordinator binding was rejected.")
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
      await screen.findByTestId("task-monitor-start-error")
    ).toHaveTextContent("Coordinator binding was rejected.");
    expect(onStart).not.toHaveBeenCalled();
  });

  it("explains how to start the coordinator before its conversation exists", () => {
    renderWorkspace({ monitorStatus: WorkStatus.Backlog });

    const prestartGuide = screen.getByTestId(
      "task-monitor-coordinator-prestart"
    );
    expect(prestartGuide).toHaveTextContent("Ready to start");
    expect(prestartGuide).toHaveTextContent("How it works");
    expect(prestartGuide).toHaveTextContent(
      "Choose a paired CLI machine, and press Start."
    );
    expect(prestartGuide).toHaveTextContent(
      "The coordinator works through the steps you've selected in order"
    );
    expect(prestartGuide).toHaveTextContent(
      "Follow its live updates and reply to guide it when needed."
    );
    expect(prestartGuide).toHaveTextContent(
      "Active Session shows the session for the current step."
    );
    expect(
      screen.queryByText(
        "The coordinator conversation could not be loaded after the monitor started."
      )
    ).not.toBeInTheDocument();
  });

  it("keeps the selected session conversation in its owned scroll container", () => {
    renderWorkspace();

    expect(
      screen.getByTestId("task-monitor-current-session-scroll-container")
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
      sessionId
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-conversation-id",
      coordinatorConversationId
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-task-monitor-id",
      "66666666-6666-4666-8666-666666666666"
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-form-resolver",
      "provided"
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
      "provenance"
    );
    expect(capturedReplyMessages[0].data.agentInput).not.toHaveProperty(
      "sourceUserMessageId"
    );
    expect(capturedReplyMessages[0].data.agentInput).not.toHaveProperty(
      "handlerPromptType"
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
        })
      );
    });
  });

  it("shows waiting progress for the running cursor task before its session exists", () => {
    renderWorkspace({
      nodes: [{ ...selectedNode, session: { kind: "none" } }],
    });

    expect(
      screen.getByTestId("task-monitor-waiting-for-session")
    ).toHaveTextContent("Waiting for session to start");
    expect(
      screen.getByRole("progressbar", {
        name: "Waiting for session to start",
      })
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
    renderWorkspace({ onPause });

    fireEvent.click(screen.getByTestId("task-monitor-pause"));

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("task-monitor-start")).toBeDisabled();
  });

  it("passes pending Resume presentation through Start without changing canonical status", () => {
    renderWorkspace({
      monitorStatus: WorkStatus.OnHold,
      pendingLifecycleAction: "RESUME",
    });

    expect(screen.getByTestId("task-monitor-status")).toHaveTextContent(
      "ON_HOLD"
    );
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
      screen.getByTestId("task-monitor-command-outcome")
    ).toHaveTextContent("The lifecycle command was rejected.");
    expect(screen.getByTestId("task-monitor-status")).toHaveTextContent(
      "ACTIVE"
    );
  });

  it("keeps refresh failures explicit and retryable from canonical pre-start state", () => {
    renderWorkspace({
      monitorStatus: WorkStatus.Backlog,
      startPresentation: { status: "ready" },
      operationalErrorMessage: "Canonical monitor refresh failed.",
    });

    expect(screen.getByTestId("task-monitor-start-error")).toHaveTextContent(
      "Canonical monitor refresh failed."
    );
    expect(screen.getByTestId("task-monitor-start")).toBeEnabled();
  });
});

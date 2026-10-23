import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  AuthorizationProtocolVersion,
  EntityType,
  InitiationType,
  WorkflowName,
  ConversationStatus,
  CurrentControllerMachineEligibilityState,
  WorkStatus,
  MachineExecutionReadinessState,
  type AgentSessionDto,
  type ConversationResponseDto,
  type TaskResponseDto,
  type PlanConfigurationV1,
  type MachineDto,
} from "../../../api";

const restartPlanGenerationMock = vi.fn();
const onGenerationReset = vi.fn();
vi.mock("../../../clients/serviceClients", () => ({
  plansClient: {
    resetWorkItemPlanGeneration: (...args: unknown[]) =>
      restartPlanGenerationMock(...args),
  },
}));
vi.mock("../../../clients/client", () => ({
  apiClient: {
    postMessage: vi.fn(),
    restartPlanGeneration: (...args: unknown[]) =>
      restartPlanGenerationMock(...args),
  },
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => navigateMock,
}));

const useMachineResolutionMock = vi.fn();
vi.mock("../runtime/coding/useMachineResolution", () => ({
  useMachineResolution: (preferredMachineId: string | null) =>
    useMachineResolutionMock(preferredMachineId),
}));

const useAgentSessionsMock = vi.fn();
vi.mock("../../../data/hooks/useAgentSessions", () => ({
  useAgentSessions: (...args: unknown[]) => useAgentSessionsMock(...args),
}));

const useAgentRunLifecycleMock = vi.fn();
vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: (input: unknown) => useAgentRunLifecycleMock(input),
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => ({ startRun: vi.fn() }),
}));

vi.mock("../usePlanCreationCreatingState", () => ({
  usePlanCreationCreatingState: () => false,
}));

vi.mock("../runtime/coding/update-agent-session-record", () => ({
  updateAgentSessionRecord: vi.fn().mockResolvedValue({ ok: true }),
}));

const usePlanFromDesignDocSeedMock = vi.fn();
vi.mock("../usePlanFromDesignDocSeed", () => ({
  usePlanFromDesignDocSeed: (...args: unknown[]) =>
    usePlanFromDesignDocSeedMock(...args),
}));

vi.mock("../surfaceSelectionMemory", () => ({
  readSurfaceSelection: () => null,
  buildDefaultSurfaceSelection: () => ({
    provider: "claude",
    model: "claude-opus-4-8",
    reasoningEffort: null,
  }),
}));

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: (props: { conversationId: string }) => (
    <div
      data-testid="agent-conversation-view"
      data-conversation-id={props.conversationId}
    />
  ),
}));

vi.mock("../SessionErrorAlert", () => ({
  SessionErrorAlert: ({ error }: { error: unknown }) => (
    <div data-testid="session-error-alert">{String(error)}</div>
  ),
}));

vi.mock("../OpenBrowserCapsuleAction", () => ({
  OpenBrowserCapsuleAction: () => null,
}));

vi.mock("../LocalRuntimeUnavailableAlert", () => ({
  LocalRuntimeUnavailableAlert: () => null,
}));

import { PlanFromDesignDocChat } from "../PlanFromDesignDocChat";

const SESSION_ID = "agent-session-1";
const CONVERSATION_ID = "conv-pfdd-1";

const machine = (
  machineId: string,
  executionReadiness: MachineDto["executionReadiness"] = MachineExecutionReadinessState.Ready,
): MachineDto => ({
  machineId,
  name: machineId,
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: executionReadiness === MachineExecutionReadinessState.Ready,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
});

const readyMachine = machine("machine-1");

const buildConversation = (
  status: ConversationStatus,
): ConversationResponseDto => ({
  id: CONVERSATION_ID,
  projectId: "proj-1",
  organizationId: "org-1",
  initiatedBy: InitiationType.System,
  status,
  version: 1,
  workflowName: WorkflowName.PlanFromDesignDoc,
  workflowAboutId: "plan-1",
  workflowAboutType: "plan",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:01:00Z",
});

const buildSession = (
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto =>
  ({
    id: SESSION_ID,
    projectId: "proj-1",
    organizationId: "org-1",
    userId: "user-1",
    machineId: readyMachine.machineId,
    type: AgentSessionType.PlanGeneration,
    status: AgentSessionStatus.InProgress,
    sessionDate: "2026-05-01T00:00:00Z",
    conversationId: CONVERSATION_ID,
    entityType: EntityType.Task,
    entityId: "plan-1",
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    hasUnsyncedChanges: false,
    title: "Plan generation",
    ...overrides,
  }) as AgentSessionDto;

const setLifecycle = (overrides: Record<string, unknown> = {}): void => {
  useAgentRunLifecycleMock.mockReturnValue({
    runId: SESSION_ID,
    error: null,
    errorCode: null,
    dispatchStartRun: vi.fn(),
    retryInit: vi.fn(),
    stopRun: vi.fn(),
    stoppingRun: false,
    ...overrides,
  });
};

const configuration: PlanConfigurationV1 = {
  schemaVersion: "plan-configuration.v1",
  planType: "STANDARD",
  worktreeBranch: null,
};
const buildPlan = (
  status: WorkStatus = WorkStatus.Backlog,
): Pick<TaskResponseDto, "id" | "name" | "status"> => ({
  id: "plan-1",
  name: "Test Plan",
  status,
});

const renderChat = (
  conversationStatus: ConversationStatus = ConversationStatus.InProgress,
  planStatus: WorkStatus = WorkStatus.Backlog,
) =>
  render(
    <PlanFromDesignDocChat
      onGenerationReset={onGenerationReset}
      organizationId="org-1"
      projectId="proj-1"
      planId="plan-1"
      plan={buildPlan(planStatus)}
      configuration={configuration}
      conversation={buildConversation(conversationStatus)}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  restartPlanGenerationMock.mockResolvedValue({
    data: { restarted: true, conversationId: "conv-new" },
  });
  useAgentSessionsMock.mockReturnValue({
    agentSessions: [buildSession()],
    isFetched: true,
    markStale: vi.fn(),
    remove: vi.fn(),
  });
  usePlanFromDesignDocSeedMock.mockReturnValue({
    seed: {
      title: "Seed Doc",
      sections: [
        {
          key: "content",
          materializedMarkdown: "Seed body markdown",
        },
      ],
    },
    designDocId: "design-doc-1",
    isLoading: false,
    error: null,
  });
  useMachineResolutionMock.mockReturnValue({
    machines: [readyMachine],
    executionReadyMachines: [readyMachine],
    isReady: true,
    mode: "one",
    selectedMachine: readyMachine,
    setSelectedMachineId: vi.fn(),
  });
  setLifecycle();
});

describe("PlanFromDesignDocChat Restart control", () => {
  it("shows the Restart control during an active run", () => {
    renderChat();

    expect(useMachineResolutionMock).toHaveBeenCalledWith(
      readyMachine.machineId,
    );
    expect(screen.getByTestId("agent-conversation-view")).toBeTruthy();
    expect(screen.getByTestId("plan-generation-restart")).toBeTruthy();
  });

  it("hides the Restart control once the plan is no longer in DRAFT status", () => {
    renderChat(ConversationStatus.InProgress, WorkStatus.Active);

    expect(screen.getByTestId("agent-conversation-view")).toBeTruthy();
    expect(screen.queryByTestId("plan-generation-restart")).toBeNull();
  });

  it("hides the Restart control when there is no active run", () => {
    setLifecycle({ runId: null });

    renderChat();

    // No runId -> the live view falls back to the progress indicator and the
    // Restart control is not rendered.
    expect(screen.queryByTestId("plan-generation-restart")).toBeNull();
  });

  it("keeps Restart available when the run lifecycle reports an error", () => {
    setLifecycle({ error: "The provider rejected the generation turn." });

    renderChat();

    expect(screen.getByTestId("session-error-alert")).toHaveTextContent(
      "The provider rejected the generation turn.",
    );
    expect(screen.getByTestId("plan-generation-restart")).toBeTruthy();
    expect(screen.queryByTestId("agent-conversation-view")).toBeNull();
  });

  it("opens a confirmation that spells out what is discarded versus kept", () => {
    renderChat();

    fireEvent.click(screen.getByTestId("plan-generation-restart"));

    expect(screen.getByTestId("plan-generation-restart-dialog")).toBeTruthy();
    expect(
      screen.getByText(/removes generated stages and tasks/i),
    ).toBeTruthy();
    expect(screen.getByText(/Plan and design doc are kept/i)).toBeTruthy();
  });

  it("resets the existing work item and refreshes generation on confirm", async () => {
    renderChat();

    fireEvent.click(screen.getByTestId("plan-generation-restart"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("plan-generation-restart-confirm"));
    });

    expect(restartPlanGenerationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        taskId: "plan-1",
      }),
    );
    await waitFor(() => {
      expect(onGenerationReset).toHaveBeenCalledOnce();
      expect(navigateMock).not.toHaveBeenCalled();
    });
  });

  it("shows a reset failure and keeps the current generation available", async () => {
    restartPlanGenerationMock.mockRejectedValueOnce(new Error("Reset failed"));
    renderChat();
    fireEvent.click(screen.getByTestId("plan-generation-restart"));
    fireEvent.click(screen.getByTestId("plan-generation-restart-confirm"));
    expect(await screen.findByText("Reset failed")).toBeTruthy();
    expect(onGenerationReset).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("plan-generation-restart-confirm"),
    ).not.toBeDisabled();
  });

  it("does not allow restart preparation while execution readiness is unavailable", () => {
    const revokedMachine = machine(
      "revoked-machine",
      MachineExecutionReadinessState.MachineRevoked,
    );
    useMachineResolutionMock.mockReturnValue({
      machines: [revokedMachine],
      executionReadyMachines: [],
      isReady: true,
      mode: "zero",
      selectedMachine: null,
      setSelectedMachineId: vi.fn(),
    });

    renderChat();

    expect(screen.getByTestId("plan-generation-restart")).toBeDisabled();
    fireEvent.click(screen.getByTestId("plan-generation-restart"));
    expect(screen.queryByTestId("plan-generation-restart-dialog")).toBeNull();
    expect(restartPlanGenerationMock).not.toHaveBeenCalled();
  });
});

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
  AgentConversationView: () => {
    const runBrowser = useRunBrowserContext();
    return (
      <div
        data-testid="agent-conversation-view"
        data-run-id={runBrowser?.runId ?? ""}
        data-machine-id={runBrowser?.sessionMachineId ?? ""}
      />
    );
  },
}));

vi.mock("../OpenBrowserCapsuleAction", () => ({
  OpenBrowserCapsuleAction: (props: { runId: string | null }) => (
    <div data-testid="open-browser-action" data-run-id={props.runId ?? ""} />
  ),
}));

vi.mock("../SessionErrorAlert", () => ({
  SessionErrorAlert: ({ error }: { error: unknown }) => (
    <div data-testid="session-error-alert">{String(error)}</div>
  ),
}));

vi.mock("../LocalRuntimeUnavailableAlert", () => ({
  LocalRuntimeUnavailableAlert: () => null,
}));

import { PlanFromDesignDocChat } from "../PlanFromDesignDocChat";
import { useRunBrowserContext } from "../runtime/RunBrowserContext";

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

describe("PlanFromDesignDocChat Run browser context", () => {
  it("gives the conversation the plan creation Run so mockups show a pencil", () => {
    renderChat();

    const view = screen.getByTestId("agent-conversation-view");
    expect(view.getAttribute("data-run-id")).toBe(SESSION_ID);
    expect(view.getAttribute("data-machine-id")).toBe(readyMachine.machineId);
  });

  it("offers Open browser for the plan creation Run", () => {
    renderChat();

    expect(
      screen.getByTestId("open-browser-action").getAttribute("data-run-id"),
    ).toBe(SESSION_ID);
  });
});

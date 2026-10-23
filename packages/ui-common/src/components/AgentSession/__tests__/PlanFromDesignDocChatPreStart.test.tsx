import { defaultAgentOperationCoordinator } from "../operations/AgentOperationProvider";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EagerIntersectionObserver } from "../../../test/eagerIntersectionObserver";
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionDtoProviderEnum,
  AgentSessionStatus,
  AgentSessionType,
  AuthorizationProtocolVersion,
  EntityType,
  InitiationType,
  PlanCombinationAggressiveness,
  WorkflowName,
  ConversationStatus,
  CurrentControllerMachineEligibilityState,
  WorkStatus,
  TaskSectionUpdateSource,
  MachineExecutionReadinessState,
  type AgentSessionDto,
  type ConversationResponseDto,
  type TaskResponseDto,
  type PlanConfigurationV1,
  type MachineDto,
} from "../../../api";
import type { AgentSessionMetadataValues } from "../AgentSessionMetadata";
import { setCapabilityCatalogForTests } from "../capabilityCatalog";

vi.mock("../../../clients/client", () => ({
  apiClient: { postMessage: vi.fn() },
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

const updatePlanMock = vi.fn();
vi.mock("../../../data/hooks/useCanonicalPlanMutations", () => ({
  useCanonicalPlanMutations: () => ({ updatePlan: updatePlanMock }),
}));

const useAgentRunLifecycleMock = vi.fn();
const submitMessageMock = vi.fn();
const replyAccess = { enabled: true };
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () =>
    replyAccess.enabled
      ? {
          isDeviceEnabled: true,
          interactions: { submitMessage: submitMessageMock },
        }
      : {
          isDeviceEnabled: false,
          unavailable: { message: "Machine unavailable" },
        },
}));
vi.mock("../useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: (input: unknown) => useAgentRunLifecycleMock(input),
}));

vi.mock("../useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => ({ startRun: vi.fn() }),
}));

vi.mock("../usePlanCreationCreatingState", () => ({
  usePlanCreationCreatingState: () => false,
}));

const updateAgentSessionRecordMock = vi.fn();
vi.mock("../runtime/coding/update-agent-session-record", () => ({
  updateAgentSessionRecord: (...args: unknown[]) =>
    updateAgentSessionRecordMock(...args),
}));

const usePlanFromDesignDocSeedMock = vi.fn();
vi.mock("../usePlanFromDesignDocSeed", () => ({
  usePlanFromDesignDocSeed: (...args: unknown[]) =>
    usePlanFromDesignDocSeedMock(...args),
}));

const useWorkItemGraphMock = vi.fn();
const useWorkItemTypeByKeyMock = vi.fn();
vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: (...args: unknown[]) => useWorkItemGraphMock(...args),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../data/hooks/useWorkItemTypes")
  >()),
  useWorkItemTypeByKey: (...args: unknown[]) =>
    useWorkItemTypeByKeyMock(...args),
}));

const surfaceSelectionState = vi.hoisted(() => ({
  value: {
    provider: "claude" as const,
    model: "claude-opus-4-8",
    reasoningEffort: null,
    fastMode: false,
  },
  write: vi.fn(),
}));

vi.mock("../surfaceSelectionMemory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../surfaceSelectionMemory")>()),
  readSurfaceSelection: () => null,
  buildDefaultSurfaceSelection: () => surfaceSelectionState.value,
  writeSurfaceSelection: (...args: unknown[]) =>
    surfaceSelectionState.write(...args),
}));

const replyAttachments = vi.hoisted(() => ({
  value: [] as import("../../../api").RunAttachmentReference[],
}));

vi.mock("../AgentConversationView", () => ({
  AgentConversationView: (props: {
    conversationId: string;
    hideComposer?: boolean;
    submittingPrompt?: boolean;
    onSubmitReply?: React.ComponentProps<
      typeof import("../AgentConversationView").AgentConversationView
    >["onSubmitReply"];
    agentSessionMetadata?: AgentSessionMetadataValues;
  }) => (
    <div
      data-testid="agent-conversation-view"
      data-conversation-id={props.conversationId}
      data-hide-composer={String(props.hideComposer ?? false)}
      data-session-model={props.agentSessionMetadata?.model}
      data-session-effort={props.agentSessionMetadata?.effort}
    >
      <button
        disabled={props.submittingPrompt}
        onClick={() => {
          void props
            .onSubmitReply?.(
              "Revise the plan",
              undefined,
              replyAttachments.value,
            )
            .catch((error: Error) => replyErrorMock(error.message));
        }}
      >
        Send plan reply
      </button>
    </div>
  ),
}));

vi.mock("../SessionErrorAlert", () => ({
  SessionErrorAlert: ({
    error,
    onRetry,
  }: {
    error: unknown;
    onRetry?: (() => void) | null;
  }) => (
    <div data-testid="session-error-alert">
      {String(error)}
      {onRetry ? <button onClick={onRetry}>Retry</button> : null}
    </div>
  ),
}));

vi.mock("../OpenBrowserCapsuleAction", () => ({
  OpenBrowserCapsuleAction: () => null,
}));

vi.mock("../LocalRuntimeUnavailableAlert", () => ({
  LocalRuntimeUnavailableAlert: () => null,
}));

import { PlanFromDesignDocChat } from "../PlanFromDesignDocChat";
import { PlanFromDesignDocPreStart } from "../PlanFromDesignDocPreStart";

const SESSION_ID = "agent-session-1";
const replyErrorMock = vi.fn();
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

const conversation: ConversationResponseDto = {
  id: CONVERSATION_ID,
  projectId: "proj-1",
  organizationId: "org-1",
  initiatedBy: InitiationType.System,
  status: ConversationStatus.NotStarted,
  version: 1,
  workflowName: WorkflowName.PlanFromDesignDoc,
  workflowAboutId: "plan-1",
  workflowAboutType: "plan",
  createdAt: "2026-05-01T00:00:00Z",
  updatedAt: "2026-05-01T00:01:00Z",
};

const buildSession = (
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto =>
  ({
    id: SESSION_ID,
    projectId: "proj-1",
    organizationId: "org-1",
    userId: "user-1",
    machineId: "machine-1",
    type: AgentSessionType.PlanGeneration,
    status: AgentSessionStatus.NotStarted,
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

const dispatchStartRunMock = vi.fn();

const configuration: PlanConfigurationV1 = {
  schemaVersion: "plan-configuration.v1",
  planType: "STANDARD",
  worktreeBranch: null,
};
const buildPlan = (
  overrides: Partial<Pick<TaskResponseDto, "id" | "name" | "status">> = {},
): Pick<TaskResponseDto, "id" | "name" | "status"> => ({
  id: "plan-1",
  name: "Test Plan",
  status: WorkStatus.Backlog,
  ...overrides,
});

const setLifecycle = (overrides: Record<string, unknown> = {}): void => {
  useAgentRunLifecycleMock.mockReturnValue({
    runId: SESSION_ID,
    error: null,
    errorCode: null,
    dispatchStartRun: dispatchStartRunMock,
    retryInit: vi.fn(),
    stopRun: vi.fn(),
    stoppingRun: false,
    ...overrides,
  });
};

const renderWithConversation = (
  conv: ConversationResponseDto,
  plan: Pick<TaskResponseDto, "id" | "name" | "status"> = buildPlan(),
  planConfiguration: PlanConfigurationV1 = configuration,
) =>
  render(
    <PlanFromDesignDocChat
      onGenerationReset={vi.fn()}
      organizationId="org-1"
      projectId="proj-1"
      planId="plan-1"
      plan={plan}
      configuration={planConfiguration}
      conversation={conv}
    />,
  );

const renderChat = (
  plan: Pick<TaskResponseDto, "id" | "name" | "status"> = buildPlan(),
  planConfiguration: PlanConfigurationV1 = configuration,
) => renderWithConversation(conversation, plan, planConfiguration);

it.each([
  { attachments: [] },
  {
    attachments: [
      {
        attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
        fileName: "notes.txt",
      },
    ],
  },
])(
  "routes plan replies and attachments through workflow follow-up and reports failures: %j",
  async ({ attachments }) => {
    replyAttachments.value = attachments;
    setLifecycle();
    renderWithConversation({
      ...conversation,
      status: ConversationStatus.Error,
    });
    let finish: (result: { state: string; message: string }) => void = () => {};
    submitMessageMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Send plan reply" }),
    );
    await waitFor(() => expect(submitMessageMock).toHaveBeenCalledOnce());
    expect(submitMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: SESSION_ID,
        conversationId: CONVERSATION_ID,
        intent: expect.objectContaining({
          parentMessageId: null,
          data: {
            attachments,
            agentInput: {
              promptType: "workflow-defined",
              userMessage: "Revise the plan",
            },
          },
        }),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Send plan reply" }),
    ).toBeDisabled();
    await act(async () =>
      finish({ state: "failed", message: "Delivery failed" }),
    );
    expect(replyErrorMock).toHaveBeenCalledWith("Delivery failed");
    expect(
      screen.getByRole("button", { name: "Send plan reply" }),
    ).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Send plan reply" }));
    await waitFor(() => expect(submitMessageMock).toHaveBeenCalledTimes(2));
    expect(dispatchStartRunMock).not.toHaveBeenCalled();
  },
);

it("rejects plan replies when machine access is unavailable", async () => {
  setLifecycle();
  replyAccess.enabled = false;
  renderWithConversation({ ...conversation, status: ConversationStatus.Error });
  fireEvent.click(
    await screen.findByRole("button", { name: "Send plan reply" }),
  );
  await waitFor(() =>
    expect(replyErrorMock).toHaveBeenCalledWith("Machine unavailable"),
  );
  expect(submitMessageMock).not.toHaveBeenCalled();
  expect(dispatchStartRunMock).not.toHaveBeenCalled();
});

const renderPreStart = (
  overrides: Partial<
    React.ComponentProps<typeof PlanFromDesignDocPreStart>
  > = {},
) =>
  render(
    <PlanFromDesignDocPreStart
      organizationId="org-1"
      projectId="proj-1"
      navigate={navigateMock}
      seed={{
        title: "Seed Doc",
        summary: "Seed summary",
        sections: [
          {
            key: "content",
            materializedMarkdown: "Seed body markdown",
          },
        ],
      }}
      isLoadingSeed={false}
      isStarting={false}
      onStartGenerating={vi.fn()}
      isBridgeSelected
      provider="claude"
      model="claude-opus-4-8"
      reasoningEffort={null}
      fastMode={false}
      onProviderChange={vi.fn()}
      onModelChange={vi.fn()}
      onReasoningEffortChange={vi.fn()}
      onFastModeChange={vi.fn()}
      machineSelection={{
        machines: [readyMachine],
        machineMode: "one",
        selectedMachineId: readyMachine.machineId,
        onSelectMachine: vi.fn(),
        recoveryState: { type: "ready", machine: readyMachine },
      }}
      worktreeEnabled={false}
      worktreeBranch=""
      onWorktreeEnabledChange={vi.fn()}
      onWorktreeBranchChange={vi.fn()}
      planCombinationAggressiveness={PlanCombinationAggressiveness.Medium}
      onPlanCombinationAggressivenessChange={vi.fn()}
      {...overrides}
    />,
  );

beforeEach(() => {
  replyAccess.enabled = true;
  submitMessageMock.mockReset().mockResolvedValue({ state: "succeeded" });
  defaultAgentOperationCoordinator.launches.clear({
    organizationId: "org-1",
    projectId: "proj-1",
    agentSessionId: SESSION_ID,
    conversationId: CONVERSATION_ID,
  });
  vi.clearAllMocks();
  vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
  setCapabilityCatalogForTests([
    {
      provider: "claude",
      models: [
        {
          id: "claude-opus-4-8",
          label: "Opus",
          efforts: ["low", "medium", "high"],
        },
      ],
    },
    {
      provider: "codex",
      models: [
        {
          id: "gpt-5.4",
          label: "GPT 5.4",
          efforts: ["low", "medium", "high"],
          serviceTiers: ["priority"],
        },
      ],
    },
  ]);
  surfaceSelectionState.value = {
    provider: "claude",
    model: "claude-opus-4-8",
    reasoningEffort: null,
    fastMode: false,
  };
  dispatchStartRunMock.mockResolvedValue({
    ok: true,
    dispatched: true,
    triggerMessageId: "trigger-1",
  });
  updatePlanMock.mockResolvedValue({ status: "applied", plan: buildPlan() });
  updateAgentSessionRecordMock.mockResolvedValue({
    ok: true,
    session: buildSession({ status: AgentSessionStatus.InProgress }),
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
      summary: "Seed summary",
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
  useWorkItemGraphMock.mockReturnValue({
    data: null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    error: null,
  });
  useWorkItemTypeByKeyMock.mockReturnValue({
    workItemTypeDefinition: {
      key: "workflow",
      name: "Workflow",
      sections: [],
      allowedStatuses: [],
      iconKey: "workflow",
    },
    isLoading: false,
    isFetching: false,
    isFetched: true,
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

describe("PlanFromDesignDocChat pre-start placeholder", () => {
  it("continues the draft's Start click with its chosen settings and no second click", async () => {
    const selectedMachine = machine("chosen-machine");
    useMachineResolutionMock.mockReturnValue({
      machines: [selectedMachine],
      executionReadyMachines: [selectedMachine],
      isReady: true,
      mode: "one",
      selectedMachine,
      setSelectedMachineId: vi.fn(),
    });
    render(
      <PlanFromDesignDocChat
        organizationId="org-1"
        projectId="proj-1"
        planId="plan-1"
        plan={buildPlan()}
        configuration={configuration}
        conversation={conversation}
        onGenerationReset={vi.fn()}
        autoStartAgentSessionId={SESSION_ID}
        launchSettings={{
          machineId: "chosen-machine",
          worktreeBranch: "chosen-branch",
          planCombinationAggressiveness: PlanCombinationAggressiveness.High,
          selection: {
            provider: "codex",
            model: "gpt-5.4",
            reasoningEffort: "high",
            fastMode: true,
          },
        }}
      />,
    );
    await waitFor(() => expect(dispatchStartRunMock).toHaveBeenCalledOnce());
    expect(useMachineResolutionMock).toHaveBeenCalledWith("chosen-machine");
    expect(useAgentRunLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.4",
        reasoningEffort: "high",
        machineId: "chosen-machine",
        worktree: { enabled: true, branch: "chosen-branch" },
      }),
    );
    expect(updateAgentSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          model: "gpt-5.4",
          effort: "high",
          planCombinationAggressiveness: PlanCombinationAggressiveness.High,
        }),
      }),
    );
    expect(updatePlanMock).toHaveBeenCalledWith(
      "plan-1",
      expect.objectContaining({
        sections: [
          {
            key: "planConfiguration",
            content: { ...configuration, worktreeBranch: "chosen-branch" },
          },
        ],
      }),
    );
  });

  it("configures the lifecycle on the deferred workflow arm so nothing fires on mount", () => {
    renderChat();

    expect(useAgentRunLifecycleMock).toHaveBeenCalled();
    const input = useAgentRunLifecycleMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(input.deferInitialDispatch).toBe(true);
    expect(input.arm).toEqual({
      kind: "workflow",
      workflowName: WorkflowName.PlanFromDesignDoc,
    });
    expect(dispatchStartRunMock).not.toHaveBeenCalled();
  });

  it("uses the authoritative ready machine when the persisted session is stale", async () => {
    const authoritativeMachineId = "machine-selected-by-readiness";
    const authoritativeMachine = machine(authoritativeMachineId);
    useMachineResolutionMock.mockReturnValue({
      machines: [authoritativeMachine],
      executionReadyMachines: [authoritativeMachine],
      isReady: true,
      mode: "one",
      selectedMachine: authoritativeMachine,
      setSelectedMachineId: vi.fn(),
    });
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [buildSession({ machineId: "stale-session-machine" })],
      isFetched: true,
      markStale: vi.fn(),
      remove: vi.fn(),
    });

    renderChat();

    expect(useMachineResolutionMock).toHaveBeenCalledWith(
      "stale-session-machine",
    );

    const lifecycleInput = useAgentRunLifecycleMock.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(lifecycleInput.machineId).toBe(authoritativeMachineId);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    await waitFor(() => {
      expect(updateAgentSessionRecordMock).toHaveBeenCalledTimes(1);
    });
    expect(updateAgentSessionRecordMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ machineId: authoritativeMachineId }),
    );
    expect(dispatchStartRunMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed without persistence or dispatch when readiness is unavailable", () => {
    useMachineResolutionMock.mockReturnValue({
      machines: [],
      executionReadyMachines: [],
      isReady: true,
      mode: "zero",
      selectedMachine: null,
      setSelectedMachineId: vi.fn(),
    });

    renderChat();

    fireEvent.click(
      screen.getByTestId("plan-from-design-doc-start-generating"),
    );

    expect(updatePlanMock).not.toHaveBeenCalled();
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
    expect(dispatchStartRunMock).not.toHaveBeenCalled();
  });

  it("renders the seed design doc and the Start generating button on a NOT_STARTED session", () => {
    renderChat();

    expect(screen.getByTestId("plan-from-design-doc-pre-start")).toBeTruthy();
    expect(screen.getByTestId("design-doc-read-view")).toBeTruthy();
    expect(screen.getByText("Seed Doc")).toBeTruthy();
    expect(screen.getByText("Seed body markdown")).toBeTruthy();
    expect(
      screen.getByTestId("plan-from-design-doc-start-generating"),
    ).toBeTruthy();
    // The live conversation view is not shown until the user starts generating.
    expect(screen.queryByTestId("agent-conversation-view")).toBeNull();
  });

  it("keeps Start generating disabled while no model is chosen", () => {
    renderPreStart({ provider: null, model: null });

    expect(
      screen.getByTestId("plan-from-design-doc-start-generating"),
    ).toBeDisabled();
  });

  it("renders multiple ready bridges as selectable options", () => {
    const firstMachine = machine("machine-1");
    const secondMachine = machine("machine-2");
    useMachineResolutionMock.mockReturnValue({
      machines: [firstMachine, secondMachine],
      executionReadyMachines: [firstMachine, secondMachine],
      isReady: true,
      mode: "many",
      selectedMachine: firstMachine,
      setSelectedMachineId: vi.fn(),
    });

    renderChat();

    expect(screen.getByTestId("machine-picker")).toBeTruthy();
    expect(
      screen.getByTestId("plan-from-design-doc-start-generating"),
    ).toBeEnabled();

    fireEvent.mouseDown(
      within(screen.getByTestId("machine-picker")).getByRole("combobox"),
    );
    const remoteOption = screen.getByRole("option", {
      name: "machine-2 — Ready",
    });
    expect(remoteOption).not.toHaveAttribute("aria-disabled", "true");
  });

  it("shows Fast mode for a supported model and persists and dispatches its explicit value", async () => {
    surfaceSelectionState.value = {
      provider: "codex",
      model: "gpt-5.4",
      reasoningEffort: "high",
      fastMode: true,
    };

    renderChat();

    const fastModeControl = await screen.findByTestId(
      "plan-model-selector-fast-mode-switch",
    );
    expect(fastModeControl.querySelector("input")).toBeChecked();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    await waitFor(() => {
      expect(updateAgentSessionRecordMock).toHaveBeenCalled();
    });
    expect(updateAgentSessionRecordMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        config: expect.objectContaining({ fastMode: true }),
      }),
    );
    expect(useAgentRunLifecycleMock).toHaveBeenCalledWith(
      expect.objectContaining({ fastMode: true, machineId: "machine-1" }),
    );
  });

  it("omits Fast mode for an unsupported provider and model", async () => {
    surfaceSelectionState.value = {
      provider: "claude",
      model: "claude-opus-4-8",
      reasoningEffort: "high",
      fastMode: true,
    };

    renderChat();

    expect(
      screen.queryByTestId("plan-model-selector-fast-mode-switch"),
    ).toBeNull();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    await waitFor(() => {
      expect(updateAgentSessionRecordMock).toHaveBeenCalled();
    });
    const persistedConfig = updateAgentSessionRecordMock.mock.calls[0][0]
      .config as Record<string, unknown>;
    expect(persistedConfig).not.toHaveProperty("fastMode");
    expect(useAgentRunLifecycleMock.mock.calls[0][0]).not.toHaveProperty(
      "fastMode",
    );
  });

  it("renders the plan worktree toggle with the branch field hidden when disabled", () => {
    renderChat();

    expect(screen.getByTestId("plan-generation-settings-card")).toBeTruthy();
    expect(screen.getByTestId("plan-worktree-toggle")).toBeTruthy();
    expect(screen.queryByTestId("plan-worktree-branch")).toBeNull();
  });

  it("defaults the plan-combination aggressiveness selector to medium", () => {
    renderChat();

    expect(screen.getByText("Step consolidation")).toBeTruthy();
    expect(
      screen.getByText(/Controls how much the final review pass may combine/i),
    ).toBeTruthy();
    expect(
      screen.getByTestId("plan-combination-aggressiveness-selector"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("plan-combination-aggressiveness-medium"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("updates the selected plan-combination aggressiveness", () => {
    const handleChange = vi.fn();

    renderPreStart({
      planCombinationAggressiveness: PlanCombinationAggressiveness.Medium,
      onPlanCombinationAggressivenessChange: handleChange,
    });

    fireEvent.click(screen.getByTestId("plan-combination-aggressiveness-high"));

    expect(handleChange).toHaveBeenCalledWith(
      PlanCombinationAggressiveness.High,
    );
  });

  it("seeds plan-combination aggressiveness from session config", () => {
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [
        buildSession({
          config: {
            type: AgentSessionConfigV2TypeEnum.CodingSession,
            version: "v2",
            model: "claude-opus-4-8",
            planCombinationAggressiveness: PlanCombinationAggressiveness.High,
          },
        }),
      ],
      isFetched: true,
      markStale: vi.fn(),
      remove: vi.fn(),
    });

    renderChat();

    expect(
      screen.getByTestId("plan-combination-aggressiveness-high"),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("seeds the local worktree state from plan.worktreeBranch", () => {
    renderChat(buildPlan(), {
      ...configuration,
      worktreeBranch: "heyhey/plan-test",
    });

    const toggle = screen.getByRole("switch", {
      name: "Use a worktree for this plan",
    }) as HTMLInputElement;
    const branchInput = screen.getByLabelText(
      "Branch name",
    ) as HTMLInputElement;

    expect(toggle.checked).toBe(true);
    expect(branchInput.value).toBe("heyhey/plan-test");
  });

  it("shows an editable plan worktree branch field when a branch exists", () => {
    const handleBranchChange = vi.fn();

    renderPreStart({
      worktreeEnabled: true,
      worktreeBranch: "heyhey/plan-test",
      onWorktreeBranchChange: handleBranchChange,
    });

    expect(screen.getByTestId("plan-worktree-branch")).toBeTruthy();
    const branchInput = screen.getByLabelText("Branch name");

    fireEvent.change(branchInput, {
      target: { value: "heyhey/plan-updated" },
    });

    expect(handleBranchChange).toHaveBeenCalledWith("heyhey/plan-updated");
  });

  it("defaults the worktree branch from the plan title when enabled", () => {
    renderChat();

    fireEvent.click(screen.getByTestId("plan-worktree-toggle"));

    expect(screen.getByTestId("plan-worktree-branch")).toBeTruthy();
    expect(
      (screen.getByLabelText("Branch name") as HTMLInputElement).value,
    ).toBe("test-plan");
  });

  it("falls back to a deterministic non-empty branch when the plan title has no slug", () => {
    renderChat(buildPlan({ name: "!!!" }));

    fireEvent.click(screen.getByTestId("plan-worktree-toggle"));

    expect(
      (screen.getByLabelText("Branch name") as HTMLInputElement).value,
    ).toBe("plan-worktree");
  });

  it("keeps workflow mentions inside the shared design-doc read surface before start", () => {
    usePlanFromDesignDocSeedMock.mockReturnValue({
      seed: {
        title: "Seed Doc",
        sections: [
          {
            key: "content",
            materializedMarkdown:
              "Use @[workflow:wf-1|Review workflow] before generating.",
          },
        ],
      },
      designDocId: "design-doc-1",
      isLoading: false,
      error: null,
    });

    renderChat();

    const readView = screen.getByTestId("design-doc-read-view");
    expect(readView).toBeTruthy();
    const unavailableWorkflow = screen.getByTestId(
      "workflow-inline-diagram-unavailable",
    );
    expect(unavailableWorkflow).toHaveTextContent("Review workflow");
    expect(unavailableWorkflow).toHaveAttribute("data-workflow-id", "wf-1");
    expect(screen.queryByTestId("mention-badge")).toBeNull();
    expect(useWorkItemGraphMock).toHaveBeenCalledWith(
      "org-1",
      "proj-1",
      "wf-1",
      { enabled: true },
    );
  });

  it("persists a null worktreeBranch before start when worktree is disabled", async () => {
    const persistedSession = buildSession({
      provider: AgentSessionDtoProviderEnum.Codex,
      config: {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: "v2",
        model: "gpt-5-codex",
        effort: "high",
        planCombinationAggressiveness: PlanCombinationAggressiveness.Medium,
      },
    });
    updateAgentSessionRecordMock.mockResolvedValueOnce({
      ok: true,
      session: persistedSession,
    });

    renderChat();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    expect(updatePlanMock).toHaveBeenCalledWith("plan-1", {
      sections: [
        {
          key: "planConfiguration",
          content: { ...configuration, worktreeBranch: null },
        },
      ],
      sectionUpdateSource: TaskSectionUpdateSource.User,
    });
    expect(dispatchStartRunMock).toHaveBeenCalledTimes(1);
    expect(updatePlanMock.mock.invocationCallOrder[0]).toBeLessThan(
      dispatchStartRunMock.mock.invocationCallOrder[0],
    );

    await waitFor(() => {
      expect(updateAgentSessionRecordMock).toHaveBeenCalledTimes(1);
    });
    expect(updateAgentSessionRecordMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: SESSION_ID,
        config: expect.objectContaining({
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          version: "v2",
          model: "claude-opus-4-8",
          planCombinationAggressiveness: PlanCombinationAggressiveness.Medium,
        }),
      }),
    );
    expect(
      updateAgentSessionRecordMock.mock.invocationCallOrder[0],
    ).toBeLessThan(dispatchStartRunMock.mock.invocationCallOrder[0]);

    // Canonical lifecycle remains server-owned after acceptance.
    await waitFor(() => {
      expect(screen.getByTestId("agent-conversation-view")).toBeTruthy();
    });
    expect(
      screen
        .getByTestId("agent-conversation-view")
        .getAttribute("data-conversation-id"),
    ).toBe(CONVERSATION_ID);
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-hide-composer",
      "false",
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-session-model",
      "gpt-5-codex",
    );
    expect(screen.getByTestId("agent-conversation-view")).toHaveAttribute(
      "data-session-effort",
      "high",
    );
    expect(screen.queryByTestId("plan-from-design-doc-pre-start")).toBeNull();
  });

  it("persists the selected plan-combination aggressiveness before start", async () => {
    renderChat();

    fireEvent.click(screen.getByTestId("plan-combination-aggressiveness-high"));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    await waitFor(() => {
      expect(updateAgentSessionRecordMock).toHaveBeenCalled();
    });
    expect(updateAgentSessionRecordMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: SESSION_ID,
        config: expect.objectContaining({
          planCombinationAggressiveness: PlanCombinationAggressiveness.High,
        }),
      }),
    );
    expect(
      updateAgentSessionRecordMock.mock.invocationCallOrder[0],
    ).toBeLessThan(dispatchStartRunMock.mock.invocationCallOrder[0]);
  });

  it("preserves existing session config fields while adding plan-combination aggressiveness", async () => {
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [
        buildSession({
          config: {
            type: AgentSessionConfigV2TypeEnum.CodingSession,
            version: "v2",
            method: "task",
            model: "previous-model",
            effort: "high",
            worktree: "existing-worktree",
            projectAssistant: { proactive: true },
          },
        }),
      ],
      isFetched: true,
      markStale: vi.fn(),
      remove: vi.fn(),
    });
    renderChat(buildPlan(), {
      ...configuration,
      worktreeBranch: "heyhey/plan-test",
    });

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    await waitFor(() => {
      expect(updateAgentSessionRecordMock).toHaveBeenCalled();
    });
    expect(updateAgentSessionRecordMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        config: expect.objectContaining({
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          version: "v2",
          method: "task",
          model: "claude-opus-4-8",
          effort: "medium",
          worktree: "heyhey/plan-test",
          projectAssistant: { proactive: true },
          planCombinationAggressiveness: PlanCombinationAggressiveness.Medium,
        }),
      }),
    );
  });

  it("does not dispatch start when session config persistence fails", async () => {
    updateAgentSessionRecordMock.mockResolvedValueOnce({
      ok: false,
      error: "config save failed",
    });
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      renderChat();

      await act(async () => {
        fireEvent.click(
          screen.getByTestId("plan-from-design-doc-start-generating"),
        );
      });

      await waitFor(() => {
        expect(updateAgentSessionRecordMock).toHaveBeenCalledTimes(1);
      });
      expect(dispatchStartRunMock).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent("config save failed");
      expect(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      ).toBeEnabled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it("persists the enabled worktree branch before start", async () => {
    renderChat();

    fireEvent.click(screen.getByTestId("plan-worktree-toggle"));

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    expect(updatePlanMock).toHaveBeenCalledWith("plan-1", {
      sections: [
        {
          key: "planConfiguration",
          content: { ...configuration, worktreeBranch: "test-plan" },
        },
      ],
      sectionUpdateSource: TaskSectionUpdateSource.User,
    });
    expect(dispatchStartRunMock).toHaveBeenCalledTimes(1);
  });

  it.each(["failed", "pending"])(
    "does not launch when worktree persistence is %s",
    async (mode) => {
      if (mode === "failed")
        updatePlanMock.mockRejectedValueOnce(new Error("save failed"));
      else updatePlanMock.mockResolvedValueOnce({ status: "pending" });
      renderChat();
      await act(async () => {
        fireEvent.click(
          screen.getByTestId("plan-from-design-doc-start-generating"),
        );
      });
      expect(await screen.findByRole("alert")).toHaveTextContent(
        mode === "failed" ? "save failed" : "awaiting proposal approval",
      );
      expect(dispatchStartRunMock).not.toHaveBeenCalled();
      expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
      expect(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      ).toBeInTheDocument();
    },
  );

  it("does not flip the session to IN_PROGRESS when the start-run dispatch fails", async () => {
    dispatchStartRunMock.mockResolvedValue({
      ok: false,
      error: "start-run rejected",
    });

    renderChat();

    await act(async () => {
      fireEvent.click(
        screen.getByTestId("plan-from-design-doc-start-generating"),
      );
    });

    expect(dispatchStartRunMock).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(updateAgentSessionRecordMock).toHaveBeenCalledTimes(1);
    });
    expect(updateAgentSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({
          planCombinationAggressiveness: PlanCombinationAggressiveness.Medium,
        }),
      }),
    );
  });

  it("shows the placeholder on a freshly materialized (NOT_STARTED conversation) session even when the session is already IN_PROGRESS", () => {
    // The server materializes the PLAN_GENERATION session as IN_PROGRESS at
    // create_plan approval, so session status must not gate the placeholder.
    // The conversation is the authoritative kickoff signal.
    useAgentSessionsMock.mockReturnValue({
      agentSessions: [buildSession({ status: AgentSessionStatus.InProgress })],
      isFetched: true,
      markStale: vi.fn(),
      remove: vi.fn(),
    });

    renderChat();

    expect(screen.getByTestId("plan-from-design-doc-pre-start")).toBeTruthy();
    expect(screen.queryByTestId("agent-conversation-view")).toBeNull();
    expect(dispatchStartRunMock).not.toHaveBeenCalled();
  });

  it("skips the placeholder and shows the live view directly for an already-started conversation", () => {
    renderWithConversation({
      ...conversation,
      status: ConversationStatus.InProgress,
    });

    expect(screen.getByTestId("agent-conversation-view")).toBeTruthy();
    expect(screen.queryByTestId("plan-from-design-doc-pre-start")).toBeNull();
    expect(dispatchStartRunMock).not.toHaveBeenCalled();
  });

  it("navigates to the seed design doc in edit mode on Edit design doc", () => {
    renderChat();

    fireEvent.click(screen.getByTestId("plan-from-design-doc-edit-design-doc"));

    expect(navigateMock).toHaveBeenCalledWith(
      "/projects/proj-1/design-docs/design-doc-1?editing=true",
    );
  });

  it("does not render the Edit design doc button when the plan has no design doc", () => {
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
      designDocId: undefined,
      isLoading: false,
      error: null,
    });

    renderChat();

    expect(
      screen.queryByTestId("plan-from-design-doc-edit-design-doc"),
    ).toBeNull();
  });

  it("disables Start generating and surfaces a notice when the CLI is not connected", () => {
    useMachineResolutionMock.mockReturnValue({
      machines: [],
      executionReadyMachines: [],
      isReady: true,
      mode: "zero",
      selectedMachine: null,
      setSelectedMachineId: vi.fn(),
    });

    renderChat();

    expect(
      (
        screen.getByTestId(
          "plan-from-design-doc-start-generating",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "Pair an Agent Bridge" }),
    ).toBeTruthy();
  });

  it("does not flash the disconnected notice while the first CLI check is in flight", () => {
    useMachineResolutionMock.mockReturnValue({
      machines: [],
      executionReadyMachines: [],
      isReady: false,
      mode: "zero",
      selectedMachine: null,
      setSelectedMachineId: vi.fn(),
    });

    renderChat();

    // No notice yet, but the button stays disabled (fail-closed) until the CLI
    // is confirmed connected.
    expect(
      screen.queryByRole("button", { name: "Pair an Agent Bridge" }),
    ).toBeNull();
    expect(
      (
        screen.getByTestId(
          "plan-from-design-doc-start-generating",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("does not expose lifecycle retry while execution readiness is unavailable", () => {
    const unenrolledMachine = machine(
      "unenrolled-machine",
      MachineExecutionReadinessState.ControllerEnrollmentRequired,
    );
    useMachineResolutionMock.mockReturnValue({
      machines: [unenrolledMachine],
      executionReadyMachines: [],
      isReady: true,
      mode: "zero",
      selectedMachine: null,
      setSelectedMachineId: vi.fn(),
    });
    setLifecycle({ error: "Run initialization failed" });

    renderChat();

    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
    expect(screen.getByText("Controller setup required")).toBeTruthy();
    expect(dispatchStartRunMock).not.toHaveBeenCalled();
    expect(updatePlanMock).not.toHaveBeenCalled();
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
  });
});

it("shows a defined state when the draft conversation has no linked generation session", () => {
  useAgentSessionsMock.mockReturnValue({
    agentSessions: [],
    isFetched: true,
    error: null,
  });
  renderChat();
  expect(
    screen.getByTestId("plan-generation-session-unavailable"),
  ).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  expect(dispatchStartRunMock).not.toHaveBeenCalled();
});
it("surfaces a generation-session lookup error", () => {
  useAgentSessionsMock.mockReturnValue({
    agentSessions: [],
    isFetched: false,
    error: new Error("Session lookup failed"),
  });
  renderChat();
  expect(screen.getByTestId("plan-generation-session-error")).toHaveTextContent(
    "Session lookup failed",
  );
});

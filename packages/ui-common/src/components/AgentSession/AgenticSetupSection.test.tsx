import { http, HttpResponse } from "msw";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CurrentControllerMachineEligibilityState } from "../../api";
import type {
  AgentProvider,
  ReasoningEffort,
  SessionMethodSelection,
} from "./runtime";
import type { SessionLaunchOptions } from "./AgenticSetupSection";

const useAgentSetupMock = vi.fn();
const showCreateServiceMock = vi.fn();
const startWalkthroughMock = vi.fn();
const exitWalkthroughMock = vi.fn();
const useWorkItemTypeByKeyMock = vi.fn();
const useProjectModeCatalogMock = vi.fn();

const mockEmptyProjectModeCatalog = () => {
  useProjectModeCatalogMock.mockReturnValue({
    catalog: [],
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
  });
};

vi.mock("./runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime")>();
  return {
    ...actual,
    useAgentSetup: (...args: unknown[]) => useAgentSetupMock(...args),
  };
});

vi.mock("./runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => ({
    machines: [
      {
        machineId: "machine-1",
        name: "My Machine",
        active: true,
        pairedAt: "2026-08-13T00:00:00.000Z",
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
    ],
    executionReadyMachines: [],
    mode: "one",
    selectedMachine: {
      machineId: "machine-1",
      name: "My Machine",
      active: true,
      pairedAt: "2026-08-13T00:00:00.000Z",
      authorizationProtocolVersion: 2,
      executionReadiness: "READY",
      currentControllerEligibility:
        CurrentControllerMachineEligibilityState.Eligible,
      bindings: [],
    },
    setSelectedMachineId: vi.fn(),
  }),
}));

vi.mock("../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: (...args: unknown[]) =>
    useWorkItemTypeByKeyMock(...args),
}));

vi.mock("../../data/hooks/useProjectModeCatalog", () => ({
  useProjectModeCatalog: (...args: unknown[]) =>
    useProjectModeCatalogMock(...args),
}));

vi.mock("../../data/hooks/useFullEntityContext", () => ({
  useFullEntityContext: () => ({
    data: null,
    isLoading: false,
    isFetched: true,
    error: null,
    refetch: vi.fn(),
  }),
}));

const submitMachinePingViaPlatformMock = vi.fn();

vi.mock("./runtime/hooks/submitMachinePingViaPlatform", () => ({
  submitMachinePingViaPlatform: (...args: unknown[]) =>
    submitMachinePingViaPlatformMock(...args),
}));

vi.mock("../../contexts/ModalService", () => ({
  useModalService: () => ({ showCreateService: showCreateServiceMock }),
}));

vi.mock("../GuidedWalkthrough", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../GuidedWalkthrough")>();
  return {
    ...actual,
    useGuidedWalkthroughControls: () => ({
      startWalkthrough: startWalkthroughMock,
      exitWalkthrough: exitWalkthroughMock,
    }),
  };
});

vi.mock("../AgentSessions", () => ({
  AgentSetupView: ({
    onAddService,
    onSubmitPrompt,
    worktreeBranch,
    worktreeLocked,
    compatibleSessionMethods,
    launchErrorMessages = [],
  }: {
    onAddService: (() => void) | null;
    onSubmitPrompt: () => void;
    worktreeBranch: string | null;
    worktreeLocked: boolean;
    compatibleSessionMethods: readonly string[];
    launchErrorMessages?: readonly string[];
  }) => (
    <>
      <div data-testid="stub-worktree-enabled">
        {worktreeBranch !== null ? "true" : "false"}
      </div>
      <div data-testid="stub-worktree-locked">
        {worktreeLocked ? "true" : "false"}
      </div>
      <div data-testid="stub-worktree-branch">{worktreeBranch ?? ""}</div>
      <button
        type="button"
        data-testid="stub-add-service"
        onClick={() => onAddService?.()}
      >
        add service
      </button>
      <div data-testid="stub-compatible-methods">
        {compatibleSessionMethods.join(",")}
      </div>
      <div data-testid="stub-submit-prompt-area">
        {launchErrorMessages.map((message) => (
          <div key={message} role="alert">
            {message}
          </div>
        ))}
        <button
          type="button"
          data-testid="stub-submit-prompt"
          onClick={onSubmitPrompt}
        >
          submit
        </button>
      </div>
    </>
  ),
}));

import { AgenticSetupSection } from "./AgenticSetupSection";

interface SetupOverrides {
  selectedProvider: AgentProvider | null;
  selectedModel: string | null;
  selectedReasoningEffort: ReasoningEffort | null;
  selectedFastMode?: boolean;
  worktreeBranch?: string | null;
  worktreeLocked?: boolean;
  error?: string | null;
}

const baseSessionMethodSelection: SessionMethodSelection = {
  method: "plan",
  serviceIds: ["service-1"],
  services: [{ id: "service-1", name: "Service 1" }],
};

const buildSetup = (overrides: SetupOverrides) => ({
  services: [],
  repoBindings: [],
  selectedServiceId: "service-1",
  selectedServiceIds: ["service-1"],
  selectedProvider: overrides.selectedProvider,
  selectedBinding: null,
  directoryPath: "/tmp/repo",
  step: "selection" as const,
  sessionMethodSelection: baseSessionMethodSelection,
  isMultiServiceMode: false,
  canStart: true,
  loadingServices: false,
  servicesError: null,
  pickingDirectory: false,
  mappingDirectory: false,
  starting: false,
  error: overrides.error ?? null,
  selectService: vi.fn(),
  toggleService: vi.fn(),
  selectProvider: vi.fn(),
  selectedModel: overrides.selectedModel,
  selectModel: vi.fn(),
  selectedReasoningEffort: overrides.selectedReasoningEffort,
  selectReasoningEffort: vi.fn(),
  selectedFastMode: overrides.selectedFastMode ?? false,
  selectFastMode: vi.fn(),
  goToSessionMethod: vi.fn(),
  goToSelection: vi.fn(),
  goToPrompt: vi.fn(),
  selectSessionMethod: vi.fn(),
  selectProjectMode: vi.fn(),
  projectModeSelection: null,
  validateProjectModeSelection: vi.fn(() => true),
  promptDraft: "",
  setPromptDraft: vi.fn(),
  setDirectoryPath: vi.fn(),
  pickDirectory: vi.fn().mockResolvedValue(undefined),
  mapDirectory: vi.fn().mockResolvedValue(undefined),
  start: vi.fn().mockResolvedValue({ ok: true }),
  launchServiceId: "service-1",
  setLaunchServiceId: vi.fn(),
  directoryPaths: {},
  setDirectoryPathForService: vi.fn(),
  pickDirectoryForService: vi.fn().mockResolvedValue(undefined),
  worktreeBranch: overrides.worktreeBranch ?? null,
  worktreeLocked: overrides.worktreeLocked ?? false,
  setWorktreeBranch: vi.fn(),
});

const renderSection = (
  onPromptSubmitted: (
    selection: SessionMethodSelection,
    launchOptions: SessionLaunchOptions,
    promptDraft: string,
  ) => void,
  options: {
    lockedWorktreeBranch?: string | null;
    taskData?: WorkItemResponseDto | null;
  } = {},
) =>
  render(
    <AgenticSetupSection
      organizationId="org-1"
      projectId="proj-1"
      agentSessionId="session-1"
      userId="user-1"
      boundServiceId="service-1"
      taskServiceIds={["service-1"]}
      boundProvider={null}
      lockedWorktreeBranch={options.lockedWorktreeBranch}
      skipServiceSelection
      onPromptSubmitted={onPromptSubmitted}
      taskData={
        options.taskData === undefined
          ? ({
              id: "task-1",
              name: "Task 1",
              type: "STANDARD",
            } as WorkItemResponseDto)
          : options.taskData
      }
    />,
  );

describe("AgenticSetupSection lockedWorktreeBranch threading", () => {
  beforeEach(() => {
    globalThis.mswServer.use(
      http.get("*/api/local/repos", () =>
        HttpResponse.json({ machineId: "machine-1", bindings: [] }),
      ),
    );
    useAgentSetupMock.mockReset();
    submitMachinePingViaPlatformMock.mockReset();
    useProjectModeCatalogMock.mockReset();
    mockEmptyProjectModeCatalog();
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: { key: "STANDARD" },
      isFetched: true,
    });
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
      }),
    );
  });

  it("passes an explicit lockedWorktreeBranch into useAgentSetup", () => {
    renderSection(vi.fn(), { lockedWorktreeBranch: "plan/shared-branch" });

    expect(useAgentSetupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: "plan/shared-branch",
      }),
    );
  });

  it("passes null into useAgentSetup when lockedWorktreeBranch is omitted", () => {
    renderSection(vi.fn());

    expect(useAgentSetupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: null,
      }),
    );
  });
});

describe("AgenticSetupSection onStarted launch payload", () => {
  beforeEach(() => {
    globalThis.mswServer.use(
      http.get("*/api/local/repos", () =>
        HttpResponse.json({ machineId: "machine-1", bindings: [] }),
      ),
    );
    useAgentSetupMock.mockReset();
    submitMachinePingViaPlatformMock.mockReset();
    useProjectModeCatalogMock.mockReset();
    mockEmptyProjectModeCatalog();
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: true,
    });
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: { key: "STANDARD" },
      isFetched: true,
    });
  });

  it("does not materialize a run while setup is only being configured", () => {
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
      }),
    );
    const onStarted = vi.fn();

    renderSection(onStarted);

    expect(onStarted).not.toHaveBeenCalled();
  });

  it("forwards provider 'claude' in the launchOptions payload after Submit Prompt", async () => {
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
      }),
    );

    const onStarted = vi.fn();
    renderSection(onStarted);
    const user = userEvent.setup();

    // Submit Prompt is the only materialization action.
    await user.click(screen.getByTestId("stub-submit-prompt"));

    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith(
        expect.objectContaining({ method: "plan" }),
        expect.objectContaining({
          provider: "claude",
          model: "claude-opus-4-7",
          reasoningEffort: "medium",
          machineId: "machine-1",
        }),
        "",
        [],
      ),
    );
  });

  it("forwards a non-Claude provider in the launchOptions payload after Submit Prompt", async () => {
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "codex",
        selectedModel: "gpt-5-codex",
        selectedReasoningEffort: "high",
      }),
    );

    const onStarted = vi.fn();
    renderSection(onStarted);
    const user = userEvent.setup();

    await user.click(screen.getByTestId("stub-submit-prompt"));

    await waitFor(() =>
      expect(onStarted).toHaveBeenCalledWith(
        expect.objectContaining({ method: "plan" }),
        expect.objectContaining({
          provider: "codex",
          model: "gpt-5-codex",
          reasoningEffort: "high",
          machineId: "machine-1",
        }),
        "",
        [],
      ),
    );
  });
});

describe("AgenticSetupSection ping error Alert", () => {
  beforeEach(() => {
    globalThis.mswServer.use(
      http.get("*/api/local/repos", () =>
        HttpResponse.json({ machineId: "machine-1", bindings: [] }),
      ),
    );
    useAgentSetupMock.mockReset();
    submitMachinePingViaPlatformMock.mockReset();
    useProjectModeCatalogMock.mockReset();
    mockEmptyProjectModeCatalog();
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
      }),
    );
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: { key: "STANDARD" },
      isFetched: true,
    });
  });

  it("shows a machine-unreachable Alert and does not call onStarted when ping is not acknowledged", async () => {
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: false,
    });

    const onStarted = vi.fn();
    renderSection(onStarted);
    const user = userEvent.setup();

    // Ping now lives on Submit Prompt (step 3), not on Next (step 2).
    await user.click(screen.getByTestId("stub-submit-prompt"));

    expect(onStarted).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(
        within(screen.getByTestId("stub-submit-prompt-area")).getByRole(
          "alert",
        ),
      ).toHaveTextContent(/not reachable/i),
    );
  });

  it("places setup launch errors beside Submit Prompt", () => {
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
        error: "Agent session update was rejected.",
      }),
    );

    renderSection(vi.fn());

    expect(
      within(screen.getByTestId("stub-submit-prompt-area")).getByRole("alert"),
    ).toHaveTextContent("Agent session update was rejected.");
  });
});

describe("AgenticSetupSection worktree prop threading", () => {
  beforeEach(() => {
    globalThis.mswServer.use(
      http.get("*/api/local/repos", () =>
        HttpResponse.json({ machineId: "machine-1", bindings: [] }),
      ),
    );
    useAgentSetupMock.mockReset();
    submitMachinePingViaPlatformMock.mockReset();
    useProjectModeCatalogMock.mockReset();
    mockEmptyProjectModeCatalog();
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: { key: "STANDARD" },
      isFetched: true,
    });
  });

  it("forwards the worktree state to AgentSetupView", () => {
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
        worktreeBranch: "feature/worktree",
        worktreeLocked: true,
      }),
    );

    renderSection(vi.fn());

    expect(screen.getByTestId("stub-worktree-enabled")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("stub-worktree-branch")).toHaveTextContent(
      "feature/worktree",
    );
    expect(screen.getByTestId("stub-worktree-locked")).toHaveTextContent(
      "true",
    );
  });

  it("keeps the inherited Plan branch and lock visible at the section boundary", () => {
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
        worktreeBranch: "plan/shared-branch",
        worktreeLocked: true,
      }),
    );

    renderSection(vi.fn(), { lockedWorktreeBranch: "plan/shared-branch" });

    expect(useAgentSetupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: "plan/shared-branch",
      }),
    );
    expect(screen.getByTestId("stub-worktree-branch")).toHaveTextContent(
      "plan/shared-branch",
    );
    expect(screen.getByTestId("stub-worktree-locked")).toHaveTextContent(
      "true",
    );
  });

  it("fails closed while the selected work-item type is unresolved", () => {
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: undefined,
      isFetched: false,
    });
    useAgentSetupMock.mockReturnValue(buildSetup({}));

    renderSection(vi.fn());

    expect(screen.getByTestId("stub-compatible-methods")).toBeEmptyDOMElement();
  });

  it("preserves the full method catalog when the session has no work item", () => {
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: undefined,
      isFetched: false,
    });
    useAgentSetupMock.mockReturnValue(buildSetup({}));

    renderSection(vi.fn(), { taskData: null });

    expect(screen.getByTestId("stub-compatible-methods")).toHaveTextContent(
      "plan,open,quick,debug,research,split_by_service,split_by_function",
    );
  });
});

describe("AgenticSetupSection Add a service", () => {
  beforeEach(() => {
    globalThis.mswServer.use(
      http.get("*/api/local/repos", () =>
        HttpResponse.json({ machineId: "machine-1", bindings: [] }),
      ),
    );
    useAgentSetupMock.mockReset();
    showCreateServiceMock.mockReset();
    startWalkthroughMock.mockReset();
    exitWalkthroughMock.mockReset();
    useProjectModeCatalogMock.mockReset();
    mockEmptyProjectModeCatalog();
    useWorkItemTypeByKeyMock.mockReturnValue({
      workItemTypeDefinition: { key: "STANDARD" },
      isFetched: true,
    });
    useAgentSetupMock.mockReturnValue(
      buildSetup({
        selectedProvider: "claude",
        selectedModel: "claude-opus-4-7",
        selectedReasoningEffort: "medium",
      }),
    );
  });

  it("opens the Create Service modal for the project and starts the Add a service walkthrough", async () => {
    const onPromptSubmitted = vi.fn();
    renderSection(onPromptSubmitted);

    await userEvent.click(screen.getByTestId("stub-add-service"));

    expect(showCreateServiceMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ projectId: "proj-1" }),
    );
    expect(startWalkthroughMock).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ title: "Add a service" }),
    );
    expect(onPromptSubmitted).not.toHaveBeenCalled();
    expect(
      useAgentSetupMock.mock.results[0]?.value.start,
    ).not.toHaveBeenCalled();
  });

  it("ends the walkthrough when the modal closes", async () => {
    renderSection(vi.fn());
    await userEvent.click(screen.getByTestId("stub-add-service"));
    expect(exitWalkthroughMock).not.toHaveBeenCalled();

    showCreateServiceMock.mock.calls[0][0].onClose();

    expect(exitWalkthroughMock).toHaveBeenCalledOnce();
  });
});

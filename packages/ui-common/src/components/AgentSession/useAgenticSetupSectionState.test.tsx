import { http, HttpResponse } from "msw";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CurrentControllerMachineEligibilityState } from "../../api";
import {
  ProjectModeSelectionSchemaVersionEnum,
  type MachineDto,
  type ProjectModeSelection,
} from "../../api";
import type {
  AgentProvider,
  ReasoningEffort,
  SessionMethodSelection,
} from "./runtime";
import type { SessionLaunchOptions } from "./AgenticSetupSection";
import type { SessionMethod } from "../../agents/coordination/types";
import {
  buildAgentSetupDraftContextKey,
  readAgentSetupDraft,
  upsertAgentSetupDraft,
} from "./agentSetupDraftMemory";

const useAgentSetupMock = vi.fn();

vi.mock("./runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime")>();
  return {
    ...actual,
    useAgentSetup: (...args: unknown[]) => useAgentSetupMock(...args),
  };
});

const mockSelectedMachine: MachineDto = {
  machineId: "machine-1",
  name: "My Machine",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: 2,
  executionReadiness: "READY",
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};

const mockIneligibleMachine: MachineDto = {
  machineId: "machine-legacy",
  name: "Legacy Machine",
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: false,
  authorizationProtocolVersion: 1,
  executionReadiness: "LEGACY_PROTOCOL",
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
  bindings: [],
};

const mockMachineResolution = {
  machines: [mockSelectedMachine] as MachineDto[],
  executionReadyMachines: [mockSelectedMachine] as MachineDto[],
  mode: "one" as "zero" | "one" | "many",
  selectedMachine: mockSelectedMachine as MachineDto | null,
  setSelectedMachineId: vi.fn(),
  isReady: true,
};

const resetMachineResolution = () => {
  mockMachineResolution.machines = [mockSelectedMachine];
  mockMachineResolution.executionReadyMachines = [mockSelectedMachine];
  mockMachineResolution.mode = "one";
  mockMachineResolution.selectedMachine = mockSelectedMachine;
};

vi.mock("./runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => mockMachineResolution,
}));

const submitMachinePingViaPlatformMock = vi.fn();

vi.mock("./runtime/hooks/submitMachinePingViaPlatform", () => ({
  submitMachinePingViaPlatform: (...args: unknown[]) =>
    submitMachinePingViaPlatformMock(...args),
}));

import { useAgenticSetupSectionState } from "./useAgenticSetupSectionState";

beforeEach(() => {
  globalThis.mswServer.use(
    http.get("*/api/local/repos", () =>
      HttpResponse.json({ machineId: "machine-1", bindings: [] }),
    ),
  );
  resetMachineResolution();
  localStorage.clear();
});

const setupContextKey = buildAgentSetupDraftContextKey(
  "org-1",
  "proj-1",
  "session-1",
);

const seedSetupDraft = () => {
  upsertAgentSetupDraft("user-1", {
    setupContextKey,
    sessionMethod: "plan",
    serviceIds: ["service-1"],
    launchServiceId: "service-1",
    worktreeBranch: null,
    provider: "claude",
    model: "claude-opus-4-7",
    reasoningEffort: "medium",
  });
};

interface SetupOverrides {
  selectedProvider?: AgentProvider | null;
  selectedModel?: string | null;
  selectedReasoningEffort?: ReasoningEffort | null;
  selectedFastMode?: boolean;
  startResult?: { ok: true } | { ok: false; error: string };
  sessionMethodSelection?: SessionMethodSelection;
  projectModeSelection?: ProjectModeSelection | null;
  projectModeSelectionValid?: boolean;
}

const buildSetup = (overrides: SetupOverrides = {}) => {
  const sessionMethodSelection: SessionMethodSelection =
    overrides.sessionMethodSelection ?? {
      method: "plan",
      serviceIds: ["service-1"],
      services: [{ id: "service-1", name: "Service 1" }],
    };

  return {
    services: [],
    repoBindings: [],
    selectedServiceId: "service-1",
    selectedServiceIds: ["service-1"],
    selectedProvider: overrides.selectedProvider ?? "claude",
    selectedBinding: null,
    directoryPath: "/tmp/repo",
    step: "selection" as const,
    sessionMethodSelection,
    isMultiServiceMode: false,
    canStart: true,
    loadingServices: false,
    servicesError: null,
    pickingDirectory: false,
    mappingDirectory: false,
    starting: false,
    error: null,
    selectService: vi.fn(),
    toggleService: vi.fn(),
    selectProvider: vi.fn(),
    selectedModel: overrides.selectedModel ?? "claude-opus-4-7",
    selectModel: vi.fn(),
    selectedReasoningEffort: overrides.selectedReasoningEffort ?? "medium",
    selectReasoningEffort: vi.fn(),
    selectedFastMode: overrides.selectedFastMode ?? false,
    selectFastMode: vi.fn(),
    goToSessionMethod: vi.fn(),
    goToSelection: vi.fn(),
    goToPrompt: vi.fn(),
    selectSessionMethod: vi.fn(),
    selectProjectMode: vi.fn(),
    projectModeSelection: overrides.projectModeSelection ?? null,
    validateProjectModeSelection: vi.fn(
      () => overrides.projectModeSelectionValid ?? true,
    ),
    promptDraft: "",
    setPromptDraft: vi.fn(),
    setDirectoryPath: vi.fn(),
    pickDirectory: vi.fn().mockResolvedValue(undefined),
    mapDirectory: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(overrides.startResult ?? { ok: true }),
    launchServiceId: "service-1",
    setLaunchServiceId: vi.fn(),
    directoryPaths: {},
    setDirectoryPathForService: vi.fn(),
    pickDirectoryForService: vi.fn().mockResolvedValue(undefined),
  };
};

const renderState = (
  onPromptSubmitted: (
    selection: SessionMethodSelection,
    launchOptions: SessionLaunchOptions,
    promptDraft: string,
  ) => void,
  options: {
    lockedWorktreeBranch?: string | null;
    compatibleSessionMethods?: readonly SessionMethod[];
    skipServiceSelection?: boolean;
  } = {},
) =>
  renderHook(() =>
    useAgenticSetupSectionState({
      organizationId: "org-1",
      projectId: "proj-1",
      agentSessionId: "session-1",
      userId: "user-1",
      boundServiceId: "service-1",
      taskServiceIds: ["service-1"],
      boundProvider: null,
      taskName: null,
      lockedWorktreeBranch: options.lockedWorktreeBranch,
      skipServiceSelection: options.skipServiceSelection ?? true,
      onPromptSubmitted,
      compatibleSessionMethods: options.compatibleSessionMethods ?? [
        "plan",
        "open",
        "quick",
        "debug",
        "research",
        "split_by_service",
        "split_by_function",
      ],
      projectModeCatalog: [],
    }),
  );

describe("useAgenticSetupSectionState lockedWorktreeBranch threading", () => {
  beforeEach(() => {
    useAgentSetupMock.mockReset();
    useAgentSetupMock.mockReturnValue(buildSetup());
  });

  it("forwards an explicit lockedWorktreeBranch into useAgentSetup", () => {
    renderState(vi.fn(), { lockedWorktreeBranch: "plan/shared-branch" });

    expect(useAgentSetupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: "plan/shared-branch",
      }),
    );
  });

  it("normalizes an omitted lockedWorktreeBranch to null", () => {
    renderState(vi.fn());

    expect(useAgentSetupMock).toHaveBeenCalledWith(
      expect.objectContaining({
        lockedWorktreeBranch: null,
      }),
    );
  });
});

describe("useAgenticSetupSectionState.handleSubmitPrompt launch payload", () => {
  beforeEach(() => {
    useAgentSetupMock.mockReset();
    submitMachinePingViaPlatformMock.mockReset();
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: true,
    });
  });

  it.each([
    {
      name: "zero machines",
      machines: [] as MachineDto[],
      executionReadyMachines: [] as MachineDto[],
      mode: "zero" as const,
      selectedMachine: null,
      expectedState: "no_paired_machines",
      expectedCanStart: false,
    },
    {
      name: "one ready machine",
      machines: [mockSelectedMachine],
      executionReadyMachines: [mockSelectedMachine],
      mode: "one" as const,
      selectedMachine: mockSelectedMachine,
      expectedState: "ready",
      expectedCanStart: true,
    },
    {
      name: "local machine among multiple ready machines",
      machines: [
        mockSelectedMachine,
        { ...mockSelectedMachine, machineId: "machine-2" },
      ],
      executionReadyMachines: [
        mockSelectedMachine,
        { ...mockSelectedMachine, machineId: "machine-2" },
      ],
      mode: "many" as const,
      selectedMachine: mockSelectedMachine,
      expectedState: "ready",
      expectedCanStart: true,
    },
    {
      name: "sole ineligible machine",
      machines: [mockIneligibleMachine],
      executionReadyMachines: [] as MachineDto[],
      mode: "zero" as const,
      selectedMachine: null,
      expectedState: "paired_none_ready",
      expectedCanStart: false,
    },
  ])(
    "derives launch readiness for $name",
    ({
      machines,
      executionReadyMachines,
      mode,
      selectedMachine,
      expectedState,
      expectedCanStart,
    }) => {
      mockMachineResolution.machines = machines;
      mockMachineResolution.executionReadyMachines = executionReadyMachines;
      mockMachineResolution.mode = mode;
      mockMachineResolution.selectedMachine = selectedMachine;
      useAgentSetupMock.mockReturnValue(buildSetup());

      const { result } = renderState(vi.fn());

      expect(result.current.canStart).toBe(expectedCanStart);
      expect(result.current.recoveryState.type).toBe(expectedState);
    },
  );

  it("forwards selectedProvider in launchOptions when Claude is selected", async () => {
    const setup = buildSetup({
      selectedProvider: "claude",
      selectedModel: "claude-opus-4-7",
      selectedReasoningEffort: "medium",
    });
    useAgentSetupMock.mockReturnValue(setup);

    const onStarted = vi.fn();
    const { result } = renderState(onStarted);

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(submitMachinePingViaPlatformMock).toHaveBeenCalledWith("machine-1");
    expect(setup.start).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledTimes(1);
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
    );
  });

  it("forwards a non-Claude selectedProvider in launchOptions", async () => {
    const setup = buildSetup({
      selectedProvider: "codex",
      selectedModel: "gpt-5-codex",
      selectedReasoningEffort: "high",
    });
    useAgentSetupMock.mockReturnValue(setup);

    const onStarted = vi.fn();
    const { result } = renderState(onStarted);

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(onStarted).toHaveBeenCalledTimes(1);
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
    );
  });

  it("forwards an explicit supported Fast mode boolean in launchOptions", async () => {
    const setup = buildSetup({
      selectedProvider: "codex",
      selectedModel: "gpt-5.6-sol",
      selectedReasoningEffort: "medium",
      selectedFastMode: false,
    });
    useAgentSetupMock.mockReturnValue(setup);
    const onStarted = vi.fn();
    const { result } = renderState(onStarted);

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ method: "plan" }),
      expect.objectContaining({
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningEffort: "medium",
        fastMode: false,
      }),
      "",
      [],
    );
  });

  it("does not call onStarted from Submit Prompt when start() returns ok=false", async () => {
    const setup = buildSetup({
      selectedProvider: "claude",
      startResult: { ok: false, error: "boom" },
    });
    useAgentSetupMock.mockReturnValue(setup);

    const onStarted = vi.fn();
    const { result } = renderState(onStarted);

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });
    expect(setup.start).toHaveBeenCalledTimes(1);
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("retains the draft when the setup handoff fails", async () => {
    seedSetupDraft();
    const setup = buildSetup({
      selectedProvider: "claude",
      startResult: { ok: false, error: "handoff failed" },
    });
    useAgentSetupMock.mockReturnValue(setup);

    const { result } = renderState(vi.fn());
    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(readAgentSetupDraft("user-1", setupContextKey)).not.toBeNull();
  });

  it("clears only the matching draft after a successful prompt handoff", async () => {
    seedSetupDraft();
    const setup = buildSetup({ selectedProvider: "claude" });
    useAgentSetupMock.mockReturnValue(setup);

    const { result } = renderState(vi.fn());
    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(readAgentSetupDraft("user-1", setupContextKey)).toBeNull();
  });

  it("returns canStart=false when no machine is active", () => {
    mockMachineResolution.machines = [];
    mockMachineResolution.executionReadyMachines = [];
    mockMachineResolution.mode = "zero";
    mockMachineResolution.selectedMachine = null;
    useAgentSetupMock.mockReturnValue(
      buildSetup({ selectedProvider: "claude" }),
    );

    const { result } = renderState(vi.fn());

    expect(result.current.canStart).toBe(false);
  });
});

describe("useAgenticSetupSectionState.handleSubmitPrompt ping gate", () => {
  beforeEach(() => {
    useAgentSetupMock.mockReset();
    submitMachinePingViaPlatformMock.mockReset();
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: true,
    });
    useAgentSetupMock.mockReturnValue(
      buildSetup({ selectedProvider: "claude" }),
    );
  });

  it("fires onStarted when ping returns acknowledged=true", async () => {
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: true,
    });

    const onStarted = vi.fn();
    const { result } = renderState(onStarted);

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(result.current.pingError).toBeNull();
    expect(onStarted).toHaveBeenCalledTimes(1);
  });

  it("aborts and sets pingError when ping returns acknowledged=false", async () => {
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: false,
    });

    const onStarted = vi.fn();
    const { result } = renderState(onStarted);

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(onStarted).not.toHaveBeenCalled();
    expect(result.current.pingError).toMatch(/not reachable/i);
  });

  it("aborts and sets pingError when ping returns ok=false (network failure)", async () => {
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: false,
      error: "Network error: connection refused",
    });

    const onStarted = vi.fn();
    const { result } = renderState(onStarted);

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(onStarted).not.toHaveBeenCalled();
    expect(result.current.pingError).toBe("Network error: connection refused");
  });

  it("does not materialize a session when no active machine is selected", async () => {
    const previousMachine = mockMachineResolution.selectedMachine;
    mockMachineResolution.selectedMachine = null;
    try {
      const setup = buildSetup({ selectedProvider: "claude" });
      useAgentSetupMock.mockReturnValue(setup);
      const onStarted = vi.fn();
      const { result } = renderState(onStarted);

      await act(async () => {
        await result.current.handleSubmitPrompt();
      });

      expect(setup.start).not.toHaveBeenCalled();
      expect(submitMachinePingViaPlatformMock).not.toHaveBeenCalled();
      expect(onStarted).not.toHaveBeenCalled();
      expect(result.current.pingError).toMatch(/active machine/i);
    } finally {
      mockMachineResolution.selectedMachine = previousMachine;
    }
  });

  it("rejects a stale incompatible method before any launch side effects", async () => {
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: true,
    });
    const setup = buildSetup({
      sessionMethodSelection: {
        method: "plan",
        serviceIds: ["service-1"],
        services: [{ id: "service-1", name: "Service 1" }],
      },
    });
    useAgentSetupMock.mockReturnValue(setup);
    const onStarted = vi.fn();
    const { result } = renderState(onStarted, {
      compatibleSessionMethods: ["quick"],
      skipServiceSelection: false,
    });

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(result.current.launchError).toMatch(/not available/i);
    expect(submitMachinePingViaPlatformMock).not.toHaveBeenCalled();
    expect(setup.mapDirectory).not.toHaveBeenCalled();
    expect(setup.start).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("rejects a stale project mode before machine ping or launch side effects", async () => {
    const projectModeSelection: ProjectModeSelection = {
      schemaVersion:
        ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
      modeId: "mode-stale",
    };
    const setup = buildSetup({
      sessionMethodSelection: {
        method: undefined,
        projectModeSelection,
        serviceIds: ["service-1"],
        services: [{ id: "service-1", name: "Service 1" }],
      },
      projectModeSelection,
      projectModeSelectionValid: false,
    });
    useAgentSetupMock.mockReturnValue(setup);
    const onStarted = vi.fn();
    const { result } = renderState(onStarted, {
      compatibleSessionMethods: [],
    });

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(result.current.launchError).toMatch(/no longer available/i);
    expect(submitMachinePingViaPlatformMock).not.toHaveBeenCalled();
    expect(setup.start).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("allows a valid project mode without requiring a built-in method", async () => {
    const projectModeSelection: ProjectModeSelection = {
      schemaVersion:
        ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
      modeId: "mode-valid",
    };
    const setup = buildSetup({
      sessionMethodSelection: {
        method: undefined,
        projectModeSelection,
        serviceIds: ["service-1"],
        services: [{ id: "service-1", name: "Service 1" }],
      },
      projectModeSelection,
    });
    useAgentSetupMock.mockReturnValue(setup);
    const onStarted = vi.fn();
    const { result } = renderState(onStarted, {
      compatibleSessionMethods: [],
    });

    await act(async () => {
      await result.current.handleSubmitPrompt();
    });

    expect(submitMachinePingViaPlatformMock).toHaveBeenCalledWith("machine-1");
    expect(setup.start).toHaveBeenCalledTimes(1);
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ projectModeSelection }),
      expect.anything(),
      "",
      [],
    );
  });
});

describe("initial prompt staging before session creation", () => {
  beforeEach(() => {
    useAgentSetupMock.mockReset();
    submitMachinePingViaPlatformMock.mockReset();
    submitMachinePingViaPlatformMock.mockResolvedValue({
      ok: true,
      acknowledged: true,
    });
  });
  it("blocks pending and failed files before ping or session creation, then hands off remaining references", async () => {
    const setup = buildSetup({
      sessionMethodSelection: {
        method: "quick",
        serviceIds: ["service-1"],
        services: [{ id: "service-1", name: "Service 1" }],
      },
    });
    setup.promptDraft = "  Keep the prompt unchanged.\n";
    useAgentSetupMock.mockReturnValue(setup);
    let finish: () => void = () => undefined;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const reference = {
      attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
      fileName: "good.txt",
    };
    globalThis.mswServer.use(
      http.post("*/api/local/run-attachments/staging", async ({ request }) => {
        const name = new URL(request.url).searchParams.get("fileName");
        if (name === "good.txt") await pending;
        return HttpResponse.json(
          name === "good.txt"
            ? {
                requestId: reference.attachmentId,
                operation: "run.attachments.stage",
                status: "success",
                result: { attachment: { ...reference, sizeBytes: 1 } },
              }
            : {
                requestId: reference.attachmentId,
                operation: "run.attachments.stage",
                status: "error",
                error: { code: "FILE_TOO_LARGE", message: "Too large" },
              },
        );
      }),
    );
    const onStarted = vi.fn();
    const { result } = renderState(onStarted);
    await waitFor(() => expect(result.current.attachments.canDrop).toBe(true));
    act(() =>
      result.current.attachments.drop([
        new File(["a"], "good.txt"),
        new File(["b"], "bad.txt"),
      ]),
    );
    await act(async () => {
      await result.current.handleSubmitPrompt();
    });
    expect(submitMachinePingViaPlatformMock).not.toHaveBeenCalled();
    expect(setup.start).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.attachments.entries[1].status).toBe("error"),
    );
    await act(async () => finish());
    await waitFor(() =>
      expect(result.current.attachments.entries[0].status).toBe("ready"),
    );
    await act(async () => {
      await result.current.handleSubmitPrompt();
    });
    expect(setup.start).not.toHaveBeenCalled();
    act(() =>
      result.current.attachments.remove(
        result.current.attachments.entries[1].key,
      ),
    );
    expect(setup.start).not.toHaveBeenCalled();
    seedSetupDraft();
    expect(
      JSON.stringify(readAgentSetupDraft("user-1", setupContextKey)),
    ).not.toContain(reference.attachmentId);
    await act(async () => {
      await result.current.handleSubmitPrompt();
    });
    expect(onStarted).toHaveBeenCalledWith(
      setup.sessionMethodSelection,
      expect.objectContaining({ machineId: "machine-1" }),
      setup.promptDraft,
      [reference],
    );
    expect(result.current.attachments.entries).toEqual([]);
  });
});

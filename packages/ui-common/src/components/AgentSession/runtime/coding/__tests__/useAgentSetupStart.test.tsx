import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  AuthorizationProtocolVersion,
  AgentSessionStatus,
  MachineExecutionReadinessState,
  ProjectModeSelectionSchemaVersionEnum,
  WorkflowName,
  type MachineDto,
  type ProjectModeSelection,
  type ServiceRepoBinding,
  type AgentSessionDto,
} from "../../../../../api";
import type { SessionMethod } from "../../../../../agents/prompts.js";
import type { ProjectModeCatalogEntry } from "../../../../../agents/coordination/projectModeCatalog";
import {
  buildAgentSetupDraftContextKey,
  readAgentSetupDraft,
  upsertAgentSetupDraft,
} from "../../../agentSetupDraftMemory";

const createAgentSessionConversationMock = vi.fn();
const updateAgentSessionRecordMock = vi.fn();
const useServicesMock = vi.fn();
const useMachineRepoBindingsMock = vi.fn();
const useLocalRepoBindingsMock = vi.fn();
let serviceQueryState: {
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  error: Error | null;
} = {
  isLoading: false,
  isFetching: false,
  isFetched: true,
  error: null,
};
let servicesForTest = [
  {
    id: "service-1",
    name: "Service 1",
    projectId: "proj-1",
    status: "ACTIVE",
  },
];

vi.mock("../../../../../data/hooks/useCreateAgentSessionConversation", () => ({
  useCreateAgentSessionConversation: () => ({
    mutate: createAgentSessionConversationMock,
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null,
  }),
  isConflictError: (error: unknown): boolean => {
    const status = (error as { response?: { status?: number } } | undefined)
      ?.response?.status;
    return status === 409;
  },
}));

vi.mock("../../../../../data/hooks/useMachineRepoBindings", () => ({
  useMachineRepoBindings: (...args: unknown[]) =>
    useMachineRepoBindingsMock(...args),
}));

vi.mock("../../../../../data/hooks/useLocalRepoBindings", () => ({
  useLocalRepoBindings: (...args: unknown[]) =>
    useLocalRepoBindingsMock(...args),
}));

vi.mock("../update-agent-session-record", () => ({
  updateAgentSessionRecord: (
    ...args: Parameters<typeof updateAgentSessionRecordMock>
  ) => updateAgentSessionRecordMock(...args),
}));

vi.mock("../../../../../data", () => ({
  useServices: (...args: unknown[]) => {
    useServicesMock(...args);
    return {
      services: servicesForTest,
      ...serviceQueryState,
    };
  },
}));

type SurfaceSelectionShape = {
  provider: "claude" | "codex" | "opencode";
  model: string;
  reasoningEffort: "low" | "medium" | "high" | "xhigh" | "max" | null;
};

const readSurfaceSelectionMock = vi.fn<[string], SurfaceSelectionShape | null>(
  () => null,
);
const writeSurfaceSelectionMock = vi.fn<
  [string, SurfaceSelectionShape],
  void
>();

vi.mock("../../../surfaceSelectionMemory", async (importOriginal) => ({
  buildDefaultSurfaceSelection: (
    await importOriginal<typeof import("../../../surfaceSelectionMemory")>()
  ).buildDefaultSurfaceSelection,
  CODING_SETUP_SURFACE_ID: "coding-setup",
  readSurfaceSelection: (surfaceId: string) =>
    readSurfaceSelectionMock(surfaceId),
  reconcileSurfaceSelection: (value: SurfaceSelectionShape) => value,
  writeSurfaceSelection: (surfaceId: string, value: SurfaceSelectionShape) =>
    writeSurfaceSelectionMock(surfaceId, value),
}));

import { resetCapabilityCatalogForTests } from "../../../capabilityCatalog";
import { useAgentSetup } from "../useAgentSetup";

const sessionWithConversation: AgentSessionDto = {
  id: "session-1",
  projectId: "proj-1",
  organizationId: "org-1",
  userId: "user-1",
  status: AgentSessionStatus.NotStarted,
  sessionDate: "2026-04-18T00:00:00Z",
  conversationId: "conv-existing",
  createdAt: "2026-04-18T00:00:00Z",
  updatedAt: "2026-04-18T00:00:01Z",
};

const sessionWithoutConversation: AgentSessionDto = {
  ...sessionWithConversation,
  conversationId: null,
};

const defaultSelectedMachine: MachineDto = {
  machineId: "machine-1",
  name: "My Machine",
  pairedAt: "2026-04-18T00:00:00Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  bindings: [],
};

const api = {
  listRepos: vi
    .fn()
    .mockResolvedValue([
      { serviceId: "service-1", repositoryPath: "/tmp/repo" },
    ]),
  setRepo: vi.fn(),
  pickDirectory: vi.fn(),
} as unknown as Parameters<typeof useAgentSetup>[0]["api"];

interface RenderSetupOptions {
  boundServiceId?: string | null;
  taskServiceIds?: string[];
  boundProvider?: "claude" | "codex" | "opencode" | null;
  taskName?: string | null;
  lockedWorktreeBranch?: string | null;
  skipServiceSelection?: boolean;
  selectedMachine?: MachineDto | null;
  projectModeCatalog?: readonly ProjectModeCatalogEntry[];
}

const renderSetup = (options: RenderSetupOptions = {}) =>
  renderHook(() =>
    useAgentSetup({
      api,
      runtimeReady: true,
      organizationId: "org-1",
      projectId: "proj-1",
      agentSessionId: "session-1",
      userId: "user-1",
      boundServiceId:
        options.boundServiceId === undefined
          ? "service-1"
          : options.boundServiceId,
      taskServiceIds: options.taskServiceIds ?? ["service-1"],
      boundProvider:
        options.boundProvider === undefined ? "claude" : options.boundProvider,
      taskName: options.taskName ?? null,
      lockedWorktreeBranch: options.lockedWorktreeBranch ?? null,
      skipServiceSelection: options.skipServiceSelection,
      selectedMachine:
        options.selectedMachine === undefined
          ? defaultSelectedMachine
          : options.selectedMachine,
      projectModeCatalog: options.projectModeCatalog ?? [],
    }),
  );

describe("useAgentSetup start() conversation creation", () => {
  beforeEach(() => {
    localStorage.clear();
    createAgentSessionConversationMock.mockReset();
    updateAgentSessionRecordMock.mockReset();
    useServicesMock.mockReset();
    serviceQueryState = {
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
    };
    servicesForTest = [
      {
        id: "service-1",
        name: "Service 1",
        projectId: "proj-1",
        status: "ACTIVE",
      },
    ];
    useMachineRepoBindingsMock.mockReset();
    useMachineRepoBindingsMock.mockReturnValue(null);
    useLocalRepoBindingsMock.mockReset();
    useLocalRepoBindingsMock.mockReturnValue({
      status: "empty",
      bindings: [],
      bindingsByServiceId: {},
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    readSurfaceSelectionMock.mockReset();
    readSurfaceSelectionMock.mockReturnValue(null);
    writeSurfaceSelectionMock.mockReset();
    createAgentSessionConversationMock.mockResolvedValue({
      agentSession: { ...sessionWithConversation, conversationId: "conv-new" },
      conversation: {
        id: "conv-new",
        organizationId: "org-1",
        projectId: "proj-1",
        workflowName: WorkflowName.AgentSession,
      },
    });
  });

  it("loads services scoped to the active project", () => {
    renderSetup();

    expect(useServicesMock).toHaveBeenCalledWith("org-1", {
      projectId: "proj-1",
      enabled: true,
    });
  });

  it("keeps services loading until the first fetch has settled", () => {
    serviceQueryState = {
      isLoading: false,
      isFetching: false,
      isFetched: false,
      error: null,
    };

    const { result } = renderSetup();

    expect(result.current.loadingServices).toBe(true);
  });

  it("surfaces a failed Service load instead of an empty catalog", () => {
    serviceQueryState = {
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: new Error("Network error"),
    };

    const { result } = renderSetup();

    expect(result.current.loadingServices).toBe(false);
    expect(result.current.servicesError).toBe("Network error");
  });

  it("reports no Service error when the load succeeded", () => {
    const { result } = renderSetup();

    expect(result.current.servicesError).toBeNull();
  });

  it("ignores service IDs outside the scoped catalog for selection and launch", () => {
    const { result } = renderSetup();

    act(() => {
      result.current.toggleService("service-from-another-project");
      result.current.selectService("service-from-another-project");
      result.current.setLaunchServiceId("service-from-another-project");
    });

    expect(result.current.selectedServiceIds).toEqual(["service-1"]);
    expect(result.current.launchServiceId).toBe("service-1");
  });

  it("selects the complete usable task Service set when no launch Service is bound", () => {
    servicesForTest = [
      {
        id: "service-1",
        name: "Service 1",
        projectId: "proj-1",
        status: "ACTIVE",
      },
      {
        id: "service-2",
        name: "Service 2",
        projectId: "proj-1",
        status: "ACTIVE",
      },
    ];

    const { result } = renderSetup({
      boundServiceId: null,
      taskServiceIds: ["service-1", "service-2"],
    });

    expect(result.current.selectedServiceIds).toEqual([
      "service-1",
      "service-2",
    ]);
    expect(result.current.launchServiceId).toBe("service-1");
  });

  it("waits for task Service relations that arrive after the Service catalog", () => {
    servicesForTest = [
      {
        id: "service-1",
        name: "Service 1",
        projectId: "proj-1",
        status: "ACTIVE",
      },
      {
        id: "service-2",
        name: "Service 2",
        projectId: "proj-1",
        status: "ACTIVE",
      },
    ];

    const { result, rerender } = renderHook(
      ({ taskServiceIds }: { taskServiceIds: string[] }) =>
        useAgentSetup({
          api,
          runtimeReady: true,
          organizationId: "org-1",
          projectId: "proj-1",
          agentSessionId: "session-1",
          userId: "user-1",
          boundServiceId: null,
          taskServiceIds,
          boundProvider: "claude",
          taskName: null,
          lockedWorktreeBranch: null,
          selectedMachine: null,
          projectModeCatalog: [],
        }),
      { initialProps: { taskServiceIds: [] } },
    );

    expect(result.current.selectedServiceIds).toEqual([]);

    rerender({ taskServiceIds: ["service-1", "service-2"] });

    expect(result.current.selectedServiceIds).toEqual([
      "service-1",
      "service-2",
    ]);
    expect(result.current.launchServiceId).toBe("service-1");
  });

  it("validates every selected Service against the live repository bindings", async () => {
    servicesForTest = [
      {
        id: "service-1",
        name: "Service 1",
        projectId: "proj-1",
        status: "ACTIVE",
      },
      {
        id: "service-2",
        name: "Service 2",
        projectId: "proj-1",
        status: "ACTIVE",
      },
    ];
    useMachineRepoBindingsMock.mockReturnValue([
      {
        serviceId: "service-1",
        repositoryPath: "/repos/api",
        createdAt: "2026-04-18T00:00:00Z",
        updatedAt: "2026-04-18T00:00:01Z",
      },
      {
        serviceId: "service-2",
        repositoryPath: "/repos/worker",
        createdAt: "2026-04-18T00:00:00Z",
        updatedAt: "2026-04-18T00:00:01Z",
      },
    ]);

    const { result } = renderSetup({
      boundServiceId: null,
      taskServiceIds: ["service-1", "service-2"],
    });
    let mapped: boolean | undefined;
    await act(async () => {
      mapped = await result.current.mapDirectory();
    });

    expect(mapped).toBe(true);
    expect(result.current.directoryPaths).toEqual({
      "service-1": "/repos/api",
      "service-2": "/repos/worker",
    });
    expect(api.setRepo).not.toHaveBeenCalled();
  });

  const cases: ReadonlyArray<{
    method: SessionMethod;
    expected: WorkflowName;
  }> = [
    { method: "plan", expected: WorkflowName.FeatureSync },
    { method: "open", expected: WorkflowName.AgentSession },
    { method: "split_by_function", expected: WorkflowName.AgentSession },
    { method: "split_by_service", expected: WorkflowName.AgentSession },
  ];

  for (const { method, expected } of cases) {
    it(`creates the conversation with the ${expected} workflowType when mode is ${method}`, async () => {
      updateAgentSessionRecordMock.mockResolvedValue({
        ok: true,
        session: sessionWithoutConversation,
      });

      const { result } = renderSetup();

      act(() => {
        result.current.selectSessionMethod(method);
      });

      let startResult: { ok: boolean } | undefined;
      await act(async () => {
        startResult = await result.current.start();
      });

      expect(startResult?.ok).toBe(true);
      expect(createAgentSessionConversationMock).toHaveBeenCalledTimes(1);
      expect(createAgentSessionConversationMock).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "session-1",
        body: {
          workflowType: expected,
          workflowAboutType: "agent-session",
          workflowAboutId: "session-1",
        },
      });
    });
  }

  it("PATCHes a V2 config carrying method, model, and effort", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });
    readSurfaceSelectionMock.mockReturnValue({
      provider: "claude",
      model: "claude-opus-4-7",
      reasoningEffort: "high",
      fastMode: false,
    });

    const { result } = renderSetup({ boundProvider: null });

    act(() => {
      result.current.selectSessionMethod("plan");
    });

    await act(async () => {
      await result.current.start();
    });

    expect(updateAgentSessionRecordMock).toHaveBeenCalledTimes(1);
    const firstCall = updateAgentSessionRecordMock.mock.calls[0] as
      [Record<string, unknown>] | undefined;
    const payload = firstCall?.[0];
    expect(payload?.machineId).toBe("machine-1");
    expect(payload?.config).toEqual({
      type: "CODING_SESSION",
      version: "v2",
      method: "plan",
      model: "claude-opus-4-7",
      effort: "high",
    });
    expect(payload?.config).not.toHaveProperty("worktree");
  });

  it("PATCHes only the generated project-mode selection identity", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });
    const projectModeSelection: ProjectModeSelection = {
      schemaVersion:
        ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
      modeId: "mode-review",
    };
    const projectModeCatalog: readonly ProjectModeCatalogEntry[] = [
      {
        selection: projectModeSelection,
        name: "Review mode",
        description: "Review changes.",
      },
    ];

    const { result } = renderSetup({ projectModeCatalog });

    act(() => {
      result.current.selectProjectMode(projectModeSelection);
    });

    await act(async () => {
      await result.current.start();
    });

    const firstCall = updateAgentSessionRecordMock.mock.calls[0] as
      [Record<string, unknown>] | undefined;
    const config = firstCall?.[0].config as Record<string, unknown>;
    expect(config).toEqual({
      type: "CODING_SESSION",
      version: "v2",
      projectModeSelection,
      model: "claude-opus-5-5",
      fastMode: false,
      effort: "medium",
    });
    expect(config).not.toHaveProperty("method");
    expect(config).not.toHaveProperty("projectModeSnapshot");
  });

  it("omits effort and worktree from the V2 config when no reasoning effort is selected", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });

    const { result } = renderSetup();

    act(() => {
      result.current.selectReasoningEffort(null);
      result.current.selectSessionMethod("open");
    });

    await act(async () => {
      await result.current.start();
    });

    const firstCall = updateAgentSessionRecordMock.mock.calls[0] as
      [Record<string, unknown>] | undefined;
    const payload = firstCall?.[0];
    expect(payload?.config).toEqual({
      type: "CODING_SESSION",
      version: "v2",
      method: "open",
      model: "claude-opus-5-5",
      fastMode: false,
    });
    const config = payload?.config as Record<string, unknown>;
    expect(config).not.toHaveProperty("effort");
    expect(config).not.toHaveProperty("worktree");
  });

  it("persists the selected worktree branch in the V2 config when worktree is enabled", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });

    const { result } = renderSetup({ taskName: "Fix the Launch Flow" });

    act(() => {
      result.current.setWorktreeBranch("");
      result.current.setWorktreeBranch("custom-branch");
    });

    await act(async () => {
      await result.current.start();
    });

    const firstCall = updateAgentSessionRecordMock.mock.calls[0] as
      [Record<string, unknown>] | undefined;
    const payload = firstCall?.[0];
    const config = payload?.config as Record<string, unknown>;
    expect(config.worktree).toBe("custom-branch");
  });

  it("persists the inherited Plan branch even when setup attempts to change it", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });

    const { result, rerender } = renderSetup({
      lockedWorktreeBranch: "plan/shared-branch",
      taskName: "Fix the Launch Flow",
    });

    act(() => {
      result.current.setWorktreeBranch("task/override");
    });
    rerender();

    expect(result.current.worktreeBranch).toBe("plan/shared-branch");

    await act(async () => {
      await result.current.start();
    });

    const firstCall = updateAgentSessionRecordMock.mock.calls[0] as
      [Record<string, unknown>] | undefined;
    const payload = firstCall?.[0];
    const config = payload?.config as Record<string, unknown>;
    expect(config.worktree).toBe("plan/shared-branch");
  });

  it("returns an error and skips the PATCH when worktree is enabled without a branch", async () => {
    const { result } = renderSetup({ taskName: null });

    act(() => {
      result.current.setWorktreeBranch("");
    });

    let startResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(false);
    expect(startResult?.error).toBe(
      "Worktree branch must be entered before starting.",
    );
    expect(result.current.error).toBe(
      "Worktree branch must be entered before starting.",
    );
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
  });

  it("returns an error and skips the PATCH while no model is selected because the CLI's catalog has not loaded", async () => {
    resetCapabilityCatalogForTests();
    const { result } = renderSetup();

    expect(result.current.selectedModel).toBeNull();
    expect(result.current.canStart).toBe(false);

    let startResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(false);
    expect(startResult?.error).toBe("Model must be selected before starting.");
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
  });

  it("does not create a conversation when the session already has one", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });

    const { result } = renderSetup();

    await act(async () => {
      await result.current.start();
    });

    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();
  });

  it("surfaces a non-409 conversation-creation error and leaves start() un-OK", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithoutConversation,
    });
    createAgentSessionConversationMock.mockRejectedValueOnce(
      Object.assign(new Error("boom"), { response: { status: 500 } }),
    );

    const { result } = renderSetup();

    let startResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(false);
    expect(startResult?.error).toBe("boom");
  });

  it("treats a 409 from conversation creation as success", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithoutConversation,
    });
    createAgentSessionConversationMock.mockRejectedValueOnce(
      Object.assign(new Error("conflict"), { response: { status: 409 } }),
    );

    const { result } = renderSetup();

    let startResult: { ok: boolean } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(true);
  });

  it("auto-selects the only usable project Service without launching", () => {
    const { result } = renderSetup({
      boundServiceId: null,
      taskServiceIds: [],
    });

    expect(result.current.selectedServiceIds).toEqual(["service-1"]);
    expect(result.current.launchServiceId).toBe("service-1");
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();
  });

  it("returns an error and skips creation when no service is selected", async () => {
    servicesForTest = [
      ...servicesForTest,
      {
        id: "service-2",
        name: "Service 2",
        projectId: "proj-1",
        status: "ACTIVE",
      },
    ];
    const { result } = renderSetup({
      boundServiceId: null,
      taskServiceIds: [],
    });

    let startResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(false);
    expect(startResult?.error).toBe(
      "Service must be selected before starting.",
    );
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();
  });

  it("falls back to the catalog default provider when neither bound nor stored selection is present", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithoutConversation,
    });
    readSurfaceSelectionMock.mockReturnValue(null);

    const { result } = renderSetup({
      boundProvider: null,
    });

    expect(result.current.selectedProvider).toBe("claude");
    expect(result.current.selectedModel).toBe("claude-opus-5-5");
    expect(result.current.selectedReasoningEffort).toBe("medium");

    let startResult: { ok: boolean } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(true);
  });

  it("round-trips the stored surface selection and writes updates back under 'coding-setup'", async () => {
    readSurfaceSelectionMock.mockReturnValue({
      provider: "codex",
      model: "gpt-5-codex",
      reasoningEffort: "high",
      fastMode: false,
    });

    const { result } = renderSetup({
      boundProvider: null,
    });

    expect(result.current.selectedProvider).toBe("codex");
    expect(result.current.selectedModel).toBe("gpt-5-codex");
    expect(result.current.selectedReasoningEffort).toBe("high");

    act(() => {
      result.current.selectProvider("claude");
    });
    expect(writeSurfaceSelectionMock).toHaveBeenLastCalledWith("coding-setup", {
      provider: "claude",
      model: "gpt-5-codex",
      reasoningEffort: "high",
      fastMode: false,
    });

    act(() => {
      result.current.selectModel("claude-opus-4-7");
    });
    expect(writeSurfaceSelectionMock).toHaveBeenLastCalledWith("coding-setup", {
      provider: "claude",
      model: "claude-opus-4-7",
      reasoningEffort: "high",
      fastMode: false,
    });

    act(() => {
      result.current.selectReasoningEffort("low");
    });
    expect(writeSurfaceSelectionMock).toHaveBeenLastCalledWith("coding-setup", {
      provider: "claude",
      model: "claude-opus-4-7",
      reasoningEffort: "low",
      fastMode: false,
    });
  });

  it("restores the matching incomplete setup draft before catalog defaults", () => {
    upsertAgentSetupDraft(
      "user-1",
      {
        setupContextKey: buildAgentSetupDraftContextKey(
          "org-1",
          "proj-1",
          "session-1",
        ),
        sessionMethod: "open",
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
        worktreeBranch: "feature/recover-setup",
        provider: "codex",
        model: "gpt-5.4",
        reasoningEffort: "high",
      },
      "2026-08-23T10:00:00.000Z",
    );

    const { result } = renderSetup({
      boundServiceId: null,
      boundProvider: null,
    });

    expect(result.current.sessionMethodSelection.method).toBe("open");
    expect(result.current.selectedServiceIds).toEqual(["service-1"]);
    expect(result.current.launchServiceId).toBe("service-1");
    expect(result.current.worktreeBranch).toBe("feature/recover-setup");
    expect(result.current.selectedProvider).toBe("codex");
    expect(result.current.selectedModel).toBe("gpt-5.4");
    expect(result.current.selectedReasoningEffort).toBe("high");
  });

  it("restores an eligible project-mode selection from the versioned draft", () => {
    const projectModeSelection: ProjectModeSelection = {
      schemaVersion:
        ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
      modeId: "mode-review",
    };
    upsertAgentSetupDraft("user-1", {
      setupContextKey: buildAgentSetupDraftContextKey(
        "org-1",
        "proj-1",
        "session-1",
      ),
      sessionMethod: null,
      projectModeSelection,
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
      worktreeBranch: null,
      provider: "claude",
      model: "claude-opus-4-8",
      reasoningEffort: "medium",
    });

    const { result } = renderSetup({
      projectModeCatalog: [
        {
          selection: projectModeSelection,
          name: "Review mode",
          description: "Review changes.",
        },
      ],
    });

    expect(result.current.sessionMethodSelection).toMatchObject({
      method: undefined,
      projectModeSelection,
    });
    expect(result.current.projectModeSelection).toEqual(projectModeSelection);
  });

  it("falls back to the built-in default for a stale project-mode draft", () => {
    const projectModeSelection: ProjectModeSelection = {
      schemaVersion:
        ProjectModeSelectionSchemaVersionEnum.ProjectModeSelectionV1,
      modeId: "mode-stale",
    };
    upsertAgentSetupDraft("user-1", {
      setupContextKey: buildAgentSetupDraftContextKey(
        "org-1",
        "proj-1",
        "session-1",
      ),
      sessionMethod: null,
      projectModeSelection,
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
      worktreeBranch: null,
      provider: "claude",
      model: "claude-opus-4-8",
      reasoningEffort: "medium",
    });

    const { result } = renderSetup();

    expect(result.current.sessionMethodSelection.method).toBe("plan");
    expect(result.current.projectModeSelection).toBeNull();
  });

  it("keeps explicitly bound Service and provider values ahead of a stale draft", () => {
    servicesForTest = [
      {
        id: "service-1",
        name: "Service 1",
        projectId: "proj-1",
        status: "ACTIVE",
      },
      {
        id: "service-2",
        name: "Service 2",
        projectId: "proj-1",
        status: "ACTIVE",
      },
    ];
    upsertAgentSetupDraft("user-1", {
      setupContextKey: buildAgentSetupDraftContextKey(
        "org-1",
        "proj-1",
        "session-1",
      ),
      sessionMethod: "plan",
      serviceIds: ["service-2", "stale-service"],
      launchServiceId: "service-2",
      worktreeBranch: null,
      provider: "codex",
      model: "gpt-5.4",
      reasoningEffort: "high",
    });

    const { result } = renderSetup({
      boundServiceId: "service-1",
      boundProvider: "claude",
      taskServiceIds: ["service-1", "service-2"],
    });

    expect(result.current.selectedServiceIds).toEqual(["service-1"]);
    expect(result.current.launchServiceId).toBe("service-1");
    expect(result.current.selectedProvider).toBe("claude");
  });

  it("persists supported edits without storing the prompt or starting a session", () => {
    const { result } = renderSetup({
      boundServiceId: null,
      boundProvider: null,
    });

    act(() => {
      result.current.selectSessionMethod("open");
      result.current.selectProvider("codex");
      result.current.selectModel("gpt-5.4");
      result.current.selectReasoningEffort("high");
      result.current.setWorktreeBranch("feature/draft");
      result.current.setPromptDraft("initial prompt must stay transient");
    });

    const draft = readAgentSetupDraft(
      "user-1",
      buildAgentSetupDraftContextKey("org-1", "proj-1", "session-1"),
    );
    expect(draft).toMatchObject({
      sessionMethod: "open",
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
      worktreeBranch: "feature/draft",
      provider: "codex",
      model: "gpt-5.4",
      reasoningEffort: "high",
    });
    expect(
      localStorage.getItem("hey-hey:agent-setup-drafts:v2:user-1"),
    ).not.toContain("initial prompt must stay transient");
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();
  });

  it("persists explicit Fast mode for a supported Codex selection", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });
    readSurfaceSelectionMock.mockReturnValue({
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      fastMode: false,
    });
    const { result } = renderSetup({ boundProvider: null });

    act(() => result.current.selectFastMode(true));
    await act(async () => {
      await result.current.start();
    });

    const firstCall = updateAgentSessionRecordMock.mock.calls[0] as
      [Record<string, unknown>] | undefined;
    expect(firstCall?.[0].config).toEqual(
      expect.objectContaining({
        model: "gpt-5.6-sol",
        effort: "medium",
        fastMode: true,
      }),
    );
  });

  it("surfaces the update failure and skips conversation creation", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: false,
      error: "Agent session update was rejected.",
    });

    const { result } = renderSetup();

    let startResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(false);
    expect(startResult?.error).toBe("Agent session update was rejected.");
    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();
  });

  it("creates the conversation when skipServiceSelection is true and no service is bound", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithoutConversation,
    });

    const { result } = renderSetup({
      boundServiceId: null,
      skipServiceSelection: true,
    });

    let startResult: { ok: boolean } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(true);
    expect(createAgentSessionConversationMock).toHaveBeenCalledTimes(1);
  });

  it("does not create a coding-session conversation when validation is selected", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithoutConversation,
    });

    const { result } = renderSetup();

    act(() => {
      result.current.selectSessionMethod("validation");
    });

    let startResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(false);
    expect(updateAgentSessionRecordMock).not.toHaveBeenCalled();
    expect(createAgentSessionConversationMock).not.toHaveBeenCalled();
  });

  it("falls back to a generic error message when the thrown error has no message", async () => {
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithoutConversation,
    });
    createAgentSessionConversationMock.mockRejectedValueOnce(new Error(""));

    const { result } = renderSetup();

    let startResult: { ok: boolean; error?: string } | undefined;
    await act(async () => {
      startResult = await result.current.start();
    });

    expect(startResult?.ok).toBe(false);
    expect(startResult?.error).toBe(
      "Failed to create agent session conversation.",
    );
  });
});

describe("useAgentSetup worktree state", () => {
  beforeEach(() => {
    createAgentSessionConversationMock.mockReset();
    updateAgentSessionRecordMock.mockReset();
    readSurfaceSelectionMock.mockReset();
    readSurfaceSelectionMock.mockReturnValue(null);
    writeSurfaceSelectionMock.mockReset();
    updateAgentSessionRecordMock.mockResolvedValue({
      ok: true,
      session: sessionWithConversation,
    });
  });

  it("defaults worktree off with a null branch when no task name is linked", () => {
    const { result } = renderSetup({ taskName: null });

    expect(result.current.worktreeLocked).toBe(false);
    expect(result.current.worktreeBranch).toBeNull();
  });

  it("seeds a slugified task name when worktree is enabled and keeps the branch editable", () => {
    const { result } = renderSetup({ taskName: "Fix the Launch Flow!" });

    act(() => {
      result.current.setWorktreeBranch("");
    });

    expect(result.current.worktreeBranch).toBe("fix-the-launch-flow");

    act(() => {
      result.current.setWorktreeBranch("custom-branch");
    });

    expect(result.current.worktreeBranch).toBe("custom-branch");
  });

  it("leaves the branch empty when worktree is enabled without a task name", () => {
    const { result } = renderSetup({ taskName: null });

    act(() => {
      result.current.setWorktreeBranch("");
    });

    expect(result.current.worktreeBranch).toBe("");
  });

  it("seeds and locks worktree state from a locked branch", () => {
    const { result } = renderSetup({
      lockedWorktreeBranch: "plan/shared-branch",
      taskName: "Fix the Launch Flow!",
    });

    expect(result.current.worktreeLocked).toBe(true);
    expect(result.current.worktreeBranch).toBe("plan/shared-branch");

    act(() => {
      result.current.setWorktreeBranch("custom-branch");
    });

    expect(result.current.worktreeBranch).toBe("plan/shared-branch");

    act(() => {
      result.current.setWorktreeBranch(null);
    });

    expect(result.current.worktreeBranch).toBe("plan/shared-branch");
  });

  it("re-pins worktree state when the locked branch changes", () => {
    const { result, rerender } = renderHook(
      ({ lockedWorktreeBranch }: { lockedWorktreeBranch: string | null }) =>
        useAgentSetup({
          api,
          runtimeReady: true,
          organizationId: "org-1",
          projectId: "proj-1",
          agentSessionId: "session-1",
          userId: "user-1",
          boundServiceId: "service-1",
          taskServiceIds: ["service-1"],
          boundProvider: "claude",
          taskName: "Fix the Launch Flow!",
          lockedWorktreeBranch,
          selectedMachine: null,
          projectModeCatalog: [],
        }),
      { initialProps: { lockedWorktreeBranch: "plan/first-branch" } },
    );

    expect(result.current.worktreeBranch).toBe("plan/first-branch");

    rerender({ lockedWorktreeBranch: "plan/second-branch" });

    expect(result.current.worktreeLocked).toBe(true);
    expect(result.current.worktreeBranch).toBe("plan/second-branch");

    rerender({ lockedWorktreeBranch: null });

    expect(result.current.worktreeLocked).toBe(false);
    expect(result.current.worktreeBranch).toBeNull();
  });
});

describe("useAgentSetup repository binding validation", () => {
  beforeEach(() => {
    (api.setRepo as Mock).mockReset();
    (api.pickDirectory as Mock).mockReset();
    useLocalRepoBindingsMock.mockReset();
    useLocalRepoBindingsMock.mockReturnValue({
      status: "empty",
      bindings: [],
      bindingsByServiceId: {},
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  it("hydrates an empty selected-service path when a live binding arrives", () => {
    let liveBindings: ServiceRepoBinding[] | null = null;
    useMachineRepoBindingsMock.mockImplementation(() => liveBindings);

    const selectedMachine: MachineDto = {
      machineId: "machine-1",
      name: "My Machine",
      pairedAt: "2026-04-18T00:00:00Z",
      active: true,
      bindings: [],
    };
    const { result, rerender } = renderSetup({ selectedMachine });

    expect(result.current.directoryPaths).toEqual({ "service-1": "" });
    expect(result.current.canStart).toBe(false);

    liveBindings = [
      {
        serviceId: "service-1",
        repositoryPath: "/home/user/project",
        createdAt: "2026-04-18T00:00:00Z",
        updatedAt: "2026-04-18T00:00:01Z",
      },
    ];

    act(() => {
      rerender();
    });

    expect(result.current.directoryPaths).toEqual({
      "service-1": "/home/user/project",
    });
    expect(result.current.canStart).toBe(true);
  });

  it("replaces a machine path with the current local CLI binding", () => {
    const machineBinding: ServiceRepoBinding = {
      serviceId: "service-1",
      repositoryPath: "/remote/machine-repo",
      createdAt: "2026-04-18T00:00:00Z",
      updatedAt: "2026-04-18T00:00:01Z",
    };
    const localBinding: ServiceRepoBinding = {
      ...machineBinding,
      repositoryPath: "/local/cli-repo",
      updatedAt: "2026-04-18T00:00:02Z",
    };

    useMachineRepoBindingsMock.mockReturnValue([machineBinding]);
    let localStatus: "empty" | "ready" = "empty";
    useLocalRepoBindingsMock.mockImplementation(() =>
      localStatus === "ready"
        ? {
            status: "ready",
            bindings: [localBinding],
            bindingsByServiceId: { "service-1": localBinding },
            refetch: vi.fn(),
            markStale: vi.fn(),
          }
        : {
            status: "empty",
            bindings: [],
            bindingsByServiceId: {},
            refetch: vi.fn(),
            markStale: vi.fn(),
          },
    );

    const { result, rerender } = renderSetup();

    expect(result.current.repoBindings).toEqual([machineBinding]);
    expect(result.current.directoryPaths).toEqual({
      "service-1": "/remote/machine-repo",
    });

    localStatus = "ready";
    act(() => {
      rerender();
    });

    expect(result.current.repoBindings).toEqual([localBinding]);
    expect(result.current.directoryPaths).toEqual({
      "service-1": "/local/cli-repo",
    });
  });

  it("rejects mapping when a selected service has no backend binding", async () => {
    useMachineRepoBindingsMock.mockReturnValue([]);

    const { result } = renderSetup();

    let mapped: boolean | undefined;
    await act(async () => {
      mapped = await result.current.mapDirectory();
    });

    expect(mapped).toBe(false);
    expect(result.current.error).toBe(
      "Enter a repository path for every selected service.",
    );
  });
});

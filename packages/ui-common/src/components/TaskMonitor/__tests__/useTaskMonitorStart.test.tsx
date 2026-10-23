import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CapabilityCatalogLoadState } from "../../AgentSession/capabilityCatalog";
import { useTaskMonitorStart } from "../useTaskMonitorStart";

const mutate = vi.fn();
vi.mock("../../../data/hooks", () => ({
  useSubmitTaskMonitorCommand: () => ({ mutate }),
}));
const catalogMocks = vi.hoisted(() => ({
  state: {
    status: "ready",
    catalog: [],
  } as CapabilityCatalogLoadState,
  models: [{ id: "gpt-5.5", label: "GPT 5.5", efforts: ["medium"] }],
  efforts: ["low", "medium", "high"],
}));
vi.mock("../../AgentSession/capabilityCatalog", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../AgentSession/capabilityCatalog")
  >()),
  listModels: () => catalogMocks.models,
  listEfforts: () => catalogMocks.efforts,
  supportsFastMode: (provider: string, model: string) =>
    provider === "codex" && model === "gpt-5.5",
}));
vi.mock("../../AgentSession/useRuntimeModelCatalog", () => ({
  useRuntimeModelCatalog: () => catalogMocks.state,
}));

const launchConfiguration = {
  method: "quick" as const,
  provider: "codex" as const,
  model: "gpt-5.5",
  reasoningEffort: "high" as const,
  fastMode: false,
};
const launchNode = {
  taskId: "task-1",
  dependsOnTaskIds: [],
  launchConfiguration,
};
const launchPolicy = {
  terminalSupervision: { mode: "AGENT_DECIDES" as const },
};

describe("useTaskMonitorStart", () => {
  const reconcileProjection = vi.fn();

  beforeEach(() => {
    catalogMocks.state = { status: "ready", catalog: [] };
    catalogMocks.models = [
      { id: "gpt-5.5", label: "GPT 5.5", efforts: ["medium"] },
    ];
    catalogMocks.efforts = ["low", "medium", "high"];
    mutate.mockReset();
    mutate.mockResolvedValue({ commandId: "command-1", status: "ADMITTED" });
    reconcileProjection.mockReset();
    reconcileProjection.mockResolvedValue(undefined);
  });

  it.each(["idle", "loading"] as const)(
    "does not report catalog %s as a Start error",
    async (status) => {
      catalogMocks.state = { status };
      const { result } = renderHook(() =>
        useTaskMonitorStart({
          organizationId: "org-1",
          projectId: "project-1",
          monitorId: "monitor-1",
          machineId: "machine-1",
          launchNode,
          launchPolicy,
          reconcileProjection,
        }),
      );

      expect(result.current.isCatalogLoading).toBe(true);
      expect(result.current.isCatalogFetched).toBe(false);

      await act(() => result.current.start());

      expect(mutate).not.toHaveBeenCalled();
      expect(result.current.errorMessage).toBeNull();
    },
  );

  it("submits one direct START with one request id and exposes its acknowledgement", async () => {
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "monitor-1",
      request: {
        requestId: expect.any(String),
        machineId: "machine-1",
        command: {
          cause: "START",
          launchConfig: {
            taskId: "task-1",
            method: "quick",
            provider: "codex",
            model: "gpt-5.5",
            reasoningEffort: "high",
            fastMode: false,
          },
        },
      },
    });
    expect(result.current.commandOutcome).toEqual({
      commandId: "command-1",
      status: "ADMITTED",
    });
    expect(result.current.acceptedAwaitingRefresh).toBe(true);
    expect(reconcileProjection).toHaveBeenCalledTimes(1);
  });

  it("does not submit START without an explicitly selected ready machine", async () => {
    // No machine means no catalog is requested, so Start reports the missing
    // machine rather than waiting on a catalog that will not load.
    catalogMocks.state = { status: "idle" };
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: null,
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    expect(result.current.isCatalogLoading).toBe(false);

    await act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toContain(
      "Select a connected, controller-authorized CLI machine",
    );
  });

  it("forwards the saved worktree configuration unchanged except for branch trimming", async () => {
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy: {
          ...launchPolicy,
          worktree: { enabled: true, branch: "  plan/shared-branch  " },
        },
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          command: expect.objectContaining({
            launchConfig: expect.objectContaining({
              worktree: { enabled: true, branch: "plan/shared-branch" },
            }),
          }),
        }),
      }),
    );
  });

  it("rejects a saved worktree without a branch before command submission", async () => {
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy: {
          ...launchPolicy,
          worktree: { enabled: true, branch: "   " },
        },
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe(
      "The saved Task Monitor worktree branch must be entered before Start.",
    );
  });

  it("returns rejected Start to retryable presentation state", async () => {
    mutate
      .mockResolvedValueOnce({
        commandId: "command-1",
        status: "REJECTED",
        message: "The monitor cannot start yet.",
      })
      .mockResolvedValueOnce({ commandId: "command-2", status: "ADMITTED" });
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(result.current.acceptedAwaitingRefresh).toBe(false);
    expect(result.current.commandOutcome?.status).toBe("REJECTED");
    expect(reconcileProjection).not.toHaveBeenCalled();

    await act(() => result.current.start());

    expect(mutate).toHaveBeenCalledTimes(2);
    expect(reconcileProjection).toHaveBeenCalledTimes(1);
    expect(result.current.commandOutcome).toEqual({
      commandId: "command-2",
      status: "ADMITTED",
    });
    expect(result.current.acceptedAwaitingRefresh).toBe(true);
  });

  it("sends the optional setup message with START", async () => {
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
        userMessage: "  Focus on the contract.  ",
      }),
    );

    await act(() => result.current.start());

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          command: expect.objectContaining({
            cause: "START",
            userMessage: "Focus on the contract.",
          }),
        }),
      }),
    );
  });

  it("fails before command submission when persisted runtime state is missing", async () => {
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode: null,
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toBe(
      "The Task Monitor has no saved launch configuration.",
    );
  });

  it("rejects a stale persisted model before command submission", async () => {
    catalogMocks.models = [];
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toContain(
      "not available in the runtime catalog",
    );
  });

  it("rejects a stale persisted effort before command submission", async () => {
    catalogMocks.efforts = ["low", "medium"];
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toContain(
      "reasoning effort is not available",
    );
  });

  it.each([true, false])(
    "preserves an explicit supported Fast mode value of %s",
    async (fastMode) => {
      const { result } = renderHook(() =>
        useTaskMonitorStart({
          organizationId: "org-1",
          projectId: "project-1",
          monitorId: "monitor-1",
          machineId: "machine-1",
          launchNode: {
            ...launchNode,
            launchConfiguration: { ...launchConfiguration, fastMode },
          },
          launchPolicy,
          reconcileProjection,
        }),
      );

      await act(() => result.current.start());

      expect(mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          request: expect.objectContaining({
            command: expect.objectContaining({
              launchConfig: expect.objectContaining({ fastMode }),
            }),
          }),
        }),
      );
    },
  );

  it("rejects missing supported Fast mode intent before command submission", async () => {
    const { fastMode: _fastMode, ...withoutFastMode } = launchConfiguration;
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode: { ...launchNode, launchConfiguration: withoutFastMode },
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    expect(mutate).not.toHaveBeenCalled();
    expect(result.current.errorMessage).toContain(
      "Fast mode choice is missing",
    );
  });

  it("omits Fast mode for an unsupported persisted selection", async () => {
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode: {
          ...launchNode,
          launchConfiguration: {
            method: "quick",
            provider: "claude",
            model: "gpt-5.5",
            reasoningEffort: "high",
          },
        },
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(() => result.current.start());

    const submitted = mutate.mock.calls[0]?.[0].request.command.launchConfig;
    expect(submitted).not.toHaveProperty("fastMode");
  });

  it("keeps Start pending until canonical reconciliation completes", async () => {
    let finishReconciliation: (() => void) | undefined;
    reconcileProjection.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishReconciliation = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    let startPromise: Promise<boolean>;
    await act(async () => {
      startPromise = result.current.start();
      await Promise.resolve();
    });

    expect(result.current.isSubmitting).toBe(true);
    expect(result.current.acceptedAwaitingRefresh).toBe(true);

    finishReconciliation?.();
    await act(async () => {
      expect(await startPromise).toBe(true);
    });
    expect(result.current.isSubmitting).toBe(false);
  });

  it("runs one accepted START before settling through canonical reconciliation", async () => {
    const events: string[] = [];
    mutate.mockImplementation(async () => {
      events.push("start-command");
      return { commandId: "command-1", status: "ADMITTED" };
    });
    reconcileProjection.mockImplementation(async () => {
      events.push("canonical-reconciliation");
    });

    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(async () => {
      expect(await result.current.start()).toBe(true);
    });

    expect(events).toEqual(["start-command", "canonical-reconciliation"]);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(reconcileProjection).toHaveBeenCalledTimes(1);
  });

  it("surfaces an accepted-command reconciliation failure without stale success", async () => {
    reconcileProjection.mockRejectedValue(
      new Error("The Agent Sessions query failed."),
    );
    const { result } = renderHook(() =>
      useTaskMonitorStart({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        machineId: "machine-1",
        launchNode,
        launchPolicy,
        reconcileProjection,
      }),
    );

    await act(async () => {
      expect(await result.current.start()).toBe(false);
    });

    expect(result.current.commandOutcome).toBeNull();
    expect(result.current.acceptedAwaitingRefresh).toBe(false);
    expect(result.current.errorMessage).toContain("START command was accepted");
    expect(result.current.errorMessage).toContain(
      "The Agent Sessions query failed.",
    );
  });
});

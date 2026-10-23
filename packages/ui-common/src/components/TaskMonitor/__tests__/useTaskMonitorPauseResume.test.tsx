import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTaskMonitorPauseResume } from "../useTaskMonitorPauseResume";

const mutate = vi.fn();

vi.mock("../../../data/hooks", () => ({
  useSubmitTaskMonitorCommand: () => ({ mutate }),
}));

const renderPauseResume = (
  reconcileProjection: () => Promise<void> = vi
    .fn()
    .mockResolvedValue(undefined)
) =>
  renderHook(() =>
    useTaskMonitorPauseResume({
      organizationId: "org-1",
      projectId: "project-1",
      monitorId: "monitor-1",
      machineId: "machine-1",
      reconcileProjection,
    })
  );

describe("useTaskMonitorPauseResume", () => {
  beforeEach(() => {
    mutate.mockReset();
    mutate.mockResolvedValue({ commandId: "command-1", status: "ADMITTED" });
  });

  it.each([
    ["pause", "PAUSE"],
    ["resume", "RESUME"],
  ] as const)(
    "submits the generated %s command variant",
    async (method, cause) => {
      const reconcileProjection = vi.fn().mockResolvedValue(undefined);
      const { result } = renderPauseResume(reconcileProjection);

      await act(() => result.current[method]());

      expect(mutate).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "project-1",
        monitorId: "monitor-1",
        request: {
          requestId: expect.any(String),
          machineId: "machine-1",
          command: { cause },
        },
      });
      expect(reconcileProjection).toHaveBeenCalledTimes(1);
    }
  );

  it("shares one pending guard across Pause and Resume", async () => {
    let resolveCommand:
      | ((value: { commandId: string; status: "QUEUED" }) => void)
      | null = null;
    mutate.mockImplementation(
      () =>
        new Promise<{ commandId: string; status: "QUEUED" }>((resolve) => {
          resolveCommand = resolve;
        })
    );
    const reconcileProjection = vi.fn().mockResolvedValue(undefined);
    const { result } = renderPauseResume(reconcileProjection);

    let pausePromise: Promise<boolean> | undefined;
    let resumePromise: Promise<boolean> | undefined;
    act(() => {
      pausePromise = result.current.pause();
      resumePromise = result.current.resume();
    });

    expect(result.current.pendingAction).toBe("PAUSE");
    expect(mutate).toHaveBeenCalledTimes(1);
    await expect(resumePromise).resolves.toBe(false);

    await act(async () => {
      resolveCommand?.({ commandId: "command-1", status: "QUEUED" });
      await pausePromise;
    });

    expect(result.current.pendingAction).toBeNull();
    expect(reconcileProjection).toHaveBeenCalledTimes(1);
  });

  it.each([
    { commandId: "command-1", status: "ADMITTED" as const },
    { commandId: "command-2", status: "QUEUED" as const },
    {
      commandId: "command-3",
      status: "ADMITTED" as const,
      replayed: true,
    },
  ])(
    "reconciles exactly once after $status acknowledgement",
    async (outcome) => {
      mutate.mockResolvedValue(outcome);
      const events: string[] = [];
      mutate.mockImplementation(async () => {
        events.push("command");
        return outcome;
      });
      const reconcileProjection = vi.fn().mockImplementation(async () => {
        events.push("reconciliation");
      });
      const { result } = renderPauseResume(reconcileProjection);

      await act(() => result.current.pause());

      expect(events).toEqual(["command", "reconciliation"]);
      expect(reconcileProjection).toHaveBeenCalledTimes(1);
      expect(result.current.commandOutcome).toEqual(outcome);
    }
  );

  it("preserves a typed rejected outcome without reconciling", async () => {
    const outcome = {
      commandId: "command-1",
      status: "REJECTED" as const,
      stage: "VERIFICATION" as const,
      reason: "ROUTING_MISMATCH" as const,
      message: "The command route did not match.",
    };
    mutate.mockResolvedValue(outcome);
    const reconcileProjection = vi.fn().mockResolvedValue(undefined);
    const { result } = renderPauseResume(reconcileProjection);

    await act(() => result.current.resume());

    expect(result.current.commandOutcome).toEqual(outcome);
    expect(result.current.errorMessage).toBeNull();
    expect(reconcileProjection).not.toHaveBeenCalled();
  });

  it("keeps the action pending until canonical reconciliation settles", async () => {
    let resolveReconciliation: (() => void) | null = null;
    const reconcileProjection = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveReconciliation = resolve;
        })
    );
    const { result } = renderPauseResume(reconcileProjection);

    let submission: Promise<boolean> | undefined;
    act(() => {
      submission = result.current.resume();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.pendingAction).toBe("RESUME");

    await act(async () => {
      resolveReconciliation?.();
      await submission;
    });
    expect(result.current.pendingAction).toBeNull();
  });
});

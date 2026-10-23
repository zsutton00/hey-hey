import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentSessionStatus } from "../../../api";
import { useAgentRunLifecycle } from "../useAgentRunLifecycle";
import type { PlatformStopRunPoster } from "../runtime/hooks/submitStopRunViaPlatform";

const buildPlatformPoster = (
  overrides: Partial<PlatformStopRunPoster> = {}
): PlatformStopRunPoster => ({
  stopAgentSessionRun: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const baseInput = (apiClient: PlatformStopRunPoster) => ({
  apiClient,
  enabled: true,
  organizationId: "org-1",
  projectId: "proj-1",
  agentSessionId: "agent-session-1",
  agentSessionStatus: AgentSessionStatus.InProgress,
  agentSessionConversationId: "conv-1",
  context: { projectId: "proj-1" } as never,
  contextMetadata: {} as never,
  launch: { startRun: vi.fn() },
});

describe("useAgentRunLifecycle.stopRun", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is a no-op when there is no active run", async () => {
    const apiClient = buildPlatformPoster();
    // No bound conversation -> derived runId is null -> stopRun no-ops.
    const { result } = renderHook(() =>
      useAgentRunLifecycle({
        ...baseInput(apiClient),
        agentSessionConversationId: null,
      })
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.stopRun();
    });

    expect(outcome).toEqual({ ok: true });
    expect(apiClient.stopAgentSessionRun).not.toHaveBeenCalled();
    expect(result.current.stoppingRun).toBe(false);
  });

  it("calls stopAgentSessionRun with platform context and toggles stoppingRun across the request", async () => {
    let resolveStop: ((value: unknown) => void) | undefined;
    const stopAgentSessionRunMock = vi.fn(
      () =>
        new Promise<unknown>((res) => {
          resolveStop = res;
        })
    );
    const apiClient = buildPlatformPoster({
      stopAgentSessionRun: stopAgentSessionRunMock as never,
    });

    // Conversation is bound -> derived runId === agentSessionId.
    const { result } = renderHook(() =>
      useAgentRunLifecycle(baseInput(apiClient))
    );

    expect(result.current.runId).toBe("agent-session-1");

    let stop: Promise<unknown> | undefined;
    act(() => {
      stop = result.current.stopRun();
    });

    expect(stopAgentSessionRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "agent-session-1",
      })
    );
    await waitFor(() => {
      expect(result.current.stoppingRun).toBe(true);
    });

    await act(async () => {
      resolveStop!(undefined);
    });
    await expect(stop).resolves.toEqual({ ok: true });

    await waitFor(() => {
      expect(result.current.stoppingRun).toBe(false);
    });
  });

  it("resets stoppingRun when the platform stop call rejects", async () => {
    const stopAgentSessionRunMock = vi
      .fn()
      .mockRejectedValue(new Error("network down"));
    const apiClient = buildPlatformPoster({
      stopAgentSessionRun: stopAgentSessionRunMock as never,
    });

    const { result } = renderHook(() =>
      useAgentRunLifecycle(baseInput(apiClient))
    );

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.stopRun();
    });

    // Admission failure is returned to the caller, never claimed as stopped.
    expect(outcome).toEqual({ ok: false, error: "network down" });
    await waitFor(() => {
      expect(result.current.stoppingRun).toBe(false);
    });
    expect(stopAgentSessionRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "agent-session-1",
      })
    );
  });
});

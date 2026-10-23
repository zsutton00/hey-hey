import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CliReadToolCallsLatestTurnResult } from "../../../../../api";
import {
  ControllerAuthorizationClientError,
  ControllerAuthorizationClientFailureCode,
} from "../../../../../data/controllerAuthorization/webauthnAssertion";
import { unifiedApiClient } from "../../../../../clients/serviceClients";
import {
  LATEST_TURN_TOOL_CALLS_DEBOUNCE_MS,
  LATEST_TURN_TOOL_CALLS_POLL_INTERVAL_MS,
  useLatestTurnToolCalls,
} from "../useLatestTurnToolCalls";

const { authorize } = vi.hoisted(() => ({ authorize: vi.fn() }));

vi.mock("../../../../../clients/serviceClients", () => ({
  unifiedApiClient: { readAgentSessionCliState: vi.fn() },
}));
vi.mock("../../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: "machine-1" } }),
}));
const machines = [{ machineId: "machine-1" }];
vi.mock("../../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines }),
}));
vi.mock("../../../../../data/hooks/useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: authorize }),
}));

const read = vi.mocked(unifiedApiClient.readAgentSessionCliState);
const sessionId = "33333333-3333-4333-8333-333333333333";
const baseParams = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  agentSessionId: sessionId,
  activityKey: "thought one",
  enabled: true,
};

const respond = (result: CliReadToolCallsLatestTurnResult) =>
  read.mockResolvedValue({
    data: {
      success: true,
      message: "ok",
      timestamp: new Date().toISOString(),
      statusCode: 200,
      data: {
        requestId: "44444444-4444-4444-8444-444444444444",
        operation: "run.tool_calls.latest_turn",
        status: "success",
        result,
      },
    },
  } as Awaited<ReturnType<typeof read>>);

const available: CliReadToolCallsLatestTurnResult = {
  state: "available",
  runId: sessionId,
  turnId: "turn-1",
  omittedEarlierCount: 0,
  evictedCount: 0,
  toolCalls: [],
};

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
const flush = () => advance(0);
const tick = () => advance(LATEST_TURN_TOOL_CALLS_POLL_INTERVAL_MS);

const wrapped = (result: CliReadToolCallsLatestTurnResult) =>
  ({
    data: {
      success: true,
      message: "ok",
      timestamp: new Date().toISOString(),
      statusCode: 200,
      data: {
        requestId: "44444444-4444-4444-8444-444444444444",
        operation: "run.tool_calls.latest_turn",
        status: "success",
        result,
      },
    },
  }) as Awaited<ReturnType<typeof read>>;

describe("useLatestTurnToolCalls", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    authorize.mockImplementation(async ({ submit }) => ({
      outcome: "ADMITTED",
      data: await submit({
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      }),
    }));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads immediately when the Turn is active, without any narration", async () => {
    respond(available);
    const { result } = renderHook(() =>
      useLatestTurnToolCalls({ ...baseParams, activityKey: "" }),
    );
    expect(result.current.status).toBe("idle");
    await flush();
    expect(result.current).toEqual({ status: "available", result: available });
    expect(read).toHaveBeenCalledWith(
      expect.objectContaining({
        cliReadRequestDto: expect.objectContaining({
          operation: "run.tool_calls.latest_turn",
          runId: sessionId,
        }),
      }),
    );
  });

  it("repeats the read on the poll interval", async () => {
    respond(available);
    renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
    await tick();
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("replaces the previous snapshot with each response", async () => {
    read.mockResolvedValueOnce(wrapped(available));
    const { result } = renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    const next = { ...available, turnId: "turn-2", evictedCount: 3 };
    read.mockResolvedValue(wrapped(next));
    await tick();
    expect(result.current).toEqual({ status: "available", result: next });
  });

  it("skips a tick while a read is still in flight", async () => {
    let finish: (value: Awaited<ReturnType<typeof read>>) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    await tick();
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
    respond(available);
    await act(async () => {
      finish(wrapped(available));
    });
    await tick();
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("maps the disabled result to a silent state and stops reading", async () => {
    respond({ state: "disabled", runId: sessionId });
    const { result, rerender } = renderHook(
      (props) => useLatestTurnToolCalls(props),
      { initialProps: baseParams },
    );
    await flush();
    expect(result.current).toEqual({ status: "disabled" });
    rerender({ ...baseParams, activityKey: "thought two" });
    await advance(LATEST_TURN_TOOL_CALLS_DEBOUNCE_MS);
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stops without retrying after a declined authorization", async () => {
    authorize.mockRejectedValue(
      new ControllerAuthorizationClientError(
        ControllerAuthorizationClientFailureCode.UserCancelled,
        "cancelled",
      ),
    );
    const { result } = renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    expect(result.current.status).toBe("unavailable");
    await tick();
    await tick();
    expect(authorize).toHaveBeenCalledTimes(1);
  });

  it("still refreshes on narration changes, debounced into one read", async () => {
    respond(available);
    const { rerender } = renderHook((props) => useLatestTurnToolCalls(props), {
      initialProps: baseParams,
    });
    await flush();
    rerender({ ...baseParams, activityKey: "a" });
    rerender({ ...baseParams, activityKey: "b" });
    await advance(LATEST_TURN_TOOL_CALLS_DEBOUNCE_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("stops reading when the Turn ends", async () => {
    respond(available);
    const { rerender } = renderHook((props) => useLatestTurnToolCalls(props), {
      initialProps: baseParams,
    });
    await flush();
    rerender({ ...baseParams, enabled: false });
    await tick();
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("stops reading on unmount", async () => {
    respond(available);
    const { unmount } = renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    unmount();
    await tick();
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("never writes tool calls to browser storage", async () => {
    respond(available);
    const local = vi.spyOn(Storage.prototype, "setItem");
    renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    expect(local).not.toHaveBeenCalled();
    local.mockRestore();
  });
});

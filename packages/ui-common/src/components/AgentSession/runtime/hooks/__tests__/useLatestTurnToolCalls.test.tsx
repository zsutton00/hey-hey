import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CliReadToolCall,
  CliReadToolCallsLatestTurnResult,
} from "../../../../../api";
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

const { authorize, localRead, localState } = vi.hoisted(() => ({
  authorize: vi.fn(),
  localRead: vi.fn(),
  localState: {
    current: {
      status: "unavailable",
      reason: "cli-unreachable",
    } as import("../useLocalCliForSession").LocalCliForSessionState,
  },
}));
vi.mock("../useLocalCliForSession", () => ({
  useLocalCliForSession: () => localState.current,
}));
vi.mock("../../../../../local-agent-api/generated/api", () => ({
  RunToolCallsLatestTurnApi: class {
    readLocalRunToolCallsLatestTurn = localRead;
  },
}));

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
  replyPending: false,
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

const call = (createdAt: string): CliReadToolCall => ({
  entryId: "call-1",
  toolUseId: "tool-1",
  toolName: "read_file",
  summary: "Read a file",
  status: "completed",
  exitCode: null,
  lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: null },
  createdAt,
  updatedAt: createdAt,
  detail: { input: null, output: null, result: null },
});

const available: CliReadToolCallsLatestTurnResult = {
  state: "available",
  runId: sessionId,
  turnId: "turn-1",
  omittedEarlierCount: 0,
  evictedCount: 0,
  toolCalls: [call("2020-01-01T00:00:00.000Z")],
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
    localState.current = { status: "unavailable", reason: "cli-unreachable" };
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

  it("uses one local poller without platform reads or controller prompts", async () => {
    localState.current = { status: "local", machineId: "machine-1" };
    localRead.mockResolvedValue({
      data: {
        operation: "run.tool_calls.latest_turn",
        status: "success",
        result: available,
      },
    });
    const { result } = renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    expect(result.current).toEqual({ status: "available", result: available });
    await tick();
    expect(localRead).toHaveBeenCalledTimes(2);
    expect(localRead).toHaveBeenCalledWith({
      runId: sessionId,
      localRunToolCallsLatestTurnRequest: { machineId: "machine-1" },
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("never falls back after local rejection and clears previous content", async () => {
    localState.current = { status: "local", machineId: "machine-1" };
    localRead
      .mockResolvedValueOnce({
        data: {
          operation: "run.tool_calls.latest_turn",
          status: "success",
          result: available,
        },
      })
      .mockRejectedValue(new Error("blocked"));
    const { result } = renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    await tick();
    expect(result.current.status).toBe("unavailable");
    await tick();
    expect(localRead).toHaveBeenCalledTimes(2);
    expect(authorize).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects a reached CLI with the wrong identity without remote fallback", async () => {
    localState.current = { status: "unavailable", reason: "different-machine" };
    const { result } = renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    expect(result.current.status).toBe("unavailable");
    expect(localRead).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
  });

  it("halts local reads when viewing is disabled", async () => {
    localState.current = { status: "local", machineId: "machine-1" };
    localRead.mockResolvedValue({
      data: {
        operation: "run.tool_calls.latest_turn",
        status: "success",
        result: { state: "disabled", runId: sessionId },
      },
    });
    const { result } = renderHook(() => useLatestTurnToolCalls(baseParams));
    await flush();
    await tick();
    expect(result.current.status).toBe("disabled");
    expect(localRead).toHaveBeenCalledTimes(1);
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

  it("keeps the previous Turn out after send, then accepts the new Turn before narration", async () => {
    respond(available);
    const { result, rerender } = renderHook(
      (props) => useLatestTurnToolCalls(props),
      { initialProps: baseParams },
    );
    await flush();
    rerender({ ...baseParams, enabled: false });
    rerender({ ...baseParams, replyPending: true });
    expect(result.current.status).toBe("idle");
    await tick();
    rerender(baseParams);
    await tick();
    expect(result.current.status).toBe("idle");
    const next = {
      ...available,
      turnId: "turn-2",
      toolCalls: [call(new Date().toISOString())],
    };
    respond(next);
    await tick();
    expect(result.current).toEqual({ status: "available", result: next });
  });

  it("ignores a delayed read from before the follow-up and keeps polling", async () => {
    let finish: (value: Awaited<ReturnType<typeof read>>) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(
      (props) => useLatestTurnToolCalls(props),
      { initialProps: baseParams },
    );
    await flush();
    rerender({ ...baseParams, replyPending: true });
    rerender(baseParams);
    await act(async () => {
      finish(wrapped(available));
    });
    expect(result.current.status).toBe("idle");
    respond({ ...available, turnId: "turn-2" });
    await tick();
    expect(result.current.status).toBe("available");
  });

  it("filters old calls when send precedes the first successful read", async () => {
    respond(available);
    const { result, rerender } = renderHook(
      (props) => useLatestTurnToolCalls(props),
      {
        initialProps: { ...baseParams, enabled: false },
      },
    );
    rerender({ ...baseParams, replyPending: true });
    await flush();
    expect(result.current).toMatchObject({
      status: "available",
      result: { toolCalls: [] },
    });
    const fresh = call(new Date().toISOString());
    respond({ ...available, turnId: "turn-2", toolCalls: [fresh] });
    await tick();
    expect(result.current).toMatchObject({
      status: "available",
      result: { toolCalls: [fresh] },
    });
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

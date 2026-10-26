import { AxiosError } from "axios";
import { useLocalCliForSession } from "../useLocalCliForSession";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useLatestTurnToolCalls } from "../useLatestTurnToolCalls";

const { listRepos, localRead, authorize } = vi.hoisted(() => ({
  listRepos: vi.fn(),
  localRead: vi.fn(),
  authorize: vi.fn(),
}));
vi.mock("../../directoryBindingApi", () => ({
  createDirectoryBindingApi: () => ({ listRepos }),
  resolveLocalDirectoryRuntimeBaseUrl: () => "http://localhost:3847",
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
const machines = [{ machineId: "machine-1", active: true }];
vi.mock("../../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines }),
}));
vi.mock("../../../../../data/hooks/useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: authorize }),
}));
const params = {
  organizationId: "org",
  projectId: "project",
  agentSessionId: "run",
  activityKey: "",
  enabled: true,
  replyPending: false,
};
const result = {
  state: "available",
  runId: "run",
  turnId: "turn",
  toolCalls: [],
  omittedEarlierCount: 0,
  evictedCount: 0,
};
const response = {
  data: { operation: "run.tool_calls.latest_turn", status: "success", result },
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  listRepos.mockResolvedValue({ machineId: "machine-1", bindings: [] });
  localRead.mockResolvedValue(response);
});
afterEach(() => vi.useRealTimers());
const advance = async (ms = 0) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};
it("waits for actual identity discovery, then polls locally without repeated discovery or authorization", async () => {
  let resolveIdentity!: (value: { machineId: string }) => void;
  listRepos.mockReturnValue(
    new Promise((resolve) => {
      resolveIdentity = resolve;
    }),
  );
  const { result: state } = renderHook(() => useLatestTurnToolCalls(params));
  await advance();
  expect(localRead).not.toHaveBeenCalled();
  await act(async () => resolveIdentity({ machineId: "machine-1" }));
  await advance();
  expect(state.current).toEqual({ status: "available", result });
  await advance(4000);
  expect(listRepos).toHaveBeenCalledTimes(1);
  expect(localRead).toHaveBeenCalledTimes(3);
  expect(authorize).not.toHaveBeenCalled();
});
it("keeps only one local request in flight across polling and narration refresh", async () => {
  localRead.mockReturnValue(new Promise(() => {}));
  const { rerender } = renderHook(
    ({ activityKey }) => useLatestTurnToolCalls({ ...params, activityKey }),
    { initialProps: { activityKey: "" } },
  );
  await advance();
  rerender({ activityKey: "new narration" });
  await advance(8000);
  expect(localRead).toHaveBeenCalledTimes(1);
  expect(authorize).not.toHaveBeenCalled();
});
it("clears pre-reconnect payloads until the local reread finishes", async () => {
  const { result: state } = renderHook(() => useLatestTurnToolCalls(params));
  await advance();
  expect(state.current.status).toBe("available");
  localRead.mockReturnValue(new Promise(() => {}));
  act(() => {
    window.dispatchEvent(new Event("offline"));
  });
  expect(state.current.status).toBe("idle");
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  await advance();
  expect(state.current.status).toBe("idle");
  expect(localRead).toHaveBeenCalledTimes(2);
});

it("invalidates the previous machine discovery before a different Run can read", async () => {
  const { result: state, rerender } = renderHook(
    ({ machineId }) => useLocalCliForSession(machineId),
    { initialProps: { machineId: "machine-1" } },
  );
  await advance();
  expect(state.current.status).toBe("local");
  listRepos.mockReturnValue(new Promise(() => {}));
  rerender({ machineId: "machine-2" });
  expect(state.current.status).toBe("checking");
});

it("rereads locally after a network interruption without authorizing remote transport", async () => {
  const { result: state } = renderHook(() => useLatestTurnToolCalls(params));
  await advance();
  localRead.mockRejectedValueOnce(
    new AxiosError("Network Error", "ERR_NETWORK"),
  );
  await advance(2000);
  expect(state.current.status).toBe("unavailable");
  act(() => {
    window.dispatchEvent(new Event("online"));
  });
  await advance();
  expect(state.current.status).toBe("available");
  expect(authorize).not.toHaveBeenCalled();
  expect(listRepos).toHaveBeenCalledTimes(1);
});

it("rejects a snapshot addressed to a different Run", async () => {
  localRead.mockResolvedValue({
    data: { ...response.data, result: { ...result, runId: "different-run" } },
  });
  const { result: state } = renderHook(() => useLatestTurnToolCalls(params));
  await advance();
  expect(state.current.status).toBe("unavailable");
  await advance(4000);
  expect(localRead).toHaveBeenCalledTimes(1);
  expect(authorize).not.toHaveBeenCalled();
});

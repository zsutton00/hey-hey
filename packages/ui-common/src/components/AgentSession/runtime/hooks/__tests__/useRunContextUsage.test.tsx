import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliReadRunContextUsageResult } from "../../../../../api";
import { useRunContextUsage } from "../useRunContextUsage";
import { runContextUsageCache } from "../../RunContextUsageCache";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  authorize: vi.fn(),
  machines: [{ machineId: "machine" }],
  session: { machineId: "machine" },
  auth: new Set<() => void>(),
}));
vi.mock("../../../../../clients/serviceClients", () => ({
  unifiedApiClient: { readAgentSessionCliState: mocks.read },
}));
vi.mock("../../../../../data/hooks/useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: mocks.session }),
}));
vi.mock("../../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines: mocks.machines }),
}));
vi.mock("../../../../../data/hooks/useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({ mutate: mocks.authorize }),
}));
vi.mock("../../../../../services/authService", () => ({
  onAuthChange: (callback: () => void) => {
    mocks.auth.add(callback);
    return () => mocks.auth.delete(callback);
  },
}));

const params = {
  organizationId: "org",
  projectId: "project",
  agentSessionId: "agent",
  runId: "run",
  providerSessionId: "one",
  enabled: true,
};
const result = (
  runId = "run",
  providerSessionId = "one",
): CliReadRunContextUsageResult => ({
  runId,
  providerSessionId,
  contextData: {
    model: providerSessionId,
    categories: [],
    totalTokens: 10,
    maxTokens: 100,
    rawMaxTokens: 100,
    percentage: 10,
    gridRows: [],
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: false,
    apiUsage: null,
  },
  cost: {
    state: "available",
    amountUsd: 2,
    currency: "USD",
    source: "ccusage",
  },
});
const response = (data = result()) => ({
  data: { data: { operation: "run.context_usage.get", result: data } },
});

beforeEach(() => {
  runContextUsageCache.clear();
  mocks.read.mockReset().mockResolvedValue(response());
  mocks.authorize.mockReset().mockImplementation(async ({ submit }) => ({
    outcome: "ADMITTED",
    data: await submit({
      authorization: { kind: "ACTIVE_GRANT", grantId: "grant" },
    }),
  }));
  mocks.machines = [{ machineId: "machine" }];
});

describe("useRunContextUsage", () => {
  it("publishes retained data immediately after unmount/reopen while issuing a fresh protected read", async () => {
    const first = renderHook(() => useRunContextUsage(params));
    await waitFor(() => expect(first.result.current.status).toBe("success"));
    first.unmount();
    let finish!: (value: ReturnType<typeof response>) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((done) => {
          finish = done;
        }),
    );
    const reopened = renderHook(() => useRunContextUsage(params));
    expect(reopened.result.current.data?.contextData.model).toBe("one");
    expect(reopened.result.current.status).toBe("loading");
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2));
    expect(mocks.read).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org",
        projectId: "project",
        agentSessionId: "agent",
        cliReadRequestDto: {
          operation: "run.context_usage.get",
          runId: "run",
          providerSessionId: "one",
          authorization: { kind: "ACTIVE_GRANT", grantId: "grant" },
        },
      }),
    );
    expect(mocks.authorize.mock.calls[0][0].action.requestId).not.toBe(
      mocks.authorize.mock.calls[1][0].action.requestId,
    );
    await act(async () => finish(response()));
  });

  it("keeps out-of-order responses scoped to the selected Run and provider session", async () => {
    const completions = new Map<
      string,
      (value: ReturnType<typeof response>) => void
    >();
    mocks.read.mockImplementation(
      ({ cliReadRequestDto }) =>
        new Promise((done) =>
          completions.set(cliReadRequestDto.providerSessionId, done),
        ),
    );
    const view = renderHook((p) => useRunContextUsage(p), {
      initialProps: params,
    });
    await waitFor(() => expect(completions.has("one")).toBe(true));
    view.rerender({ ...params, runId: "run-two", providerSessionId: "two" });
    expect(view.result.current.data).toBeNull();
    await waitFor(() => expect(completions.has("two")).toBe(true));
    await act(async () =>
      completions.get("two")!(response(result("run-two", "two"))),
    );
    await act(async () => completions.get("one")!(response()));
    expect(view.result.current.data?.providerSessionId).toBe("two");
  });

  it.each(["organizationId", "projectId", "agentSessionId"] as const)(
    "does not display another %s's reading",
    async (field) => {
      const view = renderHook((p) => useRunContextUsage(p), {
        initialProps: params,
      });
      await waitFor(() => expect(view.result.current.status).toBe("success"));
      mocks.read.mockImplementationOnce(() => new Promise(() => {}));
      view.rerender({ ...params, [field]: "other" });
      expect(view.result.current.data).toBeNull();
    },
  );

  it("retains values on timeout, denied read and unavailable machine, then recovers on Retry", async () => {
    const view = renderHook(() => useRunContextUsage(params));
    await waitFor(() => expect(view.result.current.status).toBe("success"));
    mocks.read.mockResolvedValueOnce({
      data: {
        data: {
          operation: "run.context_usage.get",
          error: { code: "TIMEOUT", message: "Timed out" },
        },
      },
    });
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.errorCode).toBe("TIMEOUT"));
    expect(view.result.current.data).not.toBeNull();
    mocks.authorize.mockResolvedValueOnce({ outcome: "DENIED" });
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.error).toContain("denied"));
    expect(view.result.current.data).not.toBeNull();
    mocks.machines = [];
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.error).toContain("machine"));
    expect(view.result.current.data).not.toBeNull();
    mocks.machines = [{ machineId: "machine" }];
    act(() => view.result.current.retry());
    await waitFor(() => expect(view.result.current.status).toBe("success"));
  });

  it("does not read while closed or without an explicit provider session", async () => {
    const view = renderHook((p) => useRunContextUsage(p), {
      initialProps: { ...params, enabled: false },
    });
    await act(async () => {});
    expect(mocks.read).not.toHaveBeenCalled();
    view.rerender({ ...params, enabled: true });
    await waitFor(() => expect(view.result.current.status).toBe("success"));
    view.rerender({ ...params, enabled: false });
    act(() => mocks.auth.forEach((callback) => callback()));
    await act(async () => {});
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(view.result.current.data).toBeNull();
    renderHook(() =>
      useRunContextUsage({ ...params, providerSessionId: undefined }),
    );
    await act(async () => {});
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});

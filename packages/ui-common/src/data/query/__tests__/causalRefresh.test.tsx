import React from "react";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { createStore } from "jotai";
import { afterEach, expect, it, vi } from "vitest";
import { dataClient } from "../../../clients";
import { AgentSessionCurrentState, AgentSessionOutputAttentionState } from "../../../api";
import { agentSessionCurrentStateQueryOptions, agentSessionOutputAttentionQueryOptions, createAgentSessionBatchReadCoordinator } from "../../collections/agentSessionLiveState";
import { WebSocketHandler } from "../../websockets/handler";
import { useCollectionQueryState } from "../useCollectionQueryState";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it("ordinary same-key mounts share an older in-flight read", async () => {
  const { client, wrapper } = setup();
  const pending = deferred<string>();
  const read = vi.fn(() => pending.promise);
  const key = ["shared-mount"];
  const useShared = () => {
    const result = useQuery({ queryKey: key, queryFn: read });
    return { result, state: useCollectionQueryState(result, key, true) };
  };
  const first = renderHook(useShared, { wrapper });
  const second = renderHook(useShared, { wrapper });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve("shared"); await pending.promise; });
  expect(client.getQueryData(key)).toBe("shared");
  expect(read).toHaveBeenCalledTimes(1);
  first.unmount(); second.unmount(); client.clear();
});

it.each([false, true])("explicit refresh during loading returns the later selected result (cached: %s)", async (cached) => {
  vi.useFakeTimers();
  const { client, wrapper } = setup();
  const older = deferred<string>();
  const later = deferred<string>();
  const read = vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(later.promise);
  const key = ["causal-refresh"];
  if (cached) client.setQueryData(key, "cached");
  const view = renderHook(() => useCollectionQueryState(useQuery({ queryKey: key, queryFn: read, select: (value: string) => value.toUpperCase() }), key, true), { wrapper });
  let refresh!: Promise<string | null>;
  let shared!: Promise<string | null>;
  await act(async () => {
    refresh = view.result.current.refetch();
    shared = view.result.current.refetch();
  });
  expect(read).toHaveBeenCalledTimes(2);
  let settled = false;
  void refresh.then(() => { settled = true; });
  await act(async () => { older.resolve("older"); await vi.advanceTimersByTimeAsync(0); });
  expect(settled).toBe(false);
  await act(async () => { later.resolve("changed"); await refresh; });
  await expect(refresh).resolves.toBe("CHANGED");
  await expect(shared).resolves.toBe("CHANGED");
  expect(client.getQueryData(key)).toBe("changed");
  view.unmount(); client.clear();
});

it("preserves refresh failure and the disabled guard", async () => {
  const { client, wrapper } = setup();
  const read = vi.fn().mockRejectedValue(new Error("denied"));
  const key = ["failed-refresh"];
  const view = renderHook(({ enabled }) => useCollectionQueryState(
    useQuery({ queryKey: key, queryFn: read, enabled }), key, enabled
  ), { wrapper, initialProps: { enabled: false } });
  await expect(view.result.current.refetch()).resolves.toBeNull();
  expect(read).not.toHaveBeenCalled();
  view.rerender({ enabled: true });
  await act(async () => {
    await expect(view.result.current.refetch()).rejects.toThrow("denied");
  });
  view.unmount(); client.clear();
});

it("later same-ID demand survives an older failed batch and shares the trailing dispatch", async () => {
  vi.useFakeTimers();
  let rejectOlder!: (error: Error) => void;
  const older = new Promise<readonly number[]>((_resolve, reject) => { rejectOlder = reject; });
  const read = vi.fn().mockReturnValueOnce(older).mockResolvedValueOnce([2]);
  const apply = vi.fn();
  const coordinator = createAgentSessionBatchReadCoordinator(read, apply);
  const input = { organizationId: "org", projectId: "project", agentSessionIds: ["session"] };
  const first = coordinator.request(input);
  const rejected = expect(first).rejects.toThrow("older failed");
  await vi.advanceTimersByTimeAsync(0);
  const later = coordinator.request(input);
  const shared = coordinator.request(input);
  rejectOlder(new Error("older failed"));
  await vi.advanceTimersByTimeAsync(999);
  await rejected;
  expect(read).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  await Promise.all([later, shared]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(apply).toHaveBeenCalledWith("org", "project", [2]);
});

it.each([
  { dataset: "currentState", recoveryMode: "room" },
  { dataset: "currentState", recoveryMode: "reconnect" },
  { dataset: "outputAttention", recoveryMode: "room" },
  { dataset: "outputAttention", recoveryMode: "reconnect" },
] as const)("$recoveryMode requires later $dataset transport, with and without cached data", async ({ dataset, recoveryMode }) => {
  vi.useFakeTimers();
  for (const cached of [false, true]) {
    const { client, wrapper } = setup();
    const entry = (revision: number) => dataset === "currentState"
      ? { agentSessionId: "session", revision, transitionedAt: "2026-10-08T00:00:00Z", currentState: AgentSessionCurrentState.Thinking }
      : { agentSessionId: "session", revision, changedAt: "2026-10-08T00:00:00Z", state: AgentSessionOutputAttentionState.MessageReady };
    const response = (revision: number) => ({ data: { data: { items: [entry(revision)] } } });
    const older = deferred<ReturnType<typeof response>>();
    const later = deferred<ReturnType<typeof response>>();
    const read = vi.spyOn(dataClient, "request")
      .mockImplementationOnce(() => older.promise as never)
      .mockImplementationOnce(() => later.promise as never);
    const options = dataset === "currentState"
      ? agentSessionCurrentStateQueryOptions(client, "org", "project", "session")
      : agentSessionOutputAttentionQueryOptions(client, "org", "project", "session");
    if (cached) client.setQueryData(options.queryKey, entry(0), { updatedAt: 1 });
    const view = renderHook(() => useQuery(options), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(read).toHaveBeenCalledTimes(1);
    const handler = new WebSocketHandler(createStore(), undefined, client);
    let recovery!: Promise<void>;
    await act(async () => {
      if (recoveryMode === "reconnect") {
        recovery = new Promise<void>((resolve) => {
          const unsubscribe = client.getQueryCache().subscribe(() => {
            if (
              client.getQueryState(options.queryKey)?.fetchStatus === "idle" &&
              client.getQueryData<{ revision: number }>(options.queryKey)?.revision === 2
            ) {
              unsubscribe();
              resolve();
            }
          });
          handler.markAllStale();
        });
        return;
      }
      const recover = () => dataset === "currentState"
        ? handler.refreshLoadedAgentSessionCurrentStates("org", "project")
        : handler.refreshLoadedAgentSessionOutputAttention("org", "project");
      recovery = Promise.all([recover(), recover()]).then(() => undefined);
    });
    let settled = false;
    void recovery.then(() => { settled = true; });
    await act(async () => { older.resolve(response(1)); await vi.advanceTimersByTimeAsync(999); });
    expect(settled).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => { later.resolve(response(2)); await recovery; await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.data).toMatchObject({ revision: 2 });
    view.unmount(); client.clear(); read.mockRestore();
  }
});

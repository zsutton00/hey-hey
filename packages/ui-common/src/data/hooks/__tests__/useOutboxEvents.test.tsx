import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}

import { useOutboxEvents } from "../useOutboxEvents";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  eventsClient: { getEntityOutboxEventsDebug: read },
}));
const data = { entityType: "task", entityId: "task-1", count: 0, events: [] };
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue({ data: { data } });
});
describe("useOutboxEvents", () => {
  it("shares reads and keeps data visible during refresh", async () => {
    const { wrapper, client } = setup();
    const view = renderHook(
      () => ({
        first: useOutboxEvents("task", "task-1"),
        second: useOutboxEvents("task", "task-1"),
      }),
      { wrapper }
    );
    expect(view.result.current.first.isLoading).toBe(true);
    expect(view.result.current.first.error).toBeNull();
    await waitFor(() => expect(view.result.current.second.isReady).toBe(true));
    expect(view.result.current.first.data).toEqual(data);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await view.result.current.first.refetch()).toEqual(data);
    });
    expect(read).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });
  it("returns an explicit successful empty result", async () => {
    read.mockResolvedValue({ data: { data: null } });
    const { wrapper, client } = setup();
    const view = renderHook(() => useOutboxEvents("task", "task-1"), {
      wrapper,
    });
    await waitFor(() => expect(view.result.current.isReady).toBe(true));
    expect(view.result.current.data).toBeNull();
    expect(view.result.current.error).toBeNull();
    view.unmount();
    client.clear();
  });
});

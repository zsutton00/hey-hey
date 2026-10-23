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

import { useLlmRequestStatus } from "../useLlmRequestStatus";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getLLMRequestStatus: read },
}));
const data = {
  requestId: "req-123",
  isActive: true,
  startTime: "2024-01-01T00:00:00Z",
  duration: 1200,
};
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue({ data: { data } });
});
describe("useLlmRequestStatus", () => {
  it("shares reads and keeps data visible during refresh", async () => {
    const { wrapper, client } = setup();
    const view = renderHook(
      () => ({
        first: useLlmRequestStatus("req-123"),
        second: useLlmRequestStatus("req-123"),
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
    const view = renderHook(() => useLlmRequestStatus("req-123"), { wrapper });
    await waitFor(() => expect(view.result.current.isReady).toBe(true));
    expect(view.result.current.data).toBeNull();
    expect(view.result.current.error).toBeNull();
    view.unmount();
    client.clear();
  });
});

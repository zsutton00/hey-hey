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

import { usePrivateBetaAdmissionMode } from "../usePrivateBetaAdmissionMode";
const mocks = vi.hoisted(() => ({ read: vi.fn(), update: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getPrivateBetaSelfServiceAdmissionMode: mocks.read,
    updatePrivateBetaSelfServiceAdmissionMode: mocks.update,
  },
}));
const mode = {
  mode: "OPEN",
  updatedAt: "2026-09-22T10:00:00Z",
  updatedByUserId: null,
};
const paused = { ...mode, mode: "PAUSED" };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue({ data: { data: mode } });
  mocks.update.mockResolvedValue({
    data: { data: { ...paused, alreadyCurrent: false } },
  });
});
describe("private-beta admission mode", () => {
  it("shares the read and issues exactly one read after update", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        first: usePrivateBetaAdmissionMode(),
        second: usePrivateBetaAdmissionMode(),
      }),
      { wrapper }
    );
    await waitFor(() => expect(view.result.current.second.isReady).toBe(true));
    expect(mocks.read).toHaveBeenCalledTimes(1);
    mocks.read.mockResolvedValue({ data: { data: paused } });
    await act(async () => {
      await view.result.current.first.update.mutate("PAUSED");
    });
    await waitFor(() =>
      expect(view.result.current.second.data).toEqual(paused)
    );
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledWith({
      updatePrivateBetaSelfServiceAdmissionModeDto: { mode: "PAUSED" },
    });
    view.unmount();
    client.clear();
  });
  it("keeps durable update successful when refreshing fails", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(() => usePrivateBetaAdmissionMode(), { wrapper });
    await waitFor(() => expect(view.result.current.isReady).toBe(true));
    mocks.read.mockRejectedValue(
      Object.assign(new Error("read failed"), { status: 403 })
    );
    await act(async () => {
      await view.result.current.update.mutate("PAUSED");
    });
    await waitFor(() =>
      expect(view.result.current.error?.message).toBe("read failed")
    );
    expect(view.result.current.update.isSuccess).toBe(true);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });
});

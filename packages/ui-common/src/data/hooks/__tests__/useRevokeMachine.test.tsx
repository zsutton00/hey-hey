import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRevokeMachine } from "../useRevokeMachine";
import { useUserPairedMachines } from "../useUserPairedMachines";
import { machineKeys } from "../../collections/machines";

const { revokeMachine, listMachines } = vi.hoisted(() => ({
  revokeMachine: vi.fn(),
  listMachines: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({
  machinesClient: { revokeMachine, listMachines },
}));

const machine = { machineId: "machine-1", name: "Laptop", revokedAt: null };
const revoked = { ...machine, revokedAt: "2026-05-18T00:00:00Z" };
const listResponse = (machines: unknown[]) => ({
  data: { data: { machines } },
});

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

beforeEach(() => {
  vi.clearAllMocks();
  revokeMachine.mockResolvedValue({ data: undefined });
});

describe("useRevokeMachine", () => {
  it("calls revokeMachine with the supplied machineId", async () => {
    const { wrapper } = createHarness();
    const { result } = renderHook(() => useRevokeMachine(), { wrapper });

    await act(async () => {
      await result.current.mutate({ machineId: "machine-1" });
    });

    expect(revokeMachine).toHaveBeenCalledWith({ machineId: "machine-1" });
  });

  it("invalidates the machines list so the revoked row re-reads, not removed", async () => {
    const { wrapper, queryClient } = createHarness();
    queryClient.setQueryData(machineKeys.currentUser(), [machine]);
    const { result } = renderHook(() => useRevokeMachine(), { wrapper });

    await act(async () => {
      await result.current.mutate({ machineId: "machine-1" });
    });

    const state = queryClient.getQueryState(machineKeys.currentUser());
    expect(state?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(machineKeys.currentUser())).toEqual([
      machine,
    ]);
  });

  it("causes exactly one re-read of a mounted machines list", async () => {
    listMachines
      .mockResolvedValueOnce(listResponse([machine]))
      .mockResolvedValueOnce(listResponse([revoked]));
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => ({ list: useUserPairedMachines(), revoke: useRevokeMachine() }),
      { wrapper }
    );
    await waitFor(() => expect(result.current.list.isReady).toBe(true));

    await act(async () => {
      await result.current.revoke.mutate({ machineId: "machine-1" });
    });

    await waitFor(() =>
      expect(result.current.list.machines).toEqual([revoked])
    );
    expect(listMachines).toHaveBeenCalledTimes(2);
  });

  it("invokes onSuccess and onSettled after a successful revoke", async () => {
    const onSuccess = vi.fn();
    const onSettled = vi.fn();
    const { wrapper } = createHarness();
    const { result } = renderHook(
      () => useRevokeMachine({ onSuccess, onSettled }),
      { wrapper }
    );

    await act(async () => {
      await result.current.mutate({ machineId: "machine-1" });
    });

    expect(onSuccess).toHaveBeenCalled();
    expect(onSettled).toHaveBeenCalled();
  });

  it("invokes onError and onSettled, without invalidating, when the request fails", async () => {
    const error = new Error("Revoke failed");
    revokeMachine.mockRejectedValue(error);
    const onError = vi.fn();
    const onSettled = vi.fn();
    const { wrapper, queryClient } = createHarness();
    queryClient.setQueryData(machineKeys.currentUser(), [machine]);
    const { result } = renderHook(
      () => useRevokeMachine({ onError, onSettled }),
      { wrapper }
    );

    await act(async () => {
      await expect(
        result.current.mutate({ machineId: "machine-1" })
      ).rejects.toThrow("Revoke failed");
    });

    expect(onError).toHaveBeenCalledWith(error);
    expect(onSettled).toHaveBeenCalled();
    expect(
      queryClient.getQueryState(machineKeys.currentUser())?.isInvalidated
    ).toBe(false);
  });
});

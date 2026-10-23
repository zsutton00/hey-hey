import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useUserPairedMachines } from "../useUserPairedMachines";
import { machineKeys } from "../../collections/machines";
import type { MachineDto } from "../../../api";

const { listMachines } = vi.hoisted(() => ({ listMachines: vi.fn() }));
vi.mock("../../../clients/serviceClients", () => ({
  machinesClient: { listMachines },
}));

const machines = [
  {
    machineId: "machine-1",
    name: "Zac's Laptop",
    pairedAt: "2026-05-01T00:00:00Z",
    lastSeen: "2026-05-17T12:00:00Z",
    revokedAt: null,
  },
  {
    machineId: "machine-2",
    name: "Desktop",
    pairedAt: "2026-05-10T00:00:00Z",
    lastSeen: null,
    revokedAt: null,
  },
] as unknown as MachineDto[];

const listResponse = (value: unknown) => ({ data: { data: { machines: value } } });

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
  listMachines.mockResolvedValue(listResponse(machines));
});

describe("machineKeys", () => {
  it("scopes the list to the current user under the machines root", () => {
    expect(machineKeys.root()).toEqual(["machines"]);
    expect(machineKeys.currentUser()).toEqual(["machines", "currentUser"]);
  });
});

describe("useUserPairedMachines", () => {
  it("returns the current user's machines and caches them", async () => {
    const { wrapper, queryClient } = createHarness();

    const { result } = renderHook(() => useUserPairedMachines(), { wrapper });

    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(result.current.machines).toEqual(machines);
    expect(result.current.data).toBe(result.current.machines);
    expect(queryClient.getQueryData(machineKeys.currentUser())).toEqual(
      machines
    );
  });

  it("shares one request between hooks", async () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => ({ a: useUserPairedMachines(), b: useUserPairedMachines() }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.b.isReady).toBe(true));
    expect(result.current.a.machines).toEqual(machines);
    expect(listMachines).toHaveBeenCalledTimes(1);
  });

  it("returns an empty array for an unexpected response shape", async () => {
    listMachines.mockResolvedValue(listResponse(null));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useUserPairedMachines(), { wrapper });

    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.machines).toEqual([]);
  });

  it("presents an in-flight first read as loading", () => {
    listMachines.mockImplementation(() => new Promise(() => {}));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useUserPairedMachines(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.isFetched).toBe(false);
    expect(result.current.isReady).toBe(false);
  });

  it("surfaces errors", async () => {
    listMachines.mockRejectedValue(new Error("Network error"));
    const { wrapper } = createHarness();

    const { result } = renderHook(() => useUserPairedMachines(), { wrapper });

    await waitFor(() =>
      expect(result.current.error?.message).toBe("Network error")
    );
    expect(result.current.isReady).toBe(false);
    expect(result.current.machines).toEqual([]);
  });

  it("respects the enabled option", () => {
    const { wrapper } = createHarness();

    const { result } = renderHook(
      () => useUserPairedMachines({ enabled: false }),
      { wrapper }
    );

    expect(listMachines).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});

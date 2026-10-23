import {
  ControllerEnrollmentEligibilityState,
  MachineExecutionReadinessState,
  type ControllerInventoryResponseDto,
} from "../../../api";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useControllerInventory } from "../useControllerInventory";
const read = vi.hoisted(() => vi.fn());
vi.mock("../../../clients/serviceClients", () => ({
  machinesClient: { listMachineControllers: read },
}));
const inventory: ControllerInventoryResponseDto = {
  machineId: "machine-1",
  authorizationProtocolVersion: 2,
  enrollmentState: ControllerEnrollmentEligibilityState.Ready,
  executionReadiness: MachineExecutionReadinessState.Ready,
  controllers: [],
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return { client, wrapper };
}
beforeEach(() => {
  vi.resetAllMocks();
  read.mockResolvedValue({ data: { data: inventory } });
});
describe("useControllerInventory", () => {
  it("shares an authoritative read and preserves DTOs through refetch", async () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => ({
        first: useControllerInventory("machine-1"),
        second: useControllerInventory("machine-1"),
      }),
      { wrapper }
    );
    expect(view.result.current.first.error).toBeNull();
    await waitFor(() => expect(view.result.current.first.isReady).toBe(true));
    expect(view.result.current.first.data).toEqual(inventory);
    expect(view.result.current.second.data).toEqual(inventory);
    expect(read).toHaveBeenCalledTimes(1);
    await act(async () => {
      expect(await view.result.current.first.refetch()).toEqual(inventory);
    });
    expect(read).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });
  it("does not read while disabled", () => {
    const { client, wrapper } = setup();
    const view = renderHook(
      () => useControllerInventory("machine-1", { enabled: false }),
      { wrapper }
    );
    expect(read).not.toHaveBeenCalled();
    expect(view.result.current.isReady).toBe(false);
    expect(view.result.current.error).toBeNull();
    view.unmount();
    client.clear();
  });
});

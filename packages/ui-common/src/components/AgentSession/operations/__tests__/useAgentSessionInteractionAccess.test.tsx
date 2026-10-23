import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../../api";
import { useAgentSessionInteractionAccess } from "../useAgentSessionInteractionAccess";

const useUserPairedMachinesMock = vi.hoisted(() => vi.fn());

vi.mock("../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => useUserPairedMachinesMock(),
}));

const machine = (
  eligibility: MachineDto["currentControllerEligibility"]
): MachineDto => ({
  machineId: "machine-1",
  name: "Studio Mac",
  pairedAt: "2026-08-27T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility: eligibility,
  bindings: [],
});

const readyQuery = (machines: MachineDto[]) => ({
  machines,
  isFetched: true,
  isLoading: false,
  error: null,
});

describe("useAgentSessionInteractionAccess", () => {
  beforeEach(() => {
    useUserPairedMachinesMock.mockReset();
  });

  it("fails closed while the current-installation inventory is loading", () => {
    useUserPairedMachinesMock.mockReturnValue({
      machines: [],
      isFetched: false,
      isLoading: true,
      error: null,
    });

    const { result } = renderHook(() =>
      useAgentSessionInteractionAccess("machine-1")
    );

    expect(result.current).toEqual({
      isDeviceEnabled: false,
      interactions: null,
      unavailable: {
        type: "inventory_loading",
        message: "Checking whether this browser can use the selected machine.",
      },
    });
  });

  it.each([
    null,
    CurrentControllerMachineEligibilityState.NotEnrolled,
    CurrentControllerMachineEligibilityState.Revoked,
  ])("exposes no callbacks for %s controller eligibility", (eligibility) => {
    useUserPairedMachinesMock.mockReturnValue(
      readyQuery([machine(eligibility)])
    );

    const { result } = renderHook(() =>
      useAgentSessionInteractionAccess("machine-1")
    );

    expect(result.current).toMatchObject({
      isDeviceEnabled: false,
      interactions: null,
      unavailable: { type: "machine_not_ready" },
    });
  });

  it("returns the closed interaction set only for an eligible ready machine", () => {
    useUserPairedMachinesMock.mockReturnValue(
      readyQuery([machine(CurrentControllerMachineEligibilityState.Eligible)])
    );

    const { result } = renderHook(() =>
      useAgentSessionInteractionAccess("machine-1")
    );

    expect(result.current.isDeviceEnabled).toBe(true);
    if (!result.current.isDeviceEnabled) throw new Error("Expected access.");
    expect(Object.keys(result.current.interactions).sort()).toEqual([
      "requestSubagent",
      "startSession",
      "submitMessage",
    ]);
  });
});

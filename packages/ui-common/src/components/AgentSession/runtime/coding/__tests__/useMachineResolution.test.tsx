import { act, renderHook, waitFor } from "@testing-library/react";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../../../api";
import { useMachineResolution } from "../useMachineResolution";

const machineQuery = vi.hoisted(() => ({
  machines: [] as MachineDto[],
  isReady: true,
}));

vi.mock("../../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => machineQuery,
}));

const machine = (
  machineId: string,
  executionReadiness: MachineDto["executionReadiness"],
  currentControllerEligibility: MachineDto["currentControllerEligibility"] = CurrentControllerMachineEligibilityState.Eligible,
): MachineDto => ({
  machineId,
  name: machineId,
  pairedAt: "2026-08-13T00:00:00.000Z",
  active: executionReadiness === MachineExecutionReadinessState.Ready,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness,
  currentControllerEligibility,
  bindings: [],
});

describe("useMachineResolution", () => {
  beforeEach(() => {
    machineQuery.machines = [];
    machineQuery.isReady = true;
  });

  it("reports zero ready machines while preserving visible ineligible machines", () => {
    machineQuery.machines = [
      machine("legacy", MachineExecutionReadinessState.LegacyProtocol),
      machine("offline", MachineExecutionReadinessState.Disconnected),
    ];

    const { result } = renderHook(() => useMachineResolution());

    expect(result.current.mode).toBe("zero");
    expect(result.current.machines).toHaveLength(2);
    expect(result.current.executionReadyMachines).toEqual([]);
    expect(result.current.selectedMachine).toBeNull();
  });

  it("selects the initial sole ready machine", async () => {
    machineQuery.machines = [
      machine("ready", MachineExecutionReadinessState.Ready),
    ];
    const { result } = renderHook(() => useMachineResolution());

    await waitFor(() =>
      expect(result.current.selectedMachine?.machineId).toBe("ready"),
    );
  });

  it("selects a sole ready machine that arrives after the initial empty result", async () => {
    const { result, rerender } = renderHook(() => useMachineResolution());

    machineQuery.machines = [
      machine("ready-late", MachineExecutionReadinessState.Ready),
    ];
    rerender();

    await waitFor(() =>
      expect(result.current.selectedMachine?.machineId).toBe("ready-late"),
    );
  });

  it("keeps every ready paired machine selectable", () => {
    machineQuery.machines = [
      machine("ready-1", MachineExecutionReadinessState.Ready),
      machine("ready-2", MachineExecutionReadinessState.Ready),
    ];
    const { result } = renderHook(() => useMachineResolution());

    expect(result.current.mode).toBe("many");
    expect(result.current.executionReadyMachines).toEqual([
      expect.objectContaining({ machineId: "ready-1" }),
      expect.objectContaining({ machineId: "ready-2" }),
    ]);
    act(() => result.current.setSelectedMachineId("ready-2"));
    expect(result.current.selectedMachine?.machineId).toBe("ready-2");
  });

  it("rejects an ineligible machine selection", () => {
    machineQuery.machines = [
      machine("offline", MachineExecutionReadinessState.Disconnected),
      machine("ready-1", MachineExecutionReadinessState.Ready),
      machine("ready-2", MachineExecutionReadinessState.Ready),
    ];
    const { result } = renderHook(() => useMachineResolution());

    act(() => result.current.setSelectedMachineId("ready-1"));
    act(() => result.current.setSelectedMachineId("offline"));

    expect(result.current.selectedMachine?.machineId).toBe("ready-1");
  });

  it("clears an invalidated selection without substituting another ready machine", async () => {
    machineQuery.machines = [
      machine("selected", MachineExecutionReadinessState.Ready),
      machine("other", MachineExecutionReadinessState.Ready),
    ];
    const { result, rerender } = renderHook(() => useMachineResolution());

    act(() => result.current.setSelectedMachineId("selected"));
    machineQuery.machines = [
      machine("selected", MachineExecutionReadinessState.Disconnected),
      machine("other", MachineExecutionReadinessState.Ready),
    ];
    rerender();

    await waitFor(() => expect(result.current.selectedMachine).toBeNull());
  });

  it("clears selection when current-controller eligibility is revoked without substituting", async () => {
    machineQuery.machines = [
      machine("selected", MachineExecutionReadinessState.Ready),
      machine("other", MachineExecutionReadinessState.Ready),
    ];
    const { result, rerender } = renderHook(() => useMachineResolution());

    act(() => result.current.setSelectedMachineId("selected"));
    machineQuery.machines = [
      machine(
        "selected",
        MachineExecutionReadinessState.Ready,
        CurrentControllerMachineEligibilityState.Revoked,
      ),
      machine("other", MachineExecutionReadinessState.Ready),
    ];
    rerender();

    await waitFor(() => expect(result.current.selectedMachine).toBeNull());
  });
});

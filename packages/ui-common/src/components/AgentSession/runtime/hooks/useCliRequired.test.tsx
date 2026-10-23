import { renderHook } from "@testing-library/react";
import {
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type ConversationCliStatusResponseDto,
  type MachineDto,
} from "../../../../api";
import { useCliRequired } from "./useCliRequired";

interface CliStatusTestState {
  isLoading: boolean;
  data: ConversationCliStatusResponseDto | null;
  error?: Error;
}

const statusRef = vi.hoisted(() => ({
  current: {
    isLoading: false,
    data: null,
  } as CliStatusTestState,
}));

vi.mock("../../../../data/hooks/useConversationCliStatus", () => ({
  useConversationCliStatus: vi.fn(() => statusRef.current),
}));

const machine = (
  executionReadiness: MachineDto["executionReadiness"],
): MachineDto => ({
  machineId: "machine-1",
  name: "Orbit",
  pairedAt: "2026-08-26T00:00:00.000Z",
  active: executionReadiness === MachineExecutionReadinessState.Ready,
  authorizationProtocolVersion: 2,
  executionReadiness,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
});

const machinesRef = vi.hoisted(() => ({
  current: [] as MachineDto[],
  isReady: true,
}));

vi.mock("../../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: machinesRef.current,
    isReady: machinesRef.isReady,
  }),
}));

const status = (
  executionReadiness: ConversationCliStatusResponseDto["executionReadiness"],
): ConversationCliStatusResponseDto => ({
  connected: executionReadiness !== MachineExecutionReadinessState.Disconnected,
  selectedMachineId:
    executionReadiness === MachineExecutionReadinessState.NoMachineSelected
      ? null
      : "machine-1",
  authorizationProtocolVersion: null,
  executionReadiness,
});

describe("useCliRequired", () => {
  beforeEach(() => {
    statusRef.current = { isLoading: false, data: null };
    machinesRef.current = [];
    machinesRef.isReady = true;
  });

  it("fails closed when bound-session status cannot be verified", () => {
    statusRef.current = {
      isLoading: false,
      data: null,
      error: new Error("status request failed"),
    };
    machinesRef.current = [machine(MachineExecutionReadinessState.Ready)];

    const { result } = renderHook(() =>
      useCliRequired("organization-1", "project-1", "conversation-1"),
    );

    expect(result.current).toEqual({ type: "status_unavailable" });
  });

  it("fails closed while the first readiness check is loading", () => {
    statusRef.current = { isLoading: true, data: null };

    const { result } = renderHook(() =>
      useCliRequired("organization-1", "project-1", "conversation-1"),
    );

    expect(result.current).toEqual({ type: "loading" });
  });

  it("permits input only when the selected machine is ready", () => {
    statusRef.current = {
      isLoading: false,
      data: status(MachineExecutionReadinessState.Ready),
    };
    machinesRef.current = [machine(MachineExecutionReadinessState.Ready)];

    const { result } = renderHook(() =>
      useCliRequired("organization-1", "project-1", "conversation-1"),
    );

    expect(result.current).toEqual({
      type: "ready",
      machine: machine(MachineExecutionReadinessState.Ready),
    });
  });

  it("permits a ready remote machine when the account inventory says it is ready", () => {
    statusRef.current = {
      isLoading: false,
      data: status(MachineExecutionReadinessState.Ready),
    };
    machinesRef.current = [machine(MachineExecutionReadinessState.Ready)];

    const { result } = renderHook(() =>
      useCliRequired("organization-1", "project-1", "conversation-1"),
    );

    expect(result.current).toEqual({
      type: "ready",
      machine: machine(MachineExecutionReadinessState.Ready),
    });
  });

  it.each([
    [MachineExecutionReadinessState.Disconnected, "disconnected"],
    [
      MachineExecutionReadinessState.ControllerEnrollmentRequired,
      "controller_enrollment_required",
    ],
    [MachineExecutionReadinessState.ControllerRevoked, "controller_revoked"],
    [MachineExecutionReadinessState.MachineRevoked, "machine_revoked"],
    [MachineExecutionReadinessState.LegacyProtocol, "legacy_protocol"],
  ])("blocks %s with state-specific guidance", (readiness, type) => {
    statusRef.current = { isLoading: false, data: status(readiness) };
    machinesRef.current = [machine(readiness)];

    const { result } = renderHook(() =>
      useCliRequired("organization-1", "project-1", "conversation-1"),
    );

    expect(result.current).toEqual({ type, machine: machine(readiness) });
  });
});

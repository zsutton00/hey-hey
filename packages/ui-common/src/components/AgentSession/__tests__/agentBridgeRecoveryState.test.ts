import { describe, expect, it } from "vitest";
import {
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type ConversationCliStatusResponseDto,
  type MachineDto,
} from "../../../api";
import { resolveAgentBridgeRecoveryState } from "../agentBridgeRecoveryState";

const machine = (
  name: string,
  executionReadiness: MachineDto["executionReadiness"]
): MachineDto => ({
  machineId: `machine-${name}`,
  name,
  pairedAt: "2026-08-26T00:00:00.000Z",
  active: executionReadiness !== MachineExecutionReadinessState.Disconnected,
  authorizationProtocolVersion: 2,
  executionReadiness,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
});

const boundStatus = (
  executionReadiness: ConversationCliStatusResponseDto["executionReadiness"],
  selectedMachineId = "machine-Orbit"
): ConversationCliStatusResponseDto => ({
  connected: executionReadiness !== MachineExecutionReadinessState.Disconnected,
  selectedMachineId,
  authorizationProtocolVersion: 2,
  executionReadiness,
});

describe("resolveAgentBridgeRecoveryState", () => {
  it("resolves loading, legacy, zero, and ready inventory states", () => {
    const ready = machine("Ready", MachineExecutionReadinessState.Ready);
    const second = machine("Second", MachineExecutionReadinessState.Ready);

    expect(
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: true,
        machines: [],
        selectedMachineId: null,
      })
    ).toEqual({ type: "loading" });
    expect(
      resolveAgentBridgeRecoveryState({ type: "legacy_non_resumable" })
    ).toEqual({ type: "legacy_non_resumable" });
    expect(
      resolveAgentBridgeRecoveryState({ type: "status_unavailable" })
    ).toEqual({ type: "status_unavailable" });
    expect(
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: false,
        machines: [],
        selectedMachineId: null,
      })
    ).toEqual({ type: "no_paired_machines" });
    expect(
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: false,
        machines: [ready],
        selectedMachineId: null,
      })
    ).toEqual({ type: "ready", machine: ready });
    expect(
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: false,
        machines: [ready, second],
        selectedMachineId: null,
      })
    ).toEqual({ type: "multiple_ready", machines: [ready, second] });
  });

  it.each([
    [MachineExecutionReadinessState.Disconnected, "disconnected"],
    [
      MachineExecutionReadinessState.NoMachineSelected,
      "controller_pairing_required",
    ],
    [
      MachineExecutionReadinessState.ControllerEnrollmentRequired,
      "controller_enrollment_required",
    ],
    [MachineExecutionReadinessState.ControllerRevoked, "controller_revoked"],
    [MachineExecutionReadinessState.MachineRevoked, "machine_revoked"],
    [MachineExecutionReadinessState.LegacyProtocol, "legacy_protocol"],
  ] as const)(
    "maps %s to %s without losing machine identity",
    (readiness, type) => {
      const orbit = machine("Orbit", readiness);
      const state = resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: false,
        machines: [orbit],
        selectedMachineId: null,
      });

      expect(state).toEqual({
        type: "paired_none_ready",
        machines: [{ type, machine: orbit }],
      });
    }
  );

  it("uses the bound machine readiness without substituting another ready machine", () => {
    const orbit = machine("Orbit", MachineExecutionReadinessState.Ready);
    const spare = machine("Spare", MachineExecutionReadinessState.Ready);

    expect(
      resolveAgentBridgeRecoveryState({
        type: "bound_session",
        isLoading: false,
        machines: [orbit, spare],
        status: boundStatus(MachineExecutionReadinessState.Disconnected),
      })
    ).toEqual({
      type: "disconnected",
      machine: {
        ...orbit,
        executionReadiness: MachineExecutionReadinessState.Disconnected,
      },
    });
  });

  it("keeps a ready remote machine available for recovery", () => {
    const remote = machine("Remote", MachineExecutionReadinessState.Ready);

    expect(
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: false,
        machines: [remote],
        selectedMachineId: null,
      })
    ).toEqual({ type: "ready", machine: remote });
  });

  it.each([
    [
      CurrentControllerMachineEligibilityState.NotEnrolled,
      "browser_authorization_required",
    ],
    [
      CurrentControllerMachineEligibilityState.Revoked,
      "browser_authorization_revoked",
    ],
    [null, "controller_context_unavailable"],
  ] as const)(
    "keeps globally ready machines recoverable when browser eligibility is %s",
    (eligibility, type) => {
      const globallyReady = {
        ...machine("MacBook-Pro", MachineExecutionReadinessState.Ready),
        currentControllerEligibility: eligibility,
      };

      expect(
        resolveAgentBridgeRecoveryState({
          type: "inventory",
          isLoading: false,
          machines: [globallyReady],
          selectedMachineId: null,
        })
      ).toEqual({
        type: "paired_none_ready",
        machines: [{ type, machine: globallyReady }],
      });
    }
  );

  it("renders one recovery state when inventory repeats a machine identity", () => {
    const orbit = machine(
      "MacBook-Pro",
      MachineExecutionReadinessState.Disconnected
    );

    expect(
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: false,
        machines: [orbit, orbit],
        selectedMachineId: null,
      })
    ).toEqual({
      type: "paired_none_ready",
      machines: [{ type: "disconnected", machine: orbit }],
    });
  });

  it("reports a bound machine that is absent from paired inventory", () => {
    expect(
      resolveAgentBridgeRecoveryState({
        type: "bound_session",
        isLoading: false,
        machines: [],
        status: boundStatus(MachineExecutionReadinessState.Ready),
      })
    ).toEqual({ type: "bound_machine_missing" });
  });

  it("recovers the session's bound machine instead of substituting another ready machine", () => {
    const bound = {
      ...machine("machine-1", MachineExecutionReadinessState.Ready),
      currentControllerEligibility:
        CurrentControllerMachineEligibilityState.NotEnrolled,
    };
    const other = machine("machine-2", MachineExecutionReadinessState.Ready);

    expect(
      resolveAgentBridgeRecoveryState({
        type: "bound_session",
        isLoading: false,
        machines: [bound, other],
        status: boundStatus(
          MachineExecutionReadinessState.Ready,
          bound.machineId
        ),
      })
    ).toEqual({ type: "browser_authorization_required", machine: bound });
  });
});

import {
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type ConversationCliStatusResponseDto,
  type MachineDto,
} from "../../api";
import {
  classifyMachineExecutionReadiness,
  getMachineExecutionReadinessPresentation,
} from "./runtime/coding/machineExecutionReadiness";

export type AgentBridgeMachine = Pick<
  MachineDto,
  "machineId" | "name" | "executionReadiness" | "currentControllerEligibility"
>;

export type AgentBridgeMachineUnavailableState =
  | { type: "disconnected"; machine: AgentBridgeMachine }
  | { type: "controller_pairing_required"; machine: AgentBridgeMachine }
  | { type: "controller_enrollment_required"; machine: AgentBridgeMachine }
  | { type: "controller_revoked"; machine: AgentBridgeMachine }
  | { type: "browser_authorization_required"; machine: AgentBridgeMachine }
  | { type: "browser_authorization_revoked"; machine: AgentBridgeMachine }
  | { type: "controller_context_unavailable"; machine: AgentBridgeMachine }
  | { type: "controller_selection_required"; machine: AgentBridgeMachine }
  | { type: "machine_revoked"; machine: AgentBridgeMachine }
  | { type: "legacy_protocol"; machine: AgentBridgeMachine };

export type AgentBridgeRecoveryState =
  | { type: "loading" }
  | { type: "status_unavailable" }
  | { type: "ready"; machine: AgentBridgeMachine }
  | { type: "multiple_ready"; machines: readonly AgentBridgeMachine[] }
  | { type: "no_paired_machines" }
  | {
      type: "paired_none_ready";
      machines: readonly AgentBridgeMachineUnavailableState[];
    }
  | { type: "bound_machine_missing" }
  | { type: "legacy_non_resumable" }
  | AgentBridgeMachineUnavailableState;

type AgentBridgeRecoveryResolutionInput =
  | { type: "legacy_non_resumable" }
  | { type: "status_unavailable" }
  | { type: "controller_pairing_required"; machine: AgentBridgeMachine }
  | {
      type: "inventory";
      isLoading: boolean;
      machines: readonly MachineDto[];
      selectedMachineId: string | null;
    }
  | {
      type: "bound_session";
      isLoading: boolean;
      machines: readonly MachineDto[];
      status: ConversationCliStatusResponseDto | null;
    };

const assertNever = (value: never): never => {
  throw new Error(`Unhandled Agent Bridge recovery value: ${String(value)}`);
};

const uniqueMachinesById = (
  machines: readonly MachineDto[],
): readonly MachineDto[] => {
  const machineIds = new Set<string>();
  return machines.filter((machine) => {
    if (machineIds.has(machine.machineId)) return false;
    machineIds.add(machine.machineId);
    return true;
  });
};

export const resolveMachineUnavailableState = (
  machine: AgentBridgeMachine,
): AgentBridgeMachineUnavailableState => {
  const readiness = getMachineExecutionReadinessPresentation(
    machine.executionReadiness,
  );
  switch (readiness.state) {
    case MachineExecutionReadinessState.Disconnected:
      return { type: "disconnected", machine };
    case MachineExecutionReadinessState.ControllerEnrollmentRequired:
      return { type: "controller_enrollment_required", machine };
    case MachineExecutionReadinessState.ControllerRevoked:
      return { type: "controller_revoked", machine };
    case MachineExecutionReadinessState.MachineRevoked:
      return { type: "machine_revoked", machine };
    case MachineExecutionReadinessState.LegacyProtocol:
      return { type: "legacy_protocol", machine };
    case MachineExecutionReadinessState.NoMachineSelected:
      return { type: "controller_pairing_required", machine };
    case MachineExecutionReadinessState.Ready:
      switch (machine.currentControllerEligibility) {
        case null:
          return { type: "controller_context_unavailable", machine };
        case CurrentControllerMachineEligibilityState.NotEnrolled:
          return { type: "browser_authorization_required", machine };
        case CurrentControllerMachineEligibilityState.Ambiguous:
          return { type: "controller_selection_required", machine };
        case CurrentControllerMachineEligibilityState.Revoked:
          return { type: "browser_authorization_revoked", machine };
        case CurrentControllerMachineEligibilityState.Eligible:
          throw new Error(
            `Machine ${machine.name} is available and does not require recovery.`,
          );
      }
      return assertNever(machine.currentControllerEligibility);
    default:
      return assertNever(readiness.state);
  }
};

const resolveInventory = (
  machines: readonly MachineDto[],
  selectedMachineId: string | null,
): AgentBridgeRecoveryState => {
  const uniqueMachines = uniqueMachinesById(machines);
  const selected = uniqueMachines.find(
    (machine) => machine.machineId === selectedMachineId,
  );
  if (
    selected?.currentControllerEligibility ===
    CurrentControllerMachineEligibilityState.Ambiguous
  ) {
    return { type: "controller_selection_required", machine: selected };
  }
  const readyMachines = uniqueMachines.filter(
    (machine) => classifyMachineExecutionReadiness(machine).selectable,
  );
  const selectedMachine = readyMachines.find(
    (machine) => machine.machineId === selectedMachineId,
  );
  if (selectedMachine) return { type: "ready", machine: selectedMachine };
  if (readyMachines.length === 1)
    return { type: "ready", machine: readyMachines[0] };
  if (readyMachines.length > 1) {
    return { type: "multiple_ready", machines: readyMachines };
  }
  if (uniqueMachines.length === 0) return { type: "no_paired_machines" };
  return {
    type: "paired_none_ready",
    machines: uniqueMachines.map((machine) =>
      resolveMachineUnavailableState(machine),
    ),
  };
};

export const resolveAgentBridgeRecoveryState = (
  input: AgentBridgeRecoveryResolutionInput,
): AgentBridgeRecoveryState => {
  switch (input.type) {
    case "legacy_non_resumable":
      return { type: "legacy_non_resumable" };
    case "status_unavailable":
      return { type: "status_unavailable" };
    case "controller_pairing_required":
      return { type: "controller_pairing_required", machine: input.machine };
    case "inventory":
      return input.isLoading
        ? { type: "loading" }
        : resolveInventory(input.machines, input.selectedMachineId);
    case "bound_session": {
      if (input.isLoading) return { type: "loading" };
      if (input.status === null) {
        return resolveInventory(input.machines, null);
      }
      const machineId = input.status.selectedMachineId;
      if (
        input.status.executionReadiness ===
          MachineExecutionReadinessState.NoMachineSelected ||
        machineId === null
      ) {
        return resolveInventory(input.machines, null);
      }
      const machine = input.machines.find(
        (candidate) => candidate.machineId === machineId,
      );
      if (!machine) return { type: "bound_machine_missing" };
      if (
        input.status.executionReadiness === MachineExecutionReadinessState.Ready
      ) {
        return classifyMachineExecutionReadiness(machine).selectable
          ? { type: "ready", machine }
          : resolveMachineUnavailableState(machine);
      }
      return resolveMachineUnavailableState({
        ...machine,
        executionReadiness: input.status.executionReadiness,
      });
    }
    default:
      return assertNever(input);
  }
};

import {
  AgentSessionContinuationSourceState,
  AgentSessionContinuationState,
  type AgentSessionContinuationDto,
  type AgentSessionContinuationStatusDto,
  type MachineDto,
} from "../../api";
import {
  resolveMachineUnavailableState,
  type AgentBridgeMachineUnavailableState,
  type AgentBridgeRecoveryState,
} from "./agentBridgeRecoveryState";
import { classifyMachineExecutionReadiness } from "./runtime/coding/machineExecutionReadiness";

/**
 * The session's computer was revoked or removed (server-confirmed). Ready
 * destinations can continue it; unready paired computers show their own
 * recovery action; with neither, the person pairs a computer.
 */
export interface ContinuationOfferState {
  type: "continuation_offer";
  boundMachineId: string;
  destinations: readonly MachineDto[];
  unavailable: readonly AgentBridgeMachineUnavailableState[];
}

/** Delivered to the destination; provider startup is not yet confirmed. */
export interface ContinuationPendingState {
  type: "continuation_pending";
  continuation: AgentSessionContinuationDto;
}

/**
 * A durable attempt waiting on the person: a failed delivery to retry, or a
 * new provider session from saved history to confirm. `destination` is the
 * attempt's computer when it is paired and ready, else null.
 */
interface ContinuationAttemptAction<Type extends string> {
  type: Type;
  continuation: AgentSessionContinuationDto;
  destination: MachineDto | null;
}

export type ContinuationFailedState =
  ContinuationAttemptAction<"continuation_failed">;
/** Delivered, but no startup report arrived; check again before anything else. */
export type ContinuationUncertainState =
  ContinuationAttemptAction<"continuation_uncertain">;
export type ContinuationConfirmHistoryState =
  ContinuationAttemptAction<"continuation_confirm_history">;
export type ContinuationAttemptActionState =
  | ContinuationFailedState
  | ContinuationUncertainState
  | ContinuationConfirmHistoryState;

export type AgentSessionRecoveryState =
  | AgentBridgeRecoveryState
  | ContinuationOfferState
  | ContinuationPendingState
  | ContinuationAttemptActionState;

export interface ContinuationStatusInput {
  isLoading: boolean;
  failed: boolean;
  status: AgentSessionContinuationStatusDto | null;
}

const uniqueById = (machines: readonly MachineDto[]): MachineDto[] => {
  const seen = new Set<string>();
  return machines.filter((machine) => {
    if (seen.has(machine.machineId)) return false;
    seen.add(machine.machineId);
    return true;
  });
};

const unavailableStateOf = (
  machine: MachineDto,
): AgentBridgeMachineUnavailableState | null =>
  classifyMachineExecutionReadiness(machine).selectable
    ? null
    : resolveMachineUnavailableState(machine);

const offer = (
  status: AgentSessionContinuationStatusDto & { boundMachineId: string },
  machines: readonly MachineDto[],
): ContinuationOfferState => {
  const candidates = uniqueById(machines).filter(
    (machine) => machine.machineId !== status.boundMachineId,
  );
  return {
    type: "continuation_offer",
    boundMachineId: status.boundMachineId,
    destinations: candidates.filter(
      (machine) => classifyMachineExecutionReadiness(machine).selectable,
    ),
    unavailable: candidates
      .map(unavailableStateOf)
      .filter(
        (state): state is AgentBridgeMachineUnavailableState => state !== null,
      ),
  };
};

const isContinuable = (
  status: AgentSessionContinuationStatusDto,
): status is AgentSessionContinuationStatusDto & { boundMachineId: string } =>
  status.boundMachineId !== null &&
  status.sourceState === AgentSessionContinuationSourceState.SourceRevoked;

const readyDestinationOf = (
  attempt: AgentSessionContinuationDto,
  machines: readonly MachineDto[],
): MachineDto | null => {
  const machine = machines.find(
    (candidate) => candidate.machineId === attempt.destinationMachineId,
  );
  return machine && classifyMachineExecutionReadiness(machine).selectable
    ? machine
    : null;
};

/** The durable attempt's own state, which outranks any new offer. */
const attemptState = (
  status: AgentSessionContinuationStatusDto,
  attempt: AgentSessionContinuationDto,
  machines: readonly MachineDto[],
): AgentSessionRecoveryState | null => {
  switch (attempt.state) {
    case AgentSessionContinuationState.Pending:
      return { type: "continuation_pending", continuation: attempt };
    case AgentSessionContinuationState.Uncertain:
      return {
        type: "continuation_uncertain",
        continuation: attempt,
        destination: readyDestinationOf(attempt, machines),
      };
    case AgentSessionContinuationState.Failed:
      return attempt.bindingMovedAt !== null &&
        attempt.bindingRevertedAt === null
        ? {
            type: "continuation_failed",
            continuation: attempt,
            destination: readyDestinationOf(attempt, machines),
          }
        : null;
    case AgentSessionContinuationState.AwaitingHistoryConfirmation:
      // Before its first delivery, the attempt is only actionable while the
      // session's computer is still the revoked one it was inspected against.
      if (
        attempt.bindingMovedAt === null &&
        (status.sourceState !==
          AgentSessionContinuationSourceState.SourceRevoked ||
          status.boundMachineId !== attempt.previousMachineId)
      ) {
        return null;
      }
      return {
        type: "continuation_confirm_history",
        continuation: attempt,
        destination: readyDestinationOf(attempt, machines),
      };
    default:
      return null;
  }
};

/**
 * Combines Agent Bridge readiness with the session's server-confirmed
 * continuation status. Only a revoked or removed binding offers continuation;
 * a missing inventory entry, failed status read or offline computer is not
 * evidence of removal, and unbound (pre-v2) sessions are never continued.
 */
export const resolveAgentSessionRecoveryState = (input: {
  base: AgentBridgeRecoveryState;
  machines: readonly MachineDto[];
  continuation: ContinuationStatusInput;
}): AgentSessionRecoveryState => {
  const { base, continuation } = input;
  if (base.type === "legacy_non_resumable") return base;

  const status = continuation.status;
  const fromAttempt = status?.attempt
    ? attemptState(status, status.attempt, input.machines)
    : null;
  if (fromAttempt) {
    return fromAttempt;
  }
  if (status && isContinuable(status)) {
    return offer(status, input.machines);
  }

  const bindingLooksGone =
    base.type === "bound_machine_missing" || base.type === "machine_revoked";
  if (!bindingLooksGone) return base;
  if (continuation.isLoading) return { type: "loading" };
  // The inventory disagrees with the server, or the server could not be read.
  return { type: "status_unavailable" };
};

import { describe, expect, it } from "vitest";
import {
  AgentSessionContinuationSourceState,
  AgentSessionContinuationState,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type AgentSessionContinuationDto,
  type AgentSessionContinuationStatusDto,
  type ConversationCliStatusResponseDto,
  type MachineDto,
} from "../../../api";
import { resolveAgentBridgeRecoveryState } from "../agentBridgeRecoveryState";
import { resolveAgentSessionRecoveryState } from "../agentSessionContinuationRecoveryState";

const REVOKED_ID = "11111111-1111-4111-8111-111111111111";

const machine = (
  name: string,
  executionReadiness: MachineDto["executionReadiness"] = MachineExecutionReadinessState.Ready,
): MachineDto => ({
  machineId: `machine-${name}`,
  name,
  pairedAt: "2026-11-01T00:00:00.000Z",
  active: executionReadiness !== MachineExecutionReadinessState.Disconnected,
  authorizationProtocolVersion: 2,
  executionReadiness,
  currentControllerEligibility:
    CurrentControllerMachineEligibilityState.Eligible,
});

const cliStatus = (
  executionReadiness: ConversationCliStatusResponseDto["executionReadiness"],
  selectedMachineId: string | null = REVOKED_ID,
): ConversationCliStatusResponseDto => ({
  connected: false,
  selectedMachineId,
  authorizationProtocolVersion: 2,
  executionReadiness,
});

const continuationStatus = (
  sourceState: AgentSessionContinuationStatusDto["sourceState"],
  boundMachineId: string | null = REVOKED_ID,
  attempt: AgentSessionContinuationDto | null = null,
): AgentSessionContinuationStatusDto => ({
  sourceState,
  boundMachineId:
    boundMachineId as AgentSessionContinuationStatusDto["boundMachineId"],
  attempt,
});

/** A durable attempt as the status endpoint returns it. */
const attemptOf = (
  overrides: Partial<AgentSessionContinuationDto>,
): AgentSessionContinuationDto =>
  ({
    continuationId: "33333333-3333-4333-8333-333333333333",
    agentSessionId: "44444444-4444-4444-8444-444444444444",
    previousMachineId: REVOKED_ID,
    destinationMachineId: "machine-Mac",
    state: AgentSessionContinuationState.Pending,
    nativeState: "USABLE",
    inspectionReason: "PROVIDER_STATE_PRESENT",
    mode: "NATIVE_RESUME",
    startRunInputs: { kind: "START_RUN", payload: {} },
    inspectedAt: "2026-11-17T00:00:00.000Z",
    historyConfirmedAt: null,
    nativeResumeRejectedAt: null,
    bindingMovedAt: "2026-11-17T00:00:01.000Z",
    bindingRevertedAt: null,
    deliveryGeneration: 1,
    deliveryOperationId: "55555555-5555-4555-8555-555555555555",
    deliveredAt: null,
    providerStartedAt: null,
    terminalAt: null,
    outcomeCode: null,
    ...overrides,
  }) as AgentSessionContinuationDto;

/** Resolves exactly as the conversation view does, from both server reads. */
const resolve = (input: {
  machines: MachineDto[];
  cli: ConversationCliStatusResponseDto;
  continuation: AgentSessionContinuationStatusDto | null;
  continuationFailed?: boolean;
}) =>
  resolveAgentSessionRecoveryState({
    base: resolveAgentBridgeRecoveryState({
      type: "bound_session",
      isLoading: false,
      machines: input.machines,
      status: input.cli,
    }),
    machines: input.machines,
    continuation: {
      isLoading: false,
      failed: input.continuationFailed ?? false,
      status: input.continuation,
    },
  });

describe("session continuation recovery state", () => {
  it("offers the sole ready computer when the bound computer was revoked or removed", () => {
    const mac = machine("Mac");
    const state = resolve({
      machines: [mac],
      cli: cliStatus(MachineExecutionReadinessState.MachineRevoked),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.SourceRevoked,
      ),
    });
    expect(state).toMatchObject({
      type: "continuation_offer",
      boundMachineId: REVOKED_ID,
      destinations: [mac],
      unavailable: [],
    });
  });

  it("offers every ready computer and shows unready ones with their own recovery", () => {
    const mac = machine("Mac");
    const mini = machine("Mini");
    const offline = machine(
      "Offline",
      MachineExecutionReadinessState.Disconnected,
    );
    const state = resolve({
      machines: [mac, mini, offline],
      cli: cliStatus(MachineExecutionReadinessState.MachineRevoked),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.SourceRevoked,
      ),
    });
    expect(state).toMatchObject({
      type: "continuation_offer",
      destinations: [mac, mini],
      unavailable: [{ type: "disconnected", machine: offline }],
    });
  });

  it("asks to pair a computer when none other is paired", () => {
    const state = resolve({
      machines: [],
      cli: cliStatus(MachineExecutionReadinessState.MachineRevoked),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.SourceRevoked,
      ),
    });
    expect(state).toMatchObject({
      type: "continuation_offer",
      destinations: [],
      unavailable: [],
    });
  });

  it("never offers takeover from an offline or still-paired computer", () => {
    const bound = {
      ...machine("Bound", MachineExecutionReadinessState.Disconnected),
      machineId: REVOKED_ID,
    };
    const other = machine("Other");
    const state = resolve({
      machines: [bound, other],
      cli: cliStatus(MachineExecutionReadinessState.Disconnected),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.BoundAvailable,
      ),
    });
    expect(state).toEqual({ type: "disconnected", machine: bound });
  });

  it("treats a missing inventory entry the server cannot confirm as unverifiable, not removed", () => {
    const state = resolve({
      machines: [machine("Other")],
      cli: cliStatus(MachineExecutionReadinessState.Ready),
      continuation: null,
      continuationFailed: true,
    });
    expect(state).toEqual({ type: "status_unavailable" });

    expect(
      resolve({
        machines: [machine("Other")],
        cli: cliStatus(MachineExecutionReadinessState.Ready),
        continuation: continuationStatus(
          AgentSessionContinuationSourceState.BoundAvailable,
        ),
      }),
    ).toEqual({ type: "status_unavailable" });
  });

  it("keeps an unbound (pre-v2) session out of continuation", () => {
    const state = resolve({
      machines: [machine("Mac")],
      cli: cliStatus(MachineExecutionReadinessState.NoMachineSelected, null),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.Unbound,
        null,
      ),
    });
    expect(state.type).not.toBe("continuation_offer");
  });

  it("after a failed delivery offers a retry on the attempt's own computer, not a new takeover", () => {
    const destination = machine("Mac");
    const other = machine("Mini");
    const attempt = attemptOf({
      state: AgentSessionContinuationState.Failed,
      outcomeCode: "CLI_OFFLINE",
    });
    const state = resolve({
      machines: [destination, other],
      cli: cliStatus(
        MachineExecutionReadinessState.Ready,
        destination.machineId,
      ),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.BoundAvailable,
        destination.machineId,
        attempt,
      ),
    });
    expect(state).toEqual({
      type: "continuation_failed",
      continuation: attempt,
      destination,
    });
  });

  it("keeps a failed committed attempt ahead of a new offer even when its computer is revoked too", () => {
    const attempt = attemptOf({
      state: AgentSessionContinuationState.Failed,
      outcomeCode: "CLI_OFFLINE",
    });
    const state = resolve({
      machines: [machine("Mini")],
      cli: cliStatus(
        MachineExecutionReadinessState.MachineRevoked,
        "machine-Mac",
      ),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.SourceRevoked,
        "machine-Mac",
        attempt,
      ),
    });
    expect(state).toMatchObject({
      type: "continuation_failed",
      destination: null,
    });
  });

  it("restores a durable saved-history confirmation after reload", () => {
    const destination = machine("Mac");
    const attempt = attemptOf({
      state: AgentSessionContinuationState.AwaitingHistoryConfirmation,
      mode: "SAVED_HISTORY",
      nativeState: "ABSENT",
      bindingMovedAt: null,
      deliveryGeneration: 0,
      deliveryOperationId: null,
    });
    const state = resolve({
      machines: [destination],
      cli: cliStatus(MachineExecutionReadinessState.MachineRevoked),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.SourceRevoked,
        REVOKED_ID,
        attempt,
      ),
    });
    expect(state).toEqual({
      type: "continuation_confirm_history",
      continuation: attempt,
      destination,
    });
  });

  it("ignores an undelivered confirmation once the session's computer changed", () => {
    const attempt = attemptOf({
      state: AgentSessionContinuationState.AwaitingHistoryConfirmation,
      mode: "SAVED_HISTORY",
      bindingMovedAt: null,
      deliveryGeneration: 0,
      deliveryOperationId: null,
    });
    const state = resolve({
      machines: [machine("Mac")],
      cli: cliStatus(MachineExecutionReadinessState.Ready, "machine-Mac"),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.BoundAvailable,
        "machine-Mac",
        attempt,
      ),
    });
    expect(state.type).toBe("ready");
  });

  it("shows an attempt with no startup report as uncertain, never as failed or as a new offer", () => {
    const destination = machine("Mac");
    const attempt = attemptOf({
      state: AgentSessionContinuationState.Uncertain,
      deliveredAt: "2026-11-17T00:00:02.000Z",
      outcomeCode: "STARTUP_ACKNOWLEDGEMENT_TIMEOUT",
    });
    const state = resolve({
      machines: [destination],
      cli: cliStatus(
        MachineExecutionReadinessState.Ready,
        destination.machineId,
      ),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.BoundAvailable,
        destination.machineId,
        attempt,
      ),
    });
    expect(state).toEqual({
      type: "continuation_uncertain",
      continuation: attempt,
      destination,
    });
  });

  it("holds the composer while a delivered attempt awaits provider startup, after reload", () => {
    const attempt = attemptOf({
      deliveredAt: "2026-11-17T00:00:02.000Z",
    });
    const state = resolve({
      machines: [machine("Mac")],
      cli: cliStatus(MachineExecutionReadinessState.Ready, "machine-Mac"),
      continuation: continuationStatus(
        AgentSessionContinuationSourceState.BoundAvailable,
        "machine-Mac",
        attempt,
      ),
    });
    expect(state).toEqual({
      type: "continuation_pending",
      continuation: attempt,
    });
  });
});

import { AgentLaunchStore, type AgentLaunchScope } from "./AgentLaunchStore";

import {
  beginOptimisticInput,
  confirmOptimisticInput,
  failOptimisticInput,
  removeOptimisticInput,
} from "../../../data/collections/optimisticConversationInputs";
import type { AgentOperationSnapshot } from "./agentOperationReducer";
import { reduceAgentOperation } from "./agentOperationReducer";
import type {
  ConversationStartRunRequestDto,
  CreateUserMessage,
  MachineDto,
} from "../../../api";
import { classifyMachineExecutionReadiness } from "../runtime/coding/machineExecutionReadiness";
import type { SubagentCommandIntent } from "../../SmarterTextAreaCard/slashCommands/subagentCommand";

declare const agentOperationIdBrand: unique symbol;
export type AgentOperationId = string & {
  readonly [agentOperationIdBrand]: "AgentOperationId";
};

export interface StartSessionInput {
  /** Durable caller-owned identity for recovering a previously prepared handoff. */
  readonly operationId?: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly machineId: string;
  readonly intent: Omit<
    ConversationStartRunRequestDto,
    | "agentSessionId"
    | "authorization"
    | "machineId"
    | "operationId"
    | "operationFingerprint"
  >;
}

export interface DirectTriggerInput {
  readonly operationId?: string;
  readonly organizationId: string;
  readonly projectId: string;
  readonly agentSessionId: string;
  readonly conversationId: string;
  readonly machineId: string;
  readonly intent: CreateUserMessage;
}

/** A browser `/subagent` request authorized on the source session's machine. */
export interface SubagentInteractionInput {
  readonly organizationId: string;
  readonly projectId: string;
  readonly agentSessionId: string;
  readonly runId: string;
  readonly interactionId: string;
  readonly intent: SubagentCommandIntent;
  /** Complete child Service set; an empty array requests graph-only work. */
  readonly serviceIds: string[];
  readonly onAccepted?: (interactionId: string) => void;
  readonly machine: MachineDto;
}

export type BoundStartSessionInput = Omit<StartSessionInput, "machineId">;
export type BoundDirectTriggerInput = Omit<DirectTriggerInput, "machineId">;
export type BoundSubagentInteractionInput = Omit<
  SubagentInteractionInput,
  "machine"
>;

export interface AgentSessionInteractions {
  startSession(input: BoundStartSessionInput): Promise<AgentOperationResult>;
  submitMessage(input: BoundDirectTriggerInput): Promise<AgentOperationResult>;
  requestSubagent(input: BoundSubagentInteractionInput): Promise<void>;
}

export type AgentSessionInteractionUnavailable =
  | { type: "inventory_loading"; message: string }
  | { type: "inventory_error"; message: string }
  | { type: "machine_not_selected"; message: string }
  | { type: "machine_unavailable"; message: string }
  | { type: "machine_not_ready"; message: string };

export type AgentSessionInteractionAccess =
  | {
      isDeviceEnabled: false;
      interactions: null;
      unavailable: AgentSessionInteractionUnavailable;
    }
  | {
      isDeviceEnabled: true;
      interactions: AgentSessionInteractions;
      unavailable: null;
    };

export type AgentOperationResult = Extract<
  AgentOperationSnapshot,
  { state: "accepted" | "succeeded" | "cancelled" | "denied" | "failed" }
>;

export interface PreparedAgentOperation<T> {
  operationId: AgentOperationId;
  fingerprint: string;
  input: T;
}

export interface AgentOperationDependencies {
  startSession(
    operation: PreparedAgentOperation<StartSessionInput>,
  ): Promise<AgentOperationSnapshot>;
  submitMessage(
    operation: PreparedAgentOperation<DirectTriggerInput>,
  ): Promise<AgentOperationSnapshot>;
  reconcile(operationId: AgentOperationId): Promise<AgentOperationSnapshot>;
  requestSubagent(input: SubagentInteractionInput): Promise<void>;
  fingerprintStart(input: StartSessionInput): Promise<string>;
  fingerprintMessage(input: DirectTriggerInput): Promise<string>;
}

export interface AgentOperationCoordinator {
  readonly launches: AgentLaunchStore;
  startSession(input: StartSessionInput): Promise<AgentOperationResult>;
  submitMessage(input: DirectTriggerInput): Promise<AgentOperationResult>;
  observe(operationId: AgentOperationId): AgentOperationSnapshot | null;
  reconcile(operationId: AgentOperationId): Promise<AgentOperationSnapshot>;
  accessForMachine(machine: MachineDto): AgentSessionInteractionAccess;
}

export class DefaultAgentOperationCoordinator implements AgentOperationCoordinator {
  readonly launches = new AgentLaunchStore();
  private readonly launchScopes = new Map<AgentOperationId, AgentLaunchScope>();

  private publish(
    operationId: AgentOperationId,
    snapshot: AgentOperationSnapshot,
  ) {
    this.snapshots.set(operationId, snapshot);
    const scope = this.launchScopes.get(operationId);
    if (scope) this.launches.record(scope, snapshot);
  }

  private readonly snapshots = new Map<
    AgentOperationId,
    AgentOperationSnapshot
  >();
  private readonly inFlight = new Map<
    AgentOperationId,
    Promise<AgentOperationResult>
  >();

  constructor(private readonly dependencies: AgentOperationDependencies) {}

  startSession(input: StartSessionInput): Promise<AgentOperationResult> {
    return this.begin("start_run", input, this.dependencies.startSession);
  }

  submitMessage(input: DirectTriggerInput): Promise<AgentOperationResult> {
    const operationId = (input.operationId ??
      crypto.randomUUID()) as AgentOperationId;
    beginOptimisticInput(operationId, input);
    return this.begin(
      "submit_message",
      input,
      this.dependencies.submitMessage,
      operationId,
    ).then(
      (result) => {
        // A definitive failure stays visible; only cancellation removes it.
        if (result.state === "accepted" && result.message)
          confirmOptimisticInput(operationId, result.message);
        else if (result.state === "denied" || result.state === "failed")
          failOptimisticInput(operationId, result.message);
        else if (result.state === "cancelled")
          removeOptimisticInput(operationId);
        return result;
      },
      (error) => {
        failOptimisticInput(
          operationId,
          error instanceof Error ? error.message : "Message could not be sent.",
        );
        throw error;
      },
    );
  }

  accessForMachine(machine: MachineDto): AgentSessionInteractionAccess {
    const readiness = classifyMachineExecutionReadiness(machine);
    if (!readiness.selectable) {
      return {
        isDeviceEnabled: false,
        interactions: null,
        unavailable: { type: "machine_not_ready", message: readiness.reason },
      };
    }

    const machineId = machine.machineId;
    return {
      isDeviceEnabled: true,
      interactions: {
        startSession: (input) => this.startSession({ ...input, machineId }),
        submitMessage: (input) => this.submitMessage({ ...input, machineId }),
        requestSubagent: (input) =>
          this.dependencies.requestSubagent({ ...input, machine }),
      },
      unavailable: null,
    };
  }

  observe(operationId: AgentOperationId): AgentOperationSnapshot | null {
    return this.snapshots.get(operationId) ?? null;
  }

  async reconcile(
    operationId: AgentOperationId,
  ): Promise<AgentOperationSnapshot> {
    const executing = this.inFlight.get(operationId);
    if (executing) return executing;
    const current = this.snapshots.get(operationId);
    if (
      current &&
      !["succeeded", "cancelled", "denied", "failed"].includes(current.state)
    ) {
      this.publish(
        operationId,
        reduceAgentOperation(current, {
          type: "ADVANCE",
          state: "reconciling",
        }),
      );
    }
    const snapshot = await this.dependencies.reconcile(operationId);
    this.publish(operationId, snapshot);
    return snapshot;
  }

  private begin<T extends StartSessionInput | DirectTriggerInput>(
    kind: "start_run" | "submit_message",
    input: T,
    execute: (
      operation: PreparedAgentOperation<T>,
    ) => Promise<AgentOperationSnapshot>,
    operationId = (input.operationId ??
      crypto.randomUUID()) as AgentOperationId,
  ): Promise<AgentOperationResult> {
    const executing = this.inFlight.get(operationId);
    if (executing) return executing;
    if (kind === "start_run") {
      this.launchScopes.set(operationId, input);
      this.launches.dispatching(input);
    }
    const promise = (async () => {
      const fingerprint =
        kind === "start_run"
          ? await this.dependencies.fingerprintStart(input as StartSessionInput)
          : await this.dependencies.fingerprintMessage(
              input as DirectTriggerInput,
            );
      this.publish(operationId, {
        operationId,
        kind,
        fingerprint,
        state: "created",
      });
      try {
        const snapshot = await execute({ operationId, fingerprint, input });
        this.publish(operationId, snapshot);
        return this.reconcilePreparedOperation(operationId, snapshot);
      } catch (error) {
        try {
          const reconciled = await this.dependencies.reconcile(operationId);
          return await this.reconcilePreparedOperation(operationId, reconciled);
        } catch {
          // The request may have failed before the API created the operation.
          // Preserve the original failure in that case.
        }
        const message =
          error instanceof Error ? error.message : "Agent operation failed.";
        const result: AgentOperationResult = /cancel/i.test(message)
          ? { operationId, kind, fingerprint, state: "cancelled" }
          : {
              operationId,
              kind,
              fingerprint,
              state: "failed",
              code: "OPERATION_FAILED",
              message,
            };
        this.publish(operationId, result);
        return result;
      }
    })().finally(() => this.inFlight.delete(operationId));
    this.inFlight.set(operationId, promise);
    return promise;
  }

  private async reconcilePreparedOperation(
    operationId: AgentOperationId,
    initial: AgentOperationSnapshot,
  ): Promise<AgentOperationResult> {
    let snapshot = initial;
    for (;;) {
      this.publish(operationId, snapshot);
      switch (snapshot.state) {
        case "accepted":
        case "succeeded":
        case "cancelled":
        case "denied":
        case "failed":
          return snapshot;
        case "created":
        case "resolving_authorization":
        case "awaiting_approval":
        case "submitting":
        case "dispatch_pending":
        case "reconciling":
          await new Promise<void>((resolve) => setTimeout(resolve, 500));
          try {
            snapshot = await this.dependencies.reconcile(operationId);
          } catch {
            // Once a dependency has returned a durable snapshot, a polling
            // outage cannot turn that committed operation into local failure.
            // Keep reconciling the same identity until the platform records a
            // terminal outcome.
            snapshot = reduceAgentOperation(snapshot, {
              type: "ADVANCE",
              state: "reconciling",
            });
          }
          break;
      }
    }
  }
}

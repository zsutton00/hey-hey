import type { RunStore } from '../run-store/run-store';
import type { ServerLogger } from '../server/logger';
import type {
  AgenticSession,
  ServiceScopeContinuation,
  ServiceScopeRequestPresentation,
} from '../session/types';
import type {
  InternalRunPromptRequest,
  SendMessageOptions,
} from '../shared/agent-bridge-contract/contract';
import type { AgentSessionServiceScopeRequest } from '../shared/api/generated/api';
import type { SystemMessageData } from '../shared/api/index';
import type { Turn } from '../turn/turn';

export type InputAdmission = NonNullable<SendMessageOptions['admittedInput']>;

export type InputSettlementEvidence = {
  turnId: string;
  terminalOutcome: 'COMPLETED' | 'FAILED' | 'ABORTED';
  completedAssistantMessageId: string | null;
  reports: string[];
  settledAt: string;
};

/** A paused Turn's input settlement, held until its continuation is abandoned. */
export interface HeldAdmission {
  admission: InputAdmission;
  evidence: InputSettlementEvidence;
}

export interface ServiceScopeRequestEntry {
  request: AgentSessionServiceScopeRequest;
  messageId: string;
  data: SystemMessageData | null;
}

type ApprovalWait = {
  kind: 'service_scope';
  requestId: string;
};

/** The only way `RunServiceScope` sees the Run that owns it. */
export interface RunServiceScopeDeps {
  runId: string;
  logger: ServerLogger;
  runStore: RunStore;
  session(): AgenticSession;
  patchSession(patch: Partial<AgenticSession>): void;
  hasProviderSession(): boolean;
  taskMonitorId(): string | null;
  activeTurn(): Pick<Turn, 'turnId'> | null;
  activeInput(): InternalRunPromptRequest | null;
  abortSignal(): AbortSignal | undefined;
  hasInputAdmission(input: InternalRunPromptRequest): boolean;
  /** Gathers the interrupted Turn's recoverable progress before the pause aborts it. */
  captureCheckpoint(turnId: string): ServiceScopeContinuation['checkpoint'];
  observeProviderPhase(phase: 'awaiting_approval' | 'starting' | 'idle'): void;
  /** A pending request was recorded or settled; the Run's read state may have changed. */
  readStateChanged(): void;
  /** A request settled; the Run may now accept durable input again. */
  requestSettled(): void;
  abort(): void;
  /** Enqueue the input and drain when the Run is idle. */
  resumeInput(input: InternalRunPromptRequest): void;
  /** Persist and report the held settlement, then forget the admission's projected start. */
  releaseHeldAdmission(held: HeldAdmission): Promise<void>;
  postAgentSystemMessage(text: string): Promise<void>;
}

/**
 * Service-scope request records, the approval pause they own, and the
 * interrupted work that resumes once the user approves.
 */
export class RunServiceScope {
  private readonly requests = new Map<string, ServiceScopeRequestEntry>();
  private readonly settledRequestIds = new Set<string>();
  private approvalWait: ApprovalWait | null = null;
  private automaticTaskMonitorScopeRequestId: string | null = null;
  private automaticTaskMonitorScopeAbortRequestId: string | null = null;
  private continuation: ServiceScopeContinuation | null = null;
  /**
   * A Turn paused for Service approval has not finished its durable input: the continuation
   * re-runs that same input. Its admission stays `started` until the continuation settles it,
   * or until the continuation is abandoned (denial or failed approval). The decision may land
   * before the paused Turn ends; `approved` records an approval the Turn's end must hand off.
   */
  private pausedTurn: { turnId: string; approved: boolean } | null = null;
  private heldAdmission: HeldAdmission | null = null;

  /**
   * Rehydrates persisted request presentations, the pending approval wait and
   * the continuation. Beginning the wait publishes `awaiting_approval`, so the
   * Run's phase owners must exist before this runs.
   */
  constructor(private readonly deps: RunServiceScopeDeps) {
    const session = deps.session();
    const persistedPresentations = session.serviceScopeRequestPresentations ?? [];
    for (const presentation of persistedPresentations) {
      this.requests.set(presentation.request.id, {
        request: presentation.request,
        messageId: presentation.messageId,
        data: null,
      });
    }
    const persistedRequest = persistedPresentations[0]?.request;
    if (persistedRequest) {
      this.beginApprovalWait({ kind: 'service_scope', requestId: persistedRequest.id });
      deps.logger.info('local.run.service_scope.approval_wait.rehydrated', {
        runId: deps.runId,
        requestId: persistedRequest.id,
      });
    }
    this.continuation =
      session.serviceScopeContinuation ??
      (session.serviceScopeContinuationInput
        ? {
            input: session.serviceScopeContinuationInput,
            checkpoint: {
              completedActions: [],
              discoveries: [],
              toolResults: [],
              changedFiles: [],
              nextAction: null,
            },
            delivery: 'pending',
            interruptedTurnId: 'legacy-persisted-turn',
            capturedAt: session.updatedAt,
          }
        : null);
  }

  public findPendingServiceScopeRequest(
    currentServiceIds: readonly string[],
    requestedServiceIds: readonly string[],
    reason: string,
  ): AgentSessionServiceScopeRequest | null {
    const same = (left: readonly string[], right: readonly string[]): boolean =>
      left.length === right.length && left.every((value, index) => value === right[index]);
    for (const entry of this.requests.values()) {
      if (
        entry.request.reason === reason &&
        same(entry.request.currentServiceIds, currentServiceIds) &&
        same(entry.request.requestedServiceIds, requestedServiceIds)
      ) {
        return entry.request;
      }
    }
    return null;
  }

  public getServiceScopeRequest(requestId: string): ServiceScopeRequestEntry | undefined {
    const entry = this.requests.get(requestId);
    return entry
      ? { request: entry.request, messageId: entry.messageId, data: entry.data }
      : undefined;
  }

  public isServiceScopeRequestSettled(requestId: string): boolean {
    return this.settledRequestIds.has(requestId);
  }

  public hasPendingServiceScopeRequest(): boolean {
    return this.requests.size > 0;
  }

  public hasServiceScopeRequestRecord(requestId: string): boolean {
    return this.requests.has(requestId) || this.isServiceScopeRequestSettled(requestId);
  }

  /** True while any approval request owns the Run's pause. */
  public isWaitingForApproval(): boolean {
    return this.approvalWait !== null;
  }

  /**
   * True only while the exact pending Service-scope request owns the Run's
   * approval pause. Provider runners use this to distinguish the deliberate
   * abort that enters approval from a user cancellation or provider failure.
   */
  public isServiceScopeApprovalPauseActive(): boolean {
    return (
      this.approvalWait?.kind === 'service_scope' && this.requests.has(this.approvalWait.requestId)
    );
  }

  /**
   * Consume the deliberate abort for a Service-scope transition. Automatic
   * resolution and provider shutdown race after the signal fires, so the abort
   * correlation marker is independent from request settlement state.
   */
  public consumeExpectedServiceScopeTurnAbort(signal: AbortSignal): boolean {
    if (this.deps.abortSignal() !== signal || !signal.aborted) return false;
    if (this.isServiceScopeApprovalPauseActive()) return true;

    const requestId = this.automaticTaskMonitorScopeAbortRequestId;
    if (requestId === null) return false;
    this.automaticTaskMonitorScopeAbortRequestId = null;
    this.deps.logger.info('local.run.task_monitor_scope.automatic_abort.consumed', {
      runId: this.deps.runId,
      requestId,
      taskMonitorId: this.deps.taskMonitorId(),
    });
    return true;
  }

  public recordServiceScopeRequest(
    request: AgentSessionServiceScopeRequest,
    messageId: string,
    data: SystemMessageData,
  ): void {
    this.settledRequestIds.delete(request.id);
    this.requests.set(request.id, { request, messageId, data });
    this.deps.readStateChanged();
    const presentations: ServiceScopeRequestPresentation[] = [
      ...(this.deps.session().serviceScopeRequestPresentations ?? []).filter(
        (presentation) => presentation.request.id !== request.id,
      ),
      { request, messageId },
    ];
    this.deps.patchSession({ serviceScopeRequestPresentations: presentations });
    void this.deps.runStore
      .updateRunServiceScopeRequestPresentations(this.deps.runId, presentations)
      .catch((error) =>
        this.deps.logger.error('local.run.service_scope.presentations.persist_failed', {
          runId: this.deps.runId,
          requestId: request.id,
          error,
        }),
      );
  }

  public settleServiceScopeRequest(requestId: string): void {
    this.requests.delete(requestId);
    this.settledRequestIds.add(requestId);
    this.deps.readStateChanged();
    const presentations = (this.deps.session().serviceScopeRequestPresentations ?? []).filter(
      (presentation) => presentation.request.id !== requestId,
    );
    this.deps.patchSession({ serviceScopeRequestPresentations: presentations });
    void this.deps.runStore
      .updateRunServiceScopeRequestPresentations(this.deps.runId, presentations)
      .catch((error) =>
        this.deps.logger.error('local.run.service_scope.presentations.settle_failed', {
          runId: this.deps.runId,
          requestId,
          error,
        }),
      );
    this.deps.requestSettled();
  }

  public async pauseForServiceScopeRequest(
    requestId: string,
    resolution: 'automatic' | 'human' = 'human',
  ): Promise<void> {
    const activeInput = this.deps.activeInput();
    const activeTurn = this.deps.activeTurn();
    if (!activeInput || !activeTurn) {
      if (!this.continuation) {
        if (resolution === 'automatic') {
          this.automaticTaskMonitorScopeRequestId = requestId;
          this.automaticTaskMonitorScopeAbortRequestId = requestId;
          this.deps.abort();
          return;
        }
        throw new Error('Service-scope pause requires an active Turn continuation.');
      }
      await this.deps.runStore.updateRunServiceScopeContinuation(
        this.deps.runId,
        this.continuation,
      );
      this.deps.patchSession({ serviceScopeContinuation: this.continuation });
      if (resolution === 'human') {
        this.beginApprovalWait({ kind: 'service_scope', requestId });
      } else {
        this.automaticTaskMonitorScopeRequestId = requestId;
        this.automaticTaskMonitorScopeAbortRequestId = requestId;
      }
      this.deps.abort();
      return;
    }
    const continuation = {
      input: activeInput,
      delivery: 'pending' as const,
      interruptedTurnId: activeTurn.turnId,
      capturedAt: new Date().toISOString(),
      checkpoint: this.deps.captureCheckpoint(activeTurn.turnId),
    } satisfies ServiceScopeContinuation;
    this.deps.logger.info('local.run.service_scope.continuation.interrupted_turn_captured', {
      runId: this.deps.runId,
      requestId,
      interruptedTurnId: activeTurn.turnId,
    });
    try {
      await this.deps.runStore.updateRunServiceScopeContinuation(this.deps.runId, continuation);
      this.continuation = continuation;
      this.deps.patchSession({ serviceScopeContinuation: continuation });
      if (this.deps.hasInputAdmission(activeInput))
        this.pausedTurn = { turnId: activeTurn.turnId, approved: false };
    } catch (error) {
      this.deps.logger.error('local.run.service_scope.continuation.persist_failed', {
        runId: this.deps.runId,
        error,
      });
      throw error;
    }
    if (resolution === 'human') {
      this.beginApprovalWait({ kind: 'service_scope', requestId });
    } else {
      this.automaticTaskMonitorScopeRequestId = requestId;
      this.automaticTaskMonitorScopeAbortRequestId = requestId;
      this.deps.logger.info('local.run.service_scope.automatic_resolution.started', {
        runId: this.deps.runId,
        requestId,
        taskMonitorId: this.deps.taskMonitorId(),
      });
    }
    this.deps.abort();
  }

  public settleServiceScopeApprovalWait(
    requestId: string,
    nextPhase: 'starting' | 'idle',
  ): boolean {
    if (this.automaticTaskMonitorScopeRequestId === requestId) {
      this.automaticTaskMonitorScopeRequestId = null;
      this.deps.observeProviderPhase(nextPhase);
      this.deps.logger.info('local.run.service_scope.automatic_resolution.settled', {
        runId: this.deps.runId,
        requestId,
        nextPhase,
      });
      return true;
    }
    if (this.approvalWait?.kind !== 'service_scope' || this.approvalWait.requestId !== requestId) {
      this.deps.logger.debug('local.run.service_scope.approval_wait.settle_skipped', {
        runId: this.deps.runId,
        requestId,
        activeRequestId: this.approvalWait?.requestId ?? null,
        nextPhase,
      });
      return false;
    }
    this.approvalWait = null;
    this.deps.observeProviderPhase(nextPhase);
    this.deps.logger.info('local.run.service_scope.approval_wait.settled', {
      runId: this.deps.runId,
      requestId,
      nextPhase,
    });
    return true;
  }

  private beginApprovalWait(wait: ApprovalWait): void {
    if (
      this.approvalWait !== null &&
      (this.approvalWait.kind !== wait.kind || this.approvalWait.requestId !== wait.requestId)
    ) {
      throw new Error('A different approval request already owns the Run pause.');
    }
    this.approvalWait = wait;
    this.deps.observeProviderPhase('awaiting_approval');
    this.deps.logger.info('local.run.service_scope.approval_wait.started', {
      runId: this.deps.runId,
      requestId: wait.requestId,
    });
  }

  /**
   * Decides what happens to an ending Turn's input settlement. A Turn paused
   * for Service approval hands its input to an already-approved continuation,
   * or holds the settlement until the decision arrives; any other Turn's
   * input settles now.
   */
  public settleTurnInput(
    turnId: string,
    admission: InputAdmission | null,
    evidence: InputSettlementEvidence,
  ): 'settle-now' | 'handed-to-continuation' | 'held' {
    const pause = this.pausedTurn?.turnId === turnId ? this.pausedTurn : null;
    if (pause) this.pausedTurn = null;
    if (!pause || !admission) return 'settle-now';
    if (pause.approved) return 'handed-to-continuation';
    this.heldAdmission = { admission, evidence };
    return 'held';
  }

  /** Abandons the continuation; the input it would have re-run settles with the paused Turn's outcome. */
  public async clearServiceScopeContinuation(): Promise<void> {
    await this.forgetServiceScopeContinuation();
    // A paused Turn that has not ended yet settles its own input when it does.
    this.pausedTurn = null;
    const held = this.heldAdmission;
    if (!held) return;
    this.heldAdmission = null;
    await this.deps.releaseHeldAdmission(held);
  }

  private async forgetServiceScopeContinuation(): Promise<void> {
    try {
      await this.deps.runStore.updateRunServiceScopeContinuation(this.deps.runId, null);
    } catch (error) {
      this.deps.logger.error('local.run.service_scope.continuation.clear_failed', {
        runId: this.deps.runId,
        error,
      });
      throw error;
    }
    this.continuation = null;
    this.deps.patchSession({
      serviceScopeContinuation: undefined,
      serviceScopeContinuationInput: undefined,
    });
  }

  public hasServiceScopeContinuation(): boolean {
    return this.continuation?.delivery === 'pending';
  }

  /** The continuation a freshly minted provider session must deliver, if any. */
  public pendingRecovery(): ServiceScopeContinuation | null {
    return !this.deps.hasProviderSession() && this.continuation?.delivery === 'pending'
      ? this.continuation
      : null;
  }

  public async resumeAfterServiceScopeApproval(): Promise<void> {
    const continuation = this.continuation;
    if (!continuation || continuation.delivery !== 'pending') return;
    if (this.deps.hasProviderSession()) await this.forgetServiceScopeContinuation();
    // The continuation Turn owns the held admission from here: it is already started, and
    // the continuation's own end settles it.
    this.heldAdmission = null;
    if (this.pausedTurn) this.pausedTurn.approved = true;
    this.deps.resumeInput(continuation.input);
  }

  public async completeServiceScopeRecoveryDelivery(
    expected: ServiceScopeContinuation,
  ): Promise<void> {
    if (this.continuation !== expected || expected.delivery !== 'pending') return;
    const delivered = { ...expected, delivery: 'delivered' as const };
    await this.deps.runStore.updateRunServiceScopeContinuation(this.deps.runId, delivered);
    this.continuation = delivered;
    this.deps.patchSession({ serviceScopeContinuation: delivered });
    await this.deps.postAgentSystemMessage(
      'Service scope was expanded. The provider session was replaced, and execution continued once from the saved interrupted-work checkpoint.',
    );
  }

  /**
   * A restart ended the admission a pending Service-scope continuation was holding open, so the
   * continuation no longer runs as that admission. It continues as Run-owned recovery work.
   */
  public async detachRecoveredContinuation(admissionTurnId: string): Promise<void> {
    const continuation = this.continuation;
    if (continuation?.input.inputAdmissionTurnId !== admissionTurnId) return;
    const { inputAdmissionTurnId: _settled, ...input } = continuation.input;
    const detached = { ...continuation, input };
    await this.deps.runStore.updateRunServiceScopeContinuation(this.deps.runId, detached);
    this.continuation = detached;
    this.deps.patchSession({ serviceScopeContinuation: detached });
    this.deps.logger.info('local.run.service_scope.continuation.admission_detached', {
      runId: this.deps.runId,
      admissionTurnId,
      delivery: continuation.delivery,
    });
  }
}

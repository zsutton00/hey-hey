import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentOperationKind as PrismaAgentOperationKind,
  AgentOperationState as PrismaAgentOperationState,
  type AgentSessionContinuation as ContinuationRow,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import {
  AgentSessionContinuationMode,
  AgentSessionContinuationNativeState,
  AgentSessionContinuationSourceState,
  AgentSessionContinuationState,
  AgentTriggerStartRun,
  HostActionTargetKind,
  HostAffectingActionType,
  MachineExecutionReadinessState,
  MessageStatus,
  type AgentSessionContinuationDto,
  type AgentSessionContinuationInspectionReason,
  type AgentSessionContinuationStartupReport,
  type AgentSessionContinuationStartupReportResponseDto,
  type AgentSessionContinuationStatusDto,
  type CliReadAgentSessionContinuationInspectResult,
  type CommitAgentSessionContinuationRequestDto,
  type ControllerStartInputs,
  type InspectAgentSessionContinuationRequestDto,
  type StartRunPromptPayload,
  type SystemMessageData,
} from '@hey-hey/contracts/api/models';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import {
  AgentSessionId,
  ConversationId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import { CliReadEmitter } from '../../core/websockets/cli-read-emitter.service';
import { ExecutionGrantService } from '../controller-authorization/execution-grant.service';
import { MachineExecutionReadinessService } from '../machine-pairing/machine-execution-readiness.service';
import { AgentOperationRegistryService } from '../agent-operation/agent-operation-registry.service';
import { AgentOperationSubmissionService } from '../agent-operation/agent-operation-submission.service';
import { AgentSessionService } from '../agent-session.service';
import type { AuthenticatedMachine } from '../machine-pairing/machine-pairing.service';
import { startupTransition } from './continuation-startup';

interface SessionScope {
  organizationId: OrganizationId;
  projectId: ProjectId;
  userId: UserId;
  agentSessionId: AgentSessionId;
}

interface OwnedSession {
  id: string;
  userId: string;
  machineId: string | null;
  conversationId: string | null;
  provider: string | null;
}

type Delivery = Pick<
  Prisma.AgentOperationGetPayload<object>,
  'state' | 'failureCode' | 'failureMessage' | 'terminalAt'
>;

/** Committed attempts that still own the binding and await resolution. */
const UNRESOLVED_COMMITTED_STATES: readonly string[] = [
  AgentSessionContinuationState.AwaitingHistoryConfirmation,
  AgentSessionContinuationState.Pending,
  AgentSessionContinuationState.Uncertain,
  AgentSessionContinuationState.Failed,
];

/** Attempts whose delivery is in flight or done; commit replays them. */
const DELIVERED_STATES: readonly string[] = [
  AgentSessionContinuationState.Pending,
  AgentSessionContinuationState.Succeeded,
];

/** Attempts a startup report may still resolve. */
const AWAITING_STARTUP_STATES: readonly string[] = [
  AgentSessionContinuationState.Pending,
  AgentSessionContinuationState.Uncertain,
];

/**
 * How long after the destination received a delivery the platform waits for
 * its startup report before the outcome is uncertain. Startup includes
 * reading saved history and one bounded provider call.
 */
export const STARTUP_ACKNOWLEDGEMENT_TIMEOUT_MS = 3 * 60_000;

/**
 * States in which no provider session has started for the attempt, so the
 * person may decline it.
 */
const CANCELLABLE_STATES: readonly string[] = [
  AgentSessionContinuationState.Inspected,
  AgentSessionContinuationState.AwaitingHistoryConfirmation,
  AgentSessionContinuationState.Failed,
];

const DELIVERY_FAILED_STATES: readonly PrismaAgentOperationState[] = [
  PrismaAgentOperationState.FAILED,
  PrismaAgentOperationState.DENIED,
  PrismaAgentOperationState.CANCELLED,
];

const MAX_OUTCOME_DETAIL = 500;

const sha256 = (value: unknown): string =>
  createHash('sha256').update(canonicalizeJcs(value)).digest('hex');

function conflict(code: string, message: string): never {
  throw new ConflictException({ code, message });
}

/**
 * Continues one Agent Session on another paired computer after its bound
 * computer was revoked or removed. Inspection and delivery each run under the
 * destination's own controller authorization; continuation moves routing only.
 */
@Injectable()
export class AgentSessionContinuationService {
  private readonly logger = new Logger(AgentSessionContinuationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly grants: ExecutionGrantService,
    private readonly emitter: CliReadEmitter,
    private readonly readiness: MachineExecutionReadinessService,
    private readonly registry: AgentOperationRegistryService,
    private readonly submission: AgentOperationSubmissionService,
    private readonly agentSessions: AgentSessionService,
  ) {}

  async getStatus(
    scope: SessionScope,
  ): Promise<AgentSessionContinuationStatusDto> {
    const session = await this.loadOwnedSession(scope);
    const attempt =
      (await this.unresolvedCommittedAttempt(session.id)) ??
      (await this.latestAttempt(session.id));
    const current = attempt
      ? await this.reconcileDelivery(attempt, scope)
      : null;
    return {
      sourceState: await this.resolveSourceState(this.prisma.db, session),
      boundMachineId: session.machineId as MachineId | null,
      attempt: current ? this.toDto(current) : null,
    };
  }

  async inspect(
    scope: SessionScope & {
      continuationId: string;
      request: InspectAgentSessionContinuationRequestDto;
      controllerBindingSecret: string | undefined;
    },
  ): Promise<AgentSessionContinuationDto> {
    const { request } = scope;
    const session = await this.loadOwnedSession(scope);
    const inputFingerprint = sha256({
      agentSessionId: session.id,
      expectedSourceMachineId: request.expectedSourceMachineId,
      destinationMachineId: request.destinationMachineId,
    });

    const recorded = await this.findRecorded(scope.continuationId, session.id);
    if (recorded) {
      if (recorded.inputFingerprint !== inputFingerprint) {
        this.log('inspect_rejected', scope, { code: 'INPUT_MISMATCH' });
        conflict(
          'CONTINUATION_INPUT_MISMATCH',
          'This continuation was already inspected with different input.',
        );
      }
      return this.toDto(recorded);
    }

    if (!session.conversationId || !session.provider) {
      this.log('inspect_rejected', scope, { code: 'NOT_RESUMABLE' });
      conflict(
        'CONTINUATION_NOT_RESUMABLE',
        'This session has no conversation or provider to continue.',
      );
    }
    // A committed attempt that still owns the binding is resolved by retrying
    // it, never hidden behind a newer inspection.
    if (await this.unresolvedCommittedAttempt(session.id)) {
      this.log('inspect_rejected', scope, { code: 'ATTEMPT_UNRESOLVED' });
      conflict(
        'CONTINUATION_ATTEMPT_UNRESOLVED',
        'An earlier continuation of this session is still unresolved.',
      );
    }
    if (session.machineId !== request.expectedSourceMachineId) {
      this.log('inspect_rejected', scope, { code: 'BINDING_CHANGED' });
      conflict(
        'CONTINUATION_BINDING_CHANGED',
        "The session's computer changed. Refresh and try again.",
      );
    }
    const sourceState = await this.resolveSourceState(this.prisma.db, session);
    this.assertDestinationAllowed(
      sourceState,
      session.machineId,
      request.destinationMachineId,
      scope,
    );
    await this.assertDestinationReady(scope, request.destinationMachineId);
    const start = await this.originalStartPayload(scope, session.id);

    const admission = await this.grants.assertContinuationInspectionAuthorized({
      authorization: request.authorization,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      userId: scope.userId,
      machineId: request.destinationMachineId as MachineId,
      controllerBindingSecret: scope.controllerBindingSecret,
      agentSessionId: session.id,
      continuationId: scope.continuationId,
      expectedSourceMachineId: request.expectedSourceMachineId,
    });
    this.log('inspect_authorized', scope, {
      destinationMachineId: request.destinationMachineId,
    });

    const response = await this.emitter.readAgentSessionContinuation({
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      machineId: request.destinationMachineId as MachineId,
      userId: scope.userId,
      agentSessionId: session.id,
      conversationId: session.conversationId,
      continuationId: scope.continuationId,
      expectedSourceMachineId: request.expectedSourceMachineId,
      provider: session.provider,
      authorizationRequestId: admission.action.requestId,
      admission: {
        authorizationId: admission.authorizationId,
        envelopeAuthorization: admission.envelopeAuthorization,
        actionPayloadHash: sha256(admission.action),
      },
    });
    if (response.status === 'error') {
      this.log('inspect_failed', scope, { code: response.error.code });
      throw new BadGatewayException({
        code: `CONTINUATION_INSPECTION_${response.error.code}`,
        message: 'The destination computer could not be inspected.',
      });
    }
    if (response.operation !== 'agent_session.continuation.inspect') {
      throw new BadGatewayException({
        code: 'CONTINUATION_INSPECTION_UNEXPECTED_RESPONSE',
        message: 'The destination returned an unexpected inspection result.',
      });
    }
    const result = response.result;
    this.assertInspectionCorrelates(result, scope.continuationId, session.id);

    const mode =
      result.nativeState === AgentSessionContinuationNativeState.Usable
        ? AgentSessionContinuationMode.NativeResume
        : AgentSessionContinuationMode.SavedHistory;
    const startRunInputs = await this.continuationStartInputs(
      scope,
      start,
      scope.continuationId,
      mode,
    );
    this.log('inspected', scope, {
      destinationMachineId: request.destinationMachineId,
      nativeState: result.nativeState,
      reason: result.reason,
      mode,
    });

    const row = await this.insertInspection({
      id: scope.continuationId,
      agentSessionId: session.id,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      userId: scope.userId,
      previousMachineId: request.expectedSourceMachineId,
      destinationMachineId: request.destinationMachineId,
      state:
        mode === AgentSessionContinuationMode.NativeResume
          ? AgentSessionContinuationState.Inspected
          : AgentSessionContinuationState.AwaitingHistoryConfirmation,
      nativeState: result.nativeState,
      inspectionReason: result.reason,
      mode,
      inputFingerprint,
      startRunInputs: startRunInputs as unknown as Prisma.InputJsonValue,
      inspectedAt: new Date(),
    });
    if (row.inputFingerprint !== inputFingerprint) {
      conflict(
        'CONTINUATION_INPUT_MISMATCH',
        'This continuation was already inspected with different input.',
      );
    }
    return this.toDto(row);
  }

  /**
   * Delivers the attempt to its destination. The first delivery rebinds the
   * session; a retry of a FAILED attempt is a new delivery generation to the
   * same destination and never rebinds again. A pending or finished attempt
   * is returned unchanged.
   */
  async commit(
    scope: SessionScope & {
      continuationId: string;
      request: CommitAgentSessionContinuationRequestDto;
      controllerBindingSecret: string | undefined;
    },
  ): Promise<AgentSessionContinuationDto> {
    const session = await this.loadOwnedSession(scope);
    const recorded = await this.findRecorded(scope.continuationId, session.id);
    if (!recorded) {
      throw new NotFoundException('Continuation not found');
    }
    const row = await this.reconcileDelivery(recorded, scope);
    if (DELIVERED_STATES.includes(row.state)) {
      this.log('commit_replayed', scope, { state: row.state });
      return this.toDto(row);
    }
    if (row.state === AgentSessionContinuationState.Cancelled) {
      this.log('commit_rejected', scope, { code: 'CANCELLED' });
      conflict(
        'CONTINUATION_CANCELLED',
        'This continuation was cancelled. Start a new one.',
      );
    }
    const confirmsHistory =
      row.mode === AgentSessionContinuationMode.SavedHistory &&
      (row.historyConfirmedAt !== null || scope.request.confirmSavedHistory);
    if (
      row.mode === AgentSessionContinuationMode.SavedHistory &&
      !confirmsHistory
    ) {
      this.log('commit_rejected', scope, { code: 'HISTORY_NOT_CONFIRMED' });
      conflict(
        'CONTINUATION_SAVED_HISTORY_CONFIRMATION_REQUIRED',
        'Continuing with saved history starts a new agent session and must be confirmed.',
      );
    }

    const conversationId = session.conversationId as ConversationId;
    const inputs = row.startRunInputs as unknown as ControllerStartInputs;
    const admission = await this.grants.assertInteractiveAuthorized({
      authorization: scope.request.authorization,
      inputs,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      userId: scope.userId,
      controllerBindingSecret: scope.controllerBindingSecret,
      actionType: HostAffectingActionType.ConversationTrigger,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: session.id,
      conversationId,
      agentSessionId: session.id as AgentSessionId,
      machineId: row.destinationMachineId as MachineId,
    });
    if (admission.machineId !== row.destinationMachineId) {
      this.log('commit_rejected', scope, { code: 'DESTINATION_MISMATCH' });
      throw new ForbiddenException(
        'The authorization is for a different computer.',
      );
    }

    const delivery = {
      generation: row.deliveryGeneration + 1,
      operationId: randomUUID(),
    };
    const fingerprint = sha256({
      continuationId: row.id,
      generation: delivery.generation,
      inputs,
    });
    const begun = await this.registry.begin({
      operationId: delivery.operationId,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      userId: scope.userId,
      agentSessionId: session.id as AgentSessionId,
      conversationId,
      kind: PrismaAgentOperationKind.START_RUN,
      fingerprint,
    });

    try {
      await this.registry.recordAuthorization(
        delivery.operationId,
        begun.executionOwner,
        admission.authorizationId,
        admission.envelopeAuthorization.kind,
      );
      const reserved = this.registry.reservedMessageIds(begun.operation);
      const trigger: AgentTriggerStartRun = {
        promptType: AgentTriggerStartRun.PromptTypeEnum.StartRun,
        operationId: delivery.operationId,
        operationFingerprint: fingerprint,
        triggerMessageId: reserved.triggerMessageId,
        payload: inputs.payload,
      };
      await this.submission.submitPrepared({
        operationId: delivery.operationId,
        operationFingerprint: fingerprint,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
        agentSessionId: session.id as AgentSessionId,
        conversationId,
        kind: PrismaAgentOperationKind.START_RUN,
        admission,
        executionOwner: begun.executionOwner,
        triggerMessage: {
          id: reserved.triggerMessageId as MessageId,
          type: 'SYSTEM',
          conversationId,
          projectId: scope.projectId,
          status: MessageStatus.Completed,
          data: {
            type: 'AGENT',
            triggersAgent: trigger,
          } satisfies SystemMessageData,
        },
        beforeSubmissionInTx: (tx) =>
          this.beginDeliveryInTransaction(tx, {
            attempt: row,
            delivery,
            confirmsHistory,
            scope,
          }),
      });
    } catch (error) {
      const code =
        error instanceof ConflictException
          ? ((error.getResponse() as { code?: string }).code ??
            'CONTINUATION_COMMIT_CONFLICT')
          : 'CONTINUATION_COMMIT_FAILED';
      this.log('commit_failed', scope, {
        code,
        deliveryGeneration: delivery.generation,
        deliveryOperationId: delivery.operationId,
        detail: error instanceof Error ? error.message : String(error),
      });
      await this.registry.fail(
        delivery.operationId,
        begun.executionOwner,
        code,
        error instanceof Error ? error.message : 'Continuation commit failed',
      );
      throw error;
    }

    this.log('delivery_submitted', scope, {
      previousMachineId: row.previousMachineId,
      destinationMachineId: row.destinationMachineId,
      mode: row.mode,
      deliveryGeneration: delivery.generation,
      deliveryOperationId: delivery.operationId,
      retry: row.bindingMovedAt !== null,
    });
    const submitted = await this.findRecorded(row.id, session.id);
    return this.toDto(submitted!);
  }

  /**
   * Declines an attempt. Before delivery nothing has moved. After a delivery
   * that started no provider session (FAILED, or awaiting history after a
   * rejected resume), the binding returns to the previous computer, but only
   * while this attempt still owns it, so the person can continue elsewhere.
   */
  async cancel(
    scope: SessionScope & { continuationId: string },
  ): Promise<AgentSessionContinuationDto> {
    const session = await this.loadOwnedSession(scope);
    const recorded = await this.findRecorded(scope.continuationId, session.id);
    if (!recorded) {
      throw new NotFoundException('Continuation not found');
    }
    if (recorded.state === AgentSessionContinuationState.Cancelled) {
      return this.toDto(recorded);
    }
    if (!CANCELLABLE_STATES.includes(recorded.state)) {
      this.log('cancel_rejected', scope, { state: recorded.state });
      conflict(
        'CONTINUATION_NOT_CANCELLABLE',
        'This continuation may already be running and cannot be cancelled.',
      );
    }

    await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${recorded.agentSessionId}, 0))`;
      const now = new Date();
      const reverts = recorded.bindingMovedAt !== null;
      if (reverts) {
        const released = await tx.agentSession.updateMany({
          where: {
            id: session.id,
            machineId: recorded.destinationMachineId,
          },
          data: { machineId: recorded.previousMachineId },
        });
        if (released.count === 0) {
          this.log('cancel_rejected', scope, { code: 'BINDING_CHANGED' });
          conflict(
            'CONTINUATION_BINDING_CHANGED',
            "The session's computer changed. Refresh and try again.",
          );
        }
      }
      const cancelled = await tx.agentSessionContinuation.updateMany({
        where: {
          id: recorded.id,
          deliveryGeneration: recorded.deliveryGeneration,
          state: recorded.state,
        },
        data: {
          state: AgentSessionContinuationState.Cancelled,
          terminalAt: now,
          ...(reverts ? { bindingRevertedAt: now } : {}),
        },
      });
      if (cancelled.count === 0) {
        this.log('cancel_rejected', scope, { code: 'ATTEMPT_CHANGED' });
        conflict(
          'CONTINUATION_ATTEMPT_CHANGED',
          'This continuation changed. Refresh and try again.',
        );
      }
      this.log('cancelled', scope, {
        continuationId: recorded.id,
        fromState: recorded.state,
        bindingReverted: reverts,
        ...(reverts
          ? {
              previousMachineId: recorded.previousMachineId,
              destinationMachineId: recorded.destinationMachineId,
            }
          : {}),
      });
    });
    const current = await this.findRecorded(recorded.id, session.id);
    return this.toDto(current!);
  }

  /**
   * Runs inside the delivery submission transaction, before its binding
   * check. The first delivery re-validates eligibility against locked rows and
   * moves the binding; a retry requires the binding this attempt set to still
   * stand. Either way the attempt advances only from the generation it was
   * read at, so concurrent retries cannot both deliver.
   */
  private async beginDeliveryInTransaction(
    tx: AnyTransactionClient,
    params: {
      attempt: ContinuationRow;
      delivery: { generation: number; operationId: string };
      confirmsHistory: boolean;
      scope: SessionScope;
    },
  ): Promise<void> {
    const { attempt, delivery, scope } = params;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${attempt.agentSessionId}, 0))`;
    const session = await tx.agentSession.findFirst({
      where: {
        id: attempt.agentSessionId,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
      },
      select: {
        id: true,
        userId: true,
        machineId: true,
        conversationId: true,
        provider: true,
      },
    });
    if (!session) {
      throw new NotFoundException('Agent session not found');
    }

    const isFirstDelivery = attempt.bindingMovedAt === null;
    const expectedBinding = isFirstDelivery
      ? attempt.previousMachineId
      : attempt.destinationMachineId;
    if (session.machineId !== expectedBinding) {
      this.log('delivery_rejected', scope, {
        code: 'BINDING_CHANGED',
        isFirstDelivery,
      });
      conflict(
        'CONTINUATION_BINDING_CHANGED',
        "The session's computer changed. Refresh and try again.",
      );
    }
    if (isFirstDelivery) {
      const sourceState = await this.resolveSourceState(tx, session);
      this.assertDestinationAllowed(
        sourceState,
        session.machineId,
        attempt.destinationMachineId,
        scope,
      );
    }
    const destination = await tx.machine.findFirst({
      where: {
        id: attempt.destinationMachineId,
        userId: session.userId,
        revokedAt: null,
        OR: [
          { organizationId: scope.organizationId },
          { organizationId: null },
        ],
      },
      select: { id: true },
    });
    if (!destination) {
      this.log('delivery_rejected', scope, { code: 'DESTINATION_UNAVAILABLE' });
      conflict(
        'CONTINUATION_DESTINATION_UNAVAILABLE',
        'The destination computer is no longer paired.',
      );
    }

    const now = new Date();
    const advanced = await tx.agentSessionContinuation.updateMany({
      where: {
        id: attempt.id,
        deliveryGeneration: attempt.deliveryGeneration,
        state: attempt.state,
      },
      data: {
        state: AgentSessionContinuationState.Pending,
        deliveryGeneration: delivery.generation,
        deliveryOperationId: delivery.operationId,
        deliveredAt: null,
        outcomeCode: null,
        outcomeDetail: null,
        ...(isFirstDelivery ? { bindingMovedAt: now } : {}),
        ...(params.confirmsHistory && attempt.historyConfirmedAt === null
          ? { historyConfirmedAt: now }
          : {}),
      },
    });
    if (advanced.count === 0) {
      this.log('delivery_rejected', scope, { code: 'ATTEMPT_CHANGED' });
      conflict(
        'CONTINUATION_ATTEMPT_CHANGED',
        'This continuation changed while it was being delivered. Refresh and try again.',
      );
    }
    if (isFirstDelivery) {
      await tx.agentSession.update({
        where: { id: session.id },
        data: { machineId: attempt.destinationMachineId },
      });
      this.log('binding_moved', scope, {
        previousMachineId: attempt.previousMachineId,
        destinationMachineId: attempt.destinationMachineId,
      });
    }
  }

  /**
   * Folds what the platform can observe about the latest delivery into a
   * PENDING attempt. Receipt is recorded but is not provider startup; a failed
   * delivery makes the attempt FAILED with its safe cause; a receipt with no
   * startup report within the acknowledgement window makes it UNCERTAIN.
   * Updates are conditioned on the generation, so an outcome for an older
   * delivery never overwrites a newer one.
   */
  private async reconcileDelivery(
    row: ContinuationRow,
    scope: SessionScope,
  ): Promise<ContinuationRow> {
    if (
      row.state !== AgentSessionContinuationState.Pending ||
      row.deliveryOperationId === null
    ) {
      return row;
    }
    const delivery = await this.deliveryOf(row.deliveryOperationId);
    if (!delivery) {
      return row;
    }
    const change = this.observedDeliveryChange(row, delivery);
    if (!change) {
      return row;
    }

    const updated = await this.prisma.db.agentSessionContinuation.updateMany({
      where: {
        id: row.id,
        state: AgentSessionContinuationState.Pending,
        deliveryGeneration: row.deliveryGeneration,
      },
      data: change.data,
    });
    if (updated.count > 0) {
      this.log(change.event, scope, {
        continuationId: row.id,
        deliveryGeneration: row.deliveryGeneration,
        deliveryOperationId: row.deliveryOperationId,
        deliveryState: delivery.state,
        ...(change.data.outcomeCode ? { code: change.data.outcomeCode } : {}),
      });
    }
    const current = await this.prisma.db.agentSessionContinuation.findUnique({
      where: { id: row.id },
    });
    return current ?? row;
  }

  private observedDeliveryChange(
    row: ContinuationRow,
    delivery: Delivery,
  ): {
    event: string;
    data: Prisma.AgentSessionContinuationUpdateManyMutationInput;
  } | null {
    if (DELIVERY_FAILED_STATES.includes(delivery.state)) {
      return {
        event: 'delivery_failed',
        data: {
          state: AgentSessionContinuationState.Failed,
          outcomeCode: delivery.failureCode ?? `DELIVERY_${delivery.state}`,
          outcomeDetail:
            delivery.failureMessage?.slice(0, MAX_OUTCOME_DETAIL) ?? null,
        },
      };
    }
    if (delivery.state !== PrismaAgentOperationState.SUCCEEDED) {
      return null;
    }
    const receivedAt = row.deliveredAt ?? delivery.terminalAt ?? new Date();
    const waitedMs = Date.now() - receivedAt.getTime();
    if (waitedMs > STARTUP_ACKNOWLEDGEMENT_TIMEOUT_MS) {
      return {
        event: 'startup_uncertain',
        data: {
          state: AgentSessionContinuationState.Uncertain,
          deliveredAt: receivedAt,
          outcomeCode: 'STARTUP_ACKNOWLEDGEMENT_TIMEOUT',
          outcomeDetail: `No startup report within ${Math.round(waitedMs / 1000)}s of delivery.`,
        },
      };
    }
    if (row.deliveredAt !== null) {
      return null;
    }
    return { event: 'delivery_received', data: { deliveredAt: receivedAt } };
  }

  /**
   * Applies the destination's provider-startup report. Only the attempt's
   * destination computer reaches the row, and only a report for the latest
   * delivery of a PENDING or UNCERTAIN attempt changes anything. A late
   * report may resolve UNCERTAIN, which is the point of waiting for it.
   */
  async recordStartup(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    agentSessionId: AgentSessionId;
    continuationId: string;
    machine: AuthenticatedMachine;
    report: AgentSessionContinuationStartupReport;
  }): Promise<AgentSessionContinuationStartupReportResponseDto> {
    const { report } = params;
    const scope: SessionScope = {
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.machine.userId,
      agentSessionId: params.agentSessionId,
    };
    const row = await this.prisma.db.agentSessionContinuation.findFirst({
      where: {
        id: params.continuationId,
        agentSessionId: params.agentSessionId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.machine.userId,
        destinationMachineId: params.machine.machineId,
      },
    });
    // Another computer's or account's continuation is indistinguishable from a missing one.
    if (!row) {
      this.log('startup_report_unknown', scope, {
        continuationId: params.continuationId,
        machineId: params.machine.machineId,
      });
      throw new NotFoundException('Continuation not found');
    }

    const outcome = startupTransition(row, report);
    if (outcome.kind === 'replay') {
      return {
        accepted: true,
        state: row.state as AgentSessionContinuationState,
      };
    }
    if (outcome.kind === 'ignored') {
      this.log('startup_report_ignored', scope, {
        continuationId: row.id,
        reason: outcome.reason,
        state: row.state,
        reportedOperationId: report.deliveryOperationId,
        currentOperationId: row.deliveryOperationId,
        outcome: report.outcome,
      });
      return {
        accepted: false,
        state: row.state as AgentSessionContinuationState,
      };
    }

    const now = new Date();
    const updated = await this.prisma.db.agentSessionContinuation.updateMany({
      where: {
        id: row.id,
        state: { in: [...AWAITING_STARTUP_STATES] },
        deliveryOperationId: report.deliveryOperationId,
      },
      data: {
        ...outcome.data(now, row),
        deliveredAt: row.deliveredAt ?? now,
      },
    });
    const current =
      await this.prisma.db.agentSessionContinuation.findUniqueOrThrow({
        where: { id: row.id },
      });
    if (updated.count === 0) {
      this.log('startup_report_raced', scope, {
        continuationId: row.id,
        state: current.state,
      });
      return {
        accepted: false,
        state: current.state as AgentSessionContinuationState,
      };
    }
    this.log('startup_reported', scope, {
      continuationId: row.id,
      deliveryGeneration: row.deliveryGeneration,
      deliveryOperationId: report.deliveryOperationId,
      outcome: report.outcome,
      previousState: row.state,
      state: current.state,
      ...(report.reasonCode ? { code: report.reasonCode } : {}),
    });
    return {
      accepted: true,
      state: current.state as AgentSessionContinuationState,
    };
  }

  private assertDestinationAllowed(
    sourceState: AgentSessionContinuationSourceState,
    boundMachineId: string | null,
    destinationMachineId: string,
    scope: SessionScope,
  ): void {
    const allowed =
      sourceState === AgentSessionContinuationSourceState.SourceRevoked &&
      destinationMachineId !== boundMachineId;
    if (allowed) {
      return;
    }
    this.log('ineligible', scope, { sourceState });
    conflict(
      'CONTINUATION_NOT_ELIGIBLE',
      sourceState === AgentSessionContinuationSourceState.Unbound
        ? 'This session was never bound to a computer and cannot be continued.'
        : sourceState === AgentSessionContinuationSourceState.BoundAvailable
          ? "The session's computer is still paired; it keeps this session."
          : 'This computer cannot continue this session.',
    );
  }

  private async assertDestinationReady(
    scope: SessionScope,
    destinationMachineId: string,
  ): Promise<void> {
    const readiness = await this.readiness.resolve({
      machineId: destinationMachineId as MachineId,
      userId: scope.userId,
      organizationId: scope.organizationId,
    });
    if (
      readiness?.executionReadiness === MachineExecutionReadinessState.Ready
    ) {
      return;
    }
    // A missing row and a foreign machine are indistinguishable here.
    this.log('destination_not_ready', scope, {
      readiness: readiness?.executionReadiness ?? 'UNAVAILABLE',
    });
    throw new ForbiddenException({
      code: 'CONTINUATION_DESTINATION_NOT_READY',
      message: 'The selected computer is not ready to continue this session.',
    });
  }

  private assertInspectionCorrelates(
    result: CliReadAgentSessionContinuationInspectResult,
    continuationId: string,
    agentSessionId: string,
  ): void {
    if (
      result.continuationId === continuationId &&
      result.agentSessionId === agentSessionId
    ) {
      return;
    }
    throw new BadGatewayException({
      code: 'CONTINUATION_INSPECTION_UNCORRELATED',
      message: 'The destination answered for a different continuation.',
    });
  }

  private async resolveSourceState(
    db: AnyTransactionClient,
    session: OwnedSession,
  ): Promise<AgentSessionContinuationSourceState> {
    if (!session.machineId) {
      return AgentSessionContinuationSourceState.Unbound;
    }
    const machine = await db.machine.findUnique({
      where: { id: session.machineId },
      select: { revokedAt: true },
    });
    if (!machine || machine.revokedAt) {
      return AgentSessionContinuationSourceState.SourceRevoked;
    }
    return AgentSessionContinuationSourceState.BoundAvailable;
  }

  /** The session's own first start recipe; continuation never invents one. */
  private async originalStartPayload(
    scope: SessionScope,
    agentSessionId: string,
  ): Promise<StartRunPromptPayload> {
    const operations = await this.prisma.db.agentOperation.findMany({
      where: {
        agentSessionId,
        kind: PrismaAgentOperationKind.START_RUN,
        triggerMessageId: { not: null },
      },
      orderBy: { createdAt: 'asc' },
      select: { triggerMessage: { select: { data: true } } },
    });
    for (const operation of operations) {
      const data = operation.triggerMessage?.data as SystemMessageData | null;
      const trigger = data?.triggersAgent;
      if (
        trigger?.promptType === 'start_run' &&
        trigger.payload.continuation === undefined
      ) {
        return trigger.payload;
      }
    }
    this.log('inspect_rejected', scope, { code: 'START_RECIPE_UNAVAILABLE' });
    return conflict(
      'CONTINUATION_START_RECIPE_UNAVAILABLE',
      'This session has no recorded start to continue from.',
    );
  }

  /**
   * Materialize-only start for the destination: the same Run identity and
   * resolved configuration, with no first Turn, no kickoff replay and no
   * staged local material from the previous computer.
   */
  private async continuationStartInputs(
    scope: SessionScope,
    original: StartRunPromptPayload,
    continuationId: string,
    mode: AgentSessionContinuationMode,
  ): Promise<ControllerStartInputs> {
    const {
      runId: _runId,
      stagedBrowserTab: _stagedBrowserTab,
      attachments: _attachments,
      ...recipe
    } = original;
    const isWorkflowArm = recipe.workflowName !== undefined;
    const { payload: _kickoff, ...bindOnly } = recipe;
    const base = isWorkflowArm ? bindOnly : recipe;
    const config = await this.agentSessions.resolveStartRunConfiguration({
      organizationId: scope.organizationId,
      agentSessionId: original.agentSessionId,
      taskMonitorId: original.contextMetadata.taskMonitorId,
      config: original.config,
    });
    return {
      kind: 'START_RUN',
      payload: {
        ...base,
        ...(config !== undefined ? { config } : {}),
        triggersAgent: false,
        continuation: { continuationId, mode },
      },
    };
  }

  private async insertInspection(
    data: Prisma.AgentSessionContinuationUncheckedCreateInput,
  ): Promise<ContinuationRow> {
    try {
      return await this.prisma.db.agentSessionContinuation.create({ data });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing =
          await this.prisma.db.agentSessionContinuation.findUnique({
            where: { id: data.id },
          });
        if (existing && existing.agentSessionId === data.agentSessionId) {
          return existing;
        }
        conflict(
          'CONTINUATION_INPUT_MISMATCH',
          'This continuation identity is already in use.',
        );
      }
      throw error;
    }
  }

  private async loadOwnedSession(scope: SessionScope): Promise<OwnedSession> {
    const session = await this.prisma.db.agentSession.findFirst({
      where: {
        id: scope.agentSessionId,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        userId: scope.userId,
      },
      select: {
        id: true,
        userId: true,
        machineId: true,
        conversationId: true,
        provider: true,
      },
    });
    // Another account's session is indistinguishable from a missing one.
    if (!session) throw new NotFoundException('Agent session not found');
    return session;
  }

  private findRecorded(
    continuationId: string,
    agentSessionId: string,
  ): Promise<ContinuationRow | null> {
    return this.prisma.db.agentSessionContinuation.findFirst({
      where: { id: continuationId, agentSessionId },
    });
  }

  private unresolvedCommittedAttempt(
    agentSessionId: string,
  ): Promise<ContinuationRow | null> {
    return this.prisma.db.agentSessionContinuation.findFirst({
      where: {
        agentSessionId,
        bindingMovedAt: { not: null },
        bindingRevertedAt: null,
        state: { in: [...UNRESOLVED_COMMITTED_STATES] },
      },
    });
  }

  private latestAttempt(
    agentSessionId: string,
  ): Promise<ContinuationRow | null> {
    return this.prisma.db.agentSessionContinuation.findFirst({
      where: { agentSessionId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  private deliveryOf(operationId: string): Promise<Delivery | null> {
    return this.prisma.db.agentOperation.findUnique({
      where: { operationId },
      select: {
        state: true,
        failureCode: true,
        failureMessage: true,
        terminalAt: true,
      },
    });
  }

  private toDto(row: ContinuationRow): AgentSessionContinuationDto {
    const iso = (value: Date | null): string | null =>
      value?.toISOString() ?? null;
    return {
      continuationId: row.id,
      agentSessionId: row.agentSessionId,
      previousMachineId: row.previousMachineId as MachineId,
      destinationMachineId: row.destinationMachineId as MachineId,
      state: row.state as AgentSessionContinuationState,
      nativeState: row.nativeState as AgentSessionContinuationNativeState,
      inspectionReason:
        row.inspectionReason as AgentSessionContinuationInspectionReason,
      mode: row.mode as AgentSessionContinuationMode,
      startRunInputs: row.startRunInputs as unknown as ControllerStartInputs,
      inspectedAt: row.inspectedAt.toISOString(),
      historyConfirmedAt: iso(row.historyConfirmedAt),
      nativeResumeRejectedAt: iso(row.nativeResumeRejectedAt),
      bindingMovedAt: iso(row.bindingMovedAt),
      bindingRevertedAt: iso(row.bindingRevertedAt),
      deliveryGeneration: row.deliveryGeneration,
      deliveryOperationId: row.deliveryOperationId,
      deliveredAt: iso(row.deliveredAt),
      providerStartedAt: iso(row.providerStartedAt),
      terminalAt: iso(row.terminalAt),
      outcomeCode: row.outcomeCode,
    };
  }

  private log(
    event: string,
    scope: SessionScope,
    detail: Record<string, unknown>,
  ): void {
    this.logger.log(`agent_session.continuation.${event}`, {
      agentSessionId: scope.agentSessionId,
      organizationId: scope.organizationId,
      projectId: scope.projectId,
      ...detail,
    });
  }
}

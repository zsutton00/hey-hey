import {
  forwardRef,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import {
  AgentOperationDispatchState,
  AgentOperationKind,
  AgentOperationState,
  Prisma,
} from '@prisma/client';
import {
  AgentOperationDispatchAcceptedAcknowledgement,
  BoundedGrantReference,
  ControllerAssertionEvidence,
  ExecutableEnvelopeAuthorization,
} from '../../generated';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import { TriggerEmitter } from './trigger-emitter.service';
import {
  AgentSessionId,
  ConversationId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
} from '../../types';
import { toAdmittedAuthorizationKind } from '../../services/agent-operation/agent-operation-authorization-kind';
import { MessageService } from '../../services/message.service';
import { failProjectReportStartRunInTransaction } from '../../services/project-reports/project-report-attempt-transitions';
import { ApiMetricsService } from '../metrics/api-metrics.service';
import type { DispatchQueueWakeSource } from '../metrics/api-metrics.constants';

const CLAIM_LEASE_MS = 15_000;
const MAX_RETRY_DELAY_MS = 30_000;
type ClaimedDispatch = Prisma.AgentOperationDispatchGetPayload<{
  include: { operation: true };
}>;

@Injectable()
export class AgentOperationDispatchService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AgentOperationDispatchService.name);
  private readonly workerId = crypto.randomUUID();
  private timer: ReturnType<typeof setInterval> | undefined;
  private nudgePromise: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => TriggerEmitter))
    private readonly triggerEmitter: TriggerEmitter,
    private readonly metrics: ApiMetricsService,
    @Inject(forwardRef(() => MessageService))
    private readonly messages: MessageService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.dispatchOne(), 1_000);
    void this.dispatchOne();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  nudge(): void {
    if (!this.nudgePromise) {
      this.nudgePromise = this.dispatchOneMatching({}, 'sweep')
        .then(() => undefined)
        .finally(() => {
          this.nudgePromise = undefined;
        });
    }
  }

  async nudgeForOperation(operationId: string): Promise<boolean> {
    return this.dispatchOneMatching({ operationId }, 'submission');
  }

  async nudgeForMachine(machineId: string): Promise<boolean> {
    const now = new Date();
    const awakened = await this.prisma.db.agentOperationDispatch.updateMany({
      where: {
        machineId,
        state: AgentOperationDispatchState.PENDING,
        nextAttemptAt: { gt: now },
      },
      data: { nextAttemptAt: now },
    });
    this.logger.debug('[AgentOperationDispatchService] machine ready', {
      machineId,
      awakened: awakened.count,
    });
    let claimed = false;
    while (await this.dispatchOneMatching({ machineId }, 'machine')) {
      claimed = true;
      // Drain every currently eligible obligation for this machine. Rows
      // released with backoff are no longer eligible for this pass.
    }
    return claimed;
  }

  async dispatchOne(): Promise<void> {
    await this.dispatchOneMatching({}, 'sweep');
  }

  private async dispatchOneMatching(
    selector: Prisma.AgentOperationDispatchWhereInput,
    wakeSource: DispatchQueueWakeSource,
  ): Promise<boolean> {
    const dispatch = await this.claimNextEligible(selector, wakeSource);
    if (!dispatch) return false;
    const startedAt = Date.now();

    try {
      this.assertExactBinding(dispatch);
      const authorizationKind = toAdmittedAuthorizationKind(
        dispatch.authorizationKind,
      );
      const envelopeAuthorization =
        authorizationKind === BoundedGrantReference.KindEnum.BoundedGrant
          ? ({
              kind: BoundedGrantReference.KindEnum.BoundedGrant,
              grantId: dispatch.grantId,
            } satisfies ExecutableEnvelopeAuthorization)
          : undefined;
      const result = await this.triggerEmitter.emitConversationTriggerWithAck({
        conversationId: dispatch.operation.conversationId as ConversationId,
        messageId: dispatch.triggerMessageId as MessageId,
        organizationId: dispatch.operation.organizationId as OrganizationId,
        projectId: dispatch.operation.projectId as ProjectId,
        machineId: dispatch.machineId as MachineId,
        agentSessionId: dispatch.operation.agentSessionId as AgentSessionId,
        authorizationId: dispatch.authorizationId,
        grantId: dispatch.grantId,
        envelopeAuthorization,
        preferPersistedActivation:
          authorizationKind ===
          ControllerAssertionEvidence.KindEnum.ControllerAssertion,
        timeoutMs: 4_000,
      });

      if (result.acknowledged) {
        const transition = await this.markAcknowledged(
          dispatch,
          result.acknowledgement,
        );
        this.recordAttempt(
          transition === 'acknowledged'
            ? 'acknowledged'
            : transition === 'binding_contradiction'
              ? 'terminal_failure'
              : 'claim_lost',
          transition === 'acknowledged'
            ? 'accepted'
            : transition === 'binding_contradiction'
              ? 'binding_contradiction'
              : 'lease_lost',
          startedAt,
        );
        if (transition === 'acknowledged') {
          this.metrics.recordTerminalOutcome('acknowledged', 'accepted');
        } else if (transition === 'binding_contradiction') {
          this.metrics.recordTerminalOutcome(
            'terminal_failure',
            'binding_contradiction',
          );
        }
        return true;
      }

      if (this.isRetryable(result.reason)) {
        const released = await this.releaseForRetry(
          dispatch,
          result.reason ?? 'transport_failure',
        );
        if (released === null) return true;
        this.recordAttempt(
          released ? 'retry_scheduled' : 'claim_lost',
          released
            ? this.metrics.normalizeDeliveryReason(result.reason)
            : 'lease_lost',
          startedAt,
        );
        return true;
      }

      const cliRejected = result.reason?.startsWith('cli_rejected') ?? false;
      const transition = await this.markRejected(
        dispatch,
        result.reason ?? 'dispatch_rejected',
        cliRejected ? AgentOperationState.DENIED : AgentOperationState.FAILED,
      );
      const outcome =
        transition === 'claim_lost'
          ? 'claim_lost'
          : transition === 'binding_contradiction'
            ? 'terminal_failure'
            : cliRejected
              ? 'denied'
              : 'terminal_failure';
      const reason =
        transition === 'claim_lost'
          ? 'lease_lost'
          : transition === 'binding_contradiction'
            ? 'binding_contradiction'
            : this.metrics.normalizeDeliveryReason(result.reason);
      this.recordAttempt(outcome, reason, startedAt);
      if (transition !== 'claim_lost') {
        this.metrics.recordTerminalOutcome(
          transition === 'binding_contradiction'
            ? 'terminal_failure'
            : cliRejected
              ? 'denied'
              : 'terminal_failure',
          reason,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('DISPATCH_BINDING_CONTRADICTION')) {
        const transition = await this.markRejected(
          dispatch,
          'DISPATCH_BINDING_CONTRADICTION',
          AgentOperationState.FAILED,
        );
        this.recordAttempt(
          transition === 'claim_lost' ? 'claim_lost' : 'terminal_failure',
          transition === 'claim_lost' ? 'lease_lost' : 'binding_contradiction',
          startedAt,
        );
        if (transition !== 'claim_lost') {
          this.metrics.recordTerminalOutcome(
            'terminal_failure',
            'binding_contradiction',
          );
        }
        return true;
      }
      const released = await this.releaseForRetry(
        dispatch,
        'transport_exception',
      );
      if (released === null) return true;
      this.recordAttempt(
        released ? 'retry_scheduled' : 'claim_lost',
        released ? 'transport_exception' : 'lease_lost',
        startedAt,
      );
      this.logger.warn(
        '[AgentOperationDispatchService] retryable delivery failure',
        {
          operationId: dispatch.operationId,
          machineId: dispatch.machineId,
          error: message,
        },
      );
    }
    return true;
  }

  private async claimNextEligible(
    selector: Prisma.AgentOperationDispatchWhereInput,
    wakeSource: DispatchQueueWakeSource,
  ): Promise<ClaimedDispatch | null> {
    const now = new Date();
    const eligibility: Prisma.AgentOperationDispatchWhereInput = {
      OR: [
        {
          state: AgentOperationDispatchState.PENDING,
          nextAttemptAt: { lte: now },
        },
        {
          state: AgentOperationDispatchState.CLAIMED,
          claimExpiresAt: { lt: now },
        },
      ],
    };
    const candidate = await this.prisma.db.agentOperationDispatch.findFirst({
      where: { AND: [selector, eligibility] },
      orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      include: { operation: true },
    });
    if (!candidate) return null;

    const claimed = await this.prisma.db.agentOperationDispatch.updateMany({
      where: {
        operationId: candidate.operationId,
        AND: [selector, eligibility],
      },
      data: {
        state: AgentOperationDispatchState.CLAIMED,
        claimOwner: this.workerId,
        claimExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
        attemptCount: { increment: 1 },
        lastAttemptAt: now,
      },
    });
    if (claimed.count !== 1) return null;
    if (
      candidate.state === AgentOperationDispatchState.CLAIMED &&
      candidate.claimExpiresAt &&
      candidate.claimExpiresAt < now
    ) {
      this.metrics.recordExpiredClaimRecovery();
    }

    const dispatch = await this.prisma.db.agentOperationDispatch.findUnique({
      where: { operationId: candidate.operationId },
      include: { operation: true },
    });
    if (dispatch?.attemptCount === 1) {
      const queueWaitMs = Math.max(
        0,
        Date.now() - dispatch.createdAt.getTime(),
      );
      this.metrics.recordDispatchQueueWait(wakeSource, queueWaitMs / 1000);
      this.logger.log(
        '[AgentOperationDispatchService] first dispatch attempt',
        {
          operationId: dispatch.operationId,
          queueWaitMs,
          wakeSource,
        },
      );
    }
    return dispatch;
  }

  private assertExactBinding(dispatch: ClaimedDispatch): void {
    const operation = dispatch.operation;
    if (
      operation.state !== AgentOperationState.DISPATCH_PENDING ||
      operation.authorizationId !== dispatch.authorizationId ||
      !operation.authorizationKind ||
      operation.authorizationKind !== dispatch.authorizationKind ||
      operation.grantId !== dispatch.grantId ||
      operation.triggerMessageId !== dispatch.triggerMessageId
    ) {
      throw new Error(
        'DISPATCH_BINDING_CONTRADICTION: operation correlation changed',
      );
    }
  }

  private async markAcknowledged(
    dispatch: ClaimedDispatch,
    accepted: AgentOperationDispatchAcceptedAcknowledgement,
  ): Promise<'acknowledged' | 'binding_contradiction' | 'claim_lost'> {
    const acknowledgedAt = new Date();
    const acknowledgement = { ...accepted } satisfies Prisma.InputJsonObject;
    const marked = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.agentOperationDispatch.updateMany({
        where: {
          operationId: dispatch.operationId,
          state: AgentOperationDispatchState.CLAIMED,
          claimOwner: this.workerId,
        },
        data: {
          state: AgentOperationDispatchState.ACKNOWLEDGED,
          acknowledgement,
          acknowledgedAt,
          terminalAt: acknowledgedAt,
          claimOwner: null,
          claimExpiresAt: null,
        },
      });
      if (updated.count !== 1) return 'claim_lost' as const;
      const previousResult =
        dispatch.operation.result &&
        typeof dispatch.operation.result === 'object' &&
        !Array.isArray(dispatch.operation.result)
          ? dispatch.operation.result
          : {};
      const operationUpdated = await tx.agentOperation.updateMany({
        where: {
          operationId: dispatch.operationId,
          state: AgentOperationState.DISPATCH_PENDING,
          authorizationId: dispatch.authorizationId,
          authorizationKind: dispatch.authorizationKind,
          grantId: dispatch.grantId,
          triggerMessageId: dispatch.triggerMessageId,
        },
        data: {
          state: AgentOperationState.SUCCEEDED,
          result: { ...previousResult, dispatched: true, acknowledgement },
          terminalAt: new Date(),
          executionOwner: null,
          executionLeaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (operationUpdated.count !== 1) {
        const contradicted = await tx.agentOperation.updateMany({
          where: {
            operationId: dispatch.operationId,
            state: AgentOperationState.DISPATCH_PENDING,
          },
          data: {
            state: AgentOperationState.FAILED,
            failureCode: 'DISPATCH_BINDING_CONTRADICTION',
            failureMessage:
              'The durable operation has a terminal dispatch contradiction.',
            result: previousResult,
            terminalAt: new Date(),
            executionOwner: null,
            executionLeaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (contradicted.count === 1) {
          await this.terminalizeStartRun(
            tx,
            dispatch,
            AgentOperationState.FAILED,
          );
        }
        return 'binding_contradiction' as const;
      }
      const disposition = accepted.inputDisposition;
      if (disposition !== 'NONE') {
        // Write-once: a replayed acceptance carries the recorded disposition and never rewrites it.
        await tx.message.updateMany({
          where: {
            executionOperationId: dispatch.operationId,
            executionAdmissionDisposition: null,
          },
          data: { executionAdmissionDisposition: disposition },
        });
      }
      return 'acknowledged' as const;
    });
    if (marked === 'acknowledged') {
      this.metrics.recordDispatchCommitToAck(
        Math.max(0, acknowledgedAt.getTime() - dispatch.createdAt.getTime()) /
          1000,
      );
    }
    if (marked !== 'claim_lost') {
      this.logger.log(
        '[AgentOperationDispatchService] operation acknowledged',
        {
          operationId: dispatch.operationId,
          machineId: dispatch.machineId,
        },
      );
    }
    return marked;
  }

  private async markRejected(
    dispatch: ClaimedDispatch,
    failureCode: string,
    operationState: AgentOperationState,
  ): Promise<'rejected' | 'binding_contradiction' | 'claim_lost'> {
    const marked = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.agentOperationDispatch.updateMany({
        where: {
          operationId: dispatch.operationId,
          state: AgentOperationDispatchState.CLAIMED,
          claimOwner: this.workerId,
        },
        data: {
          state: AgentOperationDispatchState.REJECTED,
          lastFailureCode: failureCode,
          terminalAt: new Date(),
          claimOwner: null,
          claimExpiresAt: null,
        },
      });
      if (updated.count !== 1) return 'claim_lost' as const;
      const failedMessages = await tx.message.findMany({
        where: {
          executionOperationId: dispatch.operationId,
          executionStatus: 'queued',
        },
        select: { id: true },
      });
      await tx.message.updateMany({
        where: {
          executionOperationId: dispatch.operationId,
          executionStatus: 'queued',
        },
        data: {
          executionStatus: 'failed',
          executionCancellationRequested: false,
        },
      });

      for (const message of failedMessages) {
        await this.messages.publishMessageUpdatedEvent(tx, {
          messageId: message.id as MessageId,
          organizationId: dispatch.operation.organizationId as OrganizationId,
          projectId: dispatch.operation.projectId as ProjectId,
          conversationId: dispatch.operation.conversationId as ConversationId,
          update: {},
        });
      }

      const previousResult =
        dispatch.operation.result &&
        typeof dispatch.operation.result === 'object' &&
        !Array.isArray(dispatch.operation.result)
          ? dispatch.operation.result
          : {};
      const operationUpdated = await tx.agentOperation.updateMany({
        where: {
          operationId: dispatch.operationId,
          state: AgentOperationState.DISPATCH_PENDING,
          authorizationId: dispatch.authorizationId,
          authorizationKind: dispatch.authorizationKind,
          grantId: dispatch.grantId,
          triggerMessageId: dispatch.triggerMessageId,
        },
        data: {
          state: operationState,
          failureCode,
          failureMessage:
            operationState === AgentOperationState.DENIED
              ? 'The paired CLI rejected the durable operation.'
              : failureCode === 'START_RUN_GRANT_EXPIRED'
                ? 'The execution grant expired before the run was delivered.'
                : 'The durable operation has a terminal dispatch contradiction.',
          result: previousResult,
          terminalAt: new Date(),
          executionOwner: null,
          executionLeaseExpiresAt: null,
          version: { increment: 1 },
        },
      });
      if (operationUpdated.count !== 1) {
        const contradicted = await tx.agentOperation.updateMany({
          where: {
            operationId: dispatch.operationId,
            state: AgentOperationState.DISPATCH_PENDING,
          },
          data: {
            state: AgentOperationState.FAILED,
            failureCode: 'DISPATCH_BINDING_CONTRADICTION',
            failureMessage:
              'The durable operation has a terminal dispatch contradiction.',
            result: previousResult,
            terminalAt: new Date(),
            executionOwner: null,
            executionLeaseExpiresAt: null,
            version: { increment: 1 },
          },
        });
        if (contradicted.count === 1) {
          await this.terminalizeStartRun(
            tx,
            dispatch,
            AgentOperationState.FAILED,
          );
        }
        return 'binding_contradiction' as const;
      }
      await this.terminalizeStartRun(tx, dispatch, operationState);
      return 'rejected' as const;
    });
    if (marked !== 'claim_lost') {
      this.logger.log(
        '[AgentOperationDispatchService] operation dispatch terminalized',
        {
          operationId: dispatch.operationId,
          machineId: dispatch.machineId,
          failureCode,
          operationState,
        },
      );
    }
    return marked;
  }

  private async terminalizeStartRun(
    tx: AnyTransactionClient,
    dispatch: ClaimedDispatch,
    operationState: AgentOperationState,
  ): Promise<void> {
    if (dispatch.operation.kind !== AgentOperationKind.START_RUN) return;
    await failProjectReportStartRunInTransaction(
      tx,
      dispatch.operation.agentSessionId,
      operationState === AgentOperationState.DENIED ? 'DENIED' : 'FAILED',
    );
  }

  private async releaseForRetry(
    dispatch: ClaimedDispatch,
    failureCode: string,
  ): Promise<boolean | null> {
    const startedAt = Date.now();
    const grant =
      dispatch.operation.kind === AgentOperationKind.START_RUN
        ? await this.prisma.db.executionGrant.findUniqueOrThrow({
            where: { id: dispatch.grantId },
            select: { expiresAt: true },
          })
        : undefined;
    if (grant && grant.expiresAt.getTime() <= Date.now()) {
      const transition = await this.markRejected(
        dispatch,
        'START_RUN_GRANT_EXPIRED',
        AgentOperationState.FAILED,
      );
      const reason =
        transition === 'claim_lost'
          ? 'lease_lost'
          : transition === 'binding_contradiction'
            ? 'binding_contradiction'
            : this.metrics.normalizeDeliveryReason('START_RUN_GRANT_EXPIRED');
      this.recordAttempt(
        transition === 'claim_lost' ? 'claim_lost' : 'terminal_failure',
        reason,
        startedAt,
      );
      if (transition !== 'claim_lost') {
        this.metrics.recordTerminalOutcome('terminal_failure', reason);
      }
      return null;
    }
    const delay = Math.min(
      MAX_RETRY_DELAY_MS,
      250 * 2 ** Math.min(dispatch.attemptCount, 7),
    );
    const released = await this.prisma.db.agentOperationDispatch.updateMany({
      where: {
        operationId: dispatch.operationId,
        state: AgentOperationDispatchState.CLAIMED,
        claimOwner: this.workerId,
      },
      data: {
        state: AgentOperationDispatchState.PENDING,
        lastFailureCode: failureCode,
        nextAttemptAt: new Date(
          Math.min(Date.now() + delay, grant?.expiresAt.getTime() ?? Infinity),
        ),
        claimOwner: null,
        claimExpiresAt: null,
      },
    });
    if (released.count === 1 && dispatch.lastFailureCode !== failureCode) {
      this.logger.debug(
        '[AgentOperationDispatchService] operation dispatch waiting',
        {
          operationId: dispatch.operationId,
          machineId: dispatch.machineId,
          previousFailureCode: dispatch.lastFailureCode,
          failureCode,
          nextAttemptDelayMs: delay,
        },
      );
    }
    return released.count === 1;
  }

  private recordAttempt(
    outcome:
      | 'acknowledged'
      | 'retry_scheduled'
      | 'denied'
      | 'terminal_failure'
      | 'claim_lost',
    reason: Parameters<ApiMetricsService['recordDeliveryAttempt']>[1],
    startedAt: number,
  ): void {
    this.metrics.recordDeliveryAttempt(
      outcome,
      reason,
      (Date.now() - startedAt) / 1000,
    );
  }

  private isRetryable(reason?: string): boolean {
    return (
      reason === undefined ||
      reason === 'no_recipient' ||
      reason === 'exact_machine_not_ready' ||
      reason === 'exact_machine_credential_unavailable' ||
      reason === 'timeout' ||
      reason === 'invalid_acknowledgement' ||
      reason === 'acknowledgement_identity_mismatch'
    );
  }
}

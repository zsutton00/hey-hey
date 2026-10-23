import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AgentOperationDispatchState } from '@prisma/client';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  API_AGENT_OPERATION_METRICS,
  DispatchQueueWakeSource,
  DeliveryOutcome,
  DeliveryReason,
  PENDING_FAILURE_CATEGORIES,
  PendingFailureCategory,
  WakeResult,
  WakeSource,
} from './api-metrics.constants';

const DISPATCH_GAUGE_REFRESH_MS = 30_000;

@Injectable()
export class ApiMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ApiMetricsService.name);
  readonly registry = new Registry();
  private refreshTimer: ReturnType<typeof setInterval> | undefined;

  readonly outboxProcessed = new Counter({
    name: 'outbox_processed_total',
    help: 'Total number of outbox events successfully processed',
    registers: [this.registry],
  });
  readonly outboxFailed = new Counter({
    name: 'outbox_failed_total',
    help: 'Total number of outbox events that failed processing',
    registers: [this.registry],
  });
  readonly outboxLagSeconds = new Gauge({
    name: 'outbox_lag_seconds',
    help: 'Age in seconds of the oldest pending outbox event',
    registers: [this.registry],
  });

  private readonly dispatchPending = new Gauge({
    name: API_AGENT_OPERATION_METRICS.pending,
    help: 'Pending durable operation dispatches by retry category',
    labelNames: ['category'] as const,
    registers: [this.registry],
  });
  private readonly oldestPendingAgeSeconds = new Gauge({
    name: API_AGENT_OPERATION_METRICS.oldestPendingAgeSeconds,
    help: 'Age in seconds of the oldest pending durable operation dispatch',
    registers: [this.registry],
  });
  private readonly activeClaims = new Gauge({
    name: API_AGENT_OPERATION_METRICS.activeClaims,
    help: 'Durable operation dispatch claims with an unexpired lease',
    registers: [this.registry],
  });
  private readonly expiredClaims = new Gauge({
    name: API_AGENT_OPERATION_METRICS.expiredClaims,
    help: 'Durable operation dispatch claims with an expired lease',
    registers: [this.registry],
  });
  private readonly dispatchAttempts = new Counter({
    name: API_AGENT_OPERATION_METRICS.attemptsTotal,
    help: 'Durable operation dispatch emission attempts by outcome and reason',
    labelNames: ['outcome', 'reason'] as const,
    registers: [this.registry],
  });
  private readonly dispatchDurationSeconds = new Histogram({
    name: API_AGENT_OPERATION_METRICS.durationSeconds,
    help: 'Duration of durable operation dispatch emission attempts',
    labelNames: ['outcome', 'reason'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
    registers: [this.registry],
  });
  private readonly dispatchQueueWaitSeconds = new Histogram({
    name: API_AGENT_OPERATION_METRICS.queueWaitSeconds,
    help: 'Time from durable operation commit to its first dispatch attempt',
    labelNames: ['wakeSource'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60],
    registers: [this.registry],
  });
  private readonly dispatchCommitToAckSeconds = new Histogram({
    name: API_AGENT_OPERATION_METRICS.commitToAckSeconds,
    help: 'Time from durable operation commit to CLI acknowledgement',
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 15, 30, 60],
    registers: [this.registry],
  });
  private readonly terminalOutcomes = new Counter({
    name: API_AGENT_OPERATION_METRICS.terminalOutcomesTotal,
    help: 'Terminal durable operation dispatch outcomes',
    labelNames: ['outcome', 'reason'] as const,
    registers: [this.registry],
  });
  private readonly expiredClaimRecoveries = new Counter({
    name: API_AGENT_OPERATION_METRICS.expiredClaimRecoveriesTotal,
    help: 'Expired durable operation dispatch leases successfully reclaimed',
    registers: [this.registry],
  });
  private readonly wakes = new Counter({
    name: API_AGENT_OPERATION_METRICS.wakesTotal,
    help: 'Targeted durable operation dispatch wake-ups by source and result',
    labelNames: ['source', 'result'] as const,
    registers: [this.registry],
  });

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    void this.refreshDispatchGauges();
    this.refreshTimer = setInterval(
      () => void this.refreshDispatchGauges(),
      DISPATCH_GAUGE_REFRESH_MS,
    );
  }

  onModuleDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  }

  metrics(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }

  async refreshDispatchGauges(): Promise<void> {
    const now = new Date();
    try {
      const [pendingGroups, oldestPending, activeClaims, expiredClaims] =
        await Promise.all([
          this.prisma.db.agentOperationDispatch.groupBy({
            by: ['lastFailureCode'],
            where: { state: AgentOperationDispatchState.PENDING },
            _count: { _all: true },
          }),
          this.prisma.db.agentOperationDispatch.findFirst({
            where: { state: AgentOperationDispatchState.PENDING },
            orderBy: { createdAt: 'asc' },
            select: { createdAt: true },
          }),
          this.prisma.db.agentOperationDispatch.count({
            where: {
              state: AgentOperationDispatchState.CLAIMED,
              claimExpiresAt: { gte: now },
            },
          }),
          this.prisma.db.agentOperationDispatch.count({
            where: {
              state: AgentOperationDispatchState.CLAIMED,
              claimExpiresAt: { lt: now },
            },
          }),
        ]);

      const pendingCounts = new Map<PendingFailureCategory, number>(
        PENDING_FAILURE_CATEGORIES.map((category) => [category, 0]),
      );
      for (const group of pendingGroups) {
        const category = this.pendingFailureCategory(group.lastFailureCode);
        pendingCounts.set(
          category,
          (pendingCounts.get(category) ?? 0) + group._count._all,
        );
      }

      for (const category of PENDING_FAILURE_CATEGORIES) {
        this.dispatchPending.set(
          { category },
          pendingCounts.get(category) ?? 0,
        );
      }
      this.oldestPendingAgeSeconds.set(
        oldestPending
          ? Math.max(
              0,
              (now.getTime() - oldestPending.createdAt.getTime()) / 1000,
            )
          : 0,
      );
      this.activeClaims.set(activeClaims);
      this.expiredClaims.set(expiredClaims);
    } catch (error) {
      this.logger.warn('Failed to refresh durable dispatch metrics', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  recordDeliveryAttempt(
    outcome: DeliveryOutcome,
    reason: DeliveryReason,
    durationSeconds: number,
  ): void {
    this.recordSafely('delivery attempt', () => {
      this.dispatchAttempts.inc({ outcome, reason });
      this.dispatchDurationSeconds.observe(
        { outcome, reason },
        Math.max(0, durationSeconds),
      );
    });
  }

  recordDispatchQueueWait(
    wakeSource: DispatchQueueWakeSource,
    durationSeconds: number,
  ): void {
    this.recordSafely('dispatch queue wait', () => {
      this.dispatchQueueWaitSeconds.observe(
        { wakeSource },
        Math.max(0, durationSeconds),
      );
    });
  }

  recordDispatchCommitToAck(durationSeconds: number): void {
    this.recordSafely('dispatch commit to acknowledgement', () => {
      this.dispatchCommitToAckSeconds.observe(Math.max(0, durationSeconds));
    });
  }

  recordOutboxProcessed(): void {
    this.recordSafely('outbox processed', () => {
      this.outboxProcessed.inc();
    });
  }

  recordOutboxFailed(): void {
    this.recordSafely('outbox failed', () => {
      this.outboxFailed.inc();
    });
  }

  setOutboxLagSeconds(value: number): void {
    this.recordSafely('outbox lag', () => {
      this.outboxLagSeconds.set(value);
    });
  }

  recordTerminalOutcome(
    outcome: 'acknowledged' | 'denied' | 'terminal_failure',
    reason: DeliveryReason,
  ): void {
    this.recordSafely('terminal outcome', () => {
      this.terminalOutcomes.inc({ outcome, reason });
    });
  }

  recordExpiredClaimRecovery(): void {
    this.recordSafely('expired claim recovery', () => {
      this.expiredClaimRecoveries.inc();
    });
  }

  recordWake(source: WakeSource, result: WakeResult): void {
    this.recordSafely('dispatch wake', () => {
      this.wakes.inc({ source, result });
    });
  }

  normalizeDeliveryReason(reason?: string): DeliveryReason {
    if (!reason) return 'transport_failure';
    if (reason === 'timeout') return 'acknowledgement_timeout';
    if (reason.startsWith('cli_rejected')) return 'cli_rejected';
    if (reason.startsWith('DISPATCH_BINDING_CONTRADICTION')) {
      return 'binding_contradiction';
    }
    const recognized: readonly DeliveryReason[] = [
      'accepted',
      'no_recipient',
      'exact_machine_not_ready',
      'exact_machine_credential_unavailable',
      'invalid_acknowledgement',
      'acknowledgement_identity_mismatch',
      'transport_failure',
      'transport_exception',
      'lease_lost',
    ];
    return recognized.includes(reason as DeliveryReason)
      ? (reason as DeliveryReason)
      : 'other';
  }

  private pendingFailureCategory(
    failureCode: string | null,
  ): PendingFailureCategory {
    if (failureCode === null) return 'not_attempted';
    if (
      failureCode === 'no_recipient' ||
      failureCode === 'exact_machine_not_ready' ||
      failureCode === 'exact_machine_credential_unavailable'
    ) {
      return 'offline_waiting';
    }
    if (
      failureCode === 'timeout' ||
      failureCode === 'invalid_acknowledgement' ||
      failureCode === 'acknowledgement_identity_mismatch'
    ) {
      return 'acknowledgement_ambiguous';
    }
    if (
      failureCode === 'transport_failure' ||
      failureCode === 'transport_exception'
    ) {
      return 'transport_retry';
    }
    return 'other_retry';
  }

  private recordSafely(metric: string, record: () => void): void {
    try {
      record();
    } catch (error) {
      this.logger.warn(`Failed to record ${metric} metric`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

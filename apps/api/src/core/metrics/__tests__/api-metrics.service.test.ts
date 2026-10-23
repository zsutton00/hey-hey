import { AgentOperationDispatchState } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';
import {
  API_AGENT_OPERATION_METRICS,
  DELIVERY_OUTCOMES,
  DELIVERY_REASONS,
  PENDING_FAILURE_CATEGORIES,
  WAKE_RESULTS,
  WAKE_SOURCES,
} from '../api-metrics.constants';
import { ApiMetricsService } from '../api-metrics.service';

describe('ApiMetricsService', () => {
  const now = new Date('2026-09-04T19:00:00.000Z');

  const createService = () => {
    const dispatch = {
      groupBy: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(0),
    };
    const service = new ApiMetricsService({
      db: { agentOperationDispatch: dispatch },
    } as unknown as PrismaService);
    return { service, dispatch };
  };

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('owns one registry containing the retained outbox and API series', async () => {
    const { service } = createService();
    service.outboxProcessed.inc();
    service.outboxFailed.inc();
    service.outboxLagSeconds.set(3);
    service.recordDeliveryAttempt('acknowledged', 'accepted', 0.25);
    service.recordDispatchQueueWait('submission', 1.5);
    service.recordDispatchCommitToAck(2.25);
    service.recordTerminalOutcome('acknowledged', 'accepted');
    service.recordExpiredClaimRecovery();
    service.recordWake('submission', 'claimed');

    const exposition = await service.metrics();

    expect(exposition).toContain('outbox_processed_total 1');
    expect(exposition).toContain('outbox_failed_total 1');
    expect(exposition).toContain('outbox_lag_seconds 3');
    expect(exposition).toContain(
      'agent_operation_dispatch_queue_wait_seconds_count{wakeSource="submission"} 1',
    );
    expect(exposition).toContain(
      'agent_operation_dispatch_commit_to_ack_seconds_count 1',
    );
    for (const name of Object.values(API_AGENT_OPERATION_METRICS)) {
      expect(exposition).toContain(`# HELP ${name}`);
    }
    expect(exposition).not.toContain('operationId');
    expect(exposition).not.toContain('machineId');
  });

  it('refreshes immediately and every 30 seconds', async () => {
    const { service } = createService();
    const refresh = jest
      .spyOn(service, 'refreshDispatchGauges')
      .mockResolvedValue(undefined);

    service.onModuleInit();
    expect(refresh).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(30_000);
    expect(refresh).toHaveBeenCalledTimes(2);
    service.onModuleDestroy();
  });

  it('zeroes every pending category and normalizes failure codes', async () => {
    const { service, dispatch } = createService();
    dispatch.groupBy.mockResolvedValue([
      { lastFailureCode: null, _count: { _all: 2 } },
      { lastFailureCode: 'no_recipient', _count: { _all: 3 } },
      { lastFailureCode: 'exact_machine_not_ready', _count: { _all: 4 } },
      { lastFailureCode: 'timeout', _count: { _all: 5 } },
      { lastFailureCode: 'transport_exception', _count: { _all: 6 } },
      { lastFailureCode: 'unexpected_retry', _count: { _all: 7 } },
    ]);
    dispatch.findFirst.mockResolvedValue({
      createdAt: new Date(now.getTime() - 12_000),
    });
    dispatch.count
      .mockReset()
      .mockResolvedValueOnce(8)
      .mockResolvedValueOnce(9);

    await service.refreshDispatchGauges();
    const exposition = await service.metrics();

    const expectedCounts = [2, 7, 5, 6, 7];
    PENDING_FAILURE_CATEGORIES.forEach((category, index) => {
      expect(exposition).toContain(
        `api_agent_operation_dispatch_pending{category="${category}"} ${expectedCounts[index]}`,
      );
    });
    expect(exposition).toContain(
      'api_agent_operation_dispatch_oldest_pending_age_seconds 12',
    );
    expect(exposition).toContain(
      'api_agent_operation_dispatch_active_claims 8',
    );
    expect(exposition).toContain(
      'api_agent_operation_dispatch_expired_claims 9',
    );
    const capturedTimes = dispatch.count.mock.calls.map(
      ([query]) =>
        query.where.claimExpiresAt.gte ?? query.where.claimExpiresAt.lt,
    );
    expect(capturedTimes[0]).toBe(capturedTimes[1]);
  });

  it('keeps the last successful snapshot when a database query fails', async () => {
    const { service, dispatch } = createService();
    dispatch.groupBy.mockResolvedValue([
      { lastFailureCode: null, _count: { _all: 4 } },
    ]);
    await service.refreshDispatchGauges();
    const successful = await service.metrics();

    dispatch.groupBy.mockRejectedValueOnce(new Error('database unavailable'));
    await expect(service.refreshDispatchGauges()).resolves.toBeUndefined();

    expect(await service.metrics()).toBe(successful);
  });

  it('uses only the closed reason normalization vocabulary', () => {
    const { service } = createService();
    expect(service.normalizeDeliveryReason('timeout')).toBe(
      'acknowledgement_timeout',
    );
    expect(
      service.normalizeDeliveryReason(
        'cli_rejected:ADMISSION:AUTHORIZATION_REJECTED',
      ),
    ).toBe('cli_rejected');
    expect(service.normalizeDeliveryReason('persisted-id-value')).toBe('other');
  });

  it('records every bounded attempt and wake label value', async () => {
    const { service } = createService();
    DELIVERY_OUTCOMES.forEach((outcome, index) => {
      service.recordDeliveryAttempt(
        outcome,
        DELIVERY_REASONS[index % DELIVERY_REASONS.length]!,
        0.1,
      );
    });
    for (const source of WAKE_SOURCES) {
      for (const result of WAKE_RESULTS) service.recordWake(source, result);
    }
    service.recordTerminalOutcome('denied', 'cli_rejected');
    service.recordTerminalOutcome('terminal_failure', 'binding_contradiction');

    const exposition = await service.metrics();
    for (const outcome of DELIVERY_OUTCOMES) {
      expect(exposition).toContain(`outcome="${outcome}"`);
    }
    for (const source of WAKE_SOURCES) {
      for (const result of WAKE_RESULTS) {
        expect(exposition).toContain(`source="${source}",result="${result}"`);
      }
    }
  });

  it('isolates metric recording failures from callers', () => {
    const { service } = createService();
    const attempts = (
      service as unknown as { dispatchAttempts: { inc: () => void } }
    ).dispatchAttempts;
    jest.spyOn(attempts, 'inc').mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    expect(() =>
      service.recordDeliveryAttempt('retry_scheduled', 'transport_failure', 1),
    ).not.toThrow();
  });

  it('isolates retained outbox metric failures from publication state', () => {
    const { service } = createService();
    jest.spyOn(service.outboxProcessed, 'inc').mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    expect(() => service.recordOutboxProcessed()).not.toThrow();
  });
});

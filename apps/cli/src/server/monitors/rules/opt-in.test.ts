import { describe, expect, it, vi } from 'vitest';
import type { AgentSessionDto } from '../../../shared/api/generated/api';
import {
  REPORT_EMISSION_KIND,
  type CanonicalMonitorEvent,
  type ReportEmissionMonitorEvent,
} from '../normalizer';
import { createTestAgentSessionReader } from '../test-owners.test-support';
import { SessionMonitorOptInPolicy } from './opt-in';

const reportEmissionEvent = (
  overrides: Partial<ReportEmissionMonitorEvent> = {},
): ReportEmissionMonitorEvent => ({
  eventType: 'report.emitted',
  kind: REPORT_EMISSION_KIND,
  targetSessionId: 'session-1',
  targetConversationId: 'conv-target',
  reportId: 'report-1',
  timestamp: '2026-06-25T00:00:00.000Z',
  origin: 'self',
  ...overrides,
});

const partialAgentSession = (overrides: Partial<AgentSessionDto>): AgentSessionDto =>
  ({ autoDecide: false, ...overrides }) as AgentSessionDto;

const createLogger = () => {
  const calls: Array<{ level: 'info' | 'warn' | 'error'; event: string; fields?: unknown }> = [];
  const sink =
    (level: 'info' | 'warn' | 'error') => (event: string, fields?: Record<string, unknown>) => {
      calls.push({ level, event, fields });
    };
  return {
    logger: {
      trace: vi.fn(),
      debug: vi.fn(),
      info: sink('info'),
      warn: sink('warn'),
      error: sink('error'),
      child: () =>
        ({
          trace: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
          child: vi.fn(),
        }) as never,
    } as never,
    calls,
  };
};

describe('SessionMonitorOptInPolicy', () => {
  it('returns true when the target session has autoDecide=true', async () => {
    const { logger, calls } = createLogger();
    const readAgentSession = vi.fn().mockResolvedValue(partialAgentSession({ autoDecide: true }));
    const optIn = new SessionMonitorOptInPolicy({
      agentSessionReader: createTestAgentSessionReader(readAgentSession),
      logger,
    });

    await expect(optIn.handle(reportEmissionEvent({ targetSessionId: 'session-1' }))).resolves.toBe(
      true,
    );
    expect(readAgentSession).toHaveBeenCalledWith('session-1');
    expect(calls).toEqual([]);
  });

  it('returns false and logs auto_decide_false when autoDecide=false', async () => {
    const { logger, calls } = createLogger();
    const readAgentSession = vi.fn().mockResolvedValue(partialAgentSession({ autoDecide: false }));
    const optIn = new SessionMonitorOptInPolicy({
      agentSessionReader: createTestAgentSessionReader(readAgentSession),
      logger,
    });

    await expect(optIn.handle(reportEmissionEvent({ targetSessionId: 'session-1' }))).resolves.toBe(
      false,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 'info',
      event: 'monitors.opt_in.session_monitor.dropped',
      fields: { reason: 'auto_decide_false', targetSessionId: 'session-1' },
    });
  });

  it('returns false and logs not_found when the reader resolves null', async () => {
    const { logger, calls } = createLogger();
    const readAgentSession = vi.fn().mockResolvedValue(null);
    const optIn = new SessionMonitorOptInPolicy({
      agentSessionReader: createTestAgentSessionReader(readAgentSession),
      logger,
    });

    await expect(optIn.handle(reportEmissionEvent({ targetSessionId: 'session-2' }))).resolves.toBe(
      false,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 'warn',
      event: 'monitors.opt_in.session_monitor.dropped',
      fields: { reason: 'not_found', targetSessionId: 'session-2' },
    });
  });

  it('returns false and logs lookup_error when the reader throws', async () => {
    const { logger, calls } = createLogger();
    const readAgentSession = vi.fn().mockRejectedValue(new Error('boom'));
    const optIn = new SessionMonitorOptInPolicy({
      agentSessionReader: createTestAgentSessionReader(readAgentSession),
      logger,
    });

    await expect(optIn.handle(reportEmissionEvent({ targetSessionId: 'session-3' }))).resolves.toBe(
      false,
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      level: 'warn',
      event: 'monitors.opt_in.session_monitor.dropped',
      fields: { reason: 'lookup_error', targetSessionId: 'session-3', error: 'boom' },
    });
  });

  it('returns false when the event is not a report-emission variant', async () => {
    const { logger, calls } = createLogger();
    const readAgentSession = vi.fn();
    const optIn = new SessionMonitorOptInPolicy({
      agentSessionReader: createTestAgentSessionReader(readAgentSession),
      logger,
    });
    const nonReportEvent: CanonicalMonitorEvent = {
      eventType: 'task.created',
      timestamp: '2026-06-25T00:00:00.000Z',
      origin: 'platform',
    };

    await expect(optIn.handle(nonReportEvent)).resolves.toBe(false);
    expect(readAgentSession).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.event).toBe('monitors.opt_in.session_monitor.dropped');
  });
});

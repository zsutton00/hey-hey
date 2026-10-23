import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ControlReductionTelemetry } from './control-reduction-telemetry';
import { DiagnosticFeed } from './diagnostic-feed';
import { StructuredServerLogger } from './logger';
import type { ReadableInputRecord } from './input-admission/input-admission-codec';

const cancelledInput = (): ReadableInputRecord => ({
  key: randomUUID(),
  messageId: randomUUID(),
  agentSessionId: randomUUID(),
  runId: randomUUID(),
  admissionId: randomUUID(),
  organizationId: randomUUID(),
  projectId: randomUUID(),
  userId: randomUUID(),
  machineId: randomUUID(),
  fingerprint: 'secret-fingerprint',
  state: 'cancelled',
  admissionDisposition: 'queued',
  revision: 2,
  projectedRevision: 0,
  sequence: 0,
  kind: null,
  keyKind: 'operation',
  payload: null,
  turnId: null,
  settlement: null,
  settlementDelivered: false,
});

const fixture = () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T08:00:00Z'));
  const feed = new DiagnosticFeed(undefined, () => Date.now());
  const lines: string[] = [];
  const telemetry = new ControlReductionTelemetry(
    new StructuredServerLogger({ sink: feed, writeLine: (line) => lines.push(line) }),
    feed,
    () => Date.now(),
  );
  return { feed, lines, telemetry };
};

afterEach(() => vi.useRealTimers());

describe('ControlReductionTelemetry', () => {
  it('preserves early incident evidence through an hour of routine traffic and verified outcomes', () => {
    const { feed, telemetry, lines } = fixture();
    const input = cancelledInput();
    const stamp = () => new Date().toISOString();
    for (const event of [
      'local.handler.permission.requested',
      'input_admission.cancellation_committed',
      'input_admission.projection_deferred',
    ])
      feed.append({
        event,
        level: event.endsWith('deferred') ? 'warn' : 'info',
        timestamp: stamp(),
      });
    telemetry.cancellation(input, false);
    const firstRepeat = Date.now() + 2_000;
    for (let tick = 1; tick <= 1_800; tick += 1) {
      vi.advanceTimersByTime(2_000);
      telemetry.cancellation(input, false);
      for (let n = 0; n < 10; n += 1)
        feed.append({
          event: 'routine.tick',
          level: 'info',
          timestamp: stamp(),
          text: 'x'.repeat(512),
        });
    }
    const snapshot = feed.snapshot();
    const summaries = lines
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === 'control_reduction.repeated');
    expect(summaries.reduce((count, entry) => count + entry.repetitionCount, 0)).toBe(1_800);
    expect(summaries[0].firstTimestamp).toBe(new Date(firstRepeat).toISOString());
    expect(summaries.at(-1).lastTimestamp).toBe(stamp());
    expect(snapshot.repetitionCount).toBe(1_800);
    expect(snapshot.losses.routine.evicted).toBeGreaterThan(10_000);
    for (const event of [
      'local.handler.permission.requested',
      'input_admission.cancellation_committed',
      'input_admission.projection_deferred',
    ])
      expect(
        snapshot.records.some((record) => record.kind === 'log' && record.event === event),
      ).toBe(true);
    expect(lines.join('')).not.toContain(input.fingerprint);
    expect(lines.join('')).not.toContain('payload');
    telemetry.dispose();
    feed.dispose();
  });

  it('flushes on state change, idle expiry, snapshot and shutdown with accurate timestamps', () => {
    const { telemetry, lines, feed } = fixture();
    const input = cancelledInput();
    telemetry.cancellation(input, true);
    vi.advanceTimersByTime(2_000);
    telemetry.cancellation(input, true);
    telemetry.cancellation({ ...input, projectedRevision: 2 }, true);
    telemetry.cancellation({ ...input, projectedRevision: 2 }, true);
    feed.snapshot();
    telemetry.cancellation({ ...input, projectedRevision: 2 }, true);
    // Skip the periodic summary to exercise the idle boundary directly.
    vi.setSystemTime(Date.now() + 120_000);
    vi.advanceTimersByTime(1_000);
    telemetry.cancellation(input, false);
    telemetry.cancellation(input, false);
    telemetry.dispose();
    const summaries = lines
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.event === 'control_reduction.repeated');
    expect(summaries.map((entry) => entry.reason)).toEqual([
      'outcome_change',
      'snapshot',
      'idle',
      'shutdown',
    ]);
    expect(summaries.every((entry) => entry.repetitionCount === 1)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    feed.dispose();
  });

  it('bounds groups, flushes capacity loss and emits every failure and distinct stop', () => {
    const { telemetry, lines, feed } = fixture();
    const first = cancelledInput();
    telemetry.cancellation(first, false);
    telemetry.cancellation(first, false);
    for (let n = 0; n < 256; n += 1) {
      vi.advanceTimersByTime(1);
      telemetry.cancellation(cancelledInput(), false);
    }
    telemetry.cancellationFailed(first.key, first.messageId!, first.agentSessionId);
    telemetry.cancellationFailed(first.key, first.messageId!, first.agentSessionId);
    telemetry.stopped('conversation', 'run', true);
    telemetry.stopped('conversation', 'run', true);
    const entries = lines.map((line) => JSON.parse(line));
    expect(entries.filter((entry) => entry.reason === 'capacity')).toHaveLength(1);
    expect(entries.filter((entry) => entry.event === 'control_reduction.failed')).toHaveLength(2);
    expect(entries.filter((entry) => entry.kind === 'stop_run')).toHaveLength(2);
    telemetry.dispose();
    feed.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains only safe identity and outcome fields from a committed cancellation', () => {
    const { telemetry, lines, feed } = fixture();
    const input: ReadableInputRecord = {
      ...cancelledInput(),
      state: 'cancelled',
      kind: 'trigger_frame',
      payload: { envelope: { authorization: 'private-authorization' }, prompt: 'private-prompt' },
      settlement: { text: 'private-settlement' },
    };
    telemetry.cancellation(input, false);
    telemetry.cancellation(input, false);
    feed.snapshot();
    expect(lines.join('')).not.toContain('private-');
    expect(lines.join('')).not.toContain('secret-fingerprint');
    expect(lines.join('')).not.toContain('envelope');
    expect(lines.join('')).not.toContain('settlement');
    expect(lines.join('')).toContain(input.key);
    telemetry.dispose();
    feed.dispose();
  });
});

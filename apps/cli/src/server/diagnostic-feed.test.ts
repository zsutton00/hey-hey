import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DIAGNOSTIC_FEED_LIMITS,
  DiagnosticFeed,
  isDirectOutputActive,
  type CapturedConsoleRecord,
  type DiagnosticFeedUpdate,
} from './diagnostic-feed';
import { LogRingBuffer } from './log-ring-buffer';
import { fanOutLogSinks, StructuredServerLogger } from './logger';
import { RunEventPublisher } from './run-event-publisher';
import type { Run } from '../run/run';

const consoleRecord = (text: string): CapturedConsoleRecord => ({
  stream: 'stderr',
  source: 'error',
  text,
  timestamp: '2026-10-04T10:00:00.000Z',
});

afterEach(() => vi.useRealTimers());

describe('DiagnosticFeed', () => {
  it('enforces both lane count budgets without evicting incident evidence with routine records', () => {
    const feed = new DiagnosticFeed();
    feed.capture(consoleRecord('early incident'));
    for (let n = 0; n < 9_000; n += 1)
      feed.capture({ ...consoleRecord('routine'), stream: 'stdout', source: 'log' });
    let snapshot = feed.snapshot();
    expect(snapshot.records[0]?.text).toBe('early incident');
    expect(snapshot.losses.routine.evicted).toBe(1_000);
    for (let n = 0; n < 4_000; n += 1) feed.capture(consoleRecord('later incident'));
    snapshot = feed.snapshot();
    expect(snapshot.records).toHaveLength(12_000);
    expect(snapshot.losses.incident.evicted).toBe(1);
    expect(snapshot.records.map((record) => record.seq)).toEqual(
      snapshot.records.map((record) => record.seq).sort((a, b) => a - b),
    );
    feed.dispose();
  });

  it('enforces each byte budget and truncates multibyte records on code point boundaries', () => {
    const feed = new DiagnosticFeed();
    for (const stream of ['stdout', 'stderr'] as const) {
      for (let n = 0; n < 600; n += 1)
        feed.capture({ ...consoleRecord('界'.repeat(4_000)), source: 'write', stream });
    }
    const snapshot = feed.snapshot();
    for (const stream of ['stdout', 'stderr'] as const) {
      const records = snapshot.records.filter(
        (record) => record.kind === 'console' && record.stream === stream,
      );
      expect(
        records.reduce((sum, record) => sum + Buffer.byteLength(record.text), 0),
      ).toBeLessThanOrEqual(4 * 1024 * 1024);
      expect(records).toHaveLength(512);
      expect(
        records.every((record) => record.truncatedBytes === 3_810 && !record.text.includes('�')),
      ).toBe(true);
    }
    expect(snapshot.losses.routine.evicted).toBe(88);
    expect(snapshot.losses.incident.evicted).toBe(88);
    feed.dispose();
  });

  it('expires by ingestion age on append, snapshot and observe regardless of wall timestamps', () => {
    let age = 0;
    const feed = new DiagnosticFeed(undefined, () => age);
    feed.capture({ ...consoleRecord('a'), timestamp: '2099-01-01T00:00:00Z' });
    const before = feed.snapshot();
    age = 7_200_000;
    feed.capture(consoleRecord('b'));
    expect(feed.snapshot()).toMatchObject({ expiredCount: 1, evictedCount: 0 });
    age += 7_200_000;
    expect(feed.observe(() => undefined).snapshot.records).toHaveLength(0);
    feed.capture(consoleRecord('c'));
    age += 7_200_000;
    expect(feed.snapshot()).toMatchObject({
      expiredCount: 3,
      coverage: { oldestTimestamp: null, newestTimestamp: null },
    });
    expect(before.records[0]?.text).toBe('a');
    expect(Object.isFrozen(before.records[0])).toBe(true);
    expect(Object.isFrozen(before.losses.incident)).toBe(true);
    feed.dispose();
  });

  it('publishes exact non-prefix removals and expires an idle live view with timer cleanup', () => {
    vi.useFakeTimers();
    let now = 0;
    const feed = new DiagnosticFeed(
      { maxRecords: 1, maxBytes: 1024, maxRecordTextBytes: 128 },
      () => now,
    );
    const updates: DiagnosticFeedUpdate[] = [];
    const observation = feed.observe((update) => updates.push(update));
    feed.capture(consoleRecord('incident'));
    feed.capture({ ...consoleRecord('routine old'), source: 'log', stream: 'stdout' });
    feed.capture({ ...consoleRecord('routine new'), source: 'log', stream: 'stdout' });
    expect(updates).toContainEqual(expect.objectContaining({ kind: 'evicted', sequences: [2] }));
    expect(feed.snapshot().records.map((record) => record.seq)).toEqual([1, 3]);
    now = 7_200_000;
    vi.advanceTimersByTime(7_200_000);
    expect(updates.at(-1)).toMatchObject({
      kind: 'evicted',
      sequences: [1, 3],
      metadata: { expiredCount: 2 },
    });
    expect(feed.snapshot().records).toHaveLength(0);
    observation.unsubscribe();
    feed.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('records structured logs and captured console output in one ordered feed', () => {
    const feed = new DiagnosticFeed();
    const ring = new LogRingBuffer({ capacity: 10 });
    const lines: string[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'info',
      sink: fanOutLogSinks(ring, feed),
      writeLine: (line) => lines.push(line),
    });

    logger.info('server.started', { port: 1 });
    feed.capture(consoleRecord('stray stderr'));

    const { records } = feed.snapshot();
    expect(records).toEqual([
      expect.objectContaining({ kind: 'log', seq: 1, level: 'info', event: 'server.started' }),
      expect.objectContaining({ kind: 'console', seq: 2, stream: 'stderr', text: 'stray stderr' }),
    ]);
    // The existing ring buffer and direct output are preserved alongside the feed.
    expect(ring.size()).toBe(1);
    expect(lines).toHaveLength(1);
  });

  it('does not capture the logger’s own output a second time as console text', () => {
    const feed = new DiagnosticFeed();
    const logger = new StructuredServerLogger({
      sink: feed,
      // Stands in for an installed stdout capture hook.
      writeLine: (line) => {
        expect(isDirectOutputActive()).toBe(true);
        feed.capture({ ...consoleRecord(line), stream: 'stdout', source: 'write' });
      },
    });

    logger.warn('duplicate.check');

    expect(feed.snapshot().records.map((record) => record.kind)).toEqual(['log']);
    expect(isDirectOutputActive()).toBe(false);
  });

  it('drops records raised re-entrantly by its own observers', () => {
    const feed = new DiagnosticFeed();
    const logger = new StructuredServerLogger({ sink: feed, writeLine: () => undefined });
    feed.observe(() => {
      logger.error('observer.logged');
      feed.capture(consoleRecord('observer wrote'));
    });

    feed.capture(consoleRecord('original'));

    const snapshot = feed.snapshot();
    expect(snapshot.records.map((record) => record.text)).toEqual(['original']);
    expect(snapshot.droppedReentrantCount).toBe(2);
  });

  it('isolates a throwing observer and a throwing sibling sink', () => {
    const feed = new DiagnosticFeed();
    const healthy: DiagnosticFeedUpdate[] = [];
    feed.observe(() => {
      throw new Error('view crashed');
    });
    feed.observe((update) => healthy.push(update));
    const failing = {
      append: () => {
        throw new Error('sink failed');
      },
    };
    const logger = new StructuredServerLogger({
      sink: fanOutLogSinks(failing, feed),
      writeLine: () => undefined,
    });

    expect(() => logger.info('still.delivered')).not.toThrow();
    expect(
      healthy.map((update) => (update.kind === 'appended' ? update.record.seq : null)),
    ).toEqual([1]);
    expect(feed.observerFailures).toBe(1);
  });

  it('hands a snapshot and later updates to a late observer without loss', () => {
    const feed = new DiagnosticFeed();
    feed.capture(consoleRecord('before'));
    const updates: DiagnosticFeedUpdate[] = [];
    const { snapshot } = feed.observe((update) => updates.push(update));
    feed.capture(consoleRecord('after'));

    expect(snapshot.records.map((record) => record.seq)).toEqual([1]);
    expect(
      updates.map((update) =>
        update.kind === 'appended' ? [update.record.seq, update.record.text] : null,
      ),
    ).toEqual([[2, 'after']]);
  });

  it('isolates failing snapshot producers and prevents recursive snapshot flushing', () => {
    const feed = new DiagnosticFeed();
    const snapshotProducer = vi.fn(() => {
      feed.capture(consoleRecord('flushed before snapshot'));
      feed.snapshot();
    });
    feed.beforeSnapshot(() => {
      throw new Error('producer unavailable');
    });
    const unsubscribe = feed.beforeSnapshot(snapshotProducer);
    expect(feed.snapshot().records[0]?.text).toBe('flushed before snapshot');
    expect(snapshotProducer).toHaveBeenCalledTimes(1);
    expect(feed.observerFailures).toBe(1);
    unsubscribe();
    feed.dispose();
  });

  it('truncates oversized records visibly and evicts oldest past count and byte limits', () => {
    const feed = new DiagnosticFeed({ maxRecords: 3, maxBytes: 20, maxRecordTextBytes: 8 });
    const updates: DiagnosticFeedUpdate[] = [];
    feed.observe((update) => updates.push(update));

    feed.capture(consoleRecord('0123456789'));
    expect(feed.snapshot().records[0]).toMatchObject({ text: '01234567', truncatedBytes: 2 });

    feed.capture(consoleRecord('abcdefgh'));
    feed.capture(consoleRecord('ijklmnop'));

    const snapshot = feed.snapshot();
    expect(snapshot.records.map((record) => record.seq)).toEqual([2, 3]);
    expect(snapshot.evictedCount).toBe(1);
    expect(updates).toContainEqual(
      expect.objectContaining({ kind: 'evicted', sequences: [1], count: 1 }),
    );

    const counted = new DiagnosticFeed({ ...DIAGNOSTIC_FEED_LIMITS, maxRecords: 2 });
    for (const text of ['a', 'b', 'c']) counted.capture(consoleRecord(text));
    expect(counted.snapshot().records.map((record) => record.text)).toEqual(['b', 'c']);
  });
});

describe('RunEventPublisher run output listeners', () => {
  it('delivers attributed output and isolates a failing listener from the Run and siblings', () => {
    const warn = vi.fn();
    const logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn,
      error: vi.fn(),
      child: vi.fn(),
    };
    const publisher = new RunEventPublisher({
      platformWebSocketManager: {} as never,
      agentOutputEvents: { publish: vi.fn() } as never,
      runLifecycleEvents: { publishRunFinished: vi.fn() } as never,
      logger,
    });
    const received: unknown[] = [];
    publisher.onRunOutput(() => {
      throw new Error('projection failed');
    });
    publisher.onRunOutput((_event, attribution) => received.push(attribution.subagentTurnId));

    const attribution = { run: {} as Run, turnId: 't', subagentTurnId: 'sub' };
    expect(() =>
      publisher.publishAgentOutput(
        {
          runId: 'r',
          source: 'provider',
          eventType: 'assistant',
          timestamp: '2026-10-04T10:00:00.000Z',
          sessionId: null,
          agentId: null,
          payload: {},
        },
        attribution,
      ),
    ).not.toThrow();
    expect(received).toEqual(['sub']);
    expect(warn).toHaveBeenCalledWith('run.output_listener_failed', expect.anything());
  });
});

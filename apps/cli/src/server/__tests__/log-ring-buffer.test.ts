import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogRingBuffer } from '../log-ring-buffer';
import { StructuredServerLogger } from '../logger';

const ENV_KEY = 'LOG_RING_BUFFER_SIZE';

const makeEntry = (overrides: Record<string, unknown> = {}) => ({
  timestamp: new Date().toISOString(),
  level: 'info' as const,
  event: 'test.event',
  ...overrides,
});

describe('LogRingBuffer', () => {
  const originalEnv = process.env[ENV_KEY];

  beforeEach(() => {
    delete process.env[ENV_KEY];
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
  });

  it('defaults to capacity 500', () => {
    const buffer = new LogRingBuffer();
    expect(buffer.capacity).toBe(500);
  });

  it('honors the LOG_RING_BUFFER_SIZE env var', () => {
    process.env[ENV_KEY] = '25';
    const buffer = new LogRingBuffer();
    expect(buffer.capacity).toBe(25);
  });

  it('honors an explicit capacity option over the env var', () => {
    process.env[ENV_KEY] = '25';
    const buffer = new LogRingBuffer({ capacity: 7 });
    expect(buffer.capacity).toBe(7);
  });

  it('returns entries in insertion order until full', () => {
    const buffer = new LogRingBuffer({ capacity: 5 });
    for (let i = 0; i < 3; i += 1) buffer.append(makeEntry({ seq: i }));
    const entries = buffer.tail();
    expect(entries.map((e) => e['seq'])).toEqual([0, 1, 2]);
  });

  it('evicts the oldest entry when capacity is reached', () => {
    const buffer = new LogRingBuffer({ capacity: 3 });
    for (let i = 0; i < 10; i += 1) buffer.append(makeEntry({ seq: i }));
    expect(buffer.size()).toBe(3);
    const entries = buffer.tail();
    expect(entries.map((e) => e['seq'])).toEqual([7, 8, 9]);
  });

  it('filters by runId', () => {
    const buffer = new LogRingBuffer({ capacity: 10 });
    buffer.append(makeEntry({ runId: 'run-a', seq: 0 }));
    buffer.append(makeEntry({ runId: 'run-b', seq: 1 }));
    buffer.append(makeEntry({ runId: 'run-a', seq: 2 }));
    buffer.append(makeEntry({ seq: 3 }));

    const filtered = buffer.tail({ runId: 'run-a' });
    expect(filtered.map((e) => e['seq'])).toEqual([0, 2]);
  });

  it('limits the tail after filtering', () => {
    const buffer = new LogRingBuffer({ capacity: 10 });
    for (let i = 0; i < 8; i += 1) buffer.append(makeEntry({ runId: 'run-a', seq: i }));

    const tail = buffer.tail({ runId: 'run-a', limit: 3 });
    expect(tail.map((e) => e['seq'])).toEqual([5, 6, 7]);
  });

  it('filters by triggerMessageId', () => {
    const buffer = new LogRingBuffer({ capacity: 10 });
    buffer.append(makeEntry({ runId: 'run-a', triggerMessageId: 't-1', seq: 0 }));
    buffer.append(makeEntry({ runId: 'run-a', triggerMessageId: 't-2', seq: 1 }));
    buffer.append(makeEntry({ runId: 'run-a', triggerMessageId: 't-1', seq: 2 }));

    const tail = buffer.tail({ runId: 'run-a', triggerMessageId: 't-1' });
    expect(tail.map((e) => e['seq'])).toEqual([0, 2]);
  });
});

describe('StructuredServerLogger sink', () => {
  it('tees emitted entries into the provided sink and respects minLevel', () => {
    const buffer = new LogRingBuffer({ capacity: 10 });
    const logger = new StructuredServerLogger({
      sink: buffer,
      writeLine: () => {},
      minLevel: 'info',
    });

    logger.info('hello', { runId: 'run-a', extra: 1 });
    logger.debug('dropped', { runId: 'run-a' });
    logger.error('boom', { runId: 'run-b' });

    const all = buffer.tail();
    expect(all).toHaveLength(2);
    expect(all[0]!['event']).toBe('hello');
    expect(all[0]!['runId']).toBe('run-a');
    expect(all[1]!['event']).toBe('boom');
    expect(all[1]!['level']).toBe('error');
  });

  it('propagates the sink through child loggers and merges bindings', () => {
    const buffer = new LogRingBuffer({ capacity: 10 });
    const logger = new StructuredServerLogger({ sink: buffer, writeLine: () => {} }).child({
      component: 'run',
      runId: 'run-a',
    });

    logger.info('evt');
    const [entry] = buffer.tail();
    expect(entry).toBeDefined();
    expect(entry!['component']).toBe('run');
    expect(entry!['runId']).toBe('run-a');
  });
});

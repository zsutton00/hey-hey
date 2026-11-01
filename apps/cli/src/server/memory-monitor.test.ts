import { describe, expect, it, vi } from 'vitest';
import { PhysicalFootprintReader } from './physical-footprint';
import { StructuredServerLogger, type ServerLogEntry } from './logger';
import {
  LARGE_READ_BYTES,
  MemoryMonitor,
  reportLargeRead,
  type MemoryReading,
} from './memory-monitor';

const MB = 1024 * 1024;

const recordingLogger = (): { logger: StructuredServerLogger; entries: ServerLogEntry[] } => {
  const entries: ServerLogEntry[] = [];
  const logger = new StructuredServerLogger({
    minLevel: 'info',
    sink: { append: (entry) => entries.push(entry) },
    writeLine: () => undefined,
  });
  return { logger, entries };
};

const reading = (heapUsedMb: number): MemoryReading => ({
  heapUsed: heapUsedMb * MB,
  heapTotal: heapUsedMb * MB,
  heapLimit: 1000 * MB,
  rss: 0,
  external: 0,
  arrayBuffers: 0,
  oldSpaceUsed: heapUsedMb * MB,
  largeObjectSpaceUsed: 0,
  stdoutPendingBytes: 0,
  stderrPendingBytes: 0,
});

describe('MemoryMonitor', () => {
  it('samples heap figures and owner gauges', () => {
    const { logger, entries } = recordingLogger();
    const monitor = new MemoryMonitor({
      logger,
      gauges: () => ({ registeredRunCount: 3 }),
      readMemory: () => reading(100),
    });

    monitor.sample();

    expect(entries).toEqual([
      expect.objectContaining({
        level: 'info',
        event: 'process.memory.sample',
        heapUsedMb: 100,
        heapLimitMb: 1000,
        heapUsedRatio: 0.1,
        heapGrowthMb: 0,
        registeredRunCount: 3,
      }),
    ]);
  });

  it('reports the physical footprint once it has been read', async () => {
    const { logger, entries } = recordingLogger();
    const footprint = new PhysicalFootprintReader();
    vi.spyOn(footprint, 'refresh').mockImplementation(async () => {
      await Promise.resolve();
      vi.spyOn(footprint, 'bytes', 'get').mockReturnValue(6400 * MB);
    });
    const monitor = new MemoryMonitor({
      logger,
      gauges: () => ({}),
      readMemory: () => reading(100),
      footprint,
    });

    monitor.sample();
    await Promise.resolve();
    monitor.sample();

    expect(entries[0]).not.toHaveProperty('physicalFootprintMb');
    expect(entries[1]).toEqual(expect.objectContaining({ physicalFootprintMb: 6400 }));
  });

  it('warns once per upward pressure threshold and reports growth from the first sample', () => {
    const { logger, entries } = recordingLogger();
    const heap = [100, 600, 650, 800, 400, 800];
    const monitor = new MemoryMonitor({
      logger,
      gauges: () => ({}),
      readMemory: () => reading(heap.shift() ?? 0),
    });

    for (let index = 0; index < 6; index += 1) monitor.sample();

    expect(entries.map((entry) => [entry.event, entry['threshold']])).toEqual([
      ['process.memory.sample', undefined],
      ['process.memory.pressure', 0.5],
      ['process.memory.sample', undefined],
      ['process.memory.pressure', 0.75],
      ['process.memory.sample', undefined],
      ['process.memory.pressure', 0.75],
    ]);
    expect(entries[3]).toEqual(expect.objectContaining({ heapGrowthMb: 700 }));
  });
});

describe('reportLargeRead', () => {
  it('ignores reads below the threshold', () => {
    const { logger, entries } = recordingLogger();
    reportLargeRead(logger, 'run_store.large_event_log_read', LARGE_READ_BYTES - 1, {});
    expect(entries).toEqual([]);
  });

  it('reports large reads with their size and caller frames', () => {
    const { logger, entries } = recordingLogger();
    reportLargeRead(logger, 'run_store.large_event_log_read', 64 * MB, { runId: 'run-1' });
    expect(entries).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'run_store.large_event_log_read',
        runId: 'run-1',
        readMb: 64,
      }),
    ]);
    const caller = entries[0]?.['caller'];
    expect(
      Array.isArray(caller) &&
        caller.some((frame) => String(frame).includes('memory-monitor.test')),
    ).toBe(true);
  });
});

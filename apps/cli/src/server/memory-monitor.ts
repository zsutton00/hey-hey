import v8 from 'node:v8';
import type { ServerLogger } from './logger';

/** Current sizes of in-process owners whose growth would explain heap growth. */
type MemoryGauges = () => Readonly<Record<string, number>>;

export interface MemoryMonitorDependencies {
  readonly logger: ServerLogger;
  readonly gauges: MemoryGauges;
  readonly intervalMs?: number;
  readonly readMemory?: () => MemoryReading;
}

export interface MemoryReading {
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly heapLimit: number;
  readonly rss: number;
  readonly external: number;
  readonly arrayBuffers: number;
  /** Many retained small objects grow old space; big strings and arrays grow large-object space. */
  readonly oldSpaceUsed: number;
  readonly largeObjectSpaceUsed: number;
  /** Bytes queued for the terminal that it has not accepted yet. */
  readonly stdoutPendingBytes: number;
  readonly stderrPendingBytes: number;
}

const MB = 1024 * 1024;
const SAMPLE_INTERVAL_MS = 60_000;
/** Heap-limit fractions that raise a warning once per upward crossing. */
const MEMORY_PRESSURE_THRESHOLDS = [0.5, 0.75, 0.9] as const;

/** A single read at or above this size is reported with its caller. */
export const LARGE_READ_BYTES = 10 * MB;
const CALLER_FRAME_COUNT = 12;

const toMb = (bytes: number): number => Math.round(bytes / MB);

/**
 * Reports a whole-file read at or above `LARGE_READ_BYTES` with the heap it
 * landed on and the code path that asked for it. Fields carry sizes and stack
 * frames only, never file contents.
 */
export const reportLargeRead = (
  logger: ServerLogger,
  event: string,
  byteCount: number,
  fields: Readonly<Record<string, unknown>>,
): void => {
  if (byteCount < LARGE_READ_BYTES) return;
  const memory = readProcessMemory();
  logger.warn(event, {
    ...fields,
    readMb: toMb(byteCount),
    heapUsedMb: toMb(memory.heapUsed),
    heapLimitMb: toMb(memory.heapLimit),
    caller: (new Error().stack ?? '')
      .split('\n')
      .slice(2, 2 + CALLER_FRAME_COUNT)
      .map((frame) => frame.trim()),
  });
};

const spaceUsed = (spaces: readonly v8.HeapSpaceInfo[], name: string): number =>
  spaces.find((space) => space.space_name === name)?.space_used_size ?? 0;

const readProcessMemory = (): MemoryReading => {
  const usage = process.memoryUsage();
  const spaces = v8.getHeapSpaceStatistics();
  return {
    heapUsed: usage.heapUsed,
    heapTotal: usage.heapTotal,
    heapLimit: v8.getHeapStatistics().heap_size_limit,
    rss: usage.rss,
    external: usage.external,
    arrayBuffers: usage.arrayBuffers,
    oldSpaceUsed: spaceUsed(spaces, 'old_space'),
    largeObjectSpaceUsed: spaceUsed(spaces, 'large_object_space'),
    stdoutPendingBytes: process.stdout.writableLength,
    stderrPendingBytes: process.stderr.writableLength,
  };
};

/**
 * Samples process memory and owner sizes once a minute so heap growth can be
 * tied to an owner before the process runs out of heap. Samples go through the
 * structured logger and so reach the bounded Debug feed; nothing is written to disk.
 */
export class MemoryMonitor {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly startedAt = Date.now();
  private readonly readMemory: () => MemoryReading;
  private baselineHeapUsed: number | null = null;
  private pressureLevel = 0;

  public constructor(private readonly dependencies: MemoryMonitorDependencies) {
    this.readMemory = dependencies.readMemory ?? readProcessMemory;
  }

  public start(): void {
    if (this.timer) return;
    this.timer = setInterval(
      () => this.sample(),
      this.dependencies.intervalMs ?? SAMPLE_INTERVAL_MS,
    );
    this.timer.unref();
    this.sample();
  }

  public dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public sample(): void {
    const memory = this.readMemory();
    this.baselineHeapUsed ??= memory.heapUsed;
    const heapUsedRatio = memory.heapUsed / memory.heapLimit;
    const fields = {
      uptimeMinutes: Math.round((Date.now() - this.startedAt) / 60_000),
      heapUsedMb: toMb(memory.heapUsed),
      heapTotalMb: toMb(memory.heapTotal),
      heapLimitMb: toMb(memory.heapLimit),
      heapUsedRatio: Math.round(heapUsedRatio * 100) / 100,
      heapGrowthMb: toMb(memory.heapUsed - this.baselineHeapUsed),
      rssMb: toMb(memory.rss),
      externalMb: toMb(memory.external),
      arrayBuffersMb: toMb(memory.arrayBuffers),
      oldSpaceMb: toMb(memory.oldSpaceUsed),
      largeObjectSpaceMb: toMb(memory.largeObjectSpaceUsed),
      stdoutPendingBytes: memory.stdoutPendingBytes,
      stderrPendingBytes: memory.stderrPendingBytes,
      ...this.dependencies.gauges(),
    };
    const level = MEMORY_PRESSURE_THRESHOLDS.filter(
      (threshold) => heapUsedRatio >= threshold,
    ).length;
    if (level > this.pressureLevel) {
      this.dependencies.logger.warn('process.memory.pressure', {
        ...fields,
        threshold: MEMORY_PRESSURE_THRESHOLDS[level - 1],
      });
    } else {
      this.dependencies.logger.info('process.memory.sample', fields);
    }
    this.pressureLevel = level;
  }
}

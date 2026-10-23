import type { ServerLogEntry } from './logger';

export interface LogRingBufferTailOptions {
  runId?: string;
  triggerMessageId?: string;
  limit?: number;
}

export interface LogRingBufferOptions {
  capacity?: number;
}

const DEFAULT_CAPACITY = 500;
const ENV_KEY = 'LOG_RING_BUFFER_SIZE';

const resolveCapacity = (override: number | undefined): number => {
  if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
    return Math.floor(override);
  }
  const raw = process.env[ENV_KEY];
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_CAPACITY;
};

/**
 * Bounded in-process ring buffer of structured log entries. The server
 * logger tees every emitted entry into this buffer so the debug endpoint
 * can dump a per-run trail on demand. Capacity defaults to 500 entries and
 * is overridable via the `LOG_RING_BUFFER_SIZE` env var or an explicit
 * `capacity` option. When capacity is reached the oldest entry is
 * overwritten — memory is bounded regardless of process lifetime.
 */
export class LogRingBuffer {
  public readonly capacity: number;

  private readonly buffer: (ServerLogEntry | undefined)[];
  private head = 0;
  private count = 0;

  public constructor(options: LogRingBufferOptions = {}) {
    this.capacity = resolveCapacity(options.capacity);
    this.buffer = new Array(this.capacity);
  }

  public append(entry: ServerLogEntry): void {
    this.buffer[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count += 1;
  }

  private snapshot(): ServerLogEntry[] {
    const start = this.count < this.capacity ? 0 : this.head;
    const result: ServerLogEntry[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const entry = this.buffer[(start + i) % this.capacity];
      if (entry) result.push(entry);
    }
    return result;
  }

  public tail(opts: LogRingBufferTailOptions = {}): ServerLogEntry[] {
    let entries = this.snapshot();
    if (opts.runId !== undefined) {
      entries = entries.filter((e) => e['runId'] === opts.runId);
    }
    if (opts.triggerMessageId !== undefined) {
      entries = entries.filter((e) => e['triggerMessageId'] === opts.triggerMessageId);
    }
    if (typeof opts.limit === 'number' && opts.limit >= 0) {
      return entries.slice(-opts.limit);
    }
    return entries;
  }

  public size(): number {
    return this.count;
  }
}

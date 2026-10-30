import fs from 'node:fs/promises';
import path from 'node:path';
import { debuglog } from 'node:util';
import { parseDurableRunEvent, type DurableRunEvent } from './durable-events';
import type { RunEventLogRead, RunEventLogReadOperation } from './types';

const debug = debuglog('heyhey:run-events');
const APPEND_LOCK_DEADLINE_MS = 1_000;
const APPEND_LOCK_MAX_BACKOFF_MS = 50;

const wait = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const parseEventLine = (line: string, runId: string): DurableRunEvent => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch (error) {
    throw new Error(
      `Run ${runId} contains malformed durable event JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    return parseDurableRunEvent(parsed);
  } catch (error) {
    throw new Error(
      `Run ${runId} contains an invalid durable event: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const parseOwnedEventLine = (line: string, runId: string): DurableRunEvent => {
  const event = parseEventLine(line, runId);
  if (event.run_id !== runId) {
    throw new Error(`Durable event belongs to Run ${event.run_id}, not Run ${runId}.`);
  }
  return event;
};

/** Non-empty newline-terminated lines; an unterminated tail is an append still in progress or torn. */
export const committedLines = (text: string): string[] =>
  text
    .slice(0, text.lastIndexOf('\n') + 1)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const PROVIDER_IDENTITY_KINDS = [
  '"provider_identity_observed"',
  '"run_started"',
  '"run_completed"',
] as const;

const parseAllEvents = (text: string, runId: string): DurableRunEvent[] => {
  const events: DurableRunEvent[] = [];
  let previousSeq = 0;
  for (const line of committedLines(text)) {
    const event = parseOwnedEventLine(line, runId);
    if (event.seq !== previousSeq + 1) {
      throw new Error(`Run ${runId} durable event sequence is not contiguous.`);
    }
    previousSeq = event.seq;
    events.push(event);
  }
  return events;
};

const TAIL_CHUNK_BYTES = 64 * 1024;

const fileSize = async (filePath: string): Promise<number> => {
  try {
    return (await fs.stat(filePath)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw error;
  }
};

interface EventLogTail {
  /** Last newline-terminated, non-empty line, or null when none is committed. */
  readonly lastLine: string | null;
  /** Byte length up to and including the final newline. */
  readonly completeSize: number;
}

/** Reads backwards from the end of the log until the last committed line is found. */
const readTail = async (filePath: string, size: number): Promise<EventLogTail> => {
  if (size === 0) return { lastLine: null, completeSize: 0 };
  const handle = await fs.open(filePath, 'r');
  try {
    let buffer = Buffer.alloc(0);
    let start = size;
    for (;;) {
      const chunkStart = Math.max(0, start - TAIL_CHUNK_BYTES);
      const chunk = Buffer.alloc(start - chunkStart);
      await handle.read(chunk, 0, chunk.byteLength, chunkStart);
      buffer = Buffer.concat([chunk, buffer]);
      start = chunkStart;

      const lastNewline = buffer.lastIndexOf(0x0a);
      if (lastNewline !== -1) {
        // lastIndexOf with a negative offset searches from the end, so offset 0 is handled directly.
        const lineStartBefore = (end: number): number =>
          end === 0 ? 0 : buffer.lastIndexOf(0x0a, end - 1) + 1;
        let lineEnd = lastNewline;
        let lineStart = lineStartBefore(lineEnd);
        // Skip blank lines between committed events.
        while (
          buffer.subarray(lineStart, lineEnd).toString('utf8').trim().length === 0 &&
          lineStart > 0
        ) {
          lineEnd = lineStart - 1;
          lineStart = lineStartBefore(lineEnd);
        }
        const line = buffer.subarray(lineStart, lineEnd).toString('utf8').trim();
        const lineIsWhole = lineStart > 0 || start === 0;
        if (lineIsWhole) {
          return { lastLine: line.length > 0 ? line : null, completeSize: start + lastNewline + 1 };
        }
      } else if (start === 0) {
        return { lastLine: null, completeSize: 0 };
      }
    }
  } finally {
    await handle.close();
  }
};

export class RunEventStore {
  private readonly lastSeqs = new Map<string, { seq: number; size: number }>();

  public constructor(
    private readonly resolveEventFilePath: (runId: string) => string,
    private readonly onRead: (read: RunEventLogRead) => void = () => undefined,
  ) {}

  private eventFilePath(runId: string): string {
    return this.resolveEventFilePath(runId);
  }

  private async readEventText(
    filePath: string,
    runId: string,
    operation: RunEventLogReadOperation,
  ): Promise<string | null> {
    const startedAt = performance.now();
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    this.onRead({
      runId,
      operation,
      byteCount: bytes.byteLength,
      elapsedMs: Math.round(performance.now() - startedAt),
    });
    return bytes.toString('utf8');
  }

  public async appendEvent(runId: string, event: DurableRunEvent): Promise<void> {
    await this.appendNextEvent(runId, () => event);
  }

  public async appendNextEvent(
    runId: string,
    buildEvent: (seq: number) => DurableRunEvent,
  ): Promise<DurableRunEvent> {
    const filePath = this.eventFilePath(runId);
    await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const lockPath = `${filePath}.append-lock`;
    // Never steal a timed-out lock: a paused process may still own it.
    debug('acquiring append lock run=%s', runId);
    const startedAt = performance.now();
    let contentionAttempts = 0;
    for (;;) {
      try {
        await fs.mkdir(lockPath, { mode: 0o700 });
        break;
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST') {
          debug('append lock refused run=%s code=%s', runId, code);
          throw error;
        }
        contentionAttempts += 1;
        const elapsedMs = performance.now() - startedAt;
        const remainingMs = APPEND_LOCK_DEADLINE_MS - elapsedMs;
        if (remainingMs <= 0) {
          debug(
            'append lock timeout run=%s attempts=%d waitMs=%d',
            runId,
            contentionAttempts,
            Math.round(elapsedMs),
          );
          throw new Error(
            `Run ${runId} append lock timed out after ${contentionAttempts} contention attempts and ${Math.round(elapsedMs)} ms waiting.`,
            { cause: error },
          );
        }
        const backoffMs = Math.min(
          APPEND_LOCK_MAX_BACKOFF_MS,
          5 * 2 ** Math.min(contentionAttempts - 1, 4),
          remainingMs,
        );
        debug(
          'append lock contended run=%s attempts=%d waitMs=%d backoffMs=%d',
          runId,
          contentionAttempts,
          Math.round(elapsedMs),
          Math.round(backoffMs),
        );
        await wait(backoffMs);
        const waitedMs = performance.now() - startedAt;
        if (waitedMs >= APPEND_LOCK_DEADLINE_MS) {
          debug(
            'append lock timeout run=%s attempts=%d waitMs=%d',
            runId,
            contentionAttempts,
            Math.round(waitedMs),
          );
          throw new Error(
            `Run ${runId} append lock timed out after ${contentionAttempts} contention attempts and ${Math.round(waitedMs)} ms waiting.`,
            { cause: error },
          );
        }
      }
    }
    try {
      const previousSeq = await this.lockedLastSeq(filePath, runId);
      debug('allocating event run=%s previousSeq=%d', runId, previousSeq);
      const validated = parseDurableRunEvent(buildEvent(previousSeq + 1));
      if (validated.run_id !== runId) {
        throw new Error(`Durable event belongs to Run ${validated.run_id}, not Run ${runId}.`);
      }
      if (validated.seq !== previousSeq + 1) {
        throw new Error(
          `Durable event sequence ${String(validated.seq)} does not follow Run ${runId} sequence ${String(previousSeq)}.`,
        );
      }

      const line = Buffer.from(JSON.stringify(validated) + '\n', 'utf8');
      const sizeBefore = this.lastSeqs.get(runId)!.size;
      // A failed append may leave a torn line; drop the cache so the next append trims it.
      this.lastSeqs.delete(runId);
      await fs.appendFile(filePath, line, { mode: 0o600 });
      this.lastSeqs.set(runId, { seq: validated.seq, size: sizeBefore + line.byteLength });
      debug('event committed run=%s seq=%d', runId, validated.seq);
      return validated;
    } finally {
      await fs.rm(lockPath, { recursive: true, force: true });
      debug('append lock released run=%s', runId);
    }
  }

  /**
   * Resolves the last committed seq while holding the append lock. The cache is
   * trusted only when the file size still matches, so other writers are noticed.
   * A torn final line left by an interrupted append is trimmed before reuse.
   */
  private async lockedLastSeq(filePath: string, runId: string): Promise<number> {
    const size = await fileSize(filePath);
    const cached = this.lastSeqs.get(runId);
    if (cached && cached.size === size) return cached.seq;

    const tail = await readTail(filePath, size);
    if (tail.completeSize !== size) {
      debug('trimming torn event line run=%s bytes=%d', runId, size - tail.completeSize);
      await fs.truncate(filePath, tail.completeSize);
    }
    const seq = tail.lastLine === null ? 0 : parseOwnedEventLine(tail.lastLine, runId).seq;
    this.lastSeqs.set(runId, { seq, size: tail.completeSize });
    return seq;
  }

  public async readEvents(runId: string): Promise<DurableRunEvent[]> {
    const text = await this.readEventText(this.eventFilePath(runId), runId, 'read_events');
    if (text === null) return [];
    return parseAllEvents(text, runId);
  }

  /** Parses only the events that can carry a provider session identity. */
  public async readProviderIdentityEvents(runId: string): Promise<DurableRunEvent[]> {
    const text = await this.readEventText(
      this.eventFilePath(runId),
      runId,
      'read_provider_identity_events',
    );
    if (text === null) return [];
    return committedLines(text)
      .filter((line) => PROVIDER_IDENTITY_KINDS.some((kind) => line.includes(kind)))
      .map((line) => parseOwnedEventLine(line, runId));
  }

  public async readLastEvent(runId: string): Promise<DurableRunEvent | null> {
    const filePath = this.eventFilePath(runId);
    const tail = await readTail(filePath, await fileSize(filePath));
    return tail.lastLine === null ? null : parseOwnedEventLine(tail.lastLine, runId);
  }

  public async getLastSeq(runId: string): Promise<number> {
    const filePath = this.eventFilePath(runId);
    const size = await fileSize(filePath);
    const cached = this.lastSeqs.get(runId);
    if (cached && cached.size === size) return cached.seq;

    const tail = await readTail(filePath, size);
    const seq = tail.lastLine === null ? 0 : parseOwnedEventLine(tail.lastLine, runId).seq;
    this.lastSeqs.set(runId, { seq, size: tail.completeSize });
    return seq;
  }

  public async hasEvents(runId: string): Promise<boolean> {
    try {
      await fs.access(this.eventFilePath(runId));
      return true;
    } catch {
      return false;
    }
  }
}

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

const parseAllEvents = (text: string, runId: string): DurableRunEvent[] => {
  const events: DurableRunEvent[] = [];
  let previousSeq = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const event = parseEventLine(trimmed, runId);
    if (event.run_id !== runId) {
      throw new Error(`Durable event belongs to Run ${event.run_id}, not Run ${runId}.`);
    }
    if (event.seq !== previousSeq + 1) {
      throw new Error(`Run ${runId} durable event sequence is not contiguous.`);
    }
    previousSeq = event.seq;
    events.push(event);
  }
  return events;
};

export class RunEventStore {
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
          debug('append lock timeout run=%s attempts=%d waitMs=%d', runId, contentionAttempts, Math.round(elapsedMs));
          throw new Error(
            `Run ${runId} append lock timed out after ${contentionAttempts} contention attempts and ${Math.round(elapsedMs)} ms waiting.`,
            { cause: error },
          );
        }
        const backoffMs = Math.min(APPEND_LOCK_MAX_BACKOFF_MS, 5 * 2 ** Math.min(contentionAttempts - 1, 4), remainingMs);
        debug('append lock contended run=%s attempts=%d waitMs=%d backoffMs=%d', runId, contentionAttempts, Math.round(elapsedMs), Math.round(backoffMs));
        await wait(backoffMs);
        const waitedMs = performance.now() - startedAt;
        if (waitedMs >= APPEND_LOCK_DEADLINE_MS) {
          debug('append lock timeout run=%s attempts=%d waitMs=%d', runId, contentionAttempts, Math.round(waitedMs));
          throw new Error(
            `Run ${runId} append lock timed out after ${contentionAttempts} contention attempts and ${Math.round(waitedMs)} ms waiting.`,
            { cause: error },
          );
        }
      }
    }
    try {
      const text = (await this.readEventText(filePath, runId, 'append')) ?? '';
      const previousSeq = parseAllEvents(text, runId).at(-1)?.seq ?? 0;
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
      const line = JSON.stringify(validated) + '\n';
      const prefix = text && !text.endsWith('\n') ? `${text}\n` : text;
      const candidatePath = path.join(lockPath, 'candidate');
      await fs.writeFile(candidatePath, prefix + line, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      });
      await fs.rename(candidatePath, filePath);
      debug('event committed run=%s seq=%d', runId, validated.seq);
      return validated;
    } finally {
      await fs.rm(lockPath, { recursive: true, force: true });
      debug('append lock released run=%s', runId);
    }
  }

  public async readEvents(runId: string): Promise<DurableRunEvent[]> {
    const text = await this.readEventText(this.eventFilePath(runId), runId, 'read_events');
    if (text === null) return [];
    const events = parseAllEvents(text, runId);
    return events;
  }

  public async readLastEvent(runId: string): Promise<DurableRunEvent | null> {
    const text = await this.readEventText(this.eventFilePath(runId), runId, 'read_last_event');
    if (text === null) return null;
    const events = parseAllEvents(text, runId);
    const event = events[events.length - 1] ?? null;
    return event;
  }

  public async getLastSeq(runId: string): Promise<number> {
    const text = await this.readEventText(this.eventFilePath(runId), runId, 'read_last_seq');
    if (text === null) {
      return 0;
    }
    const events = parseAllEvents(text, runId);
    const lastSeq = events.length > 0 ? events[events.length - 1]!.seq : 0;
    return lastSeq;
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

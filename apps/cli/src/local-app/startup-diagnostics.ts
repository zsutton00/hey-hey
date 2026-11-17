import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { arch, release } from 'node:os';
import { version } from '../../package.json';
import { DiagnosticFeed, writeDirectOutput } from '../server/diagnostic-feed';
import { observeServerLogs, type ServerLogEntry, type ServerLogSink } from '../server/logger';
import { collectLocalPairingDiagnostics } from './local-pairing-diagnostics';
import { collectLocalStartupContainerDiagnostics } from './local-startup-container-diagnostics';
import { safeStartupCause, selectStartupFields } from './startup-diagnostic-boundary';

const attemptMarker = z.object({
  event: z.enum(['attempt.started', 'attempt.finished']),
  attemptId: z.string().uuid(),
  sessionId: z.string().uuid(),
  outcome: z.enum(['success', 'failed', 'cancelled', 'continued']).optional(),
});

const FILE_PATTERN = /^startup-\d{13}-[a-f0-9-]{36}\.jsonl$/u;
export const STARTUP_RETENTION = { maxFiles: 10, maxBytes: 1024 * 1024 };
const OUTCOME_EVENTS = new Set(['attempt.failure', 'attempt.finished', 'attempt.interrupted']);
const isUnresolved = (attempt: PreviousAttempt) =>
  attempt.hadFailure || attempt.outcome !== 'success';
const outcomeReserve = (maxBytes: number) => Math.min(4096, Math.floor(maxBytes / 4));

interface PreviousAttempt {
  attemptId: string;
  sessionId: string;
  outcome: string;
  /** True when any attempt in the journal ended without success, even if a retry later succeeded. */
  hadFailure: boolean;
}

/** One invocation owns a bounded journal. Retry markers preserve the earlier failure in place. */
export class StartupDiagnostics implements ServerLogSink {
  readonly feed = new DiagnosticFeed();
  readonly sessionId = randomUUID();
  attemptId = randomUUID();
  readonly path: string;
  private fd: number | undefined;
  private bytes = 0;
  private truncated = false;
  private storageFailure: unknown;
  private failed = false;
  private closed = false;
  private collecting: Promise<void> = Promise.resolve();
  private readonly unsubscribe: () => void;
  private seq = 0;

  constructor(
    readonly directory: string,
    private readonly limits = STARTUP_RETENTION,
    private readonly terminal: (text: string) => void = (text) =>
      writeDirectOutput(() => {
        writeSync(2, `${text}\n`);
      }),
  ) {
    let previousAttempt: PreviousAttempt | null = null;
    let lastFailedAttempt: PreviousAttempt | null = null;
    let previousEvidenceError: unknown;
    this.path = join(directory, `startup-${Date.now()}-${this.sessionId}.jsonl`);
    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
        throw Object.assign(new Error(), { code: 'ELOOP' });
      }
      chmodSync(directory, 0o700);
      const files = readdirSync(directory)
        .filter((file) => FILE_PATTERN.test(file))
        .sort();
      const history = files.map((file) => {
        try {
          return {
            file,
            attempt: this.readPreviousAttempt(join(directory, file)),
            error: undefined,
          };
        } catch (error) {
          return { file, attempt: null, error };
        }
      });
      const latest = history.at(-1);
      previousAttempt = latest?.attempt ?? null;
      previousEvidenceError = latest?.error;
      lastFailedAttempt =
        [...history].reverse().find((item) => item.attempt !== null && isUnresolved(item.attempt))
          ?.attempt ?? null;
      // Successful journals are evicted first so earlier failures survive routine runs.
      const excess = Math.max(0, files.length - limits.maxFiles + 1);
      const evictable = [
        ...history.filter((item) => item.attempt !== null && !isUnresolved(item.attempt)),
        ...history.filter((item) => item.attempt === null || isUnresolved(item.attempt)),
      ].slice(0, excess);
      for (const item of evictable) {
        unlinkSync(join(directory, item.file));
      }
      this.fd = openSync(
        this.path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
    } catch (error) {
      this.storageFailed(error);
    }
    this.record('attempt.started', {
      previousAttemptId:
        previousAttempt?.outcome === 'success' ? null : (previousAttempt?.attemptId ?? null),
      previousSessionId: previousAttempt?.sessionId ?? null,
      lastFailedAttemptId: lastFailedAttempt?.attemptId ?? null,
      lastFailedSessionId: lastFailedAttempt?.sessionId ?? null,
      previousOutcome: previousAttempt?.outcome ?? null,
      ...(previousEvidenceError !== undefined
        ? { previousEvidenceError: safeStartupCause(previousEvidenceError) }
        : {}),
      cliVersion: version,
      nodeVersion: process.versions.node,
      platform: process.platform,
      architecture: arch(),
      osRelease: release(),
      terminal: Boolean(process.stdin.isTTY),
      completionRule:
        'Incomplete or interrupted unless attempt.finished follows; events beyond the size limit are omitted.',
      containerEvidence: 'Collected on handled failure; interruption may prevent collection.',
      retention: limits,
    });
    this.unsubscribe = observeServerLogs(this);
    process.on('exit', this.onExit);
  }

  private readPreviousAttempt(path: string): PreviousAttempt | null {
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const buffer = Buffer.alloc(this.limits.maxBytes + 1);
      const bytes = readSync(fd, buffer, 0, buffer.length, 0);
      if (bytes > this.limits.maxBytes) {
        throw Object.assign(new Error(), { code: 'EFBIG' });
      }
      let last: PreviousAttempt | null = null;
      let failedSoFar = false;
      let open = false;
      for (const line of buffer.subarray(0, bytes).toString('utf8').trim().split('\n')) {
        // Malformed or partial prior evidence is reported, never treated as empty history.
        const marker = attemptMarker.safeParse(JSON.parse(line));
        if (!marker.success) {
          continue;
        }
        if (marker.data.event === 'attempt.started') {
          failedSoFar ||= open;
          open = true;
          last = {
            attemptId: marker.data.attemptId,
            sessionId: marker.data.sessionId,
            outcome: 'interrupted',
            hadFailure: failedSoFar,
          };
        } else if (last?.attemptId === marker.data.attemptId) {
          last.outcome = marker.data.outcome ?? 'interrupted';
          open = false;
          failedSoFar ||= last.outcome !== 'success';
          last.hadFailure = failedSoFar;
        }
      }
      return last;
    } finally {
      closeSync(fd);
    }
  }

  append(entry: ServerLogEntry): void {
    const fields = selectStartupFields(entry.event, entry);
    if (fields) {
      this.record(entry.event, fields, entry.level);
      if (entry.level === 'error') {
        this.notify(`Local startup cause: ${entry.event} ${JSON.stringify(fields)}`);
      }
    }
  }

  retry(): void {
    this.record('attempt.finished', { outcome: this.failed ? 'failed' : 'continued' });
    const previousAttemptId = this.attemptId;
    this.attemptId = randomUUID();
    this.failed = false;
    this.record('attempt.started', { previousAttemptId });
  }

  record(
    event: string,
    fields: Record<string, unknown>,
    level: ServerLogEntry['level'] = 'info',
    attemptId = this.attemptId,
  ): void {
    if (this.closed) {
      return;
    }
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      sessionId: this.sessionId,
      attemptId,
      seq: ++this.seq,
      ...fields,
    };
    this.feed.append(entry);
    // Outcome markers stay writable inside the reserve so a full journal still says how it ended.
    const outcomeMarker = OUTCOME_EVENTS.has(event);
    if (this.fd === undefined || (this.truncated && !outcomeMarker)) {
      return;
    }
    const line = `${JSON.stringify(entry)}\n`;
    const ceiling = outcomeMarker
      ? this.limits.maxBytes
      : this.limits.maxBytes - outcomeReserve(this.limits.maxBytes);
    if (this.bytes + Buffer.byteLength(line) > ceiling) {
      if (!outcomeMarker) {
        this.truncateJournal(entry.timestamp, attemptId);
      }
      return;
    }
    this.write(line);
  }

  private truncateJournal(timestamp: string, attemptId: string): void {
    this.truncated = true;
    this.write(
      `${JSON.stringify({ timestamp, event: 'evidence.truncated', attemptId, seq: ++this.seq, reasonCode: 'journal_size_limit', completion: 'incomplete', maxBytes: this.limits.maxBytes })}\n`,
    );
    this.notify(`Local diagnostic evidence truncated at ${this.path}; later events are not saved.`);
  }

  failure(): void {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.record('attempt.failure', { reasonCode: 'see_preceding_boundary_event' }, 'error');
    this.describe();
    const attemptId = this.attemptId;
    this.collecting = this.collecting.then(async () => {
      const records = [
        ...(await collectLocalPairingDiagnostics()),
        ...(await collectLocalStartupContainerDiagnostics()),
      ];
      for (const record of records) {
        this.record('container.evidence', record, 'info', attemptId);
      }
    });
  }

  describe(): void {
    this.notify(
      this.storageFailure !== undefined
        ? `Local attempt ${this.attemptId}: diagnostic log was not fully saved (${JSON.stringify(safeStartupCause(this.storageFailure))}). Intended location: ${this.path}. Earlier terminal failure remains the startup cause.`
        : `Local attempt ${this.attemptId}: ${this.truncated ? 'partial' : 'saved'} diagnostic log: ${this.path}`,
    );
  }

  async finish(outcome: 'success' | 'failed' | 'cancelled'): Promise<void> {
    await this.collecting;
    this.record('attempt.finished', {
      outcome: this.failed ? 'failed' : outcome,
      evidenceComplete: !this.truncated && this.storageFailure === undefined,
    });
    this.close();
  }

  private write(line: string): void {
    if (this.fd === undefined) {
      return;
    }
    try {
      const buffer = Buffer.from(line);
      let offset = 0;
      while (offset < buffer.length) {
        const written = writeSync(this.fd, buffer, offset);
        if (written === 0) {
          throw Object.assign(new Error(), { code: 'EIO' });
        }
        offset += written;
      }
      fsyncSync(this.fd);
      this.bytes += buffer.length;
    } catch (error) {
      this.storageFailed(error);
    }
  }

  private notify(text: string): void {
    try {
      this.terminal(text);
    } catch (error) {
      // A closed terminal cannot report its own failure. Preserve the safe reason in memory.
      this.feed.append({
        timestamp: new Date().toISOString(),
        level: 'error',
        event: 'terminal.unavailable',
        error: safeStartupCause(error),
      });
    }
  }

  private storageFailed(error: unknown): void {
    this.storageFailure = error;
    this.notify(
      `Local diagnostic storage failed: ${JSON.stringify(safeStartupCause(error))}. Evidence is missing or incomplete; startup recovery continues.`,
    );
    if (this.fd !== undefined) {
      const fd = this.fd;
      this.fd = undefined;
      try {
        closeSync(fd);
      } catch (closeError) {
        this.notify(
          `Local diagnostic close failed: ${JSON.stringify(safeStartupCause(closeError))}.`,
        );
      }
    }
  }

  private readonly onExit = (): void => {
    this.record('attempt.interrupted', {
      reasonCode: 'process_exit_without_completion',
      completion: 'incomplete',
    });
    this.close();
  };

  private close(): void {
    if (this.closed) {
      return;
    }
    if (this.fd !== undefined) {
      try {
        fsyncSync(this.fd);
        closeSync(this.fd);
        this.fd = undefined;
      } catch (error) {
        this.storageFailed(error);
        this.describe();
      }
    }
    this.closed = true;
    this.unsubscribe();
    process.off('exit', this.onExit);
    this.feed.dispose();
  }
}

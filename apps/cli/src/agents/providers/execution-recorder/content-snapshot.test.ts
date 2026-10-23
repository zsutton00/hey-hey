import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ContentSnapshot } from './content-snapshot';
import { ObservationStore } from './observation-store';
import { StructuredServerLogger, type ServerLogEntry } from '../../../server/logger';
import type { CaptureIdentity } from './observation';

describe('snapshot progress diagnostics', () => {
  it('reports a blocked blob write with its identity and clears the heartbeat after completion', async () => {
    const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hh-progress-')));
    const root = path.join(directory, 'repo');
    await fs.mkdir(root);
    const contents = 'snapshot fixture';
    await fs.writeFile(path.join(root, 'file.txt'), contents);
    const entries: ServerLogEntry[] = [];
    const logger = new StructuredServerLogger({
      minLevel: 'debug',
      writeLine: () => {},
      sink: { append: (entry) => entries.push(entry) },
    });
    const identity: CaptureIdentity = {
      sessionId: 'session',
      runId: 'run',
      turnId: 'turn',
      provider: 'codex',
      providerSessionId: 'provider-session',
      providerTurnId: 'provider-turn',
      toolCallId: 'tool-call',
      toolName: 'Bash',
    };
    const store = new ObservationStore(path.join(directory, 'evidence'), logger);
    const putBlob = store.putBlob.bind(store);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const writing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    vi.spyOn(store, 'putBlob').mockImplementation(async (bytes) => {
      entered();
      await blocked;
      return putBlob(bytes);
    });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const capture = new ContentSnapshot(store, logger).capture(
      [{ serviceId: 'service', root }],
      identity,
      'baseline',
    );
    try {
      await writing;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(
        entries.find((entry) => entry.event === 'execution_capture.snapshot_progress'),
      ).toMatchObject({
        ...identity,
        snapshotPhase: 'baseline',
        snapshotId: expect.any(String),
        serviceId: 'service',
        repoRelativePath: 'file.txt',
        operation: 'blob_write',
        operationElapsedMs: 10_000,
        fileCount: 0,
        directoryCount: 1,
        byteCount: Buffer.byteLength(contents),
      });
      release();
      const snapshot = await capture;
      expect(snapshot.entries).toHaveLength(1);
      expect(snapshot.entries[0]?.gap).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
      expect(
        entries.find((entry) => entry.event === 'execution_capture.snapshot_finished'),
      ).toMatchObject({ fileCount: 1, blobWriteMs: 10_000 });
    } finally {
      release();
      await capture;
      vi.useRealTimers();
      vi.restoreAllMocks();
      await fs.rm(directory, { recursive: true, force: true });
    }
  });
});

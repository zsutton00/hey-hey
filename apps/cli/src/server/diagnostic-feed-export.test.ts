import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DiagnosticFeed } from './diagnostic-feed';
import { diagnosticExportFilename, writeDiagnosticExport } from './diagnostic-feed-export';
import { ControlReductionTelemetry } from './control-reduction-telemetry';
import { StructuredServerLogger } from './logger';
import { randomUUID } from 'node:crypto';

const temporaryDirectories: string[] = [];

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'heyhey-debug-export-'));
  temporaryDirectories.push(directory);
  return directory;
};

const capture = (feed: DiagnosticFeed, text: string, seq: number): void => {
  feed.capture({
    stream: 'stderr',
    source: 'write',
    text,
    timestamp: new Date(Date.parse('2026-10-07T12:00:00.000Z') + seq).toISOString(),
  });
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('diagnosticExportFilename', () => {
  it('suggests a timestamped JSONL name without colons', () => {
    expect(diagnosticExportFilename(new Date('2026-10-07T12:34:56.789Z'))).toBe(
      'debug-2026-10-07T12-34-56.789Z.jsonl',
    );
  });
});

describe('writeDiagnosticExport', () => {
  it('includes pending repetition counts in the snapshot without leaking record payloads', async () => {
    const destination = path.join(await temporaryDirectory(), 'debug.jsonl');
    const feed = new DiagnosticFeed();
    const telemetry = new ControlReductionTelemetry(
      new StructuredServerLogger({ sink: feed, writeLine: () => undefined }),
      feed,
    );
    const record = {
      key: randomUUID(),
      messageId: randomUUID(),
      agentSessionId: randomUUID(),
      runId: randomUUID(),
      admissionId: randomUUID(),
      organizationId: randomUUID(),
      projectId: randomUUID(),
      userId: randomUUID(),
      machineId: randomUUID(),
      fingerprint: 'private',
      state: 'cancelled' as const,
      admissionDisposition: 'queued' as const,
      revision: 2,
      projectedRevision: 0,
      sequence: 0,
      kind: null,
      keyKind: 'operation' as const,
      payload: null,
      turnId: null,
      settlement: null,
      settlementDelivered: false,
    };
    telemetry.cancellation(record, false);
    telemetry.cancellation(record, false);
    const snapshot = feed.snapshot();
    telemetry.cancellation(record, false);
    const result = await writeDiagnosticExport(snapshot, destination);
    const lines = (await readFile(result.path, 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ repetitionCount: 1, retainedCount: 2 });
    expect(JSON.parse(lines[2].text)).toMatchObject({ repetitionCount: 1, reason: 'snapshot' });
    expect(await readFile(result.path, 'utf8')).not.toContain('private');
    telemetry.dispose();
    feed.dispose();
  });

  it('writes the oldest retained records first to the chosen path and reports held and evicted counts', async () => {
    const destination = path.join(await temporaryDirectory(), 'chosen.jsonl');
    const feed = new DiagnosticFeed({ maxRecords: 2, maxBytes: 1024, maxRecordTextBytes: 128 });
    capture(feed, 'evicted first', 1);
    capture(feed, 'retained oldest', 2);
    capture(feed, 'retained newest', 3);
    const snapshot = feed.snapshot();
    capture(feed, 'appended after snapshot', 4);

    const result = await writeDiagnosticExport(snapshot, destination);

    expect(result).toEqual({ path: destination, count: 2, evictedCount: 1, expiredCount: 0 });
    expect((await stat(destination)).mode & 0o777).toBe(0o600);
    const lines = (await readFile(destination, 'utf8')).trimEnd().split('\n');
    expect(JSON.parse(lines[0]!)).toMatchObject({
      kind: 'diagnostic_metadata',
      retainedCount: 2,
      evictedCount: 1,
      losses: snapshot.losses,
      coverage: snapshot.coverage,
    });
    expect(lines.slice(1)).toEqual(snapshot.records.map((record) => JSON.stringify(record)));
  });

  it('replaces a file the user confirmed overwriting', async () => {
    const destination = path.join(await temporaryDirectory(), 'existing.jsonl');
    await writeFile(destination, 'old contents');
    await writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination);
    expect(await readFile(destination, 'utf8')).not.toContain('old contents');
  });

  it('discloses empty coverage for an empty feed', async () => {
    const destination = path.join(await temporaryDirectory(), 'empty.jsonl');
    const result = await writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination);

    expect(result.count).toBe(0);
    expect(JSON.parse(await readFile(result.path, 'utf8'))).toMatchObject({
      kind: 'diagnostic_metadata',
      retainedCount: 0,
      coverage: { oldestTimestamp: null, newestTimestamp: null },
    });
  });

  it('rejects when the destination cannot be written', async () => {
    const destination = path.join(await temporaryDirectory(), 'missing', 'debug.jsonl');
    await expect(
      writeDiagnosticExport(new DiagnosticFeed().snapshot(), destination),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

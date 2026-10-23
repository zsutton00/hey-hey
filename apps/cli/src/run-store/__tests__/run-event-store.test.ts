import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { RunEventStore } from '../run-event-store';
import type { DurableRunEvent } from '../durable-events';
import type { RunEventLogRead } from '../types';

let root: string;

const event = (overrides: Partial<DurableRunEvent> = {}): DurableRunEvent => ({
  schema_version: 1,
  seq: 1,
  ts: '2026-09-03T00:00:00.000Z',
  app_session_id: 'run-1',
  run_id: 'run-1',
  actor: 'app',
  state_version: 1,
  event_type: 'run_started',
  payload: {
    kind: 'run_started',
    mode: 'prompt',
    prompt: 'Inspect the repository',
    adapterId: 'claude',
    repositoryPath: '/tmp/repository',
    provider: 'claude',
    providerSessionId: null,
    providerConversationId: null,
    providerSessionAgentId: null,
    observedAt: '2026-09-03T00:00:00.000Z',
  },
  ...overrides,
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-event-store-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('RunEventStore', () => {
  it('allocates from disk across independent writers with stale observations', async () => {
    const stores = Array.from(
      { length: 8 },
      () => new RunEventStore(() => path.join(root, 'run-1.jsonl')),
    );
    await Promise.all(stores.map((store) => expect(store.getLastSeq('run-1')).resolves.toBe(0)));
    const results = await Promise.all(
      stores.map((store) => store.appendNextEvent('run-1', (seq) => event({ seq }))),
    );
    expect(results.map((result) => result.seq).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const reopened = new RunEventStore(() => path.join(root, 'run-1.jsonl'));
    expect((await reopened.readEvents('run-1')).map((record) => record.seq)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
  });

  it('excludes independent processes and permits safe retry', async () => {
    const modulePath = path.resolve('src/run-store/run-event-store.ts');
    const filePath = path.join(root, 'run-1.jsonl');
    const script = `
      const { RunEventStore } = require(${JSON.stringify(modulePath)});
      const store = new RunEventStore(() => ${JSON.stringify(filePath)});
      (async () => {
        for (let i = 0; i < 10; i++) {
          await store.appendNextEvent('run-1', seq => ({ ...${JSON.stringify(event())}, seq }));
        }
      })().catch(error => { console.error(error); process.exitCode = 1; });
    `;
    await Promise.all(
      Array.from({ length: 3 }, () =>
        promisify(execFile)(process.execPath, ['--import', 'tsx', '-e', script]),
      ),
    );
    const reopened = new RunEventStore(() => filePath);
    expect((await reopened.readEvents('run-1')).map((record) => record.seq)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
  });

  it('times out on an unreleased lock without removing it or publishing an event', async () => {
    const filePath = path.join(root, 'run-1.jsonl');
    const lockPath = `${filePath}.append-lock`;
    await fs.mkdir(lockPath);
    const store = new RunEventStore(() => filePath);

    await expect(store.appendNextEvent('run-1', (seq) => event({ seq }))).rejects.toThrow(
      /append lock timed out after \d+ contention attempts and \d+ ms waiting/,
    );
    expect((await fs.stat(lockPath)).isDirectory()).toBe(true);
    await expect(fs.access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('propagates non-contention lock errors without retrying', async () => {
    const filePath = path.join(root, 'run-1.jsonl');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const originalMkdir = fs.mkdir.bind(fs);
    const mkdir = vi.spyOn(fs, 'mkdir');
    const failure = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    mkdir.mockImplementation(async (requestedPath, options) => {
      if (requestedPath === `${filePath}.append-lock`) throw failure;
      return originalMkdir(requestedPath, options);
    });
    const store = new RunEventStore(() => filePath);

    await expect(store.appendNextEvent('run-1', (seq) => event({ seq }))).rejects.toBe(failure);
    expect(mkdir).toHaveBeenCalledTimes(2);
    mkdir.mockRestore();
  });

  it('preserves journal bytes on failed publication and releases ownership', async () => {
    const filePath = path.join(root, 'run-1.jsonl');
    const store = new RunEventStore(() => filePath);
    await store.appendEvent('run-1', event());
    const before = await fs.readFile(filePath);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('publication failed'));
    await expect(store.appendNextEvent('run-1', (seq) => event({ seq }))).rejects.toThrow(
      'publication failed',
    );
    rename.mockRestore();
    expect(await fs.readFile(filePath)).toEqual(before);
    await expect(store.appendNextEvent('run-1', (seq) => event({ seq }))).resolves.toMatchObject({
      seq: 2,
    });
  });

  it('appends and reads only the validated durable event union', async () => {
    const store = new RunEventStore((runId) => path.join(root, `${runId}.jsonl`));
    await store.appendEvent('run-1', event());

    await expect(store.readEvents('run-1')).resolves.toEqual([event()]);
    await expect(store.getLastSeq('run-1')).resolves.toBe(1);
  });

  it('rejects provider envelopes at the authoritative append boundary', async () => {
    const store = new RunEventStore((runId) => path.join(root, `${runId}.jsonl`));
    const invalid = event({
      payload: {
        kind: 'run_started',
        mode: 'prompt',
        prompt: 'Inspect the repository',
        adapterId: 'claude',
        repositoryPath: '/tmp/repository',
        provider: 'claude',
        providerSessionId: null,
        providerConversationId: null,
        providerSessionAgentId: null,
        observedAt: '2026-09-03T00:00:00.000Z',
        raw_event: { type: 'init' },
      } as DurableRunEvent['payload'],
    });

    await expect(store.appendEvent('run-1', invalid)).rejects.toThrow();
    await expect(fs.access(path.join(root, 'run-1.jsonl'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('fails closed when an authoritative file contains malformed JSON', async () => {
    const filePath = path.join(root, 'run-1.jsonl');
    await fs.writeFile(filePath, '{not-json}\n', 'utf8');
    const store = new RunEventStore(() => filePath);

    await expect(store.readEvents('run-1')).rejects.toThrow(/malformed durable event JSON/);
  });

  it('reports the size of every whole-file read, including the read inside each append', async () => {
    const filePath = path.join(root, 'run-1.jsonl');
    const reads: RunEventLogRead[] = [];
    const store = new RunEventStore(
      () => filePath,
      (read) => reads.push(read),
    );

    // A missing log is not a read.
    await store.readEvents('run-1');
    await store.appendEvent('run-1', event());
    const size = (await fs.stat(filePath)).size;
    await store.appendEvent('run-1', event({ seq: 2 }));
    await store.getLastSeq('run-1');
    await store.readLastEvent('run-1');
    await store.readEvents('run-1');

    const grown = (await fs.stat(filePath)).size;
    expect(
      reads.map(({ runId, operation, byteCount }) => ({ runId, operation, byteCount })),
    ).toEqual([
      { runId: 'run-1', operation: 'append', byteCount: size },
      { runId: 'run-1', operation: 'read_last_seq', byteCount: grown },
      { runId: 'run-1', operation: 'read_last_event', byteCount: grown },
      { runId: 'run-1', operation: 'read_events', byteCount: grown },
    ]);
  });
});

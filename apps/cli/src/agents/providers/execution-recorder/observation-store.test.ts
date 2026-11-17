import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { ExecutionRecorder } from './execution-recorder';
import { ContentSnapshot } from './content-snapshot';
import { ObservationStore } from './observation-store';
import { NOOP_LOGGER } from '../../../server/logger';
import type { CaptureIdentity } from './observation';

let directory: string;
let root: string;
const identity: CaptureIdentity = {
  sessionId: 'session',
  runId: 'run',
  turnId: 'turn',
  provider: 'codex',
  providerSessionId: 'provider',
  providerTurnId: 'native-turn',
  toolCallId: 'call',
  toolName: 'Bash',
};
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'hh-store-')));
  root = path.join(directory, 'repo');
  await fs.mkdir(root);
  execFileSync('git', ['init', '-q', root]);
  await fs.writeFile(path.join(root, 'file'), 'baseline');
});
afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('execution evidence persistence', () => {
  it.each([
    { runId: 'other-run', turnId: identity.turnId },
    { runId: identity.runId, turnId: 'other-turn' },
  ])("does not wait for another scope's blocked baseline: %j", async (otherScope) => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    const otherIdentity = { ...identity, ...otherScope, toolCallId: 'other-call' };
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const capturing = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const capture = vi
      .spyOn(ContentSnapshot.prototype, 'capture')
      .mockImplementationOnce(async () => {
        entered();
        await blocked;
        return { entries: [], rootFailures: [] };
      });
    const begin = recorder.begin(otherIdentity, [{ serviceId: 'service', root }], '0.156.0');
    try {
      await capturing;
      let settled = false;
      const interrupt = recorder.interrupt(identity.runId, identity.turnId).then(() => {
        settled = true;
      });
      await expect.poll(() => settled, { timeout: 1000 }).toBe(true);
      await interrupt;
      expect((await recorder.store.read())[0]).toMatchObject({
        identity: otherIdentity,
        state: 'pending',
        before: null,
        after: null,
      });
    } finally {
      release();
      await begin;
      capture.mockRestore();
    }
  });

  it('does not upgrade a failed baseline publication after the tool runs', async () => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    const save = recorder.store.save.bind(recorder.store);
    const spy = vi
      .spyOn(recorder.store, 'save')
      .mockImplementationOnce(save)
      .mockRejectedValueOnce(new Error('disk failure'));
    const roots = [{ serviceId: 'service', root }];
    await expect(recorder.begin(identity, roots, '0.156.0')).rejects.toThrow('disk failure');
    spy.mockRestore();
    await fs.writeFile(path.join(root, 'file'), 'after failed baseline publication');
    await recorder.finish(identity, roots, '0.156.0', 'success', true);
    const record = (await recorder.store.read())[0]!;
    expect(record.state).toBe('incomplete');
    expect(record.gaps).toContain('missing_baseline');
  });
  it('retains incompatible source bytes without blocking subsequent capture', async () => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    await recorder.begin(identity, [{ serviceId: 'service', root }], '0.156.0');
    const records = path.join(directory, 'evidence', 'observations');
    const filename = path.join(records, (await fs.readdir(records))[0]!);
    const envelope = JSON.parse(await fs.readFile(filename, 'utf8'));
    envelope.schemaVersion = 999;
    const source = JSON.stringify(envelope);
    await fs.writeFile(filename, source);
    const restarted = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    await expect(
      restarted.begin(
        { ...identity, toolCallId: 'next' },
        [{ serviceId: 'service', root }],
        '0.156.0',
      ),
    ).resolves.toBeUndefined();
    expect(await fs.readFile(filename, 'utf8')).toBe(source);
    expect(await fs.readdir(records)).toHaveLength(2);
  });

  it('ignores historical observations during admission and prunes only the consumed turn', async () => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    const roots = [{ serviceId: 'service', root }];
    await recorder.begin(identity, roots, 'test');
    await fs.writeFile(path.join(root, 'file'), 'first edit');
    await recorder.finish(identity, roots, 'test', 'success', true);
    const first = (await recorder.store.read())[0]!;
    const records = path.join(directory, 'evidence', 'observations');
    for (let index = 0; index < 200; index += 1) {
      await fs.writeFile(path.join(records, `historical-${index}.json`), 'unreadable old record');
    }
    const next = { ...identity, turnId: 'next', toolCallId: 'next' };
    const reads = vi.spyOn(fs, 'readFile');
    await recorder.begin(next, roots, 'test');
    expect(reads.mock.calls.some(([file]) => String(file).includes('historical-'))).toBe(false);
    reads.mockRestore();
    await recorder.releaseTurn(identity.runId, identity.turnId);
    await expect(fs.access(path.join(records, `${first.id}.json`))).rejects.toThrow();
    expect(await fs.readdir(path.join(directory, 'evidence', 'pending'))).toHaveLength(1);
    expect(recorder.capturedFileChanges('run', 'turn', 'service', 'file')).toEqual([]);
    expect(await fs.readFile(path.join(records, 'historical-0.json'), 'utf8')).toBe(
      'unreadable old record',
    );
  });

  it('marks post-only evidence as missing its baseline', async () => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    await recorder.finish(identity, [{ serviceId: 'service', root }], '0.156.0', 'failure', false);
    const record = (await recorder.store.read())[0]!;
    expect(record.before).toBeNull();
    expect(record.after).not.toBeNull();
    expect(record.gaps).toContain('missing_baseline');
    expect(record.state).toBe('incomplete');
  });

  it('keeps content blobs immutable, private, and checksum-validated', async () => {
    const store = new ObservationStore(path.join(directory, 'evidence'), NOOP_LOGGER);
    const bytes = Buffer.from([0, 255, 42]);
    const hash = await store.putBlob(bytes);
    expect(await store.putBlob(bytes)).toBe(hash);
    const blob = path.join(directory, 'evidence', 'blobs', hash);
    expect((await fs.stat(blob)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.dirname(blob))).mode & 0o777).toBe(0o700);
    await fs.writeFile(blob, 'corrupt');
    await expect(store.readBlob(hash)).rejects.toThrow('checksum');
  });

  it.each(['metadata', 'baseline', 'after-blob'] as const)(
    'recovers a process interrupted after %s without synthesizing completion',
    async (stage) => {
      const script = path.join(directory, 'crash.cjs');
      await fs.writeFile(
        script,
        `require(${JSON.stringify(require.resolve('tsx/cjs'))});
const {ExecutionRecorder}=require(${JSON.stringify(path.join(process.cwd(), 'src/agents/providers/execution-recorder/execution-recorder.ts'))});
const {NOOP_LOGGER}=require(${JSON.stringify(path.join(process.cwd(), 'src/server/logger.ts'))});
const recorder=new ExecutionRecorder(${JSON.stringify(path.join(directory, 'evidence'))},NOOP_LOGGER);
const stage=${JSON.stringify(stage)};
const save=recorder.store.save.bind(recorder.store);
recorder.store.save=async value=>{await save(value);if(stage==='metadata')process.exit(0);};
const blob=recorder.store.putBlob.bind(recorder.store);let blobs=0;
recorder.store.putBlob=async bytes=>{const hash=await blob(bytes);if(++blobs===2 && stage==='after-blob')process.exit(0);return hash;};
(async()=>{await recorder.begin(${JSON.stringify(identity)},${JSON.stringify([{ serviceId: 'service', root }])},'0.156.0');
if(stage==='baseline')process.exit(0);
require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'file'))},'changed');
await recorder.finish(${JSON.stringify(identity)},${JSON.stringify([{ serviceId: 'service', root }])},'0.156.0','success',true);})();`,
      );
      const child = spawn(process.execPath, [script], { stdio: 'ignore' });
      expect(await new Promise((resolve) => child.on('exit', resolve))).toBe(0);
      const store = new ObservationStore(path.join(directory, 'evidence'), NOOP_LOGGER);
      const record = (await store.read())[0]!;
      expect(record.state).toBe('incomplete');
      expect(record.gaps).toContain('interrupted');
      if (stage === 'metadata') expect(record.gaps).toContain('missing_baseline');
      else expect(record.before).not.toBeNull();
      expect(record.after).toBeNull();
      expect(record.endedAt).toBeNull();
    },
  );

  it('retains overlap across independent processes without locking repository execution', async () => {
    const script = path.join(directory, 'overlap.cjs');
    const roots = [{ serviceId: 'service', root }];
    await fs.writeFile(
      script,
      `require(${JSON.stringify(require.resolve('tsx/cjs'))});
const {ExecutionRecorder}=require(${JSON.stringify(path.join(process.cwd(), 'src/agents/providers/execution-recorder/execution-recorder.ts'))});
const {NOOP_LOGGER}=require(${JSON.stringify(path.join(process.cwd(), 'src/server/logger.ts'))});
const recorder=new ExecutionRecorder(${JSON.stringify(path.join(directory, 'evidence'))},NOOP_LOGGER);
recorder.begin(${JSON.stringify(identity)},${JSON.stringify(roots)},'0.156.0').then(()=>{
process.stdout.write('ready');process.stdin.once('data',async()=>{await recorder.finish(${JSON.stringify(identity)},${JSON.stringify(roots)},'0.156.0','success',true);process.exit(0);});});`,
    );
    const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'ignore'] });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.once('data', () => resolve());
        child.once('error', reject);
        child.once('exit', () => reject(new Error('child exited before baseline')));
      });
      const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
      const other = { ...identity, runId: 'other-run', toolCallId: 'other-call' };
      await recorder.begin(other, roots, '0.156.0');
      await recorder.finish(other, roots, '0.156.0', 'success', true);
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.stdin.end('finish');
      expect(await exited).toBe(0);
      const records = await recorder.store.read();
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(record.gaps).toContain('overlap');
        expect(record.state).toBe('incomplete');
      }
    } finally {
      child.kill();
    }
  });

  it('retains unresolved writer evidence without indexing finished Bash captures as active', async () => {
    const recorder = new ExecutionRecorder(path.join(directory, 'evidence'), NOOP_LOGGER);
    const roots = [{ serviceId: 'service', root }];
    for (let index = 0; index < 8; index += 1) {
      const next = { ...identity, toolCallId: `shell-${String(index)}` };
      await recorder.begin(next, roots, 'test');
      await fs.writeFile(path.join(root, 'file'), `edit ${String(index)}`);
      await recorder.finish(next, roots, 'test', 'success', false);
      // Reports have not consumed any observations, as with a failed report write.
      expect(await recorder.store.list('pending')).toEqual([]);
    }
    const records = await recorder.store.read();
    expect(records).toHaveLength(8);
    for (const record of records) {
      expect(record.endedAt).toBeNull();
      expect(record.gaps).toContain('writer_lifetime_unresolved');
      expect(record.gaps).not.toContain('overlap');
    }
  });
});

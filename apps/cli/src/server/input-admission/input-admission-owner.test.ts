import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { access, copyFile, mkdtemp, readdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NOOP_LOGGER } from '../logger';
import { InputAdmissionOwner } from './input-admission-owner';
import { InputAdmissionStore, OPEN_SESSION_INDEX_FILE } from './input-admission-store';
import { storedInput, type InputIdentity } from './input-admission-codec';

describe('durable input admission', () => {
  let directory: string;
  let input: InputIdentity;
  let payload: ReturnType<typeof makePayload>;
  const makePayload = (identity: InputIdentity) =>
    storedInput('session_message', 'operation', {
      kind: 'session_message',
      generation: 1,
      platformAdmissionId: identity.key,
      input: {
        sourceSessionId: identity.agentSessionId,
        interactionId: randomUUID(),
        attemptId: randomUUID(),
        authorKind: 'AGENT',
        objective: 'Investigate',
        authority: {
          kind: 'MACHINE_SESSION',
          machineId: identity.machineId,
          sourceSessionId: identity.agentSessionId,
          targetSessionId: identity.agentSessionId,
          subagentCapability: 'RESEARCH',
        },
      },
    });
  const reviewRecovery = (replacesTurnId: string) =>
    storedInput('run_follow_up', 'operation', {
      kind: 'run_follow_up',
      origin: 'review_service_recovery',
      replacesTurnId,
      requestId: 'recovery-1',
      agentInput: { promptType: 'code_review' },
    });
  const logger = NOOP_LOGGER;
  /** These cases exercise the waiting path; reservation has its own cases below. */
  const waits = () => false;
  const paths = () => ({
    directory: join(directory, 'inputs'),
    legacyStoreFile: join(directory, 'input-admission.json'),
  });
  const open = () => new InputAdmissionOwner(paths(), logger);
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'input-admission-'));
    input = {
      key: randomUUID(),
      fingerprint: 'a'.repeat(64),
      agentSessionId: randomUUID(),
      runId: randomUUID(),
      organizationId: randomUUID(),
      projectId: randomUUID(),
      userId: randomUUID(),
      machineId: randomUUID(),
      messageId: randomUUID(),
    };
    payload = makePayload(input);
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  const reviewFrame = (identity: InputIdentity) => {
    const event = {
      promptType: 'user_message',
      operationId: identity.key,
      operationFingerprint: identity.fingerprint,
      triggerMessageId: randomUUID(),
      sourceUserMessageId: identity.messageId!,
      payload: { handlerPromptType: 'code_review', userMessage: 'Review.', attachments: [] },
    };
    return storedInput('trigger_frame', 'operation', {
      conversationId: randomUUID(),
      signedEvent: event,
      event,
    });
  };

  it('atomically retires a live Review wait and reserves its stable replacement across restart', async () => {
    let owner = open();
    const frame = reviewFrame(input);
    const original = await owner.admit(input, frame, () => true);
    const turnId = original.record.turnId!;
    await owner.transition(input.agentSessionId, input.key, 'started');
    const recovery = { ...input, key: randomUUID(), fingerprint: 'b'.repeat(64), messageId: null };
    const recoveryPayload = reviewRecovery(turnId);
    const admitted = await owner.admit(recovery, recoveryPayload, () => true, turnId);
    expect(admitted.record.state).toBe('picked');
    expect(
      (await owner.session(input.agentSessionId)).find((item) => item.key === input.key),
    ).toMatchObject({ state: 'cancelled', payload: frame.payload });
    owner = open();
    expect((await owner.admit(recovery, recoveryPayload, () => true, turnId)).replayed).toBe(true);
    expect(
      (await owner.session(input.agentSessionId)).filter((item) => item.state === 'picked'),
    ).toHaveLength(1);
  });

  it('rejects a replacement if canonical Review settlement wins the admission race', async () => {
    const owner = open();
    const original = await owner.admit(input, reviewFrame(input), () => true);
    await owner.transition(input.agentSessionId, input.key, 'started');
    await owner.transition(input.agentSessionId, input.key, 'settled', { reports: [] });
    const recovery = { ...input, key: randomUUID(), messageId: null };
    await expect(
      owner.admit(
        recovery,
        reviewRecovery(original.record.turnId!),
        () => true,
        original.record.turnId!,
      ),
    ).rejects.toThrow('already settled');
    expect(await owner.session(input.agentSessionId)).toHaveLength(1);
  });
  it('persists exponential backoff and exhaustion across restarts and revisions', async () => {
    await open().admit(input, payload, waits);
    let now = 1000;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const reserved = await open().reserveProjection(input.agentSessionId, input.key, now);
      expect(reserved?.projectionRetry?.attempts).toBe(attempt);
      const delay = 5000 * 2 ** (attempt - 1);
      expect(reserved?.projectionRetry?.nextAttemptAt).toBe(now + delay);
      expect(
        await open().reserveProjection(input.agentSessionId, input.key, now + delay - 1),
      ).toBeNull();
      now += delay;
    }
    await open().transition(input.agentSessionId, input.key, 'failed');
    expect(
      await open().reserveProjection(input.agentSessionId, input.key, now + 1_000_000),
    ).toBeNull();
    const [record] = await open().session(input.agentSessionId);
    expect(record?.projectedRevision).toBe(0);
    expect(record?.projectionRetry?.attempts).toBe(3);
  });

  it('never exhausts the projection budget of a started record', async () => {
    const owner = open();
    await owner.admit(input, payload, waits);
    await owner.pickup(input.agentSessionId);
    await owner.transition(input.agentSessionId, input.key, 'started');
    let now = 1000;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const reserved = await owner.reserveProjection(input.agentSessionId, input.key, now);
      expect(reserved?.projectionRetry?.attempts).toBe(attempt);
      const delay = Math.min(5000, 250 * 2 ** (attempt - 1));
      expect(reserved?.projectionRetry?.nextAttemptAt).toBe(now + delay);
      now += delay;
    }
  });

  it('clears the failure budget only after projection acknowledgement, not settlement', async () => {
    await open().admit(input, payload, waits);
    await open().reserveProjection(input.agentSessionId, input.key, 1000);
    await open().acknowledge(input.agentSessionId, input.key, 0, true);
    expect((await open().session(input.agentSessionId))[0]?.projectionRetry?.attempts).toBe(1);
    await open().acknowledge(input.agentSessionId, input.key, 1);
    expect((await open().session(input.agentSessionId))[0]?.projectionRetry?.attempts).toBe(0);
    await open().transition(input.agentSessionId, input.key, 'failed');
    expect(
      (await open().reserveProjection(input.agentSessionId, input.key, 1001))?.projectionRetry
        ?.attempts,
    ).toBe(1);
  });

  it('reserves an idle session for immediate execution as picked, without a projection', async () => {
    const owner = open();
    const gate = vi.fn(() => true);
    const { record, replayed } = await owner.admit(input, payload, gate);
    expect(replayed).toBe(false);
    expect(gate).toHaveBeenCalledWith(input);
    expect(record).toMatchObject({
      state: 'picked',
      admissionDisposition: 'immediate',
      revision: 2,
      projectedRevision: 0,
    });
    expect(record.turnId).not.toBeNull();
    // Pickup delivers the reserved input itself rather than selecting another.
    expect(await owner.pickup(input.agentSessionId)).toEqual(record);
    expect(await owner.reserveProjection(input.agentSessionId, input.key)).toBeNull();
  });
  it('queues behind an earlier open input without consulting the gate', async () => {
    for (const earlier of ['queued', 'started'] as const) {
      const owner = open();
      const first = { ...input, key: randomUUID(), agentSessionId: randomUUID() };
      await owner.admit(first, makePayload(first), waits);
      if (earlier === 'started') {
        await owner.pickup(first.agentSessionId);
        await owner.transition(first.agentSessionId, first.key, 'started');
      }
      const second = { ...first, key: randomUUID(), messageId: randomUUID() };
      const gate = vi.fn(() => true);
      const { record } = await owner.admit(second, makePayload(second), gate);
      expect(gate).not.toHaveBeenCalled();
      expect(record).toMatchObject({
        state: 'queued',
        admissionDisposition: 'queued',
        turnId: null,
      });
    }
  });
  it('queues when the gate refuses an otherwise idle session', async () => {
    const { record } = await open().admit(input, payload, waits);
    expect(record).toMatchObject({ state: 'queued', admissionDisposition: 'queued' });
  });
  it('reserves only the first of two rapid admissions', async () => {
    const owner = open();
    const second = { ...input, key: randomUUID(), messageId: randomUUID() };
    const [first, next] = await Promise.all([
      owner.admit(input, payload, () => true),
      owner.admit(second, makePayload(second), () => true),
    ]);
    expect(first.record.admissionDisposition).toBe('immediate');
    expect(next.record).toMatchObject({ state: 'queued', admissionDisposition: 'queued' });
    expect(await owner.pickup(input.agentSessionId)).toEqual(first.record);
  });
  it('replays the recorded disposition across restart regardless of the current gate', async () => {
    const first = await open().admit(input, payload, () => true);
    const replay = await open().admit(input, payload, waits);
    expect(replay.replayed).toBe(true);
    expect(replay.record).toEqual(first.record);
    expect(replay.record.admissionDisposition).toBe('immediate');
  });
  it('recovers accepted input and joins duplicate delivery without changing order or authority', async () => {
    const first = await open().admit(input, payload, waits);
    const owner = open();
    const replay = await owner.admit(input, payload, waits);
    expect(replay.replayed).toBe(true);
    expect(replay.record).toEqual(first.record);
    expect(await owner.session(input.agentSessionId)).toHaveLength(1);
    expect(first.record.admissionId).not.toBe(input.key);
    await expect(
      owner.admit({ ...input, fingerprint: 'b'.repeat(64) }, payload, waits),
    ).rejects.toThrow('mismatch');
    await expect(
      owner.admit({ ...input, machineId: randomUUID() }, payload, waits),
    ).rejects.toThrow('mismatch');
  });
  it('retains cancellation arriving before delivery through restart', async () => {
    await open().cancel(input);
    const owner = open();
    expect((await owner.admit(input, payload, waits)).record.state).toBe('cancelled');
    expect(await owner.pickup(input.agentSessionId)).toBeNull();
  });
  it('serializes cancellation ahead of pickup', async () => {
    const owner = open();
    await owner.admit(input, payload, waits);
    const [cancelled, picked] = await Promise.all([
      owner.cancel(input),
      owner.pickup(input.agentSessionId),
    ]);
    expect(cancelled.state).toBe('cancelled');
    expect(picked).toBeNull();
  });
  it('serializes pickup ahead of cancellation and retains its selected identity', async () => {
    const owner = open();
    await owner.admit(input, payload, waits);
    const [picked, cancelled] = await Promise.all([
      owner.pickup(input.agentSessionId),
      owner.cancel(input),
    ]);
    expect(cancelled.state).toBe('picked');
    expect((await open().pickup(input.agentSessionId))?.turnId).toBe(picked?.turnId);
    expect(picked?.turnId).not.toBe(picked?.admissionId);
  });
  it('never reexecutes started input and holds later input until settlement delivery', async () => {
    let owner = open();
    await owner.admit(input, payload, waits);
    const second = { ...input, key: randomUUID(), messageId: randomUUID() };
    await owner.admit(second, makePayload(second), waits);
    const picked = await owner.pickup(input.agentSessionId);
    await owner.transition(input.agentSessionId, input.key, 'started');
    owner = open();
    expect(await owner.pickup(input.agentSessionId)).toBeNull();
    await owner.transition(input.agentSessionId, input.key, 'settled', {
      turnId: picked?.turnId ?? '',
      reports: [],
    });
    owner = open();
    expect(await owner.pickup(input.agentSessionId)).toBeNull();
    await owner.acknowledge(input.agentSessionId, input.key, 0, true);
    expect((await owner.pickup(input.agentSessionId))?.key).toBe(second.key);
    expect((await owner.admit(input, payload, waits)).record.state).toBe('settled');
  });
  it('retains pending projection revisions and ignores delayed acknowledgements', async () => {
    const owner = open();
    await owner.admit(input, payload, waits);
    await owner.pickup(input.agentSessionId);
    const started = await owner.transition(input.agentSessionId, input.key, 'started');
    expect((await open().session(input.agentSessionId))[0]?.projectedRevision).toBe(0);
    await owner.acknowledge(input.agentSessionId, input.key, started.revision);
    await owner.acknowledge(input.agentSessionId, input.key, 1);
    expect((await open().session(input.agentSessionId))[0]?.projectedRevision).toBe(
      started.revision,
    );
  });
  it('preserves unsupported durable source bytes', async () => {
    await open().admit(input, payload, waits);
    const file = join(paths().directory, `${input.agentSessionId}.json`);
    const bytes = await readFile(file, 'utf8');
    const unsupported = bytes.replace(/"schemaVersion":\s*\d+/, '"schemaVersion":999');
    await writeFile(file, unsupported);
    expect(unsupported).not.toBe(bytes);
    await expect(open().session(input.agentSessionId)).rejects.toThrow();
    expect(await readFile(file, 'utf8')).toBe(unsupported);
  });
  it('migrates current records from the retired single-file store and removes it', async () => {
    await copyFile(
      join(__dirname, '__fixtures__', 'legacy-input-admission.json'),
      paths().legacyStoreFile,
    );
    const opened = open();
    await opened.openIndex();
    const migrated = (
      await Promise.all(opened.openSessionIds().map((sessionId) => opened.session(sessionId)))
    ).flat();
    expect(migrated.map((record) => record.state).sort()).toEqual(['queued', 'settled', 'started']);
    // Records written before admission recorded a disposition were all admitted to wait.
    expect(new Set(migrated.map((record) => record.admissionDisposition))).toEqual(
      new Set(['queued']),
    );
    await expect(access(paths().legacyStoreFile)).rejects.toThrow();
    const reopened = open();
    await reopened.openIndex();
    expect(reopened.openSessionIds().sort()).toEqual(opened.openSessionIds().sort());
    const sessionOf = (state: string) =>
      migrated.find((record) => record.state === state)?.agentSessionId ?? '';
    expect((await reopened.pickup(sessionOf('queued')))?.state).toBe('picked');
    expect(await reopened.pickup(sessionOf('started'))).toBeNull();
  });
  it('commits each session to its own file', async () => {
    const other = { ...input, key: randomUUID(), agentSessionId: randomUUID() };
    const owner = open();
    await owner.admit(input, payload, waits);
    await owner.admit(other, makePayload(other), waits);
    expect((await readdir(paths().directory)).sort()).toEqual(
      [
        `${input.agentSessionId}.json`,
        `${other.agentSessionId}.json`,
        OPEN_SESSION_INDEX_FILE,
      ].sort(),
    );
    const before = await readFile(join(paths().directory, `${other.agentSessionId}.json`), 'utf8');
    await owner.pickup(input.agentSessionId);
    expect(await readFile(join(paths().directory, `${other.agentSessionId}.json`), 'utf8')).toBe(
      before,
    );
  });
  it('rejects a payload that does not decode as its stored kind before acknowledgement or pickup', async () => {
    await expect(
      open().admit(
        input,
        {
          kind: 'session_message',
          keyKind: 'operation',
          payload: { missingAuthority: true },
        } as never,
        waits,
      ),
    ).rejects.toThrow('not storable');
    expect(await open().session(input.agentSessionId)).toHaveLength(0);
  });
  it('attributes receipt time to the session queue wait and persistence separately', async () => {
    const debug = vi.fn();
    const owner = new InputAdmissionOwner(paths(), { ...NOOP_LOGGER, debug, info: vi.fn() });
    const write = InputAdmissionStore.prototype.writeSession;
    let delayed = true;
    vi.spyOn(InputAdmissionStore.prototype, 'writeSession').mockImplementation(async function (
      this: InputAdmissionStore,
      ...args: Parameters<typeof write>
    ) {
      if (delayed) {
        delayed = false;
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      return write.apply(this, args);
    });
    const second = { ...input, key: randomUUID() };
    await Promise.all([
      owner.admit(input, payload, waits),
      owner.admit(second, makePayload(second), waits),
    ]);
    const committed = debug.mock.calls
      .filter(([event]) => event === 'input_admission.committed')
      .map(([, fields]) => fields);
    expect(committed[0]).toMatchObject({ operationId: input.key, sessionRecordCount: 1 });
    expect(committed[0].persistMs).toBeGreaterThanOrEqual(70);
    expect(committed[0].queueWaitMs).toBeLessThan(70);
    expect(committed[1]).toMatchObject({ operationId: second.key, sessionRecordCount: 2 });
    expect(committed[1].queueWaitMs).toBeGreaterThanOrEqual(70);
    expect(committed[1].persistMs).toBeLessThan(70);
    expect(JSON.stringify(committed)).not.toContain('Investigate');
    vi.restoreAllMocks();
  });
  const indexFile = () => join(paths().directory, OPEN_SESSION_INDEX_FILE);
  const readIndex = async (): Promise<string[]> =>
    JSON.parse(await readFile(indexFile(), 'utf8')).sessionIds;
  it('lists a session in the open index only while it has an open record', async () => {
    const owner = open();
    await owner.admit({ ...input, messageId: null }, payload, waits);
    expect(await readIndex()).toEqual([input.agentSessionId]);
    await owner.transition(input.agentSessionId, input.key, 'failed');
    expect(await readIndex()).toEqual([]);
    expect(owner.openSessionIds()).toEqual([]);
    // Closed records are kept forever, so replay still recognizes the key.
    expect((await open().admit({ ...input, messageId: null }, payload, waits)).replayed).toBe(true);
  });
  it('keeps a finished record open until its status report is delivered or exhausted', async () => {
    const owner = open();
    await owner.admit(input, payload, waits);
    await owner.transition(input.agentSessionId, input.key, 'failed');
    expect(owner.openSessionIds()).toEqual([input.agentSessionId]);
    let now = 1000;
    for (let attempt = 1; attempt <= 3; attempt++) {
      const reserved = await owner.reserveProjection(input.agentSessionId, input.key, now);
      now = reserved!.projectionRetry!.nextAttemptAt;
    }
    expect(owner.openSessionIds()).toEqual([]);
    expect(await readIndex()).toEqual([]);
  });
  it('reads only the indexed sessions at startup and drops listed sessions with nothing open', async () => {
    const owner = open();
    const closed = { ...input, key: randomUUID(), agentSessionId: randomUUID(), messageId: null };
    await owner.admit(input, payload, waits);
    await owner.cancel(closed);
    // A crash may leave an extra session in the index, never a missing one.
    await writeFile(
      indexFile(),
      JSON.stringify({
        schemaVersion: 1,
        sessionIds: [input.agentSessionId, closed.agentSessionId],
      }),
    );
    const read = vi.spyOn(InputAdmissionStore.prototype, 'readSession');
    const restarted = open();
    await restarted.openIndex();
    expect(read.mock.calls.map(([sessionId]) => sessionId).sort()).toEqual(
      [input.agentSessionId, closed.agentSessionId].sort(),
    );
    expect(restarted.openSessionIds()).toEqual([input.agentSessionId]);
    expect(await readIndex()).toEqual([input.agentSessionId]);
    read.mockClear();
    // A closed session is read from its file the first time it is named.
    expect((await restarted.admit(closed, makePayload(closed), waits)).record.state).toBe(
      'cancelled',
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(closed.agentSessionId);
    vi.restoreAllMocks();
  });
  it.each([
    ['missing', null],
    ['unreadable', 'not json'],
    ['unsupported', JSON.stringify({ schemaVersion: 2, sessionIds: [] })],
  ])(
    'rebuilds a %s open index from the session files instead of reading it as empty',
    async (_, bytes) => {
      await open().admit(input, payload, waits);
      await rm(indexFile());
      if (bytes !== null) await writeFile(indexFile(), bytes);
      const restarted = open();
      await restarted.openIndex();
      expect(restarted.openSessionIds()).toEqual([input.agentSessionId]);
      expect(await readIndex()).toEqual([input.agentSessionId]);
      expect((await restarted.pickup(input.agentSessionId))?.key).toBe(input.key);
    },
  );
  it.each(['indexed', 'rebuilt'])(
    'isolates an unparseable queue file with a %s index and preserves it across writes and restarts',
    async (mode) => {
      const owner = open();
      await owner.admit(input, payload, waits);
      const badFile = join(paths().directory, `${input.agentSessionId}.json`);
      const badBytes = (await readFile(badFile, 'utf8')).slice(0, -1);
      await writeFile(badFile, badBytes);
      if (mode === 'rebuilt') await rm(indexFile());

      const healthy = { ...input, key: randomUUID(), agentSessionId: randomUUID() };
      const restarted = open();
      await expect(restarted.openIndex()).resolves.toBeUndefined();
      expect(restarted.openSessionIds()).toEqual([]);
      await expect(restarted.session(input.agentSessionId)).rejects.toThrow(
        'its file is preserved',
      );
      await restarted.admit(healthy, makePayload(healthy), waits);
      expect((await restarted.pickup(healthy.agentSessionId))?.key).toBe(healthy.key);
      expect(await readIndex()).toEqual(
        expect.arrayContaining([input.agentSessionId, healthy.agentSessionId]),
      );
      expect(await readFile(badFile, 'utf8')).toBe(badBytes);

      const again = open();
      await expect(again.openIndex()).resolves.toBeUndefined();
      expect(again.openSessionIds()).toEqual([healthy.agentSessionId]);
      expect(await readFile(badFile, 'utf8')).toBe(badBytes);
    },
  );
  it('never loses an open record when the process dies around an index write', async () => {
    const writeIndex = vi.spyOn(InputAdmissionStore.prototype, 'writeOpenSessionIndex');
    // The index is written before the record that opens a session: if that write fails,
    // the input is never committed, so it was never acknowledged.
    writeIndex.mockRejectedValueOnce(new Error('disk full'));
    await expect(open().admit(input, payload, waits)).rejects.toThrow('disk full');
    expect(await open().session(input.agentSessionId)).toEqual([]);
    const owner = open();
    await owner.admit({ ...input, messageId: null }, payload, waits);
    // The index is written after the record that closes a session: a failure leaves an
    // extra entry, which the next startup drops.
    writeIndex.mockRejectedValueOnce(new Error('crashed'));
    await owner.transition(input.agentSessionId, input.key, 'failed');
    expect(await readIndex()).toEqual([input.agentSessionId]);
    const restarted = open();
    await restarted.openIndex();
    expect(restarted.openSessionIds()).toEqual([]);
    vi.restoreAllMocks();
  });
  it('persists settlement backoff until delivery and clears it on acknowledgement', async () => {
    const owner = open();
    await owner.admit({ ...input, messageId: null }, payload, waits);
    const picked = await owner.pickup(input.agentSessionId);
    await owner.transition(input.agentSessionId, input.key, 'started');
    await owner.transition(input.agentSessionId, input.key, 'settled', {
      turnId: picked!.turnId!,
      reports: [],
    });
    const first = await owner.reserveSettlement(input.agentSessionId, input.key, 1000);
    expect(first?.settlementRetry).toEqual({ attempts: 1, nextAttemptAt: 6000 });
    expect(owner.earliestDueAt()).toBe(6000);
    expect(owner.sessionsWithDue(5999)).toEqual([]);
    expect(owner.sessionsWithDue(6000)).toEqual([input.agentSessionId]);
    expect(await open().reserveSettlement(input.agentSessionId, input.key, 5999)).toBeNull();
    const second = await open().reserveSettlement(input.agentSessionId, input.key, 6000);
    expect(second?.settlementRetry).toEqual({ attempts: 2, nextAttemptAt: 16000 });
    const restarted = open();
    await restarted.acknowledge(input.agentSessionId, input.key, 0, true);
    const [record] = await open().session(input.agentSessionId);
    expect(record?.settlementDelivered).toBe(true);
    expect(record).not.toHaveProperty('settlementRetry');
    expect(restarted.openSessionIds()).toEqual([]);
    expect(restarted.earliestDueAt()).toBeNull();
  });
});

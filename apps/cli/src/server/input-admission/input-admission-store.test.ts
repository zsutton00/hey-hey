import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { NOOP_LOGGER } from '../logger';
import { validateUserMessageTriggerPayload } from '../conversation-dispatch/trigger-payload-schemas';
import { InputAdmissionOwner } from './input-admission-owner';
import { InputAdmissionStore } from './input-admission-store';
import { INPUT_QUEUE_SCHEMA_VERSION, storedInput } from './input-admission-codec';
import { PromptTypeRegistry } from '../../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../agents/prompt-type-registry.test-support';

const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

/** A record exactly as schemaVersion 1 wrote it: the raw signed frame, no kind or key kind. */
export const v1FrameRecord = (
  sessionId: string,
  event: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) => {
  const key = randomUUID();
  const machineId = randomUUID();
  const userId = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  return {
    key,
    fingerprint: 'a'.repeat(64),
    agentSessionId: sessionId,
    runId: sessionId,
    organizationId,
    projectId,
    machineId,
    userId,
    messageId: randomUUID(),
    payload: {
      organizationId,
      projectId,
      conversationId: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'trigger.conversation',
      envelope: {
        machineId,
        userId,
        nonce: randomUUID(),
        timestampMs: Date.now(),
        signature: 'signature',
        protocolVersion: 2,
        authorization: { kind: 'bounded_grant', grantId: randomUUID() },
        event: {
          // Only operation-carrying triggers sign an operation identity.
          ...(event['promptType'] === 'start_run' || event['promptType'] === 'user_message'
            ? { operationId: key, operationFingerprint: 'a'.repeat(64) }
            : {}),
          triggerMessageId: randomUUID(),
          ...event,
        },
      },
    },
    admissionId: randomUUID(),
    sequence: 0,
    state: 'queued',
    turnId: null,
    revision: 1,
    projectedRevision: 0,
    settlement: null,
    settlementDelivered: false,
    ...overrides,
  };
};

const userMessageEvent = (payload: Record<string, unknown>) => ({
  promptType: 'user_message',
  sourceUserMessageId: randomUUID(),
  payload,
});
/** The open plan-shaping iterate trigger that predates its required context. */
const contextlessIterate = {
  promptType: 'plan_shaping_feature_sync_iterate',
  nodeId: 'plan-shaping-feature-sync-iterate',
  payload: { userMessage: 'Iterate.' },
};

describe('input queue session storage', () => {
  let directory: string;
  const sessions = () => join(directory, 'inputs');
  const file = (sessionId: string) => join(sessions(), `${sessionId}.json`);
  const paths = () => ({ directory: sessions(), legacyStoreFile: join(directory, 'legacy.json') });
  const writeV1 = async (sessionId: string, records: unknown[]) => {
    await mkdir(sessions(), { recursive: true });
    await writeFile(file(sessionId), JSON.stringify({ schemaVersion: 1, records }));
  };
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'input-queue-store-'));
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it('migrates a v1 user_message without attachments to attachments: [], keeping its signed bytes', async () => {
    const sessionId = randomUUID();
    const record = v1FrameRecord(
      sessionId,
      userMessageEvent({ handlerPromptType: 'coding_freeform', userMessage: 'Continue.' }),
    );
    await writeV1(sessionId, [record]);

    const { records, quarantined } = await new InputAdmissionStore(
      paths(),
      NOOP_LOGGER,
    ).readSession(sessionId);

    expect(quarantined).toEqual([]);
    const [migrated] = records;
    expect(migrated).toMatchObject({ kind: 'trigger_frame', keyKind: 'operation' });
    expect(migrated?.admissionDisposition).toBe('queued');
    if (migrated?.kind !== 'trigger_frame' || migrated.state !== 'queued') throw new Error();
    expect(migrated.payload.event).toMatchObject({
      promptType: 'user_message',
      payload: { userMessage: 'Continue.', attachments: [] },
    });
    expect(migrated.payload.signedEvent).toEqual(record.payload.envelope.event);
    const written = JSON.parse(await readFile(file(sessionId), 'utf8'));
    expect(written.schemaVersion).toBe(INPUT_QUEUE_SCHEMA_VERSION);
  });

  it('stamps key kinds once from the v1 shape', async () => {
    const sessionId = randomUUID();
    const direct = v1FrameRecord(sessionId, { promptType: 'startup_session', payload: {} });
    await writeV1(sessionId, [direct]);
    const [record] = (await new InputAdmissionStore(paths(), NOOP_LOGGER).readSession(sessionId))
      .records;
    expect(record?.keyKind).toBe('trigger_message');
  });

  it('keeps finished history as history: drifted payloads load without being re-judged', async () => {
    const sessionId = randomUUID();
    const settled = v1FrameRecord(
      sessionId,
      { promptType: 'retired_prompt_type', payload: { anything: true } },
      {
        state: 'settled',
        turnId: randomUUID(),
        revision: 4,
        projectedRevision: 4,
        settlement: { terminalOutcome: 'COMPLETED' },
        settlementDelivered: true,
      },
    );
    const failed = v1FrameRecord(sessionId, contextlessIterate, { state: 'failed', revision: 2 });
    await writeV1(sessionId, [settled, failed]);

    const { records, quarantined } = await new InputAdmissionStore(
      paths(),
      NOOP_LOGGER,
    ).readSession(sessionId);

    expect(quarantined).toEqual([]);
    expect(records.map((record) => [record.key, record.state])).toEqual([
      [settled.key, 'settled'],
      [failed.key, 'failed'],
    ]);
    expect(records[0]?.settlement).toEqual({ terminalOutcome: 'COMPLETED' });
  });

  it('quarantines an open record with no defined migration, keeping its bytes through later commits', async () => {
    const sessionId = randomUUID();
    const unreadable = v1FrameRecord(sessionId, contextlessIterate, {
      state: 'picked',
      turnId: randomUUID(),
      revision: 2,
    });
    await writeV1(sessionId, [unreadable]);
    const warn = vi.fn();
    const owner = new InputAdmissionOwner(paths(), {
      ...NOOP_LOGGER,
      debug: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
      warn,
    });

    expect(await owner.session(sessionId)).toEqual([]);
    expect(await owner.quarantinedKeys(sessionId)).toEqual([unreadable.key]);
    expect(warn).toHaveBeenCalledWith(
      'input_admission.record_quarantined',
      expect.objectContaining({
        agentSessionId: sessionId,
        recordKey: unreadable.key,
        reason: expect.stringContaining('discrepancies'),
        preserved: true,
      }),
    );

    // New input is still admitted and executed in the same session.
    const next = {
      key: randomUUID(),
      fingerprint: 'b'.repeat(64),
      agentSessionId: sessionId,
      runId: sessionId,
      organizationId: randomUUID(),
      projectId: randomUUID(),
      machineId: randomUUID(),
      userId: randomUUID(),
      messageId: null,
    };
    await owner.admit(
      next,
      storedInput('run_follow_up', 'operation', {
        kind: 'run_follow_up',
        origin: 'permission_recovery',
        requestId: 'request-1',
        agentInput: { promptType: 'coding_freeform', userMessage: 'Retry.' },
      }),
      () => false,
    );
    expect((await owner.pickup(sessionId))?.key).toBe(next.key);

    const written = JSON.parse(await readFile(file(sessionId), 'utf8'));
    expect(written.records.map((record: { key: string }) => record.key)).toEqual([next.key]);
    expect(written.quarantined).toEqual([
      {
        key: unreadable.key,
        reason: expect.stringContaining('decisions'),
        sourceSchemaVersion: 1,
        raw: unreadable,
      },
    ]);
    const reopened = new InputAdmissionOwner(paths(), NOOP_LOGGER);
    expect(await reopened.quarantinedKeys(sessionId)).toEqual([unreadable.key]);
    expect((await reopened.session(sessionId)).map((record) => record.sequence)).toEqual([1]);
  });

  it('stores an open frame the current wire schema would reject, as the admitted bytes it is', async () => {
    const payload = { handlerPromptType: 'coding_freeform', userMessage: '', attachments: [] };
    expect(() => validateUserMessageTriggerPayload(payload, promptTypeRegistry)).toThrow();
    const sessionId = randomUUID();
    await writeV1(sessionId, [v1FrameRecord(sessionId, userMessageEvent(payload))]);
    const { records, quarantined } = await new InputAdmissionStore(
      paths(),
      NOOP_LOGGER,
    ).readSession(sessionId);
    expect(quarantined).toEqual([]);
    expect(records).toHaveLength(1);
  });

  it.each([
    ['bad JSON', '{"schemaVersion":1,"records":['],
    ['a newer schemaVersion', JSON.stringify({ schemaVersion: 99, records: [] })],
  ])('keeps a session file with %s unreadable and untouched', async (_case, bytes) => {
    const sessionId = randomUUID();
    await mkdir(sessions(), { recursive: true });
    await writeFile(file(sessionId), bytes);
    const error = vi.fn();
    await expect(
      new InputAdmissionStore(paths(), { ...NOOP_LOGGER, error }).readSession(sessionId),
    ).rejects.toThrow('its file is preserved');
    expect(error).toHaveBeenCalledWith(
      'input_admission.session_incompatible',
      expect.objectContaining({ familyId: `input-queue:${sessionId}`, preserved: true }),
    );
    expect(await readFile(file(sessionId), 'utf8')).toBe(bytes);
  });
});

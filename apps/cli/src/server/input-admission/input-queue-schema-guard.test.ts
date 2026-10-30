import { decodeStoredRecordV9 } from './storage-schema/v9';
import { migrateSessionFileV8ToV9 } from './storage-schema/v8-to-v9';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import { NOOP_LOGGER } from '../logger';
import { INPUT_QUEUE_SCHEMA_VERSION } from './input-admission-codec';
import { InputAdmissionStore } from './input-admission-store';
import { migrateSessionFileV2ToV3 } from './storage-schema/v2-to-v3';
import {
  INPUT_QUEUE_MIGRATIONS,
  SHIPPED_INPUT_QUEUE_VERSIONS,
  inputQueueSchemaFingerprint,
} from './input-queue-schema-versions';

const SHIP_A_NEW_VERSION =
  'Stored input queue schemas changed. Never edit a shipped storage module: add a new ' +
  'storage-schema version, register the migration from the previous version, commit a ' +
  'fixture the previous version wrote, and append the new version with its fingerprint ' +
  'to SHIPPED_INPUT_QUEUE_VERSIONS.';

const NEW_PROMPT_TYPE =
  'A LocalPromptType is missing from the newest stored input queue schema, so a start-run ' +
  'payload for it throws at admission. Never edit a shipped storage module: add a v5 ' +
  'storage-schema module that lists it, register the v4 -> v5 migration, commit a fixture ' +
  'v4 wrote, and append v5 with its fingerprint to SHIPPED_INPUT_QUEUE_VERSIONS.';

/** Every enumeration a stored schema accepts as a `handlerPromptType`. */
const storedHandlerPromptTypes = (node: unknown): string[][] => {
  if (Array.isArray(node)) return node.flatMap(storedHandlerPromptTypes);
  if (typeof node !== 'object' || node === null) return [];
  const { properties } = node as { properties?: Record<string, { enum?: string[] }> };
  const own = properties?.['handlerPromptType']?.enum;
  return [...(own ? [own] : []), ...Object.values(node).flatMap(storedHandlerPromptTypes)];
};

describe('input queue storage versions', () => {
  it('adds empty references only to executable handler events, preserving signed and finished history', async () => {
    const { sessions } = JSON.parse(
      await readFile(join(__dirname, '__fixtures__/input-queue-v2.json'), 'utf8'),
    );
    const file = Object.values(sessions)[0] as {
      records: Array<Record<string, any>>;
      quarantined: unknown[];
    };
    const template = file.records.find((record) => record['kind'] === 'trigger_frame')!;
    const signedEvent = {
      promptType: 'start_run',
      payload: {
        handlerPromptType: 'coding_freeform',
        payload: { promptType: 'coding_freeform', userMessage: 'exact' },
      },
    };
    const frame = {
      conversationId: '00000000-0000-4000-8000-000000000001',
      signedEvent,
      event: signedEvent,
    };
    const open = { ...template, state: 'queued', payload: frame };
    const finished = { ...template, state: 'failed', payload: frame };
    const workflow = {
      ...open,
      payload: { ...frame, event: { promptType: 'start_run', payload: { workflowName: 'plan' } } },
    };
    const result = migrateSessionFileV2ToV3({
      records: [open, finished, workflow],
      quarantined: [],
    }) as any;
    expect(result.records[0].payload.event.payload.attachments).toEqual([]);
    expect(result.records[0].payload.signedEvent).toEqual(signedEvent);
    expect(result.records[0].fingerprint).toBe(template['fingerprint']);
    expect(result.records[1]).toEqual(finished);
    expect(result.records[2]).toEqual(workflow);
  });
  it('writes the newest shipped version, reachable from every older one by migration and fixture', () => {
    const versions = SHIPPED_INPUT_QUEUE_VERSIONS.map((entry) => entry.schemaVersion);
    expect(versions).toEqual(versions.map((_, index) => index + 1));
    expect(versions.at(-1)).toBe(INPUT_QUEUE_SCHEMA_VERSION);
    for (const entry of SHIPPED_INPUT_QUEUE_VERSIONS.slice(0, -1)) {
      expect(INPUT_QUEUE_MIGRATIONS.has(entry.schemaVersion), SHIP_A_NEW_VERSION).toBe(true);
      expect(entry.fixture, SHIP_A_NEW_VERSION).not.toBeNull();
    }
    expect([...INPUT_QUEUE_MIGRATIONS.keys()].sort((a, b) => a - b)).toEqual(versions.slice(0, -1));
  });

  it.each(SHIPPED_INPUT_QUEUE_VERSIONS.filter((entry) => entry.schemas !== null))(
    'keeps the stored schemas of version $schemaVersion frozen',
    ({ schemas, fingerprint }) => {
      expect(inputQueueSchemaFingerprint(schemas!), SHIP_A_NEW_VERSION).toBe(fingerprint);
    },
  );

  it('stores a start-run or follow-up payload for every wire prompt type', () => {
    const newest = SHIPPED_INPUT_QUEUE_VERSIONS.at(-1)?.schemas;
    if (!newest) throw new Error('The newest shipped input queue version has no schemas.');
    const stored = storedHandlerPromptTypes(
      z.toJSONSchema(z.object(newest), { unrepresentable: 'any', io: 'input' }),
    );
    // start_run and user_message each list prompt types; a missing list means this reader broke.
    expect(stored.length).toBeGreaterThanOrEqual(2);
    for (const promptTypes of stored) {
      expect(promptTypes, NEW_PROMPT_TYPE).toEqual(
        expect.arrayContaining(Object.values(LocalPromptType)),
      );
    }
  });

  it('never lets the frozen storage schemas import the wire definitions', async () => {
    const directory = join(__dirname, 'storage-schema');
    for (const name of await readdir(directory)) {
      const source = await readFile(join(directory, name), 'utf8');
      const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);
      expect(
        imports.filter((path) => /trigger-verification|conversation-dispatch/.test(path ?? '')),
        `${name} must not depend on wire schemas`,
      ).toEqual([]);
    }
  });

  describe.each(SHIPPED_INPUT_QUEUE_VERSIONS.filter((entry) => entry.fixture !== null))(
    'the committed version $schemaVersion fixture',
    ({ fixture, expectedQuarantinedKeys, schemaVersion }) => {
      let directory: string;
      beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), 'input-queue-fixture-'));
      });
      afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
      });

      it('migrates to the current version with only the records that have no migration quarantined', async () => {
        const { sessions } = JSON.parse(await readFile(join(__dirname, fixture!), 'utf8')) as {
          sessions: Record<string, { schemaVersion: number; records: unknown[] }>;
        };
        const sessionDirectory = join(directory, 'inputs');
        await mkdir(sessionDirectory);
        for (const [sessionId, file] of Object.entries(sessions)) {
          expect(file.schemaVersion).toBe(schemaVersion);
          await writeFile(join(sessionDirectory, `${sessionId}.json`), JSON.stringify(file));
        }
        const warn = vi.fn();
        const store = new InputAdmissionStore(
          { directory: sessionDirectory, legacyStoreFile: join(directory, 'legacy.json') },
          { ...NOOP_LOGGER, warn },
        );
        const quarantined: Array<string | null> = [];
        let records = 0;
        for (const sessionId of Object.keys(sessions)) {
          const read = await store.readSession(sessionId);
          records += read.records.length;
          quarantined.push(...read.quarantined.map((record) => record.key));
          const written = JSON.parse(
            await readFile(join(sessionDirectory, `${sessionId}.json`), 'utf8'),
          ) as { schemaVersion: number };
          expect(written.schemaVersion).toBe(INPUT_QUEUE_SCHEMA_VERSION);
        }
        const total = Object.values(sessions).reduce((sum, file) => sum + file.records.length, 0);
        expect(quarantined.sort()).toEqual([...expectedQuarantinedKeys].sort());
        expect(records + quarantined.length).toBe(total);
        expect(warn).toHaveBeenCalledTimes(expectedQuarantinedKeys.length);
      });
    },
  );
});

it('resumes canonical Plan inputs and isolates older contextless revisions without changing history', async () => {
  const { sessions } = JSON.parse(
    await readFile(join(__dirname, '__fixtures__/input-queue-v8.json'), 'utf8'),
  );
  const file = Object.values(sessions)[0] as { records: Array<Record<string, any>> };
  const template = file.records.find((record) => record['kind'] === 'trigger_frame')!;
  const event = {
    promptType: 'plan_shaping_feature_sync_iterate',
    triggerMessageId: '00000000-0000-4000-8000-000000000011',
    payload: {
      planId: 'canonical-plan',
      designDocId: 'seed-doc',
      discrepancies: [],
      decisions: [],
    },
  };
  const valid = {
    ...template,
    state: 'queued',
    turnId: null,
    payload: { ...template['payload'], event },
  };
  const invalid = {
    ...valid,
    payload: {
      ...valid.payload,
      event: { ...event, payload: { discrepancies: [], decisions: [] } },
    },
  };
  const finished = { ...invalid, state: 'failed' };
  const source = { records: [valid, invalid, finished], quarantined: [] };
  expect(migrateSessionFileV8ToV9(source)).toEqual(source);
  const decoded = [valid, invalid, finished].map(decodeStoredRecordV9);
  expect(decoded.map((result) => result.status)).toEqual(['readable', 'quarantined', 'readable']);
  if (decoded[0]?.status === 'readable') expect(decoded[0].record.payload).toEqual(valid.payload);
  if (decoded[2]?.status === 'readable')
    expect(decoded[2].record.payload).toEqual(finished.payload);
});

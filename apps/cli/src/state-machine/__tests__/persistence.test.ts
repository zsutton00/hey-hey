import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '../../durable-data';

import { MachineStateStoreCompatibilityError } from '../index';
import { createDefinition, createHarness, startInput } from './fixture';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-state-persistence-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('MachineStateStore persistence', () => {
  it('reconstructs snapshots, accepted command identities, effects, and original replay results', async () => {
    const directory = await createTemporaryDirectory();
    const firstProcess = createHarness(directory);
    const identity = { machineType: 'example', instanceId: 'instance-1' };
    const accepted = await firstProcess.registry.admit(
      identity,
      'command-1',
      startInput('command-1'),
    );
    const firstStored = await firstProcess.store.findByInstanceId('instance-1');

    const reconstructed = createHarness(directory);
    const replayed = await reconstructed.registry.admit(
      identity,
      'command-1',
      startInput('command-1'),
    );
    const stored = await reconstructed.store.findByInstanceId('instance-1');

    expect(accepted).toMatchObject({ status: 'accepted', snapshot: { revision: 1 } });
    expect(replayed).toEqual({
      ...accepted,
      status: 'replayed',
    });
    expect(stored).toMatchObject({
      snapshot: {
        identity: { machineType: 'example', instanceId: 'instance-1' },
        revision: 1,
        state: 'working',
        context: { transitions: 1 },
      },
      effects: [{ revision: 1, effect: { type: 'DO_WORK', itemId: 'item-1' } }],
    });
    expect(stored?.acceptedIngress.has('command-1')).toBe(true);
    expect(stored?.effects[0]?.effectId).toBe(firstStored?.effects[0]?.effectId);
    expect(stored?.effects[0]?.effectId).toEqual(expect.any(String));
    expect(stored?.transitionHistory).toEqual([
      expect.objectContaining({
        ingressId: 'command-1',
        eventType: 'START',
        priorState: 'idle',
        nextState: 'working',
        disposition: {
          status: 'committed',
          effectIds: [stored?.effects[0]?.effectId],
        },
      }),
    ]);
  });

  it('rejects a torn JSON document instead of treating it as absent state', async () => {
    const directory = await createTemporaryDirectory();
    const { filePath, store } = createHarness(directory);
    await fs.writeFile(filePath, '{"stateVersion":1,"instances":[', 'utf8');

    await expect(store.findByInstanceId('instance-1')).rejects.toThrow(
      MachineStateStoreCompatibilityError,
    );
  });

  it('rejects structurally valid durable data with impossible revisions', async () => {
    const directory = await createTemporaryDirectory();
    const { filePath, store } = createHarness(directory);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        stateVersion: 1,
        instances: [
          {
            identity: { machineType: 'example', instanceId: 'instance-1' },
            revision: 1,
            state: 'working',
            context: { transitions: 1 },
            acceptedIngress: [
              {
                ingressId: 'command-1',
                revision: 2,
                state: 'done',
                context: { transitions: 2 },
                effects: [],
              },
            ],
            effects: [],
          },
        ],
      }),
      'utf8',
    );

    await expect(store.findByInstanceId('instance-1')).rejects.toThrow(
      MachineStateStoreCompatibilityError,
    );
  });

  it('rejects invalid decoded customer state from otherwise valid JSON', async () => {
    const directory = await createTemporaryDirectory();
    const { filePath, store } = createHarness(directory);
    await fs.writeFile(
      filePath,
      JSON.stringify({
        stateVersion: 1,
        instances: [
          {
            identity: { machineType: 'example', instanceId: 'instance-1' },
            revision: 1,
            state: 'not-a-state',
            context: { transitions: 1 },
            acceptedIngress: [],
            effects: [],
          },
        ],
      }),
      'utf8',
    );

    await expect(store.findByInstanceId('instance-1')).rejects.toThrow();
  });

  it('preserves the complete source and fails closed when any retained instance is invalid', async () => {
    const directory = await createTemporaryDirectory();
    const { filePath, registry, store } = createHarness(directory);
    await registry.admit(
      { machineType: 'example', instanceId: 'valid-instance' },
      'valid-command',
      startInput('valid-command', 'valid-instance'),
    );
    const persistedText = await fs.readFile(filePath, 'utf8');
    const persisted = JSON.parse(persistedText) as {
      stateVersion: 1;
      instances: object[];
    };
    persisted.instances.push({
      identity: { machineType: 'example', instanceId: 'invalid-instance' },
      revision: 1,
      state: 'not-a-state',
      context: { transitions: 1 },
      acceptedIngress: [],
      effects: [],
    });
    await fs.writeFile(filePath, JSON.stringify(persisted), 'utf8');

    const sourceBytes = await fs.readFile(filePath);

    await expect(store.recoverInstances()).rejects.toThrow(MachineStateStoreCompatibilityError);
    await expect(fs.readFile(filePath)).resolves.toEqual(sourceBytes);
    await expect(store.listInstances()).rejects.toThrow(MachineStateStoreCompatibilityError);
  });

  it('refuses a newer store schema and reports reader, writer, and schema versions', async () => {
    const directory = await createTemporaryDirectory();
    const { filePath, store } = createHarness(directory);
    const source = JSON.stringify({
      schemaVersion: 99,
      writerApplicationVersion: '99.0.0',
      instances: [],
    });
    await fs.writeFile(filePath, source, 'utf8');

    await expect(store.recoverInstances()).rejects.toMatchObject({
      diagnostic: {
        reason: 'unsupported_newer_schema',
        writerApplicationVersion: '99.0.0',
        sourceSchemaVersion: 99,
        currentSchemaVersion: 3,
        readerApplicationVersion: expect.any(String),
      },
    });
    await expect(fs.readFile(filePath, 'utf8')).resolves.toBe(source);
  });

  it('runs definition-owned payload migrations sequentially before atomic promotion', async () => {
    const directory = await createTemporaryDirectory();
    const first = createHarness(directory);
    await first.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const migratedVersions: number[] = [];
    const definition = createHarness(directory, [
      createDefinition('example', undefined, undefined, {
        currentSchemaVersion: 3,
        migrations: new Map([
          [
            1,
            (payload: JsonValue) => {
              migratedVersions.push(1);
              return payload;
            },
          ],
          [
            2,
            (payload: JsonValue) => {
              migratedVersions.push(2);
              return payload;
            },
          ],
        ]),
      }),
    ]);

    await expect(definition.store.recoverInstances()).resolves.toMatchObject({
      instances: [expect.objectContaining({ snapshot: expect.objectContaining({ revision: 1 }) })],
    });
    expect(migratedVersions).toEqual([1, 2]);
    const persisted = JSON.parse(await fs.readFile(definition.filePath, 'utf8'));
    expect(persisted.instances[0].payloadSchemaVersion).toBe(3);
  });

  it.each([
    ['missing_migration', new Map<number, (payload: JsonValue) => JsonValue>()],
    [
      'migration_failed',
      new Map<number, (payload: JsonValue) => JsonValue>([
        [
          1,
          () => {
            throw new Error('migration failed');
          },
        ],
      ]),
    ],
  ] as const)('preserves payload bytes for %s', async (reason, migrations) => {
    const directory = await createTemporaryDirectory();
    const first = createHarness(directory);
    await first.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const sourceBytes = await fs.readFile(first.filePath);
    const incompatible = createHarness(directory, [
      createDefinition('example', undefined, undefined, {
        currentSchemaVersion: 2,
        migrations,
      }),
    ]);

    await expect(incompatible.store.recoverInstances()).rejects.toMatchObject({
      diagnostic: { reason },
    });
    await expect(fs.readFile(first.filePath)).resolves.toEqual(sourceBytes);
  });
});

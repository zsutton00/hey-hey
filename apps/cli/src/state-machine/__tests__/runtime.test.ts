import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { DuplicateMachineDefinitionError } from '../index';
import { createDefinition, createHarness, startInput } from './fixture';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-state-runtime-'));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('MachineRegistry and MachineRuntime', () => {
  it('registers stable machine types and fails duplicate registration clearly', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example');
    const { registry } = createHarness(directory, [definition]);

    expect(() => registry.register(definition)).toThrow(DuplicateMachineDefinitionError);
    expect(() => registry.register(definition)).toThrow('example is already registered');
  });

  it('admits initial and existing-instance events with internally assigned revisions', async () => {
    const directory = await createTemporaryDirectory();
    const { registry, store } = createHarness(directory);

    const identity = { machineType: 'example', instanceId: 'instance-1' };
    const started = await registry.admit(identity, 'command-1', startInput('command-1'));
    const finished = await registry.admit(identity, 'command-2', {
      commandId: 'command-2',
      instanceId: 'instance-1',
      event: { type: 'FINISH', itemId: 'item-1' },
    });
    const replayedStart = await registry.admit(identity, 'command-1', startInput('command-1'));

    expect(started).toMatchObject({
      status: 'accepted',
      snapshot: { revision: 1, state: 'working', context: { transitions: 1 } },
      effects: [{ type: 'DO_WORK', itemId: 'item-1' }],
    });
    expect(finished).toMatchObject({
      status: 'accepted',
      snapshot: { revision: 2, state: 'done', context: { transitions: 2 } },
      effects: [{ type: 'REPORT_DONE' }],
    });
    expect(replayedStart).toMatchObject({
      status: 'replayed',
      snapshot: { revision: 1, state: 'working' },
      effects: [{ type: 'DO_WORK', itemId: 'item-1' }],
    });
    await expect(store.findByInstanceId('instance-1')).resolves.toMatchObject({
      snapshot: { revision: 2, state: 'done' },
      effects: [
        { revision: 1, effect: { type: 'DO_WORK' } },
        { revision: 2, effect: { type: 'REPORT_DONE' } },
      ],
    });
  });

  it('serializes concurrent duplicate commands and evaluates their transition once', async () => {
    const directory = await createTemporaryDirectory();
    let transitionCount = 0;
    const { registry, store } = createHarness(directory, [
      createDefinition('example', () => {
        transitionCount += 1;
      }),
    ]);

    const [first, duplicate] = await Promise.all([
      registry.admit(
        { machineType: 'example', instanceId: 'instance-1' },
        'same-command',
        startInput('same-command'),
      ),
      registry.admit(
        { machineType: 'example', instanceId: 'instance-1' },
        'same-command',
        startInput('same-command'),
      ),
    ]);

    expect(first.status).toBe('accepted');
    expect(duplicate).toMatchObject({
      status: 'replayed',
      ingressId: 'same-command',
      snapshot: { revision: 1, state: 'working' },
      effects: [{ type: 'DO_WORK', itemId: 'item-1' }],
    });
    expect(transitionCount).toBe(1);
    const stored = await store.findByInstanceId('instance-1');
    expect(stored?.acceptedIngress.size).toBe(1);
    expect(stored?.effects).toHaveLength(1);
  });

  it('rejects unknown definitions and unsupported initial events without persisted state', async () => {
    const directory = await createTemporaryDirectory();
    const { registry, store } = createHarness(directory);

    await expect(
      registry.admit(
        { machineType: 'missing', instanceId: 'instance-1' },
        'command-1',
        startInput('command-1'),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      code: 'unknown_machine_type',
    });
    await expect(
      registry.admit({ machineType: 'example', instanceId: 'instance-input' }, 'rejected-input', {
        ...startInput('rejected-input', 'instance-input'),
        rejectInput: true,
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'input_rejected' });
    await expect(
      registry.admit({ machineType: 'example', instanceId: 'instance-2' }, 'command-2', {
        commandId: 'command-2',
        instanceId: 'instance-2',
        event: { type: 'UNSUPPORTED' },
      }),
    ).resolves.toMatchObject({ status: 'rejected', code: 'unsupported_initial_event' });
    await expect(store.findByInstanceId('instance-1')).resolves.toBeNull();
    await expect(store.findByInstanceId('instance-input')).resolves.toBeNull();
    await expect(store.findByInstanceId('instance-2')).resolves.toBeNull();
  });

  it('durably records and replays a no-transition decision for an established instance', async () => {
    const directory = await createTemporaryDirectory();
    const { registry, store } = createHarness(directory);
    const identity = { machineType: 'example', instanceId: 'instance-1' };
    await registry.admit(identity, 'command-1', startInput('command-1'));

    const rejected = await registry.admit(identity, 'command-2', {
      commandId: 'command-2',
      instanceId: 'instance-1',
      event: { type: 'UNSUPPORTED' },
    });
    const replayed = await registry.admit(identity, 'command-2', {
      commandId: 'command-2',
      instanceId: 'instance-1',
      event: { type: 'UNSUPPORTED' },
    });

    expect(rejected).toMatchObject({ status: 'rejected', code: 'transition_rejected' });
    expect(replayed).toEqual(rejected);
    await expect(store.findByInstanceId('instance-1')).resolves.toMatchObject({
      snapshot: { revision: 1, state: 'working' },
      transitionHistory: [
        {
          sequence: 1,
          ingressId: 'command-1',
          eventType: 'START',
          priorRevision: 0,
          revision: 1,
          priorState: 'idle',
          nextState: 'working',
          disposition: { status: 'committed' },
          evidence: 'complete',
        },
        {
          sequence: 2,
          ingressId: 'command-2',
          eventType: 'UNSUPPORTED',
          priorRevision: 1,
          revision: 1,
          priorState: 'working',
          nextState: null,
          disposition: {
            status: 'no_transition',
            reason: 'Event UNSUPPORTED is not accepted from the current state.',
          },
          evidence: 'complete',
        },
      ],
    });
  });

  it('rejects admitted and persisted identity mismatches without changing state', async () => {
    const directory = await createTemporaryDirectory();
    const { registry, store } = createHarness(directory, [
      createDefinition('example'),
      createDefinition('alternate'),
    ]);

    await expect(
      registry.admit(
        { machineType: 'example', instanceId: 'instance-admission' },
        'wrong-admission',
        {
          ...startInput('wrong-admission', 'instance-admission'),
          admittedMachineType: 'alternate',
        },
      ),
    ).resolves.toMatchObject({ status: 'rejected', code: 'identity_mismatch' });
    await expect(store.findByInstanceId('instance-admission')).resolves.toBeNull();

    await registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    await expect(
      registry.admit(
        { machineType: 'alternate', instanceId: 'instance-1' },
        'command-2',
        startInput('command-2'),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      code: 'identity_mismatch',
    });
    await expect(store.findByInstanceId('instance-1')).resolves.toMatchObject({
      snapshot: { identity: { machineType: 'example' }, revision: 1 },
      effects: [{ revision: 1 }],
    });
  });

  it('rejects an ingress replay identity mismatch before durable evaluation', async () => {
    const directory = await createTemporaryDirectory();
    const { registry, store } = createHarness(directory);

    await expect(
      registry.admit(
        { machineType: 'example', instanceId: 'instance-1' },
        'addressed-command',
        startInput('mapped-command'),
      ),
    ).resolves.toMatchObject({
      status: 'rejected',
      code: 'ingress_identity_mismatch',
    });
    await expect(store.findByInstanceId('instance-1')).resolves.toBeNull();
  });
});

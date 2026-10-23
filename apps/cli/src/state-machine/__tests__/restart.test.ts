import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EffectRunner, MachineRecovery, type EffectHandler, type EffectSettlement } from '../index';
import {
  createDefinition,
  createHarness,
  startInput,
  type TestEffect,
  type TestOutcome,
} from './fixture';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-machine-restart-'));
  temporaryDirectories.push(directory);
  return directory;
};

const settlement = (): EffectSettlement<TestOutcome> => ({
  status: 'succeeded',
  outcome: { type: 'SUCCEEDED', itemId: 'item-1' },
});

const retrying = (execute: EffectHandler<TestEffect, TestOutcome>['execute']) => ({
  execute,
  recovery: { strategy: 'retry' as const },
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('MachineRecovery restart crash windows', () => {
  it('restores explicit state, context, and revision and runs work committed before handler start', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const beforeCrash = createHarness(directory, [definition]);
    await beforeCrash.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const execute = vi.fn(() => Promise.resolve(settlement()));

    const restarted = createHarness(directory, [definition]);
    const runner = new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {
      DO_WORK: retrying(execute),
    });
    const recovery = new MachineRecovery(restarted.store, restarted.registry, runner);

    const firstRestoration = recovery.restore();
    const repeatedRestoration = recovery.restore();
    await expect(firstRestoration).resolves.toMatchObject({
      snapshots: [
        {
          identity: { machineType: 'example', instanceId: 'instance-1' },
          revision: 1,
          state: 'working',
          context: { transitions: 1 },
        },
      ],
    });
    await expect(repeatedRestoration).resolves.toBe(await firstRestoration);
    expect(execute).toHaveBeenCalledOnce();
    await expect(restarted.store.findByInstanceId('instance-1')).resolves.toMatchObject({
      snapshot: { revision: 2, state: 'done', context: { transitions: 2 } },
    });
  });

  it('retries claimed work only when its handler declares retry recovery', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const beforeCrash = createHarness(directory, [definition]);
    await beforeCrash.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    await beforeCrash.store.claimNextCommittedEffect();
    const execute = vi.fn(() => Promise.resolve(settlement()));
    const restarted = createHarness(directory, [definition]);
    const runner = new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {
      DO_WORK: retrying(execute),
    });

    await new MachineRecovery(restarted.store, restarted.registry, runner).restore();

    expect(execute).toHaveBeenCalledOnce();
  });

  it('reconciles claimed work without repeating the external handler', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const beforeCrash = createHarness(directory, [definition]);
    await beforeCrash.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    await beforeCrash.store.claimNextCommittedEffect();
    const execute = vi.fn(() => Promise.resolve(settlement()));
    const reconcile = vi.fn(() => Promise.resolve(settlement()));
    const restarted = createHarness(directory, [definition]);
    const runner = new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {
      DO_WORK: { execute, recovery: { strategy: 'reconcile', reconcile } },
    });

    await new MachineRecovery(restarted.store, restarted.registry, runner).restore();

    expect(execute).not.toHaveBeenCalled();
    expect(reconcile).toHaveBeenCalledOnce();
  });

  it('admits a settled stored outcome once without invoking its handler', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const beforeCrash = createHarness(directory, [definition]);
    await beforeCrash.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const claimed = await beforeCrash.store.claimNextCommittedEffect();
    if (!claimed) throw new Error('Expected committed effect.');
    await beforeCrash.store.settleEffect(claimed.effectId, settlement());
    const execute = vi.fn(() => Promise.resolve(settlement()));
    const restarted = createHarness(directory, [definition]);
    const runner = new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {
      DO_WORK: retrying(execute),
    });
    const recovery = new MachineRecovery(restarted.store, restarted.registry, runner);

    await recovery.restore();
    await recovery.restore();

    expect(execute).not.toHaveBeenCalled();
    await expect(restarted.store.findByInstanceId('instance-1')).resolves.toMatchObject({
      snapshot: { revision: 2, state: 'done' },
    });
  });

  it('skips an outcome already committed to the machine', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const first = createHarness(directory, [definition]);
    await first.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const initialExecute = vi.fn(() => Promise.resolve(settlement()));
    await new EffectRunner(first.store, first.runtime, first.registry, {
      DO_WORK: retrying(initialExecute),
    }).runNext();
    const restarted = createHarness(directory, [definition]);
    const executeAfterRestart = vi.fn(() => Promise.resolve(settlement()));

    const result = await new MachineRecovery(
      restarted.store,
      restarted.registry,
      new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {
        DO_WORK: retrying(executeAfterRestart),
      }),
    ).restore();

    expect(result.snapshots).toEqual([]);
    expect(initialExecute).toHaveBeenCalledOnce();
    expect(executeAfterRestart).not.toHaveBeenCalled();
  });

  it('keeps completed settled owners cold until direct access selects them', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const first = createHarness(directory, [definition]);
    await first.registry.admit(
      { machineType: 'example', instanceId: 'completed-instance' },
      'command-1',
      startInput('command-1', 'completed-instance'),
    );
    await new EffectRunner(first.store, first.runtime, first.registry, {
      DO_WORK: retrying(() => Promise.resolve(settlement())),
    }).runNext();
    const persisted = JSON.parse(await fs.readFile(first.filePath, 'utf8'));
    persisted.instances[0].context = { transitions: 'invalid' };
    await fs.writeFile(first.filePath, JSON.stringify(persisted), 'utf8');

    const restarted = createHarness(directory, [definition]);
    const recovery = new MachineRecovery(
      restarted.store,
      restarted.registry,
      new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {}),
    );

    await expect(recovery.restore()).resolves.toEqual({ snapshots: [] });
    await expect(restarted.store.findByInstanceId('completed-instance')).rejects.toMatchObject({
      diagnostic: { reason: 'production_codec_rejected' },
    });
  });

  it('reports failed selected-instance promotion without changing source authority', async () => {
    const directory = await createTemporaryDirectory();
    const first = createHarness(directory);
    await first.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const sourceBytes = await fs.readFile(first.filePath);
    const migrated = createHarness(directory, [
      createDefinition('example', undefined, undefined, {
        currentSchemaVersion: 2,
        migrations: new Map([[1, (payload) => payload]]),
      }),
    ]);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('simulated failure'));

    await expect(migrated.store.findByInstanceId('instance-1')).rejects.toMatchObject({
      diagnostic: {
        reason: 'promotion_failed',
        sourceSchemaVersion: 1,
        currentSchemaVersion: 2,
      },
    });
    expect(rename).toHaveBeenCalledOnce();
    await expect(fs.readFile(first.filePath)).resolves.toEqual(sourceBytes);
    rename.mockRestore();
  });

  it('fails restoration when a durable instance definition is unresolved', async () => {
    const directory = await createTemporaryDirectory();
    const beforeCrash = createHarness(directory, [
      createDefinition('missing-definition', () => undefined, []),
    ]);
    await beforeCrash.registry.admit(
      { machineType: 'missing-definition', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const restarted = createHarness(directory, [createDefinition('example')]);
    const runner = new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {});

    await expect(
      new MachineRecovery(restarted.store, restarted.registry, runner).restore(),
    ).rejects.toThrow('Machine definition missing-definition is not registered.');
  });

  it('does not claim unsettled work without an explicit handler recovery policy', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const beforeCrash = createHarness(directory, [definition]);
    await beforeCrash.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const restarted = createHarness(directory, [definition]);
    const runner = new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {});

    await expect(
      new MachineRecovery(restarted.store, restarted.registry, runner).restore(),
    ).rejects.toThrow('Effect handler DO_WORK is not registered.');
    await expect(restarted.store.findByInstanceId('instance-1')).resolves.toMatchObject({
      effects: [{ status: 'committed' }],
    });
  });

  it('recovers independent instances concurrently while serializing each instance', async () => {
    const directory = await createTemporaryDirectory();
    const definition = createDefinition('example', () => undefined, []);
    const beforeCrash = createHarness(directory, [definition]);
    await beforeCrash.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1', 'instance-1'),
    );
    await beforeCrash.registry.admit(
      { machineType: 'example', instanceId: 'instance-2' },
      'command-2',
      startInput('command-2', 'instance-2'),
    );
    const started: string[] = [];
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async (effect: TestEffect) => {
      if (effect.type === 'DO_WORK') started.push(effect.itemId);
      await gate;
      return settlement();
    });
    const restarted = createHarness(directory, [definition]);
    const recoveryPromise = new MachineRecovery(
      restarted.store,
      restarted.registry,
      new EffectRunner(restarted.store, restarted.runtime, restarted.registry, {
        DO_WORK: retrying(execute),
      }),
    ).restore();

    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    release();
    await recoveryPromise;

    expect(started).toHaveLength(2);
  });
});

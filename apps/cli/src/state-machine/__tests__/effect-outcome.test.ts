import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { ServerLogger } from '../../server/logger';
import {
  type EffectExecutionIdentity,
  type EffectHandler,
  EffectRunner,
  type EffectSettlement,
  toOutcomeEvent,
} from '../index';
import {
  createDefinition,
  createHarness,
  startInput,
  type TestEffect,
  type TestOutcome,
} from './fixture';

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = async (): Promise<string> => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-effect-outcome-'));
  temporaryDirectories.push(directory);
  return directory;
};

const createLogger = () => {
  const debug = vi.fn<ServerLogger['debug']>();
  const error = vi.fn<ServerLogger['error']>();
  const logger: ServerLogger = {
    trace: vi.fn<ServerLogger['trace']>(),
    debug,
    info: vi.fn<ServerLogger['info']>(),
    warn: vi.fn<ServerLogger['warn']>(),
    error,
    child: () => logger,
  };
  return { logger, debug, error };
};

const successfulSettlement = (): EffectSettlement<TestOutcome> => ({
  status: 'succeeded',
  outcome: { type: 'SUCCEEDED', itemId: 'item-1' },
});

const retryingHandler = (execute: EffectHandler<TestEffect, TestOutcome>['execute']) => ({
  execute,
  recovery: { strategy: 'retry' as const },
});

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('EffectRunner and durable outcome admission', () => {
  it('gives handlers only the typed declaration, with no machine mutation capability', () => {
    type HandlerArgument = Parameters<EffectHandler<TestEffect, TestOutcome>['execute']>[0];

    expectTypeOf<HandlerArgument>().toEqualTypeOf<TestEffect>();
  });

  it('does not invoke a handler before the effect declaration is durably committed', async () => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    const durableStatusesSeenByHandler: string[] = [];
    const handler = vi.fn(async (effect: TestEffect, execution: EffectExecutionIdentity) => {
      void effect;
      void execution;
      const stored = await harness.store.findByInstanceId('instance-1');
      durableStatusesSeenByHandler.push(stored?.effects[0]?.status ?? 'missing');
      return successfulSettlement();
    });
    const runner = new EffectRunner(harness.store, harness.runtime, harness.registry, {
      DO_WORK: retryingHandler(handler),
      REPORT_DONE: retryingHandler(handler),
    });

    await expect(runner.runNext()).resolves.toEqual({ status: 'idle' });
    expect(handler).not.toHaveBeenCalled();

    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    await expect(runner.runNext()).resolves.toMatchObject({
      status: 'completed',
      effect: { status: 'settled', settlement: { status: 'succeeded' } },
      admission: { status: 'accepted', snapshot: { state: 'done', revision: 2 } },
    });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]?.[0]).toEqual({ type: 'DO_WORK', itemId: 'item-1' });
    expect(handler.mock.calls[0]?.[1]).toMatchObject({
      machineType: 'example',
      instanceId: 'instance-1',
    });
    expect(handler.mock.calls[0]?.[1].effectId).toEqual(expect.any(String));
    expect(durableStatusesSeenByHandler).toEqual(['claimed']);
  });

  it('atomically claims concurrent attempts so the handler runs at most once', async () => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    let releaseHandler = (): void => undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const handler = vi.fn(async () => {
      await handlerGate;
      return successfulSettlement();
    });
    const runner = new EffectRunner(harness.store, harness.runtime, harness.registry, {
      DO_WORK: retryingHandler(handler),
      REPORT_DONE: retryingHandler(handler),
    });
    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );

    const firstAttempt = runner.runNext();
    await vi.waitFor(() => expect(handler).toHaveBeenCalledOnce());
    await expect(runner.runNext()).resolves.toEqual({ status: 'idle' });
    releaseHandler();
    await expect(firstAttempt).resolves.toMatchObject({ status: 'completed' });
    expect(handler).toHaveBeenCalledOnce();
  });

  it('halts live draining when a settled outcome is rejected instead of retrying it forever', async () => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    const { logger, error } = createLogger();
    let releaseHandler = (): void => undefined;
    const handlerGate = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    const doWork = vi.fn(async () => {
      await handlerGate;
      return successfulSettlement();
    });
    const reportDone = vi.fn(() => Promise.resolve(successfulSettlement()));
    const runner = new EffectRunner(
      harness.store,
      harness.runtime,
      harness.registry,
      { DO_WORK: retryingHandler(doWork), REPORT_DONE: retryingHandler(reportDone) },
      logger,
    );
    runner.startLiveProcessing();

    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    await vi.waitFor(() => expect(doWork).toHaveBeenCalledOnce());
    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'finish-first',
      {
        commandId: 'finish-first',
        instanceId: 'instance-1',
        event: { type: 'FINISH', itemId: 'manual-finish' },
      },
    );
    releaseHandler();

    await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    await Promise.resolve();

    expect(doWork).toHaveBeenCalledOnce();
    expect(reportDone).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'state_machine.effect.live_drain.failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    expect(error).toHaveBeenCalledTimes(2);
    await expect(
      harness.store.findNextSettledEffectAwaitingOutcomeAdmission(),
    ).resolves.not.toBeNull();
  });

  it('does not claim work after shutdown when selection was already in flight', async () => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    const handler = vi.fn(() => Promise.resolve(successfulSettlement()));
    const runner = new EffectRunner(harness.store, harness.runtime, harness.registry, {
      DO_WORK: retryingHandler(handler),
      REPORT_DONE: retryingHandler(handler),
    });
    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const originalClaim = harness.store.claimNextCommittedEffect.bind(harness.store);
    let releaseClaim = (): void => undefined;
    const claimGate = new Promise<void>((resolve) => {
      releaseClaim = resolve;
    });
    vi.spyOn(harness.store, 'claimNextCommittedEffect').mockImplementation(async (canClaim) => {
      await claimGate;
      return originalClaim(canClaim);
    });

    const pending = runner.runNext();
    runner.stopClaiming();
    releaseClaim();

    await expect(pending).resolves.toEqual({ status: 'idle' });
    expect(handler).not.toHaveBeenCalled();
    await expect(harness.store.findByInstanceId('instance-1')).resolves.toMatchObject({
      effects: [{ status: 'committed' }],
    });
  });

  it.each<EffectSettlement<TestOutcome>>([
    { status: 'succeeded', outcome: { type: 'SUCCEEDED', itemId: 'item-1' } },
    { status: 'failed', outcome: { type: 'FAILED', reason: 'known rejection' } },
    { status: 'cancelled', outcome: { type: 'CANCELLED', reason: 'cancelled by owner' } },
    { status: 'uncertain', outcome: { type: 'UNCERTAIN', reason: 'acknowledgement lost' } },
  ])('durably records the $status closed outcome', async (settlement) => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    const handler = vi.fn(() => Promise.resolve(settlement));
    const runner = new EffectRunner(harness.store, harness.runtime, harness.registry, {
      DO_WORK: retryingHandler(handler),
      REPORT_DONE: retryingHandler(handler),
    });
    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );

    const result = await runner.runNext();

    expect(result).toMatchObject({
      status: 'completed',
      effect: { status: 'settled', settlement },
    });
    const stored = await harness.store.findByInstanceId('instance-1');
    expect(stored?.effects[0]).toMatchObject({ status: 'settled', settlement });
  });

  it('flushes settlement before serialized outcome re-entry and logs every boundary', async () => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    const { logger, debug } = createLogger();
    const handler = vi.fn(() => Promise.resolve(successfulSettlement()));
    const runner = new EffectRunner(
      harness.store,
      harness.runtime,
      harness.registry,
      { DO_WORK: retryingHandler(handler), REPORT_DONE: retryingHandler(handler) },
      logger,
    );
    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const originalAdmit = harness.runtime.admit.bind(harness.runtime);
    const admittedAfterSettlement: boolean[] = [];
    vi.spyOn(harness.runtime, 'admit').mockImplementation(async (definition, admitted) => {
      const stored = await harness.store.findByInstanceId(admitted.identity.instanceId);
      admittedAfterSettlement.push(stored?.effects[0]?.status === 'settled');
      return originalAdmit(definition, admitted);
    });

    const result = await runner.runNext();

    expect(admittedAfterSettlement).toEqual([true]);
    if (result.status !== 'completed') throw new Error('Expected the effect to complete.');
    expect(result).toMatchObject({
      status: 'completed',
      admission: { status: 'accepted', snapshot: { state: 'done', revision: 2 } },
    });
    const events = debug.mock.calls.map(([event]) => event);
    expect(events).toEqual([
      'state_machine.effect.selection.started',
      'state_machine.effect.claim.completed',
      'state_machine.effect.handler.started',
      'state_machine.effect.handler.completed',
      'state_machine.effect.settlement.started',
      'state_machine.effect.settlement.completed',
      'state_machine.effect.outcome_reentry.started',
      'state_machine.effect.outcome_reentry.completed',
    ]);
    expect(debug).toHaveBeenCalledWith(
      'state_machine.effect.claim.completed',
      expect.objectContaining({
        machineType: 'example',
        instanceId: 'instance-1',
        effectId: result.effect.effectId,
        effectType: 'DO_WORK',
        revision: 1,
      }),
    );
    expect(debug).toHaveBeenCalledWith(
      'state_machine.effect.settlement.completed',
      expect.objectContaining({ settlementStatus: 'succeeded' }),
    );
    expect(debug).toHaveBeenCalledWith(
      'state_machine.effect.outcome_reentry.completed',
      expect.objectContaining({ eventType: 'FINISH', admissionStatus: 'accepted' }),
    );
  });

  it('re-enters a durably settled outcome after interruption without rerunning its handler', async () => {
    const directory = await createTemporaryDirectory();
    const harness = createHarness(directory);
    await harness.registry.admit(
      { machineType: 'example', instanceId: 'instance-1' },
      'command-1',
      startInput('command-1'),
    );
    const claimed = await harness.store.claimNextCommittedEffect();
    if (!claimed) throw new Error('Expected a committed effect.');
    const settled = await harness.store.settleEffect(claimed.effectId, successfulSettlement());
    const handler = vi.fn(() => Promise.resolve(successfulSettlement()));
    const { logger, debug } = createLogger();
    const runner = new EffectRunner(
      harness.store,
      harness.runtime,
      harness.registry,
      { DO_WORK: retryingHandler(handler), REPORT_DONE: retryingHandler(handler) },
      logger,
    );

    await expect(runner.runNext()).resolves.toMatchObject({
      status: 'completed',
      effect: { effectId: settled.effectId, status: 'settled' },
      admission: { status: 'accepted', snapshot: { state: 'done', revision: 2 } },
    });
    expect(handler).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith('state_machine.effect.outcome_reentry.recovered', {
      machineType: 'example',
      instanceId: 'instance-1',
      effectId: settled.effectId,
      settlementStatus: 'succeeded',
    });

    await expect(harness.store.findNextSettledEffectAwaitingOutcomeAdmission()).resolves.toBeNull();
  });

  it('maps a settled record without placing internal effect identity in the customer event', () => {
    const outcomeEvent = toOutcomeEvent(createDefinition('example'), {
      identity: { machineType: 'example', instanceId: 'instance-1' },
      effectId: 'internal-effect-id',
      revision: 1,
      effect: { type: 'DO_WORK', itemId: 'item-1' },
      status: 'settled',
      settlement: successfulSettlement(),
    });

    expect(outcomeEvent).toEqual({
      status: 'admitted',
      identity: { machineType: 'example', instanceId: 'instance-1' },
      ingressId: 'effect-outcome:internal-effect-id',
      event: { type: 'FINISH', itemId: 'outcome-item' },
    });
    expect(outcomeEvent.event).not.toHaveProperty('effectId');
    expect(outcomeEvent.event).not.toHaveProperty('revision');
  });
});

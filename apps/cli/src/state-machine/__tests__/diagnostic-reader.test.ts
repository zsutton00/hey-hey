import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MachineDiagnosticReader } from '../diagnostic-reader';
import { createHarness, startInput } from './fixture';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
  );
});

describe('MachineDiagnosticReader', () => {
  it('projects revision-ordered transition and effect evidence without effect payloads', async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-machine-diagnostics-'));
    temporaryDirectories.push(directory);
    const { registry, store } = createHarness(directory);
    const identity = { machineType: 'example', instanceId: 'instance-1' };
    await registry.admit(identity, 'command-1', startInput('command-1'));
    await registry.admit(identity, 'command-2', {
      commandId: 'command-2',
      instanceId: 'instance-1',
      event: { type: 'UNSUPPORTED' },
    });
    const reader = new MachineDiagnosticReader(
      store,
      (state) => ({ controlState: state, executionState: state }),
      (context) => ({ transitionCount: context.transitions }),
    );

    const view = await reader.inspect('instance-1');
    const effectId = view?.pendingEffects[0]?.effectId;

    expect(view).toEqual({
      identity,
      currentRevision: 1,
      currentState: { controlState: 'working', executionState: 'working' },
      selectedWorkCorrelation: { transitionCount: 1 },
      pendingEffects: [
        {
          effectId,
          declaredRevision: 1,
          effectType: 'DO_WORK',
          status: 'committed',
          settlementStatus: null,
          outcomeType: null,
          outcomeAdmission: 'not_settled',
        },
      ],
      transitionHistory: [
        expect.objectContaining({
          sequence: 1,
          eventType: 'START',
          priorState: { controlState: 'idle', executionState: 'idle' },
          disposition: 'transition_committed',
          committedNextState: { controlState: 'working', executionState: 'working' },
          effects: [expect.objectContaining({ effectType: 'DO_WORK' })],
        }),
        expect.objectContaining({
          sequence: 2,
          eventType: 'UNSUPPORTED',
          disposition: 'no_transition',
          reason: 'Event UNSUPPORTED is not accepted from the current state.',
          committedNextState: null,
          effects: [],
        }),
      ],
    });
    expect(typeof effectId).toBe('string');
    expect(JSON.stringify(view)).not.toContain('item-1');
  });
});

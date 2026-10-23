import { describe, expect, it, vi } from 'vitest';
import {
  TaskMonitorStatePublication,
  taskMonitorStateProjection,
} from './task-monitor-state-publication';
import { NOOP_LOGGER } from './logger';
import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import type { TaskMonitorMachineRuntime } from '../agents/task-monitor/state-machine/machine';

const snapshot = {
  identity: { machineType: 'TASK_MONITOR', instanceId: '10000000-0000-4000-8000-000000000001' },
  revision: 7,
  state: {
    RUNNING: {
      control: 'ACTIVE' as const,
      work: 'OUTCOME_JUDGMENT' as const,
      intervention: 'CLEAR' as const,
      input: 'WAITING_FOR_INPUT' as const,
    },
  },
  context: {
    failureReason: 'Bad JSON',
    coordinatorRecovery: {
      correctionAttempt: 2,
      failure: { code: 'INVALID_JSON', message: 'Bad JSON', issues: [] },
      deliveryFailure: 'Conversation unavailable.',
    },
  } as unknown as TaskMonitorMachineContext,
};

describe('committed Task Monitor state publication', () => {
  it('keeps failure visible when conversation delivery fails and advertises admitted lifecycle actions', () => {
    expect(taskMonitorStateProjection(snapshot)).toMatchObject({
      execution: { work: 'OUTCOME_JUDGMENT' },
      failure: {
        cause: expect.stringContaining('Conversation unavailable.'),
        correctiveGuidance: expect.stringContaining('Please provide guidance'),
      },
      availableActions: [
        { kind: 'STOP', command: 'STOP' },
        { kind: 'PAUSE', command: 'PAUSE' },
      ],
    });
    expect(taskMonitorStateProjection({ ...snapshot, state: 'HALTED' }).availableActions).toEqual(
      [],
    );
    expect(
      taskMonitorStateProjection({
        ...snapshot,
        state: { RUNNING: { ...snapshot.state.RUNNING, control: 'PAUSED' } },
      }).availableActions,
    ).toEqual([
      { kind: 'STOP', command: 'STOP' },
      { kind: 'PAUSED_CONTINUATION', command: 'RESUME' },
    ]);
  });
  it('publishes commit and reconstruction snapshots without coding Runs and replays on reconnection', async () => {
    const onTransitionCommitted = vi.fn<TaskMonitorMachineRuntime['onTransitionCommitted']>(
      () => () => undefined,
    );
    let reconnect: (() => void) | undefined;
    const emitTaskMonitorStateObservation = vi.fn();
    const owner = new TaskMonitorStatePublication(
      { onTransitionCommitted } as never,
      { listInstances: vi.fn(async () => [{ snapshot }]) } as never,
      {
        emitTaskMonitorStateObservation,
        onReconnect: vi.fn((callback) => {
          reconnect = callback;
          return () => undefined;
        }),
      } as never,
      { loadCurrentMachineId: vi.fn(async () => 'paired-machine') } as never,
      NOOP_LOGGER,
    );
    expect(onTransitionCommitted).toHaveBeenCalledWith(null, expect.any(Function));
    onTransitionCommitted.mock.calls[0]![1](snapshot);
    await owner.replay();
    expect(emitTaskMonitorStateObservation).toHaveBeenCalledTimes(2);
    expect(emitTaskMonitorStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sourceRevision: 7,
        machineId: 'paired-machine',
        projection: taskMonitorStateProjection(snapshot),
      }),
    );
    reconnect!();
    await vi.waitFor(() => expect(emitTaskMonitorStateObservation).toHaveBeenCalledTimes(3));
    owner.dispose();
  });
});

/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';

import type { TaskMonitorMachineContext } from '../agents/task-monitor/state-machine/context';
import { RunWorktreeCollisionError } from '../agents/run-scope';
import { NOOP_LOGGER } from './logger';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';
import type { TaskMonitorStateStore } from '../agents/task-monitor/state-machine/machine';
import { TaskMonitorLaunchFailureAdapter } from './task-monitor-launch-failure-adapter';
import { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';

const MONITOR_ID = '10000000-0000-4000-8000-000000000001';
const TASK_ID = '20000000-0000-4000-8000-000000000002';
const SESSION_ID = '30000000-0000-4000-8000-000000000003';
const CONVERSATION_ID = '40000000-0000-4000-8000-000000000004';

const failure = new RunWorktreeCollisionError({
  serviceId: '50000000-0000-4000-8000-000000000005',
  repositoryPath: '/repos/service-a',
  branch: 'feature/task-monitor',
  authority: 'TASK_MONITOR',
}).failure;

const eventInput = {
  taskMonitorId: MONITOR_ID,
  taskId: TASK_ID,
  runId: '60000000-0000-4000-8000-000000000006',
  agentSessionId: SESSION_ID,
  conversationId: CONVERSATION_ID,
  failure,
};

const context = {
  taskMonitorId: MONITOR_ID,
  selectedTaskId: TASK_ID,
  agentSessionId: SESSION_ID,
  conversationId: CONVERSATION_ID,
  cursor: 0,
  executionPlan: [{ taskId: TASK_ID }],
} as unknown as TaskMonitorMachineContext;

const harness = (canonicalContext: TaskMonitorMachineContext | undefined = context) => {
  const findByInstanceId = vi
    .fn()
    .mockResolvedValue(
      canonicalContext === undefined ? null : { snapshot: { context: canonicalContext } },
    );
  const admitVerified = vi.fn().mockResolvedValue({
    status: 'accepted',
    snapshot: { revision: 3 },
  });
  const runtime = new TaskMonitorLaunchFailureRuntime(NOOP_LOGGER);
  const adapter = new TaskMonitorLaunchFailureAdapter(
    { subscribe: runtime.subscribe.bind(runtime) } as never,
    { findByInstanceId } as never as TaskMonitorStateStore,
    { admitVerified } as never as TaskMonitorStateMachineInputAdapter,
    NOOP_LOGGER,
  );
  adapter.start();
  return { runtime, adapter, findByInstanceId, admitVerified };
};

describe('TaskMonitorLaunchFailureAdapter', () => {
  it('admits a matching collision as a typed launch-failure input', async () => {
    const owner = harness();

    await owner.runtime.publishLaunchFailure(eventInput);

    expect(owner.findByInstanceId).toHaveBeenCalledWith(MONITOR_ID);
    expect(owner.admitVerified).toHaveBeenCalledWith({
      source: 'LAUNCH_FAILURE',
      identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
      ingressId: expect.stringMatching(
        new RegExp(
          `^task-monitor-launch-failure:${MONITOR_ID}:${SESSION_ID}:1:[0-9a-f-]{36}$`,
          'u',
        ),
      ),
      taskMonitorId: MONITOR_ID,
      taskId: TASK_ID,
      cursor: 0,
      agentSessionId: SESSION_ID,
      conversationId: CONVERSATION_ID,
      failure,
    });
    owner.adapter.dispose();
  });

  it.each([
    ['selected_task_mismatch', { selectedTaskId: '70000000-0000-4000-8000-000000000007' }],
    ['agent_session_mismatch', { agentSessionId: '80000000-0000-4000-8000-000000000008' }],
    ['conversation_mismatch', { conversationId: '90000000-0000-4000-8000-000000000009' }],
  ] as const)('does not admit stale %s events', async (_reason, override) => {
    const owner = harness({ ...context, ...override });

    await owner.runtime.publishLaunchFailure(eventInput);

    expect(owner.admitVerified).not.toHaveBeenCalled();
    owner.adapter.dispose();
  });
});

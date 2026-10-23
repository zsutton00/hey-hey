/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';

import { RunWorktreeCollisionError } from '../agents/run-scope';
import { NOOP_LOGGER } from './logger';
import { TaskMonitorLaunchFailureRuntime } from './task-monitor-launch-failure-runtime';

const input = {
  taskMonitorId: '10000000-0000-4000-8000-000000000001',
  taskId: '20000000-0000-4000-8000-000000000002',
  runId: '30000000-0000-4000-8000-000000000003',
  agentSessionId: '40000000-0000-4000-8000-000000000004',
  conversationId: '50000000-0000-4000-8000-000000000005',
  failure: new RunWorktreeCollisionError({
    serviceId: '60000000-0000-4000-8000-000000000006',
    repositoryPath: '/repos/service-a',
    branch: 'feature/task-monitor',
    authority: 'TASK_MONITOR',
  }).failure,
};

describe('TaskMonitorLaunchFailureRuntime', () => {
  it('publishes one event for concurrent and repeated attempts with the same failure identity', async () => {
    const runtime = new TaskMonitorLaunchFailureRuntime(NOOP_LOGGER);
    const listener = vi.fn();
    runtime.subscribe(listener);

    const [first, concurrent, repeated] = await Promise.all([
      runtime.publishLaunchFailure(input),
      runtime.publishLaunchFailure(input),
      runtime.publishLaunchFailure(input),
    ]);

    expect(first).toEqual(concurrent);
    expect(concurrent).toEqual(repeated);
    expect(first).toMatchObject({
      kind: 'task_monitor_launch_failure',
      taskMonitorId: input.taskMonitorId,
      taskId: input.taskId,
      runId: input.runId,
      agentSessionId: input.agentSessionId,
      conversationId: input.conversationId,
      attempt: 1,
      failure: input.failure,
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(first);
  });

  it('starts a new attempt after canonical workspace recovery clears the cache', async () => {
    const runtime = new TaskMonitorLaunchFailureRuntime(NOOP_LOGGER);
    const first = await runtime.publishLaunchFailure(input);

    runtime.clearLaunchFailures({
      taskMonitorId: input.taskMonitorId,
      agentSessionId: input.agentSessionId,
    });

    const second = await runtime.publishLaunchFailure(input);
    expect(second).not.toBe(first);
    expect(second).toMatchObject({
      attempt: 2,
      failure: { fingerprint: input.failure.fingerprint },
    });
    expect(second.eventId).toMatch(
      new RegExp(
        `^task-monitor-launch-failure:${input.taskMonitorId}:${input.agentSessionId}:2:[0-9a-f-]{36}$`,
        'u',
      ),
    );
  });

  it('uses a new ingress identity when the retained session encounters a different collision', async () => {
    const runtime = new TaskMonitorLaunchFailureRuntime(NOOP_LOGGER);
    const first = await runtime.publishLaunchFailure(input);
    const differentFailure = new RunWorktreeCollisionError({
      serviceId: input.failure.serviceId,
      repositoryPath: input.failure.repositoryPath,
      branch: 'feature/another-task-monitor',
      authority: input.failure.authority,
    }).failure;

    const second = await runtime.publishLaunchFailure({ ...input, failure: differentFailure });

    expect(second).toMatchObject({
      attempt: 2,
      failure: { fingerprint: differentFailure.fingerprint },
    });
    expect(second.eventId).not.toBe(first.eventId);
  });

  it('uses a fresh ingress identity after the runtime is recreated', async () => {
    const firstRuntime = new TaskMonitorLaunchFailureRuntime(NOOP_LOGGER);
    const restartedRuntime = new TaskMonitorLaunchFailureRuntime(NOOP_LOGGER);

    const first = await firstRuntime.publishLaunchFailure(input);
    const afterRestart = await restartedRuntime.publishLaunchFailure(input);

    expect(afterRestart.eventId).not.toBe(first.eventId);
    expect(afterRestart.attempt).toBe(1);
    expect(afterRestart.failure.fingerprint).toBe(first.failure.fingerprint);
  });
});

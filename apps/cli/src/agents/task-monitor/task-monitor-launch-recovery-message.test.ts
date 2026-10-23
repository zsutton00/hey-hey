/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import { RunWorktreeCollisionError } from '../run-scope';
import type { ProjectTaskMonitorLaunchRecoveryEffect } from './state-machine/effects';
import {
  toTaskMonitorLaunchRecoveryData,
  toTaskMonitorLaunchRecoveryMessage,
} from './task-monitor-launch-recovery-message';

const makeEffect = (
  authority: 'PLAN' | 'TASK_MONITOR',
): ProjectTaskMonitorLaunchRecoveryEffect => ({
  type: 'PROJECT_TASK_MONITOR_LAUNCH_RECOVERY',
  taskMonitorId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  taskId: '40000000-0000-4000-8000-000000000004',
  agentSessionId: '50000000-0000-4000-8000-000000000005',
  conversationId: '60000000-0000-4000-8000-000000000006',
  failure: new RunWorktreeCollisionError({
    serviceId: '70000000-0000-4000-8000-000000000007',
    repositoryPath: '/repos/service-a',
    branch: 'feature/task-monitor',
    authority,
  }).failure,
});

describe('Task Monitor launch recovery message', () => {
  it.each([
    ['TASK_MONITOR', 'USER_EDITABLE'],
    ['PLAN', 'PLAN_LOCKED'],
  ] as const)('maps the %s correction mode into the typed SYSTEM payload', (authority, mode) => {
    const effect = makeEffect(authority);
    const message = toTaskMonitorLaunchRecoveryMessage(
      effect.projectId,
      'coordinator-conversation-1',
      effect,
    );

    expect(message).toMatchObject({
      projectId: effect.projectId,
      type: 'SYSTEM',
      status: 'completed',
      data: {
        type: 'TASK_MONITOR_LAUNCH_RECOVERY',
        agentIdentity: 'task-monitor-coordinator',
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        agentSessionId: effect.agentSessionId,
        conversationId: effect.conversationId,
        serviceId: effect.failure.serviceId,
        repositoryPath: effect.failure.repositoryPath,
        branch: effect.failure.branch,
        collision: 'BRANCH_CHECKED_OUT_IN_HOST_REPOSITORY',
        authority,
        correctionMode: mode,
        correctiveAction: effect.failure.correctiveAction,
        lifecycle: 'RETRYABLE_LAUNCH',
        fingerprint: effect.failure.fingerprint,
      },
    });
    expect(message.data).toMatchObject({
      response: expect.stringContaining(effect.failure.message),
    });
  });

  it('keeps the selected-session conversation identity separate from the coordinator post target', () => {
    const effect = makeEffect('TASK_MONITOR');

    expect(toTaskMonitorLaunchRecoveryData('coordinator-conversation-1', effect)).toMatchObject({
      conversationId: effect.conversationId,
    });
  });
});

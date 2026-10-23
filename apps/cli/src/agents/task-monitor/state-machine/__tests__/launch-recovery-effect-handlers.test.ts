/** @vitest-environment node */

import { describe, expect, it, vi } from 'vitest';

import type { ApiRuntime } from '@hey-hey/ui-common/clients';
import type { MessagePoster } from '../../../../run/message-poster';
import { NOOP_LOGGER } from '../../../../server/logger';
import type { TaskMonitorCoordinatorConversation } from '../../../../server/task-monitor-coordinator-conversation';
import { RunWorktreeCollisionError } from '../../../run-scope';
import type { ProjectTaskMonitorLaunchRecoveryEffect } from '../effects';
import { TaskMonitorLaunchRecoveryEffectHandler } from '../launch-recovery-effect-handlers';

const effect: ProjectTaskMonitorLaunchRecoveryEffect = {
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
    authority: 'TASK_MONITOR',
  }).failure,
};

const execution = {
  machineType: 'TASK_MONITOR',
  instanceId: effect.taskMonitorId,
  effectId: '80000000-0000-4000-8000-000000000008',
};

const coordinator = (): TaskMonitorCoordinatorConversation => {
  const owner = Object.create(
    Object.getPrototypeOf({}) as object,
  ) as TaskMonitorCoordinatorConversation;
  Object.defineProperty(owner, 'resolve', {
    value: vi.fn().mockResolvedValue('coordinator-conversation-1'),
  });
  return owner;
};

describe('TaskMonitorLaunchRecoveryEffectHandler', () => {
  it('posts one typed SYSTEM projection and replays its message identity', async () => {
    const createOutOfBand = vi.fn().mockResolvedValue('message-1');
    const poster = { createOutOfBand } as never as MessagePoster;
    const apiRuntime = {
      clients: {
        conversationsApi: {
          getMessages: vi.fn().mockResolvedValue({ data: { data: [] } }),
        },
      },
    } as never as ApiRuntime;
    const conversation = coordinator();
    const handler = new TaskMonitorLaunchRecoveryEffectHandler(
      apiRuntime,
      poster,
      conversation,
      NOOP_LOGGER,
    );

    await expect(handler.recovery.reconcile(effect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_RECOVERY_PROJECTED',
        messageId: 'message-1',
      },
    });
    await expect(
      handler.execute(effect, { ...execution, effectId: '90000000-0000-4000-8000-000000000009' }),
    ).resolves.toEqual({
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_RECOVERY_PROJECTED',
        taskMonitorId: effect.taskMonitorId,
        taskId: effect.taskId,
        agentSessionId: effect.agentSessionId,
        fingerprint: effect.failure.fingerprint,
        messageId: 'message-1',
      },
    });

    expect(createOutOfBand).toHaveBeenCalledOnce();
    expect(createOutOfBand).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: effect.organizationId,
        projectId: effect.projectId,
        conversationId: 'coordinator-conversation-1',
        stamp: null,
        dto: expect.objectContaining({
          type: 'SYSTEM',
          status: 'completed',
          data: expect.objectContaining({
            type: 'TASK_MONITOR_LAUNCH_RECOVERY',
            conversationId: effect.conversationId,
            fingerprint: effect.failure.fingerprint,
          }),
        }),
      }),
    );
  });

  it('keeps projection failure visible to the machine', async () => {
    const poster = {
      createOutOfBand: vi.fn().mockRejectedValue(new Error('message write failed')),
    } as never as MessagePoster;
    const apiRuntime = {
      clients: {
        conversationsApi: {
          getMessages: vi.fn().mockResolvedValue({ data: { data: [] } }),
        },
      },
    } as never as ApiRuntime;
    const handler = new TaskMonitorLaunchRecoveryEffectHandler(
      apiRuntime,
      poster,
      coordinator(),
      NOOP_LOGGER,
    );

    await expect(handler.execute(effect, execution)).resolves.toMatchObject({
      status: 'failed',
      outcome: {
        type: 'LAUNCH_RECOVERY_PROJECTION_FAILED',
        reason: 'message write failed',
      },
    });
  });

  it('reconciles an existing typed projection after a handler restart', async () => {
    const createOutOfBand = vi.fn().mockResolvedValue('unexpected-message');
    const poster = { createOutOfBand } as never as MessagePoster;
    const apiRuntime = {
      clients: {
        conversationsApi: {
          getMessages: vi.fn().mockResolvedValue({
            data: {
              data: [
                {
                  type: 'SYSTEM',
                  id: 'message-1',
                  conversationId: 'coordinator-conversation-1',
                  data: {
                    type: 'TASK_MONITOR_LAUNCH_RECOVERY',
                    taskMonitorId: effect.taskMonitorId,
                    agentSessionId: effect.agentSessionId,
                    conversationId: effect.conversationId,
                    fingerprint: effect.failure.fingerprint,
                  },
                },
              ],
            },
          }),
        },
      },
    } as never as ApiRuntime;
    const handler = new TaskMonitorLaunchRecoveryEffectHandler(
      apiRuntime,
      poster,
      coordinator(),
      NOOP_LOGGER,
    );

    await expect(handler.recovery.reconcile(effect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'LAUNCH_RECOVERY_PROJECTED', messageId: 'message-1' },
    });
    expect(createOutOfBand).not.toHaveBeenCalled();
  });
  it('does not create a duplicate projection when a page-list read returns another response shape', async () => {
    const createOutOfBand = vi.fn();
    const apiRuntime = {
      clients: {
        conversationsApi: {
          getMessages: vi.fn().mockResolvedValue({
            data: { data: { messages: [], nextCursor: 'older-page' } },
          }),
        },
      },
    } as never as ApiRuntime;
    const handler = new TaskMonitorLaunchRecoveryEffectHandler(
      apiRuntime,
      { createOutOfBand } as never as MessagePoster,
      coordinator(),
      NOOP_LOGGER,
    );
    await expect(handler.execute(effect, execution)).resolves.toMatchObject({
      status: 'failed',
      outcome: { type: 'LAUNCH_RECOVERY_PROJECTION_FAILED' },
    });
    expect(createOutOfBand).not.toHaveBeenCalled();
  });
});

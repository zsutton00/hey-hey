import type { ApiRuntime } from '@hey-hey/ui-common/clients';
import { describe, expect, it, vi } from 'vitest';

import { NOOP_LOGGER } from './logger';
import { TaskMonitorCoordinatorConversation } from './task-monitor-coordinator-conversation';

const input = {
  organizationId: 'organization-1',
  projectId: 'project-1',
  taskMonitorId: 'task-monitor-1',
};

describe('TaskMonitorCoordinatorConversation', () => {
  it('returns the conversation already owned by the canonical coordinator', async () => {
    const resolveWorkItemCoordinator = vi.fn().mockResolvedValue({
      data: {
        data: {
          agentSession: {
            id: 'coordinator-session-1',
            conversationId: 'coordinator-conversation-1',
          },
        },
      },
    });
    const createConversation = vi.fn();
    const apiRuntime = {
      clients: {
        agentSessions: {
          resolveWorkItemCoordinator,
          createAgentSessionConversation:
            createConversation,
        },
      },
    } as unknown as ApiRuntime;

    await expect(
      new TaskMonitorCoordinatorConversation(apiRuntime, NOOP_LOGGER).resolve(input),
    ).resolves.toBe('coordinator-conversation-1');
    expect(createConversation).not.toHaveBeenCalled();
  });

  it('creates the canonical conversation when coordinator resolution returns without one', async () => {
    const createConversation = vi.fn().mockResolvedValue({
      data: { data: { conversation: { id: 'coordinator-conversation-1' } } },
    });
    const apiRuntime = {
      clients: {
        agentSessions: {
          resolveWorkItemCoordinator: vi.fn().mockResolvedValue({
            data: {
              data: {
                agentSession: { id: 'coordinator-session-1', conversationId: null },
              },
            },
          }),
          createAgentSessionConversation:
            createConversation,
        },
      },
    } as unknown as ApiRuntime;

    await expect(
      new TaskMonitorCoordinatorConversation(apiRuntime, NOOP_LOGGER).resolve(input),
    ).resolves.toBe('coordinator-conversation-1');
    expect(createConversation).toHaveBeenCalledOnce();
  });

  it('recovers the canonical conversation after a concurrent link conflict', async () => {
    const getAgentSession = vi.fn().mockResolvedValue({
      data: { data: { conversationId: 'coordinator-conversation-1' } },
    });
    const apiRuntime = {
      clients: {
        agentSessions: {
          resolveWorkItemCoordinator: vi.fn().mockResolvedValue({
            data: {
              data: {
                agentSession: { id: 'coordinator-session-1', conversationId: null },
              },
            },
          }),
          createAgentSessionConversation:
            vi.fn().mockRejectedValue({ isAxiosError: true, response: { status: 409 } }),
          getAgentSession:
            getAgentSession,
        },
      },
    } as unknown as ApiRuntime;

    await expect(
      new TaskMonitorCoordinatorConversation(apiRuntime, NOOP_LOGGER).resolve(input),
    ).resolves.toBe('coordinator-conversation-1');
    expect(getAgentSession).toHaveBeenCalledOnce();
  });
});

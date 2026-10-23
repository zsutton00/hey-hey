import { describe, expect, it, vi } from 'vitest';
import type { RunStore } from '../run-store';
import type { LocalAgentService } from './local-agent-service';
import { NOOP_LOGGER } from './logger';
import type { TaskMonitorStateMachineInputAdapter } from './state-machine-input-adapter';
import { TaskMonitorConversationInputAdmission } from './task-monitor-conversation-input-admission';

const input = {
  taskMonitorId: 'monitor-1',
  organizationId: 'organization-1',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  messageId: 'message-1',
};

describe('Task Monitor canonical conversation input admission', () => {
  it('admits the canonical USER Message to the addressed durable owner', async () => {
    const admitVerified = vi.fn().mockResolvedValue({
      status: 'accepted',
      ingressId: 'conversation-message:message-1',
      snapshot: { revision: 2 },
      effects: [],
    });
    const admission = new TaskMonitorConversationInputAdmission(
      {
        resolveConversationBinding: vi.fn().mockResolvedValue({
          organizationId: input.organizationId,
          projectId: input.projectId,
        }),
        admitVerified,
      } as unknown as TaskMonitorStateMachineInputAdapter,
      {
        readUserMessage: vi.fn().mockResolvedValue({
          messageId: input.messageId,
          content: 'How is the selected work progressing?',
        }),
      } as unknown as LocalAgentService,
      {
        lookupByConversationId: vi.fn().mockReturnValue('run-1'),
        getRun: vi.fn().mockResolvedValue({
          contextMetadata: { taskMonitorId: input.taskMonitorId },
        }),
      } as unknown as RunStore,
      NOOP_LOGGER,
    );

    await expect(admission.admit(input)).resolves.toBe('accepted');
    expect(admitVerified).toHaveBeenCalledWith({
      source: 'CONVERSATION_MESSAGE',
      identity: { machineType: 'TASK_MONITOR', instanceId: input.taskMonitorId },
      ingressId: `conversation-message:${input.messageId}`,
      ...input,
    });
  });

  it('rejects a same-shaped trigger when the conversation belongs to another coordinator', async () => {
    const admitVerified = vi.fn();
    const admission = new TaskMonitorConversationInputAdmission(
      {
        resolveConversationBinding: vi.fn().mockResolvedValue({
          organizationId: input.organizationId,
          projectId: input.projectId,
        }),
        admitVerified,
      } as unknown as TaskMonitorStateMachineInputAdapter,
      { readUserMessage: vi.fn() } as unknown as LocalAgentService,
      {
        lookupByConversationId: vi.fn().mockReturnValue('run-2'),
        getRun: vi.fn().mockResolvedValue({
          contextMetadata: { taskMonitorId: 'another-monitor' },
        }),
      } as unknown as RunStore,
      NOOP_LOGGER,
    );

    await expect(admission.admit(input)).resolves.toBe('rejected');
    expect(admitVerified).not.toHaveBeenCalled();
  });
});

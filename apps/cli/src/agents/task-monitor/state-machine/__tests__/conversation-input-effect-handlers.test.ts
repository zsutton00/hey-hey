import { describe, expect, it, vi } from 'vitest';
import type { LocalAgentService } from '../../../../server/local-agent-service';
import type { TaskMonitorCoordinatorRunner } from '../../../../server/monitors/runner';
import { NOOP_LOGGER } from '../../../../server/logger';
import { TaskMonitorConversationInputEffectHandler } from '../conversation-input-effect-handlers';
import type { RunStore } from '../../../../run-store';

const deliveryEffect = {
  type: 'DELIVER_TASK_MONITOR_CONVERSATION_MESSAGE' as const,
  taskMonitorId: 'monitor-1',
  organizationId: 'organization-1',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  messageId: 'user-message-1',
};

const execution = {
  machineType: 'TASK_MONITOR',
  instanceId: 'monitor-1',
  effectId: 'effect-1',
};

const runStore = () =>
  ({
    appendEvent: vi.fn().mockResolvedValue({}),
    readRunEvents: vi.fn().mockResolvedValue([]),
  }) as unknown as RunStore;

describe('TaskMonitorConversationInputEffectHandler', () => {
  it('schedules one ordinary coordinator Turn then reconciles its canonical assistant Message', async () => {
    const readUserMessage = vi.fn().mockResolvedValue({
      messageId: deliveryEffect.messageId,
      content: 'What is the current progress?',
    });
    const readAssistantMessage = vi.fn().mockResolvedValue({
      messageId: 'assistant-message-1',
      content: 'The current task remains in progress.',
    });
    const sendMessage = vi.fn(async (_runId, request, options) => {
      expect(request.payload).toMatchObject({
        mode: 'CONVERSATION',
        taskMonitorId: deliveryEffect.taskMonitorId,
        sourceMessageId: deliveryEffect.messageId,
      });
      options?.onTurnStarted?.('turn-1');
      options?.onTurnSettled?.({
        turnId: 'turn-1',
        terminalOutcome: 'COMPLETED',
        completedAssistantMessageId: 'assistant-message-1',
      });
      return { result: {}, run: {} };
    });
    const agentService = {
      readUserMessage,
      readAssistantMessage,
      sendSystemMessage: sendMessage,
    } as unknown as LocalAgentService;
    const coordinatorRunner = {
      ensureTaskMonitorRun: vi.fn().mockResolvedValue({
        runId: 'run-1',
        coordinatorAgentSessionId: 'agent-session-1',
      }),
    } as unknown as TaskMonitorCoordinatorRunner;
    const handler = new TaskMonitorConversationInputEffectHandler(
      agentService,
      coordinatorRunner,
      runStore(),
      NOOP_LOGGER,
    );

    const started = await handler.execute(deliveryEffect, execution);
    expect(started).toMatchObject({
      status: 'succeeded',
      outcome: { type: 'CONVERSATION_TURN_STARTED', runId: 'run-1', turnId: 'turn-1' },
    });
    const persisted = await handler.execute(
      {
        type: 'RECONCILE_TASK_MONITOR_CONVERSATION_RESPONSE',
        taskMonitorId: deliveryEffect.taskMonitorId,
        organizationId: deliveryEffect.organizationId,
        projectId: deliveryEffect.projectId,
        conversationId: deliveryEffect.conversationId,
        messageId: deliveryEffect.messageId,
        runId: 'run-1',
        turnId: 'turn-1',
      },
      { ...execution, effectId: 'effect-2' },
    );
    expect(persisted).toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'CONVERSATION_RESPONSE_PERSISTED',
        assistantMessageId: 'assistant-message-1',
      },
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it('fails before scheduling when the canonical USER Message cannot be verified', async () => {
    const sendMessage = vi.fn();
    const handler = new TaskMonitorConversationInputEffectHandler(
      {
        readUserMessage: vi.fn().mockResolvedValue(null),
        sendMessage,
      } as unknown as LocalAgentService,
      { ensureTaskMonitorRun: vi.fn() } as unknown as TaskMonitorCoordinatorRunner,
      runStore(),
      NOOP_LOGGER,
    );

    await expect(handler.execute(deliveryEffect, execution)).resolves.toMatchObject({
      status: 'failed',
      outcome: { type: 'CONVERSATION_DELIVERY_FAILED' },
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('does not repeat an interrupted delivery whose Turn identity was not committed', async () => {
    const sendMessage = vi.fn();
    const handler = new TaskMonitorConversationInputEffectHandler(
      { sendMessage } as unknown as LocalAgentService,
      {
        ensureTaskMonitorRun: vi.fn().mockResolvedValue(undefined),
      } as unknown as TaskMonitorCoordinatorRunner,
      runStore(),
      NOOP_LOGGER,
    );

    await expect(handler.recovery.reconcile(deliveryEffect, execution)).resolves.toMatchObject({
      status: 'failed',
      outcome: {
        type: 'CONVERSATION_DELIVERY_FAILED',
        reason: expect.stringContaining('was not repeated'),
      },
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

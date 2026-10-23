import { describe, expect, it, vi } from 'vitest';
import { TaskMonitorOutcomeJudgmentEffectHandler } from '../outcome-judgment-effect-handlers';
import { NOOP_LOGGER } from '../../../../server/logger';
import type { ProjectTaskMonitorOutcomeJudgmentEffect } from '../effects';
import type { EffectExecutionIdentity } from '../../../../state-machine';

const effect: ProjectTaskMonitorOutcomeJudgmentEffect = {
  type: 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT',
  taskMonitorId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  requestId: '40000000-0000-4000-8000-000000000004',
  failure: { code: 'INVALID_JSON', message: 'Malformed coordinator output.', issues: [] },
};
const execution: EffectExecutionIdentity = {
  machineType: 'TASK_MONITOR',
  instanceId: effect.taskMonitorId,
  effectId: '50000000-0000-4000-8000-000000000005',
};
const harness = () => {
  const messages: Array<{ id: string; type: string; conversationId: string; data: object }> = [];
  const getMessages = vi.fn(async () => ({ data: { data: messages } }));
  const createOutOfBand = vi.fn(async (args) => {
    messages.push({
      id: 'posted-request',
      type: 'SYSTEM',
      conversationId: args.conversationId,
      data: args.dto.data,
    });
    return 'posted-request';
  });
  const resolve = vi.fn(async () => 'canonical-conversation');
  const handler = () =>
    new TaskMonitorOutcomeJudgmentEffectHandler(
      { clients: { conversationsApi: { getMessages } } } as never,
      { createOutOfBand } as never,
      { resolve } as never,
      NOOP_LOGGER,
    );
  return { messages, getMessages, createOutOfBand, resolve, handler };
};

describe('committed recovery request delivery', () => {
  it('posts one independently authored request and reconciles after reconstruction without a duplicate', async () => {
    const input = harness();
    const owner = input.handler();
    await Promise.all([owner.execute(effect, execution), owner.execute(effect, execution)]);
    expect(input.createOutOfBand).toHaveBeenCalledTimes(1);
    expect(input.messages[0]?.data).toMatchObject({
      outcome: 'JUDGMENT_REQUESTED',
      requestId: effect.requestId,
      guidance: expect.stringContaining('You do not need to repair'),
    });
    await expect(input.handler().recovery.reconcile(effect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { messageId: 'posted-request', conversationId: 'canonical-conversation' },
    });
    expect(input.createOutOfBand).toHaveBeenCalledTimes(1);
  });
  it('retains actionable failure when conversation delivery fails', async () => {
    const input = harness();
    input.createOutOfBand.mockRejectedValueOnce(new Error('Conversation service unavailable.'));
    await expect(input.handler().execute(effect, execution)).resolves.toMatchObject({
      status: 'failed',
      outcome: {
        type: 'OUTCOME_JUDGMENT_PROJECTION_FAILED',
        requestId: effect.requestId,
        reason: 'Conversation service unavailable.',
      },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { NOOP_LOGGER } from '../../server/logger';
import { SessionMonitorEvaluationStore } from './session-monitor-evaluation-store';

describe('SessionMonitorEvaluationStore', () => {
  const evaluationContext = {
    targetSessionId: 'session-1',
    targetConversationId: 'conversation-1',
    turnId: 'turn-1',
    completedAssistantContent: null,
    reports: [],
    workflow: {
      state: 'terminal' as const,
      promptType: null,
      nodeId: null,
      triggerMessageId: null,
    },
    availableActions: [],
  };

  it('resolves and immediately expires one Run-bound invocation', async () => {
    const store = new SessionMonitorEvaluationStore(NOOP_LOGGER);
    const result = store.begin('run-1', evaluationContext);

    expect(store.requireContext('run-1')).toBe(evaluationContext);
    store.resolve('run-1', { status: 'RELEASED', reason: 'no session action' });
    await expect(result).resolves.toEqual({ status: 'RELEASED', reason: 'no session action' });
    expect(() => store.requireContext('run-1')).toThrow('context is unavailable');
  });

  it('rejects concurrent bindings for the same reused monitor Run', () => {
    const store = new SessionMonitorEvaluationStore(NOOP_LOGGER);
    store.begin('run-1', evaluationContext);

    expect(() => store.begin('run-1', evaluationContext)).toThrow('already active');
  });
});

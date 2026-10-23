import { describe, expect, it, vi } from 'vitest';
import { handleAgentQuestion } from './agent-question';
import { makeDeps, makePoster, makeTestRun } from './__test-utils';
import type { AgentQuestionEvent } from '../types';

const makeEvent = (): AgentQuestionEvent =>
  ({
    runId: 'run-1',
    source: 'provider',
    eventType: 'agent_output',
    timestamp: '2025-01-01T00:00:00.000Z',
    sessionId: 'session-1',
    agentId: null,
    payload: {},
    kind: 'agent_question',
    requestId: 'claude_question_1',
    question: {
      responseType: 'agent_question_v1',
      requestId: 'claude_question_1',
      sessionId: 'session-1',
      agentType: 'claude',
      idempotencyToken: 'claude_question_1',
      questions: [
        {
          question: 'Which colour?',
          header: 'Colour',
          multiSelect: false,
          options: [{ label: 'Teal', description: 'Cool' }],
        },
      ],
      answers: null,
    },
  }) as AgentQuestionEvent;

describe('handleAgentQuestion', () => {
  it('posts one question message, records it, and only then opens Awaiting Approval', async () => {
    const poster = makePoster();
    const run = makeTestRun();
    const observe = vi.spyOn(run, 'observeProviderPhase');
    const order: string[] = [];
    vi.mocked(poster.createOutOfBand).mockImplementation(async () => {
      order.push('posted');
      return 'question-msg-1';
    });
    observe.mockImplementation(() => {
      order.push('awaiting_approval');
    });

    await handleAgentQuestion(makeEvent(), run, makeDeps(poster));

    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
    expect(order).toEqual(['posted', 'awaiting_approval']);
    expect(observe).toHaveBeenCalledWith('awaiting_approval');
    expect(run.getQuestionMessage('claude_question_1')?.messageId).toBe('question-msg-1');
  });

  it('does not open Awaiting Approval when the question could not be posted', async () => {
    const poster = makePoster();
    vi.mocked(poster.createOutOfBand).mockRejectedValue(new Error('network'));
    const run = makeTestRun();
    const observe = vi.spyOn(run, 'observeProviderPhase');

    await handleAgentQuestion(makeEvent(), run, makeDeps(poster));

    expect(observe).not.toHaveBeenCalled();
    expect(run.getQuestionMessage('claude_question_1')).toBeUndefined();
  });
});

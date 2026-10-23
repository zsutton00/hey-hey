import { describe, expect, it, vi } from 'vitest';
import { handleQuestionAnswered } from './question-answered';
import { makeDeps, makePoster, makeTestRun } from './__test-utils';
import type { QuestionAnsweredEvent } from '../types';
import type { SystemMessageData } from '../../shared/api/index';

const event = {
  runId: 'run-1',
  source: 'local',
  eventType: 'question_answer_ui',
  timestamp: '2025-01-01T00:01:00.000Z',
  sessionId: 'session-1',
  agentId: null,
  payload: {},
  kind: 'question_answered',
  requestId: 'claude_question_1',
  answers: { 'Which colour?': 'Teal' },
  answeredAt: '2025-01-01T00:01:00.000Z',
} as QuestionAnsweredEvent;

const questionData = {
  type: 'QUESTIONS',
  title: 'Question',
  uiElements: [
    {
      id: 'agent-question:claude_question_1',
      type: 'agent_question',
      label: 'Question',
      payload: { responseType: 'agent_question_v1', requestId: 'claude_question_1', answers: null },
    },
    { id: 'other', type: 'agent_complete', label: 'Other' },
  ],
} as unknown as SystemMessageData;

describe('handleQuestionAnswered', () => {
  it('writes answers and answeredAt onto only the question field and completes the message', async () => {
    const poster = makePoster();
    const run = makeTestRun();
    run.recordQuestionMessage('claude_question_1', 'question-msg-1', questionData);

    await handleQuestionAnswered(event, run, makeDeps(poster));

    expect(poster.complete).toHaveBeenCalledOnce();
    const [, , messageId, body] = vi.mocked(poster.complete).mock.calls[0]!;
    expect(messageId).toBe('question-msg-1');
    const elements = (body as { data: SystemMessageData }).data.uiElements!;
    expect(elements[0]).toMatchObject({
      payload: {
        answers: { 'Which colour?': 'Teal' },
        answeredAt: '2025-01-01T00:01:00.000Z',
      },
    });
    expect(elements[1]).toEqual(questionData.uiElements![1]);
    expect(run.getQuestionMessage('claude_question_1')).toBeUndefined();
  });

  it('keeps the entry when the update fails so the failure stays visible', async () => {
    const poster = makePoster();
    vi.mocked(poster.complete).mockRejectedValue(new Error('network'));
    const run = makeTestRun();
    run.recordQuestionMessage('claude_question_1', 'question-msg-1', questionData);

    await handleQuestionAnswered(event, run, makeDeps(poster));

    expect(run.getQuestionMessage('claude_question_1')).toBeDefined();
  });

  it('does nothing for a question that was never posted', async () => {
    const poster = makePoster();

    await handleQuestionAnswered(event, makeTestRun(), makeDeps(poster));

    expect(poster.complete).not.toHaveBeenCalled();
  });
});

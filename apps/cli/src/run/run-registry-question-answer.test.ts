import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from './run.test-support';
import { RunRegistry } from './run-registry';
import { Run, type RunArgs, type RunCollaborators } from './run';
import type { AgenticSession } from '../session/types';
import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type {
  AgentSessionRunner,
  QuestionAnswerDispatchArgs,
  QuestionAnswerDispatchResult,
} from '../agents/providers/session-runner';
import type { RunEventPublisher } from '../server/run-event-publisher';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';

const makeSession = (): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude' as const,
    provider_session_id: 'sess-1',
    provider_conversation_id: null,
    status: 'ACTIVE',
    serviceId: null,
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1', agentSessionId: 'run-1' },
    events: [],
  }) as unknown as AgenticSession;

const makeRunArgs = (): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session: makeSession(),
});

const makeCollaborators = (broadcaster: RunEventPublisher): RunCollaborators => ({
  runStore: createTestRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('question-msg-1'),
  }),
  broadcaster,
  ...createTestRunOwnership(),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(() => ({ run: async () => {} })),
  logger: {
    info: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'],
});

const makeRegistry = (collaborators: RunCollaborators): RunRegistry =>
  new RunRegistry({
    runCollaborators: collaborators,
    submissionToolRegistry: collaborators.submissionToolRegistry,
    sessionRunnerFacade: createTestSessionRunnerFacade(),
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents: new RunLifecycleEvents(),
  });

const questionPayload = {
  responseType: 'agent_question_v1',
  requestId: 'claude_question_1',
  sessionId: 'sess-1',
  agentType: 'claude',
  idempotencyToken: 'claude_question_1',
  questions: [
    {
      question: 'Which colour?',
      header: 'Colour',
      multiSelect: false,
      options: [
        { label: 'Teal', description: 'Cool' },
        { label: 'Orange', description: 'Warm' },
      ],
    },
  ],
  answers: null,
};

const postQuestion = async (run: Run): Promise<void> => {
  run.onAgentOutput({
    event: {
      source: 'provider',
      eventType: 'agent_output',
      timestamp: '2026-07-01T00:00:00.000Z',
      sessionId: 'sess-1',
      agentId: null,
      payload: { messageType: 'system', summary: JSON.stringify(questionPayload) },
    },
  });
  await run.drainInFlightDispatch(100);
};

const answerInput = {
  requestId: 'claude_question_1',
  idempotencyToken: 'token-1',
  answers: { 'Which colour?': 'Teal' },
};

const bindRunner = (
  run: Run,
  result: QuestionAnswerDispatchResult,
): ReturnType<typeof vi.fn<(args: QuestionAnswerDispatchArgs) => QuestionAnswerDispatchResult>> => {
  const submit = vi.fn((_args: QuestionAnswerDispatchArgs) => result);
  run.setRunner({
    run: async () => {},
    submitQuestionAnswer: submit,
  } as unknown as AgentSessionRunner);
  return submit;
};

describe('RunRegistry.submitQuestionAnswer', () => {
  it('posts the question, waits on the person, then resumes thinking when the answer is delivered', async () => {
    const broadcaster = createTestRunEventPublisher();
    const collaborators = makeCollaborators(broadcaster);
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());

    await postQuestion(run);

    expect(collaborators.poster.createOutOfBand).toHaveBeenCalledOnce();
    const posted = vi.mocked(collaborators.poster.createOutOfBand).mock.calls[0]![0];
    expect(posted.dto).toMatchObject({
      type: 'SYSTEM',
      data: {
        uiElements: [
          {
            id: 'agent-question:claude_question_1',
            type: 'agent_question',
            payload: { responseType: 'agent_question_v1', answers: null },
          },
        ],
      },
    });
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'AWAITING_APPROVAL' }),
    );

    const submit = bindRunner(run, { delivered: true, answeredAt: '2026-07-01T00:01:00.000Z' });
    vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mockClear();

    await expect(
      Promise.resolve(registry.submitQuestionAnswer('run-1', answerInput)),
    ).resolves.toEqual({ outcome: 'delivered' });

    expect(submit).toHaveBeenCalledWith(answerInput);
    // No provider event arrived after delivery: the resumed phase is published explicitly.
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledOnce();
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenCalledWith(
      expect.objectContaining({ currentState: 'THINKING' }),
    );
  });

  it('writes the answers and answer time back onto the question message', async () => {
    const collaborators = makeCollaborators(createTestRunEventPublisher());
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    await postQuestion(run);

    run.onAgentOutput({
      event: {
        source: 'local',
        eventType: 'question_answer_ui',
        timestamp: '2026-07-01T00:01:00.000Z',
        sessionId: 'sess-1',
        agentId: null,
        payload: {
          requestId: 'claude_question_1',
          answers: answerInput.answers,
          answeredAt: '2026-07-01T00:01:00.000Z',
        },
      },
    });
    await run.drainInFlightDispatch(100);

    expect(collaborators.poster.complete).toHaveBeenCalledOnce();
    expect(collaborators.poster.complete).toHaveBeenCalledWith(
      'org-1',
      'proj-1',
      'question-msg-1',
      {
        status: 'completed',
        data: expect.objectContaining({
          uiElements: [
            expect.objectContaining({
              payload: expect.objectContaining({
                answers: answerInput.answers,
                answeredAt: '2026-07-01T00:01:00.000Z',
              }),
            }),
          ],
        }),
      },
      null,
    );
    expect(run.getQuestionMessage('claude_question_1')).toBeUndefined();
  });

  it('drops a repeated or stale answer without changing the waiting state', async () => {
    const broadcaster = createTestRunEventPublisher();
    const registry = makeRegistry(makeCollaborators(broadcaster));
    const run = registry.create(makeRunArgs());
    await postQuestion(run);
    vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mockClear();

    bindRunner(run, { delivered: false, outcome: 'duplicate' });
    expect(registry.submitQuestionAnswer('run-1', answerInput)).toEqual({ outcome: 'duplicate' });

    bindRunner(run, { delivered: false, outcome: 'stale', reason: 'request_not_found' });
    expect(registry.submitQuestionAnswer('run-1', answerInput)).toEqual({
      outcome: 'stale',
      reason: 'request_not_found',
    });
    expect(broadcaster.emitAgentSessionCurrentStateObservation).not.toHaveBeenCalled();
  });

  it('drops answers for an unknown Run or a runner without question support', () => {
    const registry = makeRegistry(makeCollaborators(createTestRunEventPublisher()));
    expect(registry.submitQuestionAnswer('missing', answerInput)).toEqual({
      outcome: 'dropped',
      reason: 'no_run_registered',
    });
    const run = registry.create(makeRunArgs());
    run.setRunner({ run: async () => {} } as unknown as AgentSessionRunner);
    expect(registry.submitQuestionAnswer('run-1', answerInput)).toEqual({
      outcome: 'dropped',
      reason: 'no_question_capable_runner_bound',
    });
  });

  it('reports a runner failure instead of throwing', () => {
    const registry = makeRegistry(makeCollaborators(createTestRunEventPublisher()));
    const run = registry.create(makeRunArgs());
    run.setRunner({
      run: async () => {},
      submitQuestionAnswer: () => {
        throw new Error('boom');
      },
    } as unknown as AgentSessionRunner);
    expect(registry.submitQuestionAnswer('run-1', answerInput)).toEqual({
      outcome: 'failed',
      reason: 'boom',
    });
  });

  it('does not leave the Run waiting when it is cleaned up while a question is open', async () => {
    const broadcaster = createTestRunEventPublisher();
    const registry = makeRegistry(makeCollaborators(broadcaster));
    const run = registry.create(makeRunArgs());
    await postQuestion(run);
    expect(broadcaster.emitAgentSessionCurrentStateObservation).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentState: 'AWAITING_APPROVAL' }),
    );

    run.cleanup();

    const states = vi
      .mocked(broadcaster.emitAgentSessionCurrentStateObservation)
      .mock.calls.map((call) => call[0].currentState);
    expect(states.at(-1)).not.toBe('AWAITING_APPROVAL');
    expect(run.getQuestionMessage('claude_question_1')).toBeUndefined();
  });
});

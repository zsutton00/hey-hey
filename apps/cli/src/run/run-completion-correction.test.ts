import { describe, expect, it, vi } from 'vitest';
import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import { createOnCompleteTestDeps } from '../agents/prompt-type-handler.test-support';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import { NOOP_LOGGER } from '../server/logger';
import { Turn, type Runner } from '../turn/turn';
import { handleAssistantComplete } from './handlers/assistant-complete';
import { makeDeps, makePoster, makeTestRun } from './handlers/__test-utils';
import type { AssistantCompleteEvent } from './types';

const complete = (summary: string): AssistantCompleteEvent =>
  ({ kind: 'assistant_complete', summary }) as AssistantCompleteEvent;

const setup = (replies: string[]) => {
  const onInvalidCompletion = vi.fn().mockResolvedValue(undefined);
  const handler = {
    promptType: LocalPromptType.RepositoryGrounding,
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    buildPrompt: () => '',
    validateCompletion: (event: AssistantCompleteEvent) =>
      event.summary === 'valid'
        ? { ok: true as const }
        : { ok: false as const, error: { message: 'bad', issues: ['/serviceId: mismatch'] } },
    getCompletionAction: (event: AssistantCompleteEvent) => ({
      action: { action: event.summary === 'valid' ? 'success' : 'terminal_failure' },
      hidden: true,
      userFacingResponse: '',
    }),
    onInvalidCompletion,
  } as unknown as PromptTypeHandler<unknown>;
  const poster = makePoster();
  const run = makeTestRun({
    triggerContext: { externalAgentNodeId: 'node-1', triggerMessageId: 'trigger-1' },
  });
  const deps = makeDeps(poster);
  deps.onCompleteDeps = createOnCompleteTestDeps({ logger: deps.logger, poster });
  const dispatcher = (run as unknown as { dispatcher: { dispatch: unknown } }).dispatcher;
  vi.spyOn(dispatcher as { dispatch: () => Promise<void> }, 'dispatch').mockImplementation((async (
    event: AssistantCompleteEvent,
  ) => {
    await handleAssistantComplete(event, run, deps, run.activeTurn);
  }) as never);
  const prompts: string[] = [];
  const continueTurn = vi.fn(async (prompt: string) => {
    prompts.push(prompt);
    const reply = replies.shift();
    if (reply) await handleAssistantComplete(complete(reply), run, deps, run.activeTurn);
  });
  const runner: Runner = { run: () => Promise.resolve(), continueTurn };
  const turn = new Turn({
    effectiveRole: 'implementation',
    turnId: 'turn-1',
    runId: run.runId,
    resolvedPrompt: '',
    handler,
    externalAgentNodeId: 'node-1',
    triggerMessageId: 'trigger-1',
    runner,
    platformMcpProxy: null,
    abortController: new AbortController(),
    effectiveModel: null,
    effectiveReasoningEffort: null,
    logger: NOOP_LOGGER,
    owner: run,
  });
  run.activeTurn = turn;
  const recordPendingCompletion = vi.spyOn(run, 'recordPendingCompletion');
  return { run, turn, deps, continueTurn, prompts, onInvalidCompletion, recordPendingCompletion };
};

describe('Run.completeCompletionCorrection', () => {
  it('publishes only the corrected answer after an invalid one', async () => {
    const { run, turn, deps, continueTurn, prompts, onInvalidCompletion, recordPendingCompletion } =
      setup(['valid']);

    await handleAssistantComplete(complete('invalid'), run, deps, turn);
    expect(recordPendingCompletion).not.toHaveBeenCalled();
    await run.completeCompletionCorrection(turn);

    expect(continueTurn).toHaveBeenCalledOnce();
    expect(continueTurn).toHaveBeenCalledWith(expect.any(String), turn.abortSignal, {
      reportingRepair: false,
    });
    expect(prompts[0]).toContain('/serviceId: mismatch');
    expect(onInvalidCompletion).not.toHaveBeenCalled();
    expect(recordPendingCompletion).toHaveBeenCalledOnce();
    expect(recordPendingCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ action: { action: 'success' } }),
    );
  });

  it('publishes exactly one failure once correction attempts run out', async () => {
    const { run, turn, deps, continueTurn, onInvalidCompletion, recordPendingCompletion } = setup([
      'invalid',
      'invalid',
    ]);

    await handleAssistantComplete(complete('invalid'), run, deps, turn);
    await run.completeCompletionCorrection(turn);
    await run.completeCompletionCorrection(turn);

    expect(continueTurn).toHaveBeenCalledTimes(2);
    expect(onInvalidCompletion).toHaveBeenCalledOnce();
    expect(recordPendingCompletion).toHaveBeenCalledOnce();
    expect(recordPendingCompletion).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { action: 'terminal_failure' },
        triggerMessageId: 'trigger-1',
      }),
    );
  });

  it('leaves a conforming first answer untouched', async () => {
    const { run, turn, deps, continueTurn, onInvalidCompletion, recordPendingCompletion } = setup(
      [],
    );

    await handleAssistantComplete(complete('valid'), run, deps, turn);
    await run.completeCompletionCorrection(turn);

    expect(continueTurn).not.toHaveBeenCalled();
    expect(onInvalidCompletion).not.toHaveBeenCalled();
    expect(recordPendingCompletion).toHaveBeenCalledOnce();
  });
});

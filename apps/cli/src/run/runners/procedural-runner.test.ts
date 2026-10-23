import { describe, expect, it, vi } from 'vitest';
import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../../agents/prompt-type-handler';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import { RunnerPicker } from './pick-runner';
import { ProceduralRunner } from './procedural-runner';
import type { RunnerContext, RunnerPickerDependencies } from './types';

const makeContext = (
  runProcedure: PromptTypeHandler<unknown>['runProcedure'],
): { ctx: RunnerContext; onAgentOutput: ReturnType<typeof vi.fn> } => {
  const onAgentOutput = vi.fn();
  const handler = {
    id: 'run_eval',
    promptType: LocalPromptType.RunEval,
    runnerKind: 'procedural',
    runProcedure,
  } as unknown as PromptTypeHandler<unknown>;
  const ctx = {
    run: { runId: 'run-1', session: { agentic_session_id: 'run-1' }, onAgentOutput },
    handler,
    input: { payload: { raw: true } },
    preparedPayload: { prepared: true },
    handlerDeps: {} as PromptTypeHandlerDeps,
  } as unknown as RunnerContext;
  return { ctx, onAgentOutput };
};

describe('ProceduralRunner', () => {
  it('is picked for a procedural handler without touching provider sessions', () => {
    const forRun = vi.fn();
    const picker = new RunnerPicker({
      sessionRunnerFacade: { forRun },
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
    } as unknown as RunnerPickerDependencies);
    const { ctx } = makeContext(async () => 'done');
    expect(picker.pick(ctx)).toBeInstanceOf(ProceduralRunner);
    expect(forRun).not.toHaveBeenCalled();
  });

  it('runs the procedure on the prepared payload and publishes its summary', async () => {
    const runProcedure = vi.fn(async () => 'Eval run finished.');
    const { ctx, onAgentOutput } = makeContext(runProcedure);
    const signal = new AbortController().signal;

    await new ProceduralRunner(ctx).run(signal);

    expect(runProcedure).toHaveBeenCalledWith(
      { prepared: true },
      { session: ctx.run.session, deps: ctx.handlerDeps },
      signal,
    );
    expect(onAgentOutput).toHaveBeenCalledWith({
      event: expect.objectContaining({
        eventType: 'agent_output',
        payload: { messageType: 'assistant', taskComplete: true, summary: 'Eval run finished.' },
      }),
    });
  });
});

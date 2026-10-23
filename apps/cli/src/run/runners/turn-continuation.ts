import type { SessionRunnerFacade } from '../../server/runtime/providers/select';
import type { RunnerContext } from './types';

/** Resumes the existing provider; it never admits input or builds a new Turn. */
export class TurnContinuation {
  public constructor(
    private readonly context: RunnerContext,
    private readonly facade: SessionRunnerFacade,
  ) {}
  public async run(
    prompt: string,
    signal: AbortSignal,
    options: { reportingRepair: boolean },
  ): Promise<void> {
    const ctx = this.context;
    await this.facade.resumeSession(
      ctx.run,
      {
        session: ctx.run.session,
        prompt,
        signal,
        ...(ctx.effectiveModel ? { model: ctx.effectiveModel } : {}),
        ...(ctx.effectiveReasoningEffort ? { reasoningEffort: ctx.effectiveReasoningEffort } : {}),
        ...(ctx.browserMcpMount ? { browserMcpMount: ctx.browserMcpMount } : {}),
        ...(ctx.platformMcpProxyMount ? { platformMcpProxyMount: ctx.platformMcpProxyMount } : {}),
        ...(ctx.workspace ? { workspace: ctx.workspace } : {}),
        ...(ctx.workspaceWriteBoundary
          ? { workspaceWriteBoundary: ctx.workspaceWriteBoundary }
          : {}),
        ...(ctx.handler.mcpToolUseCase ? { mcpToolUseCase: ctx.handler.mcpToolUseCase } : {}),
        ...(options.reportingRepair ? { reportingRepair: true } : {}),
      },
      ctx.executionProvider,
    );
  }
}

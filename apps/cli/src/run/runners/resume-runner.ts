import { TurnContinuation } from './turn-continuation';
import type { ServerLogger } from '../../server/logger';
import type { SessionRunnerFacade } from '../../server/runtime/providers/select';
import type { Runner } from '../../turn/turn';
import type { RunnerContext } from './types';
import { projectProviderSessionStartupInput } from '../provider-session-startup-input';

export interface ResumeRunnerDeps {
  sessionRunnerFacade: SessionRunnerFacade;
  logger: ServerLogger;
}

/**
 * Resumes the Run's persisted provider session. Picked when the handler's
 * `runnerKind` is `'provider_session'` and the Run already has a session
 * (`run.hasProviderSession === true`). An empty `resolvedPrompt` signals
 * "resume only, no new user text" — the session-runner supplies its own
 * default in that case.
 */
export class ResumeRunner implements Runner {
  private readonly turnContinuation: TurnContinuation;

  async continueTurn(
    prompt: string,
    signal: AbortSignal,
    options: { reportingRepair: boolean },
  ): Promise<void> {
    await this.turnContinuation.run(prompt, signal, options);
  }

  constructor(
    private readonly ctx: RunnerContext,
    private readonly deps: ResumeRunnerDeps,
  ) {
    this.turnContinuation = new TurnContinuation(ctx, deps.sessionRunnerFacade);
  }

  async run(signal: AbortSignal): Promise<void> {
    const {
      run,
      handler,
      resolvedPrompt,
      effectiveModel,
      executionProvider,
      effectiveReasoningEffort,
      input,
      browserMcpMount,
      platformMcpProxyMount,
      platformMcpAdditionalAllowedTools,
      workspace,
      workspaceWriteBoundary,
    } = this.ctx;

    if (this.ctx.startupPromptInput && this.ctx.providerSessionDecision !== 'resume') {
      throw new Error('ResumeRunner requires a resume provider-session decision.');
    }
    const startupProjection = this.ctx.startupPromptInput
      ? projectProviderSessionStartupInput({
          decision: 'resume',
          prompt: resolvedPrompt,
          startupPromptInput: this.ctx.startupPromptInput,
        })
      : null;
    this.deps.logger.debug('local.run.provider_session.action', {
      runId: run.runId,
      providerSessionAction: 'resume',
      providerSessionDecision: this.ctx.providerSessionDecision ?? null,
      startupInputAvailable: this.ctx.startupPromptInput !== undefined,
      startupInputDelivered: startupProjection?.delivered ?? false,
    });
    const providerPrompt =
      startupProjection?.input.kind === 'turn' ? startupProjection.input.prompt : resolvedPrompt;

    if (this.ctx.startupPromptInput) {
      const { provenance } = this.ctx.startupPromptInput;
      this.deps.logger.info('local.run.provider_session.startup_context', {
        runId: run.runId,
        providerSessionAction: startupProjection!.action,
        startupInputDelivered: startupProjection!.delivered,
        templateKey: provenance.templateKey,
        ownershipSource: provenance.ownershipSource,
        revisionId: provenance.revisionId,
        revisionNumber: provenance.revisionNumber,
      });
    }

    const mcpToolUseCase = handler.mcpToolUseCase;
    const additionalAllowedTools =
      platformMcpAdditionalAllowedTools && platformMcpAdditionalAllowedTools.length > 0
        ? platformMcpAdditionalAllowedTools
        : (() => {
            const dynamicAdditionalAllowedTools = handler.resolveAdditionalAllowedTools?.({
              session: run.session,
              input,
              payload: this.ctx.preparedPayload ?? input.payload,
            });
            const merged = [
              ...(handler.additionalAllowedTools ?? []),
              ...(dynamicAdditionalAllowedTools ?? []),
            ];
            return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
          })();
    const additionalBuiltinTools = handler.additionalBuiltinTools;
    const readOnlyFilesystem = handler.readOnlyFilesystem;
    const result = await this.deps.sessionRunnerFacade.resumeSession(
      run,
      {
        session: run.session,
        attachmentRunId: run.runId,
        attachments: input.attachments ?? [],
        ...(providerPrompt ? { prompt: providerPrompt } : {}),
        ...(input.skillSelection ? { skillSelection: input.skillSelection } : {}),
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
        ...(mcpToolUseCase ? { mcpToolUseCase } : {}),
        ...(additionalAllowedTools && additionalAllowedTools.length > 0
          ? { additionalAllowedTools }
          : {}),
        ...(browserMcpMount ? { browserMcpMount } : {}),
        ...(platformMcpProxyMount ? { platformMcpProxyMount } : {}),
        ...(additionalBuiltinTools && additionalBuiltinTools.length > 0
          ? { additionalBuiltinTools }
          : {}),
        ...(readOnlyFilesystem ? { readOnlyFilesystem } : {}),
        ...(workspace ? { workspace } : {}),
        ...(workspaceWriteBoundary ? { workspaceWriteBoundary } : {}),
        signal,
      },
      executionProvider,
    );

    const patch: Partial<typeof run.session> = {};
    if (result.providerSessionId !== null) {
      patch.provider_session_id = result.providerSessionId;
    }
    if (result.providerConversationId !== null) {
      patch.provider_conversation_id = result.providerConversationId;
    }
    if (Object.keys(patch).length > 0) {
      run.refreshSessionFields(patch);
    }
  }
}

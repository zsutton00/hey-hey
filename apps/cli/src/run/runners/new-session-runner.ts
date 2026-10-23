import { TurnContinuation } from './turn-continuation';
import type { ServerLogger } from '../../server/logger';
import type { SessionRunnerFacade } from '../../server/runtime/providers/select';
import type { Runner } from '../../turn/turn';
import type { RunnerContext } from './types';
import { renderServiceScopeRecovery } from '../resolve-prompt';
import { projectProviderSessionStartupInput } from '../provider-session-startup-input';

export interface NewSessionRunnerDeps {
  sessionRunnerFacade: SessionRunnerFacade;
  logger: ServerLogger;
}

/**
 * Starts a fresh provider session for the Run. Picked when the handler's
 * `runnerKind` is `'provider_session'` and the Run has no session yet.
 * `resolvedPrompt` must be a non-empty string — a new session needs an
 * initial prompt to seed the turn. Once the provider returns a session
 * id, `Run.hasProviderSession` is flipped to true so the next Turn
 * resumes instead of starting a second session.
 */
export class NewSessionRunner implements Runner {
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
    private readonly deps: NewSessionRunnerDeps,
  ) {
    this.turnContinuation = new TurnContinuation(ctx, deps.sessionRunnerFacade);
  }

  async run(signal: AbortSignal): Promise<void> {
    const {
      run,
      handler,
      resolvedPrompt,
      input,
      effectiveModel,
      executionProvider,
      effectiveReasoningEffort,
      browserMcpMount,
      platformMcpProxyMount,
      platformMcpAdditionalAllowedTools,
      workspace,
      workspaceWriteBoundary,
    } = this.ctx;
    const decision = this.ctx.providerSessionDecision;
    if (this.ctx.startupPromptInput && (!decision || decision === 'resume')) {
      throw new Error('NewSessionRunner requires a mint or remint provider-session decision.');
    }
    const startupProjection =
      this.ctx.startupPromptInput && decision && decision !== 'resume'
        ? projectProviderSessionStartupInput({
            decision,
            prompt: resolvedPrompt,
            startupPromptInput: this.ctx.startupPromptInput,
            ...(this.ctx.providerSessionStartupSegments
              ? { promptSegments: this.ctx.providerSessionStartupSegments }
              : {}),
          })
        : null;
    this.deps.logger.debug('local.run.provider_session.action', {
      runId: run.runId,
      providerSessionAction: startupProjection?.action ?? 'mint',
      providerSessionDecision: decision ?? null,
      startupInputAvailable: this.ctx.startupPromptInput !== undefined,
      startupInputDelivered: startupProjection?.delivered ?? false,
    });
    const providerInput = startupProjection?.input ?? {
      kind: 'turn' as const,
      prompt: resolvedPrompt,
    };
    const providerPrompt =
      providerInput.kind === 'turn'
        ? providerInput.prompt
        : [
            providerInput.segments.stableInstructions,
            providerInput.segments.dynamicContext,
            providerInput.segments.userInput,
          ]
            .filter((value) => value.length > 0)
            .join('\n\n');
    if (!providerPrompt) {
      throw new Error(
        'NewSessionRunner: resolvedPrompt is empty — a new provider session ' +
          'cannot be started without a prompt.',
      );
    }

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
    const repositoryResearch = handler.repositoryResearch;
    const builtinTools = handler.builtinTools;
    const mcpToolUseCase = handler.mcpToolUseCase;

    const prompt = this.ctx.serviceScopeRecovery
      ? `${renderServiceScopeRecovery(this.ctx.serviceScopeRecovery.checkpoint)}\n\n---\n\n${providerPrompt}`
      : providerPrompt;
    const result = await this.deps.sessionRunnerFacade.runPrompt(
      run,
      {
        session: run.session,
        attachmentRunId: run.runId,
        attachments: input.attachments ?? [],
        prompt,
        ...(handler.epistemicCalibration ? { epistemicCalibration: true as const } : {}),
        ...(handler.replaceProviderSystemPrompt ? { replaceProviderSystemPrompt: true } : {}),
        ...(providerInput.kind === 'startup'
          ? {
              startupSegments: {
                ...providerInput.segments,
                dynamicContext: this.ctx.serviceScopeRecovery
                  ? `${renderServiceScopeRecovery(this.ctx.serviceScopeRecovery.checkpoint)}\n\n---\n\n${providerInput.segments.dynamicContext}`
                  : providerInput.segments.dynamicContext,
              },
            }
          : {}),
        ...(input.references ? { references: input.references } : {}),
        ...(input.skillSelection ? { skillSelection: input.skillSelection } : {}),
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
        ...(repositoryResearch ? { repositoryResearch } : {}),
        ...(builtinTools !== undefined ? { builtinTools } : {}),
        ...(effectiveModel ? { model: effectiveModel } : {}),
        ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
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

    run.setHasProviderSession(true, 'new-session-mint');
    if (this.ctx.serviceScopeRecovery) {
      await run.serviceScope.completeServiceScopeRecoveryDelivery(this.ctx.serviceScopeRecovery);
    }
  }
}

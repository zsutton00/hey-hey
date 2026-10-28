import type { AgenticSession } from '../../session/types';
import type { ChildAgentLauncher, ChildLaunchRequest } from '../../run/child-agent-launcher';
import type { SubAgentResult, SubAgentUsage } from '../../run/subagent';
import type { AgentStartupPromptInputResult } from '../prompt-type-handler';
import type { ProjectAssistantPromptPayload } from '../project-assistant/project-assistant.handler';
import { EvalResearchTools, sumEvalUsage } from './eval-research-tools';
import { EvalTokenBudget, type EvalExecutionContext } from './eval-execution-context';
import { resolveProjectAssistantPolicy } from '../project-assistant/proactive-behavior';
import { EvalPreparationRecords } from './eval-preparation-records';

/** Attempt-specific preparation and tool ownership, outside shared launch orchestration. */
export class EvalChildExecution {
  public readonly session: AgenticSession;
  public readonly execution: EvalExecutionContext;
  public payload: ChildLaunchRequest['payload'];
  public prepared = false;
  public startupPromptInput: AgentStartupPromptInputResult | undefined;
  public researchTools: EvalResearchTools | undefined;
  private preparationElapsedMs: number | undefined;
  public readonly preparationRecords = new EvalPreparationRecords();
  private readonly preparationUsage: SubAgentUsage[] = [];

  public constructor(
    private readonly request: ChildLaunchRequest & { evalExecution: EvalExecutionContext },
    session: AgenticSession,
    private readonly launcher: ChildAgentLauncher,
  ) {
    this.execution = {
      ...request.evalExecution,
      ...(request.tokenBudget !== undefined && !request.evalExecution.tokenBudget
        ? { tokenBudget: new EvalTokenBudget(request.tokenBudget, request.signal) }
        : {}),
    };
    this.session = {
      ...session,
      agentic_session_id: request.evalExecution.targetSessionId,
      conversationId: request.evalExecution.targetConversationId,
      promptType: request.handler.promptType,
      entity: request.entity ?? null,
    };
    this.payload = request.payload;
    this.startupPromptInput = request.startupPromptInput;
  }

  public async prepare(): Promise<void> {
    try {
      await this.prepareUnlogged();
    } catch (error) {
      this.request.handlerDeps?.logger.error('run_eval.attempt.preparation_failed', {
        attemptId: this.execution.attemptId,
        handlerId: this.request.handler.id,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      });
      throw error;
    }
  }

  private async prepareUnlogged(): Promise<void> {
    const startedAt = Date.now();
    const { handlerDeps, entity, handler } = this.request;
    if (handlerDeps && entity) {
      this.startupPromptInput = await handlerDeps.startupPromptInput.resolve({
        runEntity: entity,
        organizationId: this.session.contextMetadata.organizationId,
        projectId: this.session.contextMetadata.projectId,
      });
      const config = this.session.config;
      const policy = resolveProjectAssistantPolicy(
        handler.resolveProjectAssistant
          ? handler.resolveProjectAssistant(this.session, handlerDeps.logger)
          : handler.projectAssistant,
        config && 'projectAssistant' in config ? config.projectAssistant : undefined,
      );
      if (policy) {
        const raw = this.payload;
        const userMessage =
          typeof raw === 'object' &&
          raw !== null &&
          'userMessage' in raw &&
          typeof raw.userMessage === 'string'
            ? raw.userMessage
            : '';
        const research = await this.launcher.launchRegistered('project_assistant', {
          parentSession: this.session,
          payload: {
            promptType: 'research',
            entity,
            userMessage,
            projectAssistantHandoff: { consumerHandlerId: handler.id, policy },
          } satisfies ProjectAssistantPromptPayload,
          entity,
          handlerDeps,
          evalExecution: this.execution,
          signal: this.execution.tokenBudget?.signal ?? this.request.signal,
          ...(this.session.model ? { model: this.session.model } : {}),
          ...(this.session.reasoningEffort
            ? { reasoningEffort: this.session.reasoningEffort }
            : {}),
          ...(this.request.tokenBudget !== undefined
            ? { tokenBudget: this.request.tokenBudget }
            : {}),
        });
        if (!research.assistantCompleted || !research.outputText) {
          throw new Error(
            'Project Assistant preparation ended without a completed research report.',
          );
        }
        this.preparationUsage.push(
          research.usage,
          ...(research.preparationMeasurements ?? []).map((measurement) => ({
            ...(measurement.inputTokens !== undefined
              ? { inputTokens: measurement.inputTokens }
              : {}),
            ...(measurement.outputTokens !== undefined
              ? { outputTokens: measurement.outputTokens }
              : {}),
            ...(measurement.toolCalls !== undefined ? { toolCalls: measurement.toolCalls } : {}),
          })),
        );
        if (research.outputText)
          this.startupPromptInput = {
            ...this.startupPromptInput,
            renderedInput: `${this.startupPromptInput.renderedInput}\n\n## Project Assistant preparation\n${research.outputText}`,
          };
      }
      if (handler.prepare) {
        const prepared = await handler.prepare(
          this.session,
          this.payload,
          {
            ...handlerDeps,
            preparationRecords: this.preparationRecords,
            // Preparation belongs to the target's runtime and cancellation,
            // never to the coordinator's model or provider session.
            promptOnce: async ({ prompt }) => {
              const result = await this.launcher.launchRegistered('eval_preparation', {
                parentSession: this.session,
                payload: { prompt },
                signal: this.execution.tokenBudget?.signal ?? this.request.signal,
                evalExecution: this.execution,
                serviceIds: [],
                ...(this.session.model ? { model: this.session.model } : {}),
                ...(this.session.reasoningEffort
                  ? { reasoningEffort: this.session.reasoningEffort }
                  : {}),
                ...(this.request.tokenBudget !== undefined
                  ? { tokenBudget: this.request.tokenBudget }
                  : {}),
              });
              this.preparationUsage.push(result.usage);
              if (!result.assistantCompleted || !result.outputText)
                throw new Error('Project Assistant preparation ended without a result.');
              return result.outputText;
            },
          },
          {
            entity,
            runId: this.session.agentic_session_id,
            turnId: this.execution.attemptId,
            abortSignal: () => this.execution.tokenBudget?.signal ?? this.request.signal,
            loadedEntityContext: this.startupPromptInput.loadedEntityContext,
            recentUserReplies: [],
            triggerParentMessageId: null,
          },
        );
        this.payload = prepared.payload;
      }
    }
    this.prepared = handlerDeps !== undefined && entity !== undefined;
    if (handler.id === 'project_assistant') {
      const loaded = this.startupPromptInput?.loadedEntityContext.entity;
      this.researchTools = new EvalResearchTools({
        session: this.session,
        payload: this.payload as ProjectAssistantPromptPayload,
        tools: handler.submissionTools ?? [],
        launcher: this.launcher,
        execution: this.execution,
        signal: this.execution.tokenBudget?.signal ?? this.request.signal,
        ...(this.request.tokenBudget !== undefined
          ? { tokenBudget: this.request.tokenBudget }
          : {}),
        ...(loaded && 'type' in loaded && typeof loaded.type === 'string'
          ? { workItemType: loaded.type }
          : {}),
      });
    }
    if (handlerDeps && entity) this.preparationElapsedMs = Date.now() - startedAt;
  }

  public complete(result: SubAgentResult, handlerElapsedMs: number): SubAgentResult {
    result = {
      ...result,
      handlerElapsedMs,
      ...(this.preparationElapsedMs !== undefined
        ? {
            preparationMeasurements: [
              {
                scope: 'TARGET_PREPARATION' as const,
                elapsedMs: this.preparationElapsedMs,
                ...sumEvalUsage(this.preparationUsage),
              },
            ],
          }
        : {}),
    };
    const research = this.researchTools;
    if (research && result.assistantCompleted && !result.budgetExhausted) {
      if (!research.outputText)
        throw new Error('Project Assistant ended without submitting its research report.');
      return {
        ...result,
        outputText: research.outputText,
        usage: research.combineUsage(result.usage),
      };
    }
    return result;
  }
}

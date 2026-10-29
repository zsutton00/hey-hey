import type { RunMemo } from '../../session/types';
import {
  resolvePromptText,
  type InternalRunPromptRequest,
} from '../../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../../session/types';
import type { ChildAgentLauncher, ChildLaunchRequest } from '../../run/child-agent-launcher';
import type { SubAgentResult, SubAgentUsage } from '../../run/subagent';
import type { AgentStartupPromptInputResult, PromptTypeHandlerDeps } from '../prompt-type-handler';
import type { ProjectAssistantPromptPayload } from '../project-assistant/project-assistant.handler';
import { EvalResearchTools, sumEvalUsage } from './eval-research-tools';
import { EvalTokenBudget, type EvalExecutionContext } from './eval-execution-context';
import { resolveProjectAssistantBootstrap } from '../project-assistant/proactive-behavior';
import { EvalPreparationRecords } from './eval-preparation-records';

/** Attempt-specific preparation and tool ownership, outside shared launch orchestration. */
export class EvalChildExecution {
  public readonly session: AgenticSession;
  public readonly execution: EvalExecutionContext;
  public payload: ChildLaunchRequest['payload'];
  public startupPromptInput: AgentStartupPromptInputResult | undefined;
  public researchTools: EvalResearchTools | undefined;
  private readonly startedAt = Date.now();
  private preparationElapsedMs: number | undefined;
  public readonly memos: RunMemo[] = [];
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
    // Each attempt owns fresh context. Coordinator memos and guidance state
    // belong to another execution and must never enter the target's prompt.
    this.session = {
      ...session,
      inert: true,
      memos: this.memos,
      sessionContext: {},
      contextMetadata: {
        ...session.contextMetadata,
        agentSessionId: request.evalExecution.targetSessionId,
      },
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
    const { handlerDeps, entity, handler } = this.request;
    if (handlerDeps && entity) {
      const bootstrap = resolveProjectAssistantBootstrap(
        handler,
        this.session,
        entity,
        resolvePromptText({
          promptType: handler.promptType,
          payload: this.payload,
        } as InternalRunPromptRequest) ?? '',
        handlerDeps.logger,
      );
      if (bootstrap) {
        const research = await this.launcher.launchRegistered('project_assistant', {
          parentSession: this.session,
          payload: bootstrap.payload,
          entity,
          handlerDeps,
          evalExecution: this.execution,
          signal: this.execution.tokenBudget?.signal ?? this.request.signal,
          ...(this.request.tokenBudget !== undefined
            ? { tokenBudget: this.request.tokenBudget }
            : {}),
        });
        this.recordPreparation(research);
        if (!research.assistantCompleted || !research.outputText) {
          throw new Error(
            'Project Assistant preparation ended without a completed research report.',
          );
        }
        if (research.projectAssistantMemo) {
          this.memos.push(research.projectAssistantMemo);
        }
      }
    }
  }

  /** The shared resolver owns handler preparation; only its records are attempt-local. */
  public preparationDeps(deps: PromptTypeHandlerDeps): PromptTypeHandlerDeps {
    return { ...deps, preparationRecords: this.preparationRecords };
  }

  public recordPreparation(result: SubAgentResult): void {
    this.preparationUsage.push(
      result.usage,
      ...(result.preparationMeasurements ?? []).map(({ inputTokens, outputTokens, toolCalls }) => ({
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(toolCalls !== undefined ? { toolCalls } : {}),
      })),
    );
  }

  public resolved(payload: unknown, startup: AgentStartupPromptInputResult | undefined): void {
    if (this.request.handlerDeps && this.request.entity) {
      this.preparationElapsedMs = Date.now() - this.startedAt;
    }
    this.payload = payload;
    this.startupPromptInput = startup;
    const { handler } = this.request;
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
      if (!research.outputText) {
        throw new Error('Project Assistant ended without submitting its research report.');
      }
      const memo = research.memo;
      return {
        ...result,
        outputText: research.outputText,
        ...(memo ? { projectAssistantMemo: memo } : {}),
        usage: research.combineUsage(result.usage),
      };
    }
    return result;
  }
}

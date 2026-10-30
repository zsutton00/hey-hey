import type { ServerLogger } from '../../server/logger';
import type { LocalCreateRunRequest } from '../../shared/agent-bridge-contract/contract';
import {
  EvalAssessedOutput,
  EvalTargetHandlerKey,
  type EvalRecordedAttempt,
} from '../../shared/api/generated/api';
import type { AgenticSession } from '../../session/types';
import type { LocalAgentService } from '../../server/local-agent-service';
import type { RunStore } from '../../run-store/run-store';
import type { EvalTargetResult } from './eval-runner';
import { assessedOutputText } from './eval-assessed-output';
import { buildEvalFirstTurn } from './eval-handler-launch';
import { resolveEvalTargetEntity } from './eval-targets';
import { z } from 'zod';
import { LocalReasoningEffort } from '../../shared/agent-bridge-contract/contract';

const providerSchema = z.enum(['claude', 'codex', 'opencode']);
const effortSchema = z.nativeEnum(LocalReasoningEffort);

/** Owns attempt Runs, including stopping while creation has not yet activated a Run. */
export class EvalAttemptExecution {
  private readonly preparation = new Map<string, { elapsedMs: number; observations: number }>();

  public recordPreparation(runId: string, elapsedMs: number): void {
    const measurement = this.preparation.get(runId);
    if (measurement) {
      measurement.elapsedMs += elapsedMs;
      measurement.observations += 1;
    }
  }

  private service?: LocalAgentService;
  private store?: RunStore;

  public constructor(private readonly logger: ServerLogger) {}

  public bind(service: LocalAgentService, store: RunStore): void {
    this.service = service;
    this.store = store;
  }

  public async execute(
    coordinator: AgenticSession,
    attempt: EvalRecordedAttempt,
    options: { signal: AbortSignal; tokenBudget?: number; onTokenLimit?: () => void },
  ): Promise<EvalTargetResult> {
    const service = this.service;
    const store = this.store;
    if (!service || !store) {
      throw new Error('Eval attempt execution has not been bound to the Run runtime.');
    }
    const { target } = attempt.caseInput;
    const { execution } = attempt;
    const setting = attempt.configuration.target;
    const entity = resolveEvalTargetEntity(target) ?? {
      entityType: 'PROJECT' as const,
      entityId: coordinator.contextMetadata.projectId,
    };
    const firstTurn = buildEvalFirstTurn(execution, target.initiatingRequest, entity);
    // Research alone starts through the consumer's Project Assistant bootstrap,
    // which only exists while Project Assistant is enabled.
    const projectAssistantRuns =
      execution.projectAssistantPrepares ||
      execution.handler === EvalTargetHandlerKey.ProjectAssistant;
    const request: LocalCreateRunRequest = {
      context: {
        projectId: coordinator.contextMetadata.projectId,
        provider: providerSchema.parse(setting.provider),
      },
      contextMetadata: {
        capturedAt: new Date().toISOString(),
        organizationId: coordinator.contextMetadata.organizationId,
        projectId: coordinator.contextMetadata.projectId,
        agentSessionId: attempt.targetSessionId,
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
      conversationId: attempt.targetConversationId,
      attachments: [],
      stagedBrowserTab: null,
      model: setting.model,
      ...(setting.reasoningEffort !== undefined
        ? { reasoningEffort: effortSchema.parse(setting.reasoningEffort) }
        : {}),
      inert: true,
      signal: options.signal,
      config: {
        type: 'ENTITY_CONVERSATION',
        version: 'v1',
        model: setting.model,
        // Evals never change the project: whenever Project Assistant prepares
        // the handler it runs with every extra off, which is entity
        // conversation's own real policy.
        projectAssistant: {
          enabled: projectAssistantRuns,
          allowEdgeUpdates: false,
          notifyDiscrepancies: false,
          allowUpdateProposals: false,
        },
      },
      payload: firstTurn.payload,
      ...(firstTurn.projectAssistantConsumerHandlerId
        ? { projectAssistantConsumerHandlerId: firstTurn.projectAssistantConsumerHandlerId }
        : {}),
    };
    this.logger.info('run_eval.attempt.run_started', {
      runId: attempt.targetSessionId,
      handlerId: execution.handler,
      projectAssistantPrepares: execution.projectAssistantPrepares,
    });
    const startedAt = Date.now();
    const preparation = { elapsedMs: 0, observations: 0 };
    this.preparation.set(attempt.targetSessionId, preparation);
    let budgetExhausted = false;
    const isStopped = (): boolean => options.signal.aborted || budgetExhausted;
    let monitoring = Promise.resolve();
    const check = async (): Promise<void> => {
      const run = await store.getRunMetadata(attempt.targetSessionId);
      const usage = run?.tokenUsage;
      if (
        !budgetExhausted &&
        options.tokenBudget !== undefined &&
        usage &&
        usage.inputTokens + usage.outputTokens > options.tokenBudget
      ) {
        budgetExhausted = true;
        this.logger.info('run_eval.attempt.token_limit', {
          runId: attempt.targetSessionId,
          tokenBudget: options.tokenBudget,
        });
        options.onTokenLimit?.();
      }
      if (options.signal.aborted || budgetExhausted) {
        await service.stopRun(attempt.targetSessionId);
      }
    };
    // Serialize checks so a slow metadata read or stop never creates overlapping work.
    const scheduleCheck = (): void => {
      monitoring = monitoring.then(check).catch((error: unknown) => {
        this.logger.warn('run_eval.attempt.monitor_failed', {
          runId: attempt.targetSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    };
    const onAbort = (): void => scheduleCheck();
    options.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setInterval(scheduleCheck, 100);
    try {
      if (!options.signal.aborted) {
        try {
          const created = await service.createRun(request);
          if (created.status !== 'started') {
            throw new Error('Evaluation requires an available Run workspace.');
          }
        } catch (error) {
          if (!isStopped()) {
            throw error;
          }
        }
      }
      await monitoring;
      await check();
      const result = await store.getRunResult(attempt.targetSessionId);
      const stopped = isStopped();
      const metadata = await store.getRunMetadata(attempt.targetSessionId);
      if (
        !stopped &&
        metadata?.latestTurn?.state === 'settled' &&
        metadata.latestTurn.outcome === 'FAILED'
      ) {
        throw new Error(
          `${execution.handler} failed before producing an answer; the attempt's conversation records the reason.`,
        );
      }
      const assessedText = assessedOutputText(execution, result?.outputText, metadata?.memos);
      const completed = !stopped && (result?.assistantCompleted ?? false);
      if (
        completed &&
        execution.assessedOutput === EvalAssessedOutput.ResearchReport &&
        assessedText === undefined
      ) {
        throw new Error('Project Assistant research ended without saving a research report.');
      }
      const gathering = metadata?.gatherTraces?.flatMap((trace) =>
        trace.steps.flatMap((step) => ('usage' in step ? [step.usage] : [])),
      );
      const preparationUsage = gathering?.length
        ? gathering.reduce(
            (total, usage) => ({
              inputTokens: total.inputTokens + usage.inputTokens,
              outputTokens: total.outputTokens + usage.outputTokens,
            }),
            { inputTokens: 0, outputTokens: 0 },
          )
        : undefined;
      return {
        assistantCompleted: completed,
        ...(completed && assessedText !== undefined ? { outputText: assessedText } : {}),
        usage: result?.usage ?? {},
        ...(preparation.observations > 0
          ? {
              preparationMeasurements: [
                {
                  scope: 'TARGET_PREPARATION' as const,
                  elapsedMs: preparation.elapsedMs,
                  ...preparationUsage,
                },
              ],
              handlerElapsedMs: Math.max(0, Date.now() - startedAt - preparation.elapsedMs),
            }
          : {}),
        budgetExhausted,
      };
    } finally {
      this.logger.info('run_eval.attempt.run_settled', {
        runId: attempt.targetSessionId,
        stopped: options.signal.aborted || budgetExhausted,
      });
      this.preparation.delete(attempt.targetSessionId);
      clearInterval(timer);
      options.signal.removeEventListener('abort', onAbort);
      await monitoring;
    }
  }
}

import type { ServerLogger } from '../../server/logger';
import type { EvalSearchScope } from '../../shared/agent-bridge-contract/runtime-types';
import type { LocalCreateRunRequest } from '../../shared/agent-bridge-contract/contract';
import {
  EvalAssessedOutput,
  EvalTargetHandlerKey,
  type EvalRecordedAttempt,
  type EvalMeasurement,
  type EvalCost,
  type EvalRecordedChanges,
  type EvalRecordedToolCalls,
} from '@hey-hey/contracts/api/models';
import { SessionCostReader } from '../../provider-usage/session-cost';
import type { AgenticSession } from '../../session/types';
import type { LocalAgentService } from '../../server/local-agent-service';
import type { RunStore } from '../../run-store/run-store';
import { EvalWorkspaces, type EvalWorkspace } from './eval-workspace';
import { EvalTargetFailure, type EvalTargetResult } from './eval-runner';
import { recordToolCalls, UNAVAILABLE_TOOL_CALLS } from './eval-recorded-tool-calls';
import { assessedOutputText, codeChangesOutputText } from './eval-assessed-output';
import { captureChangesSinceCommit } from '../../git/diff';
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

  private readonly researchUsage = new Map<string, EvalMeasurement>();

  public async recordResearchUsage(runId: string): Promise<void> {
    if (!this.preparation.has(runId) || !this.store) {
      return;
    }
    try {
      const result = await this.store.getRunResult(runId);
      const cost = await this.readSettledCost(runId);
      this.researchUsage.set(runId, {
        scope: 'TARGET_PREPARATION',
        ...result?.usage,
        cost,
      });
    } catch (error) {
      this.logger.warn('run_eval.attempt.research_usage_read_failed', { runId, error });
      this.researchUsage.set(runId, { scope: 'TARGET_PREPARATION' });
    }
  }

  /** Cost of the provider session the Run's latest settled Turn used; never throws. */
  private async readSettledCost(runId: string): Promise<EvalCost> {
    const metadata = await this.store?.getRunMetadata(runId);
    const latest = metadata?.latestTurn;
    if (latest?.state !== 'settled' || !latest.providerSession) {
      return { state: 'unavailable' };
    }

    return this.costReader.read(latest.providerSession.provider, latest.providerSession.sessionId);
  }

  /** The calls the Run retained so far; unavailable when they cannot be read. Never throws. */
  private async readToolCalls(runId: string): Promise<EvalRecordedToolCalls> {
    try {
      const result = await this.store?.getRunResult(runId);

      return recordToolCalls(result?.toolCalls);
    } catch (error) {
      this.logger.warn('run_eval.attempt.tool_calls_read_failed', { runId, error });

      return UNAVAILABLE_TOOL_CALLS;
    }
  }

  private service?: LocalAgentService;
  private store?: RunStore;

  private readonly costReader: SessionCostReader;

  public constructor(
    private readonly logger: ServerLogger,
    costReader?: SessionCostReader,
    private readonly workspaces?: EvalWorkspaces,
  ) {
    this.costReader = costReader ?? new SessionCostReader(logger);
  }

  /** Removes workspaces an interrupted run left behind. Called when evaluations start. */
  public async sweepWorkspaces(): Promise<void> {
    await this.workspaces?.sweep();
  }

  public bind(service: LocalAgentService, store: RunStore): void {
    this.service = service;
    this.store = store;
  }

  public async execute(
    coordinator: AgenticSession,
    attempt: EvalRecordedAttempt,
    options: {
      signal: AbortSignal;
      /** What the attempt's `unified_search` may not reveal about its own case. */
      searchScope: EvalSearchScope;
      tokenBudget?: number;
      onTokenLimit?: () => void;
      onProviderSessionIds?: (ids: string[]) => Promise<void>;
      /** Stores the attempt's saved changes before its workspace is removed. */
      onWorkspaceSettled?: (settled: { recordedChanges: EvalRecordedChanges }) => Promise<void>;
    },
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
    const baseRequest: LocalCreateRunRequest = {
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
      searchScope: options.searchScope,
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
    const coding = attempt.caseInput.coding;
    let workspace: EvalWorkspace | undefined;
    this.logger.info('run_eval.attempt.run_started', {
      runId: attempt.targetSessionId,
      attemptId: attempt.attemptId,
      repeat: attempt.repeat ?? null,
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
        usage.inputTokens !== null &&
        usage.outputTokens !== null &&
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
    // Runs once, after the Run settles and before the workspace goes: saves the
    // changes and records them. The first failure is the attempt's error,
    // whichever path asks first.
    let settlement: Promise<{ recordedChanges: EvalRecordedChanges } | undefined> | undefined;
    const settleWorkspace = (): NonNullable<typeof settlement> => {
      settlement ??= (async () => {
        if (!workspace || !coding) {
          return undefined;
        }
        const files = await captureChangesSinceCommit({
          repoPath: workspace.directory,
          commit: coding.pinnedCommit.sha,
        });
        const settled = { recordedChanges: { files } };
        await options.onWorkspaceSettled?.(settled);

        return settled;
      })();

      return settlement;
    };
    const onAbort = (): void => scheduleCheck();
    options.signal.addEventListener('abort', onAbort, { once: true });
    const timer = setInterval(scheduleCheck, 100);
    try {
      if (execution.handler === EvalTargetHandlerKey.FreeForm && coding) {
        if (!this.workspaces) {
          throw new Error('Coding evaluations require workspace support, which is unavailable.');
        }
        workspace = await this.workspaces.acquire(
          {
            attemptId: attempt.attemptId,
            serviceId: coding.serviceId,
            commitSha: coding.pinnedCommit.sha,
          },
          options.signal,
        );
      }
      const request: LocalCreateRunRequest =
        workspace && coding
          ? {
              ...baseRequest,
              workspaceBinding: { serviceId: coding.serviceId, directory: workspace.directory },
            }
          : baseRequest;
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
      const metadata = await store.getRunMetadata(attempt.targetSessionId);
      const result = await store.getRunResult(attempt.targetSessionId).catch((error: unknown) => {
        this.logger.warn('run_eval.attempt.usage_read_failed', {
          runId: attempt.targetSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        throw new Error(
          'The finished Run result could not be read; token measurements are unavailable for this attempt.',
          { cause: error },
        );
      });
      const recordedToolCalls = recordToolCalls(result?.toolCalls);
      this.logger.info('run_eval.attempt.usage_read', {
        runId: attempt.targetSessionId,
        provider: setting.provider,
        model: setting.model,
        providerSessionId:
          metadata?.latestTurn?.state === 'settled'
            ? metadata.latestTurn.providerSession?.sessionId
            : null,
        source: 'native_session_record',
        usage: result?.usage ?? null,
      });
      // Read after the Run settles, from the tested agent's provider session only.
      const testedCost = await this.readSettledCost(attempt.targetSessionId);
      // Only native agent-session measurements belong in agent token accounting.
      // Jev service request counters remain on their gather traces.
      const research = execution.projectAssistantPrepares
        ? this.researchUsage.get(attempt.targetSessionId)
        : undefined;
      const preparationUsage: Partial<EvalMeasurement> = {};
      for (const field of [
        'inputTokens',
        'outputTokens',
        'cacheReadInputTokens',
        'cacheCreationInputTokens',
      ] as const) {
        const value = research?.[field];
        if (value !== undefined) {
          preparationUsage[field] = value;
        }
      }
      const researchMeasurements: EvalMeasurement[] = execution.projectAssistantPrepares
        ? [
            {
              scope: 'TARGET_PREPARATION' as const,
              ...preparationUsage,
              ...(research?.cost ? { cost: research.cost } : {}),
            },
          ]
        : [];
      const stopped = isStopped();
      const settled = await settleWorkspace();
      if (
        !stopped &&
        metadata?.latestTurn?.state === 'settled' &&
        metadata.latestTurn.outcome === 'FAILED'
      ) {
        throw new EvalTargetFailure(
          `${execution.handler} failed before producing an answer; the attempt's conversation records the reason.`,
          { ...result?.usage, cost: testedCost, researchMeasurements, recordedToolCalls },
        );
      }
      const assessedText = settled
        ? codeChangesOutputText(settled.recordedChanges)
        : assessedOutputText(execution, result?.outputText, metadata?.memos);
      const completed = !stopped && (result?.assistantCompleted ?? false);
      if (
        completed &&
        execution.assessedOutput === EvalAssessedOutput.ResearchReport &&
        assessedText === undefined
      ) {
        throw new EvalTargetFailure(
          'Project Assistant research ended without saving a research report.',
          { ...result?.usage, cost: testedCost, researchMeasurements, recordedToolCalls },
        );
      }
      return {
        assistantCompleted: completed,
        ...(completed && assessedText !== undefined ? { outputText: assessedText } : {}),
        usage: result?.usage ?? {},
        recordedToolCalls,
        cost: testedCost,
        ...(researchMeasurements.length > 0 ? { researchMeasurements } : {}),
        handlerElapsedMs: Math.max(0, Date.now() - startedAt - preparation.elapsedMs),
        budgetExhausted,
      };
    } catch (error) {
      if (error instanceof EvalTargetFailure) {
        throw error;
      }
      // Whatever the Run made before the error stays on the attempt.
      const recordedToolCalls = await this.readToolCalls(attempt.targetSessionId);
      throw new EvalTargetFailure(
        error instanceof Error ? error.message : String(error),
        { recordedToolCalls },
        error,
      );
    } finally {
      this.logger.info('run_eval.attempt.run_settled', {
        runId: attempt.targetSessionId,
        stopped: options.signal.aborted || budgetExhausted,
      });
      this.preparation.delete(attempt.targetSessionId);
      this.researchUsage.delete(attempt.targetSessionId);
      clearInterval(timer);
      options.signal.removeEventListener('abort', onAbort);
      await monitoring;
      const metadata = await store.getRunMetadata(attempt.targetSessionId);
      try {
        await settleWorkspace();
      } catch (error) {
        // The main path surfaces this once; here it must not hide an earlier Run error
        // or skip recording the provider session ids.
        this.logger.warn('run_eval.attempt.settlement_failed', {
          runId: attempt.targetSessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await workspace?.release();
      }
      const ids = (metadata?.provider_session_history ?? [])
        .map((entry) => entry.providerSessionId)
        .filter((id) => !id.startsWith('pending_'));
      await options.onProviderSessionIds?.(ids);
    }
  }
}

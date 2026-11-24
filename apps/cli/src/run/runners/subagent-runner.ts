import { PartialCommitError } from '../../agents/commit/commit-git-error';
import { projectPendingCommit } from '../../agents/commit/commit-intent';
import path from 'node:path';
import type { SubagentConfig } from '../../agents/prompt-type-handler';
import type { ServerLogger } from '../../server/logger';
import { requestContext } from '../../server/request-context';
import type { ChildAgentLauncher } from '../child-agent-launcher';
import type { Runner } from '../../turn/turn';
import type { SubAgentResult } from '../subagent';
import { normalizeEvent } from '../normalize';
import type { Run } from '../run';
import type { RunnerContext } from './types';
import type { RunChangedFilesReader } from '../../server/run-changed-files';

export interface SubagentRunnerDeps {
  childAgentLauncher: ChildAgentLauncher;
  logger: ServerLogger;
  runChangedFilesReader: RunChangedFilesReader;
}

/**
 * Runs a Turn in an isolated sub-agent session. The shared
 * launcher resolves its prepared input once. Events stream back
 * through a Turn-scoped Run callback, so the normalizer + dispatcher pipeline
 * closes the in-flight processing message exactly as it would for a
 * provider-session turn without treating the ephemeral session as Run-owned.
 *
 * The handler's declarative `SubagentConfig` (allowlists, permission policy,
 * adapter id) is consumed by the runtime `SubAgent` owner.
 */
export class SubagentRunner implements Runner {
  constructor(
    private readonly ctx: RunnerContext,
    private readonly config: SubagentConfig,
    private readonly deps: SubagentRunnerDeps,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    const {
      run,
      handler,
      input,
      preparedPayload,
      cwd,
      workspace,
      priorReports,
      startupPromptInput,
      effectiveModel,
      effectiveReasoningEffort,
      turnRuntime,
    } = this.ctx;
    const isCommit = handler.promptType === 'commit';
    const provider = turnRuntime?.provider ?? run.provider;
    const onAgentOutput = (message: Parameters<Run['onAgentOutput']>[0]): void => {
      const turnId = this.ctx.turnId;
      if (!turnId) {
        throw new Error(`Subagent runner for "${handler.promptType}" requires a Turn id.`);
      }
      run.onActiveTurnAgentOutput(turnId, message);
    };

    // Prefer the handler-prepared payload over the raw wire payload so
    // enrichment work done in `handler.prepare` (e.g. the implement
    // handler's approved-plan fetch) reaches downstream prompt assembly.
    const basePayload = preparedPayload !== undefined ? preparedPayload : input.payload;
    if (isCommit) {
      await run.ensureSeeded();
      await projectPendingCommit(run.session);
    }
    const reportChainLengthBefore = run.readReportChain().length;
    const recoveringReport = isCommit && run.reportProvenance.pending !== undefined;
    const filesForSubagent = recoveringReport
      ? []
      : isCommit
        ? (
            await this.deps.runChangedFilesReader.getLiveRunChangedFiles(
              run.session,
              run.getFileChangeProjection(),
            )
          ).map((diff) => path.resolve(diff.repoPath, diff.filePath))
        : run.getRunLifetimeTouchedFiles();
    const payload =
      isCommit && basePayload !== null && typeof basePayload === 'object'
        ? { ...basePayload, changedFiles: [...filesForSubagent] }
        : basePayload;

    requestContext.log(this.deps.logger, 'debug', 'local.subagent_runner.forwarding', {
      runId: run.runId,
      promptType: handler.promptType,
      runnerKind: handler.runnerKind,
      provider: turnRuntime?.provider ?? run.session.provider,
      adapterId: this.config.adapterId,
      effectiveModel: effectiveModel ?? null,
      effectiveReasoningEffort: effectiveReasoningEffort ?? null,
      fileScope: isCommit ? 'live-session-owned' : 'run-lifetime',
      fileCount: filesForSubagent.length,
      modelIncluded: effectiveModel !== null,
      reasoningEffortIncluded: effectiveReasoningEffort !== null,
    });

    const result: SubAgentResult = recoveringReport
      ? { assistantCompleted: false, usage: {} }
      : await this.deps.childAgentLauncher.launch({
          parentSession: run.session,
          handler,
          payload,
          prepared: true,
          ...(this.ctx.handlerDeps ? { handlerDeps: this.ctx.handlerDeps } : {}),
          ...(this.ctx.childPromptContext ? { promptContext: this.ctx.childPromptContext } : {}),
          touchedFiles: filesForSubagent,
          onAgentOutput: (message) => {
            if (isCommit) {
              const event = normalizeEvent({ runId: run.runId, ...message.event }, provider);
              if (event.kind === 'assistant_complete' || event.kind === 'assistant_delta') {
                return;
              }
            }
            onAgentOutput(message);
          },
          signal,
          workspace: {
            cwd,
            ...(workspace ? { allowedRepositoryRoots: workspace.allowedRepositoryRoots } : {}),
          },
          priorReports,
          ...(startupPromptInput ? { startupPromptInput } : {}),
          ...(effectiveModel ? { model: effectiveModel } : {}),
          ...(effectiveReasoningEffort ? { reasoningEffort: effectiveReasoningEffort } : {}),
          ...(turnRuntime ? { provider: turnRuntime.provider } : {}),
          ...(turnRuntime?.fastMode !== undefined ? { fastMode: turnRuntime.fastMode } : {}),
        });

    if (result.contextReading && this.ctx.turnId) {
      run.compaction.recordSubagentContextReading(this.ctx.turnId, result.contextReading);
    }

    if (handler.onSubagentComplete) {
      let partialCommit: PartialCommitError | undefined;
      try {
        await handler.onSubagentComplete({
          run,
          payload,
          touchedFiles: filesForSubagent,
          result,
          logger: this.deps.logger,
          reportChainLengthBefore,
        });
      } catch (error) {
        if (!isCommit || !(error instanceof PartialCommitError)) {
          throw error;
        }
        partialCommit = error;
      }

      if (isCommit && !signal.aborted) {
        const report = run
          .readReportChain()
          .slice(reportChainLengthBefore)
          .find((entry) => entry.reportType === 'COMMIT');
        if (!report) {
          throw new Error('Commit processing finished without a COMMIT report.');
        }
        onAgentOutput({
          event: {
            source: 'local',
            eventType: 'agent_output',
            timestamp: new Date().toISOString(),
            sessionId: result.providerSessionId ?? run.runId,
            agentId: null,
            payload: {
              messageType: 'assistant',
              taskComplete: true,
              summary: `${partialCommit?.message ?? 'Committed session changes.'}\n\n${report.summary}`,
            },
          },
        });
      }
    }
  }
}

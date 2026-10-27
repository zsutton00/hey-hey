import {
  LocalPromptType,
  type LocalRunEvalPromptPayload,
} from '../../shared/agent-bridge-contract/generated';
import { LocalReasoningEffort } from '../../shared/agent-bridge-contract/contract';
import type { EvalModelSetting, EvalRecordedAttempt } from '../../shared/api/generated/api';
import type { RegisteredChildLaunchRequest } from '../../run/child-agent-launcher';
import {
  defaultAddUserMessage,
  type ProceduralRunContext,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { EVAL_JUDGE_HANDLER_ID, parseEvalJudgeOutput } from './eval-judge.handler';
import type { EvalExecutionContext } from './eval-execution-context';
import { EvalReportRecorder } from './eval-report-recorder';
import { runEvalAttempts, type EvalRunnerPorts, type EvalRunTally } from './eval-runner';
import { EvalTargetMessages } from './eval-target-messages';
import {
  buildEvalTargetMessage,
  buildEvalTargetPayload,
  resolveEvalTargetHandlerId,
} from './eval-targets';

const EVAL_WORK_ITEM_TYPE_KEY = 'EVAL' as const;

const REASONING_EFFORTS: ReadonlySet<string> = new Set(Object.values(LocalReasoningEffort));

/** The child launch settings a recorded model setting selects. */
const toLaunchSettings = (
  setting: EvalModelSetting,
): Pick<RegisteredChildLaunchRequest, 'provider' | 'model' | 'reasoningEffort'> => {
  const { reasoningEffort } = setting;
  if (reasoningEffort !== undefined && !REASONING_EFFORTS.has(reasoningEffort)) {
    throw new Error(`Recorded reasoning effort "${reasoningEffort}" is not supported.`);
  }
  return {
    provider: setting.provider,
    model: setting.model,
    ...(reasoningEffort !== undefined
      ? { reasoningEffort: reasoningEffort as LocalReasoningEffort }
      : {}),
  };
};

const describeFailure = (error: unknown): string =>
  error instanceof Error ? (error.stack ?? error.message) : String(error);

/** Every child of an attempt reaches the platform as that attempt's target session. */
const toEvalExecution = (attempt: EvalRecordedAttempt): EvalExecutionContext => ({
  attemptId: attempt.attemptId,
  targetSessionId: attempt.targetSessionId,
  targetConversationId: attempt.targetConversationId,
});

const describeTally = (tally: EvalRunTally, stopped: boolean): string => {
  const parts = [
    `${tally.completed} completed`,
    `${tally.errored} with errors`,
    `${tally.stopped} stopped`,
  ];
  return `${stopped ? 'Eval run stopped' : 'Eval run finished'}: ${parts.join(', ')}.`;
};

const runRecordedAttempts = async (
  payload: LocalRunEvalPromptPayload,
  { session, deps }: ProceduralRunContext,
  signal: AbortSignal,
): Promise<string> => {
  const recorder = EvalReportRecorder.create({
    accessToken: await deps.auth.getAccessToken(),
    apiBaseUrl: deps.apiBaseUrl,
    organizationId: session.contextMetadata.organizationId,
    evalRunId: payload.evalRunId,
  });
  const launcher = deps.childAgentLauncher;
  const ports: EvalRunnerPorts = {
    recorder,
    now: () => new Date(),
    async launchTarget(attempt, { signal: attemptSignal, tokenBudget }) {
      const target = attempt.caseInput.target;
      const handlerId = resolveEvalTargetHandlerId(target.targetHandler);
      const targetPayload = buildEvalTargetPayload(target);
      const messages = await EvalTargetMessages.create(
        session,
        toEvalExecution(attempt),
        handlerId,
        deps,
      );
      await messages.savePrompt(buildEvalTargetMessage(target));
      deps.logger.info('run_eval.attempt.target_started', {
        runId: session.agentic_session_id,
        attemptId: attempt.attemptId,
        handlerId,
        provider: attempt.configuration.target.provider,
        model: attempt.configuration.target.model,
      });
      try {
        return await launcher.launchRegistered(handlerId, {
          parentSession: session,
          payload: targetPayload,
          onAgentOutput: messages.onAgentOutput,
          signal: attemptSignal,
          ...toLaunchSettings(attempt.configuration.target),
          ...(tokenBudget !== undefined ? { tokenBudget } : {}),
          evalExecution: toEvalExecution(attempt),
          handlerDeps: deps,
          ...(target.focalItemId
            ? { entity: { entityType: 'TASK' as const, entityId: target.focalItemId } }
            : {}),
        });
      } catch (error) {
        deps.logger.error('run_eval.attempt.target_failed', {
          runId: session.agentic_session_id,
          attemptId: attempt.attemptId,
          handlerId,
          error: describeFailure(error),
        });
        throw error;
      } finally {
        await messages.drain();
      }
    },
    async judge(attempt, outputText, judgeSignal) {
      const startedAt = Date.now();
      const result = await launcher
        .launchRegistered(EVAL_JUDGE_HANDLER_ID, {
          parentSession: session,
          payload: { caseInput: attempt.caseInput, outputText },
          signal: judgeSignal,
          ...toLaunchSettings(payload.judgeSetup),
          evalExecution: toEvalExecution(attempt),
        })
        .catch((error: unknown) => {
          deps.logger.error('run_eval.attempt.judge_failed', {
            runId: session.agentic_session_id,
            attemptId: attempt.attemptId,
            error: describeFailure(error),
          });
          throw error;
        });
      const elapsedMs = Date.now() - startedAt;
      if (!result.assistantCompleted || !result.outputText) {
        throw new Error('The judge ended without an assessment.');
      }
      return {
        assessment: parseEvalJudgeOutput(
          result.outputText,
          attempt.caseInput,
          new Date().toISOString(),
        ),
        usage: result.usage,
        elapsedMs,
      };
    },
  };
  deps.logger.info('run_eval.started', {
    runId: session.agentic_session_id,
    evalRunId: payload.evalRunId,
    attemptCount: payload.attempts.length,
    maxConcurrentAttempts: payload.settings.maxConcurrentAttempts,
    attemptTimeLimitSeconds: payload.settings.attemptTimeLimitSeconds ?? null,
    attemptTokenLimit: payload.settings.attemptTokenLimit ?? null,
  });
  const tally = await runEvalAttempts(
    { attempts: payload.attempts, settings: payload.settings, signal },
    ports,
  );
  deps.logger.info('run_eval.ended', {
    runId: session.agentic_session_id,
    evalRunId: payload.evalRunId,
    runStopped: signal.aborted,
    ...tally,
  });
  return describeTally(tally, signal.aborted);
};

/**
 * Runs a launched eval as a fixed procedure: every recorded attempt as a fresh
 * child of its real target handler, then a separate judge. No coordinating
 * agent exists; only the targets and the judge are agents.
 */
export const runEvalHandler: UserLaunchablePromptTypeHandler<LocalRunEvalPromptPayload> = {
  id: 'run_eval',
  promptType: LocalPromptType.RunEval,
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  eligibleWorkItemTypeKeys: [EVAL_WORK_ITEM_TYPE_KEY],
  runnerKind: 'procedural',
  providerSessionCountsForContext: false,
  reports: [],

  runProcedure: runRecordedAttempts,

  async onStartupFailure(payload, { session, deps }, message) {
    const recorder = EvalReportRecorder.create({
      accessToken: await deps.auth.getAccessToken(),
      apiBaseUrl: deps.apiBaseUrl,
      organizationId: session.contextMetadata.organizationId,
      evalRunId: payload.evalRunId,
    });
    const results = await Promise.allSettled(
      payload.attempts.map((attempt) =>
        recorder.updateAttempt(attempt.attemptId, {
          status: 'ERROR',
          completedAt: new Date().toISOString(),
          error: { code: 'EVAL_STARTUP_FAILED', message },
        }),
      ),
    );
    const failed = results.find((result) => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    await recorder.setRunStatus('FINISHED');
    deps.logger.error('run_eval.startup_failed', {
      evalRunId: payload.evalRunId,
      attemptCount: payload.attempts.length,
      message,
    });
  },

  // The procedure owns the Turn; no provider reads a prompt.
  buildPrompt(): string {
    return '';
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(): string | null {
    return 'Starting Eval...';
  },
};

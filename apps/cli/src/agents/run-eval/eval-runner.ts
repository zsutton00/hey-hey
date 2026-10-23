import type {
  EvalAttemptReportPayload,
  EvalAutomatedAssessment,
  EvalMeasurement,
  EvalRecordedAttempt,
  EvalRunSettings,
} from '../../shared/api/generated/api';
import type { SubAgentUsage } from '../../run/subagent';

/** What one target child produced. */
export interface EvalTargetResult {
  assistantCompleted: boolean;
  outputText?: string;
  budgetExhausted?: boolean;
  usage: SubAgentUsage;
}

export interface EvalJudgeResult {
  assessment: EvalAutomatedAssessment;
  usage: SubAgentUsage;
  elapsedMs: number;
}

/** Fields of an EVAL_ATTEMPT payload the runner owns. */
export type EvalAttemptPatch = Partial<
  Pick<
    EvalAttemptReportPayload,
    | 'status'
    | 'stopReason'
    | 'error'
    | 'startedAt'
    | 'completedAt'
    | 'measurements'
    | 'automatedAssessment'
    | 'summary'
  >
>;

export interface EvalRunRecorder {
  setRunStatus(status: 'RUNNING' | 'FINISHED' | 'STOPPED'): Promise<void>;
  updateAttempt(attemptId: string, patch: EvalAttemptPatch): Promise<void>;
}

export interface EvalRunnerPorts {
  recorder: EvalRunRecorder;
  /** Starts the attempt's target as a fresh child. Rejects when the child fails. */
  launchTarget(
    attempt: EvalRecordedAttempt,
    options: { signal: AbortSignal; tokenBudget?: number },
  ): Promise<EvalTargetResult>;
  /** Judges a finished attempt's output against its recorded checks and rubric. */
  judge(
    attempt: EvalRecordedAttempt,
    outputText: string,
    signal: AbortSignal,
  ): Promise<EvalJudgeResult>;
  now(): Date;
}

export interface EvalRunTally {
  completed: number;
  errored: number;
  stopped: number;
}

type StopReason = 'USER' | 'TIME_LIMIT' | 'TOKEN_LIMIT';

const toMeasurement = (
  scope: EvalMeasurement['scope'],
  elapsedMs: number,
  usage: SubAgentUsage,
): EvalMeasurement => ({
  scope,
  elapsedMs,
  ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
  ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
  ...(usage.toolCalls !== undefined ? { toolCalls: usage.toolCalls } : {}),
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs exactly the recorded attempts, in recorded order, never more than
 * `settings.maxConcurrentAttempts` at once. Limits apply only when recorded;
 * aborting `signal` stops running attempts and records unstarted ones as
 * stopped by the user. Nothing is retried.
 */
export const runEvalAttempts = async (
  input: {
    attempts: readonly EvalRecordedAttempt[];
    settings: EvalRunSettings;
    signal: AbortSignal;
  },
  ports: EvalRunnerPorts,
): Promise<EvalRunTally> => {
  const { attempts, settings, signal } = input;
  const tally: EvalRunTally = { completed: 0, errored: 0, stopped: 0 };
  await ports.recorder.setRunStatus('RUNNING');

  let cursor = 0;
  const runOne = async (attempt: EvalRecordedAttempt): Promise<void> => {
    const controller = new AbortController();
    // Held in an object: timers and the run signal set it from callbacks.
    const stopped: { reason: StopReason | null } = { reason: null };
    const stop = (reason: StopReason): void => {
      if (stopped.reason !== null) return;
      stopped.reason = reason;
      controller.abort(new Error(`Eval attempt stopped: ${reason}`));
    };
    const onRunAbort = (): void => stop('USER');
    signal.addEventListener('abort', onRunAbort, { once: true });
    const timer =
      settings.attemptTimeLimitSeconds !== undefined
        ? setTimeout(() => stop('TIME_LIMIT'), settings.attemptTimeLimitSeconds * 1000)
        : null;
    const startedAt = ports.now();
    const measurements: EvalMeasurement[] = [];
    const finish = async (patch: EvalAttemptPatch): Promise<void> => {
      await ports.recorder.updateAttempt(attempt.attemptId, {
        ...patch,
        measurements,
        completedAt: ports.now().toISOString(),
      });
    };

    try {
      await ports.recorder.updateAttempt(attempt.attemptId, {
        status: 'RUNNING',
        startedAt: startedAt.toISOString(),
      });
      let target: EvalTargetResult;
      try {
        target = await ports.launchTarget(attempt, {
          signal: controller.signal,
          ...(settings.attemptTokenLimit !== undefined
            ? { tokenBudget: settings.attemptTokenLimit }
            : {}),
        });
      } catch (error) {
        const elapsedMs = ports.now().getTime() - startedAt.getTime();
        measurements.push({ scope: 'TARGET_HANDLER', elapsedMs });
        if (stopped.reason !== null) {
          tally.stopped += 1;
          await finish({ status: 'STOPPED', stopReason: stopped.reason });
        } else {
          tally.errored += 1;
          await finish({ status: 'ERROR', error: { message: errorMessage(error) } });
        }
        return;
      }
      measurements.push(
        toMeasurement('TARGET_HANDLER', ports.now().getTime() - startedAt.getTime(), target.usage),
      );
      if (target.budgetExhausted) stopped.reason ??= 'TOKEN_LIMIT';
      const summary = target.outputText ? { outputText: target.outputText } : undefined;
      if (stopped.reason !== null) {
        tally.stopped += 1;
        await finish({
          status: 'STOPPED',
          stopReason: stopped.reason,
          ...(summary ? { summary } : {}),
        });
        return;
      }
      if (!target.assistantCompleted || !target.outputText) {
        tally.errored += 1;
        await finish({
          status: 'ERROR',
          error: { message: 'The target ended without a completed answer.' },
          ...(summary ? { summary } : {}),
        });
        return;
      }

      await ports.recorder.updateAttempt(attempt.attemptId, {
        status: 'JUDGING',
        measurements,
        summary,
      });
      try {
        const judged = await ports.judge(attempt, target.outputText, controller.signal);
        measurements.push(toMeasurement('JUDGE', judged.elapsedMs, judged.usage));
        tally.completed += 1;
        await finish({ status: 'COMPLETED', automatedAssessment: judged.assessment, summary });
      } catch (error) {
        if (stopped.reason !== null) {
          tally.stopped += 1;
          await finish({ status: 'STOPPED', stopReason: stopped.reason, summary });
        } else {
          tally.errored += 1;
          await finish({
            status: 'ERROR',
            error: { code: 'JUDGE_FAILED', message: errorMessage(error) },
            summary,
          });
        }
      }
    } catch (error) {
      // A failed record write belongs to this attempt only; the others carry on.
      tally.errored += 1;
      await ports.recorder
        .updateAttempt(attempt.attemptId, {
          status: 'ERROR',
          error: { code: 'RECORD_FAILED', message: errorMessage(error) },
        })
        .catch(() => undefined);
    } finally {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onRunAbort);
    }
  };

  const worker = async (): Promise<void> => {
    while (!signal.aborted && cursor < attempts.length) {
      const attempt = attempts[cursor];
      cursor += 1;
      if (attempt) await runOne(attempt);
    }
  };
  const workerCount = Math.min(settings.maxConcurrentAttempts, attempts.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  for (const attempt of attempts.slice(cursor)) {
    tally.stopped += 1;
    await ports.recorder.updateAttempt(attempt.attemptId, {
      status: 'STOPPED',
      stopReason: 'USER',
      completedAt: ports.now().toISOString(),
    });
  }
  await ports.recorder.setRunStatus(signal.aborted ? 'STOPPED' : 'FINISHED');
  return tally;
};

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EvalRecordedAttempt } from '../../shared/api/generated/api';
import {
  runEvalAttempts,
  type EvalAttemptPatch,
  type EvalRunnerPorts,
  type EvalTargetResult,
} from './eval-runner';

const makeAttempt = (id: string): EvalRecordedAttempt => ({
  attemptId: id,
  targetSessionId: `session-${id}`,
  targetConversationId: `conversation-${id}`,
  configuration: { id: 'cfg', target: { provider: 'claude', model: 'sonnet' } },
  caseInput: {
    id: `case-${id}`,
    evalCaseId: 'eval-case',
    title: id,
    target: { situation: 's', initiatingRequest: 'r', targetHandler: 'agent_search' },
    grading: { checks: [], rubric: [] },
  },
});

const assessment = {
  checkResults: [],
  recognition: { recognized: true, explanation: 'yes' },
  quality: [],
  createdAt: '2026-10-20T00:00:00.000Z',
};

const completed: EvalTargetResult = {
  assistantCompleted: true,
  outputText: 'answer',
  usage: {},
};

const makePorts = (
  launchTarget: EvalRunnerPorts['launchTarget'],
): { ports: EvalRunnerPorts; attempts: Map<string, EvalAttemptPatch[]>; runStatuses: string[] } => {
  const attempts = new Map<string, EvalAttemptPatch[]>();
  const runStatuses: string[] = [];
  return {
    attempts,
    runStatuses,
    ports: {
      now: () => new Date(),
      launchTarget,
      judge: async () => ({ assessment, usage: {}, elapsedMs: 1 }),
      recorder: {
        setRunStatus: async (status) => {
          runStatuses.push(status);
        },
        updateAttempt: async (attemptId, patch) => {
          attempts.set(attemptId, [...(attempts.get(attemptId) ?? []), patch]);
        },
      },
    },
  };
};

const finalPatch = (attempts: Map<string, EvalAttemptPatch[]>, id: string): EvalAttemptPatch =>
  attempts.get(id)!.at(-1)!;

afterEach(() => {
  vi.useRealTimers();
});

describe('runEvalAttempts', () => {
  it('runs exactly the recorded attempts in order, never more than the recorded number at once', async () => {
    let inFlight = 0;
    let peak = 0;
    const started: string[] = [];
    const { ports, attempts, runStatuses } = makePorts(async (attempt) => {
      started.push(attempt.attemptId);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return completed;
    });
    const recorded = ['a', 'b', 'c', 'd', 'e'].map(makeAttempt);

    const tally = await runEvalAttempts(
      {
        attempts: recorded,
        settings: { maxConcurrentAttempts: 2 },
        signal: new AbortController().signal,
      },
      ports,
    );

    expect(started).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(peak).toBe(2);
    expect(tally).toEqual({ completed: 5, errored: 0, stopped: 0 });
    expect(runStatuses).toEqual(['RUNNING', 'FINISHED']);
    expect(finalPatch(attempts, 'a')).toMatchObject({ status: 'COMPLETED' });
  });

  it('passes no token budget and sets no timer when the run recorded no limits', async () => {
    const launchTarget = vi.fn<EvalRunnerPorts['launchTarget']>(async () => completed);
    const { ports } = makePorts(launchTarget);
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    await runEvalAttempts(
      {
        attempts: [makeAttempt('a')],
        settings: { maxConcurrentAttempts: 3 },
        signal: new AbortController().signal,
      },
      ports,
    );

    expect(launchTarget.mock.calls[0]![1]).not.toHaveProperty('tokenBudget');
    expect(timeoutSpy).not.toHaveBeenCalled();
    timeoutSpy.mockRestore();
  });

  it('records an error against its attempt and carries on with the others, without retrying', async () => {
    const launchTarget = vi.fn(async (attempt: EvalRecordedAttempt) => {
      if (attempt.attemptId === 'a') throw new Error('boom');
      return completed;
    });
    const { ports, attempts } = makePorts(launchTarget);

    const tally = await runEvalAttempts(
      {
        attempts: [makeAttempt('a'), makeAttempt('b')],
        settings: { maxConcurrentAttempts: 1 },
        signal: new AbortController().signal,
      },
      ports,
    );

    expect(launchTarget).toHaveBeenCalledTimes(2);
    expect(finalPatch(attempts, 'a')).toMatchObject({
      status: 'ERROR',
      error: { message: 'boom' },
    });
    expect(finalPatch(attempts, 'b')).toMatchObject({ status: 'COMPLETED' });
    expect(tally).toEqual({ completed: 1, errored: 1, stopped: 0 });
  });

  it('stops an attempt at its recorded time limit and records TIME_LIMIT', async () => {
    vi.useFakeTimers();
    const { ports, attempts } = makePorts(
      (_attempt, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
    );

    const running = runEvalAttempts(
      {
        attempts: [makeAttempt('a')],
        settings: { maxConcurrentAttempts: 1, attemptTimeLimitSeconds: 30 },
        signal: new AbortController().signal,
      },
      ports,
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const tally = await running;

    expect(finalPatch(attempts, 'a')).toMatchObject({
      status: 'STOPPED',
      stopReason: 'TIME_LIMIT',
    });
    expect(finalPatch(attempts, 'a').measurements?.[0]).toMatchObject({ scope: 'TARGET_HANDLER' });
    expect(tally.stopped).toBe(1);
  });

  it('records TOKEN_LIMIT when the child stops at its recorded token budget, keeping its output', async () => {
    const launchTarget = vi.fn<EvalRunnerPorts['launchTarget']>(async () => ({
      assistantCompleted: false,
      outputText: 'partial',
      budgetExhausted: true,
      usage: { inputTokens: 900, outputTokens: 200 },
    }));
    const { ports, attempts } = makePorts(launchTarget);

    await runEvalAttempts(
      {
        attempts: [makeAttempt('a')],
        settings: { maxConcurrentAttempts: 1, attemptTokenLimit: 1000 },
        signal: new AbortController().signal,
      },
      ports,
    );

    expect(launchTarget.mock.calls[0]![1]).toMatchObject({ tokenBudget: 1000 });
    expect(finalPatch(attempts, 'a')).toMatchObject({
      status: 'STOPPED',
      stopReason: 'TOKEN_LIMIT',
      summary: { outputText: 'partial' },
      measurements: [{ scope: 'TARGET_HANDLER', inputTokens: 900, outputTokens: 200 }],
    });
  });

  it('stopping the session stops running attempts and records unstarted ones as stopped by the user', async () => {
    const run = new AbortController();
    const { ports, attempts, runStatuses } = makePorts(
      (_attempt, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
          run.abort();
        }),
    );

    const tally = await runEvalAttempts(
      {
        attempts: [makeAttempt('a'), makeAttempt('b'), makeAttempt('c')],
        settings: { maxConcurrentAttempts: 1 },
        signal: run.signal,
      },
      ports,
    );

    expect(finalPatch(attempts, 'a')).toMatchObject({ status: 'STOPPED', stopReason: 'USER' });
    expect(attempts.get('b')).toEqual([
      expect.objectContaining({ status: 'STOPPED', stopReason: 'USER' }),
    ]);
    expect(attempts.get('c')).toEqual([
      expect.objectContaining({ status: 'STOPPED', stopReason: 'USER' }),
    ]);
    expect(tally).toEqual({ completed: 0, errored: 0, stopped: 3 });
    expect(runStatuses).toEqual(['RUNNING', 'STOPPED']);
  });

  it('records a judge failure on the attempt without losing the target measurement', async () => {
    const { ports, attempts } = makePorts(async () => completed);
    ports.judge = async () => {
      throw new Error('bad json');
    };

    await runEvalAttempts(
      {
        attempts: [makeAttempt('a')],
        settings: { maxConcurrentAttempts: 1 },
        signal: new AbortController().signal,
      },
      ports,
    );

    expect(finalPatch(attempts, 'a')).toMatchObject({
      status: 'ERROR',
      error: { code: 'JUDGE_FAILED', message: 'bad json' },
      measurements: [{ scope: 'TARGET_HANDLER' }],
    });
  });
});

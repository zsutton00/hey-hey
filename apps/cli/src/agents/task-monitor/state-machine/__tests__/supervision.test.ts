import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { asMessageId } from '../../../../test-utils/contract-ids';
import {
  EffectRunner,
  MachineRecovery,
  MachineRegistry,
  MachineRuntime,
  MachineStateStore,
} from '../../../../state-machine';
import {
  taskMonitorStateStoreCodec,
  type TaskMonitorMachineRegistry,
  type TaskMonitorMachineRuntime,
  type TaskMonitorStateStore,
} from '../machine';
import type { EvaluateTaskMonitorSettledRunEffect } from '../effects';
import { transition } from 'xstate';
import { matchesResolvedCoordinationJudgment } from '../supervision';
import { taskMonitorStateProjection } from '../../../../server/task-monitor-state-publication';
import { afterEach, describe, expect, it } from 'vitest';

import type { TaskMonitorMachineContext } from '../context';
import { createTaskMonitorDefinition } from '../machine';

const MONITOR_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000002';
const RUN_ID = '30000000-0000-4000-8000-000000000003';

const context: TaskMonitorMachineContext = {
  taskMonitorId: MONITOR_ID,
  organizationId: '40000000-0000-4000-8000-000000000004',
  projectId: '50000000-0000-4000-8000-000000000005',
  kindKey: 'task',
  authorityCommandId: '90000000-0000-4000-8000-000000000009',
  requestedLaunchConfig: null,
  executionPlan: [],
  cursor: 0,
  selectedTaskId: '60000000-0000-4000-8000-000000000006',
  userGuidance: null,
  worktree: null,
  terminalPolicy: { mode: 'AGENT_DECIDES' },
  launch: null,
  agentSessionId: SESSION_ID,
  activeRunAgentSessionId: SESSION_ID,
  conversationId: '70000000-0000-4000-8000-000000000007',
  coordinatorConversationId: '80000000-0000-4000-8000-000000000008',
  pendingIntervention: null,
  settledRun: null,
  reviewRequest: null,
  input: { queuedMessageIds: [], active: null },
  failureReason: null,
};

const evaluating = () => {
  const definition = createTaskMonitorDefinition();
  const observing = definition.machine.resolveState({
    value: {
      RUNNING: {
        control: 'ACTIVE',
        work: 'OBSERVING_RUN',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    },
    context,
  });
  const [snapshot] = transition(definition.machine, observing, {
    type: 'RUN_SETTLED',
    taskMonitorId: MONITOR_ID,
    runId: RUN_ID,
    agentSessionId: SESSION_ID,
    settledAt: '2026-08-08T12:10:00.000Z',
    outcome: 'COMPLETED',
    turnId: 'turn-1',
    promptType: 'task',
    terminalOutcome: 'COMPLETED',
    completedAssistantMessageId: 'message-1',
    reports: [],
  });
  return { definition, snapshot };
};

describe('Task Monitor settled Run supervision', () => {
  it('enters explicit evaluation with typed Run facts and no continuation pointer', () => {
    const { snapshot } = evaluating();
    expect(snapshot.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'EVALUATING_RUN',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(snapshot.context.settledRun).toEqual({
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      settledAt: '2026-08-08T12:10:00.000Z',
      outcome: 'COMPLETED',
      turnId: 'turn-1',
      promptType: 'task',
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: 'message-1',
      reports: [],
      reviewRequestId: null,
    });
    expect(snapshot.context).not.toHaveProperty('continuation');
    expect(snapshot.context).not.toHaveProperty('continuationPointer');
  });

  it.each([
    ['LAUNCH_JUDGMENT_REQUIRED', 'LAUNCH_JUDGMENT'],
    ['OUTCOME_JUDGMENT_REQUIRED', 'OUTCOME_JUDGMENT'],
  ] as const)('enters the typed %s state', (type, expectedWork) => {
    const { definition, snapshot } = evaluating();
    const [next] = transition(definition.machine, snapshot, {
      type,
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      reason: 'Human judgment is required.',
    });
    expect(next.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: expectedWork,
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
  });

  it('records a coordinator judgment request as a pending judgment, never as a failure', () => {
    const { definition, snapshot } = evaluating();
    const [waiting] = transition(definition.machine, snapshot, {
      type: 'OUTCOME_JUDGMENT_REQUIRED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      reason: 'Ask the user to approve the schema change.',
    });
    expect(waiting.context.pendingJudgment).toEqual({
      request: 'Ask the user to approve the schema change.',
      requestMessageId: null,
    });
    expect(waiting.context.failureReason).toBeNull();

    const [resolved] = transition(definition.machine, waiting, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: MONITOR_ID,
      judgment: {
        requestMessageId: asMessageId('judgment-request-1'),
        label: 'Your judgment',
        conclusion: 'Approved.',
      },
    });
    expect(resolved.context.pendingJudgment).toBeNull();
  });

  it('records a failed supervision operation as a failure, never as a pending judgment', () => {
    const { definition, snapshot } = evaluating();
    const [failed] = transition(definition.machine, snapshot, {
      type: 'SUPERVISION_FAILED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      reason: 'Task Monitor coordinator Run could not be started.',
    });

    expect(failed.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'SUPERVISION_FAILED',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(failed.context.failureReason).toBe('Task Monitor coordinator Run could not be started.');
    expect(failed.context.pendingJudgment ?? null).toBeNull();
  });

  it('resumes only for the answer to the request now pending, once', () => {
    const { definition, snapshot } = evaluating();
    const ask = (current: typeof snapshot, requestMessageId: string, reason: string) =>
      transition(definition.machine, current, {
        type: 'OUTCOME_JUDGMENT_REQUIRED',
        taskMonitorId: MONITOR_ID,
        runId: RUN_ID,
        agentSessionId: SESSION_ID,
        reason,
        requestMessageId,
      })[0];
    const answer = (current: typeof snapshot, requestMessageId: string) =>
      transition(definition.machine, current, {
        type: 'JUDGMENT_RESOLVED',
        taskMonitorId: MONITOR_ID,
        judgment: {
          requestMessageId: asMessageId(requestMessageId),
          label: 'Your judgment',
          conclusion: `Conclusion for ${requestMessageId}.`,
        },
      });
    const effectsOf = (actions: Parameters<typeof definition.effectFromAction>[0][]) =>
      actions.flatMap((action) => definition.effectFromAction(action) ?? []);

    const waitingOnA = ask(snapshot, 'question-A', 'Question A?');
    const [afterA, resumeA] = answer(waitingOnA, 'question-A');
    expect(effectsOf(resumeA)).toHaveLength(1);

    const waitingOnB = ask(afterA, 'question-B', 'Question B?');
    const [stillWaiting, replayed] = answer(waitingOnB, 'question-A');
    expect(effectsOf(replayed)).toEqual([]);
    expect(stillWaiting.value).toMatchObject({ RUNNING: { work: 'OUTCOME_JUDGMENT' } });
    expect(stillWaiting.context.pendingJudgment).toEqual({
      request: 'Question B?',
      requestMessageId: 'question-B',
    });

    const [afterB, resumeB] = answer(stillWaiting, 'question-B');
    expect(effectsOf(resumeB)).toMatchObject([
      {
        type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
        judgment: { requestMessageId: 'question-B', conclusion: 'Conclusion for question-B.' },
      },
    ]);
    const [, resumedAgain] = answer(afterB, 'question-B');
    expect(effectsOf(resumedAgain)).toEqual([]);
  });

  it('applies the same request check when the answer resumes coordination', () => {
    const resolved = (
      pendingJudgment: { request: string; requestMessageId: string | null } | null,
      requestMessageId: string,
    ) =>
      matchesResolvedCoordinationJudgment({
        context: {
          ...context,
          settledRun: null,
          coordinationCause: 'JUDGMENT_RESOLVED',
          activeRunAgentSessionId: SESSION_ID,
          pendingJudgment,
        },
        event: {
          type: 'JUDGMENT_RESOLVED',
          taskMonitorId: MONITOR_ID,
          judgment: {
            requestMessageId: asMessageId(requestMessageId),
            label: 'Your judgment',
            conclusion: 'Answer.',
          },
        },
      });
    const pending = { request: 'Question B?', requestMessageId: 'question-B' };

    expect(resolved(pending, 'question-B')).toBe(true);
    expect(resolved(pending, 'question-A')).toBe(false);
    // A request settled before its message was recorded has no identity to compare.
    expect(resolved({ ...pending, requestMessageId: null }, 'question-A')).toBe(true);
  });

  it('re-evaluates the settled Run with the resolved judgment', () => {
    const { definition, snapshot } = evaluating();
    const [waiting] = transition(definition.machine, snapshot, {
      type: 'OUTCOME_JUDGMENT_REQUIRED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      reason: 'Human judgment is required.',
    });
    const judgment = {
      requestMessageId: asMessageId('judgment-request-1'),
      label: 'Your judgment',
      conclusion: 'The completed work looks correct.',
    };
    const [next, actions] = transition(definition.machine, waiting, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: MONITOR_ID,
      judgment,
    });
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect === null ? [] : [effect];
    });

    expect(next.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'EVALUATING_RUN',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(effects).toEqual([
      {
        type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
        taskMonitorId: MONITOR_ID,
        organizationId: context.organizationId,
        projectId: context.projectId,
        kindKey: 'task',
        authorityCommandId: context.authorityCommandId,
        runId: RUN_ID,
        agentSessionId: SESSION_ID,
        settledAt: '2026-08-08T12:10:00.000Z',
        outcome: 'COMPLETED',
        turnId: 'turn-1',
        promptType: 'task',
        terminalOutcome: 'COMPLETED',
        completedAssistantMessageId: 'message-1',
        reports: [],
        reviewRequestId: null,
        judgment,
      },
    ]);
  });

  it('continues coordination through the existing typed coordination effect', () => {
    const { definition, snapshot } = evaluating();
    const [next, actions] = transition(definition.machine, snapshot, {
      type: 'COORDINATION_CONTINUES',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
    });
    const effects = actions.flatMap((action) => {
      const effect = definition.effectFromAction(action);
      return effect === null ? [] : [effect];
    });
    expect(next.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'COORDINATING',
        intervention: 'CLEAR',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(effects).toEqual([
      expect.objectContaining({ type: 'COORDINATE_TASK_MONITOR_WORK', cursor: 1 }),
    ]);
  });

  it('commits a stable Review request before delivery and awaits the accepted request', () => {
    const { definition, snapshot } = evaluating();
    const [requesting, actions] = transition(definition.machine, snapshot, {
      type: 'REVIEW_REQUEST_COMMITTED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      requestId: '90000000-0000-4000-8000-000000000009',
      coordinatorRunId: '90000000-0000-4000-8000-000000000009',
      rationale: 'Independent Review is warranted.',
    });
    const effects = actions.flatMap((action) => {
      const committedEffect = definition.effectFromAction(action);
      return committedEffect === null ? [] : [committedEffect];
    });

    expect(requesting.value).toMatchObject({ RUNNING: { work: 'REQUESTING_REVIEW' } });
    expect(requesting.context.reviewRequest).toMatchObject({
      requestId: '90000000-0000-4000-8000-000000000009',
      failureContext: null,
    });
    expect(effects).toEqual([
      expect.objectContaining({
        type: 'DELIVER_TASK_MONITOR_REVIEW',
        requestId: '90000000-0000-4000-8000-000000000009',
      }),
    ]);

    const [awaiting] = transition(definition.machine, requesting, {
      type: 'REVIEW_REQUEST_ACCEPTED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      requestId: '90000000-0000-4000-8000-000000000009',
    });
    expect(awaiting.value).toMatchObject({ RUNNING: { work: 'AWAITING_REVIEW' } });
  });

  it('binds accepted Review identity to its settled evaluation and judgment re-entry', () => {
    const { definition, snapshot } = evaluating();
    const requestId = '90000000-0000-4000-8000-000000000009';
    const [requesting] = transition(definition.machine, snapshot, {
      type: 'REVIEW_REQUEST_COMMITTED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      requestId,
      coordinatorRunId: requestId,
      rationale: 'Independent Review is warranted.',
    });
    const [awaiting] = transition(definition.machine, requesting, {
      type: 'REVIEW_REQUEST_ACCEPTED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      requestId,
    });
    const [reviewed, actions] = transition(definition.machine, awaiting, {
      type: 'RUN_SETTLED',
      taskMonitorId: MONITOR_ID,
      runId: 'review-run-1',
      agentSessionId: SESSION_ID,
      settledAt: '2026-08-08T12:20:00.000Z',
      outcome: 'COMPLETED',
      turnId: 'review-turn-1',
      promptType: 'code_review',
      terminalOutcome: 'COMPLETED',
      completedAssistantMessageId: null,
      reports: [],
    });
    const effects = actions.flatMap((action) => {
      const boundEffect = definition.effectFromAction(action);
      return boundEffect === null ? [] : [boundEffect];
    });

    expect(reviewed.context.reviewRequest).toBeNull();
    expect(reviewed.context.settledRun?.reviewRequestId).toBe(requestId);
    expect(effects).toEqual([
      expect.objectContaining({
        type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
        reviewRequestId: requestId,
      }),
    ]);

    const [waiting] = transition(definition.machine, reviewed, {
      type: 'OUTCOME_JUDGMENT_REQUIRED',
      taskMonitorId: MONITOR_ID,
      runId: 'review-run-1',
      agentSessionId: SESSION_ID,
      reason: 'Human judgment is required.',
    });
    const [reentered, judgmentActions] = transition(definition.machine, waiting, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: MONITOR_ID,
      judgment: {
        requestMessageId: asMessageId('judgment-request-1'),
        label: 'Your judgment',
        conclusion: 'The Review succeeded.',
      },
    });
    const judgmentEffects = judgmentActions.flatMap((action) => {
      const boundEffect = definition.effectFromAction(action);
      return boundEffect === null ? [] : [boundEffect];
    });

    expect(reentered.context.settledRun?.reviewRequestId).toBe(requestId);
    expect(judgmentEffects).toEqual([
      expect.objectContaining({
        type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
        reviewRequestId: requestId,
      }),
    ]);
  });

  it('routes only ambiguous Review recovery to outcome judgment', () => {
    const { definition, snapshot } = evaluating();
    const committed = {
      type: 'REVIEW_REQUEST_COMMITTED' as const,
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      requestId: '90000000-0000-4000-8000-000000000009',
      coordinatorRunId: '90000000-0000-4000-8000-000000000009',
      rationale: 'Independent Review is warranted.',
    };
    const [requesting] = transition(definition.machine, snapshot, committed);
    const failure = {
      type: 'REVIEW_REQUEST_FAILED' as const,
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      requestId: committed.requestId,
      reason: 'Delivery could not be confirmed.',
    };
    const [failed] = transition(definition.machine, requesting, {
      ...failure,
      ambiguous: false,
    });
    const [judgment] = transition(definition.machine, requesting, {
      ...failure,
      ambiguous: true,
    });

    expect(failed.value).toMatchObject({ RUNNING: { work: 'REVIEW_REQUEST_FAILED' } });
    expect(judgment.value).toMatchObject({ RUNNING: { work: 'OUTCOME_JUDGMENT' } });
  });

  it('moves observation to the launched continuation session and its Conversation owner', () => {
    const { definition, snapshot } = evaluating();
    const [next] = transition(definition.machine, snapshot, {
      type: 'SUPERVISION_CONTINUES_OBSERVING',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      nextAgentSessionId: '80000000-0000-4000-8000-000000000008',
      nextConversationId: '90000000-0000-4000-8000-000000000009',
    });

    expect(next.context).toMatchObject({
      agentSessionId: '80000000-0000-4000-8000-000000000008',
      activeRunAgentSessionId: '80000000-0000-4000-8000-000000000008',
      conversationId: '90000000-0000-4000-8000-000000000009',
      settledRun: null,
      reviewRequest: null,
    });
  });

  it('clears Review binding when ordinary coordination continues', () => {
    const { definition, snapshot } = evaluating();
    const reviewBound = definition.machine.resolveState({
      value: snapshot.value,
      context: {
        ...snapshot.context,
        settledRun: { ...snapshot.context.settledRun!, reviewRequestId: 'review-request-1' },
        reviewRequest: {
          requestId: 'review-request-1',
          coordinatorRunId: 'coordinator-run-1',
          agentSessionId: SESSION_ID,
          rationale: 'Review was requested.',
          failureContext: null,
        },
      },
    });
    const [next] = transition(definition.machine, reviewBound, {
      type: 'COORDINATION_CONTINUES',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
    });

    expect(next.context.settledRun).toBeNull();
    expect(next.context.reviewRequest).toBeNull();
  });

  it.each([
    ['SUPERVISION_HALTED', 'HALTED'],
    ['SUPERVISION_COMPLETED', 'COMPLETED'],
  ] as const)('settles through typed %s', (type, expected) => {
    const { definition, snapshot } = evaluating();
    const event =
      type === 'SUPERVISION_HALTED'
        ? {
            type,
            taskMonitorId: MONITOR_ID,
            runId: RUN_ID,
            agentSessionId: SESSION_ID,
            reason: 'Policy halted the monitor.',
          }
        : { type, taskMonitorId: MONITOR_ID, runId: RUN_ID, agentSessionId: SESSION_ID };
    const [next] = transition(definition.machine, snapshot, event);
    expect(next.value).toBe(expected);
  });
});

describe('invalid coordinator recovery', () => {
  const failure = { code: 'INVALID_JSON', message: 'Expected one JSON object.', issues: [] };
  const start = () => {
    const { definition, snapshot } = evaluating();
    const evaluation: EvaluateTaskMonitorSettledRunEffect = {
      type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
      kindKey: 'task',
      taskMonitorId: MONITOR_ID,
      organizationId: context.organizationId!,
      projectId: context.projectId!,
      authorityCommandId: context.authorityCommandId!,
      ...snapshot.context.settledRun!,
    };
    return { definition, snapshot, evaluation };
  };
  it('commits exactly two corrections then a separate actionable request and survives reconstruction', () => {
    const { definition, snapshot, evaluation } = start();
    let current = snapshot;
    let effect = evaluation;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const [next, actions] = transition(definition.machine, current, {
        type: 'COORDINATOR_DECISION_INVALID',
        taskMonitorId: MONITOR_ID,
        runId: RUN_ID,
        agentSessionId: SESSION_ID,
        attemptId: `attempt-${attempt}`,
        evaluation: effect,
        failure,
      });
      const effects = actions.flatMap((action) => definition.effectFromAction(action) ?? []);
      expect(effects).toHaveLength(1);
      current = definition.machine.resolveState({
        value: next.value,
        context: taskMonitorStateStoreCodec.decodeContext(JSON.parse(JSON.stringify(next.context))),
      });
      if (attempt < 2) {
        expect(effects[0]).toMatchObject({
          type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
          turnId: 'turn-1',
          correction: { attempt: attempt + 1, validationFailure: failure },
        });
        effect = effects[0] as EvaluateTaskMonitorSettledRunEffect;
      } else {
        expect(effects[0]).toMatchObject({
          type: 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT',
          requestId: 'attempt-2',
          failure,
        });
        expect(current.value).toMatchObject({ RUNNING: { work: 'OUTCOME_JUDGMENT' } });
      }
    }
    const [duplicate, duplicateActions] = transition(definition.machine, current, {
      type: 'COORDINATOR_DECISION_INVALID',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      attemptId: 'attempt-2',
      evaluation: effect,
      failure,
    });
    expect(duplicateActions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual(
      [],
    );
    const [wrongReply, wrongActions] = transition(definition.machine, duplicate, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: MONITOR_ID,
      judgment: {
        requestMessageId: asMessageId('other-request'),
        label: 'Guidance',
        conclusion: 'Try again.',
      },
    });
    expect(wrongActions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual([]);
    const [posted] = transition(definition.machine, wrongReply, {
      type: 'OUTCOME_JUDGMENT_PROJECTED',
      taskMonitorId: MONITOR_ID,
      requestId: 'attempt-2',
      messageId: 'canonical-request',
      conversationId: context.coordinatorConversationId!,
    });
    const [resolved, resumed] = transition(definition.machine, posted, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: MONITOR_ID,
      judgment: {
        requestMessageId: asMessageId('canonical-request'),
        label: 'Guidance',
        conclusion: 'Reassess the completed work.',
      },
    });
    expect(resolved.context.coordinatorRecovery).toBeNull();
    expect(resumed.flatMap((action) => definition.effectFromAction(action) ?? [])).toMatchObject([
      {
        type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
        judgment: { requestMessageId: 'canonical-request' },
      },
    ]);
  });
  it('rejects duplicate earlier invalid output and clears recovery after a successful correction', () => {
    const { definition, snapshot, evaluation } = start();
    const invalid = {
      type: 'COORDINATOR_DECISION_INVALID' as const,
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      attemptId: 'attempt-0',
      evaluation,
      failure,
    };
    const [retry] = transition(definition.machine, snapshot, invalid);
    const [, actions] = transition(definition.machine, retry, invalid);
    expect(actions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual([]);
    const [success] = transition(definition.machine, retry, {
      type: 'SUPERVISION_CONTINUES_OBSERVING',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
    });
    expect(success.context.coordinatorRecovery).toBeNull();
    expect(success.context.failureReason).toBeNull();
  });
  it('keeps an open recovery when a supervision operation fails during a correction', () => {
    const { definition, snapshot, evaluation } = start();
    const [retry] = transition(definition.machine, snapshot, {
      type: 'COORDINATOR_DECISION_INVALID',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      attemptId: 'attempt-0',
      evaluation,
      failure,
    });

    const [parked, actions] = transition(definition.machine, retry, {
      type: 'SUPERVISION_FAILED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      reason: 'Task Monitor coordinator Run could not be started.',
    });

    expect(parked.value).toMatchObject({ RUNNING: { work: 'OUTCOME_JUDGMENT' } });
    expect(parked.context.coordinatorRecovery).not.toBeNull();
    expect(parked.context.pendingJudgment ?? null).toBeNull();
    expect(actions.flatMap((action) => definition.effectFromAction(action) ?? [])).toMatchObject([
      { type: 'PROJECT_TASK_MONITOR_OUTCOME_JUDGMENT' },
    ]);
  });
  it('treats a valid judgment request after a correction as the question to answer, not a failure', () => {
    const { definition, snapshot, evaluation } = start();
    const [retry] = transition(definition.machine, snapshot, {
      type: 'COORDINATOR_DECISION_INVALID',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      attemptId: 'attempt-0',
      evaluation,
      failure,
    });
    expect(retry.context.coordinatorRecovery).not.toBeNull();

    const [waiting, requested] = transition(definition.machine, retry, {
      type: 'OUTCOME_JUDGMENT_REQUIRED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      reason: 'Approve the schema change?',
    });

    expect(requested.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual([]);
    expect(waiting.context).toMatchObject({
      coordinatorRecovery: null,
      failureReason: null,
      pendingJudgment: { request: 'Approve the schema change?', requestMessageId: null },
    });
    const projection = taskMonitorStateProjection({
      identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
      revision: 5,
      state: waiting.value as never,
      context: waiting.context,
    });
    expect(projection.failure).toBeUndefined();
    expect(projection.pendingJudgment).toMatchObject({ request: 'Approve the schema change?' });

    const [, resumed] = transition(definition.machine, waiting, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: MONITOR_ID,
      judgment: {
        requestMessageId: asMessageId('coordinator-posted-question'),
        label: 'Guidance',
        conclusion: 'Approved.',
      },
    });
    expect(resumed.flatMap((action) => definition.effectFromAction(action) ?? [])).toMatchObject([
      {
        type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
        judgment: { requestMessageId: 'coordinator-posted-question' },
      },
    ]);
  });
  it('holds correction while paused and launches nothing after Stop', () => {
    const { definition, snapshot, evaluation } = start();
    const paused = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'PAUSED',
          work: 'EVALUATING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context: snapshot.context,
    });
    const invalid = {
      type: 'COORDINATOR_DECISION_INVALID' as const,
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      attemptId: 'attempt-0',
      evaluation,
      failure,
    };
    const [held, actions] = transition(definition.machine, paused, invalid);
    expect(held.context.coordinatorRecovery?.pendingCorrection).toBe(true);
    expect(actions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual([]);
    const [stopped] = transition(definition.machine, held, {
      type: 'STOP',
      taskMonitorId: MONITOR_ID,
    });
    const [, stoppedActions] = transition(definition.machine, stopped, invalid);
    expect(stoppedActions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual(
      [],
    );
  });
});

describe('legacy judgment settlements awaiting admission', () => {
  const REASON = 'Task Monitor coordinator Run could not be started.';
  const directories: string[] = [];
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map((directory) => fs.rm(directory, { recursive: true })),
    );
  });

  /** The store as the previous CLI left it: settled, but its outcome never admitted. */
  const interruptedBeforeAdmission = async (status: 'succeeded' | 'failed' | 'uncertain') => {
    const { snapshot } = evaluating();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'heyhey-legacy-judgment-'));
    directories.push(directory);
    const effect: EvaluateTaskMonitorSettledRunEffect = {
      type: 'EVALUATE_TASK_MONITOR_SETTLED_RUN',
      kindKey: 'task',
      taskMonitorId: MONITOR_ID,
      organizationId: context.organizationId!,
      projectId: context.projectId!,
      authorityCommandId: context.authorityCommandId!,
      ...snapshot.context.settledRun!,
    };
    await fs.writeFile(
      path.join(directory, 'machines.json'),
      JSON.stringify({
        schemaVersion: 2,
        writerApplicationVersion: 'legacy-test',
        instances: [
          {
            identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
            revision: 1,
            state: snapshot.value,
            context: JSON.parse(JSON.stringify(snapshot.context)),
            acceptedIngress: [],
            effects: [
              {
                effectId: 'effect-1',
                revision: 1,
                effect,
                execution: {
                  status: 'settled',
                  settlement: {
                    status,
                    outcome: {
                      type: 'OUTCOME_JUDGMENT_REQUIRED',
                      taskMonitorId: MONITOR_ID,
                      runId: RUN_ID,
                      agentSessionId: SESSION_ID,
                      reason: REASON,
                    },
                  },
                },
              },
            ],
            payloadSchemaVersion: 2,
          },
        ],
      }),
      'utf8',
    );
    const store: TaskMonitorStateStore = new MachineStateStore(
      path.join(directory, 'machines.json'),
      taskMonitorStateStoreCodec,
    );
    const runtime: TaskMonitorMachineRuntime = new MachineRuntime(store);
    const registry: TaskMonitorMachineRegistry = new MachineRegistry(runtime);
    registry.register(createTaskMonitorDefinition());
    const runner = new EffectRunner(store, runtime, registry, {});
    await new MachineRecovery(store, registry, runner).restore();
    const restored = await store.findByInstanceId(MONITOR_ID);
    if (!restored) throw new Error('Expected the restored Task Monitor.');
    return restored.snapshot;
  };

  it.each(['failed', 'uncertain'] as const)(
    'replays a %s settlement as a failure, never as a question nobody posted',
    async (status) => {
      const restored = await interruptedBeforeAdmission(status);

      expect(restored.state).toMatchObject({ RUNNING: { work: 'SUPERVISION_FAILED' } });
      expect(restored.context.failureReason).toBe(REASON);
      expect(restored.context.pendingJudgment ?? null).toBeNull();
      expect(taskMonitorStateProjection(restored).pendingJudgment).toBeUndefined();
    },
  );

  it('replays a succeeded settlement as the question the coordinator posted', async () => {
    const restored = await interruptedBeforeAdmission('succeeded');

    expect(restored.state).toMatchObject({ RUNNING: { work: 'OUTCOME_JUDGMENT' } });
    expect(restored.context).toMatchObject({
      failureReason: null,
      pendingJudgment: { request: REASON, requestMessageId: null },
    });
    expect(taskMonitorStateProjection(restored)).toMatchObject({
      pendingJudgment: { request: REASON },
    });
    expect(taskMonitorStateProjection(restored).failure).toBeUndefined();
  });
});

describe('pausing and resuming while a request is open', () => {
  const failure = { code: 'INVALID_JSON', message: 'Expected one JSON object.', issues: [] };
  const coordinatingContext = {
    ...context,
    settledRun: null,
    coordinationCorrelationId: 'correlation-1',
  };
  const effectsOf = (
    definition: ReturnType<typeof createTaskMonitorDefinition>,
    actions: Parameters<ReturnType<typeof createTaskMonitorDefinition>['effectFromAction']>[0][],
  ) => actions.flatMap((action) => definition.effectFromAction(action) ?? []);
  const projectionOf = (snapshot: { value: unknown; context: TaskMonitorMachineContext }) =>
    taskMonitorStateProjection({
      identity: { machineType: 'TASK_MONITOR', instanceId: MONITOR_ID },
      revision: 1,
      state: snapshot.value as never,
      context: snapshot.context,
    });

  /** A monitor assessing its work, as it is when the coordinator answers. */
  const coordinating = () => {
    const definition = createTaskMonitorDefinition();
    const state = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'COORDINATING',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context: coordinatingContext,
    });
    return { definition, state };
  };

  type Machine = ReturnType<typeof coordinating>['definition']['machine'];
  type Snapshot = ReturnType<Machine['resolveState']>;
  const step = (
    definition: ReturnType<typeof createTaskMonitorDefinition>,
    from: Snapshot,
    event: object,
  ) => {
    const [next, actions] = transition(definition.machine, from, event as never);
    return { next, effects: effectsOf(definition, actions) };
  };
  const pauseThenResume = (
    definition: ReturnType<typeof createTaskMonitorDefinition>,
    from: Snapshot,
  ) => {
    let current = step(definition, from, { type: 'PAUSE', taskMonitorId: MONITOR_ID }).next;
    current = step(definition, current, {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: MONITOR_ID,
      status: 'ON_HOLD',
    }).next;
    const resuming = step(definition, current, { type: 'RESUME', taskMonitorId: MONITOR_ID }).next;
    const resumed = step(definition, resuming, {
      type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
      taskMonitorId: MONITOR_ID,
      status: 'ACTIVE',
    });
    return { resuming, resumed };
  };
  /** Runs invalid decisions until the corrections are spent and a recovery request is committed. */
  const exhaustCorrections = (
    definition: ReturnType<typeof createTaskMonitorDefinition>,
    from: Snapshot,
    firstEvaluation: object,
  ) => {
    let current = from;
    let evaluation = firstEvaluation;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = step(definition, current, {
        type: 'COORDINATOR_DECISION_INVALID',
        taskMonitorId: MONITOR_ID,
        runId: RUN_ID,
        agentSessionId: SESSION_ID,
        attemptId: `attempt-${attempt}`,
        evaluation,
        failure,
      });
      current = result.next;
      evaluation = result.effects[0] ?? evaluation;
    }
    return current;
  };
  const answer = (
    definition: ReturnType<typeof createTaskMonitorDefinition>,
    from: Snapshot,
    requestMessageId: string,
  ) =>
    step(definition, from, {
      type: 'JUDGMENT_RESOLVED',
      taskMonitorId: MONITOR_ID,
      judgment: {
        requestMessageId: asMessageId(requestMessageId),
        label: 'Guidance',
        conclusion: `Answer to ${requestMessageId}.`,
      },
    });

  it('keeps a delivered recovery question, and tells the coordinator about it, across Pause and Resume', () => {
    const { definition, state } = coordinating();
    // A first Resume yields the real coordination the coordinator is then asked to answer.
    const { resumed: assessing } = pauseThenResume(definition, state);
    const waiting = exhaustCorrections(definition, assessing.next, assessing.effects[0] ?? {});
    const { next: delivered } = step(definition, waiting, {
      type: 'OUTCOME_JUDGMENT_PROJECTED',
      taskMonitorId: MONITOR_ID,
      requestId: 'attempt-2',
      messageId: 'recovery-request',
      conversationId: context.coordinatorConversationId,
    });
    const before = projectionOf(delivered);
    expect(before.pendingJudgment).toMatchObject({
      request: expect.stringContaining('INVALID_JSON'),
    });
    const pendingJudgment = before.pendingJudgment;
    const request =
      pendingJudgment && 'request' in pendingJudgment ? pendingJudgment.request : undefined;

    const { resuming, resumed } = pauseThenResume(definition, delivered);

    // The work region is still waiting while Resume is admitted: the request stays published.
    expect(resuming.value).toMatchObject({
      RUNNING: { control: 'RESUMING', work: 'OUTCOME_JUDGMENT' },
    });
    const during = projectionOf(resuming);
    expect(during.pendingJudgment).toEqual(before.pendingJudgment);
    expect(during.failure).toBeUndefined();
    // The coordinator reassessing the work is told which question is still open.
    expect(resumed.effects).toMatchObject([
      {
        type: 'COORDINATE_TASK_MONITOR_WORK',
        cause: 'RESUME',
        coordination: { pendingJudgmentReason: request },
      },
    ]);
    // The preserved question keeps its identity: only its own message answers it.
    expect(answer(definition, resuming, 'other-message').effects).toEqual([]);
    expect(answer(definition, resuming, 'recovery-request').effects).toHaveLength(1);
  });

  it('retires an earlier question when reassessment after Resume needs recovery, and answers the new one', () => {
    const { definition, state } = coordinating();
    const asked = step(definition, state, {
      type: 'OUTCOME_JUDGMENT_REQUIRED',
      taskMonitorId: MONITOR_ID,
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      reason: 'Question A?',
      requestMessageId: 'question-A',
    }).next;
    expect(projectionOf(asked).pendingJudgment).toMatchObject({ request: 'Question A?' });

    const { resumed } = pauseThenResume(definition, asked);
    const reassessing = resumed.next;
    const recovering = exhaustCorrections(definition, reassessing, resumed.effects[0] ?? {});

    // Before the recovery message is posted nothing is shown as a question, and no answer is accepted.
    const undelivered = projectionOf(recovering);
    expect(undelivered.pendingJudgment).toBeUndefined();
    expect(undelivered.failure?.correctiveGuidance).toContain('nothing to answer');
    expect(answer(definition, recovering, 'question-A').effects).toEqual([]);
    expect(answer(definition, recovering, 'recovery-request').effects).toEqual([]);

    const { next: delivered } = step(definition, recovering, {
      type: 'OUTCOME_JUDGMENT_PROJECTED',
      taskMonitorId: MONITOR_ID,
      requestId: 'attempt-2',
      messageId: 'recovery-request',
      conversationId: context.coordinatorConversationId,
    });

    // After delivery the displayed question is the one the machine accepts an answer to.
    expect(projectionOf(delivered).pendingJudgment).toMatchObject({
      request: expect.stringContaining('INVALID_JSON'),
    });
    expect(answer(definition, delivered, 'question-A').effects).toEqual([]);
    expect(answer(definition, delivered, 'recovery-request').effects).toMatchObject([
      { type: 'COORDINATE_TASK_MONITOR_WORK' },
    ]);
  });
});

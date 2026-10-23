import { taskMonitorStateStoreCodec } from '../machine';
import type { EvaluateTaskMonitorSettledRunEffect } from '../effects';
import { transition } from 'xstate';
import { describe, expect, it } from 'vitest';

import type { TaskMonitorMachineContext } from '../context';
import { createTaskMonitorDefinition } from '../machine';

const MONITOR_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000002';
const RUN_ID = '30000000-0000-4000-8000-000000000003';

const context: TaskMonitorMachineContext = {
  taskMonitorId: MONITOR_ID,
  organizationId: '40000000-0000-4000-8000-000000000004',
  projectId: '50000000-0000-4000-8000-000000000005',
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
      requestMessageId: 'judgment-request-1',
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
        requestMessageId: 'judgment-request-1',
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
      judgment: { requestMessageId: 'other-request', label: 'Guidance', conclusion: 'Try again.' },
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
        requestMessageId: 'canonical-request',
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

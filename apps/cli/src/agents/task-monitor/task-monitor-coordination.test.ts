import { describe, expect, it } from 'vitest';
import type { LocalTaskMonitorCoordinatorDecision } from '@hey-hey/contracts/agent-bridge';
import type { TaskMonitorCanonicalEvidence } from './task-monitor-evidence';
import {
  parseTaskMonitorCoordinationLocalState,
  taskMonitorCoordinationLocalStateFromContext,
  validateTaskMonitorDecision,
  type TaskMonitorCoordinationSnapshot,
} from './task-monitor-coordination';

const evidence = (
  overrides: Partial<TaskMonitorCanonicalEvidence> = {},
): TaskMonitorCanonicalEvidence => ({
  monitor: {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'ACTIVE',
    executionStatus: 'ACTIVE',
    cursor: 0,
    reviewMode: 'AGENT_DECIDES',
    launch: {
      method: 'quick',
      provider: 'codex',
      model: 'gpt-5',
      reasoningEffort: 'high',
    },
  },
  planGuidance: null,
  selectedTask: {
    executionIndex: 0,
    id: '22222222-2222-4222-8222-222222222222',
    title: 'Selected Task',
    type: 'STANDARD',
    status: 'ACTIVE',
    typeStatuses: [
      { name: 'BACKLOG', meaning: 'NOT_STARTED' },
      { name: 'ACTIVE', meaning: 'IN_PROGRESS' },
      { name: 'COMPLETED', meaning: 'FINISHED', completionBehavior: 'COMPLETED' },
      { name: 'CANCELLED', meaning: 'FINISHED', completionBehavior: 'CANCELLED' },
    ],
    sections: [],
    featureHierarchy: [],
    contracts: [],
  },
  remainingWork: [],
  selectedSession: null,
  releasedTurn: null,
  reports: [],
  ...overrides,
});

const snapshot = (
  overrides: Partial<TaskMonitorCanonicalEvidence> = {},
): TaskMonitorCoordinationSnapshot => ({
  cause: 'RESUME',
  correlationId: '33333333-3333-4333-8333-333333333333',
  evidence: evidence(overrides),
  localState: null,
});

describe('Task Monitor coordination policy', () => {
  it('rejects acceptance before canonical Task completion', () => {
    const decision: LocalTaskMonitorCoordinatorDecision = {
      action: 'ACCEPT_TASK',
      rationale: 'The work appears complete.',
    };

    expect(validateTaskMonitorDecision(snapshot(), decision)).toEqual({
      ok: false,
      reason: 'Task acceptance requires a Task in a finished, non-cancelled status.',
    });
  });

  it('accepts a Task in a custom finished status and rejects a cancelled one', () => {
    const decision: LocalTaskMonitorCoordinatorDecision = {
      action: 'ACCEPT_TASK',
      rationale: 'The work is done.',
    };
    const typeStatuses = [
      { name: 'Doing', meaning: 'IN_PROGRESS' },
      { name: 'Done', meaning: 'FINISHED' },
      { name: 'Dropped', meaning: 'FINISHED', completionBehavior: 'CANCELLED' },
    ] as const;
    const withStatus = (status: string) =>
      snapshot({
        selectedTask: { ...evidence().selectedTask, status, typeStatuses },
      });

    expect(validateTaskMonitorDecision(withStatus('Done'), decision)).toMatchObject({ ok: true });
    expect(validateTaskMonitorDecision(withStatus('Dropped'), decision)).toMatchObject({
      ok: false,
    });
  });

  it('rejects Review when Resume has no released completed Turn', () => {
    const decision: LocalTaskMonitorCoordinatorDecision = {
      action: 'REQUEST_REVIEW',
      rationale: 'Review would provide confidence.',
    };

    expect(validateTaskMonitorDecision(snapshot(), decision)).toMatchObject({
      ok: false,
      reason: 'Review requires the current selected session and a completed released Turn.',
    });
  });

  it('accepts a bounded WAIT recommendation without granting mutation authority', () => {
    const decision: LocalTaskMonitorCoordinatorDecision = {
      action: 'WAIT',
      rationale: 'The canonical evidence does not support an external effect yet.',
    };

    expect(validateTaskMonitorDecision(snapshot(), decision)).toEqual({
      ok: true,
      value: decision,
    });
  });

  it('rejects a decision after the canonical monitor is paused', () => {
    const decision: LocalTaskMonitorCoordinatorDecision = {
      action: 'WAIT',
      rationale: 'The current evidence is inconclusive.',
    };

    expect(
      validateTaskMonitorDecision(
        snapshot({ monitor: { ...evidence().monitor, status: 'ON_HOLD' } }),
        decision,
      ),
    ).toEqual({
      ok: false,
      reason: 'Task Monitor coordination requires an active monitor, not ON_HOLD.',
    });
  });

  it('resumes a real failure without presenting it to the coordinator as a pending question', () => {
    const context = {
      userGuidance: null,
      selectedTaskId: null,
      activeRunAgentSessionId: '44444444-4444-4444-8444-444444444444',
      conversationId: null,
      reviewRequest: null,
      settledRun: null,
      failureReason: 'Task Monitor coordinator Run could not be started.',
      pendingJudgment: null,
    };

    expect(
      taskMonitorCoordinationLocalStateFromContext(context, 'ACTIVE', 'SUPERVISION_FAILED')
        .pendingJudgmentReason,
    ).toBeNull();
    expect(
      taskMonitorCoordinationLocalStateFromContext(
        {
          ...context,
          pendingJudgment: { request: 'Approve the schema change?', requestMessageId: null },
        },
        'ACTIVE',
        'OUTCOME_JUDGMENT',
      ).pendingJudgmentReason,
    ).toBe('Approve the schema change?');
  });

  it('only restores the exact local coordination shape from persisted context', () => {
    const state = {
      control: 'RESUMING',
      work: 'COORDINATING',
      userGuidance: null,
      selectedTaskId: null,
      activeRunAgentSessionId: '44444444-4444-4444-8444-444444444444',
      activeRunId: '55555555-5555-4555-8555-555555555555',
      conversationId: null,
      reviewRequestId: null,
      pendingJudgmentReason: null,
      committedEffectId: null,
      settledRun: null,
    } as const;

    expect(parseTaskMonitorCoordinationLocalState(state)).toEqual(state);
    expect(parseTaskMonitorCoordinationLocalState({ ...state, cursor: 1 })).toBeNull();
  });
});

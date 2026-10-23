import { describe, expect, it } from 'vitest';
import type { LocalTaskMonitorCoordinatorDecision } from '../../shared/agent-bridge-contract/generated/api';
import type { TaskMonitorCanonicalEvidence } from './task-monitor-evidence';
import {
  parseTaskMonitorCoordinationLocalState,
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
      reason: 'Task acceptance requires a canonically completed Task.',
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

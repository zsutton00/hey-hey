import { transition } from 'xstate';
import { describe, expect, it } from 'vitest';

import type { TaskMonitorMachineContext } from '../context';
import type { TaskMonitorMachineEvent } from '../events';
import { createTaskMonitorDefinition } from '../machine';

const MONITOR_ID = '10000000-0000-4000-8000-000000000001';
const SESSION_ID = '20000000-0000-4000-8000-000000000002';
const RUN_ID = '30000000-0000-4000-8000-000000000003';
const INTERVENTION_ID = '40000000-0000-4000-8000-000000000004';

const context = (): TaskMonitorMachineContext => ({
  taskMonitorId: MONITOR_ID,
  organizationId: '50000000-0000-4000-8000-000000000005',
  projectId: '60000000-0000-4000-8000-000000000006',
  requestedLaunchConfig: null,
  executionPlan: [],
  cursor: 0,
  selectedTaskId: '70000000-0000-4000-8000-000000000007',
  userGuidance: 'Keep the current work.',
  worktree: null,
  terminalPolicy: { mode: 'AGENT_DECIDES' },
  launch: null,
  agentSessionId: SESSION_ID,
  activeRunAgentSessionId: SESSION_ID,
  conversationId: '80000000-0000-4000-8000-000000000008',
  coordinatorConversationId: '90000000-0000-4000-8000-000000000009',
  pendingIntervention: null,
  settledRun: null,
      reviewRequest: null,
  input: { queuedMessageIds: [], active: null },
  failureReason: null,
});

const exactAction: TaskMonitorMachineEvent = {
  type: 'EXACT_ACTION_REQUIRED',
  taskMonitorId: MONITOR_ID,
  interventionId: INTERVENTION_ID,
  providerActionId: 'provider-action-1',
  providerSessionId: 'provider-session-1',
  runId: RUN_ID,
  agentSessionId: SESSION_ID,
  action: 'exec',
  target: 'pnpm deploy',
  fingerprint: 'sha256:exact-action',
  createdAt: '2026-08-08T12:00:00.000Z',
  expiresAt: '2026-08-08T12:05:00.000Z',
};

const decision = (
  overrides: Partial<Extract<TaskMonitorMachineEvent, { type: 'HUMAN_DECISION' }>> = {},
) => ({
  type: 'HUMAN_DECISION' as const,
  taskMonitorId: MONITOR_ID,
  interventionId: INTERVENTION_ID,
  providerActionId: 'provider-action-1',
  runId: RUN_ID,
  agentSessionId: SESSION_ID,
  fingerprint: 'sha256:exact-action',
  resolution: 'APPROVE' as const,
  providerDecision: 'approve' as const,
  decidedAt: '2026-08-08T12:01:00.000Z',
  human: {
    userId: '90000000-0000-4000-8000-000000000009',
    authenticatedAt: '2026-08-08T12:00:59.000Z',
  },
  ...overrides,
});

const observing = () => {
  const definition = createTaskMonitorDefinition();
  return {
    definition,
    snapshot: definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'ACTIVE',
          work: 'OBSERVING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context: context(),
    }),
  };
};

describe('Task Monitor exact-action intervention', () => {
  it('stores one pending intervention without changing work or control', () => {
    const { definition, snapshot } = observing();
    const [next, actions] = transition(definition.machine, snapshot, exactAction);

    expect(next.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'OBSERVING_RUN',
        intervention: 'PENDING',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(next.context).toMatchObject({
      userGuidance: 'Keep the current work.',
      activeRunAgentSessionId: SESSION_ID,
      pendingIntervention: {
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
        decision: null,
      },
    });
    expect(actions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual([
      expect.objectContaining({
        type: 'PROJECT_TASK_MONITOR_INTERVENTION',
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
      }),
    ]);
  });

  it('declares exactly one release effect for a fully matching unexpired decision', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, exactAction);
    const [applying, actions] = transition(definition.machine, pending, decision());
    const effects = actions.flatMap((action) => definition.effectFromAction(action) ?? []);

    expect(applying.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'OBSERVING_RUN',
        intervention: 'APPLYING_DECISION',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      type: 'APPLY_TASK_MONITOR_DECISION',
      operation: 'RELEASE_EXACT_ACTION',
      interventionId: INTERVENTION_ID,
      providerActionId: 'provider-action-1',
      runId: RUN_ID,
      agentSessionId: SESSION_ID,
      fingerprint: 'sha256:exact-action',
      human: { userId: '90000000-0000-4000-8000-000000000009' },
    });
  });

  it.each([
    ['wrong intervention', { interventionId: '41000000-0000-4000-8000-000000000004' }],
    ['wrong provider action', { providerActionId: 'other-action' }],
    ['wrong fingerprint', { fingerprint: 'sha256:other' }],
    ['wrong Run', { runId: '31000000-0000-4000-8000-000000000003' }],
    ['wrong Agent Session', { agentSessionId: '21000000-0000-4000-8000-000000000002' }],
    ['expired', { decidedAt: '2026-08-08T12:06:00.000Z' }],
  ])('ignores a %s decision with no effect', (_name, override) => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, exactAction);
    const [next, actions] = transition(definition.machine, pending, decision(override));
    expect(next).toBe(pending);
    expect(actions).toEqual([]);
  });

  it('keeps failed application evidence explicit and rejects duplicate or over-capacity inputs', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, exactAction);
    const [overCapacity, overCapacityActions] = transition(definition.machine, pending, {
      ...exactAction,
      providerActionId: 'provider-action-2',
    });
    expect(overCapacity).toBe(pending);
    expect(overCapacityActions).toEqual([]);

    const [applying] = transition(definition.machine, pending, decision());
    const [failed] = transition(definition.machine, applying, {
      type: 'DECISION_APPLICATION_FAILED',
      taskMonitorId: MONITOR_ID,
      interventionId: INTERVENTION_ID,
      providerActionId: 'provider-action-1',
      reason: 'provider callback failed',
    });
    expect(failed.value).toEqual({
      RUNNING: {
        control: 'ACTIVE',
        work: 'OBSERVING_RUN',
        intervention: 'APPLICATION_FAILED',
        input: 'WAITING_FOR_INPUT',
      },
    });
    expect(failed.context.pendingIntervention).toMatchObject({
      interventionId: INTERVENTION_ID,
      applicationFailure: 'provider callback failed',
      decision: { resolution: 'APPROVE' },
    });
    expect(transition(definition.machine, failed, decision())[0]).toBe(failed);
  });
});

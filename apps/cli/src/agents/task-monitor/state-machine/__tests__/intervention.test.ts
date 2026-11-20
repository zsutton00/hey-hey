import { mapCodexEvent } from '../../../providers/codex/codex-event-mapper';
import { normalizeProviderEventPayload } from '../../../providers/provider-event-normalization';
import { taskMonitorExactActionInputFromProviderEvent } from '../provider-event-adapter';
import { taskMonitorEventFromVerifiedInput } from '../events';
import { toTaskMonitorInterventionData } from '../../task-monitor-intervention-message';
import { normalizeEvent } from '../../../../run/normalize';
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

const escalation = (reason = 'The monitor cannot judge this safely.') =>
  ({
    type: 'MONITOR_PERMISSION_ESCALATED' as const,
    taskMonitorId: MONITOR_ID,
    interventionId: INTERVENTION_ID,
    providerActionId: 'provider-action-1',
    reason,
  }) satisfies TaskMonitorMachineEvent;

const monitorDecision = (
  overrides: Partial<Extract<TaskMonitorMachineEvent, { type: 'MONITOR_PERMISSION_DECIDED' }>> = {},
) =>
  ({
    type: 'MONITOR_PERMISSION_DECIDED' as const,
    taskMonitorId: MONITOR_ID,
    interventionId: INTERVENTION_ID,
    providerActionId: 'provider-action-1',
    fingerprint: 'sha256:exact-action',
    resolution: 'APPROVE' as const,
    providerDecision: 'approve' as const,
    rationale: 'The Task needs this command.',
    decidedAt: '2026-08-08T12:00:30.000Z',
    ...overrides,
  }) satisfies TaskMonitorMachineEvent;

const effectsOf = (
  definition: ReturnType<typeof createTaskMonitorDefinition>,
  actions: Parameters<ReturnType<typeof createTaskMonitorDefinition>['effectFromAction']>[0][],
) => actions.flatMap((action) => definition.effectFromAction(action) ?? []);

/** A request the monitor has handed to the human: the only state a person may decide from. */
const humanOwned = () => {
  const { definition, snapshot } = observing();
  const [pending] = transition(definition.machine, snapshot, exactAction);
  const [escalated, actions] = transition(definition.machine, pending, escalation());
  return { definition, escalated, actions };
};

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
  it.each([
    ['approves', 'APPROVE', 'approve'],
    ['denies', 'DENY', 'deny'],
  ] as const)(
    'applies a monitor decision that %s a real Codex request long after the old five-minute mark',
    (_name, resolution, providerDecision) => {
      const timestamp = exactAction.createdAt;
      const mapped = mapCodexEvent({
        provider: 'codex',
        runId: RUN_ID,
        eventType: 'item/commandExecution/requestApproval',
        timestamp,
        sessionId: 'provider-session-1',
        agentId: 'codex',
        rawEvent: {
          id: 'provider-action-1',
          params: { command: ['pnpm', 'deploy'], cwd: '/workspace' },
        },
        config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
      });
      if (!mapped.resolvedEventType) throw new Error('Expected a resolved Codex request');
      const input = taskMonitorExactActionInputFromProviderEvent(
        {
          owner: { taskMonitorId: MONITOR_ID, agentSessionId: SESSION_ID, runId: RUN_ID },
          event: {
            runId: RUN_ID,
            source: 'provider',
            eventType: mapped.resolvedEventType,
            timestamp,
            sessionId: 'provider-session-1',
            agentId: 'codex',
            payload: mapped.payload,
          },
        },
        () => INTERVENTION_ID,
        () => Date.parse(timestamp),
      );
      if (!input) throw new Error('Expected admitted input');
      expect(input.expiresAt).toBeNull();

      const { definition, snapshot } = observing();
      const [opened] = transition(
        definition.machine,
        snapshot,
        taskMonitorEventFromVerifiedInput(input),
      );
      const [applying, actions] = transition(
        definition.machine,
        opened,
        monitorDecision({
          fingerprint: input.fingerprint,
          resolution,
          providerDecision,
          decidedAt: '2026-08-08T12:30:00.000Z',
        }),
      );

      expect(applying.value).toMatchObject({ RUNNING: { intervention: 'APPLYING_DECISION' } });
      expect(effectsOf(definition, actions)).toContainEqual(
        expect.objectContaining({
          type: 'APPLY_TASK_MONITOR_DECISION',
          providerDecision,
          providerActionId: 'provider-action-1',
        }),
      );
    },
  );

  it.each([null, undefined])(
    'admits and decides a normalized Claude request with no deadline (%s)',
    (expiresAt) => {
      const timestamp = exactAction.createdAt;
      const normalized = normalizeProviderEventPayload({
        provider: 'claude',
        runId: RUN_ID,
        eventType: 'permission_request',
        timestamp,
        sessionId: 'provider-session-1',
        agentId: 'claude',
        rawEvent: {
          messageType: 'permission_request',
          permission_request: {
            id: 'provider-action-1',
            permission_type: 'Bash',
            session_id: 'provider-session-1',
            agent_id: 'claude',
            agent_type: 'claude',
            timestamp,
            idempotency_token: 'provider-action-1',
            action: 'Bash',
            target: 'pnpm deploy',
            fingerprint: 'sha256:exact-action',
            created_at: timestamp,
            ...(expiresAt === undefined ? {} : { expires_at: expiresAt }),
          },
          enrichment_metadata: {
            reason: 'Deployment requires approval',
            referenced_files: [],
            referenced_diffs: [],
          },
        },
        config: { validationMode: 'strict', maxDiffBlobBytes: 4096, trackTools: false },
      });
      const providerEvent = {
        runId: RUN_ID,
        source: 'provider' as const,
        eventType: 'permission_request_detected',
        timestamp,
        sessionId: 'provider-session-1',
        agentId: 'claude',
        payload: normalized.payload,
      };
      const handlerEvent = normalizeEvent(providerEvent, 'claude');
      expect(handlerEvent.kind).toBe('permission');
      if (handlerEvent.kind !== 'permission') throw new Error('Expected permission');
      expect(handlerEvent.taskMonitorAdmission.accepted).toBe(true);
      const input = taskMonitorExactActionInputFromProviderEvent(
        {
          owner: { taskMonitorId: MONITOR_ID, agentSessionId: SESSION_ID, runId: RUN_ID },
          event: providerEvent,
        },
        () => INTERVENTION_ID,
      );
      expect(input).not.toBeNull();
      if (!input) throw new Error('Expected admitted input');
      const { definition, snapshot } = observing();
      const [opened, openActions] = transition(
        definition.machine,
        snapshot,
        taskMonitorEventFromVerifiedInput(input),
      );
      // The request reaches the monitor first, with no deadline to reject it for.
      expect(effectsOf(definition, openActions)).toEqual([
        expect.objectContaining({
          type: 'DECIDE_TASK_MONITOR_PERMISSION',
          providerActionId: 'provider-action-1',
          expiresAt: null,
        }),
      ]);
      const [approved, approveActions] = transition(definition.machine, opened, monitorDecision());
      expect(approved.value).toMatchObject({ RUNNING: { intervention: 'APPLYING_DECISION' } });
      expect(effectsOf(definition, approveActions)).toEqual([
        expect.objectContaining({
          type: 'RECORD_TASK_MONITOR_PERMISSION_DECISION',
          decision: 'APPROVED',
        }),
        expect.objectContaining({
          type: 'APPLY_TASK_MONITOR_DECISION',
          operation: 'RELEASE_EXACT_ACTION',
          human: null,
          monitorRationale: 'The Task needs this command.',
        }),
      ]);

      const [pending, projectionActions] = transition(definition.machine, opened, escalation());
      const projection = effectsOf(definition, projectionActions).find(
        (effect) => effect.type === 'PROJECT_TASK_MONITOR_INTERVENTION',
      );
      if (projection?.type !== 'PROJECT_TASK_MONITOR_INTERVENTION')
        throw new Error('Expected projection');
      expect(toTaskMonitorInterventionData(projection)).toMatchObject({
        expiresAt: null,
        choices: ['APPROVE', 'DENY'],
      });
      // A human may decide days later, while exact-action matching and single use still apply.
      const laterDecision = decision({ decidedAt: '2026-08-15T12:00:00.000Z' });
      const [applying, actions] = transition(definition.machine, pending, laterDecision);
      expect(actions.flatMap((action) => definition.effectFromAction(action) ?? [])).toEqual([
        expect.objectContaining({
          type: 'APPLY_TASK_MONITOR_DECISION',
          providerActionId: 'provider-action-1',
          providerDecision: 'approve',
        }),
      ]);
      expect(transition(definition.machine, applying, laterDecision)[1]).toEqual([]);
    },
  );

  it('stores one monitor-owned intervention and asks the monitor, not the human', () => {
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
        owner: 'MONITOR',
        decision: null,
      },
    });
    expect(effectsOf(definition, actions)).toEqual([
      expect.objectContaining({
        type: 'DECIDE_TASK_MONITOR_PERMISSION',
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
        action: 'exec',
        target: 'pnpm deploy',
      }),
    ]);
  });

  it('hands a USER_REQUIRED request straight to the human and never to the monitor', () => {
    const { definition, snapshot } = observing();
    const [pending, actions] = transition(definition.machine, snapshot, {
      ...exactAction,
      userRequired: true,
    });

    expect(effectsOf(definition, actions)).toEqual([
      expect.objectContaining({ type: 'PROJECT_TASK_MONITOR_INTERVENTION' }),
    ]);
    expect(pending.context.pendingIntervention).toMatchObject({
      owner: 'HUMAN',
      userRequired: true,
    });
    expect(transition(definition.machine, pending, monitorDecision())[0]).toBe(pending);
  });

  it('shows the request to the human only after the monitor escalates it', () => {
    const { escalated, actions, definition } = humanOwned();

    expect(effectsOf(definition, actions)).toEqual([
      expect.objectContaining({
        type: 'RECORD_TASK_MONITOR_PERMISSION_DECISION',
        decision: 'ESCALATED',
        rationale: 'The monitor cannot judge this safely.',
      }),
      expect.objectContaining({
        type: 'PROJECT_TASK_MONITOR_INTERVENTION',
        providerActionId: 'provider-action-1',
      }),
    ]);
    expect(escalated.context.pendingIntervention).toMatchObject({
      owner: 'HUMAN',
      escalationReason: 'The monitor cannot judge this safely.',
    });
  });

  it('applies a monitor denial through the same effect as a human one', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, exactAction);
    const [, actions] = transition(
      definition.machine,
      pending,
      monitorDecision({ resolution: 'DENY', providerDecision: 'deny', rationale: 'Out of scope.' }),
    );

    expect(effectsOf(definition, actions)).toEqual([
      expect.objectContaining({
        type: 'RECORD_TASK_MONITOR_PERMISSION_DECISION',
        action: 'exec',
        target: 'pnpm deploy',
        decision: 'DENIED',
        rationale: 'Out of scope.',
      }),
      expect.objectContaining({
        type: 'APPLY_TASK_MONITOR_DECISION',
        operation: 'REJECT_EXACT_ACTION',
        providerDecision: 'deny',
        human: null,
        monitorRationale: 'Out of scope.',
      }),
    ]);
  });

  it('ignores a human decision while the monitor still owns the request', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, exactAction);

    expect(transition(definition.machine, pending, decision())[0]).toBe(pending);
  });

  it('lets the first decision win: a monitor decision after escalation is ignored', () => {
    const { definition, escalated } = humanOwned();

    expect(transition(definition.machine, escalated, monitorDecision())[0]).toBe(escalated);
  });

  it('declares exactly one release effect for a fully matching unexpired decision', () => {
    const { definition, escalated: pending } = humanOwned();
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
  ])('ignores a %s decision with no effect', (_name, override) => {
    const { definition, escalated: pending } = humanOwned();
    const [next, actions] = transition(definition.machine, pending, decision(override));
    expect(next).toBe(pending);
    expect(actions).toEqual([]);
  });

  it('keeps failed application evidence explicit and ignores a duplicate of the pending request', () => {
    const { definition, escalated: pending } = humanOwned();
    const [duplicate, duplicateActions] = transition(definition.machine, pending, exactAction);
    expect(duplicate).toBe(pending);
    expect(duplicateActions).toEqual([]);

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
  it('accepts a monitor decision at any time for a request with no deadline', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, { ...exactAction, expiresAt: null });

    const [next, actions] = transition(
      definition.machine,
      pending,
      monitorDecision({ decidedAt: '2026-08-20T12:00:00.000Z' }),
    );

    expect(next.value).toMatchObject({ RUNNING: { intervention: 'APPLYING_DECISION' } });
    expect(effectsOf(definition, actions).map((effect) => effect.type)).toEqual([
      'RECORD_TASK_MONITOR_PERMISSION_DECISION',
      'APPLY_TASK_MONITOR_DECISION',
    ]);
  });

  it('records nothing for a monitor decision the machine rejects', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, exactAction);

    const [next, actions] = transition(
      definition.machine,
      pending,
      monitorDecision({ fingerprint: 'sha256:other' }),
    );

    expect(next).toBe(pending);
    expect(actions).toEqual([]);
  });

  describe('overlapping requests', () => {
    const second = {
      ...exactAction,
      interventionId: '41000000-0000-4000-8000-000000000004',
      providerActionId: 'provider-action-2',
      fingerprint: 'sha256:second-action',
      target: 'pnpm build',
    } satisfies TaskMonitorMachineEvent;
    const secondDecision = () =>
      monitorDecision({
        interventionId: second.interventionId,
        providerActionId: second.providerActionId,
        fingerprint: second.fingerprint,
        rationale: 'The build is part of the Task.',
      });

    it('gives each of two overlapping writes its own monitor decision, never a human prompt', () => {
      const { definition, snapshot } = observing();
      const [first] = transition(definition.machine, snapshot, exactAction);

      // While the first is still with the monitor, the second waits without prompting anyone.
      const [queued, queueActions] = transition(definition.machine, first, second);
      expect(queueActions).toEqual([]);
      expect(queued.context.pendingIntervention).toMatchObject({
        providerActionId: 'provider-action-1',
        owner: 'MONITOR',
      });
      expect(queued.context.queuedInterventions).toEqual([
        expect.objectContaining({ providerActionId: 'provider-action-2' }),
      ]);

      // The first is answered; the second may even arrive while that answer is applied.
      const [applying] = transition(definition.machine, queued, monitorDecision());
      const third = { ...second, interventionId: 'ignored', providerActionId: 'provider-action-3' };
      const [applyingWithThird] = transition(definition.machine, applying, third);
      expect(applyingWithThird.context.queuedInterventions).toHaveLength(2);

      const [next, nextActions] = transition(definition.machine, applyingWithThird, {
        type: 'DECISION_APPLIED',
        taskMonitorId: MONITOR_ID,
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
      });

      // The next request in arrival order now goes to the monitor, and only to the monitor.
      expect(next.value).toMatchObject({ RUNNING: { intervention: 'PENDING' } });
      expect(next.context.pendingIntervention).toMatchObject({
        providerActionId: 'provider-action-2',
        owner: 'MONITOR',
        decision: null,
      });
      expect(next.context.queuedInterventions).toEqual([
        expect.objectContaining({ providerActionId: 'provider-action-3' }),
      ]);
      expect(effectsOf(definition, nextActions)).toEqual([
        expect.objectContaining({
          type: 'DECIDE_TASK_MONITOR_PERMISSION',
          providerActionId: 'provider-action-2',
          target: 'pnpm build',
        }),
      ]);

      const [decided, decidedActions] = transition(definition.machine, next, secondDecision());
      expect(decided.value).toMatchObject({ RUNNING: { intervention: 'APPLYING_DECISION' } });
      expect(effectsOf(definition, decidedActions)).toEqual([
        expect.objectContaining({
          type: 'RECORD_TASK_MONITOR_PERMISSION_DECISION',
          providerActionId: 'provider-action-2',
        }),
        expect.objectContaining({
          type: 'APPLY_TASK_MONITOR_DECISION',
          providerActionId: 'provider-action-2',
        }),
      ]);
    });

    it('hands a queued USER_REQUIRED request to the human only when its turn comes', () => {
      const { definition, snapshot } = observing();
      const [first] = transition(definition.machine, snapshot, exactAction);
      const [queued] = transition(definition.machine, first, { ...second, userRequired: true });
      const [applying] = transition(definition.machine, queued, monitorDecision());

      const [next, actions] = transition(definition.machine, applying, {
        type: 'DECISION_APPLIED',
        taskMonitorId: MONITOR_ID,
        interventionId: INTERVENTION_ID,
        providerActionId: 'provider-action-1',
      });

      expect(next.context.pendingIntervention).toMatchObject({
        providerActionId: 'provider-action-2',
        owner: 'HUMAN',
        userRequired: true,
      });
      expect(effectsOf(definition, actions).map((effect) => effect.type)).toEqual([
        'PROJECT_TASK_MONITOR_INTERVENTION',
      ]);
    });
  });
});

describe('Task Monitor Service scope request', () => {
  const serviceScopeRequest = {
    ...exactAction,
    providerActionId: 'scope-request-1',
    action: 'Give the coding session access to additional project Services',
    target: 'Services: API. Reason given: The Task also changes the API.',
    fingerprint: 'service-scope:abc',
    requestKind: 'SERVICE_SCOPE',
  } satisfies TaskMonitorMachineEvent;

  it('is decided by the monitor and answered by its own owner when approved', () => {
    const { definition, snapshot } = observing();
    const [pending, opened] = transition(definition.machine, snapshot, serviceScopeRequest);

    expect(effectsOf(definition, opened)).toEqual([
      expect.objectContaining({
        type: 'DECIDE_TASK_MONITOR_PERMISSION',
        providerActionId: 'scope-request-1',
        requestKind: 'SERVICE_SCOPE',
      }),
    ]);

    const [, applied] = transition(
      definition.machine,
      pending,
      monitorDecision({ providerActionId: 'scope-request-1', fingerprint: 'service-scope:abc' }),
    );
    expect(effectsOf(definition, applied)).toContainEqual(
      expect.objectContaining({
        type: 'APPLY_TASK_MONITOR_DECISION',
        providerActionId: 'scope-request-1',
        requestKind: 'SERVICE_SCOPE',
      }),
    );
  });

  it('is not shown a second time when the monitor escalates it, and frees the next request', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, serviceScopeRequest);
    const [queued] = transition(definition.machine, pending, {
      ...exactAction,
      interventionId: '40000000-0000-4000-8000-000000000005',
      providerActionId: 'provider-action-2',
    });

    const [next, actions] = transition(definition.machine, queued, {
      ...escalation('Widens access beyond the Task.'),
      providerActionId: 'scope-request-1',
    });

    expect(effectsOf(definition, actions).map((effect) => effect.type)).toEqual([
      'RECORD_TASK_MONITOR_PERMISSION_DECISION',
      'DECIDE_TASK_MONITOR_PERMISSION',
    ]);
    expect(next.context.pendingIntervention).toMatchObject({
      providerActionId: 'provider-action-2',
      owner: 'MONITOR',
    });
  });

  it('does not let a paused monitor decide a new request: the person keeps the existing card', () => {
    const definition = createTaskMonitorDefinition();
    const paused = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'PAUSED',
          work: 'OBSERVING_RUN',
          intervention: 'CLEAR',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context: context(),
    });

    const [next, actions] = transition(definition.machine, paused, serviceScopeRequest);

    expect(effectsOf(definition, actions)).toEqual([]);
    expect(next.context.pendingIntervention).toBeNull();
  });

  it('hands a queued request to the person when the monitor was paused before its turn came', () => {
    const { definition, snapshot } = observing();
    const [first] = transition(definition.machine, snapshot, exactAction);
    const [queued] = transition(definition.machine, first, {
      ...serviceScopeRequest,
      interventionId: '40000000-0000-4000-8000-000000000005',
    });
    const [applying] = transition(definition.machine, queued, monitorDecision());
    const paused = definition.machine.resolveState({
      value: {
        RUNNING: {
          control: 'PAUSED',
          work: 'OBSERVING_RUN',
          intervention: 'APPLYING_DECISION',
          input: 'WAITING_FOR_INPUT',
        },
      },
      context: applying.context,
    });

    const [next, actions] = transition(definition.machine, paused, {
      type: 'DECISION_APPLIED',
      taskMonitorId: MONITOR_ID,
      interventionId: INTERVENTION_ID,
      providerActionId: 'provider-action-1',
    });

    // The request leaves the queue and goes to the person without the paused monitor being asked.
    expect(next.context.queuedInterventions).toEqual([]);
    expect(next.context.pendingIntervention).toMatchObject({
      providerActionId: 'scope-request-1',
      requestKind: 'SERVICE_SCOPE',
    });
    expect(effectsOf(definition, actions)).toEqual([
      expect.objectContaining({
        type: 'DECIDE_TASK_MONITOR_PERMISSION',
        providerActionId: 'scope-request-1',
        monitorPaused: true,
      }),
    ]);
  });

  it('gives a decision the Run could not finish applying back to the person instead of stalling', () => {
    const { definition, snapshot } = observing();
    const [pending] = transition(definition.machine, snapshot, serviceScopeRequest);
    const [applying] = transition(
      definition.machine,
      pending,
      monitorDecision({ providerActionId: 'scope-request-1', fingerprint: 'service-scope:abc' }),
    );

    const [next] = transition(definition.machine, applying, {
      type: 'DECISION_APPLICATION_FAILED',
      taskMonitorId: MONITOR_ID,
      interventionId: INTERVENTION_ID,
      providerActionId: 'scope-request-1',
      reason: 'local persistence failed',
    });

    expect(next.context.pendingIntervention).toBeNull();
    expect(next.matches({ RUNNING: { intervention: 'CLEAR' } })).toBe(true);
  });
});

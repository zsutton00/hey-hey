import { describe, expect, it, vi } from 'vitest';

import {
  createNoopMessagePoster,
  createTestRunRegistryWiring,
} from '../../../../server/__tests__/helpers/test-run-registry';
import { NOOP_LOGGER } from '../../../../server/logger';
import type { EffectExecutionIdentity } from '../../../../state-machine';
import { toTaskMonitorInterventionData } from '../../task-monitor-intervention-message';
import type {
  ApplyTaskMonitorDecisionEffect,
  DecideTaskMonitorPermissionEffect,
  ProjectTaskMonitorInterventionEffect,
  WatchTaskMonitorPermissionDeadlineEffect,
} from '../effects';
import {
  TaskMonitorDecisionApplicationEffectHandler,
  TaskMonitorInterventionProjectionEffectHandler,
  TaskMonitorPermissionDeadlineEffectHandler,
  TaskMonitorPermissionDecisionEffectHandler,
  TaskMonitorPermissionRecordEffectHandler,
} from '../intervention-effect-handlers';
import type { TaskMonitorCoordinatorRunner } from '../../../../server/monitors/runner';
import { TaskMonitorManagedTurnRuntime } from '../../../../server/task-monitor-managed-turn-runtime';
import {
  TaskMonitorDecisionStore,
  type TaskMonitorDecisionResult,
} from '../../task-monitor-decision-store';

const execution: EffectExecutionIdentity = {
  machineType: 'TASK_MONITOR',
  instanceId: '10000000-0000-4000-8000-000000000001',
  effectId: 'effect-1',
};

const projection: ProjectTaskMonitorInterventionEffect = {
  type: 'PROJECT_TASK_MONITOR_INTERVENTION',
  taskMonitorId: execution.instanceId,
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  conversationId: '40000000-0000-4000-8000-000000000004',
  interventionId: '50000000-0000-4000-8000-000000000005',
  providerActionId: 'provider-action-1',
  runId: 'run-1',
  agentSessionId: '60000000-0000-4000-8000-000000000006',
  action: 'write_file',
  target: 'src/example.ts',
  fingerprint: 'fingerprint-1',
  createdAt: '2026-08-09T12:00:00.000Z',
  expiresAt: '2026-08-09T12:05:00.000Z',
};

const decision: ApplyTaskMonitorDecisionEffect = {
  type: 'APPLY_TASK_MONITOR_DECISION',
  operation: 'RELEASE_EXACT_ACTION',
  providerDecision: 'approve',
  taskMonitorId: projection.taskMonitorId,
  interventionId: projection.interventionId,
  providerActionId: projection.providerActionId,
  providerSessionId: 'provider-session-1',
  runId: projection.runId,
  agentSessionId: projection.agentSessionId,
  action: projection.action,
  target: projection.target,
  fingerprint: projection.fingerprint,
  decidedAt: '2026-08-09T12:01:00.000Z',
  human: { userId: 'user-1', authenticatedAt: '2026-08-09T12:01:00.000Z' },
  monitorRationale: null,
};

const decideEffect: DecideTaskMonitorPermissionEffect = {
  type: 'DECIDE_TASK_MONITOR_PERMISSION',
  taskMonitorId: projection.taskMonitorId,
  organizationId: projection.organizationId,
  projectId: projection.projectId,
  conversationId: projection.conversationId,
  interventionId: projection.interventionId,
  providerActionId: projection.providerActionId,
  runId: projection.runId,
  agentSessionId: projection.agentSessionId,
  action: projection.action,
  target: projection.target,
  fingerprint: projection.fingerprint,
  createdAt: projection.createdAt,
  expiresAt: null,
};

describe('Task Monitor intervention projection', () => {
  it('builds a generated intervention payload whose choices serialize as a JSON array', () => {
    const data = toTaskMonitorInterventionData(projection);

    expect(data.type).toBe('TASK_MONITOR_INTERVENTION');
    expect(data.choices).toEqual(['APPROVE', 'DENY']);
    expect(JSON.parse(JSON.stringify(data))).toMatchObject({ choices: ['APPROVE', 'DENY'] });
  });

  it('posts through MessagePoster and returns the projection identity', async () => {
    const poster = createNoopMessagePoster();
    const handler = new TaskMonitorInterventionProjectionEffectHandler(poster, NOOP_LOGGER);

    await expect(handler.execute(projection, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'INTERVENTION_PROJECTED',
        interventionId: projection.interventionId,
        providerActionId: projection.providerActionId,
      },
    });
    expect(poster.createOutOfBand).toHaveBeenCalledOnce();
  });
});

describe('Task Monitor decision application', () => {
  it('coalesces replay by committed effect identity and supplies it as provider idempotency', async () => {
    const registry = createTestRunRegistryWiring().runRegistry;
    vi.spyOn(registry, 'get').mockReturnValue({
      agentSessionId: decision.agentSessionId,
      provider: 'codex',
    } as never);
    const submit = vi
      .spyOn(registry, 'submitPermissionDecision')
      .mockResolvedValue({ outcome: 'delivered', callbackType: 'codex_exec_approval_response' });
    const handler = new TaskMonitorDecisionApplicationEffectHandler(registry, NOOP_LOGGER);

    const first = handler.execute(decision, execution);
    const replay = handler.execute(decision, execution);
    expect(replay).toBe(first);
    await expect(first).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'DECISION_APPLIED' },
    });
    expect(submit).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledWith(
      decision.runId,
      expect.objectContaining({
        sessionId: decision.providerSessionId,
        requestId: decision.providerActionId,
        idempotencyToken: execution.effectId,
      }),
    );

    await handler.execute(decision, execution);
    expect(submit).toHaveBeenCalledTimes(2);
  });

  describe('for a Service scope request', () => {
    const serviceScopeDecision: ApplyTaskMonitorDecisionEffect = {
      ...decision,
      requestKind: 'SERVICE_SCOPE',
      human: null,
      monitorRationale: 'The Task needs the API Service.',
    };
    const registryWithOwner = (decideByMonitor: ReturnType<typeof vi.fn>) => {
      const registry = createTestRunRegistryWiring().runRegistry;
      vi.spyOn(registry, 'get').mockReturnValue({
        agentSessionId: decision.agentSessionId,
        provider: 'codex',
        serviceScopeCoordinator: { decideByMonitor },
      } as never);
      const providerPath = vi.spyOn(registry, 'submitPermissionDecision');
      return { registry, providerPath };
    };

    it('is decided by the Service scope owner and never through the provider permission path', async () => {
      const decideByMonitor = vi.fn(async () => ({
        outcome: 'delivered' as const,
        callbackType: 'service_scope_decision' as const,
      }));
      const { registry, providerPath } = registryWithOwner(decideByMonitor);

      await expect(
        new TaskMonitorDecisionApplicationEffectHandler(registry, NOOP_LOGGER).execute(
          serviceScopeDecision,
          execution,
        ),
      ).resolves.toMatchObject({ status: 'succeeded', outcome: { type: 'DECISION_APPLIED' } });

      expect(decideByMonitor).toHaveBeenCalledWith({
        requestId: decision.providerActionId,
        decision: 'approve',
        reason: null,
      });
      expect(providerPath).not.toHaveBeenCalled();
    });

    it('carries the monitor’s rationale as the denial reason', async () => {
      const decideByMonitor = vi.fn(async () => ({
        outcome: 'delivered' as const,
        callbackType: 'service_scope_decision' as const,
      }));
      const { registry } = registryWithOwner(decideByMonitor);

      await new TaskMonitorDecisionApplicationEffectHandler(registry, NOOP_LOGGER).execute(
        {
          ...serviceScopeDecision,
          operation: 'REJECT_EXACT_ACTION',
          providerDecision: 'deny',
          monitorRationale: 'Not needed for this Task.',
        },
        execution,
      );

      expect(decideByMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: 'deny',
          reason: 'Denied by Task Monitor: Not needed for this Task.',
        }),
      );
    });

    it.each([
      ['dropped', 'service_scope_request_not_found', 'DECISION_APPLICATION_STALE'],
      [
        'failed',
        'Approved Service scope continuation is unavailable.',
        'DECISION_APPLICATION_FAILED',
      ],
    ] as const)(
      'reports a %s decision with its specific cause',
      async (outcome, reason, outcomeType) => {
        const { registry } = registryWithOwner(vi.fn(async () => ({ outcome, reason })));

        await expect(
          new TaskMonitorDecisionApplicationEffectHandler(registry, NOOP_LOGGER).execute(
            serviceScopeDecision,
            execution,
          ),
        ).resolves.toMatchObject({ outcome: { type: outcomeType, reason } });
      },
    );

    it('reports a thrown decision as failed with its cause', async () => {
      const { registry } = registryWithOwner(
        vi.fn(async () => {
          throw new Error('platform grant exploded');
        }),
      );

      await expect(
        new TaskMonitorDecisionApplicationEffectHandler(registry, NOOP_LOGGER).execute(
          serviceScopeDecision,
          execution,
        ),
      ).resolves.toMatchObject({
        outcome: { type: 'DECISION_APPLICATION_FAILED', reason: 'platform grant exploded' },
      });
    });
  });

  it.each([
    ['no_run_registered', 'failed', 'DECISION_APPLICATION_STALE'],
    ['cancelled by provider', 'cancelled', 'DECISION_APPLICATION_CANCELLED'],
    ['transport closed', 'uncertain', 'DECISION_APPLICATION_UNCERTAIN'],
    ['permission denied internally', 'failed', 'DECISION_APPLICATION_FAILED'],
  ] as const)('classifies %s as %s', async (reason, status, outcomeType) => {
    const registry = createTestRunRegistryWiring().runRegistry;
    vi.spyOn(registry, 'get').mockReturnValue({
      agentSessionId: decision.agentSessionId,
      provider: 'codex',
    } as never);
    vi.spyOn(registry, 'submitPermissionDecision').mockResolvedValue({
      outcome: reason === 'no_run_registered' ? 'dropped' : 'failed',
      reason,
    });

    await expect(
      new TaskMonitorDecisionApplicationEffectHandler(registry, NOOP_LOGGER).execute(
        decision,
        execution,
      ),
    ).resolves.toMatchObject({ status, outcome: { type: outcomeType, reason } });
  });

  it('preserves an existing persistent provider decision through durable application', async () => {
    const registry = createTestRunRegistryWiring().runRegistry;
    vi.spyOn(registry, 'get').mockReturnValue({
      agentSessionId: decision.agentSessionId,
      provider: 'codex',
    } as never);
    const submit = vi
      .spyOn(registry, 'submitPermissionDecision')
      .mockResolvedValue({ outcome: 'delivered', callbackType: 'codex_exec_approval_response' });

    await new TaskMonitorDecisionApplicationEffectHandler(registry, NOOP_LOGGER).execute(
      { ...decision, providerDecision: 'always_approve' },
      execution,
    );

    expect(submit).toHaveBeenCalledWith(
      decision.runId,
      expect.objectContaining({ decision: 'always_approve' }),
    );
  });
});

describe('Task Monitor permission decision', () => {
  const COORDINATOR_RUN_ID = 'coordinator-run-1';

  /** The monitor agent is the boundary: it answers through the real decision store, as the handler does. */
  const withMonitorAnswer = (
    answer: TaskMonitorDecisionResult | Error,
    registry = createTestRunRegistryWiring().runRegistry,
  ) => {
    const store = new TaskMonitorDecisionStore(
      NOOP_LOGGER,
      new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
    );
    const runTaskMonitor = vi.fn(
      async (command: { correlationId: string; coordinatorAttemptId?: string }) => {
        if (answer instanceof Error) {
          throw answer;
        }
        store.bind(COORDINATOR_RUN_ID, command.correlationId, command.coordinatorAttemptId);
        queueMicrotask(() => {
          if (answer.status !== 'TURN_SETTLED') {
            store.publish(COORDINATOR_RUN_ID, answer, command.coordinatorAttemptId);
          }
        });
        return { runId: COORDINATOR_RUN_ID, coordinatorAgentSessionId: 'coordinator-session-1' };
      },
    );
    const handler = new TaskMonitorPermissionDecisionEffectHandler(
      { runTaskMonitor } as unknown as TaskMonitorCoordinatorRunner,
      store,
      registry,
      NOOP_LOGGER,
      () => Date.parse('2026-08-09T12:00:30.000Z'),
    );
    return { handler, runTaskMonitor };
  };

  const serviceScopeEffect: DecideTaskMonitorPermissionEffect = {
    ...decideEffect,
    action: 'Give the coding session access to additional project Services',
    target: 'Services: API. Reason given: The implementation also requires the API Service.',
    requestKind: 'SERVICE_SCOPE',
  };

  it('moves a Service scope request to the person, on its own Run, when the monitor escalates it', async () => {
    const registry = createTestRunRegistryWiring().runRegistry;
    const handToHuman = vi.fn();
    vi.spyOn(registry, 'get').mockReturnValue({
      agentSessionId: serviceScopeEffect.agentSessionId,
      serviceScopeCoordinator: { handToHuman },
    } as never);
    const { handler } = withMonitorAnswer(
      {
        status: 'DECISION',
        decision: { action: 'ESCALATE_PERMISSION', rationale: 'Widens access beyond the Task.' },
      },
      registry,
    );

    await expect(handler.execute(serviceScopeEffect, execution)).resolves.toMatchObject({
      outcome: { type: 'MONITOR_PERMISSION_ESCALATED' },
    });

    expect(handToHuman).toHaveBeenCalledWith(
      serviceScopeEffect.providerActionId,
      'Widens access beyond the Task.',
    );
  });

  it('leaves a provider permission escalation to the machine, not the Service scope owner', async () => {
    const registry = createTestRunRegistryWiring().runRegistry;
    const get = vi.spyOn(registry, 'get');
    const { handler } = withMonitorAnswer(
      { status: 'DECISION', decision: { action: 'ESCALATE_PERMISSION', rationale: 'Unsure.' } },
      registry,
    );

    await handler.execute(decideEffect, execution);

    expect(get).not.toHaveBeenCalled();
  });

  it('asks the monitor with the exact request, even when the provider sent no expiry', async () => {
    const { handler, runTaskMonitor } = withMonitorAnswer({
      status: 'DECISION',
      decision: { action: 'APPROVE_PERMISSION', rationale: 'The Task edits this file.' },
    });

    await handler.execute(decideEffect, execution);

    expect(runTaskMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        monitorId: decideEffect.taskMonitorId,
        cause: 'PERMISSION_REQUEST',
        monitoredPermissionRequest: expect.objectContaining({
          action: 'write_file',
          target: 'src/example.ts',
          fingerprint: 'fingerprint-1',
          expiresAt: null,
        }),
      }),
      { organizationId: decideEffect.organizationId, projectId: decideEffect.projectId },
    );
  });

  it.each([
    ['APPROVE_PERMISSION', 'APPROVE', 'approve'],
    ['DENY_PERMISSION', 'DENY', 'deny'],
  ] as const)('turns %s into a decision', async (action, resolution, providerDecision) => {
    const { handler } = withMonitorAnswer({
      status: 'DECISION',
      decision: { action, rationale: 'Decided from the Task.' },
    });

    await expect(handler.execute(decideEffect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'MONITOR_PERMISSION_DECIDED',
        resolution,
        providerDecision,
        rationale: 'Decided from the Task.',
        fingerprint: 'fingerprint-1',
      },
    });
  });

  it('hands a request the monitor never answers to the human, with the reason and time', async () => {
    const store = new TaskMonitorDecisionStore(
      NOOP_LOGGER,
      new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
    );
    const runTaskMonitor = vi.fn(
      (command: { correlationId: string; coordinatorAttemptId?: string }) => {
        store.bind(COORDINATOR_RUN_ID, command.correlationId, command.coordinatorAttemptId);
        return Promise.resolve({
          runId: COORDINATOR_RUN_ID,
          coordinatorAgentSessionId: 'coordinator-session-1',
        });
      },
    );
    const handler = new TaskMonitorPermissionDecisionEffectHandler(
      { runTaskMonitor } as unknown as TaskMonitorCoordinatorRunner,
      store,
      createTestRunRegistryWiring().runRegistry,
      NOOP_LOGGER,
      () => Date.parse('2026-08-09T12:00:30.000Z'),
    );

    await expect(
      handler.execute({ ...decideEffect, dueAt: '2026-08-09T12:00:30.020Z' }, execution),
    ).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'MONITOR_PERMISSION_ESCALATED',
        reason: expect.stringContaining('no decision arrived'),
        escalatedAt: '2026-08-09T12:00:30.000Z',
      },
    });
  });

  it('hands the request to the human with the monitor’s reason when it escalates', async () => {
    const { handler } = withMonitorAnswer({
      status: 'DECISION',
      decision: { action: 'ESCALATE_PERMISSION', rationale: 'Deploys to production.' },
    });

    await expect(handler.execute(decideEffect, execution)).resolves.toMatchObject({
      outcome: { type: 'MONITOR_PERMISSION_ESCALATED', reason: 'Deploys to production.' },
    });
  });

  it.each([
    ['an invalid answer', { status: 'INVALID', reason: 'not json' } as const, 'invalid'],
    [
      'an action that does not decide a permission',
      { status: 'DECISION', decision: { action: 'WAIT', rationale: 'later' } } as const,
      'WAIT',
    ],
    ['a failed start', new Error('provider unavailable'), 'provider unavailable'],
  ])('escalates with the cause when the monitor gives %s', async (_name, answer, cause) => {
    const { handler } = withMonitorAnswer(answer);

    const result = await handler.execute(decideEffect, execution);

    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: { type: 'MONITOR_PERMISSION_ESCALATED' },
    });
    expect(JSON.stringify(result)).toContain(cause);
  });
});

describe('Task Monitor permission deadline', () => {
  const watchEffect: WatchTaskMonitorPermissionDeadlineEffect = {
    type: 'WATCH_TASK_MONITOR_PERMISSION_DEADLINE',
    taskMonitorId: decideEffect.taskMonitorId,
    interventionId: decideEffect.interventionId,
    providerActionId: decideEffect.providerActionId,
    runId: decideEffect.runId,
    agentSessionId: decideEffect.agentSessionId,
    dueAt: '2026-08-09T12:00:30.000Z',
  };

  it('hands the request to the person at once when its due time passed while nothing ran, such as after a restart', async () => {
    const handler = new TaskMonitorPermissionDeadlineEffectHandler(
      createTestRunRegistryWiring().runRegistry,
      NOOP_LOGGER,
      () => Date.parse('2026-08-09T12:10:00.000Z'),
    );

    await expect(handler.execute(watchEffect, execution)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'MONITOR_PERMISSION_ESCALATED',
        interventionId: watchEffect.interventionId,
        providerActionId: watchEffect.providerActionId,
        reason: expect.stringContaining('did not decide'),
        escalatedAt: '2026-08-09T12:10:00.000Z',
      },
    });
  });

  it('hands the request to the person once its due time arrives, whatever the monitor is doing', async () => {
    let clock = Date.parse('2026-08-09T12:00:29.980Z');
    const handler = new TaskMonitorPermissionDeadlineEffectHandler(
      createTestRunRegistryWiring().runRegistry,
      NOOP_LOGGER,
      () => {
        const value = clock;
        clock += 20;
        return value;
      },
    );

    await expect(handler.execute(watchEffect, execution)).resolves.toMatchObject({
      outcome: { type: 'MONITOR_PERMISSION_ESCALATED' },
    });
  });
});

describe('Task Monitor permission decision record', () => {
  const recordEffect = {
    type: 'RECORD_TASK_MONITOR_PERMISSION_DECISION',
    taskMonitorId: decideEffect.taskMonitorId,
    organizationId: decideEffect.organizationId,
    projectId: decideEffect.projectId,
    conversationId: 'conversation-1',
    interventionId: decideEffect.interventionId,
    providerActionId: decideEffect.providerActionId,
    action: 'write_file',
    target: 'src/example.ts',
    decision: 'APPROVED',
    rationale: 'Decided from the Task.',
  } as const;

  it.each(['APPROVED', 'DENIED', 'ESCALATED'] as const)(
    'records action, target, outcome and rationale for %s',
    async (decision) => {
      const poster = createNoopMessagePoster();

      await expect(
        new TaskMonitorPermissionRecordEffectHandler(poster, NOOP_LOGGER).execute(
          { ...recordEffect, decision },
          execution,
        ),
      ).resolves.toMatchObject({
        status: 'succeeded',
        outcome: { type: 'PERMISSION_DECISION_RECORDED' },
      });
      expect(vi.mocked(poster.createOutOfBand).mock.calls[0]?.[0].dto.data).toMatchObject({
        type: 'TASK_MONITOR_SUPERVISION',
        outcome: 'PERMISSION_DECIDED',
        action: 'write_file',
        target: 'src/example.ts',
        decision,
        rationale: 'Decided from the Task.',
      });
    },
  );

  it('reports a failed post to the machine with its cause instead of dropping it', async () => {
    const poster = createNoopMessagePoster();
    vi.mocked(poster.createOutOfBand).mockRejectedValue(new Error('post failed'));

    await expect(
      new TaskMonitorPermissionRecordEffectHandler(poster, NOOP_LOGGER).execute(
        recordEffect,
        execution,
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      outcome: { type: 'PERMISSION_DECISION_RECORD_FAILED', reason: 'post failed' },
    });
  });
});

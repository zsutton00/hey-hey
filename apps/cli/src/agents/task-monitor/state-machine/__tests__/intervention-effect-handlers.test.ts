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
  ProjectTaskMonitorInterventionEffect,
} from '../effects';
import {
  TaskMonitorDecisionApplicationEffectHandler,
  TaskMonitorInterventionProjectionEffectHandler,
} from '../intervention-effect-handlers';

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

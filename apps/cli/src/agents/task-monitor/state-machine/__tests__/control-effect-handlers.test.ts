import { describe, expect, it, vi } from 'vitest';

import { RunStore } from '../../../../run-store';
import { createTestLocalAgentService } from '../../../../server/local-agent-service.test-support';
import { NOOP_LOGGER } from '../../../../server/logger';
import { createTestPlatformAuthContext } from '../../../../server/monitors/test-owners.test-support';
import { TaskMonitorStartRuntime } from '../../../../server/task-monitor-start';
import {
  TaskMonitorControlEffectHandler,
  TaskMonitorControlStatusProjectionEffectHandler,
} from '../control-effect-handlers';
import type {
  HaltTaskMonitorControlEffect,
  ProjectTaskMonitorControlStatusEffect,
} from '../effects';

const effect: HaltTaskMonitorControlEffect = {
  type: 'HALT_TASK_MONITOR_CONTROL',
  taskMonitorId: '10000000-0000-4000-8000-000000000001',
  organizationId: '20000000-0000-4000-8000-000000000002',
  projectId: '30000000-0000-4000-8000-000000000003',
  activeRunAgentSessionId: '40000000-0000-4000-8000-000000000004',
  failureContext: 'Stopped by user.',
};

const projectionEffect: ProjectTaskMonitorControlStatusEffect = {
  type: 'PROJECT_TASK_MONITOR_CONTROL_STATUS',
  taskMonitorId: effect.taskMonitorId,
  organizationId: effect.organizationId,
  projectId: effect.projectId,
  status: 'ON_HOLD',
};

const makeRuntime = (): TaskMonitorStartRuntime => {
  const runtime = new TaskMonitorStartRuntime({
    apiBaseUrl: 'http://localhost:3847',
    fetchImpl: vi.fn(),
    authContext: createTestPlatformAuthContext({
      accessToken: 'token',
      organizationId: effect.organizationId,
      projectId: effect.projectId,
      userId: 'user-1',
    }),
    logger: NOOP_LOGGER,
  });
  vi.spyOn(runtime, 'haltMonitor').mockResolvedValue({ status: 'halted' });
  return runtime;
};

const makeHarness = (runId: string | null = 'local-run-1') => {
  const runtime = makeRuntime();
  const runStore = new RunStore();
  vi.spyOn(runStore, 'lookupByAgentSessionId').mockReturnValue(runId);
  const agentService = createTestLocalAgentService();
  vi.spyOn(agentService, 'stopRun').mockResolvedValue(undefined);
  return {
    runtime,
    runStore,
    agentService,
    handler: new TaskMonitorControlEffectHandler(runtime, runStore, agentService, NOOP_LOGGER),
  };
};

const makeProjectionHarness = (initialStatus = 'ACTIVE') => {
  let status = initialStatus;
  const runtime = new TaskMonitorStartRuntime({
    apiBaseUrl: 'http://localhost:3847',
    fetchImpl: vi.fn(),
    authContext: createTestPlatformAuthContext({
      accessToken: 'token',
      organizationId: effect.organizationId,
      projectId: effect.projectId,
      userId: 'user-1',
    }),
    logger: NOOP_LOGGER,
  });
  const monitor = () => ({
    id: effect.taskMonitorId,
    name: 'Task Monitor',
    organizationId: effect.organizationId,
    projectId: effect.projectId,
    status,
    definition: {
      executionPlan: [],
      launchPolicy: { terminalSupervision: { mode: 'AGENT_DECIDES' as const } },
      cursor: 0,
      status: 'NOT_STARTED' as const,
    },
  });
  vi.spyOn(runtime, 'readMonitor').mockImplementation(async () => monitor() as never);
  const persistMonitorStatus = vi
    .spyOn(runtime, 'persistMonitorStatus')
    .mockImplementation(async ({ status: nextStatus }) => {
      status = nextStatus;
      return monitor() as never;
    });
  return {
    runtime,
    persistMonitorStatus,
    setStatus: (nextStatus: string) => {
      status = nextStatus;
    },
    handler: new TaskMonitorControlStatusProjectionEffectHandler(runtime, NOOP_LOGGER),
  };
};

describe('TaskMonitorControlEffectHandler', () => {
  it('projects halt before interrupting only the recorded active Run', async () => {
    const harness = makeHarness();

    await expect(harness.handler.execute(effect)).resolves.toEqual({
      status: 'succeeded',
      outcome: {
        type: 'TASK_MONITOR_STOP_SUCCEEDED',
        taskMonitorId: effect.taskMonitorId,
      },
    });
    expect(harness.runtime.haltMonitor).toHaveBeenCalledWith({
      monitorId: effect.taskMonitorId,
      organizationId: effect.organizationId,
      projectId: effect.projectId,
      failureContext: effect.failureContext,
    });
    expect(harness.runStore.lookupByAgentSessionId).toHaveBeenCalledWith(
      effect.activeRunAgentSessionId,
    );
    expect(harness.agentService.stopRun).toHaveBeenCalledWith('local-run-1');
    expect(vi.mocked(harness.runtime.haltMonitor).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(harness.agentService.stopRun).mock.invocationCallOrder[0]!,
    );
  });

  it('treats no recorded or locally present active Run as successful', async () => {
    const noRecordedRun = makeHarness();
    await expect(
      noRecordedRun.handler.execute({ ...effect, activeRunAgentSessionId: null }),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(noRecordedRun.runStore.lookupByAgentSessionId).not.toHaveBeenCalled();
    expect(noRecordedRun.agentService.stopRun).not.toHaveBeenCalled();

    const noLocalRun = makeHarness(null);
    await expect(noLocalRun.handler.execute(effect)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(noLocalRun.agentService.stopRun).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'settled failure',
      error: Object.assign(new Error('invalid monitor owner'), { response: { status: 403 } }),
      status: 'failed',
      outcomeType: 'TASK_MONITOR_STOP_FAILED',
    },
    {
      name: 'cancellation',
      error: Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      status: 'cancelled',
      outcomeType: 'TASK_MONITOR_STOP_CANCELLED',
    },
    {
      name: 'uncertainty',
      error: new Error('connection reset'),
      status: 'uncertain',
      outcomeType: 'TASK_MONITOR_STOP_UNCERTAIN',
    },
  ])('classifies $name without mutating machine state', async ({ error, status, outcomeType }) => {
    const harness = makeHarness();
    vi.mocked(harness.runtime.haltMonitor).mockRejectedValueOnce(error);

    await expect(harness.handler.execute(effect)).resolves.toMatchObject({
      status,
      outcome: { type: outcomeType, taskMonitorId: effect.taskMonitorId, reason: error.message },
    });
    expect(harness.agentService.stopRun).not.toHaveBeenCalled();
  });

  it('reconciles an interrupted claim without repeating terminal owner calls', async () => {
    const harness = makeHarness();

    expect(harness.handler.recovery.strategy).toBe('reconcile');
    if (harness.handler.recovery.strategy !== 'reconcile') {
      throw new Error('Expected reconcile recovery.');
    }
    await expect(harness.handler.recovery.reconcile(effect)).resolves.toMatchObject({
      status: 'uncertain',
      outcome: { type: 'TASK_MONITOR_STOP_UNCERTAIN' },
    });
    expect(harness.runtime.haltMonitor).not.toHaveBeenCalled();
    expect(harness.agentService.stopRun).not.toHaveBeenCalled();
  });
});

describe('TaskMonitorControlStatusProjectionEffectHandler', () => {
  it('reconciles the canonical status once across duplicate delivery and recovery', async () => {
    const harness = makeProjectionHarness();

    await expect(harness.handler.execute(projectionEffect)).resolves.toEqual({
      status: 'succeeded',
      outcome: {
        type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED',
        taskMonitorId: projectionEffect.taskMonitorId,
        status: 'ON_HOLD',
      },
    });
    await expect(harness.handler.execute(projectionEffect)).resolves.toMatchObject({
      status: 'succeeded',
    });
    await expect(harness.handler.recovery.reconcile(projectionEffect)).resolves.toMatchObject({
      status: 'succeeded',
    });
    expect(harness.persistMonitorStatus).toHaveBeenCalledOnce();
    expect(harness.persistMonitorStatus).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ON_HOLD' }),
    );
  });

  it.each([
    {
      name: 'settled failure',
      error: Object.assign(new Error('invalid monitor owner'), { response: { status: 403 } }),
      status: 'failed',
      outcomeType: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_FAILED',
    },
    {
      name: 'cancellation',
      error: Object.assign(new Error('cancelled'), { name: 'AbortError' }),
      status: 'cancelled',
      outcomeType: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_CANCELLED',
    },
    {
      name: 'uncertainty',
      error: new Error('connection reset'),
      status: 'uncertain',
      outcomeType: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN',
    },
  ])(
    'classifies $name without mutating canonical state',
    async ({ error, status, outcomeType }) => {
      const harness = makeProjectionHarness();
      vi.mocked(harness.runtime.readMonitor).mockRejectedValueOnce(error);

      await expect(harness.handler.execute(projectionEffect)).resolves.toMatchObject({
        status,
        outcome: {
          type: outcomeType,
          taskMonitorId: projectionEffect.taskMonitorId,
          status: 'ON_HOLD',
          reason: error.message,
        },
      });
      expect(harness.persistMonitorStatus).not.toHaveBeenCalled();
    },
  );

  it('retries an unsettled projection through the recovery policy', async () => {
    const harness = makeProjectionHarness();
    vi.mocked(harness.runtime.readMonitor).mockRejectedValueOnce(new Error('connection reset'));

    await expect(harness.handler.execute(projectionEffect)).resolves.toMatchObject({
      status: 'uncertain',
      outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN' },
    });
    await expect(harness.handler.recovery.reconcile(projectionEffect)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED' },
    });
    expect(harness.persistMonitorStatus).toHaveBeenCalledOnce();
  });

  it('reconciles an applied mutation after an uncertain delivery without repeating it', async () => {
    const harness = makeProjectionHarness();
    harness.persistMonitorStatus.mockImplementationOnce(async ({ status: nextStatus }) => {
      // The remote write applied, but the response was lost before the handler observed it.
      harness.setStatus(nextStatus);
      throw new Error('connection reset');
    });

    await expect(harness.handler.execute(projectionEffect)).resolves.toMatchObject({
      status: 'uncertain',
      outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_UNCERTAIN' },
    });
    await expect(harness.handler.recovery.reconcile(projectionEffect)).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTED' },
    });
    expect(harness.persistMonitorStatus).toHaveBeenCalledOnce();
  });

  it('does not replace canonical completion with a stale control projection', async () => {
    const harness = makeProjectionHarness('COMPLETED');

    await expect(harness.handler.execute(projectionEffect)).resolves.toMatchObject({
      status: 'failed',
      outcome: { type: 'TASK_MONITOR_CONTROL_STATUS_PROJECTION_FAILED' },
    });
    expect(harness.persistMonitorStatus).not.toHaveBeenCalled();
  });
});

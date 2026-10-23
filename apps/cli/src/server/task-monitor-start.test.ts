import { describe, expect, it, vi } from 'vitest';

import { TaskMonitorLoadEffectHandler } from '../agents/task-monitor/state-machine/monitor-effect-handlers';
import type { TaskMonitorExecutionDefinition } from '../shared/api/generated/api';
import { NOOP_LOGGER, type ServerLogger } from './logger';
import { createTestPlatformAuthContext } from './monitors/test-owners.test-support';
import { TaskMonitorStartRuntime, type TaskMonitorStartMonitor } from './task-monitor-start';
import { useTestCapabilityCatalog } from '../test-support/capability-catalog';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000002';
const MONITOR_ID = '30000000-0000-4000-8000-000000000003';
const AGENT_SESSION_ID = '40000000-0000-4000-8000-000000000004';
const TASK_IDS = [
  '70000000-0000-4000-8000-000000000007',
  '80000000-0000-4000-8000-000000000008',
  '90000000-0000-4000-8000-000000000009',
] as const;

const definition = (cursor = 0): TaskMonitorExecutionDefinition => ({
  executionPlan: TASK_IDS.map((taskId, index) => ({
    taskId,
    dependsOnTaskIds: index === 0 ? [] : [TASK_IDS[index - 1] ?? TASK_IDS[0]],
    launchConfiguration: {
      method: index === 0 ? 'quick' : index === 1 ? 'open' : 'plan',
      provider: 'codex',
      model: 'gpt-6-sol',
      reasoningEffort: 'high',
    },
    agentSessionId: null,
  })),
  launchPolicy: { terminalSupervision: { mode: 'AGENT_DECIDES' } },
  cursor,
});

const monitor = (): TaskMonitorStartMonitor => ({
  id: MONITOR_ID,
  name: 'Monitor',
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  status: 'BACKLOG',
  definition: definition(),
});

useTestCapabilityCatalog();

describe('Task Monitor START status admission', () => {
  it.each([
    ['ON_HOLD', 'paused and cannot admit new work'],
    ['COMPLETED', 'already completed and cannot admit new work'],
    ['CANCELLED', 'cannot admit new work from status CANCELLED'],
  ] as const)('rejects %s before projecting monitor work', async (status, reason) => {
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(),
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger: NOOP_LOGGER,
    });
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue({ ...monitor(), status });

    await expect(
      new TaskMonitorLoadEffectHandler(runtime, NOOP_LOGGER).execute({
        type: 'LOAD_TASK_MONITOR',
        taskMonitorId: MONITOR_ID,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestedLaunchConfig: {
          taskId: TASK_IDS[0],
          method: 'quick',
          provider: 'codex',
          model: 'gpt-6-sol',
          reasoningEffort: 'high',
        },
      }),
    ).resolves.toMatchObject({
      status: 'failed',
      outcome: { type: 'MONITOR_LOAD_FAILED', reason: expect.stringContaining(reason) },
    });
  });
});

describe('Task Monitor persisted execution definition boundary', () => {
  const workItemResponse = (executionDefinition: object): Response =>
    new Response(
      JSON.stringify({
        data: {
          id: MONITOR_ID,
          name: 'Monitor',
          type: 'TASK_MONITOR',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          status: 'READY',
          sections: [
            {
              key: 'executionDefinition',
              materializedMarkdown: JSON.stringify(executionDefinition),
            },
          ],
          serviceRelations: [],
        },
      }),
      { status: 200 },
    );

  const selectedTaskResponse = (): Response =>
    new Response(
      JSON.stringify({
        data: {
          id: TASK_IDS[0],
          name: 'Selected task',
          type: 'STANDARD',
          organizationId: ORGANIZATION_ID,
          projectId: PROJECT_ID,
          sections: [{ key: 'description', materializedMarkdown: 'Implement the task.' }],
          serviceRelations: [{ serviceId: 'service-1' }],
        },
      }),
      { status: 200 },
    );

  const mutationTask = (id: string, status: string) => ({
    id,
    name: id === MONITOR_ID ? 'Monitor' : 'Selected task',
    type: id === MONITOR_ID ? 'TASK_MONITOR' : 'STANDARD',
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    status,
  });

  const mutationResponse = (targetEntityId: string, status: 'APPLIED' | 'PENDING'): Response =>
    new Response(
      JSON.stringify({
        data: {
          status,
          task: mutationTask(targetEntityId, status === 'APPLIED' ? 'ACTIVE' : 'BACKLOG'),
        },
      }),
      { status: 200 },
    );

  it('accepts the generated definition with monitor-owned launch configuration', async () => {
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(() => Promise.resolve(workItemResponse(definition()))),
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger: NOOP_LOGGER,
    });

    await expect(
      runtime.readMonitor({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      }),
    ).resolves.toMatchObject({ definition: definition() });
  });

  it('defaults omitted Fast mode to false for a supported Codex cursor launch', async () => {
    const logger: ServerLogger = {
      trace: NOOP_LOGGER.trace.bind(NOOP_LOGGER),
      debug: NOOP_LOGGER.debug.bind(NOOP_LOGGER),
      info: NOOP_LOGGER.info.bind(NOOP_LOGGER),
      warn: vi.fn(),
      error: NOOP_LOGGER.error.bind(NOOP_LOGGER),
      child: NOOP_LOGGER.child.bind(NOOP_LOGGER),
    };
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(),
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger,
    });
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitor());

    const result = await new TaskMonitorLoadEffectHandler(runtime, logger).execute({
      type: 'LOAD_TASK_MONITOR',
      taskMonitorId: MONITOR_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      requestedLaunchConfig: {
        taskId: TASK_IDS[0],
        method: 'quick',
        provider: 'codex',
        model: 'gpt-6-sol',
        reasoningEffort: 'high',
      },
    });
    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'MONITOR_LOADED',
      },
    });
    const loadedPlan = result.outcome.type === 'MONITOR_LOADED' ? result.outcome.executionPlan : [];
    expect(loadedPlan[0]).toMatchObject({ fastMode: false });
    expect(logger.warn).toHaveBeenCalledWith(
      'task_monitor.machine.fast_mode.missing_defaulted',
      expect.objectContaining({
        monitorId: MONITOR_ID,
        taskId: TASK_IDS[0],
        provider: 'codex',
        model: 'gpt-6-sol',
        defaultFastMode: false,
      }),
    );
  });

  it('keeps Fast mode omitted for unsupported provider/model selections', async () => {
    const logger: ServerLogger = {
      trace: NOOP_LOGGER.trace.bind(NOOP_LOGGER),
      debug: NOOP_LOGGER.debug.bind(NOOP_LOGGER),
      info: NOOP_LOGGER.info.bind(NOOP_LOGGER),
      warn: vi.fn(),
      error: NOOP_LOGGER.error.bind(NOOP_LOGGER),
      child: NOOP_LOGGER.child.bind(NOOP_LOGGER),
    };
    const persisted = monitor();
    const firstEntry = persisted.definition.executionPlan[0];
    if (!firstEntry) throw new Error('Expected a persisted Task Monitor entry.');
    const unsupportedMonitor: TaskMonitorStartMonitor = {
      ...persisted,
      definition: {
        ...persisted.definition,
        executionPlan: [
          {
            ...firstEntry,
            launchConfiguration: {
              ...firstEntry.launchConfiguration,
              provider: 'claude',
              model: 'claude-sonnet-4-5',
            },
          },
        ],
      },
    };
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl: vi.fn(),
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger,
    });
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(unsupportedMonitor);

    const result = await new TaskMonitorLoadEffectHandler(runtime, logger).execute({
      type: 'LOAD_TASK_MONITOR',
      taskMonitorId: MONITOR_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      requestedLaunchConfig: {
        taskId: TASK_IDS[0],
        method: 'quick',
        provider: 'claude',
        model: 'claude-sonnet-4-5',
        reasoningEffort: 'high',
      },
    });

    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: { type: 'MONITOR_LOADED' },
    });
    const loadedPlan = result.outcome.type === 'MONITOR_LOADED' ? result.outcome.executionPlan : [];
    expect(loadedPlan[0]).not.toHaveProperty('fastMode');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('rejects a persisted definition missing reasoning effort before launch side effects', async () => {
    const validDefinition = definition();
    const invalidDefinition = {
      ...validDefinition,
      executionPlan: validDefinition.executionPlan.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              launchConfiguration: {
                method: entry.launchConfiguration.method,
                provider: entry.launchConfiguration.provider,
                model: entry.launchConfiguration.model,
              },
            }
          : entry,
      ),
    };
    const fetchImpl = vi.fn(() => Promise.resolve(workItemResponse(invalidDefinition)));
    const logger: ServerLogger = {
      trace: NOOP_LOGGER.trace.bind(NOOP_LOGGER),
      debug: NOOP_LOGGER.debug.bind(NOOP_LOGGER),
      info: NOOP_LOGGER.info.bind(NOOP_LOGGER),
      warn: NOOP_LOGGER.warn.bind(NOOP_LOGGER),
      error: vi.fn(),
      child: NOOP_LOGGER.child.bind(NOOP_LOGGER),
    };
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl,
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger,
    });

    await expect(
      runtime.readMonitor({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
      }),
    ).rejects.toThrow('/executionPlan/0/launchConfiguration/reasoningEffort');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('accepts a status-less task and persists ACTIVE when API governance auto-applies', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(selectedTaskResponse())
      .mockResolvedValueOnce(mutationResponse(TASK_IDS[0], 'APPLIED'));
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl,
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger: NOOP_LOGGER,
    });
    const selectedTask = await runtime.readTask({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      taskId: TASK_IDS[0],
    });

    expect(selectedTask).not.toHaveProperty('status');
    await expect(
      runtime.persistTaskActive({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        task: selectedTask,
      }),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a mutation response for a different target', async () => {
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(mutationResponse(TASK_IDS[1], 'APPLIED')),
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger: NOOP_LOGGER,
    });

    await expect(
      runtime.persistTaskActive({
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        task: {
          id: TASK_IDS[0],
          name: 'Selected task',
          type: 'STANDARD',
          description: 'Implement the task.',
          acceptanceCriteria: null,
          status: 'BACKLOG',
          serviceIds: ['service-1'],
        },
      }),
    ).rejects.toThrow('Task Monitor mutation response did not match the authorized target scope.');
  });

  it('rejects a pending mutation instead of attempting to approve it', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(mutationResponse(MONITOR_ID, 'PENDING'));
    const runtime = new TaskMonitorStartRuntime({
      apiBaseUrl: 'https://api.example.test',
      fetchImpl,
      authContext: createTestPlatformAuthContext(null, 'token'),
      logger: NOOP_LOGGER,
    });

    await expect(
      runtime.persistLaunch({ monitor: monitor(), planIndex: 0, agentSessionId: AGENT_SESSION_ID }),
    ).rejects.toThrow(
      'Task Monitor mutation remained pending instead of auto-applying under API governance.',
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

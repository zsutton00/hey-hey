import type { ApiRuntime } from '@hey-hey/ui-common/clients';
import {
  resetCapabilityCatalogForTests,
  setCapabilityCatalogForTests,
} from '@hey-hey/ui-common/capability-catalog';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NOOP_LOGGER } from '../../../../server/logger';
import { createTestPlatformAuthContext } from '../../../../server/monitors/test-owners.test-support';
import type { TaskMonitorPlanGuidance } from '../../../../shared/agent-bridge-contract/generated/api';
import { TaskMonitorStartRuntime } from '../../../../server/task-monitor-start';
import type { TaskMonitorStartMonitor } from '../../../../server/task-monitor-start';
import { TaskMonitorCoordinatorConversation } from '../../../../server/task-monitor-coordinator-conversation';
import { TaskMonitorCoordinatorRunner } from '../../../../server/monitors/runner';
import type {
  CoordinateTaskMonitorWorkEffect,
  PersistTaskMonitorLaunchEffect,
  ProjectTaskMonitorStartedEffect,
  ReconcileTaskMonitorLaunchEffect,
  ValidateTaskMonitorLaunchEffect,
} from '../effects';
import {
  TaskMonitorCoordinationEffectHandler,
  TaskMonitorLaunchPersistenceEffectHandler,
  TaskMonitorLaunchValidationEffectHandler,
  TaskMonitorLoadEffectHandler,
  TaskMonitorLaunchReconciliationEffectHandler,
  TaskMonitorStartedProjectionEffectHandler,
} from '../monitor-effect-handlers';
import { useTestCapabilityCatalog } from '../../../../test-support/capability-catalog';

const ORGANIZATION_ID = '10000000-0000-4000-8000-000000000001';
const PROJECT_ID = '20000000-0000-4000-8000-000000000002';
const MONITOR_ID = '30000000-0000-4000-8000-000000000003';
const TASK_A_ID = '40000000-0000-4000-8000-000000000004';
const TASK_B_ID = '50000000-0000-4000-8000-000000000005';
const PLAN_ID = '60000000-0000-4000-8000-000000000006';
const STAGE_ID = '70000000-0000-4000-8000-000000000007';
const STEP_ID = '80000000-0000-4000-8000-000000000008';
const COORDINATOR_CONVERSATION_ID = '90000000-0000-4000-8000-000000000009';

const makeCoordinatorRunner = (): TaskMonitorCoordinatorRunner => {
  const runner = Object.create(
    TaskMonitorCoordinatorRunner.prototype,
  ) as TaskMonitorCoordinatorRunner;
  vi.spyOn(runner, 'ensureTaskMonitorRun').mockResolvedValue({
    runId: 'coordinator-run',
    coordinatorAgentSessionId: 'coordinator-session',
  });
  return runner;
};

const makeCoordinatorConversation = (): TaskMonitorCoordinatorConversation => {
  const coordinatorConversation = Object.create(
    TaskMonitorCoordinatorConversation.prototype,
  ) as TaskMonitorCoordinatorConversation;
  vi.spyOn(coordinatorConversation, 'resolve').mockResolvedValue(COORDINATOR_CONVERSATION_ID);
  return coordinatorConversation;
};

const planGuidance = {
  plan: { id: PLAN_ID, title: 'Plan', outcome: 'Deliver the selected work.' },
  stage: { id: STAGE_ID, title: 'Implementation' },
  step: { id: STEP_ID, title: 'Implement' },
} satisfies TaskMonitorPlanGuidance;

const executionPlan = [
  {
    taskId: TASK_A_ID,
    dependsOnTaskIds: [],
    method: 'quick' as const,
    provider: 'codex' as const,
    model: 'gpt-6-sol',
    reasoningEffort: 'high' as const,
    fastMode: true,
    agentSessionId: null,
  },
  {
    taskId: TASK_B_ID,
    dependsOnTaskIds: [TASK_A_ID],
    method: 'plan' as const,
    provider: 'codex' as const,
    model: 'gpt-6-sol',
    reasoningEffort: 'high' as const,
    fastMode: false,
    agentSessionId: null,
  },
];

const monitor = (
  cursor = 0,
  status = 'BACKLOG',
  agentSessionId: string | null = null,
): TaskMonitorStartMonitor => ({
  id: MONITOR_ID,
  name: 'Monitor',
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  status,
  definition: {
    executionPlan: executionPlan.map((entry, index) => ({
      taskId: entry.taskId,
      dependsOnTaskIds: entry.dependsOnTaskIds,
      launchConfiguration: {
        method: entry.method,
        provider: entry.provider,
        model: entry.model,
        reasoningEffort: entry.reasoningEffort,
        fastMode: entry.fastMode,
      },
      agentSessionId: index === cursor ? agentSessionId : null,
    })),
    launchPolicy: { terminalSupervision: { mode: 'AGENT_DECIDES' as const } },
    cursor,
  },
});

const launchPersistenceEffect = (): PersistTaskMonitorLaunchEffect => ({
  type: 'PERSIST_TASK_MONITOR_LAUNCH',
  taskMonitorId: MONITOR_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  taskId: TASK_A_ID,
  cursor: 0,
  agentSessionId: '90000000-0000-4000-8000-000000000009',
});

const task = (taskId: string, status: string) => ({
  id: taskId,
  name: taskId === TASK_A_ID ? 'Task A' : 'Task B',
  type: 'STANDARD',
  description: 'Implement the selected work.',
  acceptanceCriteria: null,
  status,
  serviceIds: ['service-1'],
});

const makeRuntime = (): TaskMonitorStartRuntime =>
  new TaskMonitorStartRuntime({
    apiBaseUrl: 'https://api.test/v1',
    fetchImpl: vi.fn(),
    authContext: createTestPlatformAuthContext(null, 'token'),
    logger: NOOP_LOGGER,
  });

const validationEffect = (cursor = 1): ValidateTaskMonitorLaunchEffect => ({
  type: 'VALIDATE_TASK_MONITOR_LAUNCH',
  taskMonitorId: MONITOR_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  requestedLaunchConfig: {
    taskId: executionPlan[cursor]?.taskId ?? TASK_A_ID,
    method: executionPlan[cursor]?.method ?? 'quick',
    provider: 'codex',
    model: 'gpt-6-sol',
    reasoningEffort: 'high',
    fastMode: executionPlan[cursor]?.fastMode,
  },
  executionPlan,
  cursor,
  taskId: executionPlan[cursor]?.taskId ?? TASK_A_ID,
  userGuidance: 'Keep the change focused.',
  worktree: null,
  terminalPolicy: { mode: 'AGENT_DECIDES' },
});

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  resetCapabilityCatalogForTests();
});

useTestCapabilityCatalog();

describe('Task Monitor launch reconciliation effects', () => {
  it('does not attach an Agent Session identity to an absent operation outcome', async () => {
    const effect: ReconcileTaskMonitorLaunchEffect = {
      type: 'RECONCILE_TASK_MONITOR_LAUNCH',
      taskMonitorId: MONITOR_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      taskId: TASK_A_ID,
      cursor: 0,
      operation: 'RUN_START',
      agentSessionId: '90000000-0000-4000-8000-000000000009',
    };
    const handler = new TaskMonitorLaunchReconciliationEffectHandler(
      makeRuntime(),
      {} as ApiRuntime,
      { lookupByAgentSessionId: vi.fn(() => null) } as never,
      NOOP_LOGGER,
    );

    const settlement = await handler.execute(effect);

    expect(settlement).toEqual({
      status: 'succeeded',
      outcome: {
        type: 'OPERATION_ABSENT',
        taskMonitorId: MONITOR_ID,
        taskId: TASK_A_ID,
        cursor: 0,
        operation: 'RUN_START',
      },
    });
  });
});

describe('Task Monitor load and coordination effects', () => {
  it('loads only a matching owned definition and projects coordination data', async () => {
    const runtime = makeRuntime();
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitor());
    const handler = new TaskMonitorLoadEffectHandler(runtime, NOOP_LOGGER);

    await expect(
      handler.execute({
        type: 'LOAD_TASK_MONITOR',
        taskMonitorId: MONITOR_ID,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestedLaunchConfig: {
          taskId: TASK_A_ID,
          method: 'quick',
          provider: 'codex',
          model: 'gpt-6-sol',
          reasoningEffort: 'high',
          fastMode: true,
        },
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'MONITOR_LOADED',
        taskMonitorId: MONITOR_ID,
        executionPlan,
        cursor: 0,
        terminalPolicy: { mode: 'AGENT_DECIDES' },
      },
    });
  });

  it('rejects a START launch configuration that does not match the loaded cursor work', async () => {
    const runtime = makeRuntime();
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitor());
    const handler = new TaskMonitorLoadEffectHandler(runtime, NOOP_LOGGER);

    await expect(
      handler.execute({
        type: 'LOAD_TASK_MONITOR',
        taskMonitorId: MONITOR_ID,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        requestedLaunchConfig: {
          taskId: TASK_A_ID,
          method: 'quick',
          provider: 'codex',
          model: 'gpt-5.6',
          reasoningEffort: 'high',
        },
      }),
    ).resolves.toMatchObject({ status: 'failed', outcome: { type: 'MONITOR_LOAD_FAILED' } });
  });

  it('skips completed work in order and selects only the first dependency-ready Task', async () => {
    const runtime = makeRuntime();
    const readTask = vi
      .spyOn(runtime, 'readTask')
      .mockImplementation(({ taskId }) =>
        Promise.resolve(task(taskId, taskId === TASK_A_ID ? 'COMPLETED' : 'BACKLOG')),
      );
    const effect: CoordinateTaskMonitorWorkEffect = {
      type: 'COORDINATE_TASK_MONITOR_WORK',
      taskMonitorId: MONITOR_ID,
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      executionPlan,
      cursor: 0,
    };

    await expect(
      new TaskMonitorCoordinationEffectHandler(runtime, NOOP_LOGGER).execute(effect),
    ).resolves.toEqual({
      status: 'succeeded',
      outcome: { type: 'WORK_SELECTED', taskMonitorId: MONITOR_ID, taskId: TASK_B_ID, cursor: 1 },
    });
    expect(readTask).toHaveBeenCalledTimes(3);
  });
});

describe('Task Monitor launch validation effect', () => {
  it('accepts a runtime-only model and service tier from the initialized shared catalog', async () => {
    setCapabilityCatalogForTests([
      {
        provider: 'codex',
        models: [
          {
            id: 'runtime-only-model',
            label: 'Runtime only',
            efforts: ['high'],
            serviceTiers: ['priority'],
          },
        ],
      },
    ]);
    const runtime = makeRuntime();
    vi.spyOn(runtime, 'readTask').mockResolvedValue(task(TASK_A_ID, 'ACTIVE'));
    vi.spyOn(runtime, 'resolvePlanContext').mockResolvedValue(null);
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitor(0, 'ACTIVE'));
    const baseEntry = executionPlan[0];
    if (!baseEntry) throw new Error('Expected a Task Monitor execution entry.');
    const entry = {
      ...baseEntry,
      model: 'runtime-only-model',
      reasoningEffort: 'high' as const,
      fastMode: true,
    };

    await expect(
      new TaskMonitorLaunchValidationEffectHandler(runtime, NOOP_LOGGER).execute({
        ...validationEffect(0),
        executionPlan: [entry],
        requestedLaunchConfig: {
          taskId: TASK_A_ID,
          method: 'quick',
          provider: 'codex',
          model: 'runtime-only-model',
          reasoningEffort: 'high',
          fastMode: true,
        },
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_VALIDATED',
        launch: { model: 'runtime-only-model', fastMode: true },
      },
    });
  });

  it('leaves a stored model this machine does not list to the provider to judge', async () => {
    setCapabilityCatalogForTests([
      { provider: 'codex', models: [{ id: 'listed-model', label: 'Listed', efforts: ['high'] }] },
    ]);
    const runtime = makeRuntime();
    vi.spyOn(runtime, 'readTask').mockResolvedValue(task(TASK_A_ID, 'ACTIVE'));
    vi.spyOn(runtime, 'resolvePlanContext').mockResolvedValue(null);
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitor(0, 'ACTIVE'));
    const baseEntry = executionPlan[0];
    if (!baseEntry) throw new Error('Expected a Task Monitor execution entry.');
    const entry = { ...baseEntry, model: 'retired-model', reasoningEffort: 'high' as const };

    await expect(
      new TaskMonitorLaunchValidationEffectHandler(runtime, NOOP_LOGGER).execute({
        ...validationEffect(0),
        executionPlan: [entry],
        requestedLaunchConfig: {
          taskId: TASK_A_ID,
          method: 'quick',
          provider: 'codex',
          model: 'retired-model',
          reasoningEffort: 'high',
        },
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'LAUNCH_VALIDATED', launch: { model: 'retired-model' } },
    });
  });

  it('validates selected persisted work after coordination skips a differently configured completed node', async () => {
    const runtime = makeRuntime();
    const selected = task(TASK_B_ID, 'ACTIVE');
    vi.spyOn(runtime, 'readTask').mockImplementation(({ taskId }) =>
      Promise.resolve(taskId === TASK_B_ID ? selected : task(TASK_A_ID, 'COMPLETED')),
    );
    vi.spyOn(runtime, 'resolvePlanContext').mockResolvedValue(null);
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitor(1, 'ACTIVE'));
    const effect = validationEffect();
    const differentlyConfiguredStart = {
      ...effect,
      requestedLaunchConfig: {
        taskId: TASK_B_ID,
        method: 'plan' as const,
        provider: 'claude' as const,
        model: 'claude-sonnet-5-5',
        reasoningEffort: 'high' as const,
      },
    };

    await expect(
      new TaskMonitorLaunchValidationEffectHandler(runtime, NOOP_LOGGER).execute(
        differentlyConfiguredStart,
      ),
    ).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'LAUNCH_VALIDATED', taskId: TASK_B_ID },
    });
  });

  it('activates the canonical Task before the separate monitor projection and returns a projection-only launch', async () => {
    const runtime = makeRuntime();
    const selected = task(TASK_B_ID, 'BACKLOG');
    vi.spyOn(runtime, 'readTask').mockImplementation(({ taskId }) =>
      Promise.resolve(taskId === TASK_B_ID ? selected : task(TASK_A_ID, 'COMPLETED')),
    );
    vi.spyOn(runtime, 'resolvePlanContext').mockResolvedValue(planGuidance);
    const persistTaskActive = vi
      .spyOn(runtime, 'persistTaskActive')
      .mockResolvedValue({ ...selected, status: 'ACTIVE' });
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitor(0));
    const persistCursor = vi.spyOn(runtime, 'persistCursor').mockResolvedValue(monitor(1));
    const persistMonitorActive = vi
      .spyOn(runtime, 'persistMonitorActive')
      .mockResolvedValue(monitor(1, 'ACTIVE'));

    const result = await new TaskMonitorLaunchValidationEffectHandler(runtime, NOOP_LOGGER).execute(
      validationEffect(),
    );

    expect(result).toMatchObject({
      status: 'succeeded',
      outcome: {
        type: 'LAUNCH_VALIDATED',
        launch: {
          taskMonitorId: MONITOR_ID,
          taskId: TASK_B_ID,
          method: 'plan',
          provider: 'codex',
          model: 'gpt-6-sol',
          reasoningEffort: 'high',
          fastMode: false,
          serviceIds: ['service-1'],
          planGuidance,
          executionOrder: [TASK_A_ID, TASK_B_ID],
          terminalPolicy: { mode: 'AGENT_DECIDES' },
        },
      },
    });
    expect(persistTaskActive.mock.invocationCallOrder[0]).toBeLessThan(
      persistCursor.mock.invocationCallOrder[0] ?? 0,
    );
    expect(persistCursor.mock.invocationCallOrder[0]).toBeLessThan(
      persistMonitorActive.mock.invocationCallOrder[0] ?? 0,
    );
    expect(result.outcome).not.toHaveProperty('task');
  });

  it('settles a pending governance mutation as failure', async () => {
    const runtime = makeRuntime();
    const logError = vi.spyOn(NOOP_LOGGER, 'error');
    vi.spyOn(runtime, 'readTask').mockImplementation(({ taskId }) =>
      Promise.resolve(task(taskId, taskId === TASK_A_ID ? 'COMPLETED' : 'BACKLOG')),
    );
    vi.spyOn(runtime, 'resolvePlanContext').mockResolvedValue(null);
    vi.spyOn(runtime, 'persistTaskActive').mockRejectedValue(
      new Error(
        'Task Monitor mutation remained pending instead of auto-applying under API governance.',
      ),
    );

    await expect(
      new TaskMonitorLaunchValidationEffectHandler(runtime, NOOP_LOGGER).execute(
        validationEffect(),
      ),
    ).resolves.toMatchObject({
      status: 'failed',
      outcome: { type: 'LAUNCH_VALIDATION_FAILED' },
    });
    expect(logError).toHaveBeenCalledWith('task_monitor.machine.launch_validation.failed', {
      monitorId: MONITOR_ID,
      taskId: TASK_B_ID,
      cursor: 1,
      reason:
        'Task Monitor mutation remained pending instead of auto-applying under API governance.',
    });
  });

  it('classifies an indeterminate activation transport result for operation-specific reconciliation', async () => {
    const runtime = makeRuntime();
    const logError = vi.spyOn(NOOP_LOGGER, 'error');
    vi.spyOn(runtime, 'readTask').mockImplementation(({ taskId }) =>
      Promise.resolve(task(taskId, taskId === TASK_A_ID ? 'COMPLETED' : 'BACKLOG')),
    );
    vi.spyOn(runtime, 'resolvePlanContext').mockResolvedValue(null);
    vi.spyOn(runtime, 'persistTaskActive').mockRejectedValue(new Error('connection reset'));

    await expect(
      new TaskMonitorLaunchValidationEffectHandler(runtime, NOOP_LOGGER).execute(
        validationEffect(),
      ),
    ).resolves.toMatchObject({
      status: 'uncertain',
      outcome: {
        type: 'LAUNCH_VALIDATION_UNCERTAIN',
        operation: 'TASK_ACTIVATION',
      },
    });
    expect(logError).toHaveBeenCalledWith('task_monitor.machine.launch_validation.uncertain', {
      monitorId: MONITOR_ID,
      taskId: TASK_B_ID,
      cursor: 1,
      operation: 'TASK_ACTIVATION',
      reason: 'connection reset',
    });
  });
});

describe('Task Monitor launch persistence effect', () => {
  it('records the canonical Agent Session when the optional link is omitted', async () => {
    const runtime = makeRuntime();
    const unlinkedMonitor = monitor(0, 'ACTIVE');
    const currentEntry = unlinkedMonitor.definition.executionPlan[0];
    if (!currentEntry) throw new Error('Expected the current execution entry.');
    const { agentSessionId: _omittedAgentSessionId, ...entryWithoutSession } = currentEntry;
    const monitorWithOmittedSession = {
      ...unlinkedMonitor,
      definition: {
        ...unlinkedMonitor.definition,
        executionPlan: [entryWithoutSession, ...unlinkedMonitor.definition.executionPlan.slice(1)],
      },
    } satisfies TaskMonitorStartMonitor;
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(monitorWithOmittedSession);
    const persistLaunch = vi
      .spyOn(runtime, 'persistLaunch')
      .mockResolvedValue(monitor(0, 'ACTIVE', launchPersistenceEffect().agentSessionId));

    const coordinatorRunner = makeCoordinatorRunner();
    await expect(
      new TaskMonitorLaunchPersistenceEffectHandler(
        runtime,
        coordinatorRunner,
        NOOP_LOGGER,
      ).execute(launchPersistenceEffect()),
    ).resolves.toEqual({
      status: 'succeeded',
      outcome: {
        type: 'TASK_MONITOR_LAUNCH_PERSISTED',
        taskMonitorId: MONITOR_ID,
        taskId: TASK_A_ID,
        agentSessionId: launchPersistenceEffect().agentSessionId,
      },
    });
    expect(persistLaunch).toHaveBeenCalledWith({
      monitor: monitorWithOmittedSession,
      planIndex: 0,
      agentSessionId: launchPersistenceEffect().agentSessionId,
    });
    expect(coordinatorRunner.ensureTaskMonitorRun).toHaveBeenCalledWith(
      {
        monitorId: MONITOR_ID,
        launchConfig: {
          taskId: TASK_A_ID,
          method: 'quick',
          provider: 'codex',
          model: 'gpt-6-sol',
          reasoningEffort: 'high',
          fastMode: true,
        },
      },
      { organizationId: ORGANIZATION_ID, projectId: PROJECT_ID },
    );
  });

  it('reuses an already persisted matching Agent Session during recovery', async () => {
    const runtime = makeRuntime();
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(
      monitor(0, 'ACTIVE', launchPersistenceEffect().agentSessionId),
    );
    const persistLaunch = vi.spyOn(runtime, 'persistLaunch');
    const handler = new TaskMonitorLaunchPersistenceEffectHandler(
      runtime,
      makeCoordinatorRunner(),
      NOOP_LOGGER,
    );

    await expect(handler.recovery.reconcile(launchPersistenceEffect())).resolves.toMatchObject({
      status: 'succeeded',
      outcome: { type: 'TASK_MONITOR_LAUNCH_PERSISTED' },
    });
    expect(persistLaunch).not.toHaveBeenCalled();
  });

  it('rejects a conflicting Agent Session without overwriting it', async () => {
    const runtime = makeRuntime();
    vi.spyOn(runtime, 'readMonitor').mockResolvedValue(
      monitor(0, 'ACTIVE', 'a0000000-0000-4000-8000-00000000000a'),
    );
    const persistLaunch = vi.spyOn(runtime, 'persistLaunch');

    await expect(
      new TaskMonitorLaunchPersistenceEffectHandler(
        runtime,
        makeCoordinatorRunner(),
        NOOP_LOGGER,
      ).execute(launchPersistenceEffect()),
    ).resolves.toMatchObject({
      status: 'failed',
      outcome: {
        type: 'TASK_MONITOR_LAUNCH_PERSISTENCE_FAILED',
        reason: 'Task Monitor launch persistence conflicts with an existing Agent Session.',
      },
    });
    expect(persistLaunch).not.toHaveBeenCalled();
  });
});

describe('Task Monitor STARTED projection effect', () => {
  const projectionEffect = (): ProjectTaskMonitorStartedEffect => ({
    type: 'PROJECT_TASK_MONITOR_STARTED',
    taskMonitorId: MONITOR_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    taskId: TASK_B_ID,
    taskTitle: 'Task B',
  });

  it('posts once to the canonical coordinator conversation and never searches Message history', async () => {
    const postMessage = vi.fn().mockResolvedValue({ data: { data: { id: 'message-id' } } });
    const getMessages = vi.fn();
    const apiRuntime = {
      clients: {
        default: { postMessage, getMessages },
      },
    } as never as ApiRuntime;
    await expect(
      new TaskMonitorStartedProjectionEffectHandler(
        apiRuntime,
        makeCoordinatorConversation(),
        NOOP_LOGGER,
      ).execute(projectionEffect()),
    ).resolves.toEqual({
      status: 'succeeded',
      outcome: { type: 'TASK_STARTED_PROJECTED', taskMonitorId: MONITOR_ID, taskId: TASK_B_ID },
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        postMessageRequest: expect.objectContaining({
          conversationId: COORDINATOR_CONVERSATION_ID,
        }),
      }),
    );
    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(getMessages).not.toHaveBeenCalled();
  });
});

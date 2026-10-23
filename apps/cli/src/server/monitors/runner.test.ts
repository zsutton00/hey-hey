import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ApiRuntime } from '@hey-hey/ui-common/clients';
import { describe, expect, it, vi } from 'vitest';
import { TaskMonitorDecisionStore } from '../../agents/task-monitor/task-monitor-decision-store';
import { SessionMonitorEvaluationStore } from '../../agents/session-monitor';
import { createTestKeyPairStore } from '../../credentials/keypair.test-support';
import { MessagePoster } from '../../run/message-poster';
import { RunStore } from '../../run-store/run-store';
import { NOOP_LOGGER } from '../logger';
import { TaskMonitorManagedTurnRuntime } from '../task-monitor-managed-turn-runtime';
import { type TaskMonitorPromptPayload } from '../../shared/agent-bridge-contract/generated';
import {
  LocalPromptType,
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import type {
  LocalRun,
  MonitorRunEnsuredResponse,
} from '../../shared/agent-bridge-contract/contract';
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AgentSessionType,
  WorkflowName,
} from '../../shared/api/generated/api';
import type {
  CanonicalMonitorEvent,
  CanonicalSettledTurnMonitorEvent,
  ReportEmissionMonitorEvent,
} from './normalizer';
import { REPORT_EMISSION_KIND, SETTLED_TURN_EVENT_KIND } from './normalizer';
import { DailySessionMonitor } from './declarations/daily-session';
import { SessionMonitor } from './declarations/session-monitor';
import {
  DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
  resolveDailySessionSettings,
} from './daily-session-settings';
import { MonitorRunner, TaskMonitorCoordinatorRunner } from './runner';
import type { TaskMonitorCoordinationLocalState } from '../../agents/task-monitor/task-monitor-coordination';
import { PlatformAuthContext, type PlatformAuth } from '../platform-auth-context';
import { createTestOAuthClient } from '../__tests__/helpers/test-oauth-client';
import { MonitorProjectContext } from './project-context';
import { SessionMonitorTurnEvaluator } from './session-monitor-turn-evaluator';
import type { LocalAgentService } from '../local-agent-service';
import { createTestLocalAgentService } from '../local-agent-service.test-support';
import {
  createTestAgentSessionReader,
  createTestPlatformAuthContext,
  createTestPlatformWebSocketManager,
  createTestTaskMonitorStartRuntime,
} from './test-owners.test-support';
import { useTestCapabilityCatalog } from '../../test-support/capability-catalog';

const AUTH: PlatformAuth = {
  accessToken: 'token-1',
  organizationId: 'org-1',
  userId: 'user-1',
  projectId: 'proj-1',
};

const createDecisionStore = () =>
  new TaskMonitorDecisionStore(NOOP_LOGGER, new TaskMonitorManagedTurnRuntime(NOOP_LOGGER));

const stubLocalRun = (id: string): LocalRun =>
  ({ agentic_session_id: id, createdAt: '2026-06-23T00:00:00.000Z' }) as LocalRun;

const ensuredResponse = (
  overrides: Partial<MonitorRunEnsuredResponse> = {},
): MonitorRunEnsuredResponse => ({
  created: false,
  run: stubLocalRun('monitor-run'),
  agentSessionId: 'monitor-session',
  ownConversationId: 'monitor-conversation',
  targetConversationId: undefined,
  ...overrides,
});

const activityBatch = (count: number): CanonicalMonitorEvent[] =>
  Array.from({ length: count }, () => ({
    eventType: 'task.status_changed',
    timestamp: '2026-06-23T00:00:00.000Z',
    origin: 'platform' as const,
  }));

const reportEmissionEvent = (): ReportEmissionMonitorEvent => ({
  eventType: REPORT_EMISSION_KIND,
  kind: REPORT_EMISSION_KIND,
  targetSessionId: 'session-under-review',
  targetConversationId: 'conv-target',
  reportId: 'report-1',
  conversationId: 'conv-target',
  timestamp: '2026-06-23T00:00:00.000Z',
  origin: 'self',
});

const settledTurnEvent = (): CanonicalSettledTurnMonitorEvent => ({
  kind: SETTLED_TURN_EVENT_KIND,
  eventType: SETTLED_TURN_EVENT_KIND,
  entityId: 'session-under-review',
  agentSessionId: 'session-under-review',
  turnId: 'turn-1',
  promptType: 'open',
  terminalOutcome: 'COMPLETED',
  completedAssistantMessageId: 'assistant-message-1',
  reports: [{ reportId: 'report-1', reportType: 'IMPLEMENT' }],
  settledAt: '2026-06-23T00:00:01.000Z',
  timestamp: '2026-06-23T00:00:01.000Z',
  origin: 'self',
});

interface HarnessOverrides {
  auth?: PlatformAuth | null;
  ensureRunForMonitor?: LocalAgentService['ensureRunForMonitor'];
  getRun?: RunStore['getRun'];
}

const makeHarness = (overrides: HarnessOverrides = {}) => {
  const ensureRunForMonitor = vi.fn<LocalAgentService['ensureRunForMonitor']>(
    overrides.ensureRunForMonitor ?? (async () => ensuredResponse()),
  );
  const sendMessage = vi.fn(async () => ({}) as never);
  const updateRunSessionContext = vi.fn(async () => ({}) as never);
  const getRun = vi.fn<RunStore['getRun']>(
    overrides.getRun ??
      (async () =>
        ({
          provider: LocalRunProvider.Codex,
          services: [{ id: 'svc-1' }],
          launchServiceId: 'svc-1',
          model: 'gpt-5-codex',
          reasoningEffort: LocalReasoningEffort.High,
        }) as never),
  );
  const emitDailySessionUpdate = vi.fn();
  const createOutOfBand = vi.fn(async () => 'start-message-1');
  const authProvider = createTestPlatformAuthContext(
    Object.hasOwn(overrides, 'auth') ? (overrides.auth ?? null) : AUTH,
  );
  const runStore = new RunStore();
  vi.spyOn(runStore, 'updateRunSessionContext').mockImplementation(updateRunSessionContext);
  vi.spyOn(runStore, 'getRun').mockImplementation(getRun);
  const agentService = createTestLocalAgentService({ runStore });
  vi.spyOn(agentService, 'ensureRunForMonitor').mockImplementation(ensureRunForMonitor);
  vi.spyOn(agentService, 'sendSystemMessage').mockImplementation(sendMessage);
  const platformWebSocketManager = createTestPlatformWebSocketManager();
  vi.spyOn(platformWebSocketManager, 'emitDailySessionUpdate').mockImplementation(
    emitDailySessionUpdate,
  );
  const keyPairStore = createTestKeyPairStore();
  vi.spyOn(keyPairStore, 'loadCurrentMachineId').mockResolvedValue('machine-1');
  const agentSessionReader = createTestAgentSessionReader(
    vi.fn(async () => ({
      autoDecide: true,
      config: {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: 'gpt-5-codex',
        taskMonitorId: 'task-monitor-1',
      },
    })),
  );
  const taskMonitorRuntime = createTestTaskMonitorStartRuntime(vi.fn());
  const messagePoster = new MessagePoster({
    apiClient: {} as ConstructorParameters<typeof MessagePoster>[0]['apiClient'],
    dataDir: os.tmpdir(),
    logger: NOOP_LOGGER,
  });
  vi.spyOn(messagePoster, 'createOutOfBand').mockImplementation(createOutOfBand);
  const dependencies = {
    authProvider,
    agentService,
    runStore,
    platformWebSocketManager,
    agentSessionReader,
    taskMonitorRuntime,
    taskMonitorDecisionStore: new TaskMonitorDecisionStore(
      NOOP_LOGGER,
      new TaskMonitorManagedTurnRuntime(NOOP_LOGGER),
    ),
    sessionMonitorEvaluationStore: new SessionMonitorEvaluationStore(NOOP_LOGGER),
    taskMonitorEffectReceiptStorePath: path.join(
      os.tmpdir(),
      `heyhey-monitor-runner-${randomUUID()}.effects.jsonl`,
    ),
    turnSupervisionReceiptStorePath: path.join(
      os.tmpdir(),
      `heyhey-monitor-runner-${randomUUID()}.supervision.jsonl`,
    ),
    messagePoster,
    apiBaseUrl: 'https://api.test',
    fetchImpl: vi.fn(async () => new Response('', { status: 503 })) as typeof fetch,
    logger: NOOP_LOGGER,
    keyPairStore,
  };
  return {
    runner: new MonitorRunner(dependencies),
    dependencies,
    ensureRunForMonitor,
    sendMessage,
    updateRunSessionContext,
    getRun,
    emitDailySessionUpdate,
    createOutOfBand,
  };
};

useTestCapabilityCatalog();

describe('MonitorRunner', () => {
  it('ensures Daily Session identity without dispatching a turn during startup recovery', async () => {
    const ensureRunForMonitor = vi.fn(async () =>
      ensuredResponse({ created: true, run: stubLocalRun('daily-replacement') }),
    );
    const harness = makeHarness({ ensureRunForMonitor });
    const resolution = resolveDailySessionSettings(DEFAULT_DAILY_SESSION_SETTINGS_INPUT);
    if (resolution.status !== 'ready') throw new Error(resolution.issues.join('; '));

    await harness.runner.ensureDailySessionIdentity(AUTH, resolution.settings);

    expect(ensureRunForMonitor).toHaveBeenCalledOnce();
    expect(harness.emitDailySessionUpdate).toHaveBeenCalledWith({
      projectId: 'proj-1',
      sessionId: 'daily-replacement',
      updateType: 'session_created',
    });
    expect(harness.updateRunSessionContext).not.toHaveBeenCalled();
    expect(harness.sendMessage).not.toHaveBeenCalled();
  });

  it('resolves a Daily Session owner, records the firing delta, and sends one turn', async () => {
    const harness = makeHarness();

    await harness.runner.run(new DailySessionMonitor(), activityBatch(20));

    expect(harness.ensureRunForMonitor).toHaveBeenCalledOnce();
    expect(harness.ensureRunForMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        promptType: LocalPromptType.DailySession,
        keyBy: { mode: 'project' },
        runConfig: {
          provider: LocalRunProvider.Codex,
          model: 'gpt-5.6-luna',
          reasoningEffort: LocalReasoningEffort.Xhigh,
        },
      }),
    );
    expect(harness.updateRunSessionContext).toHaveBeenCalledWith(
      'monitor-run',
      expect.objectContaining({ triggerDelta: expect.objectContaining({ signalCount: 20 }) }),
    );
    expect(harness.sendMessage).toHaveBeenCalledWith(
      'monitor-run',
      expect.objectContaining({ promptType: LocalPromptType.DailySession }),
    );
    expect(harness.emitDailySessionUpdate).toHaveBeenCalledWith({
      projectId: 'proj-1',
      sessionId: 'monitor-run',
      updateType: 'trigger_fired',
    });
  });

  it('forwards an explicit persisted launch selection unchanged', async () => {
    const harness = makeHarness();
    const resolution = resolveDailySessionSettings({
      ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
      provider: LocalRunProvider.Claude,
      model: 'claude-opus-5-5',
      reasoningEffort: LocalReasoningEffort.Max,
    });
    if (resolution.status !== 'ready') {
      throw new Error(resolution.issues.join('; '));
    }

    await harness.runner.run(new DailySessionMonitor(resolution.settings), activityBatch(20));

    expect(harness.ensureRunForMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        runConfig: {
          provider: LocalRunProvider.Claude,
          model: 'claude-opus-5-5',
          reasoningEffort: LocalReasoningEffort.Max,
        },
      }),
    );
  });

  it('emits session_created before firing a newly created Daily Session', async () => {
    const ensureRunForMonitor = vi.fn(async () =>
      ensuredResponse({ created: true, run: stubLocalRun('daily-created') }),
    );
    const harness = makeHarness({ ensureRunForMonitor });

    await harness.runner.run(new DailySessionMonitor(), activityBatch(20));

    expect(harness.emitDailySessionUpdate).toHaveBeenNthCalledWith(1, {
      projectId: 'proj-1',
      sessionId: 'daily-created',
      updateType: 'session_created',
    });
  });

  it('hands released settlement to Task Monitor after Session Monitor', async () => {
    const evaluate = vi
      .spyOn(SessionMonitorTurnEvaluator.prototype, 'evaluate')
      .mockResolvedValue({ status: 'RELEASED', reason: 'workflow terminal' });
    const harness = makeHarness();
    const event = { ...settledTurnEvent(), reports: [] };
    const invoke = vi.fn().mockResolvedValue({ status: 'HANDLED', supervisor: 'TASK_MONITOR' });
    harness.runner.registerTaskMonitorTurnSupervisor({ id: 'TASK_MONITOR', invoke });

    await harness.runner.run(new SessionMonitor(), [event]);

    expect(evaluate).toHaveBeenCalledWith(event, AUTH);
    expect(invoke).toHaveBeenCalledWith(event, AUTH);
    evaluate.mockRestore();
  });

  it('stops before Task Monitor when Session Monitor handles the settled Turn', async () => {
    const evaluate = vi
      .spyOn(SessionMonitorTurnEvaluator.prototype, 'evaluate')
      .mockResolvedValue({ status: 'HANDLED', outcome: 'CONTINUED' });
    const harness = makeHarness();
    const invoke = vi.fn();
    harness.runner.registerTaskMonitorTurnSupervisor({ id: 'TASK_MONITOR', invoke });

    await harness.runner.run(new SessionMonitor(), [settledTurnEvent()]);

    expect(invoke).not.toHaveBeenCalled();
    evaluate.mockRestore();
  });

  it('halts without Task Monitor fallthrough when Session Monitor fails', async () => {
    const evaluate = vi
      .spyOn(SessionMonitorTurnEvaluator.prototype, 'evaluate')
      .mockResolvedValue({ status: 'FAILED', reason: 'SESSION_MONITOR_EFFECT_FAILED' });
    const harness = makeHarness();
    const invoke = vi.fn();
    harness.runner.registerTaskMonitorTurnSupervisor({ id: 'TASK_MONITOR', invoke });

    await harness.runner.run(new SessionMonitor(), [settledTurnEvent()]);

    expect(invoke).not.toHaveBeenCalled();
    evaluate.mockRestore();
  });

  it('does not add Task Monitor supervision for an unrelated Agent Session', async () => {
    const evaluate = vi
      .spyOn(SessionMonitorTurnEvaluator.prototype, 'evaluate')
      .mockResolvedValue({ status: 'RELEASED', reason: 'SESSION_MONITOR_NOT_CONFIGURED' });
    const harness = makeHarness();
    vi.mocked(harness.dependencies.agentSessionReader.readAgentSession).mockResolvedValue({
      conversationId: 'target-conversation',
      autoDecide: false,
      config: {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        model: 'gpt-5-codex',
      },
    });

    await harness.runner.run(new SessionMonitor(), [settledTurnEvent()]);

    evaluate.mockRestore();
  });

  it('does not route when auth is unavailable', async () => {
    const harness = makeHarness({ auth: null });

    await harness.runner.run(new DailySessionMonitor(), activityBatch(20));

    expect(harness.ensureRunForMonitor).not.toHaveBeenCalled();
  });

  it('delivers resolved judgment content and request correlation to the coordinator', async () => {
    const ensureRunForMonitor = vi.fn(async () =>
      ensuredResponse({
        run: stubLocalRun('task-monitor-run'),
        agentSessionId: 'task-monitor-coordinator',
      }),
    );
    const sendMessage = vi.fn(async () => ({}) as never);
    const runStore = new RunStore();
    vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue({} as never);
    const agentService = createTestLocalAgentService({ runStore });
    vi.spyOn(agentService, 'ensureRunForMonitor').mockImplementation(ensureRunForMonitor);
    vi.spyOn(agentService, 'sendSystemMessage').mockImplementation(sendMessage);
    const decisionStore = createDecisionStore();
    const bind = vi.spyOn(decisionStore, 'bind');
    sendMessage.mockImplementation(async () => {
      expect(bind).toHaveBeenCalledWith('task-monitor-run', '20000000-0000-4000-8000-000000000002');
      return {} as never;
    });
    const runner = new TaskMonitorCoordinatorRunner({
      authProvider: createTestPlatformAuthContext(AUTH),
      agentService,
      runStore,
      decisionStore,
      logger: NOOP_LOGGER,
    });
    const command: TaskMonitorPromptPayload = {
      monitorId: '10000000-0000-4000-8000-000000000001',
      cause: 'JUDGMENT_RESOLVED',
      correlationId: '20000000-0000-4000-8000-000000000002',
      judgment: {
        requestMessageId: '20000000-0000-4000-8000-000000000002',
        label: 'Your judgment',
        conclusion: 'Proceed with the safer behavior.',
      },
    };

    await runner.runTaskMonitor(command, AUTH);

    expect(bind).toHaveBeenCalledOnce();
    expect(sendMessage).toHaveBeenCalledWith('task-monitor-run', {
      promptType: LocalPromptType.TaskMonitor,
      payload: {
        promptType: LocalPromptType.TaskMonitor,
        entity: { entityType: 'TASK', entityId: command.monitorId },
        monitorId: command.monitorId,
        cause: command.cause,
        correlationId: command.correlationId,
        judgment: command.judgment,
      },
      references: { resolved: [], unresolved: [] },
    });
  });
});

describe('TaskMonitorCoordinatorRunner', () => {
  it('starts in the verified command project after learning an unrelated project', async () => {
    const runStore = new RunStore();
    vi.spyOn(runStore, 'updateRunSessionContext').mockResolvedValue({} as never);
    const projectContext = new MonitorProjectContext({
      runStore,
      platformWebSocketManager: createTestPlatformWebSocketManager(),
      logger: NOOP_LOGGER,
    });
    projectContext.learn('unrelated-project');
    const token = `header.${Buffer.from(JSON.stringify({ organizationId: AUTH.organizationId, sub: AUTH.userId })).toString('base64url')}.signature`;
    const authProvider = new PlatformAuthContext(
      createTestOAuthClient({ getAccessToken: async () => ({ success: true, data: token }) }),
      projectContext,
      NOOP_LOGGER,
    );
    const agentService = createTestLocalAgentService({ runStore });
    const ensure = vi
      .spyOn(agentService, 'ensureRunForMonitor')
      .mockResolvedValue(
        ensuredResponse({ run: stubLocalRun('task-monitor-run'), agentSessionId: 'coordinator' }),
      );
    vi.spyOn(agentService, 'sendSystemMessage').mockResolvedValue({} as never);
    const runner = new TaskMonitorCoordinatorRunner({
      authProvider,
      agentService,
      runStore,
      decisionStore: createDecisionStore(),
      logger: NOOP_LOGGER,
    });
    const command: TaskMonitorPromptPayload = {
      monitorId: '10000000-0000-4000-8000-000000000001',
      cause: 'START',
      correlationId: '20000000-0000-4000-8000-000000000002',
    };

    await expect(
      runner.ensureTaskMonitorRun({ monitorId: command.monitorId }, AUTH),
    ).resolves.toEqual({
      runId: 'task-monitor-run',
      coordinatorAgentSessionId: 'coordinator',
    });
    await expect(runner.runTaskMonitor(command, AUTH)).resolves.toEqual({
      runId: 'task-monitor-run',
      coordinatorAgentSessionId: 'coordinator',
    });
    expect(ensure).toHaveBeenCalledTimes(2);
    for (const [input] of ensure.mock.calls) {
      expect(input).toEqual(
        expect.objectContaining({
          contextMetadataSeed: expect.objectContaining({ projectId: AUTH.projectId }),
        }),
      );
    }
    expect(projectContext.currentProjectId).toBe('unrelated-project');

    await expect(
      runner.runTaskMonitor(command, { ...AUTH, organizationId: 'other-org' }),
    ).resolves.toBeUndefined();
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('materializes the canonical coordinator Run without starting a monitor turn', async () => {
    const ensureRunForMonitor = vi.fn(async () =>
      ensuredResponse({
        run: stubLocalRun('task-monitor-run'),
        agentSessionId: 'task-monitor-coordinator',
      }),
    );
    const sendMessage = vi.fn(async () => ({}) as never);
    const runStore = new RunStore();
    const agentService = createTestLocalAgentService({ runStore });
    vi.spyOn(agentService, 'ensureRunForMonitor').mockImplementation(ensureRunForMonitor);
    vi.spyOn(agentService, 'sendMessage').mockImplementation(sendMessage);
    const runner = new TaskMonitorCoordinatorRunner({
      authProvider: createTestPlatformAuthContext(AUTH),
      agentService,
      runStore,
      decisionStore: createDecisionStore(),
      logger: NOOP_LOGGER,
    });

    await expect(
      runner.ensureTaskMonitorRun(
        {
          monitorId: '10000000-0000-4000-8000-000000000001',
          launchConfig: {
            taskId: 'task-1',
            method: 'quick',
            provider: 'codex',
            model: 'gpt-5.4',
            reasoningEffort: 'high',
          },
        },
        AUTH,
      ),
    ).resolves.toEqual({
      runId: 'task-monitor-run',
      coordinatorAgentSessionId: 'task-monitor-coordinator',
    });
    expect(ensureRunForMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        promptType: LocalPromptType.TaskMonitor,
        agentSessionType: AgentSessionType.TaskMonitor,
        workflowType: WorkflowName.TaskMonitor,
        keyBy: {
          mode: 'taskMonitor',
          monitorId: '10000000-0000-4000-8000-000000000001',
        },
        runConfig: {
          provider: LocalRunProvider.Codex,
          model: 'gpt-5.4',
          reasoningEffort: 'high',
        },
      }),
    );
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('owns coordinator identity and sends the requested Task Monitor turn', async () => {
    const ensureRunForMonitor = vi.fn(async () =>
      ensuredResponse({
        run: stubLocalRun('task-monitor-run'),
        agentSessionId: 'task-monitor-coordinator',
      }),
    );
    const sendMessage = vi.fn(async () => ({}) as never);
    const updateRunSessionContext = vi.fn(async () => ({}) as never);
    const runStore = new RunStore();
    vi.spyOn(runStore, 'updateRunSessionContext').mockImplementation(updateRunSessionContext);
    const agentService = createTestLocalAgentService({ runStore });
    vi.spyOn(agentService, 'ensureRunForMonitor').mockImplementation(ensureRunForMonitor);
    vi.spyOn(agentService, 'sendSystemMessage').mockImplementation(sendMessage);
    const runner = new TaskMonitorCoordinatorRunner({
      authProvider: createTestPlatformAuthContext(AUTH),
      agentService,
      runStore,
      decisionStore: createDecisionStore(),
      logger: NOOP_LOGGER,
    });
    const command: TaskMonitorPromptPayload = {
      monitorId: '10000000-0000-4000-8000-000000000001',
      cause: 'CONTINUE',
      correlationId: '20000000-0000-4000-8000-000000000002',
      settledTurn: {
        turnId: '20000000-0000-4000-8000-000000000002',
        promptType: 'coding_freeform',
        terminalOutcome: 'COMPLETED',
        completedAssistantMessage: null,
        reports: [],
      },
      launchConfig: {
        taskId: 'task-1',
        method: 'quick',
        provider: 'codex',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
      },
    };

    await expect(runner.runTaskMonitor(command, AUTH)).resolves.toEqual({
      runId: 'task-monitor-run',
      coordinatorAgentSessionId: 'task-monitor-coordinator',
    });
    expect(ensureRunForMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        promptType: LocalPromptType.TaskMonitor,
        agentSessionType: AgentSessionType.TaskMonitor,
        workflowType: WorkflowName.TaskMonitor,
        keyBy: { mode: 'taskMonitor', monitorId: command.monitorId },
      }),
    );
    expect(sendMessage).toHaveBeenCalledWith(
      'task-monitor-run',
      expect.objectContaining({
        promptType: LocalPromptType.TaskMonitor,
        payload: expect.objectContaining({ settledTurn: command.settledTurn }),
      }),
    );
  });

  it('persists the Resume snapshot alongside the lifecycle cause before sending coordination', async () => {
    const ensureRunForMonitor = vi.fn(async () =>
      ensuredResponse({
        run: stubLocalRun('task-monitor-run'),
        agentSessionId: 'task-monitor-coordinator',
      }),
    );
    const updateRunSessionContext = vi.fn(async () => ({}) as never);
    const sendMessage = vi.fn(async () => ({}) as never);
    const runStore = new RunStore();
    vi.spyOn(runStore, 'updateRunSessionContext').mockImplementation(updateRunSessionContext);
    const agentService = createTestLocalAgentService({ runStore });
    vi.spyOn(agentService, 'ensureRunForMonitor').mockImplementation(ensureRunForMonitor);
    vi.spyOn(agentService, 'sendSystemMessage').mockImplementation(sendMessage);
    const decisionStore = createDecisionStore();
    const bind = vi.spyOn(decisionStore, 'bind');
    const runner = new TaskMonitorCoordinatorRunner({
      authProvider: createTestPlatformAuthContext(AUTH),
      agentService,
      runStore,
      decisionStore,
      logger: NOOP_LOGGER,
    });
    const coordination: TaskMonitorCoordinationLocalState = {
      control: 'ACTIVE',
      work: 'COORDINATING',
      userGuidance: null,
      selectedTaskId: 'task-1',
      activeRunAgentSessionId: 'coding-session-1',
      activeRunId: 'coding-run-1',
      conversationId: 'coding-conversation-1',
      reviewRequestId: null,
      pendingJudgmentReason: null,
      committedEffectId: null,
      settledRun: null,
    };

    await runner.runTaskMonitor(
      {
        monitorId: '10000000-0000-4000-8000-000000000001',
        cause: 'RESUME',
        correlationId: '20000000-0000-4000-8000-000000000002',
      },
      AUTH,
      coordination,
    );

    expect(bind).toHaveBeenCalledWith('task-monitor-run', '20000000-0000-4000-8000-000000000002');
    expect(updateRunSessionContext).toHaveBeenCalledWith(
      'task-monitor-run',
      expect.objectContaining({ taskMonitorCoordination: coordination }),
    );
    expect(sendMessage).toHaveBeenCalledOnce();
  });
});

it('forwards typed correction feedback and binds the distinct committed coordinator attempt', async () => {
  const input = makeHarness();
  const runner = new TaskMonitorCoordinatorRunner({
    authProvider: input.dependencies.authProvider,
    agentService: input.dependencies.agentService,
    runStore: input.dependencies.runStore,
    decisionStore: input.dependencies.taskMonitorDecisionStore,
    logger: NOOP_LOGGER,
  });
  const bind = vi.spyOn(input.dependencies.taskMonitorDecisionStore, 'bind');
  const bindTurn = vi.spyOn(input.dependencies.taskMonitorDecisionStore, 'bindTurn');
  const correction = {
    attempt: 1,
    validationFailure: { code: 'INVALID_JSON', message: 'Expected one object.', issues: [] },
  };
  await runner.runTaskMonitor(
    {
      monitorId: 'monitor-1',
      cause: 'CONTINUE',
      correlationId: 'released-turn',
      coordinatorAttemptId: 'committed-attempt',
      correction,
    },
    AUTH,
  );
  expect(bind).toHaveBeenCalledWith('monitor-run', 'released-turn', 'committed-attempt');
  expect(input.sendMessage).toHaveBeenCalledWith(
    'monitor-run',
    expect.objectContaining({
      payload: expect.objectContaining({
        correlationId: 'released-turn',
        coordinatorAttemptId: 'committed-attempt',
        correction,
      }),
    }),
    expect.objectContaining({
      admittedInput: expect.objectContaining({ turnId: 'committed-attempt' }),
    }),
  );
  const options = vi.mocked(input.dependencies.agentService.sendSystemMessage).mock.calls[0]?.[2];
  await options?.admittedInput?.onStarted();
  expect(bindTurn).toHaveBeenCalledWith('monitor-run', 'committed-attempt', 'committed-attempt');
});

it('reconstructs rejected output from the durable coordinator lifecycle rather than optional Run metadata', async () => {
  const input = makeHarness();
  vi.spyOn(input.dependencies.runStore, 'findRunsByPromptType').mockResolvedValue([
    {
      contextMetadata: { projectId: AUTH.projectId },
      sessionContext: {
        taskMonitorLifecycle: { monitorId: 'monitor-1' },
        taskMonitorCoordinatorReceipt: { attemptId: 'attempt-1', output: 'not JSON' },
      },
    },
  ] as never);
  const runner = new TaskMonitorCoordinatorRunner({
    authProvider: input.dependencies.authProvider,
    agentService: input.dependencies.agentService,
    runStore: input.dependencies.runStore,
    decisionStore: input.dependencies.taskMonitorDecisionStore,
    logger: NOOP_LOGGER,
  });
  await expect(
    runner.reconcileRejectedAttempt('monitor-1', AUTH.projectId, 'attempt-1'),
  ).resolves.toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } });
  await expect(
    runner.reconcileRejectedAttempt('monitor-1', AUTH.projectId, 'other-attempt'),
  ).resolves.toBeNull();
});

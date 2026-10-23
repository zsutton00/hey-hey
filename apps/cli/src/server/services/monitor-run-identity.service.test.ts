import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PlatformAgentSessionClient,
  MonitorRunIdentityService,
  type EnsureRunForMonitorInput,
} from './monitor-run-identity.service';
import { NOOP_LOGGER } from '../logger';
import type { AgenticSession, AgenticSessionContextMetadata } from '../../session/types';
import type {
  LocalCreateRunRequest,
  LocalCreateRunResponse,
  LocalRun,
} from '../../shared/agent-bridge-contract/contract';
import {
  LocalPromptType,
  LocalReasoningEffort,
  LocalRunProvider,
} from '../../shared/agent-bridge-contract/contract';
import {
  AgentSessionConfigV2TypeEnum,
  AgentSessionConfigV2VersionEnum,
  AgentSessionType,
  CreateAgentSessionDtoProviderEnum,
  SessionMethod,
  WorkflowName,
} from '../../shared/api/generated/api';
import { RunCreationCoordinator } from './run-creation-coordinator';
import { createTestRunRegistryWiring } from '../__tests__/helpers/test-run-registry';
import { MessageService } from './message.service';
import { RunService } from './run.service';
import { createTestRepoMappingStore, createTestRunStore } from '../../run/run.test-support';
import { ProjectModeBundleMaterializer } from '../../agents/project-mode';

const PROJECT_ID = 'project-1';

const baseMetadata = (projectId: string): AgenticSessionContextMetadata =>
  ({
    projectId,
    organizationId: 'org-1',
    capturedAt: '2026-06-19T00:00:00.000Z',
    agentSessionId: null,
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  }) as unknown as AgenticSessionContextMetadata;

const stubAgenticSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude-code',
    provider_session_id: 'prov-1',
    provider_conversation_id: null,
    status: 'idle',
    services: [],
    conversationId: 'conv-1',
    createdAt: '2026-06-19T00:00:00.000Z',
    updatedAt: '2026-06-19T00:00:00.000Z',
    events: [],
    contextMetadata: baseMetadata(PROJECT_ID),
    ...overrides,
  }) as AgenticSession;

const stubLocalRun = (session: AgenticSession): LocalRun =>
  ({
    agentic_session_id: session.agentic_session_id,
    createdAt: session.createdAt,
    contextMetadata: session.contextMetadata,
  }) as unknown as LocalRun;

const makeRunStore = (existing: AgenticSession[]) => {
  const runStore = createTestRunStore();
  vi.spyOn(runStore, 'findRunsByPromptType').mockImplementation(async () => existing);
  vi.spyOn(runStore, 'updateRunPromptType').mockImplementation(async (runId: string) => {
    const s = existing.find((s) => s.agentic_session_id === runId);
    return s ?? stubAgenticSession({ agentic_session_id: runId });
  });
  return runStore;
};

const contextMetadataSeed = {
  capturedAt: '2026-06-25T00:00:00.000Z',
  organizationId: 'org-1',
  projectId: PROJECT_ID,
  userComments: [],
  fileReferences: { resolved: [], unresolved: [] },
} as Omit<AgenticSessionContextMetadata, 'agentSessionId'>;

const input = (overrides: Partial<EnsureRunForMonitorInput> = {}): EnsureRunForMonitorInput => ({
  accessToken: 'token-1',
  organizationId: 'org-1',
  projectId: PROJECT_ID,
  promptType: LocalPromptType.DailySession,
  agentSessionType: AgentSessionType.DailySession,
  workflowType: WorkflowName.DailySession,
  machineId: 'machine-1',
  contextMetadataSeed,
  keyBy: { mode: 'project' },
  ...overrides,
});

const sessionMonitorInput = (
  overrides: Partial<EnsureRunForMonitorInput> = {},
): EnsureRunForMonitorInput =>
  input({
    promptType: LocalPromptType.SessionMonitor,
    agentSessionType: AgentSessionType.SessionMonitor,
    workflowType: WorkflowName.SessionMonitor,
    keyBy: {
      mode: 'targetSession',
      targetSessionId: 'target-session-1',
      targetConversationId: 'target-conv-1',
    },
    ...overrides,
  });

const taskMonitorInput = (
  overrides: Partial<EnsureRunForMonitorInput> = {},
): EnsureRunForMonitorInput =>
  input({
    promptType: LocalPromptType.TaskMonitor,
    agentSessionType: AgentSessionType.TaskMonitor,
    workflowType: WorkflowName.TaskMonitor,
    keyBy: {
      mode: 'taskMonitor',
      monitorId: '33333333-3333-4333-8333-333333333333',
    },
    contextMetadataSeed: {
      ...contextMetadataSeed,
      taskMonitorId: '33333333-3333-4333-8333-333333333333',
    },
    ...overrides,
  });

interface PlatformClientMethodOverrides {
  lookupAgentSession?: PlatformAgentSessionClient['lookupAgentSession'];
  createAgentSession?: PlatformAgentSessionClient['createAgentSession'];
  bindAgentSessionToMachine?: PlatformAgentSessionClient['bindAgentSessionToMachine'];
  resolveWorkItemCoordinator?: PlatformAgentSessionClient['resolveWorkItemCoordinator'];
  ensureConversation?: PlatformAgentSessionClient['ensureConversation'];
}

const makePlatformClient = (overrides: PlatformClientMethodOverrides = {}) => {
  const lookupAgentSession = vi.fn(
    overrides.lookupAgentSession ??
      (() =>
        Promise.resolve({
          exists: true as const,
          conversationId: 'platform-conv',
          machineId: 'machine-1',
        })),
  );
  vi.spyOn(PlatformAgentSessionClient.prototype, 'lookupAgentSession').mockImplementation((args) =>
    lookupAgentSession(args),
  );
  const createAgentSession = vi.fn(
    overrides.createAgentSession ??
      (() => Promise.resolve({ agentSessionId: 'platform-agent-session' })),
  );
  vi.spyOn(PlatformAgentSessionClient.prototype, 'createAgentSession').mockImplementation((args) =>
    createAgentSession(args),
  );
  const bindAgentSessionToMachine = vi.fn(
    overrides.bindAgentSessionToMachine ?? (() => Promise.resolve()),
  );
  vi.spyOn(PlatformAgentSessionClient.prototype, 'bindAgentSessionToMachine').mockImplementation(
    (args) => bindAgentSessionToMachine(args),
  );
  const resolveWorkItemCoordinator = vi.fn(
    overrides.resolveWorkItemCoordinator ??
      (() => Promise.resolve({ agentSessionId: 'platform-agent-session' })),
  );
  vi.spyOn(PlatformAgentSessionClient.prototype, 'resolveWorkItemCoordinator').mockImplementation(
    (args) => resolveWorkItemCoordinator(args),
  );
  const ensureConversation = vi.fn(
    overrides.ensureConversation ??
      (() => Promise.resolve({ status: 'created' as const, conversationId: 'platform-conv' })),
  );
  vi.spyOn(PlatformAgentSessionClient.prototype, 'ensureConversation').mockImplementation((args) =>
    ensureConversation(args),
  );
  const fetchImpl = vi.fn<typeof fetch>(() =>
    Promise.reject(new Error('Unexpected platform HTTP request without a client method spy.')),
  );
  return {
    lookupAgentSession,
    createAgentSession,
    bindAgentSessionToMachine,
    resolveWorkItemCoordinator,
    ensureConversation,
    fetchImpl,
  };
};

type MonitorServiceDependencies = ConstructorParameters<typeof MonitorRunIdentityService>[0];
const buildMonitorRunIdentityService = (dependencies: {
  runStore: MonitorServiceDependencies['runStore'];
  createRun: RunCreationCoordinator['createRun'];
  logger: MonitorServiceDependencies['logger'];
  platformClient: ReturnType<typeof makePlatformClient>;
}): MonitorRunIdentityService => {
  const wiring = createTestRunRegistryWiring({ runStore: dependencies.runStore });
  const runService = new RunService({
    runStore: dependencies.runStore,
    repoStore: createTestRepoMappingStore(),
    logger: dependencies.logger,
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
  });
  const messageService = new MessageService({
    logger: dependencies.logger,
    runService,
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
    workflowsApi: wiring.workflowsApi,
    messagesApi: wiring.messagesApi,
  });
  const runCreationCoordinator = new RunCreationCoordinator({
    runService,
    messageService,
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
    logger: dependencies.logger,
    projectModeBundleMaterializer: new ProjectModeBundleMaterializer(),
  });
  vi.spyOn(runCreationCoordinator, 'createRun').mockImplementation(dependencies.createRun);
  return new MonitorRunIdentityService({
    runStore: dependencies.runStore,
    runCreationCoordinator,
    logger: dependencies.logger,
    apiBaseUrl: 'https://api.test',
    fetchImpl: dependencies.platformClient.fetchImpl,
  });
};

const startedRun = (run: LocalRun): LocalCreateRunResponse => ({ status: 'started', run });

describe('PlatformAgentSessionClient.lookupAgentSession', () => {
  it('returns the platform machine pairing with the canonical conversation identity', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(
          JSON.stringify({
            data: {
              id: 'daily-session-1',
              conversationId: 'conversation-1',
              machineId: 'machine-1',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const client = new PlatformAgentSessionClient({
      apiBaseUrl: 'https://api.test',
      fetchImpl,
    });

    await expect(
      client.lookupAgentSession({
        accessToken: 'token-1',
        organizationId: 'org-1',
        projectId: PROJECT_ID,
        agentSessionId: 'daily-session-1',
      }),
    ).resolves.toEqual({
      exists: true,
      conversationId: 'conversation-1',
      machineId: 'machine-1',
    });
  });
});

describe('PlatformAgentSessionClient.createAgentSession', () => {
  it('serializes provider context and the generated V2 launch configuration', async () => {
    const fetchImpl = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit): Promise<Response> =>
        new Response(JSON.stringify({ data: { id: 'monitor-session-1' } }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const client = new PlatformAgentSessionClient({
      apiBaseUrl: 'https://api.test',
      fetchImpl,
    });

    await client.createAgentSession({
      accessToken: 'token-1',
      organizationId: 'org-1',
      projectId: PROJECT_ID,
      type: AgentSessionType.SessionMonitor,
      provider: CreateAgentSessionDtoProviderEnum.Codex,
      config: {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        method: SessionMethod.Quick,
        model: 'gpt-5-codex',
      },
    });

    const request = fetchImpl.mock.calls[0]![1]!;
    expect(JSON.parse(String(request.body))).toMatchObject({
      projectId: PROJECT_ID,
      type: AgentSessionType.SessionMonitor,
      provider: CreateAgentSessionDtoProviderEnum.Codex,
      config: {
        type: AgentSessionConfigV2TypeEnum.CodingSession,
        version: AgentSessionConfigV2VersionEnum.V2,
        method: SessionMethod.Quick,
        model: 'gpt-5-codex',
      },
    });
  });
});

describe('PlatformAgentSessionClient.bindAgentSessionToMachine', () => {
  it('persists the current machine through the required update boundary', async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ data: {} }), { status: 200 }),
    );
    const client = new PlatformAgentSessionClient({ apiBaseUrl: 'https://api.test', fetchImpl });

    await client.bindAgentSessionToMachine({
      accessToken: 'token-1',
      organizationId: 'org-1',
      projectId: PROJECT_ID,
      agentSessionId: 'daily-session-1',
      machineId: 'machine-1',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/agent-sessions/daily-session-1'),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ machineId: 'machine-1' }),
      }),
    );
  });
});

describe('MonitorRunIdentityService.ensureRunForMonitor', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reuses the existing per-project Run via a single agent-session lookup when conversationIds match', async () => {
    const existing = stubAgenticSession({
      agentic_session_id: 'run-existing',
      conversationId: 'platform-conv',
    });
    const runStore = makeRunStore([existing]);
    const platformClient = makePlatformClient({
      lookupAgentSession: vi.fn(async () => ({
        exists: true,
        conversationId: 'platform-conv',
        machineId: 'machine-1',
      })),
    });

    const service = buildMonitorRunIdentityService({
      runStore,
      createRun: vi.fn(),
      logger: NOOP_LOGGER,
      platformClient,
    });

    const result = await service.ensureRunForMonitor(input());

    expect(result.created).toBe(false);
    expect(result.run.agentic_session_id).toBe('run-existing');
    expect(platformClient.lookupAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'run-existing' }),
    );
    // Steady-state reuse: one GET, no POST or refetch.
    expect(platformClient.lookupAgentSession).toHaveBeenCalledTimes(1);
    expect(platformClient.ensureConversation).not.toHaveBeenCalled();
    expect(platformClient.createAgentSession).not.toHaveBeenCalled();
  });

  it('rebuilds the Run when the platform recognizes the agent-session but the canonical conversation drifts from the local Run', async () => {
    // Malformed older data: a pre-fix Run whose conversationId is a random
    // UUID the platform never linked. The agent-session itself is recognized
    // by the lookup, but its canonical conversationId disagrees. Reusing
    // would 404 every post — rebuild fresh.
    const drifted = stubAgenticSession({
      agentic_session_id: 'run-drifted',
      conversationId: 'random-uuid-the-platform-never-saw',
    });
    const runStore = makeRunStore([drifted]);
    const platformClient = makePlatformClient({
      lookupAgentSession: vi.fn(async () => ({
        exists: true,
        conversationId: 'platform-canonical-conv',
        machineId: 'machine-1',
      })),
      createAgentSession: vi.fn(async () => ({ agentSessionId: 'fresh-platform-id' })),
      ensureConversation: vi.fn(async () => ({
        status: 'created' as const,
        conversationId: 'fresh-conv',
      })),
    });
    const createdRun = stubLocalRun(
      stubAgenticSession({
        agentic_session_id: 'fresh-platform-id',
        conversationId: 'fresh-conv',
      }),
    );
    const createRun = vi.fn(
      async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
        startedRun(createdRun),
    );

    const service = buildMonitorRunIdentityService({
      runStore,
      createRun,
      logger: NOOP_LOGGER,
      platformClient,
    });

    const result = await service.ensureRunForMonitor(input());

    expect(result.created).toBe(true);
    expect(result.run.agentic_session_id).toBe('fresh-platform-id');
    expect(platformClient.createAgentSession).toHaveBeenCalledTimes(1);
    // The drift path needs no extra ensureConversation call against the
    // drifted agent-session — the lookup already gave us the canonical id.
    expect(platformClient.ensureConversation).toHaveBeenCalledTimes(1);
    expect(platformClient.ensureConversation).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'fresh-platform-id' }),
    );
    const [createRunArg] = createRun.mock.calls[0]!;
    expect(createRunArg.contextMetadata.agentSessionId).toBe('fresh-platform-id');
    expect(createRunArg.conversationId).toBe('fresh-conv');
  });

  it('rebuilds the Run when the platform does not recognize the existing local id (stale agent-session)', async () => {
    const stale = stubAgenticSession({
      agentic_session_id: 'run-stale',
      conversationId: 'stale-conv',
    });
    const runStore = makeRunStore([stale]);
    const platformClient = makePlatformClient({
      lookupAgentSession: vi.fn(async () => ({ exists: false as const })),
      createAgentSession: vi.fn(async () => ({ agentSessionId: 'fresh-platform-id' })),
      ensureConversation: vi.fn(async () => ({
        status: 'created' as const,
        conversationId: 'fresh-conv',
      })),
    });
    const createdRun = stubLocalRun(
      stubAgenticSession({
        agentic_session_id: 'fresh-platform-id',
        conversationId: 'fresh-conv',
      }),
    );
    const createRun = vi.fn(
      async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
        startedRun(createdRun),
    );

    const service = buildMonitorRunIdentityService({
      runStore,
      createRun,
      logger: NOOP_LOGGER,
      platformClient,
    });

    const result = await service.ensureRunForMonitor(input());

    expect(result.created).toBe(true);
    expect(result.run.agentic_session_id).toBe('fresh-platform-id');
    expect(platformClient.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ type: AgentSessionType.DailySession }),
    );
    expect(platformClient.ensureConversation).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'fresh-platform-id' }),
    );
    const [createRunArg] = createRun.mock.calls[0]!;
    expect(createRunArg.contextMetadata.agentSessionId).toBe('fresh-platform-id');
    expect(createRunArg.conversationId).toBe('fresh-conv');
    expect(createRunArg.payload).toBeUndefined();
    expect(runStore.updateRunPromptType).toHaveBeenCalledWith(
      'fresh-platform-id',
      LocalPromptType.DailySession,
    );
  });

  it('rebuilds a legacy Daily Session whose platform identity has no paired machine', async () => {
    const legacy = stubAgenticSession({
      agentic_session_id: 'legacy-daily-session',
      conversationId: 'legacy-conversation',
    });
    const runStore = makeRunStore([legacy]);
    const platformClient = makePlatformClient({
      lookupAgentSession: vi.fn(async () => ({
        exists: true,
        conversationId: 'legacy-conversation',
        machineId: null,
      })),
      createAgentSession: vi.fn(async () => ({ agentSessionId: 'replacement-session' })),
      ensureConversation: vi.fn(async () => ({
        status: 'created' as const,
        conversationId: 'replacement-conversation',
      })),
    });
    const createRun = vi.fn(
      async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
        startedRun(
          stubLocalRun(
            stubAgenticSession({
              agentic_session_id: 'replacement-session',
              conversationId: 'replacement-conversation',
            }),
          ),
        ),
    );
    const service = buildMonitorRunIdentityService({
      runStore,
      createRun,
      logger: NOOP_LOGGER,
      platformClient,
    });

    const result = await service.ensureRunForMonitor(input());

    expect(result.created).toBe(true);
    expect(result.agentSessionId).toBe('replacement-session');
    expect(platformClient.createAgentSession).toHaveBeenCalledTimes(1);
    expect(platformClient.ensureConversation).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'replacement-session' }),
    );
    const [createRunArg] = createRun.mock.calls[0]!;
    expect(createRunArg.contextMetadata.agentSessionId).toBe('replacement-session');
    expect(createRunArg.conversationId).toBe('replacement-conversation');
  });

  it('mints platform identity and creates the local Run with canonical ids when no Run exists', async () => {
    const runStore = makeRunStore([]);
    const platformClient = makePlatformClient({
      createAgentSession: vi.fn(async () => ({ agentSessionId: 'platform-new' })),
      ensureConversation: vi.fn(async () => ({
        status: 'created' as const,
        conversationId: 'platform-conv-new',
      })),
    });
    const createdRun = stubLocalRun(
      stubAgenticSession({
        agentic_session_id: 'platform-new',
        conversationId: 'platform-conv-new',
      }),
    );
    const createRun = vi.fn(
      async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
        startedRun(createdRun),
    );
    const service = buildMonitorRunIdentityService({
      runStore,
      createRun,
      logger: NOOP_LOGGER,
      platformClient,
    });

    const result = await service.ensureRunForMonitor(input());

    expect(result.created).toBe(true);
    expect(result.run.agentic_session_id).toBe('platform-new');
    expect(platformClient.lookupAgentSession).not.toHaveBeenCalled();
  });

  it('passes inherited provider, model, and reasoning effort into fresh monitor Run creation', async () => {
    const runStore = makeRunStore([]);
    const platformClient = makePlatformClient({
      createAgentSession: vi.fn(async () => ({ agentSessionId: 'monitor-platform-new' })),
      ensureConversation: vi.fn(async () => ({
        status: 'created' as const,
        conversationId: 'monitor-platform-conv-new',
      })),
    });
    const createRun = vi.fn(
      async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
        startedRun(
          stubLocalRun(
            stubAgenticSession({
              agentic_session_id: 'monitor-platform-new',
              conversationId: 'monitor-platform-conv-new',
            }),
          ),
        ),
    );
    const service = buildMonitorRunIdentityService({
      runStore,
      createRun,
      logger: NOOP_LOGGER,
      platformClient,
    });

    await service.ensureRunForMonitor(
      sessionMonitorInput({
        runConfig: {
          provider: LocalRunProvider.Codex,
          model: 'gpt-5-codex',
          reasoningEffort: LocalReasoningEffort.High,
          serviceIds: ['svc-1'],
          launchServiceId: 'svc-1',
        },
      }),
    );

    const [createRunArg] = createRun.mock.calls[0]!;
    expect(createRunArg.context.provider).toBe(LocalRunProvider.Codex);
    expect(createRunArg.context.serviceIds).toEqual(['svc-1']);
    expect(createRunArg.context.launchServiceId).toBe('svc-1');
    expect(createRunArg.model).toBe('gpt-5-codex');
    expect(createRunArg.reasoningEffort).toBe(LocalReasoningEffort.High);
    expect(platformClient.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: CreateAgentSessionDtoProviderEnum.Codex,
        config: {
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          version: AgentSessionConfigV2VersionEnum.V2,
          model: 'gpt-5-codex',
          effort: LocalReasoningEffort.High,
        },
      }),
    );
  });

  it('picks the latest-by-`createdAt` Run when multiple per-project Runs exist', async () => {
    const older = stubAgenticSession({
      agentic_session_id: 'run-older',
      conversationId: 'older-conv',
      createdAt: '2026-06-20T00:00:00.000Z',
    });
    const newer = stubAgenticSession({
      agentic_session_id: 'run-newer',
      conversationId: 'newer-conv',
      createdAt: '2026-06-24T00:00:00.000Z',
    });
    const runStore = makeRunStore([older, newer]);
    const platformClient = makePlatformClient({
      lookupAgentSession: vi.fn(async () => ({
        exists: true,
        conversationId: 'newer-conv',
        machineId: 'machine-1',
      })),
    });

    const service = buildMonitorRunIdentityService({
      runStore,
      createRun: vi.fn(),
      logger: NOOP_LOGGER,
      platformClient,
    });

    const result = await service.ensureRunForMonitor(input());

    expect(result.created).toBe(false);
    expect(result.run.agentic_session_id).toBe('run-newer');
    expect(platformClient.lookupAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: 'run-newer' }),
    );
  });

  it('single-flights concurrent firings keyed by (promptType, projectId)', async () => {
    const runStore = makeRunStore([]);
    const platformClient = makePlatformClient({
      createAgentSession: vi.fn(async () => ({ agentSessionId: 'one-id' })),
      ensureConversation: vi.fn(async () => ({
        status: 'created' as const,
        conversationId: 'one-conv',
      })),
    });
    const createRun = vi.fn(
      async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
        startedRun(stubLocalRun(stubAgenticSession({ agentic_session_id: 'one-id' }))),
    );

    const service = buildMonitorRunIdentityService({
      runStore,
      createRun,
      logger: NOOP_LOGGER,
      platformClient,
    });

    const [a, b] = await Promise.all([
      service.ensureRunForMonitor(input()),
      service.ensureRunForMonitor(input()),
    ]);

    expect(a.run.agentic_session_id).toBe('one-id');
    expect(b.run.agentic_session_id).toBe('one-id');
    expect(platformClient.createAgentSession).toHaveBeenCalledTimes(1);
    expect(createRun).toHaveBeenCalledTimes(1);
  });

  it('returns the resolved identity triple on reuse with targetConversationId undefined under project keying', async () => {
    const existing = stubAgenticSession({
      agentic_session_id: 'run-existing',
      conversationId: 'platform-conv',
    });
    const runStore = makeRunStore([existing]);
    const platformClient = makePlatformClient({
      lookupAgentSession: vi.fn(async () => ({
        exists: true,
        conversationId: 'platform-conv',
        machineId: 'machine-1',
      })),
    });

    const service = buildMonitorRunIdentityService({
      runStore,
      createRun: vi.fn(),
      logger: NOOP_LOGGER,
      platformClient,
    });

    const result = await service.ensureRunForMonitor(input());

    expect(result.agentSessionId).toBe('run-existing');
    expect(result.ownConversationId).toBe('platform-conv');
    expect(result.targetConversationId).toBeUndefined();
  });

  describe('task-monitor keying mode', () => {
    it('mints one coordinator with canonical Task Monitor identity metadata', async () => {
      const runStore = makeRunStore([]);
      const platformClient = makePlatformClient({
        resolveWorkItemCoordinator: vi.fn(async () => ({
          agentSessionId: 'task-monitor-session',
        })),
        ensureConversation: vi.fn(async () => ({
          status: 'created' as const,
          conversationId: 'task-monitor-conversation',
        })),
      });
      const createRun = vi.fn(
        async (request: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
          startedRun(
            stubLocalRun(
              stubAgenticSession({
                agentic_session_id: request.contextMetadata.agentSessionId,
                conversationId: 'task-monitor-conversation',
              }),
            ),
          ),
      );
      const service = buildMonitorRunIdentityService({
        runStore,
        createRun,
        logger: NOOP_LOGGER,
        platformClient,
      });

      const result = await service.ensureRunForMonitor(taskMonitorInput());

      expect(result.created).toBe(true);
      expect(result.agentSessionId).toBe('task-monitor-session');
      expect(platformClient.resolveWorkItemCoordinator).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AgentSessionType.TaskMonitor,
          workItemType: 'TASK_MONITOR',
          workItemId: '33333333-3333-4333-8333-333333333333',
        }),
      );
      expect(platformClient.ensureConversation).toHaveBeenCalledWith(
        expect.objectContaining({ workflowType: WorkflowName.TaskMonitor }),
      );
      expect(createRun.mock.calls[0]?.[0].contextMetadata.taskMonitorId).toBe(
        '33333333-3333-4333-8333-333333333333',
      );
    });

    it('reuses only the coordinator whose metadata matches the Task Monitor id', async () => {
      const matching = stubAgenticSession({
        agentic_session_id: 'task-monitor-existing',
        conversationId: 'task-monitor-conversation',
        contextMetadata: {
          ...baseMetadata(PROJECT_ID),
          taskMonitorId: '33333333-3333-4333-8333-333333333333',
        } as AgenticSessionContextMetadata,
      });
      const other = stubAgenticSession({
        agentic_session_id: 'other-task-monitor',
        conversationId: 'other-conversation',
        createdAt: '2026-06-25T00:00:00.000Z',
        contextMetadata: {
          ...baseMetadata(PROJECT_ID),
          taskMonitorId: '44444444-4444-4444-8444-444444444444',
        } as AgenticSessionContextMetadata,
      });
      const platformClient = makePlatformClient({
        lookupAgentSession: vi.fn(async () => ({
          exists: true,
          conversationId: 'task-monitor-conversation',
          machineId: null,
        })),
      });
      const service = buildMonitorRunIdentityService({
        runStore: makeRunStore([matching, other]),
        createRun: vi.fn(),
        logger: NOOP_LOGGER,
        platformClient,
      });

      const result = await service.ensureRunForMonitor(taskMonitorInput());

      expect(result.created).toBe(false);
      expect(result.agentSessionId).toBe('task-monitor-existing');
      expect(platformClient.createAgentSession).not.toHaveBeenCalled();
      expect(platformClient.resolveWorkItemCoordinator).not.toHaveBeenCalled();
    });
  });

  describe('target-session keying mode', () => {
    it('persists targetSessionId on contextMetadata and returns the resolved identity triple including targetConversationId', async () => {
      const runStore = makeRunStore([]);
      const platformClient = makePlatformClient({
        createAgentSession: vi.fn(async () => ({ agentSessionId: 'monitor-for-target' })),
        ensureConversation: vi.fn(async () => ({
          status: 'created' as const,
          conversationId: 'monitor-conv',
        })),
      });
      const createdRun = stubLocalRun(
        stubAgenticSession({
          agentic_session_id: 'monitor-for-target',
          conversationId: 'monitor-conv',
        }),
      );
      const createRun = vi.fn(
        async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
          startedRun(createdRun),
      );

      const service = buildMonitorRunIdentityService({
        runStore,
        createRun,
        logger: NOOP_LOGGER,
        platformClient,
      });

      const result = await service.ensureRunForMonitor(
        sessionMonitorInput({
          runConfig: {
            provider: LocalRunProvider.Codex,
            model: 'gpt-5-codex',
            method: SessionMethod.Quick,
          },
        }),
      );

      expect(result.created).toBe(true);
      expect(result.agentSessionId).toBe('monitor-for-target');
      expect(result.ownConversationId).toBe('monitor-conv');
      expect(result.targetConversationId).toBe('target-conv-1');
      expect(platformClient.createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          type: AgentSessionType.SessionMonitor,
          provider: CreateAgentSessionDtoProviderEnum.Codex,
          config: {
            type: AgentSessionConfigV2TypeEnum.CodingSession,
            version: AgentSessionConfigV2VersionEnum.V2,
            method: SessionMethod.Quick,
            model: 'gpt-5-codex',
          },
        }),
      );
      expect(platformClient.ensureConversation).toHaveBeenCalledWith(
        expect.objectContaining({ workflowType: WorkflowName.SessionMonitor }),
      );
      const [createRunArg] = createRun.mock.calls[0]!;
      expect(createRunArg.contextMetadata.targetSessionId).toBe('target-session-1');
    });

    it('persists a different caller-supplied session method', async () => {
      const platformClient = makePlatformClient();
      const service = buildMonitorRunIdentityService({
        runStore: makeRunStore([]),
        createRun: vi.fn(async () =>
          startedRun(stubLocalRun(stubAgenticSession({ agentic_session_id: 'monitor-open' }))),
        ),
        logger: NOOP_LOGGER,
        platformClient,
      });

      await service.ensureRunForMonitor(
        sessionMonitorInput({
          runConfig: {
            provider: LocalRunProvider.Claude,
            model: 'claude-sonnet-4-6',
            method: SessionMethod.Open,
          },
        }),
      );

      expect(platformClient.createAgentSession).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: CreateAgentSessionDtoProviderEnum.Claude,
          config: expect.objectContaining({
            method: SessionMethod.Open,
            model: 'claude-sonnet-4-6',
          }),
        }),
      );
    });

    it('rejects a launch method without its required model before side effects', async () => {
      const platformClient = makePlatformClient();
      const createRun = vi.fn();
      const runStore = makeRunStore([]);
      const service = buildMonitorRunIdentityService({
        runStore,
        createRun,
        logger: NOOP_LOGGER,
        platformClient,
      });

      await expect(
        service.ensureRunForMonitor(
          sessionMonitorInput({
            runConfig: {
              provider: LocalRunProvider.Codex,
              method: SessionMethod.Quick,
            },
          }),
        ),
      ).rejects.toThrow('Monitor Agent Session launch configuration requires a model.');

      expect(runStore.findRunsByPromptType).not.toHaveBeenCalled();
      expect(platformClient.lookupAgentSession).not.toHaveBeenCalled();
      expect(platformClient.createAgentSession).not.toHaveBeenCalled();
      expect(platformClient.ensureConversation).not.toHaveBeenCalled();
      expect(createRun).not.toHaveBeenCalled();
    });

    it('reuses the monitor AgentSession across firings against the same target session', async () => {
      const existing = stubAgenticSession({
        agentic_session_id: 'monitor-existing',
        conversationId: 'monitor-conv',
        provider: LocalRunProvider.Codex,
        model: 'gpt-5-codex',
        reasoningEffort: LocalReasoningEffort.High,
        services: [{ id: 'svc-1', path: '/tmp/repo' }],
        launchServiceId: 'svc-1',
        config: {
          type: AgentSessionConfigV2TypeEnum.CodingSession,
          version: AgentSessionConfigV2VersionEnum.V2,
          method: SessionMethod.Quick,
          model: 'gpt-5-codex',
        },
        contextMetadata: {
          ...baseMetadata(PROJECT_ID),
          targetSessionId: 'target-session-1',
        } as unknown as AgenticSessionContextMetadata,
      });
      const runStore = makeRunStore([existing]);
      const platformClient = makePlatformClient({
        lookupAgentSession: vi.fn(async () => ({
          exists: true,
          conversationId: 'monitor-conv',
          machineId: null,
        })),
      });

      const service = buildMonitorRunIdentityService({
        runStore,
        createRun: vi.fn(),
        logger: NOOP_LOGGER,
        platformClient,
      });

      const result = await service.ensureRunForMonitor(
        sessionMonitorInput({
          runConfig: {
            provider: LocalRunProvider.Codex,
            model: 'gpt-5-codex',
            method: SessionMethod.Quick,
            reasoningEffort: LocalReasoningEffort.High,
            serviceIds: ['svc-1'],
            launchServiceId: 'svc-1',
          },
        }),
      );

      expect(result.created).toBe(false);
      expect(result.agentSessionId).toBe('monitor-existing');
      expect(result.ownConversationId).toBe('monitor-conv');
      expect(result.targetConversationId).toBe('target-conv-1');
      expect(platformClient.createAgentSession).not.toHaveBeenCalled();
    });

    it('rebuilds an existing monitor Run when its provider/model do not match the triggering run', async () => {
      const existing = stubAgenticSession({
        agentic_session_id: 'monitor-existing-claude',
        provider: LocalRunProvider.Claude,
        model: 'claude-sonnet-4-6',
        conversationId: 'monitor-existing-conv',
        contextMetadata: {
          ...baseMetadata(PROJECT_ID),
          targetSessionId: 'target-session-1',
        } as unknown as AgenticSessionContextMetadata,
      });
      const runStore = makeRunStore([existing]);
      const platformClient = makePlatformClient({
        lookupAgentSession: vi.fn(async () => ({
          exists: true,
          conversationId: 'monitor-existing-conv',
          machineId: null,
        })),
        createAgentSession: vi.fn(async () => ({ agentSessionId: 'monitor-codex' })),
        ensureConversation: vi.fn(async () => ({
          status: 'created' as const,
          conversationId: 'monitor-codex-conv',
        })),
      });
      const createRun = vi.fn(
        async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
          startedRun(
            stubLocalRun(
              stubAgenticSession({
                agentic_session_id: 'monitor-codex',
                provider: LocalRunProvider.Codex,
                model: 'gpt-5-codex',
                reasoningEffort: LocalReasoningEffort.High,
                conversationId: 'monitor-codex-conv',
              }),
            ),
          ),
      );

      const service = buildMonitorRunIdentityService({
        runStore,
        createRun,
        logger: NOOP_LOGGER,
        platformClient,
      });

      const result = await service.ensureRunForMonitor(
        sessionMonitorInput({
          runConfig: {
            provider: LocalRunProvider.Codex,
            model: 'gpt-5-codex',
            reasoningEffort: LocalReasoningEffort.High,
            serviceIds: ['svc-1'],
            launchServiceId: 'svc-1',
          },
        }),
      );

      expect(result.created).toBe(true);
      expect(result.agentSessionId).toBe('monitor-codex');
      expect(platformClient.lookupAgentSession).not.toHaveBeenCalled();
      const [createRunArg] = createRun.mock.calls[0]!;
      expect(createRunArg.context.provider).toBe(LocalRunProvider.Codex);
      expect(createRunArg.context.serviceIds).toEqual(['svc-1']);
      expect(createRunArg.context.launchServiceId).toBe('svc-1');
      expect(createRunArg.model).toBe('gpt-5-codex');
      expect(createRunArg.reasoningEffort).toBe(LocalReasoningEffort.High);
    });

    it('ignores Runs whose contextMetadata.targetSessionId points at a different target', async () => {
      const otherTarget = stubAgenticSession({
        agentic_session_id: 'monitor-other',
        conversationId: 'monitor-other-conv',
        contextMetadata: {
          ...baseMetadata(PROJECT_ID),
          targetSessionId: 'some-other-target',
        } as unknown as AgenticSessionContextMetadata,
      });
      const runStore = makeRunStore([otherTarget]);
      const platformClient = makePlatformClient({
        createAgentSession: vi.fn(async () => ({ agentSessionId: 'fresh-monitor' })),
        ensureConversation: vi.fn(async () => ({
          status: 'created' as const,
          conversationId: 'fresh-monitor-conv',
        })),
      });
      const createRun = vi.fn(
        async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
          startedRun(stubLocalRun(stubAgenticSession({ agentic_session_id: 'fresh-monitor' }))),
      );

      const service = buildMonitorRunIdentityService({
        runStore,
        createRun,
        logger: NOOP_LOGGER,
        platformClient,
      });

      const result = await service.ensureRunForMonitor(sessionMonitorInput());

      expect(result.created).toBe(true);
      expect(result.agentSessionId).toBe('fresh-monitor');
      // The other-target Run is never looked up — it never makes it past the
      // contextMetadata.targetSessionId filter.
      expect(platformClient.lookupAgentSession).not.toHaveBeenCalled();
    });

    it('single-flights concurrent firings keyed by (promptType, targetSessionId)', async () => {
      const runStore = makeRunStore([]);
      const platformClient = makePlatformClient({
        createAgentSession: vi.fn(async () => ({ agentSessionId: 'monitor-once' })),
        ensureConversation: vi.fn(async () => ({
          status: 'created' as const,
          conversationId: 'monitor-once-conv',
        })),
      });
      const createRun = vi.fn(
        async (_input: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
          startedRun(stubLocalRun(stubAgenticSession({ agentic_session_id: 'monitor-once' }))),
      );

      const service = buildMonitorRunIdentityService({
        runStore,
        createRun,
        logger: NOOP_LOGGER,
        platformClient,
      });

      const [a, b] = await Promise.all([
        service.ensureRunForMonitor(sessionMonitorInput()),
        service.ensureRunForMonitor(sessionMonitorInput()),
      ]);

      expect(a.agentSessionId).toBe('monitor-once');
      expect(b.agentSessionId).toBe('monitor-once');
      expect(platformClient.createAgentSession).toHaveBeenCalledTimes(1);
      expect(createRun).toHaveBeenCalledTimes(1);
    });

    it('does not single-flight firings against different target sessions', async () => {
      const runStore = makeRunStore([]);
      let counter = 0;
      const platformClient = makePlatformClient({
        createAgentSession: vi.fn(async () => {
          counter += 1;
          return { agentSessionId: `monitor-${String(counter)}` };
        }),
        ensureConversation: vi.fn(async () => ({
          status: 'created' as const,
          conversationId: `conv-${String(counter)}`,
        })),
      });
      const createRun = vi.fn(
        async (req: LocalCreateRunRequest): Promise<LocalCreateRunResponse> =>
          startedRun(
            stubLocalRun(
              stubAgenticSession({ agentic_session_id: req.contextMetadata.agentSessionId! }),
            ),
          ),
      );

      const service = buildMonitorRunIdentityService({
        runStore,
        createRun,
        logger: NOOP_LOGGER,
        platformClient,
      });

      await Promise.all([
        service.ensureRunForMonitor(
          sessionMonitorInput({
            keyBy: {
              mode: 'targetSession',
              targetSessionId: 'target-a',
              targetConversationId: 'conv-target-a',
            },
          }),
        ),
        service.ensureRunForMonitor(
          sessionMonitorInput({
            keyBy: {
              mode: 'targetSession',
              targetSessionId: 'target-b',
              targetConversationId: 'conv-target-b',
            },
          }),
        ),
      ]);

      expect(platformClient.createAgentSession).toHaveBeenCalledTimes(2);
    });
  });
});

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';

import { createTestOAuthClient } from '../auth/oauth-client.test-support';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import type { PromptTypeHandler } from '../agents/prompt-type-handler';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import type {
  AgentRunResult,
  AgentSessionRunner,
  ResumeArgs,
  RunPromptArgs,
} from '../agents/providers/session-runner';
import { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import { RepoMappingStore } from '../repo/index';
import { RunStore } from '../run-store/run-store';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { LocalContextData } from '../shared/agent-bridge-contract/runtime-types';
import type { AgenticSession } from '../session/types';
import { ToolRuleStore } from '../session/tool-rules';
import { AgentOutputEvents } from '../server/agent-output-events';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { RunEventPublisher } from '../server/run-event-publisher';
import { NOOP_LOGGER } from '../server/logger';
import { AgentSessionReader } from '../server/monitors/agent-session-reader';
import { MonitorProjectContext } from '../server/monitors/project-context';
import { PlatformAuthContext } from '../server/platform-auth-context';
import { PlatformWebSocketManager } from '../server/platform-ws';
import { ReportSyncService } from '../server/report-sync-service';
import { RunChangedFilesReader } from '../server/run-changed-files';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';
import { SessionRunnerFacade } from '../server/runtime/providers/select';
import { TaskReportChainReader } from '../server/services/task-report-chain-reader';
import {
  WorkflowDispatchVerdictReader,
  type WorkflowDispatchVerdict,
} from '../server/services/workflow-dispatch-verdict';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { RunRegistry } from './run-registry';
import { MessagePoster } from './message-poster';
import { RunnerPicker } from './runners/pick-runner';
import type { RunnerContext } from './runners/types';
import type { MessagePosterApiClient } from './types';
import type { Runner } from '../turn/turn';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';

const testPath = (name: string): string =>
  path.join(tmpdir(), `heyhey-run-test-${randomUUID()}`, name);

export const createRunTestOAuthClient = (
  result: Parameters<typeof createTestOAuthClient>[0] = {
    success: false,
    error: 'test auth unavailable',
  },
) => createTestOAuthClient(result);

export const createTestRunStore = (): RunStore => {
  const baseDir = testPath('run-store');
  const runsDir = path.join(baseDir, 'runs');
  const store = new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  vi.spyOn(store, 'updateRunServiceScopeContinuation').mockResolvedValue(undefined as never);
  vi.spyOn(store, 'recordRunStartedPromptType').mockResolvedValue({} as AgenticSession);
  return store;
};

const declaredHandlers = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);

// A default handler declares what the real handler for the same prompt type
// does, so Run behavior that reads declarations matches production.
const defaultHandler = (promptType: LocalPromptType): PromptTypeHandler<unknown> => ({
  id: promptType,
  promptType,
  service: declaredHandlers.get(promptType)?.service ?? 'required',
  launchEntity: declaredHandlers.get(promptType)?.launchEntity ?? 'none',
  implementationReadiness: declaredHandlers.get(promptType)?.implementationReadiness ?? 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'test system prompt',
});

const createTestPromptTypeRegistry = (
  getHandler: PromptTypeRegistry['get'] = (promptType) =>
    promptType ? defaultHandler(promptType as LocalPromptType) : undefined,
): PromptTypeRegistry => {
  const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  vi.spyOn(registry, 'get').mockImplementation(getHandler);
  return registry;
};

export const createTestRunOwnership = (
  getHandler?: PromptTypeRegistry['get'],
): Pick<
  RunCollaborators,
  'promptTypeRegistry' | 'submissionToolRegistry' | 'runFollowUpAdmission'
> => ({
  promptTypeRegistry: createTestPromptTypeRegistry(getHandler),
  submissionToolRegistry: new SubmissionToolRegistry(),
  runFollowUpAdmission: {
    admit: vi.fn(async () => ({ replayed: false })),
    durableInputReady: vi.fn(),
  },
});

export const createTestRepoMappingStore = (
  getBinding: RepoMappingStore['getBinding'] = async () => null,
): RepoMappingStore => {
  const baseDir = testPath('repo-store');
  const store = new RepoMappingStore({
    mappingPath: path.join(baseDir, 'repos.json'),
    lockPath: path.join(baseDir, 'repos.lock'),
  });
  vi.spyOn(store, 'getBinding').mockImplementation(getBinding);
  return store;
};

type MessagePosterOverrides = Partial<
  Pick<
    MessagePoster,
    'createOutOfBand' | 'submitExternalAgentCompletion' | 'update' | 'complete' | 'cleanup'
  >
>;

export const createTestMessagePoster = (overrides: MessagePosterOverrides = {}): MessagePoster => {
  const apiClient: MessagePosterApiClient = {
    postMessage: async () => {
      throw new Error('Test MessagePoster post boundary was called unexpectedly.');
    },
    updateMessage: async () => {
      throw new Error('Test MessagePoster update boundary was called unexpectedly.');
    },
  };
  const poster = new MessagePoster({
    apiClient,
    logger: NOOP_LOGGER,
    dataDir: testPath('message-poster'),
  });
  vi.spyOn(poster, 'createOutOfBand').mockImplementation(
    overrides.createOutOfBand ?? (async () => 'test-message-id'),
  );
  vi.spyOn(poster, 'submitExternalAgentCompletion').mockImplementation(
    overrides.submitExternalAgentCompletion ?? (async () => 'test-completion-message-id'),
  );
  vi.spyOn(poster, 'update').mockImplementation(overrides.update ?? (async () => undefined));
  vi.spyOn(poster, 'complete').mockImplementation(overrides.complete ?? (async () => undefined));
  vi.spyOn(poster, 'cleanup').mockImplementation(overrides.cleanup ?? (async () => undefined));
  return poster;
};

const defaultAgentRunResult = (): AgentRunResult => ({
  providerSessionId: null,
  providerConversationId: null,
  errorCount: 0,
});

const createTestAgentSessionRunner = (): AgentSessionRunner => ({
  runPrompt: vi.fn(async () => defaultAgentRunResult()),
  resumeSession: vi.fn(async () => defaultAgentRunResult()),
  promptOnce: vi.fn(),
  getContextUsage: vi.fn(async () => ({ totalTokens: 0 }) as unknown as LocalContextData),
});

export const createTestSessionRunnerFacade = (
  runner: AgentSessionRunner = createTestAgentSessionRunner(),
): SessionRunnerFacade => {
  const facade = new SessionRunnerFacade({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    runStore: createTestRunStore(),
    repoStore: createTestRepoMappingStore(),
    oauthClient: createRunTestOAuthClient(),
    localAgentEndpoint: new LocalAgentEndpoint(),
    submissionToolRegistry: new SubmissionToolRegistry(),
    logger: NOOP_LOGGER,
    agentSessionReader: new AgentSessionReader({
      apiBaseUrl: 'https://api.example.test/api/v1',
      authProvider: createTestPlatformAuthContext(),
      logger: NOOP_LOGGER,
      fetchImpl: async () => {
        throw new Error('Test agent session boundary was called unexpectedly.');
      },
    }),
    toolRuleStore: new ToolRuleStore(testPath('tool-rules.json')),
  });
  vi.spyOn(facade, 'forRun').mockImplementation((run) => {
    run.setRunner(runner);
    return runner;
  });
  vi.spyOn(facade, 'runPrompt').mockImplementation((_run: Run, args: RunPromptArgs) =>
    runner.runPrompt(args),
  );
  vi.spyOn(facade, 'resumeSession').mockImplementation((_run: Run, args: ResumeArgs) =>
    runner.resumeSession(args),
  );
  vi.spyOn(facade, 'forgetRun').mockImplementation(() => undefined);
  return facade;
};

export const createTestRunChangedFilesReader = (
  getLiveRunChangedFiles: RunChangedFilesReader['getLiveRunChangedFiles'] = async () => [],
): RunChangedFilesReader => {
  const reader = new RunChangedFilesReader(createTestRepoMappingStore(), NOOP_LOGGER);
  vi.spyOn(reader, 'getLiveRunChangedFiles').mockImplementation(getLiveRunChangedFiles);
  return reader;
};

export const createTestRunnerPicker = (
  pick: (ctx: RunnerContext) => Runner = () => ({ run: async () => undefined }),
): RunnerPicker => {
  const picker = new RunnerPicker({
    sessionRunnerFacade: createTestSessionRunnerFacade(),
    oauthClient: createRunTestOAuthClient(),
    logger: NOOP_LOGGER,
    runChangedFilesReader: createTestRunChangedFilesReader(),
    submissionToolRegistry: new SubmissionToolRegistry(),
    localAgentEndpoint: new LocalAgentEndpoint(),
  });
  vi.spyOn(picker, 'pick').mockImplementation(pick);
  return picker;
};

export const createTestWorkflowDispatchVerdictReader = (
  read: WorkflowDispatchVerdictReader['read'] = async () => ({
    state: 'terminal',
    promptType: null,
  }),
): WorkflowDispatchVerdictReader => {
  const reader = new WorkflowDispatchVerdictReader({
    getConversationPromptType: async () => {
      throw new Error('Test workflow verdict boundary was called unexpectedly.');
    },
    getConversationWorkflowNode: async () => {
      throw new Error('Test workflow node boundary was called unexpectedly.');
    },
  });
  vi.spyOn(reader, 'read').mockImplementation(read);
  return reader;
};

export const createTestTaskReportChainReader = (
  read: TaskReportChainReader['read'] = async () => [],
): TaskReportChainReader => {
  const reader = new TaskReportChainReader({
    authContext: createTestPlatformAuthContext(),
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl: async () => {
      throw new Error('Test task report chain boundary was called unexpectedly.');
    },
    logger: NOOP_LOGGER,
  });
  vi.spyOn(reader, 'read').mockImplementation(read);
  return reader;
};

export const createTestReportSyncService = (
  executeSideEffect: ReportSyncService['executeSideEffect'] = async () => undefined,
): ReportSyncService => {
  const service = new ReportSyncService({
    oauthClient: createRunTestOAuthClient(),
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl: async () => {
      throw new Error('Test report sync boundary was called unexpectedly.');
    },
    runStore: createTestRunStore(),
    logger: NOOP_LOGGER,
  });
  vi.spyOn(service, 'executeSideEffect').mockImplementation(executeSideEffect);
  return service;
};

export const createTestMonitorProjectContext = (
  learnAndSubscribe: MonitorProjectContext['learnAndSubscribe'] = () => undefined,
): MonitorProjectContext => {
  const platformWebSocketManager = new PlatformWebSocketManager({
    serverUrl: 'https://ws.example.test',
    oauthClient: createRunTestOAuthClient(),
    logger: NOOP_LOGGER,
    keyPairStore: createTestKeyPairStore(),
  });
  const context = new MonitorProjectContext({
    runStore: createTestRunStore(),
    platformWebSocketManager,
    logger: NOOP_LOGGER,
  });
  vi.spyOn(context, 'learnAndSubscribe').mockImplementation(learnAndSubscribe);
  return context;
};

const createTestPlatformAuthContext = (
  resolve: PlatformAuthContext['resolve'] = async () => null,
): PlatformAuthContext => {
  const context = new PlatformAuthContext(
    createRunTestOAuthClient(),
    createTestMonitorProjectContext(),
    NOOP_LOGGER,
  );
  vi.spyOn(context, 'resolve').mockImplementation(resolve);
  return context;
};

type RunEventPublisherOverrides = Partial<
  Pick<
    RunEventPublisher,
    | 'publishAgentOutput'
    | 'emitAgentSessionCurrentStateObservation'
    | 'emitAgentSessionContextSizeObservation'
    | 'emitConversationPhaseObservation'
    | 'emitProviderIdentity'
  >
>;

/** Concrete process-event owner with public boundary methods narrowed to spies. */
export const createTestRunEventPublisher = (
  overrides: RunEventPublisherOverrides = {},
): RunEventPublisher => {
  const broadcaster = new RunEventPublisher({
    platformWebSocketManager: new PlatformWebSocketManager({
      serverUrl: 'https://ws.example.test',
      oauthClient: createRunTestOAuthClient(),
      logger: NOOP_LOGGER,
      keyPairStore: createTestKeyPairStore(),
    }),
    agentOutputEvents: new AgentOutputEvents(),
    runLifecycleEvents: new RunLifecycleEvents(),
    logger: NOOP_LOGGER,
  });
  vi.spyOn(broadcaster, 'publishAgentOutput').mockImplementation(
    overrides.publishAgentOutput ?? (() => undefined),
  );
  vi.spyOn(broadcaster, 'emitAgentSessionCurrentStateObservation').mockImplementation(
    overrides.emitAgentSessionCurrentStateObservation ?? (() => undefined),
  );
  vi.spyOn(broadcaster, 'emitAgentSessionContextSizeObservation').mockImplementation(
    overrides.emitAgentSessionContextSizeObservation ?? (() => undefined),
  );
  vi.spyOn(broadcaster, 'emitConversationPhaseObservation').mockImplementation(
    overrides.emitConversationPhaseObservation ?? (() => undefined),
  );
  vi.spyOn(broadcaster, 'emitProviderIdentity').mockImplementation(
    overrides.emitProviderIdentity ?? (() => undefined),
  );
  return broadcaster;
};

const createTestSession = (): AgenticSession =>
  ({
    entity: null,
    agentic_session_id: 'test-run-id',
    provider: 'claude',
    provider_session_id: null,
    provider_conversation_id: null,
    status: 'ACTIVE',
    services: [{ id: 'test-service-id', path: '/tmp/repo' }],
    launchServiceId: 'test-service-id',
    conversationId: 'test-conversation-id',
    contextMetadata: { organizationId: 'test-org-id', projectId: 'test-project-id' },
    events: [],
  }) as unknown as AgenticSession;

export const createTestRunRegistry = (
  get?: RunRegistry['get'],
  runFollowUpAdmission?: RunCollaborators['runFollowUpAdmission'],
): RunRegistry => {
  const ownership = createTestRunOwnership();
  const sessionRunnerFacade = createTestSessionRunnerFacade();
  const registry = new RunRegistry({
    runCollaborators: {
      runStore: createTestRunStore(),
      repoStore: createTestRepoMappingStore(),
      poster: createTestMessagePoster(),
      broadcaster: createTestRunEventPublisher(),
      handlerDeps: {} as never,
      promptTypeRegistry: ownership.promptTypeRegistry,
      submissionToolRegistry: ownership.submissionToolRegistry,
      runFollowUpAdmission: runFollowUpAdmission ?? ownership.runFollowUpAdmission,
      runnerPicker: createTestRunnerPicker(),
      logger: NOOP_LOGGER,
    },
    submissionToolRegistry: ownership.submissionToolRegistry,
    sessionRunnerFacade,
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents: new RunLifecycleEvents(),
  });
  if (get) {
    vi.spyOn(registry, 'get').mockImplementation(get);
  }
  return registry;
};

export const createTestRun = (
  args: Partial<RunArgs> = {},
  collaborators: Partial<RunCollaborators> = {},
): Run => {
  const ownership = createTestRunOwnership();
  return new Run(
    {
      runId: 'test-run-id',
      organizationId: 'test-org-id',
      projectId: 'test-project-id',
      conversationId: 'test-conversation-id',
      provider: 'claude',
      session: createTestSession(),
      ...args,
    },
    {
      runStore: createTestRunStore(),
      repoStore: createTestRepoMappingStore(),
      poster: createTestMessagePoster(),
      broadcaster: createTestRunEventPublisher(),
      handlerDeps: {} as never,
      promptTypeRegistry: ownership.promptTypeRegistry,
      submissionToolRegistry: ownership.submissionToolRegistry,
      runnerPicker: createTestRunnerPicker(),
      logger: NOOP_LOGGER,
      ...collaborators,
      runFollowUpAdmission: collaborators.runFollowUpAdmission ?? ownership.runFollowUpAdmission,
    },
  );
};

type TestWorkflowDispatchVerdict = WorkflowDispatchVerdict;

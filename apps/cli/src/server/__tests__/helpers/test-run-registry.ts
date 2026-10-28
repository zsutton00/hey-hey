/**
 * Test helper that wires the full Run runtime (registry + session runner +
 * runner picker) the way `RunApplicationRuntime` does in production, bundled
 * for tests that only need the registry's `create`/`get` surface plus a
 * poster and workflowsApi stub.
 *
 * Tests get back the concrete registry and prompt-type registry owners used
 * to construct `LocalAgentService`.
 *   - `workflowsApi` — a stub that throws when invoked; override per-test
 *     if your test actually hits workflow-defined sentinel resolution.
 *   - `runRegistry` — the live registry, for tests that want to peek at
 *     active Runs directly.
 */

import { vi } from 'vitest';
import { NOOP_LOGGER, type ServerLogger } from '../../logger';
import { stampCreateBody, stampUpdateData } from '../../../run/message-poster';
import type { MessagePosterCreateOutOfBandArgs, MessageStamp } from '../../../run/types';
import type { UpdateMessageDto } from '../../../shared/api/index';
import type { PromptTypeHandlerDeps } from '../../../agents/prompt-type-handler';
import {
  createPromptTypeHandlerTestDeps,
  createPromptTypeHandlerTestRunStore,
} from '../../../agents/prompt-type-handler.test-support';
import { PromptTypeRegistry } from '../../../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../../../agents/prompt-type-registry.test-support';
import { SubmissionToolRegistry } from '../../../agents/submission-tools/registry';
import type { RunStore } from '../../../run-store/run-store';
import type { RepoMappingStore } from '../../../repo/index';
import { RunnerPicker } from '../../../run/runners/pick-runner';
import { ChildAgentLauncher } from '../../../run/child-agent-launcher';
import { RunRegistry } from '../../../run/index';
import type { AgentSessionRunner } from '../../../agents/providers/session-runner';
import type { OAuthClient } from '../../../auth/index';
import type { AgenticSession } from '../../../session/types';
import { LocalAgentEndpoint } from '../../local-base-url';
import { RunChangedFilesReader } from '../../run-changed-files';
import type {
  MessagesGetMessageApiClient,
  WorkflowsPromptTypeApiClient,
} from '../../services/message.service';
import type { WorkflowDispatchVerdictReader } from '../../services/workflow-dispatch-verdict';
import type { LocalAgentServiceDependencies } from '../../local-agent-service';
import {
  createTestMessagePoster,
  createTestRunEventPublisher,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestSessionRunnerFacade,
  createTestWorkflowDispatchVerdictReader,
} from '../../../run/run.test-support';
import type { MessagePoster } from '../../../run/message-poster';
import type { RunEventPublisher } from '../../run-event-publisher';
import { createTestOAuthClient } from './test-oauth-client';
import { RunLifecycleEvents } from '../../run-lifecycle-events';
import type { ProjectModeBundleMaterializer } from '../../../agents/project-mode';

export const LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES = {
  logger: NOOP_LOGGER,
  apiBaseUrl: 'http://local-agent-service.test',
  fetchImpl: async () => {
    throw new Error('Test LocalAgentService did not configure the platform HTTP boundary.');
  },
  readCcusageSessionJson: async () => {
    throw new Error('Test LocalAgentService did not configure the ccusage boundary.');
  },
} satisfies Pick<
  LocalAgentServiceDependencies,
  'logger' | 'apiBaseUrl' | 'fetchImpl' | 'readCcusageSessionJson'
>;

export interface TestRunRegistryWiring {
  poster: MessagePoster;
  runRegistry: RunRegistry;
  promptTypeRegistry: PromptTypeRegistry;
  workflowsApi: WorkflowsPromptTypeApiClient;
  messagesApi: MessagesGetMessageApiClient;
}

/**
 * Stub `WorkflowsApi` for tests that never hit the `workflow-defined`
 * sentinel-resolver path. Rejects when invoked so a misrouted test fails
 * loud rather than silently. Tests that need real resolver behavior
 * inject their own mock directly.
 */
const createTestWorkflowsApi = (): WorkflowsPromptTypeApiClient => ({
  getConversationPromptType: async () => {
    throw new Error(
      'Test did not configure a WorkflowsApi stub — workflow-defined sentinel resolution is unavailable.',
    );
  },
});

/**
 * Stub `MessagesApi.getMessage` for tests that never hit the
 * workflow-defined trigger-payload fetch path. Rejects when invoked so a
 * misrouted test fails loud rather than silently. Tests that need real
 * fetch behavior inject their own mock directly.
 */
const createTestMessagesApi = (): MessagesGetMessageApiClient => ({
  getMessage: vi.fn(async () => {
    throw new Error(
      'Test did not configure a MessagesApi.getMessage stub — workflow-defined trigger-payload fetch is unavailable.',
    );
  }),
});

/**
 * Default workflow verdict for tests: `agent-pending` with a placeholder
 * pair. Tests that need another verdict override
 * `getWorkflowDispatchVerdict` in their harness call.
 */
const createAlwaysFreshWorkflowDispatchVerdict = (
  overrides: { promptType?: string; externalAgentNodeId?: string; triggerMessageId?: string } = {},
): WorkflowDispatchVerdictReader => {
  const verdict = {
    state: 'agent-pending',
    promptType: overrides.promptType ?? 'coding_freeform',
    externalAgentNodeId: overrides.externalAgentNodeId ?? 'test-node-id',
    triggerMessageId: overrides.triggerMessageId ?? 'test-trigger-id',
  } as const;
  return createTestWorkflowDispatchVerdictReader(async () => verdict);
};

let counter = 0;

/**
 * Mock poster that applies the real seam's stamping logic so test assertions
 * on `dto.data['providerSessionId']` / `dto.data['promptHandler']` continue
 * to read the stamped payload after callers route through the seam. The
 * mutation is applied in-place on the captured args so
 * `(poster.createOutOfBand as vi.fn).mock.calls[0]![0]` exposes the
 * stamped dto.
 */
export const createNoopMessagePoster = (): MessagePoster =>
  createTestMessagePoster({
    createOutOfBand: vi.fn(async (args: MessagePosterCreateOutOfBandArgs) => {
      args.dto = stampCreateBody(args.dto, args.stamp);
      return `test-oob-${String(++counter)}`;
    }),
    update: vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _messageId: string,
        data: UpdateMessageDto,
        stamp: MessageStamp | null,
      ) => {
        const stamped = stampUpdateData(data, stamp);
        Object.assign(data, stamped);
      },
    ),
    complete: vi.fn(
      async (
        _organizationId: string,
        _projectId: string,
        _messageId: string,
        data: UpdateMessageDto,
        stamp: MessageStamp | null,
      ) => {
        const stamped = stampUpdateData(data, stamp);
        Object.assign(data, stamped);
      },
    ),
  });

const createStubRunStore = (): RunStore => {
  const store = createPromptTypeHandlerTestRunStore();
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue({} as AgenticSession);
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue({} as AgenticSession);
  vi.spyOn(store, 'recordRunStartedPromptType').mockResolvedValue({} as AgenticSession);
  return store;
};

const createStubRepoStore = (): RepoMappingStore => createTestRepoMappingStore();

const createStubHandlerDeps = (): PromptTypeHandlerDeps =>
  createPromptTypeHandlerTestDeps({
    runStore: createStubRunStore(),
    fetchImpl: (async () => new Response()) as unknown as typeof fetch,
    apiBaseUrl: 'http://stub',
    logger: NOOP_LOGGER,
  });

const createStubSessionRunner = (): Pick<AgentSessionRunner, 'runPrompt' | 'resumeSession'> => ({
  runPrompt: vi.fn().mockResolvedValue({
    providerSessionId: null,
    providerConversationId: null,
    errorCount: 0,
  }),
  resumeSession: vi.fn().mockResolvedValue({
    providerSessionId: null,
    providerConversationId: null,
    errorCount: 0,
  }),
});

export interface CreateTestRunRegistryWiringOptions {
  poster?: MessagePoster;
  logger?: ServerLogger;
  runStore?: RunStore;
  repoStore?: RepoMappingStore;
  handlerDeps?: PromptTypeHandlerDeps;
  broadcaster?: RunEventPublisher;
  sessionRunner?: Pick<AgentSessionRunner, 'runPrompt' | 'resumeSession'>;
  oauthClient?: OAuthClient;
  runChangedFilesReader?: RunChangedFilesReader;
  /** Override the default `agent-pending` verdict source. */
  workflowDispatchVerdictReader?: WorkflowDispatchVerdictReader;
  projectModeBundleMaterializer?: ProjectModeBundleMaterializer;
}

export const createTestRunRegistryWiring = (
  overrides: CreateTestRunRegistryWiringOptions = {},
): TestRunRegistryWiring => {
  const poster = overrides.poster ?? createNoopMessagePoster();
  const logger = overrides.logger ?? NOOP_LOGGER;
  const runStore = overrides.runStore ?? createStubRunStore();
  const repoStore = overrides.repoStore ?? createStubRepoStore();
  const handlerDeps = overrides.handlerDeps ?? createStubHandlerDeps();
  const broadcaster = overrides.broadcaster ?? createTestRunEventPublisher();
  const sessionRunner = overrides.sessionRunner ?? createStubSessionRunner();
  const oauthClient =
    overrides.oauthClient ??
    createTestOAuthClient({
      getAccessToken: async () => ({ success: false, error: 'stub' }),
    });

  const submissionToolRegistry = new SubmissionToolRegistry();
  const promptTypeRegistry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  const sessionRunnerFacade = createTestSessionRunnerFacade(sessionRunner as AgentSessionRunner);
  const localAgentEndpoint = new LocalAgentEndpoint();
  const childAgentLauncher = new ChildAgentLauncher({
    handlerDeps: createPromptTypeHandlerTestDeps(),
    promptTypeRegistry,
    repoStore,
    oauthClient,
    submissionToolRegistry,
    localAgentEndpoint,
    logger,
  });
  const runnerPicker = new RunnerPicker({
    sessionRunnerFacade,
    childAgentLauncher,
    logger,
    runChangedFilesReader: overrides.runChangedFilesReader ?? createTestRunChangedFilesReader(),
  });

  const workflowDispatchVerdictReader =
    overrides.workflowDispatchVerdictReader ?? createAlwaysFreshWorkflowDispatchVerdict();

  const runRegistry = new RunRegistry({
    runCollaborators: {
      runStore,
      repoStore,
      poster,
      broadcaster,
      handlerDeps,
      promptTypeRegistry,
      submissionToolRegistry,
      runnerPicker,
      logger,
      workflowDispatchVerdictReader,
      runFollowUpAdmission: {
        admit: async () => ({ replayed: false }),
        durableInputReady: () => {},
      },
      ...(overrides.projectModeBundleMaterializer
        ? { projectModeBundleMaterializer: overrides.projectModeBundleMaterializer }
        : {}),
    },
    submissionToolRegistry,
    sessionRunnerFacade,
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents: new RunLifecycleEvents(),
  });

  return {
    poster,
    runRegistry,
    promptTypeRegistry,
    workflowsApi: createTestWorkflowsApi(),
    messagesApi: createTestMessagesApi(),
  };
};

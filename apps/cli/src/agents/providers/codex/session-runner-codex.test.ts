import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import fs from 'node:fs/promises';
import { ProviderUsageStore } from '../../../provider-usage/provider-usage-store';
import os from 'node:os';
import path from 'node:path';
import { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import { ExecutionCaptureSession } from '../execution-recorder/capture-session';
import { NOOP_LOGGER } from '../../../server/logger';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CodexNoContextSnapshotError } from '@hey-hey/ui-common/agents';
import type { LocalContextData } from '../../../shared/agent-bridge-contract/contract';
import { toServiceId, type RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import type { ServerLogger } from '../../../server/logger';
import type { AgenticSession } from '../../../session/index';
import { WorkStatus } from '../../../shared/api/generated/api';
import type { ProjectMaturity, WorkItemTypeDefinitionDto } from '../../../shared/api/index';
import {
  buildPlatformSystemPrompt,
  intentFirstGuidance,
  takingShapeGuidance,
} from '../../prompts/common';
import { renderWorkItemTypeOntologyEntry } from '../../prompts/render-type-ontology';
import { translatePermissionDecisionToDispatch } from '../../permission-response-routing';
import {
  CodexAgentSessionRunner,
  resolveCodexPlatformPromptDeliveryMode,
  resolveCodexRepositoryResearchPosture,
} from './session-runner-codex';
import { CodexSkillCatalog } from './codex-skill-catalog';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import type { SubmissionToolDeclaration } from '../../submission-tools/types';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE } from '../platform-prompt-delivery';
import {
  createProviderTestAgentOutputOwner,
  createProviderTestRepoMappingStore,
  createProviderTestRunStore,
} from '../provider-owner.test-support';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../../auth/oauth-client.test-support';
import { DAILY_SESSION_MONITOR_LOG_EVENT } from '../../../shared/logging/daily-session';

const localAgentEndpoint = new LocalAgentEndpoint();
const submissionToolRegistry = new SubmissionToolRegistry();

describe('Codex repository research posture', () => {
  it('preserves the selected model and effort for runtime-native children', () => {
    expect(
      resolveCodexRepositoryResearchPosture({
        delegation: 'allowed',
        model: 'gpt-selected',
        effort: 'high',
      }),
    ).toEqual({
      filesystemPosture: 'read-only',
      delegationRequested: true,
      delegationAvailability: 'runtime-configured',
      childModel: 'gpt-selected',
      childEffort: 'high',
    });
  });
});

type BuildMcpServerConfigMock = (
  oauthClient: unknown,
  context: Record<string, unknown>,
  options?: Record<string, unknown>,
) => Promise<{
  mcpServers: Record<string, { type: string; url: string; headers?: Record<string, string> }>;
  allowedTools: string[];
}>;

const buildMcpServerConfigMock = vi.fn<BuildMcpServerConfigMock>(async () => ({
  mcpServers: {
    'heyhey-platform': {
      type: 'http',
      url: 'https://heyhey.dev/mcp',
      headers: {
        Authorization: 'Bearer access-token',
        'X-Project-ID': 'project-1',
      },
    },
  },
  allowedTools: ['mcp__heyhey-platform__get_context'],
}));
vi.mock('../../mcp-server-config', async () => {
  const actual =
    await vi.importActual<typeof import('../../mcp-server-config')>('../../mcp-server-config');
  return {
    ...actual,
    buildMcpServerConfig: (...args: Parameters<typeof buildMcpServerConfigMock>) =>
      buildMcpServerConfigMock(...args),
  };
});

// ---------------------------------------------------------------------------
// CodexSdkClient fake
//
// The runner drives the native JSON-RPC client exclusively. It registers an
// event handler (`onEvent`) and a ServerRequest handler (`onServerRequest`)
// before awaiting `startSession`/`resumeSession`; in the real client those
// resolve when the app-server emits `turn/completed`. The fake models this by
// delegating the lifecycle calls to vi.fns whose implementation a test fills in
// — typically emitting a stream of `{method, params}` ServerNotifications and
// then resolving. `getSessionId()` reads a vi.fn that the event helper updates
// from `thread/started`, mirroring how the native client captures the codex
// `thread_id`. The `emitSdk*` helpers and the ServerRequest path feed the
// runner's real handlers; nothing here re-implements the runner's logic.
// ---------------------------------------------------------------------------

interface SdkServerRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

let sdkEventHandler:
  | ((event: { method: string; params?: Record<string, unknown> }) => void)
  | null = null;
let sdkServerRequestHandler: ((request: SdkServerRequest) => void) | null = null;
let sdkRootThreadId: string | null = null;
let sdkRootTurnId: string | null = null;
const sdkStartSessionMock = vi.fn();
const sdkResumeSessionMock = vi.fn();
const sdkDisconnectMock = vi.fn();
const sdkGetSessionIdMock = vi.fn();
const sdkCompactMock = vi.fn();
const sdkGetContextUsageMock = vi.fn();
const sdkGetContextUsageByResumeMock = vi.fn();
const sdkSubmitClientResponseMock = vi.fn();

const fakeSubmissionTool: SubmissionToolDeclaration = {
  name: 'submit_research',
  description: 'Submit the research output.',
  inputSchema: { type: 'object', properties: {}, required: [] },
  execute: async () => ({ action: 'SUBMIT_RESEARCH' }),
};

const readSessionStartContextMock = vi.fn(
  async (
    _input: unknown,
  ): Promise<{
    workItemTypeDefinitions: WorkItemTypeDefinitionDto[];
    intentFirst: boolean;
    maturity: ProjectMaturity;
  }> => ({
    workItemTypeDefinitions: [],
    intentFirst: false,
    maturity: 'ESTABLISHED',
  }),
);
vi.mock('../../prompts/session-start-context', () => ({
  readSessionStartContext: (input: unknown) => readSessionStartContextMock(input),
}));

// Two registry snapshots that differ by exactly an add (SPIKE) and an edit
// (CONTRACT's purpose). The seam tests drive the shared session-start entry
// point with each in turn and assert the prepended platform prompt tracks
// whichever the stubbed read returns — proving a registry change alone
// re-shapes the next session's ontology with no builder or runner edit.
const TYPE_DEF_BASE: Pick<WorkItemTypeDefinitionDto, 'sections' | 'allowedStatuses'> = {
  sections: [],
  allowedStatuses: [WorkStatus.Active],
};
const baselineContract: WorkItemTypeDefinitionDto = {
  ...TYPE_DEF_BASE,
  key: 'CONTRACT',
  name: 'Contract',
  role: 'project-info',
  description: 'Legal agreements and SLAs.',
  allowedParentTypes: ['FEATURE'],
};
const editedContract: WorkItemTypeDefinitionDto = {
  ...baselineContract,
  description: 'Vendor contracts, renewals, and SLAs.',
};
const addedSpike: WorkItemTypeDefinitionDto = {
  ...TYPE_DEF_BASE,
  key: 'SPIKE',
  name: 'Spike',
  role: 'work-item',
  description: 'A timeboxed investigation to reduce uncertainty.',
  allowedParentTypes: ['FEATURE'],
};
const BASELINE_DEFINITIONS = [baselineContract];
const EDITED_DEFINITIONS = [editedContract, addedSpike];

vi.mock('@hey-hey/ui-common/agents', async () => {
  const actual = await vi.importActual<typeof import('@hey-hey/ui-common/agents')>(
    '@hey-hey/ui-common/agents',
  );
  return {
    ...actual,
    CodexSdkClient: class {
      startSession(...args: Parameters<typeof sdkStartSessionMock>) {
        return sdkStartSessionMock(...args);
      }
      resumeSession(...args: Parameters<typeof sdkResumeSessionMock>) {
        return sdkResumeSessionMock(...args);
      }
      onEvent(
        handler: ((event: { method: string; params?: Record<string, unknown> }) => void) | null,
      ) {
        sdkEventHandler = handler;
      }
      onServerRequest(handler: ((request: SdkServerRequest) => void) | null) {
        sdkServerRequestHandler = handler;
      }
      getSessionId() {
        return sdkGetSessionIdMock();
      }
      getRootTurnIdentity() {
        return sdkRootThreadId && sdkRootTurnId
          ? { threadId: sdkRootThreadId, turnId: sdkRootTurnId }
          : null;
      }
      disconnect(...args: Parameters<typeof sdkDisconnectMock>) {
        return sdkDisconnectMock(...args);
      }
      compact(...args: Parameters<typeof sdkCompactMock>) {
        return sdkCompactMock(...args);
      }
      getContextUsage(...args: Parameters<typeof sdkGetContextUsageMock>) {
        return sdkGetContextUsageMock(...args);
      }
      getContextUsageByResume(...args: Parameters<typeof sdkGetContextUsageByResumeMock>) {
        return sdkGetContextUsageByResumeMock(...args);
      }
      submitClientResponse(...args: Parameters<typeof sdkSubmitClientResponseMock>) {
        return sdkSubmitClientResponseMock(...args);
      }
    },
  };
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

const createDeferred = <T>(): Deferred<T> => {
  let resolve: ((value: T) => void) | null = null;
  let reject: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  if (!resolve || !reject) {
    throw new Error('Failed to construct deferred promise.');
  }

  return { promise, resolve, reject };
};

// Feed a raw Codex ServerNotification into the runner's live event handler.
// `thread/started` carries the native session identity, so mirror the native
// client and surface its id through getSessionId() once it arrives.
const emitSdkEvent = (method: string, params: Record<string, unknown> = {}): void => {
  if (method === 'thread/started') {
    const thread = (params as { thread?: { id?: unknown } }).thread;
    if (typeof thread?.id === 'string' && sdkRootThreadId === null) {
      sdkRootThreadId = thread.id;
      sdkRootTurnId = 'codex-root-turn-1';
      sdkGetSessionIdMock.mockReturnValue(thread.id);
    }
  }
  const nestedTurn = isTestRecord(params['turn']) ? params['turn'] : null;
  if (method === 'turn/started') {
    const startedThreadId = typeof params['threadId'] === 'string' ? params['threadId'] : null;
    const startedTurnId =
      typeof params['turnId'] === 'string'
        ? params['turnId']
        : typeof nestedTurn?.['id'] === 'string'
          ? nestedTurn['id']
          : null;
    if (startedThreadId === sdkRootThreadId && startedTurnId) {
      sdkRootTurnId = startedTurnId;
    }
  }
  const routedTurnId =
    typeof params['turnId'] === 'string'
      ? params['turnId']
      : typeof nestedTurn?.['id'] === 'string'
        ? nestedTurn['id']
        : sdkRootTurnId;
  const routedParams =
    method === 'thread/started' || sdkRootThreadId === null || sdkRootTurnId === null
      ? params
      : {
          threadId: sdkRootThreadId,
          turnId: routedTurnId,
          ...params,
          ...(method === 'turn/started' || method === 'turn/completed'
            ? {
                turn: {
                  id: routedTurnId,
                  ...(nestedTurn ?? {}),
                },
              }
            : {}),
        };
  sdkEventHandler?.({ method, params: routedParams });
};

const isTestRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// Feed a raw Codex ServerRequest (e.g. a permission approval) into the runner's
// live ServerRequest handler.
const emitSdkServerRequest = (request: SdkServerRequest): void => {
  sdkServerRequestHandler?.(request);
};

// A `startSession`/`resumeSession` implementation that streams a clean turn:
// `thread/started` (captures the thread id), an optional assistant message, then
// the terminal `turn/completed`. Resolves like the native lifecycle does on the
// turn boundary.
const completedTurn =
  (threadId = 'codex-thread-1', { withAssistant = true }: { withAssistant?: boolean } = {}) =>
  async (): Promise<void> => {
    sdkRootThreadId = null;
    sdkRootTurnId = null;
    emitSdkEvent('thread/started', { thread: { id: threadId } });
    if (withAssistant) {
      emitSdkEvent('item/completed', { item: { type: 'agentMessage', text: 'Done.' } });
    }
    emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
  };

const createContextMetadata = () => ({
  capturedAt: '2026-02-20T00:00:00.000Z',
  organizationId: 'org-1',
  projectId: 'project-1',
  agentSessionId: 'agent-session-1',
  launchPlanId: 'plan-1',
  launchStepId: 'step-1',
  task: {
    id: 'task-1',
    name: 'Task one',
    type: 'STANDARD' as const,
    organizationId: 'org-1',
    projectId: 'project-1',
    initiativeId: 'initiative-1',
    status: 'ACTIVE' as const,
    source: 'user' as const,
  },
  userComments: [],
  fileReferences: {
    resolved: [],
    unresolved: [],
  },
});

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession => {
  const base: AgenticSession = {
    entity: null,
    agentic_session_id: 'agentic-1',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    provider: 'codex',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    provider_session_agent_id: 'test-agent',
    status: 'idle',
    conversationId: 'conv-1',
    contextMetadata: createContextMetadata(),
    createdAt: '2026-02-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
    events: [],
  };

  return {
    ...base,
    ...overrides,
    contextMetadata: overrides.contextMetadata ?? base.contextMetadata,
    events: overrides.events ?? base.events,
  };
};

const makeContextData = (): LocalContextData => ({
  categories: [],
  totalTokens: 5000,
  maxTokens: 20000,
  rawMaxTokens: 20000,
  percentage: 25,
  gridRows: [],
  model: 'gpt-5-codex',
  memoryFiles: [],
  mcpTools: [],
  agents: [],
  isAutoCompactEnabled: false,
  apiUsage: null,
});

const makeRunStore = (): RunStore => createProviderTestRunStore(makeSession);

const makeRepoStore = (repositoryPath = '/tmp/repo'): RepoMappingStore =>
  createProviderTestRepoMappingStore(repositoryPath);

const makeLogger = (): {
  logger: ServerLogger;
  debug: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
} => {
  const trace = vi.fn();
  const debug = vi.fn();
  const info = vi.fn();
  const warn = vi.fn();
  const error = vi.fn();
  let logger!: ServerLogger;
  const child = vi.fn<ServerLogger['child']>(() => logger);
  logger = {
    trace,
    debug,
    info,
    warn,
    error,
    child,
  };
  return { logger, debug, info, warn, error };
};

const getPersistedProviderEventTypes = (runStore: RunStore): string[] =>
  vi
    .mocked(runStore.appendEvent)
    .mock.calls.map(([, event]) => {
      if (event.event_type !== 'agent_output' || event.actor !== 'agent') {
        return null;
      }
      if (!event.payload || typeof event.payload !== 'object') {
        return null;
      }
      const payloadRecord = event.payload as Record<string, unknown>;
      if (payloadRecord['messageType'] !== 'provider_event') {
        return null;
      }
      const eventType = payloadRecord['eventType'];
      return typeof eventType === 'string' ? eventType : null;
    })
    .filter((eventType): eventType is string => eventType !== null);

const getPersistedProviderPayload = (
  runStore: RunStore,
  eventType: string,
): Record<string, unknown> | null => {
  for (const [, event] of vi.mocked(runStore.appendEvent).mock.calls) {
    if (event.event_type !== 'agent_output' || event.actor !== 'agent') {
      continue;
    }
    if (!event.payload || typeof event.payload !== 'object') {
      continue;
    }
    const payloadRecord = event.payload as Record<string, unknown>;
    if (payloadRecord['messageType'] !== 'provider_event') {
      continue;
    }
    if (payloadRecord['eventType'] !== eventType) {
      continue;
    }
    return payloadRecord;
  }
  return null;
};

describe('session-runner-codex', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sdkEventHandler = null;
    sdkServerRequestHandler = null;
    sdkRootThreadId = null;
    sdkRootTurnId = null;
    // By default the native lifecycle streams a clean turn and resolves; the
    // resolved thread id is the canonical session identity.
    sdkStartSessionMock.mockImplementation(completedTurn());
    sdkResumeSessionMock.mockImplementation(completedTurn());
    sdkDisconnectMock.mockResolvedValue(undefined);
    sdkGetSessionIdMock.mockReturnValue('codex-thread-1');
    sdkCompactMock.mockResolvedValue(undefined);
    sdkGetContextUsageByResumeMock.mockResolvedValue(makeContextData());
    sdkSubmitClientResponseMock.mockReturnValue(undefined);
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: [],
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    buildMcpServerConfigMock.mockResolvedValue({
      mcpServers: {
        'heyhey-platform': {
          type: 'http',
          url: 'https://heyhey.dev/mcp',
          headers: {
            Authorization: 'Bearer access-token',
            'X-Project-ID': 'project-1',
          },
        },
      },
      allowedTools: ['mcp__heyhey-platform__get_context'],
    });
    submissionToolRegistry.clearAll();
    localAgentEndpoint.clear();
  });

  // ----- native lifecycle: fresh start / resume -----------------------------

  it.each([false, true])(
    'persists account-wide limits on fresh/resumed runs (resume=%s)',
    async (resume) => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-plan-limits-'));
      vi.stubEnv('HEYHEY_SESSION_DIR', root);
      const report = async () => {
        sdkEventHandler?.({
          method: 'account/rateLimits/updated',
          params: {
            rateLimits: {
              primary: { windowDurationMins: 10080, usedPercent: 41, resetsAt: 0 },
              secondary: { windowDurationMins: 300, usedPercent: 0 },
            },
          },
        });
        await completedTurn()();
      };
      sdkStartSessionMock.mockImplementation(report);
      sdkResumeSessionMock.mockImplementation(report);
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
      });
      try {
        await runner.runPrompt({
          session: makeSession({ provider_session_id: resume ? 'codex-thread-1' : 'pending_abc' }),
          prompt: 'Capture limits.',
        });
        expect(await new ProviderUsageStore(root).read('codex')).toMatchObject({
          status: 'reported',
          usage: {
            fiveHour: { usedPercent: 0, resetsAt: null },
            weekly: { usedPercent: 41, resetsAt: '1970-01-01T00:00:00.000Z' },
          },
        });
      } finally {
        await runner.dispose();
        vi.unstubAllEnvs();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );

  it.each([false, true])(
    'passes trusted capture transport through fresh/resumed launch (resume=%s)',
    async (resume) => {
      const launch = {
        command: 'fixture-hook',
        environment: {
          HEY_HEY_CAPTURE_URL: 'http://127.0.0.1:12345/',
          HEY_HEY_CAPTURE_TOKEN: 'fixture-token',
        },
      };
      const open = vi.spyOn(ExecutionCaptureSession.prototype, 'open').mockResolvedValue(launch);
      const close = vi.spyOn(ExecutionCaptureSession.prototype, 'close').mockResolvedValue();
      try {
        const owner = createProviderTestAgentOutputOwner(vi.fn());
        const runner = new CodexAgentSessionRunner({
          localAgentEndpoint,
          submissionToolRegistry,
          runStore: makeRunStore(),
          repoStore: makeRepoStore(),
          agentOutputOwner: owner,
          executionRecorder: new ExecutionRecorder(
            path.join(os.tmpdir(), 'unused-capture-fixture'),
            NOOP_LOGGER,
          ),
        });
        await runner.runPrompt({
          session: makeSession(resume ? { provider_session_id: 'codex-thread-1' } : {}),
          prompt: 'Capture this edit.',
        });
        const launchMock = resume ? sdkResumeSessionMock : sdkStartSessionMock;
        expect(launchMock.mock.calls[0]?.[resume ? 1 : 0]).toMatchObject({
          toolExecutionHooks: launch,
        });
        expect(open).toHaveBeenCalledWith(
          owner,
          expect.objectContaining({ allowedRepositoryRoots: expect.any(Array) }),
        );
        expect(close).toHaveBeenCalled();
      } finally {
        open.mockRestore();
        close.mockRestore();
      }
    },
  );

  it.each(['fresh', 'resume'] as const)(
    'forwards attachment content to Codex %s requests',
    async (mode) => {
      const references = [{ attachmentId: 'stored-reference', fileName: 'notes.md' }];
      const content = [
        { kind: 'text' as const, fileName: 'notes.md', text: 'private attachment contents' },
      ];
      const read = vi
        .spyOn(RunAttachmentContentReader.prototype, 'read')
        .mockResolvedValue(content);
      const inputItem = {
        type: 'userMessage',
        id: 'user-input',
        content: [
          { type: 'text', text: 'private attachment contents' },
          { type: 'image', url: 'data:image/png;base64,cHJpdmF0ZQ==' },
        ],
      };
      const assistantItem = {
        type: 'agentMessage',
        id: 'assistant-output',
        text: 'Read the file.',
      };
      const sendSnapshots = async () => {
        emitSdkEvent('thread/started', {
          thread: {
            id: 'codex-thread-1',
            turns: [{ id: 'previous-turn', items: [inputItem, assistantItem] }],
          },
        });
        emitSdkEvent('item/completed', { item: inputItem });
        emitSdkEvent('turn/completed', {
          turn: { status: 'completed', items: [inputItem, assistantItem] },
        });
      };
      sdkStartSessionMock.mockImplementation(sendSnapshots);
      sdkResumeSessionMock.mockImplementation(sendSnapshots);
      const runStore = makeRunStore();
      const { logger } = makeLogger();
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore,
        repoStore: makeRepoStore(),
        logger,
      });
      const session = makeSession(
        mode === 'fresh' ? {} : { provider_session_id: 'codex-thread-1' },
      );
      try {
        if (mode === 'fresh')
          await runner.runPrompt({
            session,
            prompt: '  Read this.\n',
            attachmentRunId: 'owning-run',
            attachments: references,
          });
        else
          await runner.resumeSession({
            session,
            prompt: '  Read this.\n',
            attachmentRunId: 'owning-run',
            attachments: references,
          });
        const config =
          mode === 'fresh'
            ? sdkStartSessionMock.mock.calls[0]?.[0]
            : sdkResumeSessionMock.mock.calls[0]?.[1];
        expect(config).toMatchObject({ prompt: '  Read this.\n', attachments: content });
        expect(read).toHaveBeenCalledWith('owning-run', references, expect.anything());
        const durable = JSON.stringify(vi.mocked(runStore.appendEvent).mock.calls);
        expect(durable).not.toContain('private attachment contents');
        expect(durable).not.toContain('data:image/png;base64,cHJpdmF0ZQ==');
        expect(durable).toContain('Read the file.');
        const diagnostics = JSON.stringify(vi.mocked(logger.trace).mock.calls);
        expect(diagnostics).not.toContain('private attachment contents');
        expect(diagnostics).not.toContain('data:image/png;base64,cHJpdmF0ZQ==');
        expect(diagnostics).toContain('Read the file.');
      } finally {
        read.mockRestore();
      }
    },
  );

  it('runs a fresh codex session via startSession and persists the captured thread id', async () => {
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-1'));
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    const result = await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the test suite.',
    });

    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    expect(sdkResumeSessionMock).not.toHaveBeenCalled();
    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['prompt']).toBe('Run the test suite.');
    expect(startConfig['cwd']).toBe(path.join(await fs.realpath('/tmp'), 'repo'));
    expect(result).toEqual({
      providerSessionId: 'codex-thread-1',
      providerConversationId: null,
      errorCount: 0,
    });
    expect(runStore.updateRunProviderIdentity).toHaveBeenCalledWith('agentic-1', {
      providerSessionId: 'codex-thread-1',
      providerConversationId: null,
      providerSessionAgentId: 'test-agent',
    });
    expect(runStore.updateRunStatus).toHaveBeenNthCalledWith(1, 'agentic-1', 'running');
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'complete');
  });

  it('isolates project reports from repository, generic context, and native provider tools', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    const registration = submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [{ ...fakeSubmissionTool, name: 'create_report' }],
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient(),
    });

    const session = makeSession({ services: [] });
    delete session.launchServiceId;
    await runner.runPrompt({
      session,
      prompt: 'Create the report from the provided evidence.',
      mcpToolUseCase: 'project_report',
      platformMcpProxyMount: {
        runId: 'agentic-1',
        turnId: 'turn-project-report',
        token: 'proxy-token',
        allowedTools: ['mcp__heyhey-platform__get_report_schema'],
      },
      readOnlyFilesystem: true,
      builtinTools: [],
    });

    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const cwd = String(startConfig['cwd']);
    expect(cwd).toContain('heyhey-provider-isolated-');
    await expect(fs.access(cwd)).rejects.toThrow();
    expect(readSessionStartContextMock).not.toHaveBeenCalled();
    expect(startConfig['prompt']).not.toContain('Maturity stage');
    expect(buildMcpServerConfigMock).not.toHaveBeenCalled();
    expect(startConfig['sandbox']).toBe('read-only');
    expect(startConfig['config']).toMatchObject({
      mcp_servers: {
        'heyhey-platform': {
          url: 'http://127.0.0.1:3847/mcp/platform/agentic-1/turn-project-report/proxy-token',
        },
        'heyhey-submission-tools': {
          url: `http://127.0.0.1:3847/mcp/submission-tools/${registration.token}`,
        },
      },
      features: {
        shell_tool: false,
        unified_exec: false,
        view_image: false,
        code_mode: false,
      },
    });
    const activeMcpPolicy = (
      runner as unknown as {
        summarizeActiveMcpPolicy: (requestedQualifiedToolName: string | null) => {
          activeHeyHeyPlatformAllowedTools: string[];
        };
      }
    ).summarizeActiveMcpPolicy(null);
    expect(activeMcpPolicy.activeHeyHeyPlatformAllowedTools).toEqual([
      'mcp__heyhey-platform__get_report_schema',
    ]);
  });

  it('starts git-backed write-capable sessions with the Codex Auto sandbox when no Codex permission default is configured', async () => {
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-codex-runner-repo-'));
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-codex-home-'));
    const previousCodexHome = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = codexHome;
    try {
      await fs.mkdir(path.join(repoDir, '.git'));
      sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-1'));
      const runStore = makeRunStore();
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore,
        repoStore: makeRepoStore(repoDir),
      });

      await runner.runPrompt({
        session: makeSession({
          services: [{ id: 'svc-1', path: repoDir }],
        }),
        prompt: 'Run the test suite.',
      });

      const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(startConfig['sandbox']).toBe('workspace-write');
      expect(startConfig['processLaunch']).toBeUndefined();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env['CODEX_HOME'];
      } else {
        process.env['CODEX_HOME'] = previousCodexHome;
      }
      await Promise.all([
        fs.rm(repoDir, { recursive: true, force: true }),
        fs.rm(codexHome, { recursive: true, force: true }),
      ]);
    }
  });

  it('passes selected additional service roots as Codex extra writable dirs for fresh sessions', async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-codex-runner-workspace-'));
    const repoDir = path.join(workspaceDir, 'service-a');
    const otherRepoDir = path.join(workspaceDir, 'service-b');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-codex-home-'));
    const previousCodexHome = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = codexHome;
    try {
      await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
      await fs.mkdir(path.join(otherRepoDir, '.git'), { recursive: true });
      const canonicalRepoDir = await fs.realpath(repoDir);
      const canonicalOtherRepoDir = await fs.realpath(otherRepoDir);
      sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-1'));
      const runStore = makeRunStore();
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore,
        repoStore: makeRepoStore(repoDir),
      });

      await runner.runPrompt({
        session: makeSession({
          services: [
            { id: 'svc-1', path: repoDir },
            { id: 'svc-2', path: otherRepoDir },
          ],
          launchServiceId: 'svc-1',
        }),
        prompt: 'Run the test suite.',
      });

      const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(startConfig['cwd']).toBe(canonicalRepoDir);
      expect(startConfig['sandbox']).toBe('workspace-write');
      expect(startConfig['extraWritableDirs']).toEqual([canonicalOtherRepoDir]);
      expect(startConfig['config']).toMatchObject({
        sandbox_workspace_write: { writable_roots: [canonicalOtherRepoDir] },
      });
      const runStartedPayload = vi
        .mocked(runStore.appendEvent)
        .mock.calls.find(([, event]) => event.event_type === 'run_started')?.[1].payload as Record<
        string,
        unknown
      >;
      expect(runStartedPayload['providerStart']).toMatchObject({
        provider: 'codex',
        action: 'startSession',
        cwd: canonicalRepoDir,
        sandboxMode: 'workspace-write',
        serviceCount: 2,
        launchServiceId: 'svc-1',
        allowedRepositoryRoots: [canonicalRepoDir, canonicalOtherRepoDir],
        extraWritableDirCount: 1,
        extraWritableDirs: [canonicalOtherRepoDir],
      });
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env['CODEX_HOME'];
      } else {
        process.env['CODEX_HOME'] = previousCodexHome;
      }
      await Promise.all([
        fs.rm(workspaceDir, { recursive: true, force: true }),
        fs.rm(codexHome, { recursive: true, force: true }),
      ]);
    }
  });

  it('passes selected additional service roots as Codex extra writable dirs for resumed sessions', async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-codex-runner-workspace-'));
    const repoDir = path.join(workspaceDir, 'service-a');
    const otherRepoDir = path.join(workspaceDir, 'service-b');
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-codex-home-'));
    const previousCodexHome = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = codexHome;
    try {
      await fs.mkdir(path.join(repoDir, '.git'), { recursive: true });
      await fs.mkdir(path.join(otherRepoDir, '.git'), { recursive: true });
      const canonicalRepoDir = await fs.realpath(repoDir);
      const canonicalOtherRepoDir = await fs.realpath(otherRepoDir);
      const workspace = {
        ok: true as const,
        runMode: 'default' as const,
        repositoryPathForRunStarted: canonicalRepoDir,
        cwd: canonicalRepoDir,
        allowedRepositoryRoots: [canonicalRepoDir, canonicalOtherRepoDir],
        bindingRepositoryPath: canonicalRepoDir,
        workspaceRoot: null,
      };
      sdkResumeSessionMock.mockImplementation(completedTurn('codex-thread-1'));
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(repoDir),
      });

      await runner.resumeSession({
        session: makeSession({
          provider_session_id: 'codex-thread-1',
          services: [
            { id: 'svc-1', path: repoDir },
            { id: 'svc-2', path: otherRepoDir },
          ],
          launchServiceId: 'svc-1',
        }),
        prompt: 'Continue the test suite.',
        workspace,
      });

      const resumeConfig = sdkResumeSessionMock.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(resumeConfig['cwd']).toBe(canonicalRepoDir);
      expect(resumeConfig['sandbox']).toBe('workspace-write');
      expect(resumeConfig['extraWritableDirs']).toEqual([canonicalOtherRepoDir]);
      expect(resumeConfig['config']).toMatchObject({
        sandbox_workspace_write: { writable_roots: [canonicalOtherRepoDir] },
      });
      expect(resumeConfig['processLaunch']).toBeUndefined();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env['CODEX_HOME'];
      } else {
        process.env['CODEX_HOME'] = previousCodexHome;
      }
      await Promise.all([
        fs.rm(workspaceDir, { recursive: true, force: true }),
        fs.rm(codexHome, { recursive: true, force: true }),
      ]);
    }
  });

  it('uses non-repository authority for graph-only catalogs and the first selected Skill', async () => {
    const list = vi
      .spyOn(CodexSkillCatalog.prototype, 'list')
      .mockResolvedValue({ provider: 'codex', skills: [], errors: [] });
    const resolve = vi.spyOn(CodexSkillCatalog.prototype, 'resolve').mockResolvedValue({
      type: 'skill',
      name: 'personal',
      path: '/user/skills/personal/SKILL.md',
    });
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-graph-skill'));
    const session = makeSession({ services: [] });
    delete session.launchServiceId;
    const repoStore = makeRepoStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore,
    });
    await runner.listSkills({ session });
    expect(list).toHaveBeenCalledWith({
      policy: 'non_repository',
      authorityId: session.agentic_session_id,
    });
    await runner.runPrompt({
      session,
      prompt: 'Use personal Skill',
      skillSelection: { provider: 'codex', name: 'personal', catalogScope: 'user' },
    });
    expect(resolve).toHaveBeenCalledWith(
      { policy: 'non_repository', authorityId: session.agentic_session_id },
      { provider: 'codex', name: 'personal', catalogScope: 'user' },
    );
    expect(repoStore.getBinding).not.toHaveBeenCalled();
    list.mockRestore();
    resolve.mockRestore();
  });

  it('starts a no-service codex session from the process cwd without resolving a repo binding', async () => {
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-no-service'));
    const session = makeSession({ services: [] });
    delete session.launchServiceId;
    const runStore = makeRunStore();
    const repoStore = makeRepoStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore,
    });

    const result = await runner.runPrompt({
      session,
      prompt: 'Analyze the plan.',
    });

    expect(repoStore.getBinding).not.toHaveBeenCalled();
    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['cwd']).toBe(process.cwd());
    expect(result.providerSessionId).toBe('codex-thread-no-service');
  });

  it('fails before starting codex when a service-bound session has no repo binding', async () => {
    const runStore = makeRunStore();
    const repoStore = createProviderTestRepoMappingStore(null);
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore,
    });

    await expect(
      runner.runPrompt({
        session: makeSession({ services: [{ id: 'svc-1', path: '' }] }),
        prompt: 'Run the test suite.',
      }),
    ).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'REPO_BINDING_MISSING',
    });

    expect(repoStore.getBinding).toHaveBeenCalledWith(toServiceId('svc-1'));
    expect(sdkStartSessionMock).not.toHaveBeenCalled();
    expect(sdkResumeSessionMock).not.toHaveBeenCalled();
    expect(runStore.updateRunStatus).not.toHaveBeenCalled();
  });

  it('persists the captured thread id before an incomplete Codex turn resolves', async () => {
    const blockedTurn = createDeferred<void>();
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-eager' } });
      await blockedTurn.promise;
    });
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the test suite.',
    });

    await vi.waitFor(() => {
      expect(runStore.updateRunProviderIdentity).toHaveBeenCalledWith('agentic-1', {
        providerSessionId: 'codex-thread-eager',
        providerConversationId: null,
        providerSessionAgentId: 'test-agent',
      });
    });

    blockedTurn.reject(new Error('stop blocked test turn'));
    await expect(runPromise).rejects.toMatchObject({ code: 'RUN_FAILED' });
  });

  it('mounts browser config and allowlists on new and resumed Codex invocations', async () => {
    localAgentEndpoint.set('http://127.0.0.1:9999');
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    const mount = {
      runId: 'agentic-1',
      projectId: 'project-1',
      turnId: 't1',
      token: 'browser-one',
    };
    await runner.runPrompt({ session: makeSession(), prompt: 'browser', browserMcpMount: mount });
    expect(sdkStartSessionMock.mock.calls[0]?.[0]).toMatchObject({
      config: {
        mcp_servers: {
          'heyhey-browser': {
            url: 'http://127.0.0.1:9999/mcp/browser-tools/browser-one',
            enabled_tools: expect.arrayContaining(['navigate', 'snapshot', 'evaluate']),
          },
        },
      },
    });
    await runner.resumeSession({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'reply',
      browserMcpMount: { ...mount, turnId: 't2', token: 'browser-two' },
    });
    expect(sdkResumeSessionMock.mock.calls.at(-1)?.[1]).toMatchObject({
      config: {
        mcp_servers: {
          'heyhey-browser': { url: 'http://127.0.0.1:9999/mcp/browser-tools/browser-two' },
        },
      },
    });
  });

  it('attaches heyhey-platform MCP to the Codex app-server config', async () => {
    const oauthClient = createProviderTestOAuthClient();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run with graph tools.',
      mcpToolUseCase: 'research',
      additionalAllowedTools: ['get_report_schema'],
    });

    expect(buildMcpServerConfigMock).toHaveBeenCalledWith(
      oauthClient,
      expect.objectContaining({
        projectId: 'project-1',
        conversationId: 'conv-1',
        serviceId: 'svc-1',
        agentSessionId: 'agentic-1',
      }),
      { useCase: 'research', additionalTools: ['get_report_schema'] },
    );
    const mcpContext = buildMcpServerConfigMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mcpContext).not.toHaveProperty('messageId');

    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['config']).toEqual({
      mcp_servers: {
        'heyhey-platform': {
          url: 'https://heyhey.dev/mcp',
          http_headers: {
            Authorization: 'Bearer access-token',
            'X-Project-ID': 'project-1',
          },
        },
      },
      sandbox_workspace_write: {
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
        writable_roots: [],
      },
    });
  });

  it('merges platform MCP and submission-tool MCP config for Codex', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    const registration = submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [fakeSubmissionTool],
    });
    const oauthClient = createProviderTestOAuthClient();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run with all MCP tools.',
    });

    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['config']).toEqual({
      mcp_servers: {
        'heyhey-platform': {
          url: 'https://heyhey.dev/mcp',
          http_headers: {
            Authorization: 'Bearer access-token',
            'X-Project-ID': 'project-1',
          },
        },
        'heyhey-submission-tools': {
          url: `http://127.0.0.1:3847/mcp/submission-tools/${registration.token}`,
        },
      },
      sandbox_workspace_write: {
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
        writable_roots: [],
      },
    });
  });

  it('continues without platform MCP config when the platform config build fails', async () => {
    buildMcpServerConfigMock.mockRejectedValueOnce(new Error('Token expired'));
    const oauthClient = createProviderTestOAuthClient();
    const { logger, warn } = makeLogger();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
      logger,
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run without graph tools.',
    });

    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['config']).toEqual({
      sandbox_workspace_write: {
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
        writable_roots: [],
      },
    });
    expect(warn).toHaveBeenCalledWith(
      'local.runner.codex.mcp_config.failed',
      expect.objectContaining({
        sessionId: 'agentic-1',
      }),
    );
  });

  it('attaches registered submission tools to the Codex app-server config', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    const registration = submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [fakeSubmissionTool],
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the test suite.',
    });

    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['config']).toEqual({
      mcp_servers: {
        'heyhey-submission-tools': {
          url: `http://127.0.0.1:3847/mcp/submission-tools/${registration.token}`,
        },
      },
      sandbox_workspace_write: {
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
        writable_roots: [],
      },
    });
  });

  it('raises the submission-tools timeout to cover a long-running tool', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [fakeSubmissionTool, { ...fakeSubmissionTool, name: 'slow', maxDurationMs: 90_500 }],
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({ session: makeSession(), prompt: 'Run the test suite.' });

    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as {
      config: { mcp_servers: Record<string, Record<string, unknown>> };
    };
    expect(startConfig.config.mcp_servers['heyhey-submission-tools']).toMatchObject({
      tool_timeout_sec: 91,
    });
  });

  it('attaches registered submission tools when resuming a Codex thread', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    const registration = submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [fakeSubmissionTool],
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue the test suite.',
    });

    expect(sdkResumeSessionMock).toHaveBeenCalledTimes(1);
    const resumeConfig = sdkResumeSessionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(resumeConfig['config']).toEqual({
      mcp_servers: {
        'heyhey-submission-tools': {
          url: `http://127.0.0.1:3847/mcp/submission-tools/${registration.token}`,
        },
      },
      sandbox_workspace_write: {
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
        writable_roots: [],
      },
    });
  });

  it('does not attach submission tools when the local base URL is missing', async () => {
    submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [fakeSubmissionTool],
    });
    const { logger, warn } = makeLogger();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the test suite.',
    });

    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['config']).toEqual({
      sandbox_workspace_write: {
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
        writable_roots: [],
      },
    });
    expect(warn).toHaveBeenCalledWith(
      'local.runner.codex.submission_tools.no_base_url',
      expect.objectContaining({
        sessionId: 'agentic-1',
        toolCount: 1,
      }),
    );
  });

  it('forwards RunPromptArgs model and reasoningEffort onto startSession config', async () => {
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-1'));
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Run with overrides.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'xhigh',
    });

    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['model']).toBe('gpt-5.6-luna');
    expect(startConfig['effort']).toBe('xhigh');
    const runStartedPayload = vi
      .mocked(runStore.appendEvent)
      .mock.calls.find(([, event]) => event.event_type === 'run_started')?.[1].payload as Record<
      string,
      unknown
    >;
    expect(runStartedPayload['providerStart']).toMatchObject({
      model: 'gpt-5.6-luna',
      effort: 'xhigh',
    });
  });

  it('freshly resolves a pathless Skill selection before invoking Codex', async () => {
    const resolveSkill = vi.spyOn(CodexSkillCatalog.prototype, 'resolve').mockResolvedValue({
      type: 'skill',
      name: 'my-skill',
      path: '/tmp/repo/.codex/skills/my-skill/SKILL.md',
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Apply the selected workflow.',
      skillSelection: {
        provider: 'codex',
        name: 'my-skill',
        catalogScope: 'repo',
      },
    });

    expect(resolveSkill).toHaveBeenCalledWith(
      { policy: 'service_workspace', authorityId: 'agentic-1', cwd: '/private/tmp/repo' },
      {
        provider: 'codex',
        name: 'my-skill',
        catalogScope: 'repo',
      },
    );
    expect(sdkStartSessionMock.mock.calls[0]?.[0]).toMatchObject({
      skill: {
        type: 'skill',
        name: 'my-skill',
        path: '/tmp/repo/.codex/skills/my-skill/SKILL.md',
      },
    });
    resolveSkill.mockRestore();
  });

  it('lists the Codex Skill catalog for the active Run workspace', async () => {
    const catalog = {
      provider: 'codex' as const,
      skills: [
        {
          provider: 'codex' as const,
          name: 'my-skill',
          catalogScope: 'repo' as const,
          description: 'My local workflow',
          enabled: true,
        },
      ],
      errors: [],
    };
    const listSkills = vi.spyOn(CodexSkillCatalog.prototype, 'list').mockResolvedValue(catalog);
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await expect(runner.listSkills({ session: makeSession() })).resolves.toEqual(catalog);
    expect(listSkills).toHaveBeenCalledWith({
      policy: 'service_workspace',
      authorityId: 'agentic-1',
      cwd: '/tmp/repo',
    });
    listSkills.mockRestore();
  });

  it('freshly resolves the Skill again before invoking a resumed Codex session', async () => {
    const resolveSkill = vi.spyOn(CodexSkillCatalog.prototype, 'resolve').mockResolvedValue({
      type: 'skill',
      name: 'my-skill',
      path: '/tmp/repo/.codex/skills/my-skill/SKILL.md',
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.resumeSession({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue with the selected workflow.',
      skillSelection: {
        provider: 'codex',
        name: 'my-skill',
        catalogScope: 'repo',
      },
    });

    expect(resolveSkill).toHaveBeenCalledWith(
      { policy: 'service_workspace', authorityId: 'agentic-1', cwd: '/private/tmp/repo' },
      {
        provider: 'codex',
        name: 'my-skill',
        catalogScope: 'repo',
      },
    );
    expect(sdkResumeSessionMock.mock.calls[0]?.[1]).toMatchObject({
      skill: {
        type: 'skill',
        name: 'my-skill',
        path: '/tmp/repo/.codex/skills/my-skill/SKILL.md',
      },
    });
    resolveSkill.mockRestore();
  });

  it('forwards RunPromptArgs model and reasoningEffort onto resumeSession config', async () => {
    sdkResumeSessionMock.mockImplementation(completedTurn('codex-thread-1'));
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Resume with overrides.',
      model: 'gpt-5-codex',
      reasoningEffort: 'medium',
    });

    const resumeConfig = sdkResumeSessionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(resumeConfig['model']).toBe('gpt-5-codex');
    expect(resumeConfig['effort']).toBe('medium');
  });

  it('maps enabled Fast mode to priority for a fresh Codex session', async () => {
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-fast'));
    const { logger, debug } = makeLogger();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    await runner.runPrompt({
      session: makeSession({ fastMode: true }),
      prompt: 'Run fast.',
    });

    expect(sdkStartSessionMock.mock.calls[0]?.[0]).toMatchObject({ serviceTier: 'priority' });
    expect(debug).toHaveBeenCalledWith(
      'local.runner.codex.fast_mode.resolved',
      expect.objectContaining({
        fastModeSelection: 'enabled',
        serviceTierApplied: true,
      }),
    );
  });

  it('maps explicitly disabled Fast mode to default for a fresh Codex session', async () => {
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-default'));
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ fastMode: false }),
      prompt: 'Run at the default tier.',
    });

    expect(sdkStartSessionMock.mock.calls[0]?.[0]).toMatchObject({ serviceTier: 'default' });
  });

  it('forwards the persisted Fast mode tier when resuming a Codex session', async () => {
    sdkResumeSessionMock.mockImplementation(completedTurn('codex-thread-1'));
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1', fastMode: false }),
      prompt: 'Resume at the selected tier.',
    });

    expect(sdkResumeSessionMock.mock.calls[0]?.[1]).toMatchObject({ serviceTier: 'default' });
  });

  it('falls back to session.model and session.reasoningEffort when RunPromptArgs omits them', async () => {
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-1'));
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ model: 'gpt-5-codex', reasoningEffort: 'low' }),
      prompt: 'Use session defaults.',
    });

    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig['model']).toBe('gpt-5-codex');
    expect(startConfig['effort']).toBe('low');
  });

  it('omits model and effort entirely when neither RunPromptArgs nor session carry them, for both startSession and resumeSession', async () => {
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-fresh'));
    sdkResumeSessionMock.mockImplementation(completedTurn('codex-thread-1'));
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    // Fresh session — no model/effort anywhere → both omitted on thread/start.
    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'pending_abc' }),
      prompt: 'No overrides.',
    });
    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startConfig).not.toHaveProperty('model');
    expect(startConfig).not.toHaveProperty('effort');
    expect(startConfig).not.toHaveProperty('serviceTier');

    // Resume turn — same omission applies on thread/resume.
    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'No overrides on resume.',
    });
    const resumeConfig = sdkResumeSessionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(resumeConfig).not.toHaveProperty('model');
    expect(resumeConfig).not.toHaveProperty('effort');
    expect(resumeConfig).not.toHaveProperty('serviceTier');
  });

  it('starts a fresh native session when provider_session_id is a pending Run seed', async () => {
    // `pending_`-prefixed ids are the platform-wide Run seed, not a real codex
    // thread id, so resolution must treat them as "no session yet".
    sdkGetSessionIdMock.mockReturnValue('codex-thread-fresh');
    sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-fresh'));
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    const result = await runner.runPrompt({
      session: makeSession({ provider_session_id: 'pending_abc' }),
      prompt: 'Start a fresh codex session.',
    });

    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    expect(sdkResumeSessionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      providerSessionId: 'codex-thread-fresh',
      providerConversationId: null,
      errorCount: 0,
    });
  });

  it('resumes against the native thread id read from the session record', async () => {
    // A real persisted native id selects resume; the runner hands that exact
    // id to client.resumeSession as the codex thread to reopen.
    sdkGetSessionIdMock.mockReturnValue('codex-thread-1');
    sdkResumeSessionMock.mockImplementation(completedTurn('codex-thread-1'));
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    const result = await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue from the persisted thread.',
    });

    expect(sdkResumeSessionMock).toHaveBeenCalledTimes(1);
    expect(sdkResumeSessionMock.mock.calls[0]?.[0]).toBe('codex-thread-1');
    expect(sdkStartSessionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      providerSessionId: 'codex-thread-1',
      providerConversationId: null,
      errorCount: 0,
    });
  });

  it('declares initial prefix as the Codex fresh-session delivery mode', () => {
    expect(PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE.codex).toBe('initial-prefix');
  });

  it.each([false, true])(
    'read-only fresh/resumed sessions override global auto_review (replacement %s)',
    async (replacement) => {
      const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-readonly-reviewer-'));
      const previousCodexHome = process.env['CODEX_HOME'];
      process.env['CODEX_HOME'] = codexHome;
      try {
        await fs.writeFile(
          path.join(codexHome, 'config.toml'),
          'approvals_reviewer = "auto_review"\n',
        );
        sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-1'));
        sdkResumeSessionMock.mockImplementation(completedTurn('codex-thread-1'));
        const runner = new CodexAgentSessionRunner({
          localAgentEndpoint,
          submissionToolRegistry,
          runStore: makeRunStore(),
          repoStore: makeRepoStore(),
          oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
        });
        await runner.runPrompt({
          session: makeSession(),
          prompt: 'RESEARCH INPUT',
          readOnlyFilesystem: true,
          replaceProviderSystemPrompt: replacement,
          startupSegments: {
            stableInstructions: 'STABLE',
            dynamicContext: 'DYNAMIC',
            userInput: 'USER',
          },
        });
        const fresh = sdkStartSessionMock.mock.calls[0]?.[0];
        expect(fresh).toMatchObject({
          sandbox: 'read-only',
          config: { approvals_reviewer: 'user' },
        });
        if (replacement) {
          expect(fresh).toMatchObject({
            prompt: `DYNAMIC\n\nUSER`,
            baseInstructions: expect.stringContaining('STABLE'),
          });
          expect(fresh).not.toHaveProperty('structuredInput');
        } else {
          expect(fresh).not.toHaveProperty('baseInstructions');
          expect(fresh).toMatchObject({ prompt: expect.stringContaining('STABLE') });
        }
        await runner.runPrompt({
          session: makeSession({ provider_session_id: 'codex-thread-1' }),
          prompt: 'FOLLOW UP',
          readOnlyFilesystem: true,
          replaceProviderSystemPrompt: replacement,
        });
        const resumed = sdkResumeSessionMock.mock.calls[0]?.[1];
        expect(resumed).toMatchObject({
          sandbox: 'read-only',
          prompt: 'FOLLOW UP',
          config: { approvals_reviewer: 'user' },
        });
        expect(resumed).not.toHaveProperty('baseInstructions');
        expect(resumed).not.toHaveProperty('structuredInput');
      } finally {
        if (previousCodexHome === undefined) delete process.env['CODEX_HOME'];
        else process.env['CODEX_HOME'] = previousCodexHome;
        await fs.rm(codexHome, { recursive: true, force: true });
      }
    },
  );

  it('write-enabled sessions retain the configured reviewer and default prompt', async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), 'cli-write-reviewer-'));
    const previousCodexHome = process.env['CODEX_HOME'];
    process.env['CODEX_HOME'] = codexHome;
    try {
      await fs.writeFile(
        path.join(codexHome, 'config.toml'),
        'approvals_reviewer = "auto_review"\n',
      );
      sdkStartSessionMock.mockImplementation(completedTurn('codex-thread-1'));
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
      });
      await runner.runPrompt({ session: makeSession(), prompt: 'WRITE INPUT' });
      const launch = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(launch['sandbox']).not.toBe('read-only');
      expect(launch['config']).not.toHaveProperty('approvals_reviewer');
      expect(launch).not.toHaveProperty('baseInstructions');
      expect(launch['prompt']).toContain('## Platform Primer');
    } finally {
      if (previousCodexHome === undefined) delete process.env['CODEX_HOME'];
      else process.env['CODEX_HOME'] = previousCodexHome;
      await fs.rm(codexHome, { recursive: true, force: true });
    }
  });

  it('resolves the persisted Entity Conversation pilot selection once', () => {
    expect(resolveCodexPlatformPromptDeliveryMode(undefined)).toBe('initial-prefix');
    expect(
      resolveCodexPlatformPromptDeliveryMode({
        type: 'ENTITY_CONVERSATION',
        version: 'v1',
        model: 'gpt-5.4',
        disableCodexSystemPrompt: false,
      }),
    ).toBe('initial-prefix');
    expect(
      resolveCodexPlatformPromptDeliveryMode({
        type: 'ENTITY_CONVERSATION',
        version: 'v1',
        model: 'gpt-5.4',
        disableCodexSystemPrompt: true,
      }),
    ).toBe('base-instructions');
  });

  it.each([false, true])(
    'combines Codex base instructions with segmentation (%s) and Skills',
    async (segmented) => {
      const skill = {
        type: 'skill' as const,
        name: 'my-skill',
        path: '/tmp/repo/.codex/skills/my-skill/SKILL.md',
      };
      const resolveSkill = vi
        .spyOn(CodexSkillCatalog.prototype, 'resolve')
        .mockResolvedValue(skill);
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
      });
      const firstTurnInput = 'Fresh pilot prompt.';
      const expectedPlatformPrompt = buildPlatformSystemPrompt([]);

      await runner.runPrompt({
        session: makeSession({
          config: {
            type: 'ENTITY_CONVERSATION',
            version: 'v1',
            model: 'gpt-5.4',
            disableCodexSystemPrompt: true,
          },
        }),
        prompt: firstTurnInput,
        skillSelection: { provider: 'codex', name: 'my-skill', catalogScope: 'repo' },
        ...(segmented
          ? {
              startupSegments: {
                stableInstructions: 'STABLE INSTRUCTIONS',
                dynamicContext: 'CURRENT ENTITY',
                userInput: firstTurnInput,
              },
            }
          : {}),
      });

      expect(sdkStartSessionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: `${segmented ? `CURRENT ENTITY\n\n${firstTurnInput}` : firstTurnInput}`,
          baseInstructions: segmented
            ? `${expectedPlatformPrompt}\n\nSTABLE INSTRUCTIONS`
            : expectedPlatformPrompt,
          skill,
        }),
        undefined,
      );
      expect(sdkStartSessionMock.mock.calls[0]?.[0]).not.toHaveProperty('structuredInput');
      resolveSkill.mockRestore();
    },
  );

  it('submits stable-first structured input on new Codex sessions', async () => {
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      // The platform prompt is assembled from the registry read, which needs
      // credentials; without an oauthClient there is no ontology to prepend.
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });
    const firstTurnInput = '  Fresh codex prompt.\nwith formatting.  ';
    const expectedPlatformPrompt = buildPlatformSystemPrompt([]);

    await runner.runPrompt({
      session: makeSession(),
      prompt: firstTurnInput,
      startupSegments: {
        stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
        dynamicContext: 'DYNAMIC ENTITY CONTEXT',
        userInput: 'CURRENT USER INPUT',
      },
    });

    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    const sentPrompt = startConfig['prompt'];
    expect(typeof sentPrompt).toBe('string');
    expect(sentPrompt).toBe(
      `${expectedPlatformPrompt}\n\nSTABLE ENTITY INSTRUCTIONS\n\nDYNAMIC ENTITY CONTEXT\n\nCURRENT USER INPUT`,
    );
    expect(startConfig['structuredInput']).toEqual([
      { text: expectedPlatformPrompt, cacheBreakpoint: false },
      { text: 'STABLE ENTITY INSTRUCTIONS', cacheBreakpoint: true },
      {
        text: `DYNAMIC ENTITY CONTEXT`,
        cacheBreakpoint: false,
      },
      { text: 'CURRENT USER INPUT', cacheBreakpoint: false },
    ]);
  });

  it.each(['TAKING_SHAPE', 'ESTABLISHED'] as const)(
    'reads and delivers maturity=%s once on a fresh session',
    async (maturity) => {
      readSessionStartContextMock.mockResolvedValueOnce({
        workItemTypeDefinitions: [],
        intentFirst: false,
        maturity,
      });
      const oauthClient = createProviderTestOAuthClient({ success: true, data: 'test-token' });
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient,
      });

      await runner.runPrompt({ session: makeSession(), prompt: 'Fresh codex prompt.' });

      expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
      expect(readSessionStartContextMock).toHaveBeenCalledWith({
        oauthClient,
        projectId: 'project-1',
      });
      // The read precedes prompt delivery.
      expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
      const prompt = sdkStartSessionMock.mock.calls[0]?.[0]?.prompt as string;
      expect(prompt).not.toContain('Maturity stage');
      expect(prompt.includes(takingShapeGuidance)).toBe(maturity === 'TAKING_SHAPE');
    },
  );

  it('reflects a registry add+edit in the very next session via the prepended prompt, with no builder or runner change', async () => {
    const makeRunner = () =>
      new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
      });

    // First session — the registry read returns the baseline definition set.
    readSessionStartContextMock.mockResolvedValueOnce({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    await makeRunner().runPrompt({ session: makeSession(), prompt: 'First session.' });

    const firstPrompt = (sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'prompt'
    ] as string;
    expect(firstPrompt).toContain(renderWorkItemTypeOntologyEntry(baselineContract));
    expect(firstPrompt).toContain('Legal agreements and SLAs');
    expect(firstPrompt).not.toContain('Spike');
    expect(firstPrompt).not.toContain('Vendor contracts');
    // The user's prompt still rides along after the assembled platform prompt.
    expect(firstPrompt).toContain('First session.');

    sdkStartSessionMock.mockClear();

    // The user approves a registry change — CONTRACT's purpose is edited and a
    // SPIKE type is added — then opens the very next session. Nothing in the
    // builder or runner changed between the two runs; only the read differs.
    readSessionStartContextMock.mockResolvedValueOnce({
      workItemTypeDefinitions: EDITED_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    await makeRunner().runPrompt({ session: makeSession(), prompt: 'Next session.' });

    const nextPrompt = (sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'prompt'
    ] as string;
    expect(nextPrompt).toContain(renderWorkItemTypeOntologyEntry(editedContract));
    expect(nextPrompt).toContain(renderWorkItemTypeOntologyEntry(addedSpike));
    expect(nextPrompt).toContain('Vendor contracts, renewals, and SLAs');
    expect(nextPrompt).toContain('A timeboxed investigation');
    // The stale purpose is gone — the delivered ontology tracks the registry,
    // not a value frozen into the code.
    expect(nextPrompt).not.toContain('Legal agreements and SLAs');
  });

  it('sends the platform prefix only on fresh start and only new turn input on resume', async () => {
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });
    const firstTurnInput = 'First turn.';
    const followUpInput = 'Second turn.';
    const expectedPlatformPrompt = buildPlatformSystemPrompt(BASELINE_DEFINITIONS, {
      provider: 'codex',
      model: 'gpt-5.6-sol',
      epistemicCalibration: true,
    });

    // Turn 1 — fresh session (pending provider id): reads and prepends the
    // assembled prompt via startSession.
    await runner.runPrompt({
      session: makeSession(),
      prompt: firstTurnInput,
      epistemicCalibration: true,
      model: 'gpt-5.6-sol',
    });

    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
    const turn1Prompt = (sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'prompt'
    ] as string;
    expect(turn1Prompt).toBe(`${expectedPlatformPrompt}\n\n${firstTurnInput}`);
    expect(turn1Prompt).toContain(renderWorkItemTypeOntologyEntry(baselineContract));
    expect(turn1Prompt).toContain('correct prior overconfidence plainly');

    // Turn 2 — resume on the same run: resumeSession path, no re-read.
    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: followUpInput,
      epistemicCalibration: true,
      model: 'gpt-5.6-sol',
    });

    expect(sdkResumeSessionMock).toHaveBeenCalledTimes(1);
    expect(sdkStartSessionMock).toHaveBeenCalledTimes(1);
    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
    expect(sdkResumeSessionMock.mock.calls[0]?.[0]).toBe('codex-thread-1');
    const resumeConfig = sdkResumeSessionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(resumeConfig['prompt']).toBe(followUpInput);
    expect(resumeConfig['prompt']).not.toContain(expectedPlatformPrompt);
    expect(resumeConfig['prompt']).not.toContain('## Platform Context');
    expect(resumeConfig['prompt']).not.toContain(renderWorkItemTypeOntologyEntry(baselineContract));
    expect(resumeConfig['prompt']).not.toContain(firstTurnInput);
    expect(resumeConfig['prompt']).not.toContain('Working with an informed user');
  });

  it('prepends Intent first guidance on the fresh turn when the saved choice is on, and a resume neither re-reads nor re-sends it', async () => {
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: true,
      maturity: 'ESTABLISHED',
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });

    await runner.runPrompt({ session: makeSession(), prompt: 'First turn.' });

    const turn1Prompt = (sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'prompt'
    ] as string;
    expect(turn1Prompt).toBe(
      `${buildPlatformSystemPrompt(BASELINE_DEFINITIONS, undefined, { intentFirst: true, maturity: 'ESTABLISHED', hints: 'none' })}\n\nFirst turn.`,
    );
    expect(turn1Prompt).toContain(intentFirstGuidance);

    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Second turn.',
    });

    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
    const resumeConfig = sdkResumeSessionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(resumeConfig['prompt']).toBe('Second turn.');
  });

  it('aborts session start when the session-start context read fails', async () => {
    readSessionStartContextMock.mockRejectedValueOnce(
      new Error('registry read failed: no organization id in the access token.'),
    );
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });

    await expect(
      runner.runPrompt({ session: makeSession(), prompt: 'Fresh codex prompt.' }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
    // No prompt is delivered — the failure is loud, with no stale/empty fallback.
    expect(sdkStartSessionMock).not.toHaveBeenCalled();
  });

  it.each(['project_report', 'release_notes'] as const)(
    'starts a fresh %s session without the platform prompt or any maturity text',
    async (mcpToolUseCase) => {
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
      });
      const session = makeSession({ services: [] });
      delete session.launchServiceId;
      await runner.runPrompt({
        session,
        prompt: 'Specialized input',
        mcpToolUseCase,
        readOnlyFilesystem: true,
        builtinTools: [],
      });
      expect(readSessionStartContextMock).not.toHaveBeenCalled();
      const prompt = sdkStartSessionMock.mock.calls[0]?.[0]?.prompt;
      expect(prompt).not.toContain('Maturity stage');
      expect(prompt).not.toContain('Platform Primer');
    },
  );

  // ----- event mapping through mapCodexEvent --------------------------------

  it('routes raw ServerNotifications through mapCodexEvent into canonical payloads', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('item/agentMessage/delta', { delta: 'partial ' });
      emitSdkEvent('item/completed', { item: { type: 'agentMessage', text: 'partial answer' } });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue with the implementation.',
    });

    // Events persist under their real Codex method names, not the embedded
    // task_complete/session_configured names.
    const persisted = getPersistedProviderEventTypes(runStore);
    expect(persisted).toContain('item/agentMessage/delta');
    expect(persisted).toContain('item/completed');
    expect(persisted).toContain('turn/completed');
    expect(persisted).not.toContain('task_complete');

    // item/completed agentMessage maps to a canonical assistant status frame.
    expect(getPersistedProviderPayload(runStore, 'item/completed')).toMatchObject({
      canonical_event_type: 'status',
      canonical_event: {
        status: { state: 'assistant', message: 'partial answer' },
      },
    });
    // turn/completed is the canonical terminal status.
    expect(getPersistedProviderPayload(runStore, 'turn/completed')).toMatchObject({
      canonical_event_type: 'status',
      canonical_event: {
        status: { state: 'complete' },
      },
    });
  });

  it('retains child telemetry while only the root result completes the parent run', async () => {
    const continueRoot = createDeferred<void>();
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('turn/started', {
        threadId: 'codex-thread-1',
        turn: { id: 'root-turn-1' },
      });
      emitSdkEvent('item/completed', {
        threadId: 'child-thread-1',
        turnId: 'child-turn-1',
        item: { id: 'child-message-1', type: 'agentMessage', text: 'Child finding.' },
      });
      emitSdkEvent('error', {
        threadId: 'child-thread-1',
        turnId: 'child-turn-1',
        error: { message: 'Child research failed.' },
        willRetry: false,
      });
      emitSdkEvent('turn/completed', {
        threadId: 'child-thread-1',
        turnId: 'child-turn-1',
        turn: { id: 'child-turn-1', status: 'failed' },
      });

      await continueRoot.promise;

      emitSdkEvent('item/completed', {
        threadId: 'codex-thread-1',
        turnId: 'root-turn-1',
        item: { id: 'root-message-1', type: 'agentMessage', text: 'Root synthesis.' },
      });
      emitSdkEvent('turn/completed', {
        threadId: 'codex-thread-1',
        turnId: 'root-turn-1',
        turn: { id: 'root-turn-1', status: 'completed' },
      });
    });

    const runStore = makeRunStore();
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Research the repository.',
    });

    await vi.waitFor(() => {
      expect(getPersistedProviderEventTypes(runStore)).toContain('turn/completed');
    });
    expect(JSON.stringify(vi.mocked(runStore.appendEvent).mock.calls)).toContain('Child finding.');
    expect(JSON.stringify(onAgentOutput.mock.calls)).toContain('Child finding.');
    expect(JSON.stringify(onAgentOutput.mock.calls)).not.toContain('taskComplete');
    expect(JSON.stringify(onAgentOutput.mock.calls)).not.toContain('Writing response...');

    continueRoot.resolve(undefined);
    await expect(runPromise).resolves.toMatchObject({ errorCount: 0 });

    const taskCompleteOutputs = (
      onAgentOutput.mock.calls as [
        { event: { eventType: string; payload?: Record<string, unknown> } },
      ][]
    )
      .map(([call]) => call.event)
      .filter(
        (event) => event.eventType === 'agent_output' && event.payload?.['taskComplete'] === true,
      );
    expect(taskCompleteOutputs).toHaveLength(1);
    expect(taskCompleteOutputs[0]?.payload).toMatchObject({
      summary: 'Root synthesis.',
      taskComplete: true,
    });
  });

  it('uses the client-owned current turn after stale same-thread resume telemetry', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      sdkRootThreadId = 'codex-thread-1';
      sdkRootTurnId = null;
      sdkGetSessionIdMock.mockReturnValue('codex-thread-1');
      sdkEventHandler?.({
        method: 'thread/status/changed',
        params: { threadId: 'codex-thread-1', turnId: 'previous-turn' },
      });

      sdkRootTurnId = 'current-turn';
      emitSdkEvent('turn/started', {
        threadId: 'codex-thread-1',
        turn: { id: 'current-turn' },
      });
      emitSdkEvent('item/agentMessage/delta', {
        threadId: 'codex-thread-1',
        turnId: 'current-turn',
        delta: 'Current response.',
      });
      emitSdkEvent('item/completed', {
        threadId: 'codex-thread-1',
        turnId: 'current-turn',
        item: { id: 'current-message', type: 'agentMessage', text: 'Current response.' },
      });
      emitSdkEvent('turn/completed', {
        threadId: 'codex-thread-1',
        turn: { id: 'current-turn', status: 'completed' },
      });
    });
    const { logger, warn } = makeLogger();
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      logger,
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue the conversation.',
    });

    expect(JSON.stringify(onAgentOutput.mock.calls)).toContain('Current response.');
    expect(JSON.stringify(onAgentOutput.mock.calls)).toContain('taskComplete');
    expect(warn).not.toHaveBeenCalledWith(
      'local.runner.codex.run_prompt.no_assistant_output',
      expect.anything(),
    );
  });

  it('flushes a buffered assistant summary on the turn/completed boundary', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('item/completed', { item: { type: 'agentMessage', text: 'Final answer.' } });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue with the implementation.',
    });

    expect(onAgentOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'agent_output',
          payload: expect.objectContaining({
            messageType: 'assistant',
            summary: 'Final answer.',
            taskComplete: true,
          }),
        }),
      }),
    );
  });

  it('emits earlier Codex assistant items as non-final output and finalizes the last item on turn completion', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('item/completed', { item: { type: 'agentMessage', text: 'First answer.' } });
      emitSdkEvent('item/completed', { item: { type: 'agentMessage', text: 'Second answer.' } });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue with the implementation.',
    });

    const assistantOutputs = (
      onAgentOutput.mock.calls as [
        {
          event: {
            eventType: string;
            payload?: Record<string, unknown>;
          };
        },
      ][]
    )
      .map(([call]) => call.event)
      .filter((event) => {
        if (event.eventType !== 'agent_output' || !event.payload) {
          return false;
        }
        return event.payload['messageType'] === 'assistant';
      });

    expect(assistantOutputs).toHaveLength(2);
    expect(assistantOutputs[0]?.payload).toMatchObject({
      messageType: 'assistant',
      summary: 'First answer.',
    });
    expect(assistantOutputs[0]?.payload).not.toHaveProperty('taskComplete');
    expect(assistantOutputs[1]?.payload).toMatchObject({
      messageType: 'assistant',
      summary: 'Second answer.',
      taskComplete: true,
    });
  });

  it('emits Codex plan output before approval-style assistant text without duplicating completion', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      sdkRootTurnId = 'turn-1';
      emitSdkEvent('item/plan/delta', {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        itemId: 'plan-item-1',
        delta: '1. Update mapper\n',
      });
      emitSdkEvent('item/completed', {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        item: {
          type: 'plan',
          id: 'plan-item-1',
          text: '1. Update mapper\n2. Add regression coverage',
        },
      });
      emitSdkEvent('item/completed', {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        item: {
          type: 'agentMessage',
          id: 'approval-message-1',
          text: "Please approve the plan above and I'll make the changes.",
        },
      });
      emitSdkEvent('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    });
    const onAgentOutput = vi.fn();
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Create a plan first.',
    });

    const assistantOutputs = (
      onAgentOutput.mock.calls as [
        {
          event: {
            eventType: string;
            payload?: Record<string, unknown>;
          };
        },
      ][]
    )
      .map(([call]) => call.event)
      .filter((event) => {
        if (event.eventType !== 'agent_output' || !event.payload) {
          return false;
        }
        return event.payload['messageType'] === 'assistant';
      });

    expect(assistantOutputs).toHaveLength(2);
    expect(assistantOutputs[0]?.payload).toMatchObject({
      messageType: 'assistant',
      summary: '1. Update mapper\n2. Add regression coverage',
    });
    expect(assistantOutputs[0]?.payload).not.toHaveProperty('taskComplete');
    expect(assistantOutputs[1]?.payload).toMatchObject({
      messageType: 'assistant',
      summary: "Please approve the plan above and I'll make the changes.",
      taskComplete: true,
    });

    const persisted = getPersistedProviderEventTypes(runStore);
    expect(persisted).toContain('item/plan/delta');
    expect(persisted).toContain('item/completed');
    expect(getPersistedProviderPayload(runStore, 'item/plan/delta')).toMatchObject({
      canonical_event_type: 'status',
      canonical_event: {
        status: { state: 'assistant', message: '1. Update mapper\n' },
      },
    });
  });

  it('normalizes turn/diff/updated events with delivery mode and truncation metadata', async () => {
    const previousMaxDiff = process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'];
    process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'] = '1024';

    const unifiedDiff = `diff --git a/src/main.ts b/src/main.ts\n--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1 +1 @@\n+${'a'.repeat(
      1600,
    )}\n`;
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('turn/diff/updated', { unified_diff: unifiedDiff });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue with the implementation.',
    });

    expect(getPersistedProviderPayload(runStore, 'turn/diff/updated')).toMatchObject({
      canonical_event_type: 'diff',
      canonical_event: {
        diff: {
          files: ['src/main.ts'],
          delivery_mode: 'batch',
          delivery_mode_flags: { is_incremental: false, is_batch: true },
          truncation: { truncated: true, overflow: true, max_size_bytes: 1024 },
        },
      },
    });

    if (previousMaxDiff === undefined) {
      delete process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'];
    } else {
      process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'] = previousMaxDiff;
    }
  });

  it('maps the thread/compacted boundary to a canonical compact status', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('item/completed', { item: { type: 'agentMessage', text: 'Compacting.' } });
      emitSdkEvent('thread/compacted', {});
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue with the implementation.',
    });

    expect(getPersistedProviderPayload(runStore, 'thread/compacted')).toMatchObject({
      canonical_event_type: 'status',
      canonical_event: {
        status: { state: 'compact_boundary' },
      },
    });
  });

  it('emits processing_status phase transitions starting → thinking → writing → thinking as events arrive', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      // First event → thinking.
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('item/started', {
        item: { type: 'commandExecution', id: 'cmd-1', command: ['ls'] },
      });
      // agentMessage with text → writing.
      emitSdkEvent('item/completed', { item: { type: 'agentMessage', text: 'Hello!' } });
      // non-assistant again → back to thinking.
      emitSdkEvent('item/started', {
        item: { type: 'commandExecution', id: 'cmd-2', command: ['ls'] },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue the work.',
    });

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((p): p is string => typeof p === 'string');

    expect(phases).toEqual(['starting', 'thinking', 'writing', 'thinking']);
  });

  it('emits thinking when the first provider event is terminal', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      sdkRootThreadId = 'codex-thread-1';
      sdkRootTurnId = 'codex-root-turn-1';
      emitSdkEvent('turn/completed', {
        threadId: 'codex-thread-1',
        turn: { id: 'codex-root-turn-1', status: 'completed' },
      });
    });
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.runPrompt({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Continue the work.',
    });

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((p): p is string => typeof p === 'string');

    expect(phases).toEqual(['starting', 'thinking']);
  });

  it('emits no-assistant-output diagnostics when a run resolves without an agent message', async () => {
    sdkStartSessionMock.mockImplementation(
      completedTurn('codex-thread-1', { withAssistant: false }),
    );
    const { logger, warn } = makeLogger();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    await runner.runPrompt({ session: makeSession(), prompt: 'Run diagnostics.' });

    expect(warn).toHaveBeenCalledWith(
      'local.runner.codex.run_prompt.no_assistant_output',
      expect.objectContaining({
        sessionId: 'agentic-1',
        mode: 'prompt',
        streamEventCount: 2,
      }),
    );
  });

  // ----- negative paths: RUN_FAILED / SESSION_NOT_FOUND / mismatch ----------

  it('treats an automatically settled Service-scope abort as expected control flow', async () => {
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const agentOutputOwner = createProviderTestAgentOutputOwner(vi.fn());
    const controller = agentOutputOwner.createAbortController();
    await agentOutputOwner.serviceScope.pauseForServiceScopeRequest('scope-request-1', 'automatic');
    agentOutputOwner.serviceScope.settleServiceScopeRequest('scope-request-1');
    expect(
      agentOutputOwner.serviceScope.settleServiceScopeApprovalWait('scope-request-1', 'starting'),
    ).toBe(true);
    expect(agentOutputOwner.serviceScope.isServiceScopeApprovalPauseActive()).toBe(false);
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      throw new Error('Aborted');
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner,
      logger,
    });

    await expect(
      runner.runPrompt({
        session: makeSession(),
        prompt: 'Request another Service.',
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      providerSessionId: 'codex-thread-1',
      errorCount: 0,
    });

    expect(
      agentOutputOwner.serviceScope.consumeExpectedServiceScopeTurnAbort(controller.signal),
    ).toBe(false);
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
    expect(
      vi
        .mocked(runStore.appendEvent)
        .mock.calls.filter(([, event]) => event.event_type === 'run_completed'),
    ).toHaveLength(0);
    expect(error).not.toHaveBeenCalledWith(
      'local.runner.codex.run_prompt.failed',
      expect.anything(),
    );
    expect(error).not.toHaveBeenCalledWith(
      'local.runner.codex.provider_turn.failed',
      expect.anything(),
    );
    expect(sdkDisconnectMock).toHaveBeenCalledOnce();
  });

  it('keeps an SDK abort on a normally canceled Run on the existing failure path', async () => {
    const controller = new AbortController();
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      controller.abort();
      throw new Error('Aborted');
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(vi.fn()),
      logger,
    });

    await expect(
      runner.runPrompt({
        session: makeSession(),
        prompt: 'Stop the work.',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });

    expect(error).toHaveBeenCalledWith(
      'local.runner.codex.run_prompt.failed',
      expect.objectContaining({ error: expect.objectContaining({ code: 'RUN_FAILED' }) }),
    );
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('keeps a provider error on the failure path even when a scope pause is present', async () => {
    const controller = new AbortController();
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const agentOutputOwner = createProviderTestAgentOutputOwner(vi.fn());
    vi.spyOn(agentOutputOwner.serviceScope, 'consumeExpectedServiceScopeTurnAbort').mockReturnValue(
      true,
    );
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      controller.abort();
      throw new Error('Provider transport failed.');
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner,
      logger,
    });

    await expect(
      runner.runPrompt({
        session: makeSession(),
        prompt: 'Continue the work.',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED', message: 'Provider transport failed.' });

    expect(error).toHaveBeenCalledWith(
      'local.runner.codex.run_prompt.failed',
      expect.objectContaining({ error: expect.objectContaining({ code: 'RUN_FAILED' }) }),
    );
    expect(
      vi
        .mocked(runStore.appendEvent)
        .mock.calls.filter(([, event]) => event.event_type === 'run_completed'),
    ).toHaveLength(1);
  });

  it('does not let an approval pause bypass resume provider identity validation', async () => {
    const controller = new AbortController();
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const agentOutputOwner = createProviderTestAgentOutputOwner(vi.fn());
    vi.spyOn(agentOutputOwner.serviceScope, 'consumeExpectedServiceScopeTurnAbort').mockReturnValue(
      true,
    );
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-2' } });
      controller.abort();
      throw new Error('Aborted');
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner,
      logger,
    });

    await expect(
      runner.runPrompt({
        session: makeSession({ provider_session_id: 'codex-thread-1' }),
        prompt: 'Continue the work.',
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });

    expect(error).toHaveBeenCalledWith(
      'local.runner.codex.run_prompt.failed',
      expect.objectContaining({ error: expect.objectContaining({ code: 'RUN_FAILED' }) }),
    );
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('maps a native disconnect during the turn to RUN_FAILED', async () => {
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      throw new Error('Disconnected');
    });
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await expect(
      runner.runPrompt({ session: makeSession(), prompt: 'Run the work.' }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('fails the run when Codex emits a non-retryable provider error', async () => {
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('error', {
        error: {
          message: JSON.stringify({
            error: { message: 'Configured model is unavailable for this account.' },
          }),
        },
        willRetry: false,
      });
      emitSdkEvent('turn/completed', {
        turn: { status: 'failed', error: { message: 'Provider turn failed.' } },
      });
    });
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      logger,
    });

    await expect(
      runner.runPrompt({
        session: makeSession({ promptType: 'daily_session', model: 'unsupported-model' }),
        prompt: 'Produce the briefing.',
      }),
    ).rejects.toMatchObject({
      code: 'RUN_FAILED',
      message: 'Configured model is unavailable for this account.',
    });
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
    expect(error).toHaveBeenCalledWith(
      DAILY_SESSION_MONITOR_LOG_EVENT,
      expect.objectContaining({
        stage: 'provider_turn_failed',
        model: 'unsupported-model',
        error: 'Configured model is unavailable for this account.',
      }),
    );
  });

  it('classifies selected-model capacity, persists only safe provider output, and retains diagnostics in logs', async () => {
    const rawProviderFailure = 'Selected model gpt-5-codex is at capacity. trace=private-123';
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkEvent('error', {
        error: { message: JSON.stringify({ error: { message: rawProviderFailure } }) },
        willRetry: false,
      });
      emitSdkEvent('turn/completed', {
        turn: { status: 'failed', error: { message: rawProviderFailure } },
      });
    });
    const runStore = makeRunStore();
    const onAgentOutput = vi.fn();
    const { logger, error } = makeLogger();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      logger,
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await expect(
      runner.runPrompt({ session: makeSession(), prompt: 'Retry the work.' }),
    ).rejects.toMatchObject({
      code: 'MODEL_CAPACITY',
      message: 'The provider is temporarily at capacity for the selected model. Please retry.',
    });

    const persistedError = getPersistedProviderPayload(runStore, 'error');
    expect(persistedError).toMatchObject({
      raw_event: {
        error: {
          message: 'The provider is temporarily at capacity for the selected model. Please retry.',
        },
      },
      canonical_event: {
        status: {
          message: 'The provider is temporarily at capacity for the selected model. Please retry.',
        },
      },
    });
    expect(JSON.stringify(persistedError)).not.toContain(rawProviderFailure);
    expect(JSON.stringify(onAgentOutput.mock.calls)).not.toContain(rawProviderFailure);
    expect(error).toHaveBeenCalledWith(
      'local.runner.codex.provider_turn.failed',
      expect.objectContaining({ error: rawProviderFailure }),
    );
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('classifies a direct selected-model capacity rejection without exposing the diagnostic', async () => {
    const rawProviderFailure = 'Selected model gpt-5-codex is at capacity. trace=private-456';
    sdkStartSessionMock.mockRejectedValue(new Error(rawProviderFailure));
    const runStore = makeRunStore();
    const onAgentOutput = vi.fn();
    const { logger, error } = makeLogger();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      logger,
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await expect(
      runner.runPrompt({ session: makeSession(), prompt: 'Retry the work.' }),
    ).rejects.toMatchObject({
      code: 'MODEL_CAPACITY',
      message: 'The provider is temporarily at capacity for the selected model. Please retry.',
    });

    expect(JSON.stringify(vi.mocked(runStore.appendEvent).mock.calls)).not.toContain(
      rawProviderFailure,
    );
    expect(JSON.stringify(onAgentOutput.mock.calls)).not.toContain(rawProviderFailure);
    expect(error).toHaveBeenCalledWith(
      'local.runner.codex.run_prompt.failed',
      expect.objectContaining({ rawProviderErrorMessage: rawProviderFailure }),
    );
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('surfaces a provider thread-not-found resume failure as SESSION_NOT_FOUND', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      throw new Error('Session not found for thread_id: codex-thread-1');
    });
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await expect(
      runner.runPrompt({
        session: makeSession({ provider_session_id: 'codex-thread-1' }),
        prompt: 'Continue with the implementation.',
      }),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_FOUND' });
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('fails the run when codex returns a different thread id during resume', async () => {
    // A different thread id surfaces through getSessionId() than the one we
    // resumed against.
    sdkResumeSessionMock.mockImplementation(completedTurn('codex-thread-2'));
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await expect(
      runner.runPrompt({
        session: makeSession({ provider_session_id: 'codex-thread-1' }),
        prompt: 'Continue with session consistency checks.',
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'RUN_FAILED',
        message: expect.stringContaining('Provider identity mismatch'),
      }),
    );
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('fails resumeSession when provider session id is unresolved', async () => {
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
    });

    await expect(
      runner.resumeSession({
        session: makeSession({
          provider_session_id: 'pending_abc',
          events: [],
        }),
      }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'PROVIDER_SESSION_ID_MISSING',
      }),
    );
  });

  // ----- permissions via the ServerRequest dispatch hook --------------------

  it.each([
    'item/commandExecution/requestApproval',
    'item/fileChange/requestApproval',
    'execCommandApproval',
    'applyPatchApproval',
    'item/permissions/requestApproval',
  ])(
    'auto-approves %s over the native response channel when session authorization skips prompts',
    async (method) => {
      sdkStartSessionMock.mockImplementation(async () => {
        emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
        emitSdkServerRequest({
          id: 41,
          method,
          params: { command: ['pnpm', 'test'], cwd: '/tmp/repo' },
        });
        emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
      });
      const onAgentOutput = vi.fn();
      const runner = new CodexAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      });

      await runner.runPrompt({
        session: makeSession(),
        prompt: 'Continue autonomously.',
        skipPermissions: true,
      });

      expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(41, {
        decision: 'acceptForSession',
      });
      const startConfig = sdkStartSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(startConfig['sandbox']).toBe('workspace-write');
      expect(startConfig['config']).toMatchObject({
        sandbox_workspace_write: { writable_roots: [] },
      });
      expect(
        onAgentOutput.mock.calls.some(
          (call) => call[0]?.event?.eventType === 'permission_request_detected',
        ),
      ).toBe(false);
      expect(
        onAgentOutput.mock.calls.some(
          (call) =>
            call[0]?.event?.eventType === 'permission_auto_approved' &&
            call[0]?.event?.payload?.decision === 'session_authorization',
        ),
      ).toBe(true);
    },
  );

  it('preserves skipPermissions through resumeSession and auto-approves natively', async () => {
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 42,
        method: 'item/commandExecution/requestApproval',
        params: { command: ['pnpm', 'test'], cwd: '/tmp/repo' },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });
    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.resumeSession({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Resume autonomously.',
      skipPermissions: true,
    });

    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(42, {
      decision: 'acceptForSession',
    });
    const resumeConfig = sdkResumeSessionMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(resumeConfig['sandbox']).toBe('workspace-write');
    expect(resumeConfig['config']).toMatchObject({
      sandbox_workspace_write: { writable_roots: [] },
    });
    expect(
      onAgentOutput.mock.calls.some(
        (call) => call[0]?.event?.eventType === 'permission_request_detected',
      ),
    ).toBe(false);
  });

  it('queues a Codex ServerRequest approval and delivers the UI decision via submitClientResponse', async () => {
    const turn = createDeferred<void>();
    const started = createDeferred<void>();
    // Park the turn after raising a permission approval ServerRequest so the
    // decision can be submitted while the run is still in flight.
    sdkResumeSessionMock.mockImplementation(() => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 7,
        method: 'item/commandExecution/requestApproval',
        params: { command: ['npm', 'test'], cwd: '/tmp/repo' },
      });
      started.resolve();
      return turn.promise;
    });

    const onAgentOutput = vi.fn();
    const runStore = makeRunStore();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });
    const session = makeSession({ provider_session_id: 'codex-thread-1' });

    const runPromise = runner.runPrompt({ session, prompt: 'Continue with permission checks.' });
    await started.promise;

    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: 'codex-thread-1',
      requestId: '7',
      agentType: 'codex',
      decision: 'approve',
      reason: null,
      idempotencyToken: '7',
      deciderUserId: 'user-1',
    });

    const submitResult = await runner.submitPermissionDecision?.({ session, dispatch });
    expect(submitResult).toEqual({
      delivered: true,
      callbackType: 'codex_exec_approval_response',
    });
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(7, {
      decision: 'accept',
    });
    expect(
      onAgentOutput.mock.calls.some(
        (call) =>
          call[0]?.event?.eventType === 'permission_decision_ui' &&
          call[0]?.event?.payload?.requestId === '7' &&
          call[0]?.event?.payload?.decision === 'approve',
      ),
    ).toBe(true);

    emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    turn.resolve();
    await runPromise;
  });

  it('accepts always_approve decisions for Codex command approvals', async () => {
    const turn = createDeferred<void>();
    const started = createDeferred<void>();
    sdkResumeSessionMock.mockImplementation(() => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 8,
        method: 'item/commandExecution/requestApproval',
        params: { command: ['touch', '../api/write-test'], cwd: '/tmp/repo' },
      });
      started.resolve();
      return turn.promise;
    });

    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });
    const session = makeSession({ provider_session_id: 'codex-thread-1' });

    const runPromise = runner.runPrompt({ session, prompt: 'Continue with permission checks.' });
    await started.promise;

    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: 'codex-thread-1',
      requestId: '8',
      agentType: 'codex',
      decision: 'always_approve',
      reason: null,
      idempotencyToken: '8',
      deciderUserId: 'user-1',
    });

    const submitResult = await runner.submitPermissionDecision?.({ session, dispatch });
    expect(submitResult).toEqual({
      delivered: true,
      callbackType: 'codex_exec_approval_response',
    });
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(8, {
      decision: 'acceptForSession',
    });
    expect(
      onAgentOutput.mock.calls.some(
        (call) =>
          call[0]?.event?.eventType === 'permission_decision_ui' &&
          call[0]?.event?.payload?.requestId === '8' &&
          call[0]?.event?.payload?.decision === 'always_approve',
      ),
    ).toBe(true);

    emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    turn.resolve();
    await runPromise;
  });

  it('auto-approves later Codex file changes after an always_approve file-change decision', async () => {
    const turn = createDeferred<void>();
    const started = createDeferred<void>();
    sdkResumeSessionMock.mockImplementation(() => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 8,
        method: 'item/fileChange/requestApproval',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          itemId: 'file-change-1',
        },
      });
      started.resolve();
      return turn.promise;
    });

    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });
    const session = makeSession({ provider_session_id: 'codex-thread-1' });

    const runPromise = runner.runPrompt({ session, prompt: 'Continue with file changes.' });
    await started.promise;

    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: 'codex-thread-1',
      requestId: '8',
      agentType: 'codex',
      decision: 'always_approve',
      reason: null,
      idempotencyToken: '8',
      deciderUserId: 'user-1',
    });

    const submitResult = await runner.submitPermissionDecision?.({ session, dispatch });
    expect(submitResult).toEqual({
      delivered: true,
      callbackType: 'codex_exec_approval_response',
    });
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(8, {
      decision: 'acceptForSession',
    });
    const permissionRequestsBeforeSecondRequest = onAgentOutput.mock.calls.filter(
      (call) => call[0]?.event?.eventType === 'permission_request_detected',
    );
    expect(permissionRequestsBeforeSecondRequest).toHaveLength(1);

    emitSdkServerRequest({
      id: 9,
      method: 'item/fileChange/requestApproval',
      params: {
        threadId: 'codex-thread-1',
        turnId: 'turn-1',
        itemId: 'file-change-2',
      },
    });

    expect(sdkSubmitClientResponseMock).toHaveBeenLastCalledWith(9, {
      decision: 'acceptForSession',
    });
    const permissionRequestsAfterSecondRequest = onAgentOutput.mock.calls.filter(
      (call) => call[0]?.event?.eventType === 'permission_request_detected',
    );
    expect(permissionRequestsAfterSecondRequest).toHaveLength(1);
    expect(
      onAgentOutput.mock.calls.some(
        (call) =>
          call[0]?.event?.source === 'local' &&
          call[0]?.event?.eventType === 'permission_auto_approved' &&
          call[0]?.event?.payload?.permission_type === 'file_change',
      ),
    ).toBe(true);

    emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    turn.resolve();
    await runPromise;
  });

  it('auto-approves preapproved Hey Hey MCP tool elicitations', async () => {
    const oauthClient = createProviderTestOAuthClient();
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 8,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          mode: 'form',
          message: 'Allow this request?',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_name: 'get_context',
            tool_params: { entityId: 'task-1' },
          },
          requestedSchema: { type: 'object', properties: {} },
        },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    await runner.runPrompt({
      session: makeSession(),
      prompt: 'Use graph context.',
      readOnlyFilesystem: true,
    });

    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(8, {
      action: 'accept',
      content: null,
      _meta: { persist: 'always' },
    });
  });

  it('auto-approves handler MCP extras on Codex resume turns', async () => {
    const oauthClient = createProviderTestOAuthClient();
    buildMcpServerConfigMock.mockImplementation(async (_oauthClient, _context, options) => {
      const additionalTools = Array.isArray(options?.['additionalTools'])
        ? options['additionalTools']
        : [];
      return {
        mcpServers: {
          'heyhey-platform': {
            type: 'http',
            url: 'https://heyhey.dev/mcp',
            headers: {
              Authorization: 'Bearer access-token',
              'X-Project-ID': 'project-1',
            },
          },
        },
        allowedTools: additionalTools.includes('create_step')
          ? ['mcp__heyhey-platform__get_context', 'mcp__heyhey-platform__create_step']
          : ['mcp__heyhey-platform__get_context'],
      };
    });
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 15,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          mode: 'form',
          message: 'Allow the heyhey-platform MCP server to run tool "create_step"?',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_name: 'create_step',
            tool_params: { stageId: 'stage-1' },
          },
          requestedSchema: { type: 'object', properties: {} },
        },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    await runner.resumeSession({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Add the next step.',
      mcpToolUseCase: 'plan_shaping',
      additionalAllowedTools: ['create_step'],
    });

    expect(buildMcpServerConfigMock).toHaveBeenCalledWith(
      oauthClient,
      expect.objectContaining({
        projectId: 'project-1',
        conversationId: 'conv-1',
        serviceId: 'svc-1',
        agentSessionId: 'agentic-1',
      }),
      { useCase: 'plan_shaping', additionalTools: ['create_step'] },
    );
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(15, {
      action: 'accept',
      content: null,
      _meta: { persist: 'always' },
    });
  });

  it('classifies handler MCP extras on Codex resume turns as tool-surface mismatches when the tool is not allowed', async () => {
    const oauthClient = createProviderTestOAuthClient();
    const { logger, debug, warn } = makeLogger();
    sdkResumeSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 16,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          mode: 'form',
          message: 'Allow the heyhey-platform MCP server to run tool "create_step"?',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_name: 'create_step',
            tool_params: { stageId: 'stage-1' },
          },
          requestedSchema: { type: 'object', properties: {} },
        },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
      logger,
    });

    await runner.resumeSession({
      session: makeSession({ provider_session_id: 'codex-thread-1' }),
      prompt: 'Add the next step.',
      mcpToolUseCase: 'plan_shaping',
      additionalAllowedTools: ['create_stage'],
    });

    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(16, {
      action: 'decline',
      content: {
        classification: 'tool_surface_mismatch',
        message: expect.stringContaining('not a user rejection'),
      },
      _meta: {
        classification: 'tool_surface_mismatch',
        reason: 'inactive_tool_surface',
      },
    });
    expect(debug).toHaveBeenCalledWith(
      'local.runner.codex.resume.mcp_surface',
      expect.objectContaining({
        sessionId: 'agentic-1',
        providerSessionId: 'codex-thread-1',
        effectiveMcpToolUseCase: 'plan_shaping',
        additionalAllowedTools: ['create_stage'],
        additionalAllowedToolCount: 1,
      }),
    );
    expect(warn).toHaveBeenCalledWith(
      'local.runner.codex.mcp_elicitation.tool_surface_mismatch',
      expect.objectContaining({
        runId: expect.stringMatching(/^codex_/),
        sessionId: 'agentic-1',
        mode: 'resume',
        sessionPromptType: null,
        persistedProviderSessionId: 'codex-thread-1',
        clientSessionId: 'codex-thread-1',
        rawRequestId: 16,
        serverName: 'heyhey-platform',
        toolName: 'create_step',
        qualifiedToolName: 'mcp__heyhey-platform__create_step',
        classification: 'tool_surface_mismatch',
        availability: 'absent_from_active_tool_set',
        reason: expect.stringContaining('not a user rejection'),
        effectiveMcpToolUseCase: 'plan_shaping',
        additionalAllowedTools: ['create_stage'],
        additionalAllowedToolCount: 1,
        activeAllowedToolCount: 1,
        activeHeyHeyPlatformAllowedTools: ['mcp__heyhey-platform__get_context'],
        activeHeyHeySubmissionAllowedTools: [],
        requestedToolAllowed: false,
        activeToolSetSource: 'codex_prompt_mcp_config',
        mountedHeyHeyServerNames: ['heyhey-platform'],
        mountedSubmissionToolNames: [],
      }),
    );
  });

  it('classifies Hey Hey MCP elicitations outside the active allowlist as tool-surface mismatches', async () => {
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 12,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          mode: 'form',
          message: 'Allow the heyhey-platform MCP server to run tool "get_edges"?',
          requestedSchema: { type: 'object', properties: {} },
        },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const onAgentOutput = vi.fn();
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    await runner.runPrompt({ session: makeSession(), prompt: 'Use graph edges.' });

    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(12, {
      action: 'decline',
      content: {
        classification: 'tool_surface_mismatch',
        message: expect.stringContaining('not a user rejection'),
      },
      _meta: {
        classification: 'tool_surface_mismatch',
        reason: 'inactive_tool_surface',
      },
    });
    expect(
      onAgentOutput.mock.calls.some((call) => call[0]?.event?.eventType === 'permission_request'),
    ).toBe(false);
  });

  it('auto-approves a project-visible IMPLEMENT report through the run-scoped submission wrapper', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [{ ...fakeSubmissionTool, name: 'create_report' }],
    });
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 13,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-submission-tools',
          mode: 'form',
          message: 'Allow the heyhey-submission-tools MCP server to run tool "create_report"?',
          requestedSchema: {
            type: 'object',
            properties: {
              reportType: { const: 'IMPLEMENT' },
              audience: { const: 'PROJECT_VISIBLE' },
              payload: {
                type: 'object',
                properties: {
                  reportType: { const: 'IMPLEMENT' },
                  filesChanged: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await runner.runPrompt({ session: makeSession(), prompt: 'Create a report.' });

    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(13, {
      action: 'accept',
      content: null,
      _meta: { persist: 'always' },
    });
  });

  it('classifies mounted but inactive submission-tool elicitations as tool-surface mismatches', async () => {
    localAgentEndpoint.set('http://127.0.0.1:3847');
    submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: 'node-1',
      triggerMessageId: 'message-1',
      tools: [
        { ...fakeSubmissionTool, name: 'submit_discrepancies' },
        { ...fakeSubmissionTool, name: 'submit_revised' },
      ],
      activeToolNames: ['submit_discrepancies'],
    });
    const { logger, warn } = makeLogger();
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 17,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-submission-tools',
          mode: 'form',
          message: 'Allow the heyhey-submission-tools MCP server to run tool "submit_revised"?',
          requestedSchema: { type: 'object', properties: {} },
        },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    await runner.runPrompt({ session: makeSession(), prompt: 'Submit a revised result.' });

    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(17, {
      action: 'decline',
      content: {
        classification: 'tool_surface_mismatch',
        message: expect.stringContaining('not a user rejection'),
      },
      _meta: {
        classification: 'tool_surface_mismatch',
        reason: 'inactive_tool_surface',
      },
    });
    expect(warn).toHaveBeenCalledWith(
      'local.runner.codex.mcp_elicitation.tool_surface_mismatch',
      expect.objectContaining({
        serverName: 'heyhey-submission-tools',
        toolName: 'submit_revised',
        qualifiedToolName: 'mcp__heyhey-submission-tools__submit_revised',
        classification: 'tool_surface_mismatch',
        availability: 'mounted_but_inactive',
        activeHeyHeySubmissionAllowedTools: ['mcp__heyhey-submission-tools__submit_discrepancies'],
        mountedSubmissionToolNames: ['submit_discrepancies', 'submit_revised'],
        activeSubmissionToolNames: ['submit_discrepancies'],
      }),
    );
  });

  it('classifies direct platform create_report as a tool-surface mismatch so reports must use the submission wrapper', async () => {
    const oauthClient = createProviderTestOAuthClient();
    sdkStartSessionMock.mockImplementation(async () => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 14,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'heyhey-platform',
          mode: 'form',
          message: 'Allow the heyhey-platform MCP server to run tool "create_report"?',
          requestedSchema: { type: 'object', properties: {} },
        },
      });
      emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    await runner.runPrompt({ session: makeSession(), prompt: 'Create a report.' });

    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(14, {
      action: 'decline',
      content: {
        classification: 'tool_surface_mismatch',
        message: expect.stringContaining('not a user rejection'),
      },
      _meta: {
        classification: 'tool_surface_mismatch',
        reason: 'inactive_tool_surface',
      },
    });
  });

  it('queues non-preapproved MCP elicitations and returns the Codex elicitation response shape', async () => {
    const turn = createDeferred<void>();
    const started = createDeferred<void>();
    sdkResumeSessionMock.mockImplementation(() => {
      emitSdkEvent('thread/started', { thread: { id: 'codex-thread-1' } });
      emitSdkServerRequest({
        id: 11,
        method: 'mcpServer/elicitation/request',
        params: {
          threadId: 'codex-thread-1',
          turnId: 'turn-1',
          serverName: 'external-server',
          mode: 'form',
          message: 'Allow external tool?',
          _meta: {
            codex_approval_kind: 'mcp_tool_call',
            tool_name: 'lookup',
            tool_params: { query: 'task-1' },
          },
          requestedSchema: { type: 'object', properties: {} },
        },
      });
      started.resolve();
      return turn.promise;
    });

    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    const session = makeSession({ provider_session_id: 'codex-thread-1' });

    const runPromise = runner.runPrompt({ session, prompt: 'Continue with MCP checks.' });
    await started.promise;

    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: 'codex-thread-1',
      requestId: '11',
      agentType: 'codex',
      decision: 'always_approve',
      reason: null,
      idempotencyToken: '11',
      deciderUserId: 'user-1',
    });

    const submitResult = await runner.submitPermissionDecision?.({ session, dispatch });
    expect(submitResult).toEqual({
      delivered: true,
      callbackType: 'codex_exec_approval_response',
    });
    expect(sdkSubmitClientResponseMock).toHaveBeenCalledWith(11, {
      action: 'accept',
      content: null,
      _meta: { persist: 'always' },
    });

    emitSdkEvent('turn/completed', { turn: { status: 'completed' } });
    turn.resolve(undefined);
    await runPromise;
  });

  it('returns a stale outcome when the Codex request id is unknown', async () => {
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    const session = makeSession({ provider_session_id: 'codex-thread-1' });
    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: 'codex-thread-1',
      requestId: 'missing-permission-id',
      agentType: 'codex',
      decision: 'deny',
      reason: 'Denied by reviewer.',
      idempotencyToken: null,
      deciderUserId: 'user-1',
    });

    await expect(runner.submitPermissionDecision?.({ session, dispatch })).resolves.toEqual({
      delivered: false,
      outcome: 'stale',
      reason: 'request_not_found',
    });
  });

  // ----- context usage ------------------------------------------------------

  it('getContextUsage() delegates to the native client and returns its LocalContextData', async () => {
    const contextData = makeContextData();
    sdkGetSessionIdMock.mockReturnValue('sdk-session-1');
    sdkGetContextUsageMock.mockReturnValue(contextData);
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.getContextUsage()).resolves.toEqual(contextData);
    expect(sdkGetContextUsageMock).toHaveBeenCalledTimes(1);
  });

  it('getContextUsageByResume() delegates to a read-only native resume and returns context data', async () => {
    const contextData = makeContextData();
    sdkGetContextUsageByResumeMock.mockResolvedValue(contextData);
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore('/tmp/repo'),
    });
    const session = makeSession({ provider_session_id: 'codex-thread-1' });

    await expect(runner.getContextUsageByResume?.({ session })).resolves.toEqual(contextData);
    expect(sdkGetContextUsageByResumeMock).toHaveBeenCalledTimes(1);
    expect(sdkGetContextUsageByResumeMock).toHaveBeenCalledWith(
      'codex-thread-1',
      {
        prompt: '',
        cwd: '/tmp/repo',
      },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(sdkResumeSessionMock).not.toHaveBeenCalled();
  });

  it('getContextUsage() throws NO_ACTIVE_SESSION when there is no live session', async () => {
    sdkGetSessionIdMock.mockReturnValue(null);
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.getContextUsage()).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'NO_ACTIVE_SESSION',
    });
    expect(sdkGetContextUsageMock).not.toHaveBeenCalled();
  });

  it('getContextUsage() rejects a providerSessionId that does not match the live session', async () => {
    sdkGetSessionIdMock.mockReturnValue('sdk-session-1');
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.getContextUsage('stale-provider-session')).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'NO_ACTIVE_SESSION',
    });
    expect(sdkGetContextUsageMock).not.toHaveBeenCalled();
  });

  it('getContextUsage() maps the native no-snapshot error to NO_ACTIVE_SESSION', async () => {
    sdkGetSessionIdMock.mockReturnValue('sdk-session-1');
    sdkGetContextUsageMock.mockImplementation(() => {
      throw new CodexNoContextSnapshotError(
        'No token usage snapshot observed yet on this session.',
      );
    });
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.getContextUsage()).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'NO_ACTIVE_SESSION',
    });
  });

  // ----- compaction ---------------------------------------------------------

  it('compact() resolves when SDK client compact succeeds', async () => {
    sdkGetSessionIdMock.mockReturnValue('codex-thread-1');
    sdkCompactMock.mockResolvedValue(undefined);
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.compact?.()).resolves.toBeUndefined();
    expect(sdkCompactMock).toHaveBeenCalledTimes(1);
  });

  it('compact() throws NO_ACTIVE_SESSION when there is no live session', async () => {
    sdkGetSessionIdMock.mockReturnValue(null);
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.compact?.()).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'NO_ACTIVE_SESSION',
    });
    expect(sdkCompactMock).not.toHaveBeenCalled();
  });

  it('compact() maps "turn is in flight" error to RUN_BUSY', async () => {
    sdkGetSessionIdMock.mockReturnValue('codex-thread-1');
    sdkCompactMock.mockRejectedValue(new Error('Cannot compact: a turn is in flight'));
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.compact?.()).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'RUN_BUSY',
    });
  });

  it('compact() maps a generic SDK error to RUN_FAILED', async () => {
    sdkGetSessionIdMock.mockReturnValue('codex-thread-1');
    sdkCompactMock.mockRejectedValue(new Error('SDK internal error'));
    const runner = new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    await expect(runner.compact?.()).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'RUN_FAILED',
    });
  });
});

describe('CodexAgentSessionRunner.promptOnce', () => {
  const makeRunner = (runStore: RunStore = makeRunStore()) =>
    new CodexAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      runStore,
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    sdkEventHandler = null;
    sdkDisconnectMock.mockResolvedValue(undefined);
    sdkStartSessionMock.mockImplementation(async () => {
      sdkEventHandler?.({
        method: 'item/completed',
        params: { item: { type: 'agentMessage', text: 'search for jev' } },
      });
    });
  });

  it('returns the agent message from a read-only thread in an empty directory', async () => {
    const runStore = makeRunStore();
    const { signal } = new AbortController();

    const answer = await makeRunner(runStore).promptOnce({
      session: makeSession(),
      prompt: 'plan searches',
      model: 'turn-model',
      reasoningEffort: 'high',
      signal,
    });

    expect(answer).toBe('search for jev');
    const [config, options] = sdkStartSessionMock.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ];
    expect(config).toMatchObject({
      prompt: 'plan searches',
      sandbox: 'read-only',
      model: 'turn-model',
      effort: 'high',
    });
    expect(config).not.toHaveProperty('config');
    expect(config['cwd']).not.toBe('/tmp/repo');
    expect(options).toEqual({ signal });
    expect(sdkDisconnectMock).toHaveBeenCalledTimes(1);
    expect(runStore.appendEvent).not.toHaveBeenCalled();
  });

  it('throws the provider error when the turn fails', async () => {
    sdkStartSessionMock.mockRejectedValue(new Error('model unavailable'));

    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('model unavailable');
    expect(sdkDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the turn produces no agent message', async () => {
    sdkStartSessionMock.mockResolvedValue(undefined);

    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
  });
});

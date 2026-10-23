import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import type { ServerLogger } from '../../../server/logger';
import type { AgenticSession } from '../../../session/index';
import { WorkStatus } from '../../../shared/api/generated/api';
import type { ProjectMaturity, WorkItemTypeDefinitionDto } from '../../../shared/api/index';
import { LocalPromptType } from '../../../shared/agent-bridge-contract/contract';
import { intentFirstGuidance, takingShapeGuidance } from '../../prompts/common';
import { renderWorkItemTypeOntologyEntry } from '../../prompts/render-type-ontology';
import {
  OpenCodeAgentSessionRunner,
  resolveOpenCodeProjectReportTools,
  resolveOpenCodeRepositoryResearchTools,
} from './session-runner-opencode';
import { translatePermissionDecisionToDispatch } from '../../permission-response-routing';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import { PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE } from '../platform-prompt-delivery';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { ToolRuleStore } from '../../../session/tool-rules';
import {
  createProviderTestAgentOutputOwner,
  createProviderTestRepoMappingStore,
  createProviderTestRunStore,
} from '../provider-owner.test-support';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../../auth/oauth-client.test-support';
import { RunWorkspaceWriteBoundary } from '../../workspace-write-boundary';
import type { ResolvedRunWorkspace } from '../../run-scope';

const localAgentEndpoint = new LocalAgentEndpoint();
const submissionToolRegistry = new SubmissionToolRegistry();

describe('OpenCode repository research tools', () => {
  it('allows native reads and Task delegation while denying write-capable tools', () => {
    expect(resolveOpenCodeRepositoryResearchTools('allowed')).toMatchObject({
      read: true,
      glob: true,
      grep: true,
      list: true,
      task: true,
      bash: false,
      edit: false,
      write: false,
      apply_patch: false,
    });
  });

  it('can disable delegation without changing read-only access', () => {
    expect(resolveOpenCodeRepositoryResearchTools('disabled')).toMatchObject({
      read: true,
      grep: true,
      task: false,
      edit: false,
    });
  });
});

const PROJECT_REPORT_PLATFORM_TOOLS = {
  'heyhey-platform_get_report_schema': true,
  'heyhey-platform_get_full_entity': true,
  'heyhey-platform_get_context': true,
  'heyhey-platform_get_edges': true,
  'heyhey-platform_unified_search': true,
  'heyhey-platform_task_search': true,
  'heyhey-platform_search_features': true,
  'heyhey-platform_list_reports_by_entity': true,
  'heyhey-platform_get_report_body': true,
};

describe('OpenCode project report tools', () => {
  it('denies every native tool and allows only read-only platform reads and canonical report submission', () => {
    expect(resolveOpenCodeProjectReportTools(true, true)).toEqual({
      '*': false,
      'heyhey-submission-tools_create_report': true,
      ...PROJECT_REPORT_PLATFORM_TOOLS,
    });
    expect(resolveOpenCodeProjectReportTools(false, false)).toEqual({ '*': false });
  });
});

const launchOpencodeServerMock = vi.fn();
vi.mock('./opencode-server-launcher', () => ({
  describeOpenCodeCredentialSources: () => ({
    xdgDataHome: '/xdg',
    authFilePresent: false,
    authProviderIds: [],
    apiKeyEnvNames: [],
  }),
  OpenCodeServerProcess: class {
    static launch(...args: unknown[]) {
      return launchOpencodeServerMock(...args);
    }
  },
}));

const getOpencodeModelRefMock = vi.fn<
  (model: string) => { providerID: string; modelID: string } | null
>(() => null);
vi.mock(
  '../../../../../../packages/ui-common/src/components/AgentSession/capabilityCatalog',
  () => ({
    getOpencodeModelRef: (model: string) => getOpencodeModelRefMock(model),
    OPENCODE_DEFAULT_MODEL_ID: 'opencode-default',
  }),
);

const toolRuleStoreDirectory = mkdtempSync(join(tmpdir(), 'hey-hey-opencode-tool-rules-'));
const toolRuleStore = new ToolRuleStore(join(toolRuleStoreDirectory, 'tool-rules.json'));
const saveToolRuleMock = vi.spyOn(toolRuleStore, 'save').mockImplementation(() => undefined);
const loadToolRulesMock = vi.spyOn(toolRuleStore, 'load').mockReturnValue([]);

afterAll(() => {
  rmSync(toolRuleStoreDirectory, { recursive: true, force: true });
});
const buildMcpServerConfigMock = vi.fn(async () => ({
  mcpServers: {
    'heyhey-platform': {
      type: 'http',
      url: 'https://heyhey.dev/mcp',
      headers: {
        Authorization: 'Bearer access-token',
      },
    },
  },
  allowedTools: ['mcp__heyhey-platform__unified_search'],
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

const removeWorktreeMock = vi.fn(async () => undefined);
vi.mock('../../../git/index', () => ({
  removeWorktree: (...args: Parameters<typeof removeWorktreeMock>) => removeWorktreeMock(...args),
}));

const resolveRunWorkspaceMock = vi.fn();
vi.mock('../../run-scope', () => ({
  resolveRunWorkspace: (...args: Parameters<typeof resolveRunWorkspaceMock>) =>
    resolveRunWorkspaceMock(...args),
  selectLaunchWorktreeState: (
    _session: AgenticSession,
    worktreeState: Record<string, { repoPath: string; worktreePath: string }>,
  ) => Object.values(worktreeState)[0] ?? null,
}));

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
// point with each in turn and assert the `system` field tracks whichever the
// stubbed read returns — proving a registry change alone re-shapes the next
// session's ontology with no builder or runner edit.
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

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession => {
  const base: AgenticSession = {
    entity: null,
    agentic_session_id: 'agentic-1',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    provider: 'opencode',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    status: 'idle',
    contextMetadata: {
      capturedAt: '2026-02-20T00:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: 'agent-session-1',
      launchPlanId: 'plan-1',
      launchStepId: 'step-1',
      task: {
        id: 'task-1',
        name: 'Task one',
        type: 'STANDARD',
        organizationId: 'org-1',
        projectId: 'project-1',
        initiativeId: 'initiative-1',
        status: 'ACTIVE',
        source: 'user',
      },
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    } as AgenticSession['contextMetadata'],
    createdAt: '2026-02-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
    conversationId: 'conv-1',
    events: [],
  };

  return { ...base, ...overrides } as AgenticSession;
};

const makeRunStore = (): RunStore => createProviderTestRunStore(makeSession);

const makeRepoStore = (): RepoMappingStore => createProviderTestRepoMappingStore();

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
  logger = { trace, debug, info, warn, error, child };
  return { logger, debug, info, warn, error };
};

const makeOauthClient = () => createProviderTestOAuthClient();

interface SseSink {
  push: (event: { type: string; properties: Record<string, unknown>; id?: string }) => void;
  end: () => void;
}

const makeSseStream = (sink: { current: SseSink | null }): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      sink.current = {
        push: (event) =>
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ id: event.id ?? 'evt', type: event.type, properties: event.properties })}\n`,
            ),
          ),
        end: () => controller.close(),
      };
    },
  });
};

const buildJsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const countOccurrences = (value: string, needle: string): number => value.split(needle).length - 1;

interface FetchHarnessOptions {
  providerStatus?: number;
  summarizeStatus?: number;
}

interface FetchHarness {
  mock: ReturnType<typeof vi.fn>;
  recorded: Array<{ url: string; init: RequestInit | undefined }>;
  sseSink: { current: SseSink | null };
  permissionReplies: Array<{ requestId: string; reply: string }>;
}

const installFetchHarness = (options: FetchHarnessOptions = {}): FetchHarness => {
  const recorded: FetchHarness['recorded'] = [];
  const sseSink: FetchHarness['sseSink'] = { current: null };
  const permissionReplies: FetchHarness['permissionReplies'] = [];

  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.toString()
          : (input as Request).url;
    recorded.push({ url, init });

    if (url.includes('/health')) {
      return buildJsonResponse({ healthy: true });
    }
    if (url.includes('/mcp') && init?.method === 'POST') {
      return buildJsonResponse({});
    }
    const permMatch = url.match(/\/permission\/([^/?]+)\/reply/);
    if (permMatch && init?.method === 'POST') {
      const body = init.body ? JSON.parse(String(init.body)) : {};
      permissionReplies.push({ requestId: permMatch[1]!, reply: body.reply ?? '' });
      return buildJsonResponse({});
    }
    if (url.includes('/event')) {
      return new Response(makeSseStream(sseSink), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    }
    if (url.includes('/config/providers')) {
      if (options.providerStatus !== undefined && options.providerStatus !== 200) {
        return buildJsonResponse({ error: 'provider catalog unavailable' }, options.providerStatus);
      }
      return buildJsonResponse({
        providers: [
          {
            id: 'opencode-go',
            models: {
              'glm-5.2': { id: 'glm-5.2', limit: { context: 1_000 } },
            },
          },
        ],
        default: {},
      });
    }
    if (url.includes('/session/opencode-session-1/message')) {
      return buildJsonResponse([
        {
          info: {
            role: 'assistant',
            providerID: 'opencode-go',
            modelID: 'glm-5.2',
            tokens: {
              input: 250,
              output: 40,
              reasoning: 0,
              cache: { read: 20, write: 5 },
            },
          },
          parts: [],
        },
      ]);
    }
    if (url.includes('/summarize') && init?.method === 'POST') {
      return buildJsonResponse(true, options.summarizeStatus ?? 200);
    }
    if (
      url.match(/\/session\/[^/?]+\?/) &&
      (!init || init.method === undefined || init.method === 'GET')
    ) {
      const sessionId = url.match(/\/session\/([^/?]+)\?/)?.[1] ?? 'opencode-session-1';
      return buildJsonResponse({ id: sessionId });
    }
    if (url.match(/\/session(\?|$)/) && init?.method === 'POST') {
      return buildJsonResponse({ id: 'opencode-session-1' });
    }
    if (url.match(/\/session\/[^/?]+\/prompt_async/) && init?.method === 'POST') {
      return new Response(null, { status: 204 });
    }
    return buildJsonResponse({});
  });

  global.fetch = mock as unknown as typeof fetch;
  return { mock, recorded, sseSink, permissionReplies };
};

const waitFor = async (predicate: () => boolean, attempts = 200): Promise<void> => {
  for (let i = 0; i < attempts; i += 1) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor timed out');
};

describe('session-runner-opencode parity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submissionToolRegistry.clearAll();
    loadToolRulesMock.mockReturnValue([]);
    getOpencodeModelRefMock.mockImplementation((model) => ({
      providerID: 'opencode-go',
      modelID: model,
    }));
    launchOpencodeServerMock.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:7777',
      directory: '/tmp/repo',
      stop: vi.fn(async () => undefined),
    });
    resolveRunWorkspaceMock.mockResolvedValue({
      ok: true,
      cwd: '/tmp/repo',
      repositoryPathForRunStarted: '/tmp/repo',
      worktree: null,
    });
    localAgentEndpoint.set('http://127.0.0.1:9999');
  });

  afterEach(() => {
    submissionToolRegistry.clearAll();
  });

  it('returns a stale outcome when the OpenCode request id is unknown', async () => {
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });
    const session = makeSession();
    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: session.agentic_session_id,
      requestId: 'missing-permission-id',
      agentType: 'opencode',
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

  it.each(['fresh', 'resume'] as const)(
    'sends OpenCode attachment contents on %s requests',
    async (mode) => {
      const harness = installFetchHarness();
      const content = [
        { kind: 'text' as const, fileName: 'notes.md', text: 'private attachment contents' },
        {
          kind: 'image' as const,
          fileName: 'image.png',
          mediaType: 'image/png' as const,
          data: 'aW1hZ2U=',
        },
      ];
      const references = [
        { attachmentId: 'stored-reference', fileName: 'notes.md' },
        { attachmentId: 'stored-image', fileName: 'image.png' },
      ];
      const read = vi
        .spyOn(RunAttachmentContentReader.prototype, 'read')
        .mockResolvedValue(content);
      const { logger } = makeLogger();
      const runStore = makeRunStore();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore,
        repoStore: makeRepoStore(),
        logger,
      });
      const session = makeSession(
        mode === 'fresh' ? {} : { provider_session_id: 'opencode-session-1' },
      );
      try {
        const promise =
          mode === 'fresh'
            ? runner.runPrompt({
                session,
                prompt: '  Read this.\n',
                attachmentRunId: 'owning-run',
                attachments: references,
              })
            : runner.resumeSession({
                session,
                prompt: '  Read this.\n',
                attachmentRunId: 'owning-run',
                attachments: references,
              });
        await waitFor(() => harness.recorded.some((call) => call.url.includes('/prompt_async')));
        const call = harness.recorded.find((call) => call.url.includes('/prompt_async'))!;
        expect(JSON.parse(String(call.init!.body)).parts).toEqual([
          { type: 'text', text: '  Read this.\n' },
          { type: 'text', text: 'File: notes.md\nprivate attachment contents' },
          {
            type: 'file',
            filename: 'image.png',
            mime: 'image/png',
            url: 'data:image/png;base64,aW1hZ2U=',
          },
        ]);
        expect(read).toHaveBeenCalledWith('owning-run', references, logger);
        harness.sseSink.current!.push({
          type: 'message.updated',
          properties: { sessionID: 'opencode-session-1', info: { id: 'user-input', role: 'user' } },
        });
        harness.sseSink.current!.push({
          type: 'message.part.updated',
          properties: {
            sessionID: 'opencode-session-1',
            part: {
              type: 'text',
              sessionID: 'opencode-session-1',
              messageID: 'user-input',
              text: 'private attachment contents',
            },
          },
        });
        harness.sseSink.current!.push({
          type: 'session.status',
          properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
        });
        harness.sseSink.current!.end();
        await promise;
        expect(JSON.stringify(vi.mocked(runStore.appendEvent).mock.calls)).not.toContain(
          'private attachment contents',
        );
      } finally {
        read.mockRestore();
      }
    },
  );

  describe('stalled and failing model requests', () => {
    const makeRunner = (
      overrides: Partial<ConstructorParameters<typeof OpenCodeAgentSessionRunner>[0]> = {},
    ) => {
      const log = makeLogger();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        logger: log.logger,
        ...overrides,
      });
      return { runner, log };
    };

    it('fails the turn with the provider message on session.error', async () => {
      const harness = installFetchHarness();
      const { runner, log } = makeRunner();
      const promise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
      const rejection = expect(promise).rejects.toThrow(
        'OpenCode session error (APIError): usage limit reached',
      );
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'session.error',
        properties: {
          sessionID: 'opencode-session-1',
          error: { name: 'APIError', data: { message: 'usage limit reached' } },
        },
      });
      await rejection;
      expect(log.error).toHaveBeenCalledWith(
        'local.runner.opencode.session.error',
        expect.objectContaining({ errorName: 'APIError', message: 'usage limit reached' }),
      );
    });

    it('logs the retry reason and shows a retrying status without ending the turn', async () => {
      const harness = installFetchHarness();
      const onAgentOutput = vi.fn();
      const { runner, log } = makeRunner({
        agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      });
      const promise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'session.status',
        properties: {
          sessionID: 'opencode-session-1',
          status: { type: 'retry', attempt: 3, message: 'Overloaded', next: Date.now() + 8000 },
        },
      });
      await waitFor(() =>
        log.warn.mock.calls.some((call) => call[0] === 'local.runner.opencode.session.retrying'),
      );
      expect(log.warn).toHaveBeenCalledWith(
        'local.runner.opencode.session.retrying',
        expect.objectContaining({ attempt: 3, message: 'Overloaded' }),
      );
      const loadingTexts = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
        .map(([call]) => (call.event['payload'] as Record<string, unknown>)['loadingText'])
        .filter((text): text is string => typeof text === 'string');
      expect(loadingTexts.at(-1)).toContain('attempt 3): Overloaded');

      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
      });
      harness.sseSink.current!.end();
      await promise;
    });

    it('fails the turn naming the last event when the provider goes silent', async () => {
      const harness = installFetchHarness();
      const { runner, log } = makeRunner({ inactivityTimeoutMs: 50 });
      const promise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
      const rejection = expect(promise).rejects.toThrow(
        /no events for \d+ minutes \(last event: session\.status\)/,
      );
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'busy' } },
      });
      await rejection;
      expect(log.error).toHaveBeenCalledWith(
        'local.runner.opencode.inactivity_timeout',
        expect.objectContaining({ lastEventType: 'session.status' }),
      );
    });

    it('does not time out while a tool call is still running', async () => {
      const harness = installFetchHarness();
      const { runner } = makeRunner({ inactivityTimeoutMs: 50 });
      const promise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'message.part.updated',
        properties: {
          sessionID: 'opencode-session-1',
          part: {
            type: 'tool',
            tool: 'bash',
            callID: 'call-1',
            sessionID: 'opencode-session-1',
            state: { status: 'running', input: { command: 'sleep 1' }, time: { start: 1 } },
          },
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
      });
      harness.sseSink.current!.end();
      await expect(promise).resolves.toBeDefined();
    });
  });

  describe('forwards model and reasoning effort to OpenCode on prompt_async', () => {
    const driveRunWith = async (
      harness: FetchHarness,
      args: { model?: string; reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max' },
    ): Promise<Record<string, unknown>> => {
      const { logger } = makeLogger();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: makeOauthClient(),
        logger,
      });
      const runPromise = runner.runPrompt({
        session: makeSession(),
        prompt: 'go',
        ...(args.model !== undefined ? { model: args.model } : {}),
        ...(args.reasoningEffort !== undefined ? { reasoningEffort: args.reasoningEffort } : {}),
      });
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
      });
      harness.sseSink.current!.end();
      await runPromise;

      const promptCall = harness.recorded.find((r) => r.url.includes('/prompt_async'));
      expect(promptCall).toBeDefined();
      return JSON.parse(String(promptCall!.init!.body)) as Record<string, unknown>;
    };

    it('omits both fields when model and reasoningEffort are unset', async () => {
      const harness = installFetchHarness();
      const body = await driveRunWith(harness, {});
      expect(body).not.toHaveProperty('model');
      expect(body).not.toHaveProperty('variant');
    });

    it('forwards reasoningEffort as variant when only effort is set', async () => {
      const harness = installFetchHarness();
      const body = await driveRunWith(harness, { reasoningEffort: 'high' });
      expect(body['variant']).toBe('high');
      expect(body).not.toHaveProperty('model');
    });

    it('forwards model as a {providerID, modelID} pair when the catalog has a ref', async () => {
      getOpencodeModelRefMock.mockReturnValue({
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-5',
      });
      const harness = installFetchHarness();
      const body = await driveRunWith(harness, { model: 'sonnet' });
      expect(body['model']).toEqual({
        providerID: 'anthropic',
        modelID: 'claude-sonnet-4-5',
      });
      expect(body).not.toHaveProperty('variant');
    });

    it('forwards both model and variant when both are set and the catalog has a ref', async () => {
      getOpencodeModelRefMock.mockReturnValue({
        providerID: 'openai',
        modelID: 'gpt-5',
      });
      const harness = installFetchHarness();
      const body = await driveRunWith(harness, {
        model: 'gpt-5',
        reasoningEffort: 'medium',
      });
      expect(body['model']).toEqual({ providerID: 'openai', modelID: 'gpt-5' });
      expect(body['variant']).toBe('medium');
    });

    it('omits model only for the Default row, so OpenCode picks its own default', async () => {
      const harness = installFetchHarness();
      const body = await driveRunWith(harness, { model: 'opencode-default' });
      expect(body).not.toHaveProperty('model');
      expect(body).not.toHaveProperty('variant');
      expect(getOpencodeModelRefMock).not.toHaveBeenCalled();
    });

    it('rejects a model that is not in the catalog instead of substituting OpenCode default', async () => {
      getOpencodeModelRefMock.mockReturnValue(null);
      installFetchHarness();
      const { logger } = makeLogger();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: makeOauthClient(),
        logger,
      });

      await expect(
        runner.runPrompt({ session: makeSession(), prompt: 'go', model: 'glm-9' }),
      ).rejects.toThrow('OpenCode model "glm-9" is not in this machine\'s model catalog');
    });
  });

  it('rejects compact() when no live OpenCode session is available', async () => {
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });
    await expect(runner.compact?.()).rejects.toEqual(
      expect.objectContaining({
        name: 'AgentSessionRunnerError',
        code: 'NO_ACTIVE_SESSION',
      }),
    );
  });

  it('attaches heyhey-platform MCP and sends the assembled platform prompt as system on prompt_async', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });
    const firstTurnPrompt = '  do work\npreserve this input exactly  ';

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: firstTurnPrompt,
      startupSegments: {
        stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
        dynamicContext: 'DYNAMIC ENTITY CONTEXT',
        userInput: 'CURRENT USER INPUT',
      },
    });

    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();

    await runPromise;

    const mcpAdds = harness.recorded.filter(
      (r) => r.url.endsWith('/mcp') && r.init?.method === 'POST',
    );
    expect(mcpAdds.length).toBeGreaterThanOrEqual(1);
    const platformAdd = mcpAdds.find((r) =>
      String(r.init?.body ?? '').includes('"name":"heyhey-platform"'),
    );
    expect(platformAdd).toBeDefined();

    // A turn's proposals must not anchor to the placeholder message: the MCP
    // context carries no messageId, so no X-Message-ID header is sent.
    const mcpContext = (buildMcpServerConfigMock.mock.calls[0] as unknown[])[1] as Record<
      string,
      unknown
    >;
    expect(mcpContext).not.toHaveProperty('messageId');

    const promptCall = harness.recorded.find((r) => r.url.includes('/prompt_async'));
    expect(promptCall).toBeDefined();
    const promptBody = JSON.parse(String(promptCall!.init!.body));
    expect(PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE.opencode).toBe('mint-turn-system-field');
    // The `system` field carries the per-session assembled prompt, not the old
    // static constant — assert the registry-derived type-awareness section is
    // present (its definition-independent tag-vocabulary clause).
    expect(promptBody.system).toContain('Platform Primer');
    expect(countOccurrences(promptBody.system as string, '## Platform Primer')).toBe(1);
    expect(countOccurrences(JSON.stringify(promptBody), '## Platform Primer')).toBe(1);
    expect(promptBody.system).toContain('Feature tags as routing/disambiguation');
    expect(promptBody.system).toContain('STABLE ENTITY INSTRUCTIONS');
    expect(promptBody.parts).toEqual([
      {
        type: 'text',
        text: 'DYNAMIC ENTITY CONTEXT\n\nCURRENT USER INPUT',
      },
    ]);
    expect(promptBody.system).not.toContain('OpenCode coding-session execution instruction:');
  });

  it('isolates project reports and exposes schema reading plus canonical report submission', async () => {
    const harness = installFetchHarness();
    const stop = vi.fn(async () => undefined);
    launchOpencodeServerMock.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:7777',
      directory: '/tmp/repo',
      stop,
    });
    submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [
        {
          kind: 'pass_through',
          name: 'create_report',
          description: 'Persist the typed project report.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      ],
      activeToolNames: ['create_report'],
    });
    const { logger } = makeLogger();
    localAgentEndpoint.set('http://127.0.0.1:3847');
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const session = makeSession({ services: [] });
    delete session.launchServiceId;
    const runPromise = runner.runPrompt({
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
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const launchConfig = launchOpencodeServerMock.mock.calls[0]?.[0] as { directory: string };
    expect(launchConfig.directory).toContain('heyhey-provider-isolated-');
    expect(stop).toHaveBeenCalledOnce();
    expect(readSessionStartContextMock).not.toHaveBeenCalled();
    const promptCall = harness.recorded.find((r) => r.url.includes('/prompt_async'));
    expect(promptCall).toBeDefined();
    const promptBody = JSON.parse(String(promptCall!.init!.body)) as Record<string, unknown>;
    expect(JSON.stringify(promptBody['parts'])).not.toContain('Maturity stage');
    expect(promptBody['system']).toBeUndefined();
    expect(promptBody['tools']).toEqual({
      '*': false,
      'heyhey-submission-tools_create_report': true,
      ...PROJECT_REPORT_PLATFORM_TOOLS,
    });
  });

  it('adds task-execution guidance to a fresh OpenCode quick session system prompt', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });
    const firstTurnPrompt = 'You are in a Task Only coding session.\n\n## Task Context';

    const runPromise = runner.runPrompt({
      session: makeSession({ promptType: LocalPromptType.Quick }),
      prompt: firstTurnPrompt,
    });

    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();

    await runPromise;

    const promptCall = harness.recorded.find((r) => r.url.includes('/prompt_async'));
    expect(promptCall).toBeDefined();
    const promptBody = JSON.parse(String(promptCall!.init!.body));
    expect(promptBody.system).toContain('OpenCode coding-session execution instruction:');
    expect(promptBody.system).toContain('Work directly on the task described in the user message.');
    expect(promptBody.system).toContain('Inspect the authorized repository');
    expect(promptBody.system).toContain('Do not repeat or summarize the task context');
    expect(promptBody.parts).toEqual([{ type: 'text', text: `${firstTurnPrompt}` }]);
  });

  it.each(['TAKING_SHAPE', 'ESTABLISHED'] as const)(
    'reads and delivers maturity=%s once on a fresh session',
    async (maturity) => {
      readSessionStartContextMock.mockResolvedValueOnce({
        workItemTypeDefinitions: [],
        intentFirst: false,
        maturity,
      });
      const harness = installFetchHarness();
      const { logger } = makeLogger();
      const oauthClient = makeOauthClient();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient,
        logger,
      });

      const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'do work' });

      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
      });
      harness.sseSink.current!.end();

      await runPromise;

      expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
      expect(readSessionStartContextMock).toHaveBeenCalledWith({
        oauthClient,
        projectId: 'project-1',
      });
      expect(harness.recorded.some((r) => r.url.includes('/prompt_async'))).toBe(true);
      const promptBody = JSON.parse(
        String(harness.recorded.find((r) => r.url.includes('/prompt_async'))?.init?.body),
      );
      expect(JSON.stringify(promptBody.parts)).not.toContain('Maturity stage');
      expect(String(promptBody.system).includes(takingShapeGuidance)).toBe(
        maturity === 'TAKING_SHAPE',
      );
    },
  );

  it('persists resolved worktree state without removing the launch worktree on completion', async () => {
    const harness = installFetchHarness();
    const runStore = makeRunStore();
    resolveRunWorkspaceMock.mockResolvedValueOnce({
      ok: true,
      cwd: '/tmp/repo/.worktrees/test-only',
      repositoryPathForRunStarted: '/tmp/repo/.worktrees/test-only',
      worktree: {
        'svc-1': {
          repoPath: '/tmp/repo',
          worktreePath: '/tmp/repo/.worktrees/test-only',
          branch: 'test-only',
        },
      },
    });
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'do work' });

    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();

    await runPromise;

    expect(runStore.updateRunWorktreeState).toHaveBeenCalledWith('agentic-1', {
      'svc-1': {
        repoPath: '/tmp/repo',
        worktreePath: '/tmp/repo/.worktrees/test-only',
        branch: 'test-only',
      },
    });
    expect(launchOpencodeServerMock).toHaveBeenCalledWith({
      directory: '/tmp/repo/.worktrees/test-only',
    });
    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });

  it('stops the Run-scoped child server when the provider session is discarded', async () => {
    const harness = installFetchHarness();
    const stop = vi.fn(() => Promise.resolve());
    launchOpencodeServerMock.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:7777',
      directory: '/tmp/repo',
      stop,
    });
    const { logger, info } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'do work' });
    await waitFor(() => harness.sseSink.current !== null);
    const sink = harness.sseSink.current;
    if (!sink) throw new Error('Expected OpenCode SSE stream to be connected.');
    sink.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    sink.end();
    await runPromise;

    await runner.discardSession?.();
    await runner.discardSession?.();

    expect(stop).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      'local.runner.opencode.session.discarded',
      expect.objectContaining({ discardedServerBaseUrl: 'http://127.0.0.1:7777' }),
    );
  });

  it('surfaces a child-server stop failure so idle reaping does not evict the Run', async () => {
    const harness = installFetchHarness();
    const failure = new Error('stop failed');
    const stop = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce(undefined);
    launchOpencodeServerMock.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:7777',
      directory: '/tmp/repo',
      stop,
    });
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger: makeLogger().logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'do work' });
    await waitFor(() => harness.sseSink.current !== null);
    const sink = harness.sseSink.current;
    if (!sink) throw new Error('Expected OpenCode SSE stream to be connected.');
    sink.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    sink.end();
    await runPromise;

    await expect(runner.discardSession?.()).rejects.toBe(failure);
    await expect(runner.discardSession?.()).resolves.toBeUndefined();
    expect(stop).toHaveBeenCalledTimes(2);
  });

  it('reflects a registry add+edit in the very next session via the system field, with no builder or runner change', async () => {
    const getDeliveredSystem = (harness: FetchHarness): string => {
      const promptCall = harness.recorded.find((r) => r.url.includes('/prompt_async'));
      expect(promptCall).toBeDefined();
      return JSON.parse(String(promptCall!.init!.body)).system as string;
    };

    const driveFreshRun = async (harness: FetchHarness): Promise<void> => {
      const { logger } = makeLogger();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: makeOauthClient(),
        logger,
      });
      const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'do work' });
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
      });
      harness.sseSink.current!.end();
      await runPromise;
    };

    // First session — the registry read returns the baseline definition set.
    readSessionStartContextMock.mockResolvedValueOnce({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    const firstHarness = installFetchHarness();
    await driveFreshRun(firstHarness);

    const firstSystem = getDeliveredSystem(firstHarness);
    expect(firstSystem).toContain(renderWorkItemTypeOntologyEntry(baselineContract));
    expect(firstSystem).toContain('Legal agreements and SLAs');
    expect(firstSystem).not.toContain('Spike');
    expect(firstSystem).not.toContain('Vendor contracts');

    // The user approves a registry change — CONTRACT's purpose is edited and a
    // SPIKE type is added — then opens the very next session. Nothing in the
    // builder or runner changed between the two runs; only the read differs.
    readSessionStartContextMock.mockResolvedValueOnce({
      workItemTypeDefinitions: EDITED_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    const nextHarness = installFetchHarness();
    await driveFreshRun(nextHarness);

    const nextSystem = getDeliveredSystem(nextHarness);
    expect(nextSystem).toContain(renderWorkItemTypeOntologyEntry(editedContract));
    expect(nextSystem).toContain(renderWorkItemTypeOntologyEntry(addedSpike));
    expect(nextSystem).toContain('Vendor contracts, renewals, and SLAs');
    expect(nextSystem).toContain('A timeboxed investigation');
    // The stale purpose is gone — the delivered ontology tracks the registry,
    // not a value frozen into the code.
    expect(nextSystem).not.toContain('Legal agreements and SLAs');
  });

  it('delivers Intent first guidance in the system field only when the saved choice is on', async () => {
    const deliveredSystem = async (intentFirst: boolean): Promise<string> => {
      readSessionStartContextMock.mockResolvedValueOnce({
        workItemTypeDefinitions: BASELINE_DEFINITIONS,
        intentFirst,
        maturity: 'ESTABLISHED',
      });
      const harness = installFetchHarness();
      const { logger } = makeLogger();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: makeOauthClient(),
        logger,
      });
      const run = runner.runPrompt({ session: makeSession(), prompt: 'first turn' });
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
      });
      harness.sseSink.current!.end();
      await run;
      const promptCall = harness.recorded.find((r) => r.url.includes('/prompt_async'));
      return JSON.parse(String(promptCall!.init!.body)).system as string;
    };

    expect(await deliveredSystem(true)).toContain(intentFirstGuidance);
    expect(await deliveredSystem(false)).not.toContain('## Intent first');
  });

  it('supplies the platform system prompt on the mint turn and omits it on resume turns', async () => {
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    // Turn 1 — fresh session (pending provider id): reads and assembles the
    // run-lived system prompt.
    const turn1 = runner.runPrompt({ session: makeSession(), prompt: 'first turn' });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await turn1;

    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);

    // Turn 2 — resume on the same run: the run-lived system prompt is reused,
    // so the registry is not read again.
    harness.sseSink.current = null;
    const turn2 = runner.runPrompt({
      session: makeSession({ provider_session_id: 'opencode-session-1' }),
      prompt: 'second turn',
    });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await turn2;

    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);

    // Mint turn carries the run-lived system prompt; resume turn omits it so
    // the OpenCode session's persisted system prompt isn't re-supplied.
    const promptCalls = harness.recorded.filter((r) => r.url.includes('/prompt_async'));
    expect(promptCalls).toHaveLength(2);
    const bodies = promptCalls.map(
      (c) => JSON.parse(String(c.init!.body)) as Record<string, unknown>,
    );
    expect(bodies[0]!['system']).toContain(renderWorkItemTypeOntologyEntry(baselineContract));
    expect(bodies[1]).not.toHaveProperty('system');
  });

  it('mounts and refreshes browser tools and preapproves their permission requests', async () => {
    const h = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });
    const mount = { runId: 'run-1', projectId: 'project-1', turnId: 't1', token: 'browser-one' };
    const first = runner.runPrompt({
      session: makeSession(),
      prompt: 'browser',
      browserMcpMount: mount,
    });
    await waitFor(() => h.sseSink.current !== null);
    h.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'browser-permission',
        sessionID: 'opencode-session-1',
        permission: 'mcp__heyhey-browser__navigate',
        patterns: [],
        metadata: {},
      },
    });
    await waitFor(() => h.permissionReplies.some((r) => r.requestId === 'browser-permission'));
    expect(h.permissionReplies.find((r) => r.requestId === 'browser-permission')?.reply).toBe(
      'once',
    );
    h.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    h.sseSink.current!.end();
    await first;
    h.sseSink.current = null;
    const second = runner.resumeSession({
      session: makeSession({ provider_session_id: 'opencode-session-1' }),
      prompt: 'reply',
      browserMcpMount: { ...mount, turnId: 't2', token: 'browser-two' },
    });
    await waitFor(() => h.sseSink.current !== null);
    h.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    h.sseSink.current!.end();
    await second;
    const adds = h.recorded.filter(
      (r) => r.url.endsWith('/mcp') && String(r.init?.body).includes('"name":"heyhey-browser"'),
    );
    expect(adds).toHaveLength(2);
    expect(String(adds[0]!.init!.body)).toContain('/mcp/browser-tools/browser-one');
    expect(String(adds[1]!.init!.body)).toContain('/mcp/browser-tools/browser-two');
  });

  it('refreshes the OpenCode platform MCP server when the scoped proxy mount changes', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    const turn1 = runner.runPrompt({
      session: makeSession(),
      prompt: 'first turn',
      platformMcpProxyMount: {
        runId: 'run-1',
        turnId: 'turn-1',
        token: 'token-1',
        allowedTools: ['mcp__heyhey-platform__unified_search'],
      },
    });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await turn1;

    harness.sseSink.current = null;
    const turn2 = runner.runPrompt({
      session: makeSession({ provider_session_id: 'opencode-session-1' }),
      prompt: 'second turn',
      platformMcpProxyMount: {
        runId: 'run-1',
        turnId: 'turn-2',
        token: 'token-2',
        allowedTools: ['mcp__heyhey-platform__get_context'],
      },
    });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await turn2;

    const platformAdds = harness.recorded.filter(
      (r) =>
        r.url.endsWith('/mcp') &&
        r.init?.method === 'POST' &&
        String(r.init.body ?? '').includes('"name":"heyhey-platform"'),
    );
    expect(platformAdds).toHaveLength(2);
    expect(String(platformAdds[0]!.init!.body)).toContain('/mcp/platform/run-1/turn-1/token-1');
    expect(String(platformAdds[1]!.init!.body)).toContain('/mcp/platform/run-1/turn-2/token-2');
  });

  it('aborts session start when the session-start context read fails', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    readSessionStartContextMock.mockRejectedValueOnce(
      new Error('registry read failed: no organization id in the access token.'),
    );
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    await expect(
      runner.runPrompt({ session: makeSession(), prompt: 'do work' }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
    // No prompt is delivered — the failure is loud, with no stale/empty fallback.
    expect(harness.recorded.some((r) => r.url.includes('/prompt_async'))).toBe(false);
    expect(
      harness.recorded.some((r) => r.url.match(/\/session(\?|$)/) && r.init?.method === 'POST'),
    ).toBe(false);
  });

  it('attaches submission-tools MCP when registry has tools for the run', async () => {
    submissionToolRegistry.register({
      runId: 'agentic-1',
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conv-1',
      externalAgentNodeId: null,
      triggerMessageId: null,
      tools: [
        {
          kind: 'pass_through',
          name: 'submit_plan',
          description: 'submit a plan',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
        },
      ],
    });

    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'submit it' });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const submissionAdd = harness.recorded.find(
      (r) =>
        r.url.endsWith('/mcp') &&
        r.init?.method === 'POST' &&
        String(r.init.body ?? '').includes('"name":"heyhey-submission-tools"'),
    );
    expect(submissionAdd).toBeDefined();
  });

  it('auto-approves a permission for a tool on the alwaysAllowedTools allowlist', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);

    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-allow-1',
        sessionID: 'opencode-session-1',
        permission: 'mcp__heyhey-platform__unified_search',
        patterns: [],
        metadata: {},
      },
    });

    await waitFor(() => harness.permissionReplies.some((r) => r.requestId === 'perm-allow-1'));

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const reply = harness.permissionReplies.find((r) => r.requestId === 'perm-allow-1');
    expect(reply?.reply).toBe('once');
  });

  it('persists tool-rule on whitelist decision and emits permission_decision_submitted + permission_decision_ui', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const events: Array<{ source: string; eventType: string; payload: Record<string, unknown> }> =
      [];
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      agentOutputOwner: createProviderTestAgentOutputOwner((out) => {
        events.push({
          source: out.event.source,
          eventType: out.event.eventType,
          payload: out.event.payload,
        });
      }),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-2',
        sessionID: 'opencode-session-1',
        permission: 'bash',
        patterns: ['ls *'],
        metadata: {},
      },
    });

    // Wait for the runner to register the pending request via permission_request_detected.
    await waitFor(() => events.some((e) => e.eventType === 'permission_request_detected'));

    await runner.submitPermissionDecision!({
      session: makeSession(),
      dispatch: {
        agentType: 'opencode',
        decision: 'whitelist',
        callbackType: 'opencode_permission_response',
        callbackPayload: {
          type: 'permission_response',
          request_id: 'perm-2',
          reply: 'always',
          reason: null,
        },
        routing: {
          runId: 'agentic-1',
          sessionId: 'agentic-1',
          requestId: 'perm-2',
          idempotencyToken: 'idem-1',
        },
      },
    });

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    expect(saveToolRuleMock).toHaveBeenCalledWith('bash');
    const reply = harness.permissionReplies.find((r) => r.requestId === 'perm-2');
    expect(reply?.reply).toBe('always');

    const decisionEvt = events.find((e) => e.eventType === 'permission_decision_submitted');
    expect(decisionEvt).toBeDefined();
    expect(decisionEvt?.payload).toMatchObject({
      decision: 'whitelist',
      request_id: 'perm-2',
    });

    const decisionUiEvt = events.find(
      (e) =>
        e.eventType === 'permission_decision_ui' &&
        (e.payload as Record<string, unknown>)['requestId'] === 'perm-2' &&
        (e.payload as Record<string, unknown>)['decision'] === 'whitelist',
    );
    expect(decisionUiEvt).toBeDefined();
  });

  it('skips re-prompting after a saveToolRule rule is loaded', async () => {
    loadToolRulesMock.mockReturnValue(['custom_tool']);
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-loaded',
        sessionID: 'opencode-session-1',
        permission: 'custom_tool',
        patterns: [],
        metadata: {},
      },
    });
    await waitFor(() => harness.permissionReplies.some((r) => r.requestId === 'perm-loaded'));
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const reply = harness.permissionReplies.find((r) => r.requestId === 'perm-loaded');
    expect(reply?.reply).toBe('once');
  });

  it('records token usage via setRunTokenUsage when message.updated arrives', async () => {
    const harness = installFetchHarness();
    const runStore = makeRunStore();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);

    harness.sseSink.current!.push({
      type: 'message.updated',
      properties: {
        sessionID: 'opencode-session-1',
        info: {
          role: 'assistant',
          tokens: {
            input: 100,
            output: 50,
            reasoning: 0,
            cache: { read: 5, write: 2 },
          },
        },
      },
    });

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    expect(runStore.setRunTokenUsage).toHaveBeenCalledWith(
      'agentic-1',
      expect.objectContaining({
        inputTokens: 100,
        outputTokens: 50,
        cacheReadInputTokens: 5,
        cacheCreationInputTokens: 2,
      }),
    );
  });

  it('reports the latest assistant prompt usage for an active session', async () => {
    const harness = installFetchHarness();
    const runStore = makeRunStore();
    const setRunTokenUsage = vi.spyOn(runStore, 'setRunTokenUsage');
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession({ model: 'glm-5.2' }),
      prompt: 'go',
    });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'message.updated',
      properties: {
        sessionID: 'opencode-session-1',
        info: {
          role: 'assistant',
          providerID: 'opencode-go',
          modelID: 'glm-5.2',
          tokens: {
            input: 100,
            output: 20,
            reasoning: 0,
            cache: { read: 80, write: 7 },
          },
        },
      },
    });
    await waitFor(() => setRunTokenUsage.mock.calls.length === 1);
    harness.sseSink.current!.push({
      type: 'message.updated',
      properties: {
        sessionID: 'opencode-session-1',
        info: {
          role: 'assistant',
          providerID: 'opencode-go',
          modelID: 'glm-5.2',
          tokens: {
            input: 250,
            output: 40,
            reasoning: 3,
            cache: { read: 120, write: 9 },
          },
        },
      },
    });
    await waitFor(() => setRunTokenUsage.mock.calls.length === 2);

    await expect(runner.getContextUsage()).resolves.toEqual({
      categories: [],
      totalTokens: 250,
      maxTokens: 1_000,
      rawMaxTokens: 1_000,
      percentage: 25,
      gridRows: [],
      model: 'glm-5.2',
      memoryFiles: [],
      mcpTools: [],
      agents: [],
      isAutoCompactEnabled: false,
      apiUsage: {
        input_tokens: 250,
        output_tokens: 40,
        cache_creation_input_tokens: 9,
        cache_read_input_tokens: 120,
      },
    });

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;
  });

  it('compacts the active session with its selected provider model', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession({ model: 'glm-5.2' }),
      prompt: 'go',
    });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'message.updated',
      properties: {
        sessionID: 'opencode-session-1',
        info: {
          role: 'assistant',
          providerID: 'opencode-go',
          modelID: 'glm-5.2',
          tokens: {
            input: 250,
            output: 40,
            reasoning: 0,
            cache: { read: 20, write: 5 },
          },
        },
      },
    });
    await waitFor(() => harness.recorded.some((entry) => entry.url.includes('/prompt_async')));
    await runner.compact();

    const summarizeCall = harness.recorded.find((entry) => entry.url.includes('/summarize'));
    expect(summarizeCall).toBeDefined();
    expect(JSON.parse(String(summarizeCall!.init?.body))).toEqual({
      providerID: 'opencode-go',
      modelID: 'glm-5.2',
    });
    expect(harness.recorded.filter((entry) => entry.url.includes('/session?'))).toHaveLength(1);

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;
  });

  it('surfaces OpenCode provider API failures from context reads', async () => {
    const harness = installFetchHarness({ providerStatus: 503 });
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession({ model: 'glm-5.2' }),
      prompt: 'go',
    });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'message.updated',
      properties: {
        sessionID: 'opencode-session-1',
        info: {
          role: 'assistant',
          providerID: 'opencode-go',
          modelID: 'glm-5.2',
          tokens: {
            input: 250,
            output: 40,
            reasoning: 0,
            cache: { read: 20, write: 5 },
          },
        },
      },
    });
    await waitFor(() => harness.recorded.some((entry) => entry.url.includes('/prompt_async')));

    await expect(runner.getContextUsage()).rejects.toMatchObject({
      name: 'AgentSessionRunnerError',
      code: 'RUN_FAILED',
    });

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;
  });

  it('reads context usage from an idle persisted session without prompting or reminting', async () => {
    const harness = installFetchHarness();
    const stop = vi.fn(async () => undefined);
    launchOpencodeServerMock.mockResolvedValueOnce({
      baseUrl: 'http://127.0.0.1:7777',
      directory: '/tmp/repo',
      stop,
    });
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    await expect(
      runner.getContextUsageByResume?.({
        session: makeSession({
          provider_session_id: 'opencode-session-1',
          model: 'glm-5.2',
        }),
      }),
    ).resolves.toMatchObject({
      totalTokens: 250,
      maxTokens: 1_000,
      percentage: 25,
      model: 'glm-5.2',
    });
    expect(harness.recorded.some((entry) => entry.url.includes('/message?limit=100'))).toBe(true);
    expect(harness.recorded.some((entry) => entry.url.includes('/prompt_async'))).toBe(false);
    expect(harness.recorded.filter((entry) => entry.url.includes('/session?'))).toHaveLength(0);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('rejects events from another OpenCode session and closes the Turn-owned subscription', async () => {
    const harness = installFetchHarness();
    const { logger, warn, debug } = makeLogger();
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      agentOutputOwner: createProviderTestAgentOutputOwner((out) =>
        events.push({ eventType: out.event.eventType, payload: out.event.payload }),
      ),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'message.part.updated',
      properties: {
        sessionID: 'other-session',
        part: {
          type: 'tool',
          callID: 'wrong-call',
          tool: 'write',
          state: { status: 'completed', input: { file_path: 'wrong.ts' }, output: 'ok' },
        },
      },
    });
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    expect(
      events.some((event) => {
        const blocks = event.payload['all_tool_use_blocks'];
        return (
          Array.isArray(blocks) &&
          blocks.some((block) => JSON.stringify(block).includes('wrong-call'))
        );
      }),
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'local.runner.opencode.event.rejected_wrong_session',
      expect.objectContaining({ receivedProviderSessionId: 'other-session' }),
    );
    expect(debug).toHaveBeenCalledWith(
      'local.runner.opencode.event_subscription.closed',
      expect.objectContaining({ providerSessionId: 'opencode-session-1' }),
    );
  });

  it('logs tool result errors at error level', async () => {
    const harness = installFetchHarness();
    const { logger, error } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);

    harness.sseSink.current!.push({
      type: 'message.part.updated',
      properties: {
        sessionID: 'opencode-session-1',
        part: {
          type: 'tool',
          callID: 'call-1',
          tool: 'edit',
          sessionID: 'opencode-session-1',
          state: {
            status: 'error',
            input: { file: 'a.ts' },
            error: 'permission denied',
            time: { start: 1, end: 2 },
          },
        },
      },
    });

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const errorCall = error.mock.calls.find(
      (call) => call[0] === 'local.runner.opencode.tool_result.error',
    );
    expect(errorCall).toBeDefined();
    expect(errorCall![1]).toMatchObject({ toolName: 'edit', errorText: 'permission denied' });
  });

  it('resolves two parallel bash permission decisions independently by requestId', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      agentOutputOwner: createProviderTestAgentOutputOwner((out) =>
        events.push({ eventType: out.event.eventType, payload: out.event.payload }),
      ),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);

    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-bash-A',
        sessionID: 'opencode-session-1',
        permission: 'bash',
        patterns: ['ls *'],
        metadata: {},
      },
    });
    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-bash-B',
        sessionID: 'opencode-session-1',
        permission: 'bash',
        patterns: ['cat *'],
        metadata: {},
      },
    });

    await waitFor(
      () => events.filter((e) => e.eventType === 'permission_request_detected').length >= 2,
    );

    await runner.submitPermissionDecision!({
      session: makeSession(),
      dispatch: {
        agentType: 'opencode',
        decision: 'approve',
        callbackType: 'opencode_permission_response',
        callbackPayload: {
          type: 'permission_response',
          request_id: 'perm-bash-A',
          reply: 'once',
          reason: null,
        },
        routing: {
          runId: 'agentic-1',
          sessionId: 'agentic-1',
          requestId: 'perm-bash-A',
          idempotencyToken: 'idem-A',
        },
      },
    });

    await runner.submitPermissionDecision!({
      session: makeSession(),
      dispatch: {
        agentType: 'opencode',
        decision: 'deny',
        callbackType: 'opencode_permission_response',
        callbackPayload: {
          type: 'permission_response',
          request_id: 'perm-bash-B',
          reply: 'reject',
          reason: null,
        },
        routing: {
          runId: 'agentic-1',
          sessionId: 'agentic-1',
          requestId: 'perm-bash-B',
          idempotencyToken: 'idem-B',
        },
      },
    });

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const replyA = harness.permissionReplies.find((r) => r.requestId === 'perm-bash-A');
    const replyB = harness.permissionReplies.find((r) => r.requestId === 'perm-bash-B');
    expect(replyA?.reply).toBe('once');
    expect(replyB?.reply).toBe('reject');
    expect(harness.permissionReplies.filter((r) => r.requestId === 'perm-bash-A')).toHaveLength(1);
    expect(harness.permissionReplies.filter((r) => r.requestId === 'perm-bash-B')).toHaveLength(1);
  });

  it('auto-approves sibling pending requests when one is promoted to always-allowed', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const events: Array<{ eventType: string; payload: Record<string, unknown> }> = [];
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      agentOutputOwner: createProviderTestAgentOutputOwner((out) =>
        events.push({ eventType: out.event.eventType, payload: out.event.payload }),
      ),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'go' });
    await waitFor(() => harness.sseSink.current !== null);

    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-bash-A',
        sessionID: 'opencode-session-1',
        permission: 'bash',
        patterns: ['ls *'],
        metadata: {},
      },
    });
    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-bash-B',
        sessionID: 'opencode-session-1',
        permission: 'bash',
        patterns: ['cat *'],
        metadata: {},
      },
    });
    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-edit-C',
        sessionID: 'opencode-session-1',
        permission: 'edit',
        patterns: [],
        metadata: {},
      },
    });

    await waitFor(
      () => events.filter((e) => e.eventType === 'permission_request_detected').length >= 3,
    );

    await runner.submitPermissionDecision!({
      session: makeSession(),
      dispatch: {
        agentType: 'opencode',
        decision: 'always_approve',
        callbackType: 'opencode_permission_response',
        callbackPayload: {
          type: 'permission_response',
          request_id: 'perm-bash-A',
          reply: 'always',
          reason: null,
        },
        routing: {
          runId: 'agentic-1',
          sessionId: 'agentic-1',
          requestId: 'perm-bash-A',
          idempotencyToken: 'idem-A',
        },
      },
    });

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const replyA = harness.permissionReplies.find((r) => r.requestId === 'perm-bash-A');
    const replyB = harness.permissionReplies.find((r) => r.requestId === 'perm-bash-B');
    const replyC = harness.permissionReplies.find((r) => r.requestId === 'perm-edit-C');
    expect(replyA?.reply).toBe('always');
    expect(replyB?.reply).toBe('once');
    expect(replyC).toBeUndefined();
  });

  it('rethrows when /session/{id} returns 500 during resume verification', async () => {
    const sseSink: { current: SseSink | null } = { current: null };
    const sessionPosts: Array<{ url: string }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes('/health')) return buildJsonResponse({ healthy: true });
      if (url.includes('/mcp') && init?.method === 'POST') return buildJsonResponse({});
      if (
        url.match(/\/session\/[^/?]+\?/) &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        return buildJsonResponse({ error: 'boom' }, 500);
      }
      if (url.match(/\/session(\?|$)/) && init?.method === 'POST') {
        sessionPosts.push({ url });
        return buildJsonResponse({ id: 'should-not-be-used' });
      }
      if (url.includes('/event')) {
        return new Response(makeSseStream(sseSink), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return buildJsonResponse({});
    }) as unknown as typeof fetch;

    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    await expect(
      runner.runPrompt({
        session: makeSession({ provider_session_id: 'existing-session-1' }),
        prompt: 'go',
      }),
    ).rejects.toThrow(/resume verification failed/);
    expect(sessionPosts).toHaveLength(0);
  });

  it('falls through to /session POST when /session/{id} returns 404', async () => {
    const sseSink: { current: SseSink | null } = { current: null };
    const sessionPosts: Array<{ url: string }> = [];
    const promptBodies: Array<Record<string, unknown>> = [];
    const runStore = makeRunStore();
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes('/health')) return buildJsonResponse({ healthy: true });
      if (url.includes('/mcp') && init?.method === 'POST') return buildJsonResponse({});
      if (
        url.match(/\/session\/[^/?]+\?/) &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        return buildJsonResponse({ error: 'gone' }, 404);
      }
      if (url.match(/\/session(\?|$)/) && init?.method === 'POST') {
        sessionPosts.push({ url });
        return buildJsonResponse({ id: 'recreated-session-1' });
      }
      if (url.match(/\/session\/[^/?]+\/prompt_async/) && init?.method === 'POST') {
        promptBodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }
      if (url.includes('/event')) {
        return new Response(makeSseStream(sseSink), {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }
      return buildJsonResponse({});
    }) as unknown as typeof fetch;

    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession({ provider_session_id: 'gone-session-1' }),
      prompt: 'go',
    });
    await waitFor(() => sseSink.current !== null);
    sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'recreated-session-1', status: { type: 'idle' } },
    });
    sseSink.current!.end();
    await runPromise;

    expect(sessionPosts).toHaveLength(1);
    expect(promptBodies).toHaveLength(1);
    expect(promptBodies[0]!['system']).toContain('## Platform Primer');
    expect(promptBodies[0]!['parts']).toEqual([{ type: 'text', text: `go` }]);
    expect(runStore.updateRunProviderIdentity).toHaveBeenCalledWith(
      'agentic-1',
      expect.objectContaining({ providerSessionId: 'recreated-session-1' }),
    );
  });

  it('does not recreate a missing resumed session when session-start context fails', async () => {
    const sessionPosts: Array<{ url: string }> = [];
    const promptPosts: Array<{ url: string }> = [];
    readSessionStartContextMock.mockRejectedValueOnce(
      new Error('registry read failed before recreated session'),
    );
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request).url;
      if (url.includes('/health')) return buildJsonResponse({ healthy: true });
      if (url.includes('/mcp') && init?.method === 'POST') return buildJsonResponse({});
      if (
        url.match(/\/session\/[^/?]+\?/) &&
        (!init || init.method === undefined || init.method === 'GET')
      ) {
        return buildJsonResponse({ error: 'gone' }, 404);
      }
      if (url.match(/\/session(\?|$)/) && init?.method === 'POST') {
        sessionPosts.push({ url });
        return buildJsonResponse({ id: 'should-not-be-created' });
      }
      if (url.match(/\/session\/[^/?]+\/prompt_async/) && init?.method === 'POST') {
        promptPosts.push({ url });
        return new Response(null, { status: 204 });
      }
      return buildJsonResponse({});
    }) as unknown as typeof fetch;

    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    await expect(
      runner.runPrompt({
        session: makeSession({ provider_session_id: 'gone-session-1' }),
        prompt: 'go',
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
    expect(sessionPosts).toHaveLength(0);
    expect(promptPosts).toHaveLength(0);
  });

  it('skipPermissions auto-approves any permission request', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'go',
      skipPermissions: true,
    });
    await waitFor(() => harness.sseSink.current !== null);
    harness.sseSink.current!.push({
      type: 'permission.asked',
      properties: {
        id: 'perm-skip',
        sessionID: 'opencode-session-1',
        permission: 'bash',
        patterns: [],
        metadata: {},
      },
    });
    await waitFor(() => harness.permissionReplies.some((r) => r.requestId === 'perm-skip'));
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();
    await runPromise;

    const reply = harness.permissionReplies.find((r) => r.requestId === 'perm-skip');
    expect(reply?.reply).toBe('once');
  });

  it.each([
    ['skipPermissions', true, []],
    ['stored external-directory rule', false, ['external_directory']],
  ])(
    'rejects external-directory escapes before %s approval',
    async (_approvalMode, skipPermissions, storedRules) => {
      const base = mkdtempSync(join(tmpdir(), 'opencode-containment-'));
      const allowedRoot = join(base, 'worktree');
      const outsideRoot = join(base, 'ordinary-checkout');
      mkdirSync(allowedRoot);
      mkdirSync(outsideRoot);
      symlinkSync(outsideRoot, join(allowedRoot, 'escape'));
      const workspace: ResolvedRunWorkspace = {
        ok: true,
        runMode: 'default',
        repositoryPathForRunStarted: allowedRoot,
        cwd: allowedRoot,
        allowedRepositoryRoots: [allowedRoot],
        bindingRepositoryPath: allowedRoot,
        workspaceRoot: null,
      };
      const workspaceWriteBoundary = await RunWorkspaceWriteBoundary.create(workspace);
      loadToolRulesMock.mockReturnValue(storedRules);
      const harness = installFetchHarness();
      const { logger } = makeLogger();
      const runner = new OpenCodeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: makeOauthClient(),
        logger,
      });

      const runPromise = runner.runPrompt({
        session: makeSession(),
        prompt: 'go',
        skipPermissions,
        workspace,
        workspaceWriteBoundary,
      });
      await waitFor(() => harness.sseSink.current !== null);
      harness.sseSink.current!.push({
        type: 'permission.asked',
        properties: {
          id: 'outside',
          sessionID: 'opencode-session-1',
          permission: 'external_directory',
          patterns: [join(outsideRoot, '**')],
          metadata: {},
        },
      });
      harness.sseSink.current!.push({
        type: 'permission.asked',
        properties: {
          id: 'symlink',
          sessionID: 'opencode-session-1',
          permission: 'external_directory',
          patterns: [join(allowedRoot, 'escape', '**')],
          metadata: {},
        },
      });
      harness.sseSink.current!.push({
        type: 'permission.asked',
        properties: {
          id: 'inside',
          sessionID: 'opencode-session-1',
          permission: 'external_directory',
          patterns: [join(allowedRoot, 'src', '**')],
          metadata: {},
        },
      });
      await waitFor(() => harness.permissionReplies.length === 3);
      expect(harness.permissionReplies).toEqual(
        expect.arrayContaining([
          { requestId: 'outside', reply: 'reject' },
          { requestId: 'symlink', reply: 'reject' },
          { requestId: 'inside', reply: 'once' },
        ]),
      );
      await expect(
        runner.submitPermissionDecision?.({
          session: makeSession(),
          dispatch: translatePermissionDecisionToDispatch({
            runId: 'agentic-1',
            sessionId: 'opencode-session-1',
            requestId: 'outside',
            agentType: 'opencode',
            decision: 'approve',
            reason: null,
            idempotencyToken: 'outside',
            deciderUserId: 'user-1',
          }),
        }),
      ).resolves.toEqual({ delivered: false, outcome: 'stale', reason: 'request_not_found' });
      expect(launchOpencodeServerMock).toHaveBeenCalledWith(
        expect.objectContaining({
          directory: allowedRoot,
          containment: expect.objectContaining({ command: process.execPath }),
        }),
      );

      harness.sseSink.current!.push({
        type: 'session.status',
        properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
      });
      harness.sseSink.current!.end();
      await runPromise;
      await workspaceWriteBoundary.dispose();
      rmSync(base, { recursive: true, force: true });
    },
  );

  it('emits processing_status phase transitions starting → thinking → writing → thinking as SSE events arrive', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const onAgentOutput = vi.fn();

    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'do work' });

    await waitFor(() => harness.sseSink.current !== null);

    // Tool part (no assistantText) → first event → thinking
    harness.sseSink.current!.push({
      type: 'message.part.updated',
      properties: {
        sessionID: 'opencode-session-1',
        part: { type: 'tool', tool: 'Bash', callID: 'c1', state: { status: 'pending', input: {} } },
      },
    });
    // Text part (assistantText set) → writing
    harness.sseSink.current!.push({
      type: 'message.part.updated',
      properties: { sessionID: 'opencode-session-1', part: { type: 'text', text: 'Hello world' } },
    });
    // Tool part again → back to thinking
    harness.sseSink.current!.push({
      type: 'message.part.updated',
      properties: {
        sessionID: 'opencode-session-1',
        part: { type: 'tool', tool: 'Bash', callID: 'c2', state: { status: 'pending', input: {} } },
      },
    });
    // Terminal
    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();

    await runPromise;

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((p): p is string => typeof p === 'string');

    // Deduplicate consecutive identical phases from repeated provider events.
    const deduped = phases.filter((p, i, arr) => i === 0 || p !== arr[i - 1]);
    expect(deduped).toEqual(['starting', 'thinking', 'writing', 'thinking']);
  });

  it('emits thinking when the first provider event is terminal', async () => {
    const harness = installFetchHarness();
    const { logger } = makeLogger();
    const onAgentOutput = vi.fn();

    const runner = new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      logger,
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'do work' });

    await waitFor(() => harness.sseSink.current !== null);

    harness.sseSink.current!.push({
      type: 'session.status',
      properties: { sessionID: 'opencode-session-1', status: { type: 'idle' } },
    });
    harness.sseSink.current!.end();

    await runPromise;

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((p): p is string => typeof p === 'string');

    expect(phases).toEqual(['starting', 'thinking']);
  });
});

describe('OpenCodeAgentSessionRunner.promptOnce', () => {
  const makeRunner = (runStore: RunStore = makeRunStore()) =>
    new OpenCodeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      oauthClient: makeOauthClient(),
    });

  const installPromptFetch = (reply: () => Response | Promise<Response>) => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      if (init?.method === 'POST' && url.match(/\/session\?/)) {
        return buildJsonResponse({ id: 'once-session' });
      }
      if (init?.method === 'POST' && url.includes('/session/once-session/message')) {
        return reply();
      }
      return buildJsonResponse(true);
    }) as unknown as typeof fetch;
    return calls;
  };

  const stop = vi.fn(async () => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    getOpencodeModelRefMock.mockImplementation((model) => ({
      providerID: 'opencode-go',
      modelID: model,
    }));
    launchOpencodeServerMock.mockResolvedValue({
      baseUrl: 'http://127.0.0.1:7777',
      directory: '/tmp/isolated',
      stop,
    });
  });

  it('returns the reply text from a tool-free session on its own server', async () => {
    const calls = installPromptFetch(() =>
      buildJsonResponse({
        info: { role: 'assistant' },
        parts: [
          { type: 'reasoning', sessionID: 's', text: 'thinking' },
          { type: 'text', sessionID: 's', text: 'search for jev' },
        ],
      }),
    );
    const runStore = makeRunStore();
    const { signal } = new AbortController();

    const answer = await makeRunner(runStore).promptOnce({
      session: makeSession(),
      prompt: 'plan searches',
      model: 'glm-5.2',
      reasoningEffort: 'high',
      signal,
    });

    expect(answer).toBe('search for jev');
    const launch = launchOpencodeServerMock.mock.calls[0]?.[0] as { directory: string };
    expect(launch.directory).toContain('heyhey-provider-isolated-');
    const prompt = calls.find((call) => call.url.includes('/session/once-session/message'));
    expect(JSON.parse(String(prompt?.init?.body))).toEqual({
      parts: [{ type: 'text', text: 'plan searches' }],
      model: { providerID: 'opencode-go', modelID: 'glm-5.2' },
      variant: 'high',
      tools: { '*': false },
    });
    expect(calls.some((call) => call.url.includes('/mcp'))).toBe(false);
    expect(
      calls.some((call) => call.init?.method === 'DELETE' && call.url.includes('/once-session')),
    ).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
    expect(runStore.appendEvent).not.toHaveBeenCalled();
  });

  it('throws the provider error reported on the reply', async () => {
    installPromptFetch(() =>
      buildJsonResponse({
        info: { role: 'assistant', error: { name: 'APIError', data: { message: 'rate limited' } } },
        parts: [],
      }),
    );

    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED', message: 'rate limited' });
    expect(stop).toHaveBeenCalledOnce();
  });

  it('throws when the reply has no text', async () => {
    installPromptFetch(() => buildJsonResponse({ info: { role: 'assistant' }, parts: [] }));

    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
  });

  it('surfaces an aborted call and still stops its server', async () => {
    installPromptFetch(() => {
      throw new DOMException('Aborted', 'AbortError');
    });

    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(stop).toHaveBeenCalledOnce();
  });
});

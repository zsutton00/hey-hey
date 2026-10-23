import { RunAttachmentContentReader } from '../run-attachment-content-reader';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionRecorder } from '../execution-recorder/execution-recorder';
import { ExecutionCaptureSession } from '../execution-recorder/capture-session';
import { NOOP_LOGGER } from '../../../server/logger';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkStatus } from '../../../shared/api/generated/api';
import type { ProjectMaturity, WorkItemTypeDefinitionDto } from '../../../shared/api/index';
import { intentFirstGuidance, takingShapeGuidance } from '../../prompts/common';
import { renderWorkItemTypeOntologyEntry } from '../../prompts/render-type-ontology';
import type { RepoMappingStore } from '../../../repo/index';
import type { RunStore } from '../../../run-store/run-store';
import type { AgentOutputHandler } from '../../agent-event-stream';
import type { ServerLogger } from '../../../server/logger';
import type { AgenticSession } from '../../../session/index';
import { translatePermissionDecisionToDispatch } from '../../permission-response-routing';
import {
  ClaudeAgentSessionRunner,
  resolveClaudeRepositoryResearchTools,
} from './session-runner-claude';
import { CODING_MCP_TOOLS } from '../../mcp-server-config';
import { PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE } from '../platform-prompt-delivery';
import { LocalAgentEndpoint } from '../../../server/local-base-url';
import { ToolRuleStore } from '../../../session/tool-rules';
import { SubmissionToolRegistry } from '../../submission-tools/registry';
import {
  createProviderTestAgentOutputOwner,
  createProviderTestRepoMappingStore,
  createProviderTestRunStore,
} from '../provider-owner.test-support';
import { createTestOAuthClient as createProviderTestOAuthClient } from '../../../auth/oauth-client.test-support';
import { RunWorkspaceWriteBoundary } from '../../workspace-write-boundary';
import type { ResolvedRunWorkspace } from '../../run-scope';
import * as userMcpConfig from './user-mcp-config';

const loadUserMcpConfigMock = vi.spyOn(userMcpConfig, 'loadClaudeUserMcpConfig');

const localAgentEndpoint = new LocalAgentEndpoint();
const submissionToolRegistry = new SubmissionToolRegistry();
const toolRuleStoreDirectory = mkdtempSync(join(tmpdir(), 'hey-hey-claude-tool-rules-'));
const toolRuleStore = new ToolRuleStore(join(toolRuleStoreDirectory, 'tool-rules.json'));
const loadToolRulesMock = vi.spyOn(toolRuleStore, 'load').mockReturnValue([]);
vi.spyOn(toolRuleStore, 'save').mockImplementation(() => undefined);

afterAll(() => {
  rmSync(toolRuleStoreDirectory, { recursive: true, force: true });
});

describe('Claude repository research tools', () => {
  it('exposes read/search plus native delegation when allowed', () => {
    expect(resolveClaudeRepositoryResearchTools('allowed')).toEqual([
      'Read',
      'Glob',
      'Grep',
      'Agent',
    ]);
  });

  it('removes delegation without opening a write or shell tool', () => {
    expect(resolveClaudeRepositoryResearchTools('disabled')).toEqual(['Read', 'Glob', 'Grep']);
  });
});

const CLAUDE_TURN_SUCCESS = {
  ok: true,
  subtype: 'success',
  numTurns: 1,
  sessionId: null,
} as const;
const startSessionMock = vi.fn();
const continueSessionMock = vi.fn();
const getSessionIdMock = vi.fn();
const getContextUsageMock = vi.fn();
const getUsageMock = vi.fn();
const compactMock = vi.fn();
const disconnectMock = vi.fn();
const onPermissionRequestMock = vi.fn();
const connectForControlMock = vi.fn();
let permissionRequestHandler:
  | ((toolName: string, input: unknown) => Promise<Record<string, unknown>>)
  | null = null;
let eventHandler: ((event: Record<string, unknown>) => void) | null = null;

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
// point with each in turn and assert the delivered prompt tracks whichever the
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

const buildMcpServerConfigMock = vi.fn();
vi.mock('../../mcp-server-config.js', async () => {
  const actual = await vi.importActual<typeof import('../../mcp-server-config')>(
    '../../mcp-server-config.js',
  );
  return {
    ...actual,
    buildMcpServerConfig: (...args: unknown[]) => buildMcpServerConfigMock(...args),
  };
});

vi.mock('@hey-hey/ui-common/agents', async () => {
  const actual = await vi.importActual<typeof import('@hey-hey/ui-common/agents')>(
    '@hey-hey/ui-common/agents',
  );
  return {
    ...actual,
    ClaudeCodeSdkClient: class {
      startSession(...args: Parameters<typeof startSessionMock>) {
        return startSessionMock(...args);
      }

      continueSession(...args: Parameters<typeof continueSessionMock>) {
        return continueSessionMock(...args);
      }

      getSessionId(...args: Parameters<typeof getSessionIdMock>) {
        return getSessionIdMock(...args);
      }

      getContextUsage(...args: Parameters<typeof getContextUsageMock>) {
        return getContextUsageMock(...args);
      }

      getUsage(...args: Parameters<typeof getUsageMock>) {
        return getUsageMock(...args);
      }

      connectForControl(...args: Parameters<typeof connectForControlMock>) {
        return connectForControlMock(...args);
      }

      compact(...args: Parameters<typeof compactMock>) {
        return compactMock(...args);
      }

      async disconnect() {
        disconnectMock();
        getSessionIdMock.mockReturnValue(null);
      }

      onPermissionRequest(...args: Parameters<typeof onPermissionRequestMock>) {
        onPermissionRequestMock(...args);
        permissionRequestHandler = args[0] as (
          toolName: string,
          input: unknown,
        ) => Promise<Record<string, unknown>>;
      }

      onEvent(handler: ((event: Record<string, unknown>) => void) | null) {
        eventHandler = handler;
      }
    },
  };
});

const emitClaudeEvent = (event: Record<string, unknown>): void => {
  eventHandler?.(event);
};

const waitForEventHandler = async (): Promise<void> => {
  await vi.waitFor(() => {
    expect(eventHandler).not.toBeNull();
  });
};

const waitForPermissionHandler = async (): Promise<void> => {
  await vi.waitFor(() => {
    expect(permissionRequestHandler).not.toBeNull();
  });
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
    provider: 'claude',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    status: 'idle',
    contextMetadata: createContextMetadata(),
    createdAt: '2026-02-20T00:00:00.000Z',
    updatedAt: '2026-02-20T00:00:00.000Z',
    conversationId: 'conv-1',
    events: [],
  };

  return {
    ...base,
    ...overrides,
    contextMetadata: (overrides.contextMetadata ??
      base.contextMetadata) as AgenticSession['contextMetadata'],
    events: overrides.events ?? base.events,
  } as AgenticSession;
};

const makeRunStore = (): RunStore => createProviderTestRunStore(makeSession);

const makeRepoStore = (): RepoMappingStore => createProviderTestRepoMappingStore();

const makeLogger = (): {
  logger: ServerLogger;
  trace: ReturnType<typeof vi.fn>;
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
  return { logger, trace, debug, info, warn, error };
};

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

const countOccurrences = (value: string, needle: string): number => value.split(needle).length - 1;

describe('session-runner-claude', () => {
  it('passes capture transport to launch and closes its channel on disposal', async () => {
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
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        agentOutputOwner: owner,
        executionRecorder: new ExecutionRecorder(
          join(tmpdir(), 'unused-capture-fixture'),
          NOOP_LOGGER,
        ),
      });
      const result = runner.runPrompt({ session: makeSession(), prompt: 'Capture this edit.' });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await result;
      expect(startSessionMock.mock.calls[0]?.[0]).toMatchObject({ toolExecutionHooks: launch });
      expect(open).toHaveBeenCalledWith(
        owner,
        expect.objectContaining({ allowedRepositoryRoots: expect.any(Array) }),
      );
      await runner.dispose();
      expect(close).toHaveBeenCalled();
    } finally {
      open.mockRestore();
      close.mockRestore();
    }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    loadUserMcpConfigMock.mockResolvedValue({ mcpServers: {}, serverNames: [], allowedTools: [] });
    eventHandler = null;
    permissionRequestHandler = null;
    startSessionMock.mockResolvedValue(CLAUDE_TURN_SUCCESS);
    continueSessionMock.mockResolvedValue(CLAUDE_TURN_SUCCESS);
    getSessionIdMock.mockReturnValue(null);
    getContextUsageMock.mockReset();
    compactMock.mockReset();
    disconnectMock.mockReset();
    buildMcpServerConfigMock.mockReset();
    localAgentEndpoint.set('http://127.0.0.1:9999');
    submissionToolRegistry.clearAll();
    loadToolRulesMock.mockReturnValue([]);
  });

  it.each(['fresh', 'warm', 'cold'] as const)(
    'forwards attachment content on %s execution and excludes input echoes from history',
    async (mode) => {
      const references = [{ attachmentId: 'stored-reference', fileName: 'notes.md' }];
      const content = [
        { kind: 'text' as const, fileName: 'notes.md', text: 'private attachment contents' },
      ];
      const read = vi
        .spyOn(RunAttachmentContentReader.prototype, 'read')
        .mockResolvedValue(content);
      if (mode === 'warm') getSessionIdMock.mockReturnValue('provider-session-1');
      const runStore = makeRunStore();
      const { logger, debug } = makeLogger();
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore,
        repoStore: makeRepoStore(),
        logger,
      });
      const session = makeSession(
        mode === 'fresh' ? {} : { provider_session_id: 'provider-session-1' },
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
        await waitForEventHandler();
        await vi.waitFor(() => expect(read).toHaveBeenCalledWith('owning-run', references, logger));
        emitClaudeEvent({
          type: 'user',
          message: { content: [{ type: 'text', text: 'private attachment contents' }] },
        });
        emitClaudeEvent({ type: 'result', session_id: 'provider-session-1' });
        await promise;
        if (mode === 'warm')
          expect(continueSessionMock).toHaveBeenCalledWith('  Read this.\n', {
            attachments: content,
          });
        else
          expect(startSessionMock).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: '  Read this.\n', attachments: content }),
            undefined,
          );
        expect(JSON.stringify(vi.mocked(runStore.appendEvent).mock.calls)).not.toContain(
          'private attachment contents',
        );
        expect(JSON.stringify(debug.mock.calls)).not.toContain('private attachment contents');
      } finally {
        read.mockRestore();
      }
    },
  );

  const usageData = {
    subscription_type: 'max',
    rate_limits_available: true,
    rate_limits: { five_hour: { utilization: 23, resets_at: '2026-10-14T03:00:00Z' } },
  };

  it('reads plan usage from a short-lived control client when no session is live', async () => {
    getUsageMock.mockResolvedValue(usageData);
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    const { signal } = new AbortController();

    await expect(runner.getProviderUsage(signal)).resolves.toEqual(usageData);

    expect(connectForControlMock).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: '', permissionMode: 'default' }),
      { signal },
    );
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects the short-lived control client when the usage request fails', async () => {
    getUsageMock.mockRejectedValue(new Error('get_usage is not supported in this context'));
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    await expect(runner.getProviderUsage(new AbortController().signal)).rejects.toThrow(
      'not supported',
    );
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('reads plan usage from the live session without spawning another client', async () => {
    getUsageMock.mockResolvedValue(usageData);
    buildMcpServerConfigMock.mockResolvedValue({ mcpServers: {}, allowedTools: [] });
    let finishTurn: (value: typeof CLAUDE_TURN_SUCCESS) => void = () => {};
    startSessionMock.mockReturnValue(
      new Promise((resolve) => {
        finishTurn = resolve;
      }),
    );
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });
    try {
      const run = runner.runPrompt({ session: makeSession(), prompt: 'Read usage.' });
      await waitForEventHandler();
      await vi.waitFor(() => expect(runner.hasLiveSession()).toBe(true));

      await expect(runner.getProviderUsage(new AbortController().signal)).resolves.toEqual(
        usageData,
      );
      expect(connectForControlMock).not.toHaveBeenCalled();

      emitClaudeEvent({ type: 'result' });
      finishTurn(CLAUDE_TURN_SUCCESS);
      await run;
    } finally {
      await runner.dispose();
    }
  });

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
    getSessionIdMock.mockReturnValue('provider-session-1');
    continueSessionMock.mockRejectedValue(new Error('Aborted'));
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
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
      providerSessionId: 'provider-session-1',
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
      'local.runner.claude.run_prompt.failed',
      expect.anything(),
    );
  });

  it('keeps an SDK abort on a normally canceled Run on the failure path', async () => {
    const controller = new AbortController();
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    startSessionMock.mockImplementation(async () => {
      controller.abort();
      throw new Error('Aborted');
    });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
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
      'local.runner.claude.run_prompt.failed',
      expect.objectContaining({ error: expect.objectContaining({ code: 'RUN_FAILED' }) }),
    );
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
  });

  it('keeps a provider error on the failure path during a Service-scope abort', async () => {
    const controller = new AbortController();
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const agentOutputOwner = createProviderTestAgentOutputOwner(vi.fn());
    vi.spyOn(agentOutputOwner.serviceScope, 'consumeExpectedServiceScopeTurnAbort').mockReturnValue(
      true,
    );
    startSessionMock.mockImplementation(async () => {
      controller.abort();
      throw new Error('Provider transport failed.');
    });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
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
      'local.runner.claude.run_prompt.failed',
      expect.objectContaining({ error: expect.objectContaining({ code: 'RUN_FAILED' }) }),
    );
    expect(
      vi
        .mocked(runStore.appendEvent)
        .mock.calls.filter(([, event]) => event.event_type === 'run_completed'),
    ).toHaveLength(1);
  });

  it('forwards all claude stream events without filtering and preserves payload fields', async () => {
    const runStore = makeRunStore();
    const onAgentOutput = vi.fn();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the implementation.',
    });
    await waitForEventHandler();
    emitClaudeEvent({
      type: 'permission_request',
      session_id: 'provider-session-1',
      agent_id: 'agent-1',
      permission_type: 'workspace_write',
      permission_request: {
        id: 'perm-1',
      },
      metadata: {
        reason: 'Need elevated access',
      },
      timestamp: '2026-02-20T00:00:01.000Z',
    });
    emitClaudeEvent({ type: 'result' });

    await runPromise;
    expect(onAgentOutput.mock.calls).toEqual(
      expect.arrayContaining([
        [
          expect.objectContaining({
            event: expect.objectContaining({
              source: 'provider',
              eventType: 'permission_request_detected',
              sessionId: 'provider-session-1',
              agentId: 'agent-1',
              payload: expect.objectContaining({
                messageType: 'provider_event',
                canonical_event_type: 'permission_request',
                canonical_event: expect.objectContaining({
                  permission_request: expect.objectContaining({
                    id: 'perm-1',
                  }),
                }),
                raw_event: expect.objectContaining({
                  permission_request: expect.objectContaining({
                    id: 'perm-1',
                  }),
                }),
              }),
            }),
          }),
        ],
      ]),
    );
    expect(runStore.appendEvent).toHaveBeenCalledWith(
      'agentic-1',
      expect.objectContaining({
        actor: 'agent',
        event_type: 'agent_output',
        payload: expect.objectContaining({
          messageType: 'provider_event',
          eventType: 'permission_request',
          raw_event: expect.objectContaining({
            permission_type: 'workspace_write',
          }),
        }),
      }),
    );
    expect(getPersistedProviderPayload(runStore, 'permission_request')).toMatchObject({
      canonical_event_type: 'permission_request',
      canonical_event: {
        permission_request: {
          id: 'perm-1',
          permission_type: 'workspace_write',
        },
      },
      raw_event: expect.objectContaining({
        permission_type: 'workspace_write',
      }),
    });
  });

  it('emits processing_status phase transitions starting -> thinking -> writing -> thinking as events arrive', async () => {
    const onAgentOutput = vi.fn();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the implementation.',
    });
    await waitForEventHandler();

    emitClaudeEvent({
      type: 'tool_use',
      session_id: 'provider-session-1',
      timestamp: '2026-02-20T00:00:01.000Z',
    });
    emitClaudeEvent({
      type: 'assistant',
      session_id: 'provider-session-1',
      message: { content: [{ type: 'text', text: 'Hello' }] },
      timestamp: '2026-02-20T00:00:02.000Z',
    });
    emitClaudeEvent({
      type: 'tool_use',
      session_id: 'provider-session-1',
      timestamp: '2026-02-20T00:00:03.000Z',
    });
    emitClaudeEvent({ type: 'result', session_id: 'provider-session-1' });

    await runPromise;

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((phase): phase is string => typeof phase === 'string');

    expect(phases).toEqual(['starting', 'thinking', 'writing', 'thinking']);
  });

  describe('background tasks', () => {
    // Shapes emitted by Claude Code 2.1.287 stream-json for an `Agent` call
    // run in the background.
    const backgroundTaskStarted = {
      type: 'system',
      subtype: 'task_started',
      task_id: 'task-bg-1',
      tool_use_id: 'toolu_agent_1',
      description: 'Map the API side',
      subagent_type: 'general-purpose',
      is_backgrounded: true,
      task_type: 'local_agent',
      session_id: 'provider-session-1',
    };
    const backgroundTasksLive = {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [{ task_id: 'task-bg-1', task_type: 'local_agent', description: 'Map the API side' }],
      session_id: 'provider-session-1',
    };
    const backgroundTasksDrained = {
      type: 'system',
      subtype: 'background_tasks_changed',
      tasks: [],
      session_id: 'provider-session-1',
    };
    const backgroundTaskNotification = {
      type: 'system',
      subtype: 'task_notification',
      task_id: 'task-bg-1',
      tool_use_id: 'toolu_agent_1',
      status: 'completed',
      output_file: '',
      summary: 'API mapped',
      session_id: 'provider-session-1',
    };

    const processingEvents = (onAgentOutput: { mock: { calls: unknown[][] } }) =>
      (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
        .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
        .map(([envelope]) => envelope.event['payload'] as Record<string, unknown>);

    const makeRunner = (onAgentOutput: AgentOutputHandler, runStore: RunStore) =>
      new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore,
        repoStore: makeRepoStore(),
        agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      });

    it('holds the turn open past a result while a background task is live', async () => {
      const onAgentOutput = vi.fn();
      const runStore = makeRunStore();
      const runner = makeRunner(onAgentOutput, runStore);
      let settled = false;
      const runPromise = runner
        .runPrompt({ session: makeSession(), prompt: 'Plan it.' })
        .finally(() => {
          settled = true;
        });
      await waitForEventHandler();

      emitClaudeEvent(backgroundTasksLive);
      emitClaudeEvent(backgroundTaskStarted);
      emitClaudeEvent({
        type: 'assistant',
        session_id: 'provider-session-1',
        message: { content: [{ type: 'text', text: 'A background agent is mapping the API.' }] },
      });
      emitClaudeEvent({ type: 'result', subtype: 'success', session_id: 'provider-session-1' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(settled).toBe(false);
      expect(processingEvents(onAgentOutput)).not.toContainEqual(
        expect.objectContaining({ status: 'complete' }),
      );
      expect(processingEvents(onAgentOutput).at(-1)).toMatchObject({ phase: 'thinking' });
      expect(runStore.updateRunStatus).not.toHaveBeenCalledWith('agentic-1', 'complete');
      expect(runStore.updateRunStatus).not.toHaveBeenCalledWith('agentic-1', 'idle');

      emitClaudeEvent(backgroundTasksDrained);
      emitClaudeEvent(backgroundTaskNotification);
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(settled).toBe(false);

      emitClaudeEvent({
        type: 'assistant',
        session_id: 'provider-session-1',
        message: { content: [{ type: 'text', text: 'Here is the plan.' }] },
      });
      emitClaudeEvent({ type: 'result', subtype: 'success', session_id: 'provider-session-1' });
      await runPromise;

      expect(
        processingEvents(onAgentOutput).filter((payload) => payload['status'] === 'complete'),
      ).toHaveLength(1);
      const completedOutputs = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
        .map(([envelope]) => envelope.event)
        .filter(
          (event) =>
            event['eventType'] === 'agent_output' &&
            (event['payload'] as Record<string, unknown>)['taskComplete'] === true,
        );
      expect(completedOutputs).toHaveLength(1);
      expect(completedOutputs[0]?.['payload']).toMatchObject({ summary: 'Here is the plan.' });
      expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'complete');
    });

    it('settles on the first result when no background task is live', async () => {
      const onAgentOutput = vi.fn();
      const runStore = makeRunStore();
      const runner = makeRunner(onAgentOutput, runStore);
      const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'Plan it.' });
      await waitForEventHandler();

      emitClaudeEvent(backgroundTasksLive);
      emitClaudeEvent(backgroundTasksDrained);
      emitClaudeEvent({ type: 'result', subtype: 'success', session_id: 'provider-session-1' });
      await runPromise;

      expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'complete');
    });

    it('excludes ambient tasks from the live set', async () => {
      const runStore = makeRunStore();
      const runner = makeRunner(vi.fn(), runStore);
      const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'Plan it.' });
      await waitForEventHandler();

      emitClaudeEvent({
        ...backgroundTasksLive,
        tasks: [{ task_id: 'watch-1', task_type: 'monitor', description: 'Watch', ambient: true }],
      });
      emitClaudeEvent({ type: 'result', subtype: 'success', session_id: 'provider-session-1' });
      await runPromise;

      expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'complete');
    });

    it('settles when aborted while a background task is live', async () => {
      const controller = new AbortController();
      const runStore = makeRunStore();
      const runner = makeRunner(vi.fn(), runStore);
      const runPromise = runner.runPrompt({
        session: makeSession(),
        prompt: 'Plan it.',
        signal: controller.signal,
      });
      await waitForEventHandler();

      emitClaudeEvent(backgroundTasksLive);
      emitClaudeEvent({ type: 'result', subtype: 'success', session_id: 'provider-session-1' });
      controller.abort();

      await expect(runPromise).rejects.toMatchObject({ code: 'RUN_FAILED' });
      expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'idle');
    });
  });

  it('emits thinking when the first provider event is terminal', async () => {
    const onAgentOutput = vi.fn();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the implementation.',
    });
    await waitForEventHandler();

    emitClaudeEvent({ type: 'result', session_id: 'provider-session-1' });

    await runPromise;

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((phase): phase is string => typeof phase === 'string');

    expect(phases).toEqual(['starting', 'thinking']);
  });

  it('normalizes claude diff events with delivery mode and truncation metadata', async () => {
    const previousMaxDiff = process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'];
    process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'] = '1024';
    const runStore = makeRunStore();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the implementation.',
    });
    await waitForEventHandler();
    emitClaudeEvent({
      type: 'diff',
      session_id: 'provider-session-1',
      files: ['src/feature.ts'],
      diff_blob: 'b'.repeat(1500),
      incremental: false,
    });
    emitClaudeEvent({ type: 'result' });

    await runPromise;
    expect(getPersistedProviderPayload(runStore, 'diff')).toMatchObject({
      canonical_event_type: 'diff',
      canonical_event: {
        diff: {
          files: ['src/feature.ts'],
          delivery_mode: 'batch',
          truncation: {
            truncated: true,
            overflow: true,
            max_size_bytes: 1024,
          },
        },
      },
      raw_event: expect.objectContaining({
        diff_blob: expect.any(String),
      }),
    });

    if (previousMaxDiff === undefined) {
      delete process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'];
    } else {
      process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_MAX_DIFF_BLOB_BYTES'] = previousMaxDiff;
    }
  });

  it('normalizes claude status/update events', async () => {
    const runStore = makeRunStore();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run the implementation.',
    });
    await waitForEventHandler();
    emitClaudeEvent({
      type: 'status_update',
      session_id: 'provider-session-1',
      text: 'Planning changes',
      phase: 'planning',
    });
    emitClaudeEvent({ type: 'result' });

    await runPromise;
    expect(getPersistedProviderPayload(runStore, 'status_update')).toMatchObject({
      canonical_event_type: 'status',
      canonical_event: {
        status: {
          state: 'status_update',
          phase: 'planning',
          message: 'Planning changes',
        },
      },
      raw_event: expect.objectContaining({
        text: 'Planning changes',
      }),
    });
  });

  it('reports strict-mode normalization failures with diagnostics', async () => {
    const previousValidationMode =
      process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'];
    process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'] = 'strict';
    const runStore = makeRunStore();
    const { logger, warn } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run strict validation test.',
    });
    await waitForEventHandler();
    emitClaudeEvent({
      type: 'permission_request',
      session_id: 'provider-session-1',
    });
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(getPersistedProviderPayload(runStore, 'permission_request')).toMatchObject({
      normalization: {
        validation_mode: 'strict',
        success: false,
        schema_mismatch: true,
      },
      raw_event: expect.objectContaining({
        type: 'permission_request',
      }),
    });
    expect(warn).toHaveBeenCalledWith(
      'local.runner.claude.event.normalization',
      expect.objectContaining({
        eventType: 'permission_request',
        success: false,
        normalizationFailureCount: 1,
        normalizationSchemaMismatchCount: 1,
      }),
    );

    if (previousValidationMode === undefined) {
      delete process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'];
    } else {
      process.env['HEYHEY_PROVIDER_EVENT_NORMALIZATION_VALIDATION_MODE'] = previousValidationMode;
    }
  });

  it('logs tool_result errors at error level with full tool_use correlation', async () => {
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Make an edit.',
    });
    await waitForEventHandler();

    emitClaudeEvent({
      type: 'assistant',
      session_id: 'provider-session-1',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'toolu_edit_1',
            name: 'Edit',
            input: {
              file_path: 'src/thing.ts',
              old_string: 'foo',
              new_string: 'bar',
            },
          },
        ],
      },
      timestamp: '2026-04-17T00:00:01.000Z',
    });

    emitClaudeEvent({
      type: 'user',
      session_id: 'provider-session-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_edit_1',
            is_error: true,
            content: [{ type: 'text', text: 'Authentication required' }],
          },
        ],
      },
      timestamp: '2026-04-17T00:00:02.000Z',
    });

    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(error).toHaveBeenCalledWith(
      'local.runner.claude.tool_result.error',
      expect.objectContaining({
        toolUseId: 'toolu_edit_1',
        toolName: 'Edit',
        toolInput: expect.objectContaining({
          file_path: 'src/thing.ts',
          old_string: 'foo',
          new_string: 'bar',
        }),
        correlated: true,
        errorText: 'Authentication required',
        agenticSessionId: 'agentic-1',
        providerSessionId: 'provider-session-1',
        conversationId: 'conv-1',
      }),
    );
  });

  it('logs uncorrelated tool_result errors when the tool_use was not seen', async () => {
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Orphan tool_result.',
    });
    await waitForEventHandler();

    emitClaudeEvent({
      type: 'user',
      session_id: 'provider-session-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_unknown',
            is_error: true,
            content: 'kaboom',
          },
        ],
      },
      timestamp: '2026-04-17T00:00:03.000Z',
    });

    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(error).toHaveBeenCalledWith(
      'local.runner.claude.tool_result.error',
      expect.objectContaining({
        toolUseId: 'toolu_unknown',
        toolName: null,
        toolInput: null,
        correlated: false,
        errorText: 'kaboom',
      }),
    );
  });

  it('does not log non-error tool_results', async () => {
    const runStore = makeRunStore();
    const { logger, error } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Successful tool.',
    });
    await waitForEventHandler();

    emitClaudeEvent({
      type: 'user',
      session_id: 'provider-session-1',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_ok',
            is_error: false,
            content: 'ok',
          },
        ],
      },
      timestamp: '2026-04-17T00:00:04.000Z',
    });

    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(
      error.mock.calls.some(([eventName]) => eventName === 'local.runner.claude.tool_result.error'),
    ).toBe(false);
  });

  it('logs redacted raw incoming events at trace level', async () => {
    const previousRedactionSetting = process.env['HEYHEY_AGENT_EVENT_LOG_REDACTION'];
    process.env['HEYHEY_AGENT_EVENT_LOG_REDACTION'] = 'true';
    const { logger, trace } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run diagnostics.',
    });
    await waitForEventHandler();
    emitClaudeEvent({
      type: 'permission_request',
      api_key: 'top-secret-token',
      timestamp: '2026-02-20T00:00:01.000Z',
    });
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(trace).toHaveBeenCalledWith(
      'local.runner.claude.event.raw_received',
      expect.objectContaining({
        eventType: 'permission_request',
        rawEvent: expect.objectContaining({
          api_key: '[REDACTED]',
        }),
      }),
    );

    if (previousRedactionSetting === undefined) {
      delete process.env['HEYHEY_AGENT_EVENT_LOG_REDACTION'];
    } else {
      process.env['HEYHEY_AGENT_EVENT_LOG_REDACTION'] = previousRedactionSetting;
    }
  });

  it('resolves pending Claude permission requests when a UI decision is submitted', async () => {
    const base = mkdtempSync(join(tmpdir(), 'claude-user-approval-containment-'));
    const allowedRoot = join(base, 'worktree');
    const outsideRoot = join(base, 'outside');
    mkdirSync(allowedRoot);
    mkdirSync(outsideRoot);
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
    const runStore = makeRunStore();
    const onAgentOutput = vi.fn();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
    });
    const session = makeSession();

    const runPromise = runner.runPrompt({
      session,
      prompt: 'Run with permission checks.',
      workspace,
      workspaceWriteBoundary,
    });
    await waitForPermissionHandler();

    await expect(
      permissionRequestHandler?.('Write', {
        file_path: join(outsideRoot, 'blocked.ts'),
        content: 'blocked',
      }),
    ).resolves.toMatchObject({ behavior: 'deny' });
    const permissionPromise = permissionRequestHandler?.('Write', {
      file_path: 'src/approved.ts',
      content: 'approved',
    });
    await Promise.resolve();

    let permissionEvent: (typeof onAgentOutput.mock.calls)[number] | undefined;
    for (let attempt = 0; attempt < 50 && !permissionEvent; attempt += 1) {
      permissionEvent = onAgentOutput.mock.calls.find((call) => {
        const payload = call[0]?.event?.payload;
        if (!payload || typeof payload !== 'object') {
          return false;
        }
        const permissionRequest = (payload as Record<string, unknown>)['permission_request'];
        return (
          call[0]?.event?.eventType === 'permission_request' &&
          typeof permissionRequest === 'object' &&
          permissionRequest !== null
        );
      });
      if (!permissionEvent) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    }
    expect(permissionEvent).toBeDefined();
    const permissionPayload = permissionEvent?.[0]?.event?.payload as {
      permission_request: { id: string; session_id: string };
    };

    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: permissionPayload.permission_request.session_id,
      requestId: permissionPayload.permission_request.id,
      agentType: 'claude',
      decision: 'approve',
      reason: null,
      idempotencyToken: permissionPayload.permission_request.id,
      deciderUserId: 'user-1',
    });

    const submitResult = await runner.submitPermissionDecision?.({
      session,
      dispatch,
    });
    expect(submitResult).toEqual({
      delivered: true,
      callbackType: 'claude_control_response',
    });
    await expect(permissionPromise).resolves.toEqual({
      behavior: 'allow',
      updatedInput: {
        file_path: join(workspaceWriteBoundary.cwd, 'src/approved.ts'),
        content: 'approved',
      },
    });

    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;
    await workspaceWriteBoundary.dispose();
    rmSync(base, { recursive: true, force: true });
  });

  describe('AskUserQuestion', () => {
    const askInput = {
      questions: [
        {
          question: 'Which colour?',
          header: 'Colour',
          multiSelect: false,
          options: [
            { label: 'Teal', description: 'Cool' },
            { label: 'Orange', description: 'Warm' },
          ],
        },
      ],
    };

    const startRunner = async (
      onAgentOutput: Parameters<typeof createProviderTestAgentOutputOwner>[0],
      skipPermissions = false,
    ) => {
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      });
      const runPromise = runner.runPrompt({
        session: makeSession(),
        prompt: 'Ask me something.',
        skipPermissions,
      });
      await waitForPermissionHandler();
      return { runner, runPromise };
    };

    const postedQuestion = (onAgentOutput: ReturnType<typeof vi.fn>) => {
      const events = onAgentOutput.mock.calls
        .map((call) => call[0]?.event as { eventType: string; payload: Record<string, unknown> })
        .filter(
          (event) =>
            event.eventType === 'agent_output' &&
            typeof event.payload['summary'] === 'string' &&
            event.payload['summary'].includes('agent_question_v1'),
        );
      expect(events).toHaveLength(1);
      return JSON.parse(events[0]!.payload['summary'] as string) as {
        requestId: string;
        sessionId: string;
        idempotencyToken: string;
        answers: unknown;
        questions: unknown;
      };
    };

    it('posts one question, never raises a permission request, and resolves with the answers', async () => {
      const onAgentOutput = vi.fn();
      // skipPermissions would auto-approve a regular tool; the question must still be asked.
      const { runner, runPromise } = await startRunner(onAgentOutput, true);

      const pending = permissionRequestHandler!('AskUserQuestion', askInput);
      const question = postedQuestion(onAgentOutput);
      expect(question.answers).toBeNull();
      expect(question.questions).toEqual(askInput.questions);
      expect(
        onAgentOutput.mock.calls.some((call) => call[0]?.event?.eventType === 'permission_request'),
      ).toBe(false);

      const answers = { 'Which colour?': 'Teal' };
      const delivery = runner.submitQuestionAnswer({
        requestId: question.requestId,
        idempotencyToken: 'token-1',
        answers,
      });
      expect(delivery).toMatchObject({ delivered: true });
      await expect(pending).resolves.toEqual({
        behavior: 'allow',
        updatedInput: { ...askInput, answers },
      });
      expect(onAgentOutput.mock.calls.map((call) => call[0]?.event)).toContainEqual(
        expect.objectContaining({
          eventType: 'question_answer_ui',
          payload: expect.objectContaining({ requestId: question.requestId, answers }),
        }),
      );

      expect(
        runner.submitQuestionAnswer({
          requestId: question.requestId,
          idempotencyToken: 'token-1',
          answers,
        }),
      ).toEqual({ delivered: false, outcome: 'duplicate' });
      expect(
        runner.submitQuestionAnswer({
          requestId: question.requestId,
          idempotencyToken: 'token-2',
          answers,
        }),
      ).toEqual({ delivered: false, outcome: 'stale', reason: 'request_not_found' });

      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await runPromise;
    });

    it('denies invalid question input without posting anything', async () => {
      const onAgentOutput = vi.fn();
      const { runner, runPromise } = await startRunner(onAgentOutput);

      await expect(
        permissionRequestHandler!('AskUserQuestion', { questions: [] }),
      ).resolves.toMatchObject({ behavior: 'deny' });
      expect(onAgentOutput).not.toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({ eventType: 'permission_request' }),
        }),
      );
      expect(
        runner.submitQuestionAnswer({ requestId: 'none', idempotencyToken: 't', answers: {} }),
      ).toMatchObject({ delivered: false, outcome: 'stale' });

      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await runPromise;
    });

    it('releases a waiting question with a denial when the turn completes', async () => {
      const onAgentOutput = vi.fn();
      const { runPromise } = await startRunner(onAgentOutput);

      const pending = permissionRequestHandler!('AskUserQuestion', askInput);
      postedQuestion(onAgentOutput);

      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await runPromise;
      await expect(pending).resolves.toMatchObject({ behavior: 'deny' });
    });

    it('releases a waiting question with a denial when the runner is disposed', async () => {
      const onAgentOutput = vi.fn();
      const { runner, runPromise } = await startRunner(onAgentOutput);

      const pending = permissionRequestHandler!('AskUserQuestion', askInput);
      postedQuestion(onAgentOutput);

      await runner.dispose();
      await expect(pending).resolves.toMatchObject({ behavior: 'deny' });

      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await runPromise.catch(() => undefined);
    });
  });

  it.each([
    ['skipPermissions', true, []],
    ['stored allow rule', false, ['Write']],
  ])(
    'validates and rewrites structured writes before %s approval',
    async (_approvalMode, skipPermissions, storedRules) => {
      const base = mkdtempSync(join(tmpdir(), 'claude-containment-'));
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
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
      });

      const runPromise = runner.runPrompt({
        session: makeSession(),
        prompt: 'write files',
        skipPermissions,
        workspace,
        workspaceWriteBoundary,
      });
      await waitForPermissionHandler();

      await expect(
        permissionRequestHandler!('Write', { file_path: 'src/new.ts', content: 'ok' }),
      ).resolves.toEqual({
        behavior: 'allow',
        updatedInput: {
          file_path: join(workspaceWriteBoundary.cwd, 'src/new.ts'),
          content: 'ok',
        },
      });
      await expect(
        permissionRequestHandler!('Write', {
          file_path: join(outsideRoot, 'escape.ts'),
          content: 'blocked',
        }),
      ).resolves.toMatchObject({ behavior: 'deny' });
      await expect(
        permissionRequestHandler!('Write', {
          file_path: 'escape/symlink.ts',
          content: 'blocked',
        }),
      ).resolves.toMatchObject({ behavior: 'deny' });
      for (const [toolName, input] of [
        ['Edit', { file_path: join(outsideRoot, 'edit.ts'), old_string: 'a', new_string: 'b' }],
        ['MultiEdit', { file_path: join(outsideRoot, 'multi.ts'), edits: [] }],
        ['NotebookEdit', { notebook_path: join(outsideRoot, 'nb.ipynb'), new_source: 'x' }],
      ] as const) {
        await expect(permissionRequestHandler!(toolName, input)).resolves.toMatchObject({
          behavior: 'deny',
        });
      }

      const startConfig = startSessionMock.mock.calls[0]?.[0] as {
        workspaceContainment?: Record<string, unknown> & {
          settings: { sandbox: Record<string, unknown> };
        };
      };
      // Native sandbox on every platform (macOS included), fail-closed, with
      // no CLI-owned outer launcher around the Claude process.
      expect(startConfig.workspaceContainment?.settings.sandbox).toMatchObject({
        enabled: true,
        failIfUnavailable: true,
        allowUnsandboxedCommands: false,
        network: { allowUnixSockets: [] },
      });
      expect(startConfig.workspaceContainment).not.toHaveProperty('processLaunch');
      expect(startConfig).toMatchObject({ permissionMode: 'default' });
      emitClaudeEvent({ type: 'result' });
      await runPromise;
      await workspaceWriteBoundary.dispose();
      rmSync(base, { recursive: true, force: true });
    },
  );

  it('passes mcpServers and allowedTools to startSession when oauthClient is provided', async () => {
    const mockMcpConfig = {
      mcpServers: {
        'heyhey-platform': {
          type: 'http',
          url: 'https://heyhey.dev/mcp',
          headers: {
            Authorization: 'Bearer test-token',
            'X-Organization-ID': 'org-123',
            'X-Project-ID': 'project-1',
            'X-Conversation-ID': 'conv-1',
          },
        },
      },
      allowedTools: CODING_MCP_TOOLS.map((t) => `mcp__heyhey-platform__${t}`),
    };
    buildMcpServerConfigMock.mockResolvedValue(mockMcpConfig);

    const oauthClient = createProviderTestOAuthClient({ success: true, data: 'test-token' });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run with MCP.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(buildMcpServerConfigMock).toHaveBeenCalledWith(
      oauthClient,
      expect.objectContaining({
        projectId: 'project-1',
        conversationId: 'conv-1',
        serviceId: 'svc-1',
        agentSessionId: 'agentic-1',
      }),
      { additionalTools: [] },
    );
    // A turn's proposals must not anchor to the placeholder message: the MCP
    // context carries no messageId, so no X-Message-ID header is sent and the
    // server mints a carrier.
    const mcpContext = buildMcpServerConfigMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(mcpContext).not.toHaveProperty('messageId');
    const startCallArgs = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startCallArgs['mcpServers']).toEqual(mockMcpConfig.mcpServers);
    expect(startCallArgs['allowedTools']).toEqual(mockMcpConfig.allowedTools);
  });

  it('isolates project reports from repositories, generic graph tools, and session-start context', async () => {
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
    });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
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
    await waitForEventHandler();
    const startConfig = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(startConfig['cwd']).toContain('heyhey-provider-isolated-');
    expect(startConfig['builtinTools']).toEqual([]);
    expect(startConfig['mcpServers']).toHaveProperty('heyhey-submission-tools');
    expect(startConfig['mcpServers']).toHaveProperty('heyhey-platform');
    expect(startConfig['allowedTools']).toEqual([
      'mcp__heyhey-platform__get_report_schema',
      'mcp__heyhey-submission-tools__create_report',
    ]);
    expect(readSessionStartContextMock).not.toHaveBeenCalled();
    expect(startConfig['prompt']).not.toContain('Maturity stage');
    expect(buildMcpServerConfigMock).not.toHaveBeenCalled();
  });

  it.each(['TAKING_SHAPE', 'ESTABLISHED'] as const)(
    'reads and delivers maturity=%s once on a fresh session',
    async (maturity) => {
      readSessionStartContextMock.mockResolvedValueOnce({
        workItemTypeDefinitions: [],
        intentFirst: false,
        maturity,
      });
      buildMcpServerConfigMock.mockResolvedValue({ mcpServers: {}, allowedTools: [] });
      const oauthClient = createProviderTestOAuthClient({ success: true, data: 'test-token' });
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient,
      });

      const runPromise = runner.runPrompt({
        session: makeSession(),
        prompt: 'Run a fresh session.',
      });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await runPromise;

      expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
      expect(readSessionStartContextMock).toHaveBeenCalledWith({
        oauthClient,
        projectId: 'project-1',
      });
      // The read precedes prompt delivery.
      expect(startSessionMock).toHaveBeenCalledTimes(1);
      const launch = startSessionMock.mock.calls[0]?.[0];
      expect(launch?.prompt).not.toContain('Maturity stage');
      expect(launch?.appendSystemPrompt?.includes(takingShapeGuidance)).toBe(
        maturity === 'TAKING_SHAPE',
      );
    },
  );

  it('reflects a registry add+edit in the very next session via appendSystemPrompt, with no builder or runner change', async () => {
    buildMcpServerConfigMock.mockResolvedValue({ mcpServers: {}, allowedTools: [] });
    const makeRunner = () =>
      new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
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
    const firstRun = makeRunner().runPrompt({ session: makeSession(), prompt: 'First session.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await firstRun;

    const firstPrompt = (startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'appendSystemPrompt'
    ] as string;
    expect(firstPrompt).toContain(renderWorkItemTypeOntologyEntry(baselineContract));
    expect(firstPrompt).toContain('Legal agreements and SLAs');
    expect(firstPrompt).not.toContain('Spike');
    expect(firstPrompt).not.toContain('Vendor contracts');

    startSessionMock.mockClear();

    // The user approves a registry change — CONTRACT's purpose is edited and a
    // SPIKE type is added — then opens the very next session. Nothing in the
    // builder or runner changed between the two runs; only the read differs.
    readSessionStartContextMock.mockResolvedValueOnce({
      workItemTypeDefinitions: EDITED_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    const nextRun = makeRunner().runPrompt({ session: makeSession(), prompt: 'Next session.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await nextRun;

    const nextPrompt = (startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'appendSystemPrompt'
    ] as string;
    expect(nextPrompt).toContain(renderWorkItemTypeOntologyEntry(editedContract));
    expect(nextPrompt).toContain(renderWorkItemTypeOntologyEntry(addedSpike));
    expect(nextPrompt).toContain('Vendor contracts, renewals, and SLAs');
    expect(nextPrompt).toContain('A timeboxed investigation');
    // The stale purpose is gone — the delivered ontology tracks the registry,
    // not a value frozen into the code.
    expect(nextPrompt).not.toContain('Legal agreements and SLAs');
  });

  it('mounts browser tools and remounts changed capabilities while preserving user MCP snapshot rules', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    const mount = {
      runId: 'agentic-1',
      projectId: 'project-1',
      turnId: 't1',
      token: 'browser-one',
    };
    const first = runner.runPrompt({
      session: makeSession(),
      prompt: 'first',
      browserMcpMount: mount,
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await first;
    expect(startSessionMock.mock.calls[0]?.[0]).toMatchObject({
      mcpServers: {
        'heyhey-browser': {
          type: 'http',
          url: 'http://127.0.0.1:9999/mcp/browser-tools/browser-one',
        },
      },
      allowedTools: expect.arrayContaining([
        'mcp__heyhey-browser__navigate',
        'mcp__heyhey-browser__screenshot',
      ]),
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    const next = runner.resumeSession({
      session: makeSession({ provider_session_id: 'provider-session-1' }),
      prompt: 'reply',
      browserMcpMount: { ...mount, turnId: 't2', token: 'browser-two' },
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await next;
    expect(startSessionMock.mock.calls.at(-1)?.[0]).toMatchObject({
      mcpServers: {
        'heyhey-browser': { url: 'http://127.0.0.1:9999/mcp/browser-tools/browser-two' },
      },
    });
    expect(loadUserMcpConfigMock).toHaveBeenCalledTimes(1);
    const disabled = runner.resumeSession({
      session: makeSession({ provider_session_id: 'provider-session-1' }),
      prompt: 'disabled reply',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await disabled;
    expect(startSessionMock.mock.calls.at(-1)?.[0].mcpServers ?? {}).not.toHaveProperty(
      'heyhey-browser',
    );
  });

  it('reads the registry once per run, not once per turn, across a fresh turn and a resume turn', async () => {
    buildMcpServerConfigMock.mockResolvedValue({ mcpServers: {}, allowedTools: [] });
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'stable-token' }),
    });

    // Turn 1 — fresh session: reads the registry and delivers the assembled prompt.
    const turn1 = runner.runPrompt({ session: makeSession(), prompt: 'First turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await turn1;

    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
    const turn1Prompt = (startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'appendSystemPrompt'
    ] as string;
    expect(turn1Prompt).toContain(renderWorkItemTypeOntologyEntry(baselineContract));

    // Turn 2 — resume on the same run: the continue path delivers no new
    // appendSystemPrompt and must not re-read the registry.
    getSessionIdMock.mockReturnValue('provider-session-1');
    const turn2 = runner.runPrompt({ session: makeSession(), prompt: 'Second turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await turn2;

    expect(continueSessionMock).toHaveBeenCalledTimes(1);
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
  });

  it('delivers Intent first guidance only on the fresh turn when the saved choice is on', async () => {
    buildMcpServerConfigMock.mockResolvedValue({ mcpServers: {}, allowedTools: [] });
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: true,
      maturity: 'ESTABLISHED',
    });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'stable-token' }),
    });

    const turn1 = runner.runPrompt({ session: makeSession(), prompt: 'First turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await turn1;

    const turn1Prompt = (startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>)[
      'appendSystemPrompt'
    ] as string;
    expect(turn1Prompt).toContain(intentFirstGuidance);

    // The switch is turned off mid-run; the running session neither re-reads it nor re-sends a prompt.
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: BASELINE_DEFINITIONS,
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    const turn2 = runner.runPrompt({ session: makeSession(), prompt: 'Second turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await turn2;

    expect(readSessionStartContextMock).toHaveBeenCalledTimes(1);
    expect(startSessionMock).toHaveBeenCalledTimes(1);
  });

  it('resumes a persisted provider session after the runner is recreated', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession({ provider_session_id: 'persisted-provider-session' }),
      prompt: 'Continue after a process restart.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock).not.toHaveBeenCalled();
    expect(startSessionMock.mock.calls[0]?.[0]).toMatchObject({
      resumeSessionId: 'persisted-provider-session',
      prompt: 'Continue after a process restart.',
    });
    expect(startSessionMock.mock.calls[0]?.[0]).not.toHaveProperty('appendSystemPrompt');
  });

  it('resumes the same provider session after the Run boundary is disposed and recreated', async () => {
    const base = mkdtempSync(join(tmpdir(), 'claude-durable-resume-'));
    const allowedRoot = join(base, 'worktree');
    mkdirSync(allowedRoot);
    const workspace: ResolvedRunWorkspace = {
      ok: true,
      runMode: 'default',
      repositoryPathForRunStarted: allowedRoot,
      cwd: allowedRoot,
      allowedRepositoryRoots: [allowedRoot],
      bindingRepositoryPath: allowedRoot,
      workspaceRoot: null,
    };
    try {
      const firstBoundary = await RunWorkspaceWriteBoundary.create(workspace, {
        runScopeId: 'agentic-1',
        providerStateRoot: join(base, 'provider-state'),
      });
      startSessionMock.mockImplementationOnce(async () => {
        getSessionIdMock.mockReturnValue('original-provider-session');
        return { ok: true, subtype: 'success', numTurns: 1, sessionId: null };
      });
      const firstRunner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
      });
      const firstRun = firstRunner.runPrompt({
        session: makeSession(),
        prompt: 'First turn.',
        workspace,
        workspaceWriteBoundary: firstBoundary,
      });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result', subtype: 'success' });
      const firstResult = await firstRun;
      expect(firstResult.providerSessionId).toBe('original-provider-session');

      // Idle reap / CLI restart: the runner and its Run boundary go away.
      await firstRunner.dispose();
      await firstBoundary.dispose();
      eventHandler = null;

      const secondBoundary = await RunWorkspaceWriteBoundary.create(workspace, {
        runScopeId: 'agentic-1',
        providerStateRoot: join(base, 'provider-state'),
      });
      const secondRunner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
      });
      const followUp = secondRunner.runPrompt({
        session: makeSession({ provider_session_id: firstResult.providerSessionId! }),
        prompt: 'Follow-up after restart.',
        workspace,
        workspaceWriteBoundary: secondBoundary,
      });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result', subtype: 'success' });
      await followUp;

      expect(startSessionMock).toHaveBeenCalledTimes(2);
      const resumeConfig = startSessionMock.mock.calls[1]?.[0] as Record<string, unknown>;
      expect(resumeConfig['resumeSessionId']).toBe('original-provider-session');
      expect(resumeConfig['workspaceContainment']).not.toHaveProperty('processLaunch');
      await secondBoundary.dispose();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it('fails the turn when the Claude result reports an error', async () => {
    const runStore = makeRunStore();
    startSessionMock.mockResolvedValueOnce({
      ok: false,
      subtype: 'error_max_turns',
      numTurns: 12,
      sessionId: 'provider-session-1',
      errors: [],
      errorText: 'Reached maximum number of turns (12)',
    });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'Do the thing.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result', subtype: 'error_max_turns', is_error: true });

    await expect(runPromise).rejects.toMatchObject({
      code: 'RUN_FAILED',
      message: expect.stringContaining('Reached maximum number of turns (12)'),
    });
    const completed = vi
      .mocked(runStore.appendEvent)
      .mock.calls.filter(([, event]) => event.event_type === 'run_completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.[1].payload).toMatchObject({
      code: 'RUN_FAILED',
      error: expect.stringContaining('Reached maximum number of turns (12)'),
    });
    expect(completed[0]?.[1].payload).not.toHaveProperty('errorCount', 0);
    expect(runStore.updateRunStatus).not.toHaveBeenCalledWith('agentic-1', 'complete');
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    // The failed turn's provider session stays resumable for follow-ups.
    expect(runStore.updateRunProviderIdentity).toHaveBeenCalledWith(
      'agentic-1',
      expect.objectContaining({ providerSessionId: 'provider-session-1' }),
    );
  });

  it('discards a missing provider session on resume and replies from a fresh session in the same turn', async () => {
    const runStore = makeRunStore();
    startSessionMock
      .mockResolvedValueOnce({
        ok: false,
        subtype: 'error_during_execution',
        numTurns: 0,
        sessionId: 'throwaway-session',
        errors: ['No conversation found with session ID: stale-provider-session'],
        errorText: 'No conversation found with session ID: stale-provider-session',
      })
      .mockImplementationOnce(async () => {
        getSessionIdMock.mockReturnValue('fresh-provider-session');
        return { ok: true, subtype: 'success', numTurns: 1, sessionId: 'fresh-provider-session' };
      });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession({ provider_session_id: 'stale-provider-session' }),
      prompt: 'Follow-up.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result', subtype: 'error_during_execution', is_error: true });
    await vi.waitFor(() => {
      expect(startSessionMock).toHaveBeenCalledTimes(2);
    });
    emitClaudeEvent({ type: 'result', subtype: 'success' });

    await expect(runPromise).resolves.toMatchObject({
      providerSessionId: 'fresh-provider-session',
      errorCount: 0,
    });
    expect(startSessionMock.mock.calls[0]?.[0]).toMatchObject({
      resumeSessionId: 'stale-provider-session',
    });
    expect(startSessionMock.mock.calls[1]?.[0]).not.toHaveProperty('resumeSessionId');
    expect(startSessionMock.mock.calls[1]?.[0]).toMatchObject({ prompt: 'Follow-up.' });
    expect(disconnectMock).toHaveBeenCalled();
    expect(runStore.updateRunProviderIdentity).toHaveBeenCalledWith('agentic-1', {
      providerSessionId: null,
      providerConversationId: null,
    });
    expect(runStore.updateRunStatus).toHaveBeenLastCalledWith('agentic-1', 'complete');
    expect(loadUserMcpConfigMock).toHaveBeenCalledTimes(1);
  });

  it('aborts session start when the session-start context read fails', async () => {
    buildMcpServerConfigMock.mockResolvedValue({ mcpServers: {}, allowedTools: [] });
    readSessionStartContextMock.mockRejectedValueOnce(
      new Error('registry read failed: no organization id in the access token.'),
    );
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });

    await expect(
      runner.runPrompt({ session: makeSession(), prompt: 'Run a fresh session.' }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
    // No prompt is delivered — the failure is loud, with no stale/empty fallback.
    expect(startSessionMock).not.toHaveBeenCalled();
    expect(continueSessionMock).not.toHaveBeenCalled();
  });

  it('starts a fresh release-notes session without the platform prompt or any maturity text', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });
    const pending = runner.runPrompt({
      session: makeSession(),
      prompt: 'Release notes input',
      mcpToolUseCase: 'release_notes',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await pending;
    expect(readSessionStartContextMock).not.toHaveBeenCalled();
    const launch = startSessionMock.mock.calls[0]?.[0];
    expect(launch?.prompt).not.toContain('Maturity stage');
    expect(launch?.appendSystemPrompt).toBeUndefined();
  });

  it('forwards additionalAllowedTools from runPrompt into buildMcpServerConfig', async () => {
    const mockMcpConfig = {
      mcpServers: {
        'heyhey-platform': {
          type: 'http',
          url: 'https://heyhey.dev/mcp',
          headers: {
            Authorization: 'Bearer test-token',
          },
        },
      },
      allowedTools: [
        ...CODING_MCP_TOOLS.map((t) => `mcp__heyhey-platform__${t}`),
        'mcp__heyhey-platform__create_stage',
        'mcp__heyhey-platform__move_step',
      ],
    };
    buildMcpServerConfigMock.mockResolvedValue(mockMcpConfig);

    const oauthClient = createProviderTestOAuthClient({ success: true, data: 'test-token' });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Kick off a plan-shaping session.',
      additionalAllowedTools: ['create_stage', 'move_step'],
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(buildMcpServerConfigMock).toHaveBeenCalledWith(oauthClient, expect.any(Object), {
      additionalTools: ['create_stage', 'move_step'],
    });
    const startCallArgs = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startCallArgs['allowedTools']).toEqual(mockMcpConfig.allowedTools);
  });

  it('reads, globs and greps outside the Run roots without a permission prompt', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });

    const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'Read another repo.' });
    await waitForPermissionHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    const outside = '/elsewhere/other-repo/README.md';
    for (const [tool, input] of [
      ['Read', { file_path: outside }],
      ['Glob', { pattern: '**/*.ts', path: '/elsewhere/other-repo' }],
      ['Grep', { pattern: 'TODO', path: '/elsewhere/other-repo' }],
    ] as const) {
      await expect(permissionRequestHandler!(tool, input)).resolves.toEqual({
        behavior: 'allow',
        updatedInput: input,
      });
    }
  });

  it('auto-approves tools in the session allow-list but still prompts for withheld platform tools', async () => {
    // The handler allow-lists two read tools. Neither is in the static
    // `alwaysAllowedTools` baseline, so if
    // they auto-approve it must be via the session allow-list. A platform tool
    // the handler did NOT allow-list (delete_step) must still prompt — this is
    // what keeps deliberately withheld platform tools gated behind a
    // permission request rather than silently auto-approved.
    const mockMcpConfig = {
      mcpServers: {
        'heyhey-platform': {
          type: 'http',
          url: 'https://heyhey.dev/mcp',
          headers: { Authorization: 'Bearer test-token' },
        },
      },
      allowedTools: ['mcp__heyhey-platform__get_edges', 'mcp__heyhey-platform__get_full_entity'],
    };
    buildMcpServerConfigMock.mockResolvedValue(mockMcpConfig);

    const onAgentOutput = vi.fn();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Persist the plan report.',
    });
    await waitForPermissionHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    // Allow-listed tools auto-approve, echoing the tool input back unchanged.
    await expect(
      permissionRequestHandler!('mcp__heyhey-platform__get_edges', { entityId: 'entity-1' }),
    ).resolves.toEqual({ behavior: 'allow', updatedInput: { entityId: 'entity-1' } });
    await expect(
      permissionRequestHandler!('mcp__heyhey-platform__get_full_entity', {}),
    ).resolves.toEqual({ behavior: 'allow', updatedInput: {} });

    // A withheld platform tool does NOT auto-approve: its promise stays pending
    // (awaiting a user decision) and a permission request is surfaced.
    let settled = false;
    void permissionRequestHandler!('mcp__heyhey-platform__delete_step', {}).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(onAgentOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        event: expect.objectContaining({
          eventType: 'permission_request',
          payload: expect.objectContaining({
            tool_name: 'mcp__heyhey-platform__delete_step',
          }),
        }),
      }),
    );
  });

  it.each([false, true])(
    'mounts user tools without UI approval despite platform auth availability: %s',
    async (platformFails) => {
      const config: userMcpConfig.ClaudeUserMcpConfig = {
        mcpServers: {
          logs: { command: 'node', args: ['secret'], env: { TOKEN: 'secret' } },
          remote: {
            type: 'http',
            url: 'https://host.test/secret',
            headers: { Authorization: 'secret' },
          },
          events: { type: 'sse', url: 'http://localhost:13001/sse' },
        },
        serverNames: ['logs', 'remote', 'events'],
        allowedTools: ['mcp__logs', 'mcp__remote', 'mcp__events'],
      };
      loadUserMcpConfigMock.mockResolvedValue(config);
      buildMcpServerConfigMock.mockRejectedValue(new Error('Token unavailable'));
      const onAgentOutput = vi.fn();
      const { logger, debug, info } = makeLogger();
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        logger,
        agentOutputOwner: createProviderTestAgentOutputOwner(onAgentOutput),
        ...(platformFails ? { oauthClient: createProviderTestOAuthClient() } : {}),
      });
      const runPromise = runner.runPrompt({ session: makeSession(), prompt: 'Use user tools.' });
      await vi.waitFor(() => expect(startSessionMock).toHaveBeenCalled());
      await waitForPermissionHandler();
      expect(startSessionMock.mock.calls[0]?.[0]).toMatchObject({
        mcpServers: config.mcpServers,
        allowedTools: config.allowedTools,
      });
      for (const serverName of config.serverNames) {
        await expect(
          permissionRequestHandler!(`mcp__${serverName}__read`, { query: 'test' }),
        ).resolves.toEqual({ behavior: 'allow', updatedInput: { query: 'test' } });
      }
      expect(onAgentOutput).not.toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({ eventType: 'permission_request' }),
        }),
      );
      emitClaudeEvent({
        type: 'system',
        subtype: 'init',
        tools: ['mcp__logs__read', 'mcp__remote__read'],
        mcp_servers: [{ name: 'logs', status: 'connected' }],
      });
      expect(info).toHaveBeenCalledWith(
        'local.runner.claude.tool_search.init_diff',
        expect.objectContaining({
          exposedMcpToolCount: 2,
          deferredMcpTools: [],
          requestedMcpServerRuleCount: 3,
          uncoveredMcpServerRules: ['mcp__events'],
        }),
      );
      expect(JSON.stringify(debug.mock.calls)).not.toContain('secret');
      emitClaudeEvent({ type: 'result' });
      await runPromise;
      expect(loadUserMcpConfigMock).toHaveBeenCalledTimes(1);
    },
  );

  it('keeps mint configuration on resumes and context probes, then loads additions on a fresh session', async () => {
    const oldConfig: userMcpConfig.ClaudeUserMcpConfig = {
      mcpServers: { logs: { command: 'node' } },
      serverNames: ['logs'],
      allowedTools: ['mcp__logs'],
    };
    const newConfig: userMcpConfig.ClaudeUserMcpConfig = {
      mcpServers: {
        ...oldConfig.mcpServers,
        added: { type: 'http', url: 'https://host.test/mcp' },
      },
      serverNames: ['logs', 'added'],
      allowedTools: ['mcp__logs', 'mcp__added'],
    };
    loadUserMcpConfigMock.mockResolvedValueOnce(oldConfig).mockResolvedValue(newConfig);
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    const first = runner.runPrompt({ session: makeSession(), prompt: 'First.' });
    await vi.waitFor(() => expect(startSessionMock).toHaveBeenCalledTimes(1));
    emitClaudeEvent({ type: 'result' });
    await first;

    getSessionIdMock.mockReturnValue('provider-session-1');
    const resumed = runner.runPrompt({
      session: makeSession({ provider_session_id: 'provider-session-1' }),
      prompt: 'Continue.',
    });
    await vi.waitFor(() => expect(continueSessionMock).toHaveBeenCalledTimes(1));
    emitClaudeEvent({ type: 'result' });
    await resumed;
    expect(loadUserMcpConfigMock).toHaveBeenCalledTimes(1);

    getContextUsageMock.mockResolvedValue({ totalTokens: 0, percentage: 0 });
    await runner.getContextUsageByResume({
      session: makeSession({ provider_session_id: 'provider-session-1' }),
    });
    expect(connectForControlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mcpServers: oldConfig.mcpServers,
        allowedTools: oldConfig.allowedTools,
      }),
      expect.anything(),
    );
    expect(loadUserMcpConfigMock).toHaveBeenCalledTimes(1);

    await runner.discardSession();
    const fresh = runner.runPrompt({
      session: makeSession(),
      prompt: 'Fresh.',
    });
    await vi.waitFor(() => expect(startSessionMock).toHaveBeenCalledTimes(2));
    emitClaudeEvent({ type: 'result' });
    await fresh;
    expect(loadUserMcpConfigMock).toHaveBeenCalledTimes(2);
    expect(startSessionMock.mock.calls[1]?.[0]).toMatchObject({
      mcpServers: newConfig.mcpServers,
      allowedTools: newConfig.allowedTools,
    });
  });

  it('starts session without MCP config when oauthClient is not provided', async () => {
    buildMcpServerConfigMock.mockClear();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run without MCP.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(buildMcpServerConfigMock).not.toHaveBeenCalled();
    const startCallArgs = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startCallArgs).not.toHaveProperty('mcpServers');
  });

  it('starts session without MCP config when buildMcpServerConfig fails', async () => {
    buildMcpServerConfigMock.mockRejectedValue(new Error('Token expired'));
    const { logger, warn } = makeLogger();
    const oauthClient = createProviderTestOAuthClient();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
      logger,
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run with failing MCP.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(warn).toHaveBeenCalledWith(
      'local.runner.claude.mcp_config.failed',
      expect.objectContaining({ error: expect.any(Error) }),
    );
    const startCallArgs = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startCallArgs).not.toHaveProperty('mcpServers');
  });

  it.each([
    [true, true],
    [false, false],
    [undefined, false],
  ] as const)(
    'applies Fast mode %s as %s on fresh and cold launches',
    async (selection, expected) => {
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
      });
      const session = makeSession(selection === undefined ? {} : { fastMode: selection });
      const fresh = runner.runPrompt({ session, prompt: 'Start.' });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await fresh;
      expect(startSessionMock.mock.calls[0]?.[0]).toMatchObject({ fastMode: expected });

      getSessionIdMock.mockReturnValue('provider-session-1');
      const warm = runner.resumeSession({ session, prompt: 'Continue.' });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await warm;
      expect(startSessionMock).toHaveBeenCalledTimes(1);
      expect(continueSessionMock).toHaveBeenCalledTimes(1);

      getSessionIdMock.mockReturnValue(null);
      eventHandler = null;
      const restoredRunner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
      });
      const cold = restoredRunner.resumeSession({
        session: { ...session, provider_session_id: 'provider-session-1' },
        prompt: 'Restore.',
      });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await cold;
      expect(startSessionMock.mock.calls[1]?.[0]).toMatchObject({
        fastMode: expected,
        resumeSessionId: 'provider-session-1',
      });
    },
  );

  it('passes model and reasoningEffort to startSession when set on session', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession({ model: 'claude-haiku-4-5-20251001', reasoningEffort: 'low' }),
      prompt: 'Run with model selection.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    const startCallArgs = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startCallArgs['model']).toBe('claude-haiku-4-5-20251001');
    expect(startCallArgs['reasoningEffort']).toBe('low');
  });

  it('omits model and reasoningEffort from startSession when not set on session', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'Run without model selection.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    const startCallArgs = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startCallArgs).not.toHaveProperty('model');
    expect(startCallArgs).not.toHaveProperty('reasoningEffort');
  });

  it('replaces the Claude system prompt for research and preserves warm-session delivery', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });
    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: 'INPUT',
      replaceProviderSystemPrompt: true,
      startupSegments: {
        stableInstructions: 'STABLE',
        dynamicContext: 'DYNAMIC',
        userInput: 'USER',
      },
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;
    expect(startSessionMock.mock.calls[0]?.[0]).toMatchObject({
      prompt: `DYNAMIC\n\nUSER`,
      systemPrompt: expect.stringContaining('STABLE'),
    });
    expect(startSessionMock.mock.calls[0]?.[0]).not.toHaveProperty('appendSystemPrompt');
    getSessionIdMock.mockReturnValue('sdk-session-1');
    const resumePromise = runner.runPrompt({
      session: makeSession({ provider_session_id: 'sdk-session-1' }),
      prompt: 'FOLLOW UP',
      replaceProviderSystemPrompt: true,
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await resumePromise;
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock).toHaveBeenCalledWith('FOLLOW UP', { attachments: [] });
  });

  it.each([false, true])(
    'cold persisted resume retains the handler system-prompt policy (research=%s)',
    async (research) => {
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
      });
      const resumed = runner.resumeSession({
        session: makeSession({
          provider_session_id: 'persisted-session',
          promptType: research ? 'research' : 'coding',
          fastMode: research,
        }),
        prompt: 'FOLLOW UP',
      });
      await waitForEventHandler();
      emitClaudeEvent({ type: 'result' });
      await resumed;
      const launch = startSessionMock.mock.calls[0]?.[0];
      expect(launch).toMatchObject({
        prompt: 'FOLLOW UP',
        resumeSessionId: 'persisted-session',
        [research ? 'systemPrompt' : 'appendSystemPrompt']:
          expect.stringContaining('## Platform Primer'),
      });
      expect(launch).not.toHaveProperty(research ? 'appendSystemPrompt' : 'systemPrompt');
    },
  );

  it.each([false, true])(
    'control-only persisted research launch uses handler prompt policy (%s)',
    async (research) => {
      const runner = new ClaudeAgentSessionRunner({
        localAgentEndpoint,
        submissionToolRegistry,
        toolRuleStore,
        runStore: makeRunStore(),
        repoStore: makeRepoStore(),
        oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
      });
      getContextUsageMock.mockResolvedValue(makeContextData());
      await runner.getContextUsageByResume({
        session: makeSession({
          provider_session_id: 'persisted-session',
          promptType: research ? 'research' : 'coding',
          fastMode: research,
        }),
      });
      const launch = connectForControlMock.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(launch[research ? 'systemPrompt' : 'appendSystemPrompt']).toContain(
        '## Platform Primer',
      );
      expect(launch).not.toHaveProperty(research ? 'appendSystemPrompt' : 'systemPrompt');
      expect(launch).toMatchObject({
        prompt: '',
        resumeSessionId: 'persisted-session',
        fastMode: research,
      });
    },
  );

  it('places stable entity instructions in Claude appendSystemPrompt and keeps dynamic input in the turn', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      // The platform prompt is assembled from the registry read, which needs
      // credentials; without an oauthClient there is no ontology to deliver.
      oauthClient: createProviderTestOAuthClient({ success: true, data: 'test-token' }),
    });
    const firstTurnPrompt = '  Kick off a fresh session.\nPreserve this input exactly.  ';

    const runPromise = runner.runPrompt({
      session: makeSession(),
      prompt: firstTurnPrompt,
      startupSegments: {
        stableInstructions: 'STABLE ENTITY INSTRUCTIONS',
        dynamicContext: 'DYNAMIC ENTITY CONTEXT',
        userInput: 'CURRENT USER INPUT',
      },
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await runPromise;

    expect(PROVIDER_PLATFORM_PROMPT_DELIVERY_MODE.claude).toBe('appended-system-slot');
    const startCallArgs = startSessionMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(startCallArgs['prompt']).toBe(`DYNAMIC ENTITY CONTEXT\n\nCURRENT USER INPUT`);
    const appendSystemPrompt = startCallArgs['appendSystemPrompt'];
    expect(typeof appendSystemPrompt).toBe('string');
    expect(countOccurrences(appendSystemPrompt as string, '## Platform Primer')).toBe(1);
    expect(countOccurrences(JSON.stringify(startCallArgs), '## Platform Primer')).toBe(1);
    // Pin the stable substrings that identify the Platform Primer fragment
    // — the canonical source lives in src/agents/prompts/common.ts.
    expect(appendSystemPrompt as string).toContain('## Platform Primer');
    expect(appendSystemPrompt as string).toContain('notice what I already see');
    expect(appendSystemPrompt as string).toContain('src/agents/feature-sync/prompts.ts');
    expect(appendSystemPrompt as string).toContain('unified_search');
    expect(appendSystemPrompt as string).toContain('STABLE ENTITY INSTRUCTIONS');
    expect(startCallArgs['prompt']).not.toContain('STABLE ENTITY INSTRUCTIONS');
  });

  it('recycles the Claude process when the OAuth token has been refreshed', async () => {
    const userConfig: userMcpConfig.ClaudeUserMcpConfig = {
      mcpServers: { logs: { command: 'node' } },
      serverNames: ['logs'],
      allowedTools: ['mcp__logs'],
    };
    loadUserMcpConfigMock.mockResolvedValue(userConfig);
    const mockMcpConfig = {
      mcpServers: {
        'heyhey-platform': {
          type: 'http',
          url: 'https://heyhey.dev/mcp',
          headers: { Authorization: 'Bearer token-v1' },
        },
      },
      allowedTools: CODING_MCP_TOOLS.map((t) => `mcp__heyhey-platform__${t}`),
    };
    buildMcpServerConfigMock.mockResolvedValue(mockMcpConfig);

    const oauthClient = createProviderTestOAuthClient({ success: true, data: 'token-v1' });
    const getAccessToken = vi.mocked(oauthClient.getAccessToken);
    const { logger } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
      logger,
    });

    // First prompt — starts a new session, bakes token-v1 into MCP config.
    const run1 = runner.runPrompt({ session: makeSession(), prompt: 'First turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run1;

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).not.toHaveBeenCalled();

    // Simulate an existing session for the second prompt.
    getSessionIdMock.mockReturnValue('provider-session-1');

    // The OAuth client now returns a refreshed token.
    getAccessToken.mockResolvedValue({ success: true, data: 'token-v2' });
    loadUserMcpConfigMock.mockResolvedValue({
      mcpServers: { added: { command: 'node' } },
      serverNames: ['added'],
      allowedTools: ['mcp__added'],
    });

    // Second prompt — should detect stale token, disconnect, and restart.
    const run2 = runner.runPrompt({ session: makeSession(), prompt: 'Second turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run2;

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    // Should have called startSession again (not continueSession) with --resume.
    expect(startSessionMock).toHaveBeenCalledTimes(2);
    const secondStartArgs = startSessionMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(secondStartArgs['resumeSessionId']).toBe('provider-session-1');
    expect(secondStartArgs['mcpServers']).toBeDefined();
    expect(secondStartArgs['mcpServers']).toHaveProperty('logs');
    expect(secondStartArgs['mcpServers']).not.toHaveProperty('added');
    expect(loadUserMcpConfigMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock).not.toHaveBeenCalled();
  });

  it('recycles the Claude process when the scoped platform proxy mount changes', async () => {
    const { logger } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    const run1 = runner.runPrompt({
      session: makeSession(),
      prompt: 'First turn.',
      platformMcpProxyMount: {
        runId: 'run-1',
        turnId: 'turn-1',
        token: 'token-1',
        allowedTools: ['mcp__heyhey-platform__unified_search'],
      },
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run1;

    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(disconnectMock).not.toHaveBeenCalled();

    getSessionIdMock.mockReturnValue('provider-session-1');

    const run2 = runner.runPrompt({
      session: makeSession(),
      prompt: 'Second turn.',
      platformMcpProxyMount: {
        runId: 'run-1',
        turnId: 'turn-2',
        token: 'token-2',
        allowedTools: ['mcp__heyhey-platform__get_context'],
      },
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run2;

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(startSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock).not.toHaveBeenCalled();

    const secondStartArgs = startSessionMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(secondStartArgs['resumeSessionId']).toBe('provider-session-1');
    const mcpServers = secondStartArgs['mcpServers'] as Record<
      string,
      { type: string; url: string }
    >;
    expect(mcpServers['heyhey-platform']?.url).toContain('/mcp/platform/run-1/turn-2/token-2');
    expect(secondStartArgs['allowedTools']).toEqual(['mcp__heyhey-platform__get_context']);
  });

  it('continues normally when the OAuth token has not changed', async () => {
    const mockMcpConfig = {
      mcpServers: {
        'heyhey-platform': {
          type: 'http',
          url: 'https://heyhey.dev/mcp',
          headers: { Authorization: 'Bearer stable-token' },
        },
      },
      allowedTools: CODING_MCP_TOOLS.map((t) => `mcp__heyhey-platform__${t}`),
    };
    buildMcpServerConfigMock.mockResolvedValue(mockMcpConfig);

    const oauthClient = createProviderTestOAuthClient({ success: true, data: 'stable-token' });
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
    });

    // First prompt — starts session.
    const run1 = runner.runPrompt({ session: makeSession(), prompt: 'First turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run1;

    // Simulate existing session for second prompt.
    getSessionIdMock.mockReturnValue('provider-session-1');

    // Token unchanged — should continue normally.
    const run2 = runner.runPrompt({ session: makeSession(), prompt: 'Second turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run2;

    expect(disconnectMock).not.toHaveBeenCalled();
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(continueSessionMock).toHaveBeenCalledTimes(1);
  });

  it('mints a fresh provider session on the next run after discardSession', async () => {
    const { logger, debug, info } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      logger,
    });

    // Run 1 — fresh session, mints provider-session-1.
    const run1 = runner.runPrompt({ session: makeSession(), prompt: 'First turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'assistant', session_id: 'provider-session-1' });
    getSessionIdMock.mockReturnValue('provider-session-1');
    emitClaudeEvent({ type: 'result' });
    await run1;

    expect(debug).toHaveBeenCalledWith(
      'local.runner.claude.run_prompt.succeeded',
      expect.objectContaining({ providerSessionId: 'provider-session-1' }),
    );

    // Discard the client-side session — disconnects the SDK client (the mock's
    // disconnect nulls getSessionId) and resets closure session state.
    await runner.discardSession?.();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      'local.runner.claude.session.discarded',
      expect.objectContaining({ discardedProviderSessionId: 'provider-session-1' }),
    );
    expect(getSessionIdMock()).toBeNull();

    // Run 2 — with the session discarded, getSessionId is null, so this run
    // starts fresh in 'prompt' mode rather than resuming provider-session-1.
    const run2 = runner.runPrompt({ session: makeSession(), prompt: 'Second turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'assistant', session_id: 'provider-session-2' });
    getSessionIdMock.mockReturnValue('provider-session-2');
    emitClaudeEvent({ type: 'result' });
    await run2;

    const startedCalls = debug.mock.calls.filter(
      ([eventName]) => eventName === 'local.runner.claude.run_prompt.started',
    );
    expect(startedCalls).toHaveLength(2);
    expect(startedCalls[1]?.[1]).toMatchObject({
      mode: 'prompt',
      hasExistingSession: false,
      canResumeFromPersisted: false,
      persistedProviderSessionId: null,
    });

    // Distinct provider session ids minted across the two runs.
    expect(debug).toHaveBeenCalledWith(
      'local.runner.claude.run_prompt.succeeded',
      expect.objectContaining({ providerSessionId: 'provider-session-2' }),
    );
  });

  it('does not resurrect a discarded session via the mcp-headers-stale recycle', async () => {
    const mockMcpConfig = {
      mcpServers: {
        'heyhey-platform': {
          type: 'http',
          url: 'https://heyhey.dev/mcp',
          headers: { Authorization: 'Bearer token-v1' },
        },
      },
      allowedTools: CODING_MCP_TOOLS.map((t) => `mcp__heyhey-platform__${t}`),
    };
    buildMcpServerConfigMock.mockResolvedValue(mockMcpConfig);

    const oauthClient = createProviderTestOAuthClient({ success: true, data: 'token-v1' });
    const getAccessToken = vi.mocked(oauthClient.getAccessToken);
    const { logger, info } = makeLogger();
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
      oauthClient,
      logger,
    });

    // Run 1 — mints provider-session-1, bakes token-v1 into MCP config.
    const run1 = runner.runPrompt({ session: makeSession(), prompt: 'First turn.' });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run1;
    expect(startSessionMock).toHaveBeenCalledTimes(1);

    // Simulate the discard-in-flight hole the backstop guards: the client still
    // remembers provider-session-1 (a future path that disconnected without
    // clearing the id), yet the Run has cleared session.provider_session_id and
    // the OAuth token rotated — so the stale-headers recycle branch fires.
    getSessionIdMock.mockReturnValue('provider-session-1');
    getAccessToken.mockResolvedValue({ success: true, data: 'token-v2' });

    const run2 = runner.runPrompt({
      // The Run nulls provider_session_id on discard. The field is declared
      // `string`, but runtime can hand the runner null here (hence the
      // readTrimmed guard) — reproduce that real shape rather than the type's.
      session: makeSession({ provider_session_id: null as unknown as string }),
      prompt: 'Second turn.',
    });
    await waitForEventHandler();
    emitClaudeEvent({ type: 'result' });
    await run2;

    // The stale-discard detection fires before the recycle path and handles
    // the disconnect — the recycle block is skipped since hasExistingSession
    // is already false by the time it runs.
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      'local.runner.claude.session.stale_discard_detected',
      expect.objectContaining({ staleProviderSessionId: 'provider-session-1' }),
    );
    // ...but mints a fresh session instead of resuming the discarded id.
    expect(startSessionMock).toHaveBeenCalledTimes(2);
    expect(continueSessionMock).not.toHaveBeenCalled();
    const secondStartArgs = startSessionMock.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(secondStartArgs['resumeSessionId']).toBeUndefined();
  });

  it('returns a stale outcome when the request id is unknown', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    const session = makeSession();
    const dispatch = translatePermissionDecisionToDispatch({
      runId: session.agentic_session_id,
      sessionId: 'provider-session-1',
      requestId: 'missing-permission-id',
      agentType: 'claude',
      decision: 'deny',
      reason: 'Denied by reviewer.',
      idempotencyToken: null,
      deciderUserId: 'user-1',
    });

    await expect(
      runner.submitPermissionDecision?.({
        session,
        dispatch,
      }),
    ).resolves.toEqual({ delivered: false, outcome: 'stale', reason: 'request_not_found' });
  });

  const makeContextData = (): Record<string, unknown> => ({
    categories: [],
    totalTokens: 1234,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    percentage: 0.6,
    gridRows: [],
    model: 'claude-opus-4-8',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    isAutoCompactEnabled: true,
    apiUsage: null,
  });

  it('returns the live context-usage breakdown when a provider session is active', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    const contextData = makeContextData();
    getContextUsageMock.mockResolvedValue(contextData);

    await expect(runner.getContextUsage()).resolves.toEqual(contextData);
    await expect(runner.getContextUsage('provider-session-1')).resolves.toEqual(contextData);
    expect(getContextUsageMock).toHaveBeenCalledTimes(2);
  });

  it('throws NO_ACTIVE_SESSION when no provider session is active', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue(null);

    await expect(runner.getContextUsage()).rejects.toEqual(
      expect.objectContaining({ code: 'NO_ACTIVE_SESSION' }),
    );
    expect(getContextUsageMock).not.toHaveBeenCalled();
  });

  it('throws NO_ACTIVE_SESSION when the requested providerSessionId is not the active one', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    getContextUsageMock.mockResolvedValue(makeContextData());

    await expect(runner.getContextUsage('provider-session-other')).rejects.toEqual(
      expect.objectContaining({ code: 'NO_ACTIVE_SESSION' }),
    );
    expect(getContextUsageMock).not.toHaveBeenCalled();
  });
});

describe('session-runner-claude compact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = null;
    permissionRequestHandler = null;
    startSessionMock.mockResolvedValue(CLAUDE_TURN_SUCCESS);
    continueSessionMock.mockResolvedValue(CLAUDE_TURN_SUCCESS);
    getSessionIdMock.mockReturnValue(null);
    getContextUsageMock.mockReset();
    compactMock.mockReset();
    disconnectMock.mockReset();
    buildMcpServerConfigMock.mockReset();
  });

  it('resolves compact() against the live provider session and accepts a matching providerSessionId override', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    compactMock.mockResolvedValue(undefined);

    await expect(runner.compact?.()).resolves.toBeUndefined();
    await expect(runner.compact?.('provider-session-1')).resolves.toBeUndefined();
    expect(compactMock).toHaveBeenCalledTimes(2);
  });

  it('throws NO_ACTIVE_SESSION when no provider session is active', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue(null);

    await expect(runner.compact?.()).rejects.toEqual(
      expect.objectContaining({ code: 'NO_ACTIVE_SESSION' }),
    );
    expect(compactMock).not.toHaveBeenCalled();
  });

  it('throws NO_ACTIVE_SESSION when the requested providerSessionId is not the active one', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    compactMock.mockResolvedValue(undefined);

    await expect(runner.compact?.('provider-session-other')).rejects.toEqual(
      expect.objectContaining({ code: 'NO_ACTIVE_SESSION' }),
    );
    expect(compactMock).not.toHaveBeenCalled();
  });

  it('maps an SDK timeout into RUN_FAILED and preserves the original cause', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    const timeoutError = new Error('Compact request timed out after 300000ms');
    timeoutError.name = 'CompactTimeoutError';
    compactMock.mockRejectedValue(timeoutError);

    const rejection = runner.compact?.();
    await expect(rejection).rejects.toEqual(
      expect.objectContaining({
        code: 'RUN_FAILED',
        message: expect.stringContaining('Compact request timed out'),
      }),
    );
    await expect(rejection).rejects.toMatchObject({ cause: timeoutError });
  });

  it('maps an SDK disconnect/control error into RUN_FAILED and preserves the original cause', async () => {
    const runner = new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore: makeRunStore(),
      repoStore: makeRepoStore(),
    });
    getSessionIdMock.mockReturnValue('provider-session-1');
    const disconnectError = new Error('Control request "compact" aborted: client disconnected');
    disconnectError.name = 'ControlRequestDisconnectedError';
    compactMock.mockRejectedValue(disconnectError);

    const rejection = runner.compact?.();
    await expect(rejection).rejects.toEqual(
      expect.objectContaining({
        code: 'RUN_FAILED',
        message: expect.stringContaining('client disconnected'),
      }),
    );
    await expect(rejection).rejects.toMatchObject({ cause: disconnectError });
  });
});

describe('ClaudeAgentSessionRunner.promptOnce', () => {
  const makeRunner = (runStore: RunStore = makeRunStore()) =>
    new ClaudeAgentSessionRunner({
      localAgentEndpoint,
      submissionToolRegistry,
      toolRuleStore,
      runStore,
      repoStore: makeRepoStore(),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = null;
    startSessionMock.mockResolvedValue(CLAUDE_TURN_SUCCESS);
  });

  it('returns the assistant text from a tool-free session in an empty directory', async () => {
    startSessionMock.mockImplementation(async () => {
      emitClaudeEvent({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'search for jev' }] },
      });
      return CLAUDE_TURN_SUCCESS;
    });
    const runStore = makeRunStore();
    const { signal } = new AbortController();

    const answer = await makeRunner(runStore).promptOnce({
      session: makeSession({ model: 'session-model' }),
      prompt: 'plan searches',
      model: 'turn-model',
      reasoningEffort: 'high',
      signal,
    });

    expect(answer).toBe('search for jev');
    const [config, options] = startSessionMock.mock.calls[0] as [Record<string, unknown>, unknown];
    expect(config).toMatchObject({
      prompt: 'plan searches',
      builtinTools: [],
      model: 'turn-model',
      reasoningEffort: 'high',
    });
    expect(config).not.toHaveProperty('mcpServers');
    expect(config).not.toHaveProperty('allowedTools');
    expect(config['cwd']).not.toBe('/tmp/repo');
    expect(options).toEqual({ signal });
    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(runStore.appendEvent).not.toHaveBeenCalled();
  });

  it('throws the provider error when the turn fails', async () => {
    startSessionMock.mockResolvedValue({
      ok: false,
      subtype: 'error_during_execution',
      numTurns: 1,
      sessionId: null,
      errors: ['model unavailable'],
      errorText: 'model unavailable',
    });

    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED', message: 'model unavailable' });
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('throws when the turn produces no text', async () => {
    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'RUN_FAILED' });
  });

  it('surfaces an aborted call and still disconnects', async () => {
    startSessionMock.mockRejectedValue(new Error('Aborted'));

    await expect(
      makeRunner().promptOnce({
        session: makeSession(),
        prompt: 'plan',
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow('Aborted');
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });
});

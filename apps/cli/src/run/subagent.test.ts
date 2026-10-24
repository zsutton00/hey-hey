import { researchHandler } from '../agents/research/research.handler';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
/**
 * Unified `SubAgent` regression test.
 *
 * Verifies that a fake `UserLaunchablePromptTypeHandler` with
 * `runnerKind:'subagent'` flows through the runtime SubAgent class in the
 * expected order — buildPrompt → addUserMessage → run_started → SDK
 * startSession — without any runtime branch on promptType. Pairs with
 * `resolve-prompt.test.ts`'s coverage of the same handler shape on the
 * provider-session path to prove the two runtimes share the contract.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AgentStartupPromptInputResult,
  PromptTypeHandler,
  PromptTypeHandlerContext,
} from '../agents/prompt-type-handler';
import {
  defaultAddUserMessage,
  USER_MESSAGE_PREAMBLE,
  type UserLaunchablePromptTypeHandler,
} from '../agents/prompt-type-handler';
import { intentFirstGuidance, takingShapeGuidance } from '../agents/prompts/common';
import { renderWorkItemTypeOntologyEntry } from '../agents/prompts/render-type-ontology';
import type { ProjectMaturity, WorkItemTypeDefinitionDto } from '../shared/api/index';
import type { LocalStartupSessionPromptPayload } from '../shared/agent-bridge-contract/generated/api';
import type { AgenticSession } from '../session/types';
import { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { SubAgent } from './subagent';
import { createRunTestOAuthClient } from './run.test-support';

const startSessionMock = vi.fn<(...args: unknown[]) => Promise<undefined>>(async () => undefined);
const disconnectMock = vi.fn<() => Promise<undefined>>(async () => undefined);
const onEventMock = vi.fn();
const onPermissionRequestMock = vi.fn();
const claudeGetSessionIdMock = vi.fn<() => string | null>(() => null);
const claudeGetContextUsageMock = vi.fn<() => Promise<unknown>>(async () => ({}));
const codexGetContextUsageMock = vi.fn<() => unknown>(() => ({}));
const codexConstructorMock = vi.fn();
const codexStartSessionMock = vi.fn<(...args: unknown[]) => Promise<undefined>>(
  async () => undefined,
);
const codexDisconnectMock = vi.fn<() => Promise<undefined>>(async () => undefined);
const codexOnEventMock = vi.fn();
const codexOnServerRequestMock = vi.fn();
const codexGetSessionIdMock = vi.fn<() => string | null>(() => null);
const codexSubmitClientResponseMock = vi.fn();
const codexOnTokenUsageMock = vi.fn();
const readSessionStartContextMock = vi.fn<
  (...args: unknown[]) => Promise<{
    workItemTypeDefinitions: WorkItemTypeDefinitionDto[];
    intentFirst: boolean;
    maturity: ProjectMaturity;
  }>
>(async () => ({
  workItemTypeDefinitions: [],
  intentFirst: false,
  maturity: 'ESTABLISHED',
}));

vi.mock('../agent-runtime/index', async () => {
  const actual =
    await vi.importActual<typeof import('../agent-runtime/index')>('../agent-runtime/index');
  return {
    ...actual,
    ClaudeCodeSdkClient: class {
      async startSession(...args: Parameters<typeof startSessionMock>) {
        return startSessionMock(...args);
      }
      async disconnect() {
        return disconnectMock();
      }
      onEvent(handler: ((event: Record<string, unknown>) => void) | null) {
        onEventMock(handler);
      }
      onPermissionRequest(handler: unknown) {
        onPermissionRequestMock(handler);
      }
      getSessionId() {
        return claudeGetSessionIdMock();
      }
      async getContextUsage() {
        return claudeGetContextUsageMock();
      }
    },
    CodexSdkClient: class {
      constructor() {
        codexConstructorMock();
      }
      async startSession(...args: Parameters<typeof codexStartSessionMock>) {
        return codexStartSessionMock(...args);
      }
      async disconnect() {
        return codexDisconnectMock();
      }
      onEvent(
        handler: ((event: { method: string; params?: Record<string, unknown> }) => void) | null,
      ) {
        codexOnEventMock(handler);
      }
      onServerRequest(handler: unknown) {
        codexOnServerRequestMock(handler);
      }
      onTokenUsage(handler: unknown) {
        codexOnTokenUsageMock(handler);
      }
      getSessionId() {
        return codexGetSessionIdMock();
      }
      getContextUsage() {
        return codexGetContextUsageMock();
      }
      submitClientResponse(...args: Parameters<typeof codexSubmitClientResponseMock>) {
        return codexSubmitClientResponseMock(...args);
      }
    },
  };
});

vi.mock('../agents/mcp-server-config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agents/mcp-server-config')>()),
  buildMcpServerConfig: async () => ({ mcpServers: {}, allowedTools: [] }),
}));

vi.mock('../agents/prompts/session-start-context', () => ({
  readSessionStartContext: (...args: unknown[]) => readSessionStartContextMock(...args),
}));

interface TestPayload {
  userMessage?: string;
  marker?: string;
}

const makeSession = (overrides: Partial<AgenticSession> = {}): AgenticSession =>
  ({
    agentic_session_id: 'agentic-1',
    serviceId: 'svc-1',
    provider: 'claude',
    provider_session_id: 'pending_abc',
    provider_conversation_id: null,
    status: 'idle',
    conversationId: 'conv-1',
    contextMetadata: { organizationId: 'org-1', projectId: 'proj-1' },
    createdAt: '2026-04-26T00:00:00.000Z',
    updatedAt: '2026-04-26T00:00:00.000Z',
    events: [],
    ...overrides,
  }) as unknown as AgenticSession;

const makeOauth = () => createRunTestOAuthClient({ success: true, data: 'token' });

const makeLogger = () =>
  ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as ConstructorParameters<typeof SubAgent>[0]['logger'];

const makeSubAgent = (
  args: Omit<
    ConstructorParameters<typeof SubAgent>[0],
    'submissionToolRegistry' | 'localAgentEndpoint'
  >,
): SubAgent =>
  new SubAgent({
    ...args,
    submissionToolRegistry: new SubmissionToolRegistry(),
    localAgentEndpoint: new LocalAgentEndpoint(),
  });

describe('SubAgent — unified runtime contract', () => {
  beforeEach(() => {
    startSessionMock.mockClear();
    disconnectMock.mockClear();
    onEventMock.mockClear();
    onPermissionRequestMock.mockClear();
    codexConstructorMock.mockClear();
    codexStartSessionMock.mockClear();
    codexDisconnectMock.mockClear();
    codexOnEventMock.mockClear();
    codexOnServerRequestMock.mockClear();
    codexGetSessionIdMock.mockReset();
    codexGetSessionIdMock.mockReturnValue(null);
    codexSubmitClientResponseMock.mockClear();
    codexOnTokenUsageMock.mockClear();
    claudeGetSessionIdMock.mockReset();
    claudeGetSessionIdMock.mockReturnValue(null);
    claudeGetContextUsageMock.mockReset();
    codexGetContextUsageMock.mockReset();
    readSessionStartContextMock.mockReset();
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: [],
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });
  });

  it.each(['codex', 'claude'] as const)(
    'registered research children replace %s defaults',
    async (provider) => {
      const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
      const handler = registry.get(LocalPromptType.Research)!;
      expect(handler).toBe(researchHandler);
      const outputs = vi.fn();
      await makeSubAgent({
        session: makeSession({ provider }),
        handler,
        config: handler.childConfig!,
        payload: { userMessage: 'Find graph evidence', startupInput: {} },
        touchedFiles: [],
        onAgentOutput: outputs,
        oauthClient: makeOauth(),
        logger: makeLogger(),
        cwd: '/tmp',
        priorReports: [],
      }).execute();
      const launch = (
        provider === 'codex'
          ? codexStartSessionMock.mock.calls[0]?.[0]
          : startSessionMock.mock.calls[0]?.[0]
      ) as Record<string, unknown>;
      expect(launch).not.toHaveProperty('appendSystemPrompt');
      expect(launch).toMatchObject(
        provider === 'codex'
          ? {
              baseInstructions: expect.stringContaining('## Platform Primer'),
              sandbox: 'read-only',
              config: { approvals_reviewer: 'user' },
            }
          : { systemPrompt: expect.stringContaining('## Platform Primer'), fastMode: false },
      );
      expect(launch?.['prompt']).not.toContain('## Platform Primer');
      expect(launch?.['prompt']).toContain('Find graph evidence');
    },
  );

  it('accepts repeated allowlisted Hey Hey MCP requests without persistence and denies unavailable/external tools', async () => {
    const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
    const handler = registry.get(LocalPromptType.Research)!;
    codexStartSessionMock.mockImplementationOnce(async () => {
      const requestHandler = codexOnServerRequestMock.mock.calls[0]?.[0] as (
        request: Record<string, unknown>,
      ) => void;
      for (const [id, serverName, toolName] of [
        [1, 'heyhey-platform', 'get_context'],
        [2, 'heyhey-platform', 'get_context'],
        [3, 'heyhey-platform', 'get_work_item_type_guidance_batch'],
        [4, 'heyhey-platform', 'edit_task'],
        [5, 'external', 'get_context'],
      ] as const) {
        requestHandler({
          id,
          method: 'mcpServer/elicitation/request',
          params: {
            serverName,
            _meta: { codex_approval_kind: 'mcp_tool_call', tool_name: toolName },
          },
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await makeSubAgent({
      session: makeSession({ provider: 'codex' }),
      handler,
      config: handler.childConfig!,
      payload: { userMessage: 'Research', startupInput: {} },
      touchedFiles: [],
      onAgentOutput: vi.fn(),
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    }).execute();
    for (const id of [1, 2, 3]) {
      expect(codexSubmitClientResponseMock).toHaveBeenCalledWith(id, {
        action: 'accept',
        content: null,
        _meta: null,
      });
    }
    for (const id of [4, 5]) {
      expect(codexSubmitClientResponseMock).toHaveBeenCalledWith(id, {
        action: 'decline',
        content: null,
        _meta: null,
      });
    }
  });

  it('invokes a UserLaunchable handler in order: buildPrompt → addUserMessage → run_started → startSession', async () => {
    const callOrder: string[] = [];

    const startupPromptInput: AgentStartupPromptInputResult = {
      startupInput: {
        task: { taskType: 'STANDARD', description: 'CURRENT ENTITY CONTEXT' },
        adjacentScopeTasks: [],
        evidenceItems: [],
      },
      renderedInput: 'CURRENT ENTITY CONTEXT',
      loadedEntityContext: {
        kind: 'entity' as const,
        focalEntity: { entityType: 'TASK' as const, entityId: 'task-1' },
        entity: {} as never,
        context: {} as never,
      },
      provenance: {
        templateKey: 'task',
        ownershipSource: { scope: 'CANONICAL' as const },
        revisionId: 'revision-1',
        revisionNumber: 1,
      },
    };
    const buildPrompt = vi.fn((payload: TestPayload, context?: PromptTypeHandlerContext) => {
      callOrder.push('buildPrompt');
      expect(context?.loadedEntityContext).toBe(startupPromptInput.loadedEntityContext);
      return `SYSTEM-${payload.marker ?? 'none'}`;
    });
    const addUserMessage = vi.fn((payload: TestPayload) => {
      callOrder.push('addUserMessage');
      return defaultAddUserMessage(payload);
    });

    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt,
      addUserMessage,
    };

    const onAgentOutput = vi.fn((envelope: { event: { eventType: string } }) => {
      if (envelope.event.eventType === 'run_started') {
        callOrder.push('run_started');
      }
    });

    startSessionMock.mockImplementationOnce(async () => {
      callOrder.push('startSession');
      return undefined;
    });

    const subagent = makeSubAgent({
      session: makeSession(),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: { userMessage: 'hi from the user', marker: 'X' },
      touchedFiles: [],
      onAgentOutput,
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
      startupPromptInput,
    });

    await subagent.execute();

    expect(buildPrompt).toHaveBeenCalledTimes(1);
    expect(addUserMessage).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['buildPrompt', 'addUserMessage', 'run_started', 'startSession']);

    const startCall = startSessionMock.mock.calls[0];
    expect(startCall).toBeDefined();
    const startConfig = startCall![0] as unknown as { prompt: string };
    expect(startConfig.prompt.indexOf('CURRENT ENTITY CONTEXT')).toBeLessThan(
      startConfig.prompt.indexOf('SYSTEM-X'),
    );
    expect(startConfig.prompt).toContain('SYSTEM-X');
    expect(startConfig.prompt).toContain('hi from the user');
  });

  it('composes the registered coding-plan prompt and userMessage exactly once', async () => {
    const registeredHandlers = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
    const registeredCodingPlanHandler = registeredHandlers.get('startup_session');
    if (!registeredCodingPlanHandler?.subagentConfig) {
      throw new Error('The registered coding-plan handler must declare subagentConfig.');
    }

    const startupPromptInput: AgentStartupPromptInputResult = {
      startupInput: {
        task: {
          id: 'task-1',
          title: 'LEGACY TASK JSON',
          taskType: 'STANDARD',
          description: 'LEGACY TASK DESCRIPTION',
        },
        adjacentScopeTasks: [],
        evidenceItems: [],
      },
      renderedInput: 'CURRENT ENTITY CONTEXT',
      loadedEntityContext: {
        kind: 'entity',
        focalEntity: { entityType: 'TASK', entityId: 'task-1' },
        entity: {} as never,
        context: {} as never,
      },
      provenance: {
        templateKey: 'task',
        ownershipSource: { scope: 'CANONICAL' },
        revisionId: 'revision-1',
        revisionNumber: 1,
      },
    };
    const basePayload = {
      startupInput: {
        task: {
          id: 'task-1',
          title: 'Consume a startup user message',
          description: 'LEGACY TASK DESCRIPTION',
          acceptanceCriteria: 'The user message appears exactly once.',
          taskType: 'STANDARD',
        },
        evidenceItems: [],
        adjacentScopeTasks: [],
      },
    } as unknown as LocalStartupSessionPromptPayload;
    const uniqueUserMessage = 'UNIQUE-CODING-PLAN-STARTUP-USER-MESSAGE';
    const cases: ReadonlyArray<{
      userMessage?: string;
      expectedMessageCount: number;
      expectedPreambleCount: number;
    }> = [
      { userMessage: uniqueUserMessage, expectedMessageCount: 1, expectedPreambleCount: 0 },
      { userMessage: '', expectedMessageCount: 0, expectedPreambleCount: 0 },
      { expectedMessageCount: 0, expectedPreambleCount: 0 },
    ];
    for (const testCase of cases) {
      // SubAgent receives the payload already prepared by Run, including conversational feedback.
      const payload: import('../agents/coding-plan/coding-plan.handler').EnrichedCodingPlanPromptPayload =
        {
          ...basePayload,
          _recentUserReplies: testCase.userMessage
            ? [{ messageId: 'reply', text: testCase.userMessage, createdAt: '' }]
            : [],
          ...(testCase.userMessage !== undefined ? { userMessage: testCase.userMessage } : {}),
        };
      const subagent = makeSubAgent({
        session: makeSession(),
        handler: registeredCodingPlanHandler,
        config: registeredCodingPlanHandler.subagentConfig,
        payload,
        touchedFiles: [],
        onAgentOutput: vi.fn(),
        oauthClient: makeOauth(),
        logger: makeLogger(),
        cwd: '/tmp',
        priorReports: [],
        startupPromptInput,
      });

      await subagent.execute();

      const startCall = startSessionMock.mock.calls[startSessionMock.mock.calls.length - 1];
      expect(startCall).toBeDefined();
      const prompt = (startCall?.[0] as unknown as { prompt: string } | undefined)?.prompt;
      expect(prompt).toBeDefined();
      expect(prompt?.match(/CURRENT ENTITY CONTEXT/g)).toHaveLength(1);
      expect(prompt).not.toContain('LEGACY TASK JSON');
      expect(prompt).not.toContain('LEGACY TASK DESCRIPTION');
      expect(prompt).not.toContain('## Task Context');
      expect(prompt).not.toContain('## Startup Context');
      expect(prompt?.split(uniqueUserMessage)).toHaveLength(testCase.expectedMessageCount + 1);
      expect(prompt?.split(USER_MESSAGE_PREAMBLE)).toHaveLength(testCase.expectedPreambleCount + 1);
    }
  });

  it('uses CodexSdkClient, not ClaudeCodeSdkClient, when the session provider is codex', async () => {
    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: ['Bash'],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'CODEX-SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    codexStartSessionMock.mockImplementationOnce(async () => {
      codexGetSessionIdMock.mockReturnValue('codex-thread-1');
      const registeredHandler = codexOnEventMock.mock.calls[0]?.[0] as
        | ((event: { method: string; params?: Record<string, unknown> }) => void)
        | undefined;
      registeredHandler?.({
        method: 'thread/started',
        params: { thread: { id: 'codex-thread-1' } },
      });
      registeredHandler?.({
        method: 'item/completed',
        params: { item: { id: 'item-1', type: 'agentMessage', text: 'Done.' } },
      });
      registeredHandler?.({
        method: 'turn/completed',
        params: { turn: { id: 'turn-1', status: 'completed' } },
      });
      return undefined;
    });

    const onAgentOutput = vi.fn();
    const subagent = makeSubAgent({
      session: makeSession({
        provider: 'codex',
        provider_session_id: 'codex-parent-thread',
        services: [
          { id: 'svc-1', path: '/ordinary/service-a' },
          { id: 'svc-2', path: '/ordinary/service-b' },
        ],
      }),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: { userMessage: 'review with codex' },
      touchedFiles: [],
      onAgentOutput,
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/worktrees/service-a',
      allowedRepositoryRoots: ['/worktrees/service-a', '/worktrees/service-b'],
      priorReports: [],
    });

    await subagent.execute();

    expect(startSessionMock).not.toHaveBeenCalled();
    expect(codexConstructorMock).toHaveBeenCalledTimes(1);
    expect(codexStartSessionMock).toHaveBeenCalledTimes(1);
    const startConfig = codexStartSessionMock.mock.calls[0]![0] as {
      prompt: string;
      cwd: string;
      sandbox?: string;
      extraWritableDirs?: string[];
      config?: Record<string, unknown>;
    };
    expect(startConfig.prompt).toContain('CODEX-SYSTEM');
    expect(startConfig.prompt).toContain('review with codex');
    expect(startConfig.cwd).toBe('/worktrees/service-a');
    expect(startConfig.sandbox).toBe('workspace-write');
    expect(startConfig.extraWritableDirs).toEqual(['/worktrees/service-b']);
    expect(startConfig.config).toMatchObject({
      sandbox_workspace_write: {
        exclude_slash_tmp: false,
        exclude_tmpdir_env_var: false,
        writable_roots: ['/worktrees/service-b'],
      },
    });
    expect(codexDisconnectMock).toHaveBeenCalledTimes(1);
  });

  it('unwraps Codex shell-wrapped command approvals before applying subagent permission policy', async () => {
    const decidePermission = vi.fn(async () => ({ behavior: 'allow' as const }));
    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: ['Bash'],
        adapterId: 'unit-test-subagent',
        decidePermission,
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    codexStartSessionMock.mockImplementationOnce(async () => {
      const registeredHandler = codexOnServerRequestMock.mock.calls[0]?.[0] as
        | ((request: Record<string, unknown>) => void)
        | undefined;
      registeredHandler?.({
        id: 0,
        method: 'item/commandExecution/requestApproval',
        params: {
          command: ['/bin/zsh', '-lc', 'git -C /repo add /repo/src/foo.ts'],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return undefined;
    });

    const subagent = makeSubAgent({
      session: makeSession({ provider: 'codex' }),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: ['/repo/src/foo.ts'],
      onAgentOutput: vi.fn(),
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/repo',
      priorReports: [],
    });

    await subagent.execute();

    const startConfig = codexStartSessionMock.mock.calls[0]?.[0] as
      | { sandbox?: string }
      | undefined;
    expect(startConfig?.sandbox).toBe('workspace-write');
    expect(decidePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Bash',
        input: { command: 'git -C /repo add /repo/src/foo.ts' },
      }),
    );
    expect(codexSubmitClientResponseMock).toHaveBeenCalledWith(0, { decision: 'accept' });
  });

  it('answers denied Codex subagent command approvals with a decision field', async () => {
    const decidePermission = vi.fn(async () => ({
      behavior: 'deny' as const,
      message: 'Bash command rejected.',
    }));
    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: ['Bash'],
        adapterId: 'unit-test-subagent',
        decidePermission,
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    codexStartSessionMock.mockImplementationOnce(async () => {
      const registeredHandler = codexOnServerRequestMock.mock.calls[0]?.[0] as
        | ((request: Record<string, unknown>) => void)
        | undefined;
      registeredHandler?.({
        id: 1,
        method: 'item/commandExecution/requestApproval',
        params: { command: "/bin/zsh -lc 'rm -rf /tmp/nope'" },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      return undefined;
    });

    const subagent = makeSubAgent({
      session: makeSession({ provider: 'codex' }),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: [],
      onAgentOutput: vi.fn(),
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    });

    await subagent.execute();

    expect(decidePermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'Bash',
        input: { command: 'rm -rf /tmp/nope' },
      }),
    );
    expect(codexSubmitClientResponseMock).toHaveBeenCalledWith(1, { decision: 'decline' });
  });

  it('fails fast for unsupported subagent providers instead of falling back to Claude', async () => {
    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: ['Bash'],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    const subagent = makeSubAgent({
      session: makeSession({ provider: 'opencode' }),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: [],
      onAgentOutput: vi.fn(),
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    });

    await expect(subagent.execute()).rejects.toThrow(
      'Subagent provider "opencode" is not supported',
    );
    expect(startSessionMock).not.toHaveBeenCalled();
    expect(codexStartSessionMock).not.toHaveBeenCalled();
  });

  it('reports run_completed with status=error when the SDK rejects, never silently swallowing failure', async () => {
    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    const onAgentOutput = vi.fn();

    startSessionMock.mockImplementationOnce(async () => {
      throw new Error('SDK boom');
    });

    const subagent = makeSubAgent({
      session: makeSession(),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: [],
      onAgentOutput,
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    });

    await expect(subagent.execute()).rejects.toThrow('SDK boom');

    const runCompletedCall = onAgentOutput.mock.calls.find((call) => {
      const envelope = call[0] as { event: { eventType: string } };
      return envelope.event.eventType === 'run_completed';
    });
    expect(runCompletedCall).toBeDefined();
    const envelope = runCompletedCall![0] as {
      event: { payload: Record<string, unknown> };
    };
    expect(envelope.event.payload['status']).toBe('error');
  });

  it('appends the registry-derived type-awareness section, not a static ontology constant', async () => {
    const sampleDefinition = {
      key: 'INITIATIVE',
      name: 'Initiative',
      description: 'A cross-cutting goal that spans multiple features and tasks.',
    } as unknown as WorkItemTypeDefinitionDto;
    readSessionStartContextMock.mockResolvedValue({
      workItemTypeDefinitions: [sampleDefinition],
      intentFirst: false,
      maturity: 'ESTABLISHED',
    });

    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    const subagent = makeSubAgent({
      session: makeSession(),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: [],
      onAgentOutput: vi.fn(),
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    });

    await subagent.execute();

    const startConfig = startSessionMock.mock.calls[0]![0] as unknown as {
      appendSystemPrompt?: string;
    };
    expect(startConfig.appendSystemPrompt).toContain(
      renderWorkItemTypeOntologyEntry(sampleDefinition),
    );
    expect(startConfig.appendSystemPrompt).toContain('**Initiative** (`INITIATIVE`)');
    expect(startConfig.appendSystemPrompt).not.toContain('Working with an informed user');
  });

  it('appends Intent first guidance to the subagent prompt only when the saved choice is on', async () => {
    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };
    const run = async (intentFirst: boolean): Promise<string | undefined> => {
      startSessionMock.mockClear();
      readSessionStartContextMock.mockResolvedValue({
        workItemTypeDefinitions: [],
        intentFirst,
        maturity: 'ESTABLISHED',
      });
      const subagent = makeSubAgent({
        session: makeSession(),
        handler: handler as unknown as PromptTypeHandler<unknown>,
        config: handler.subagentConfig!,
        payload: {},
        touchedFiles: [],
        onAgentOutput: vi.fn(),
        oauthClient: makeOauth(),
        logger: makeLogger(),
        cwd: '/tmp',
        priorReports: [],
      });
      await subagent.execute();
      return (startSessionMock.mock.calls[0]![0] as unknown as { appendSystemPrompt?: string })
        .appendSystemPrompt;
    };

    expect(await run(true)).toContain(intentFirstGuidance);
    expect(await run(false)).not.toContain('## Intent first');
  });

  it('appends Taking shape guidance to the subagent prompt only for that stage, with no maturity text', async () => {
    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };
    const run = async (maturity: ProjectMaturity): Promise<string | undefined> => {
      startSessionMock.mockClear();
      readSessionStartContextMock.mockResolvedValue({
        workItemTypeDefinitions: [],
        intentFirst: false,
        maturity,
      });
      const subagent = makeSubAgent({
        session: makeSession(),
        handler: handler as unknown as PromptTypeHandler<unknown>,
        config: handler.subagentConfig!,
        payload: {},
        touchedFiles: [],
        onAgentOutput: vi.fn(),
        oauthClient: makeOauth(),
        logger: makeLogger(),
        cwd: '/tmp',
        priorReports: [],
      });
      await subagent.execute();
      const launch = startSessionMock.mock.calls[0]![0] as unknown as {
        appendSystemPrompt?: string;
        prompt: string;
      };
      expect(launch.prompt).not.toContain('Maturity stage');
      return launch.appendSystemPrompt;
    };

    expect(await run('TAKING_SHAPE')).toContain(takingShapeGuidance);
    expect(await run('ESTABLISHED')).not.toContain('still taking shape');
  });

  it('emits processing_status phase transitions starting → thinking → writing → thinking as events arrive', async () => {
    const onAgentOutput = vi.fn();

    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    startSessionMock.mockImplementationOnce(async () => {
      const registeredHandler = onEventMock.mock.calls[0]?.[0] as
        | ((event: Record<string, unknown>) => void)
        | undefined;
      if (!registeredHandler) return undefined;

      // non-assistant → thinking
      registeredHandler({
        type: 'tool_use',
        session_id: 'sess-1',
        timestamp: new Date().toISOString(),
      });
      // assistant → writing
      registeredHandler({
        type: 'assistant',
        session_id: 'sess-1',
        timestamp: new Date().toISOString(),
        message: { content: [{ type: 'text', text: 'Hello' }] },
      });
      // non-assistant → back to thinking
      registeredHandler({
        type: 'tool_use',
        session_id: 'sess-1',
        timestamp: new Date().toISOString(),
      });

      return undefined;
    });

    const subagent = makeSubAgent({
      session: makeSession(),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: [],
      onAgentOutput,
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    });

    await subagent.execute();

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((p): p is string => typeof p === 'string');

    expect(phases).toEqual(['starting', 'thinking', 'writing', 'thinking']);
  });

  it('emits thinking when the first provider event is terminal', async () => {
    const onAgentOutput = vi.fn();

    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    startSessionMock.mockImplementationOnce(async () => {
      const registeredHandler = onEventMock.mock.calls[0]?.[0] as
        | ((event: Record<string, unknown>) => void)
        | undefined;
      if (!registeredHandler) return undefined;

      registeredHandler({
        type: 'result',
        session_id: 'sess-1',
        timestamp: new Date().toISOString(),
      });

      return undefined;
    });

    const subagent = makeSubAgent({
      session: makeSession(),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: [],
      onAgentOutput,
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    });

    await subagent.execute();

    const phases = (onAgentOutput.mock.calls as [{ event: Record<string, unknown> }][])
      .filter(([envelope]) => envelope.event['eventType'] === 'processing_status')
      .map(([envelope]) => (envelope.event['payload'] as Record<string, unknown>)['phase'])
      .filter((p): p is string => typeof p === 'string');

    expect(phases).toEqual(['starting', 'thinking']);
  });

  it('rejects loudly when the registry read fails, without starting the session', async () => {
    readSessionStartContextMock.mockRejectedValue(
      new Error('Cannot start session: failed to resolve an access token.'),
    );

    const handler: UserLaunchablePromptTypeHandler<TestPayload> = {
      id: 'commit',
      promptType: 'commit',
      service: 'required',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'subagent',
      providerSessionCountsForContext: false,
      reports: [],
      subagentConfig: {
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        adapterId: 'unit-test-subagent',
      },
      buildPrompt: () => 'SYSTEM',
      addUserMessage: defaultAddUserMessage,
    };

    const subagent = makeSubAgent({
      session: makeSession(),
      handler: handler as unknown as PromptTypeHandler<unknown>,
      config: handler.subagentConfig!,
      payload: {},
      touchedFiles: [],
      onAgentOutput: vi.fn(),
      oauthClient: makeOauth(),
      logger: makeLogger(),
      cwd: '/tmp',
      priorReports: [],
    });

    await expect(subagent.execute()).rejects.toThrow('Cannot start session');
    expect(startSessionMock).not.toHaveBeenCalled();
  });

  describe('context reading before disconnect', () => {
    const registry = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
    const executeRegistered = (
      promptType: LocalPromptType,
      provider: 'claude' | 'codex',
      logger = makeLogger(),
    ) => {
      const handler = registry.get(promptType);
      if (!handler?.subagentConfig)
        throw new Error(`Expected a registered ${promptType} subagent.`);
      return makeSubAgent({
        session: makeSession({ provider }),
        handler,
        config: handler.subagentConfig,
        payload: { startupInput: { task: { id: 'task-1', title: 'Task' } } },
        touchedFiles: [],
        onAgentOutput: vi.fn(),
        oauthClient: makeOauth(),
        logger,
        cwd: '/tmp',
        priorReports: [],
      }).execute();
    };

    it('reads the coding plan session before disconnecting it', async () => {
      claudeGetSessionIdMock.mockReturnValue('plan-session');
      claudeGetContextUsageMock.mockImplementation(async () => {
        expect(disconnectMock).not.toHaveBeenCalled();
        return { totalTokens: 7_000, maxTokens: 200_000 };
      });

      const result = await executeRegistered(LocalPromptType.StartupSession, 'claude');

      expect(result.contextReading).toEqual({
        providerSessionId: 'plan-session',
        usage: { totalTokens: 7_000, maxTokens: 200_000 },
      });
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it('reads a Codex coding plan session before disconnecting it', async () => {
      codexGetSessionIdMock.mockReturnValue('plan-thread');
      codexGetContextUsageMock.mockImplementation(() => {
        expect(codexDisconnectMock).not.toHaveBeenCalled();
        return { totalTokens: 5_000, maxTokens: 258_000 };
      });

      const result = await executeRegistered(LocalPromptType.StartupSession, 'codex');

      expect(result.contextReading).toEqual({
        providerSessionId: 'plan-thread',
        usage: { totalTokens: 5_000, maxTokens: 258_000 },
      });
    });

    it('takes no reading for a one-off Review session', async () => {
      claudeGetSessionIdMock.mockReturnValue('reviewer-session');

      const result = await executeRegistered(LocalPromptType.CodeReview, 'claude');

      expect(claudeGetContextUsageMock).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('contextReading');
    });

    it('logs a failed reading and still disconnects', async () => {
      const logger = makeLogger();
      claudeGetSessionIdMock.mockReturnValue('plan-session');
      claudeGetContextUsageMock.mockRejectedValue(new Error('context unavailable'));

      const result = await executeRegistered(LocalPromptType.StartupSession, 'claude', logger);

      expect(result.contextReading).toBeNull();
      expect(disconnectMock).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        'local.subagent.context_usage.read_failed',
        expect.objectContaining({ providerSessionId: 'plan-session' }),
      );
    });
  });

  describe('token budget', () => {
    const budgetHandler: PromptTypeHandler<unknown> = {
      id: 'budgeted-child',
      promptType: LocalPromptType.ProjectReport,
      service: 'optional',
      launchEntity: 'none',
      implementationReadiness: 'none',
      runnerKind: 'provider_session',
      providerSessionCountsForContext: false,
      reports: [],
      childConfig: {
        adapterId: 'budgeted-child',
        mcpAllowedTools: [],
        builtinAllowedTools: [],
        submissionTools: 'none',
        codexSandboxMode: 'read-only',
      },
      buildPrompt: () => 'BUDGETED',
    };
    const launch = (provider: 'claude' | 'codex', tokenBudget?: number) =>
      makeSubAgent({
        session: makeSession({ provider }),
        handler: budgetHandler,
        config: budgetHandler.childConfig!,
        payload: {},
        touchedFiles: [],
        onAgentOutput: vi.fn(),
        oauthClient: makeOauth(),
        logger: makeLogger(),
        cwd: '/tmp',
        priorReports: [],
        ...(tokenBudget !== undefined ? { tokenBudget } : {}),
      }).execute();
    const assistant = (id: string, text: string, input: number, output: number) => ({
      type: 'assistant',
      message: {
        id,
        content: [{ type: 'text', text }],
        usage: { input_tokens: input, cache_read_input_tokens: input, output_tokens: output },
      },
    });

    it('aborts a Claude child once provider-reported usage passes its budget and returns partial output', async () => {
      let signal: AbortSignal | undefined;
      startSessionMock.mockImplementationOnce(async (...args: unknown[]) => {
        signal = (args[1] as { signal?: AbortSignal } | undefined)?.signal;
        const emit = onEventMock.mock.calls[0]?.[0] as (event: Record<string, unknown>) => void;
        emit(assistant('msg-1', 'First half', 100, 50));
        // A streamed copy of the same message must not be counted twice.
        emit(assistant('msg-1', 'First half', 100, 50));
        expect(signal?.aborted).toBe(false);
        emit(assistant('msg-2', 'Second half', 200, 50));
        expect(signal?.aborted).toBe(true);
        throw new Error('aborted');
      });
      const result = await launch('claude', 400);
      expect(result).toMatchObject({
        assistantCompleted: false,
        outputText: 'Second half',
        budgetExhausted: true,
      });
    });

    it('aborts a Codex child on cumulative thread usage', async () => {
      codexStartSessionMock.mockImplementationOnce(async (...args: unknown[]) => {
        const signal = (args[1] as { signal?: AbortSignal } | undefined)?.signal;
        const report = codexOnTokenUsageMock.mock.calls[0]?.[0] as (usage: unknown) => void;
        report({ inputTokens: 100, cacheReadInputTokens: 100, outputTokens: 50 });
        expect(signal?.aborted).toBe(false);
        report({ inputTokens: 300, cacheReadInputTokens: 100, outputTokens: 50 });
        expect(signal?.aborted).toBe(true);
        throw new Error('aborted');
      });
      await expect(launch('codex', 400)).resolves.toMatchObject({ budgetExhausted: true });
    });

    it('measures usage without stopping the child when there is no budget', async () => {
      startSessionMock.mockImplementationOnce(async () => {
        throw new Error('provider failed');
      });
      await expect(launch('claude')).rejects.toThrow('provider failed');
      codexStartSessionMock.mockImplementationOnce(async (...args: unknown[]) => {
        const signal = (args[1] as { signal?: AbortSignal } | undefined)?.signal;
        const report = codexOnTokenUsageMock.mock.calls[0]?.[0] as (usage: unknown) => void;
        report({ inputTokens: 1_000_000, cacheReadInputTokens: 0, outputTokens: 50 });
        expect(signal?.aborted ?? false).toBe(false);
      });
      await expect(launch('codex')).resolves.toMatchObject({
        usage: { inputTokens: 1_000_000, outputTokens: 50 },
      });
    });
  });
});

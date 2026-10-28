import { createFirstTurnPromptRunState, resolvePrompt } from '../../run/resolve-prompt';
import { SessionRoleGuidance } from '../session-role-guidance/session-role-guidance';
import {
  buildEvalAttemptSession,
  buildEvalTargetPayload,
  resolveEvalTargetEntity,
} from './eval-targets';
import { renderCodingResearchMemo } from '../prompts/coding-research-memo';
import { WorkflowAboutReader } from '../submission-tools/search-messages-proxy';
import type { CodingResearchReportPayload, EvalCaseTarget } from '../../shared/api/generated';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgenticSession } from '../../session/types';
import { ChildAgentLauncher } from '../../run/child-agent-launcher';
import {
  createRunTestOAuthClient,
  createTestRepoMappingStore,
  createTestRun,
  createTestSessionRunnerFacade,
  createTestRunChangedFilesReader,
} from '../../run/run.test-support';
import { RunnerPicker } from '../../run/runners/pick-runner';
import { LocalAgentEndpoint } from '../../server/local-base-url';
import { NOOP_LOGGER } from '../../server/logger';
import { PromptTypeRegistry } from '../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../prompt-type-registry.test-support';
import { createPromptTypeHandlerTestDeps } from '../prompt-type-handler.test-support';
import { SubmissionToolRegistry } from '../submission-tools/registry';
import { CreateReportProxy } from '../submission-tools/create-report-proxy';
import { ReportEmissionEvents } from '../submission-tools/report-emission-events';
import { createPromptTypeHandlerTestAuth } from '../prompt-type-handler.test-support';
import { childPlatformMcpProxies } from '../platform-mcp-proxy/child-proxy-registry';
import { PlatformMcpForwarder } from '../platform-mcp-proxy/forwarder';
import { ConversationsApi, ReportsApi, type PostMessageRequest } from '../../shared/api/generated';
import type { LocalRunEvalPromptPayload } from '../../shared/agent-bridge-contract/generated';

const sdk = vi.hoisted(() => ({
  start:
    vi.fn<
      (
        config: Record<string, unknown>,
        emit: (event: Record<string, unknown>) => void,
        provider: string,
      ) => Promise<void>
    >(),
}));
vi.mock('../../agent-runtime/index', async (original) => ({
  ...(await original<object>()),
  ClaudeCodeSdkClient: class {
    private emit: (event: Record<string, unknown>) => void = () => {};
    onEvent(emit: typeof this.emit) {
      this.emit = emit;
    }
    onPermissionRequest() {}
    getSessionId() {
      return 'claude-child';
    }
    getContextUsage() {
      return {};
    }
    disconnect() {
      return Promise.resolve();
    }
    startSession(config: Record<string, unknown>) {
      return sdk.start(config, this.emit, 'claude');
    }
  },
  CodexSdkClient: class {
    private emit: (event: Record<string, unknown>) => void = () => {};
    onEvent(emit: typeof this.emit) {
      this.emit = emit;
    }
    onServerRequest() {}
    onTokenUsage() {}
    getSessionId() {
      return 'codex-child';
    }
    getContextUsage() {
      return {};
    }
    disconnect() {
      return Promise.resolve();
    }
    startSession(config: Record<string, unknown>) {
      return sdk.start(config, this.emit, 'codex');
    }
  },
}));
vi.mock('../mcp-server-config', async (original) => ({
  ...(await original<object>()),
  buildMcpServerConfig: async () => ({ mcpServers: {}, allowedTools: [] }),
}));
vi.mock('../prompts/session-start-context', () => ({
  readSessionStartContext: async () => ({
    workItemTypeDefinitions: [],
    intentFirst: false,
    maturity: 'ESTABLISHED',
  }),
}));

afterEach(() => vi.restoreAllMocks());

describe('graph-only eval execution through the real child runtime', () => {
  it.each([
    { provider: 'claude' as const, startupFailure: false },
    { provider: 'codex' as const, startupFailure: false },
    { provider: 'claude' as const, startupFailure: true },
  ])(
    'executes isolated research on $provider or records its startup failure ($startupFailure)',
    async ({ provider, startupFailure }) => {
      const organizationId = '11111111-1111-4111-8111-111111111111';
      const projectId = '22222222-2222-4222-8222-222222222222';
      const attemptId = '33333333-3333-4333-8333-333333333333';
      const targetSessionId = '44444444-4444-4444-8444-444444444444';
      const targetConversationId = '55555555-5555-4555-8555-555555555555';
      const messages: PostMessageRequest[] = [];
      vi.spyOn(ConversationsApi.prototype, 'postMessage').mockImplementation(
        async (request, options) => {
          expect(options?.headers).toMatchObject({ 'X-Agent-Session-ID': targetSessionId });
          expect(request.postMessageRequest.conversationId).toBe(targetConversationId);
          messages.push(structuredClone(request.postMessageRequest));
          return { data: { data: { id: `message-${messages.length}` } } } as never;
        },
      );
      const evalRunId = '66666666-6666-4666-8666-666666666666';
      const focalItemId = '77777777-7777-4777-8777-777777777777';
      const token = `header.${Buffer.from(JSON.stringify({ organizationId })).toString('base64url')}.signature`;
      const auth = createPromptTypeHandlerTestAuth(token);
      const reportRequests: RequestInit[] = [];
      const reportProxy = new CreateReportProxy({
        auth,
        apiBaseUrl: 'https://api.test/api/v1',
        reportEmissionEvents: new ReportEmissionEvents(),
        fetchImpl: async (_url, init) => {
          reportRequests.push(init!);
          return new Response(
            JSON.stringify({ data: { id: 'research-report', mention: 'research report' } }),
            { status: 201 },
          );
        },
      });
      const registry = new PromptTypeRegistry({
        ...PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES,
        createReportProxy: reportProxy,
      });
      const endpoint = new LocalAgentEndpoint();
      endpoint.set('http://local.test');
      const launcher = new ChildAgentLauncher({
        handlerDeps: createPromptTypeHandlerTestDeps(),
        promptTypeRegistry: registry,
        repoStore: createTestRepoMappingStore(),
        oauthClient: createRunTestOAuthClient({ success: true, data: token }),
        submissionToolRegistry: new SubmissionToolRegistry(),
        localAgentEndpoint: endpoint,
        logger: NOOP_LOGGER,
      });
      const research = {
        frame: { focalId: focalItemId, nodes: [] },
        analysis: 'Grounded research result.',
        summary: 'The research completed.',
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
        readinessEvidence: [],
      };
      const forwarder = new PlatformMcpForwarder({
        oauthClient: createRunTestOAuthClient({ success: true, data: token }),
        logger: NOOP_LOGGER,
        fetchImpl: async (_url, init) => {
          const request = JSON.parse(String(init?.body));
          return new Response(
            JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { tools: [] } }),
          );
        },
      });
      const assessment = {
        checkResults: [],
        recognition: { recognized: true, explanation: 'Grounded.' },
        quality: [],
      };
      const emitCompletion = (
        emit: (event: Record<string, unknown>) => void,
        runtime: string,
        text: string,
      ) => {
        if (runtime === 'codex') {
          emit({ method: 'item/completed', params: { item: { type: 'agentMessage', text } } });
          emit({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
        } else {
          emit({ type: 'assistant', message: { id: 'answer', content: [{ type: 'text', text }] } });
          emit({ type: 'result', subtype: 'success' });
        }
      };
      sdk.start.mockReset();
      sdk.start.mockImplementation(async (config, emit, runtime) => {
        const prompt = String(config['prompt']);
        if (prompt.includes('You are judging one attempt')) {
          expect(prompt).toContain('SECRET-GRADING');
          expect(prompt).toContain('A question about pairing.');
          expect(prompt).toContain('Research the pairing flow.');
          expect(prompt).toContain(research.analysis);
          emitCompletion(emit, runtime, JSON.stringify(assessment));
          return;
        }
        if (prompt.includes('Inspect the pairing records independently.')) {
          expect(prompt).not.toContain('SECRET-GRADING');
          expect(config['model']).toBe('selected-target');
          expect(runtime).toBe(provider);
          emitCompletion(emit, runtime, 'Independent graph evidence.');
          return;
        }
        expect(prompt).toContain('CURRENT ENTITY CONTEXT');
        expect(prompt).toContain('Research the pairing flow.');
        expect(prompt).not.toContain('A question about pairing.');
        expect(prompt).not.toContain('Related items:');
        expect(prompt).not.toContain('Focal item:');
        expect(prompt).not.toContain('SECRET-GRADING');
        expect(prompt).toContain('heyhey-submission-tools');
        expect(config['model']).toBe('selected-target');
        const servers = (
          runtime === 'codex'
            ? (config['config'] as Record<string, unknown>)['mcp_servers']
            : config['mcpServers']
        ) as Record<string, { url: string }>;
        const url = new URL(servers['heyhey-submission-tools']!.url);
        const [, , , runId, turnId, mountToken] = url.pathname.split('/').map(decodeURIComponent);
        const proxy = childPlatformMcpProxies.find({
          runId: runId!,
          turnId: turnId!,
          token: mountToken!,
        });
        expect(proxy).not.toBeNull();
        const list = await proxy!.handleJsonRpc(
          { jsonrpc: '2.0', id: 1, method: 'tools/list' },
          forwarder,
        );
        expect(JSON.stringify(list)).toContain('create_coding_research');
        expect(JSON.stringify(list)).toContain('run_subagents');
        const children = await proxy!.handleJsonRpc(
          {
            jsonrpc: '2.0',
            id: 3,
            method: 'tools/call',
            params: {
              name: 'run_subagents',
              arguments: { objectives: ['Inspect the pairing records independently.'] },
            },
          },
          forwarder,
        );
        expect(JSON.stringify(children)).toContain('Independent graph evidence.');
        const submitted = await proxy!.handleJsonRpc(
          {
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'create_coding_research', arguments: research },
          },
          forwarder,
        );
        expect(JSON.stringify(submitted)).not.toContain('isError');
        emitCompletion(emit, runtime, 'Research submitted.');
      });
      const reports = new Map<string, Record<string, unknown>>([
        [evalRunId, { reportType: 'EVAL_RUN', status: 'QUEUED' }],
        [attemptId, { reportType: 'EVAL_ATTEMPT', status: 'QUEUED', measurements: [] }],
      ]);
      vi.spyOn(ReportsApi.prototype, 'getReport').mockImplementation(
        async ({ reportId }) =>
          ({ data: { data: { id: reportId, payload: reports.get(reportId) } } }) as never,
      );
      vi.spyOn(ReportsApi.prototype, 'updateReport').mockImplementation(
        async ({ reportId, updateReportDto }) => {
          reports.set(reportId, updateReportDto.payload as unknown as Record<string, unknown>);
          return {} as never;
        },
      );
      const payload: LocalRunEvalPromptPayload = {
        userMessage: 'Run the approved cases.',
        evalRunId,
        settings: { maxConcurrentAttempts: 3 },
        judgeSetup: { provider: 'claude', model: 'selected-judge' },
        attempts: [
          {
            attemptId,
            targetSessionId,
            targetConversationId,
            configuration: {
              id: '88888888-8888-4888-8888-888888888888',
              target: { provider, model: 'selected-target', reasoningEffort: 'low' },
            },
            caseInput: {
              id: '99999999-9999-4999-8999-999999999999',
              evalCaseId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
              title: 'Pairing',
              target: {
                situation: 'A question about pairing.',
                focalItemId,
                focalItemType: 'TASK',
                supportingItemIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
                initiatingRequest: 'Research the pairing flow.',
                targetHandler: 'project_assistant',
                consumerHandler: 'entity_conversation',
              },
              grading: { checks: [], rubric: [], expectations: 'SECRET-GRADING' },
            },
          },
        ],
      };
      const deps = createPromptTypeHandlerTestDeps({
        auth,
        childAgentLauncher: launcher,
        fetchImpl: async () => new Response(JSON.stringify({ data: [] })),
      });
      const resolveStartup = vi.mocked(deps.startupPromptInput.resolve).getMockImplementation()!;
      vi.spyOn(deps.startupPromptInput, 'resolve').mockImplementation(async (request) => {
        if (startupFailure) throw new Error('Focal entity unavailable.');
        const startup = await resolveStartup(request);
        return {
          ...startup,
          loadedEntityContext: {
            ...startup.loadedEntityContext,
            entity: { id: focalItemId, name: 'Evaluation', type: 'EVAL', source: 'USER' } as never,
          },
        };
      });
      const session = {
        agentic_session_id: 'coordinator',
        provider,
        services: [],
        contextMetadata: {
          organizationId,
          projectId,
          fileReferences: { resolved: [], unresolved: [] },
          userComments: [],
          capturedAt: new Date().toISOString(),
        },
      } as unknown as AgenticSession;
      const invalidAttemptId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
      if (!startupFailure) {
        const valid = payload.attempts[0]!;
        payload.attempts.unshift({
          ...valid,
          attemptId: invalidAttemptId,
          caseInput: {
            ...valid.caseInput,
            target: {
              situation: valid.caseInput.target.situation,
              focalItemId,
              focalItemType: 'TASK',
              initiatingRequest: valid.caseInput.target.initiatingRequest,
              targetHandler: 'project_assistant',
            },
          },
        });
        reports.set(invalidAttemptId, {
          reportType: 'EVAL_ATTEMPT',
          status: 'QUEUED',
          measurements: [],
        });
      }
      const run = createTestRun(
        {
          runId: session.agentic_session_id,
          session: {
            ...session,
            entity: { entityType: 'TASK', entityId: focalItemId },
            provider_session_id: 'pending_eval',
            provider_conversation_id: null,
            conversationId: 'coordinator-conversation',
            promptType: 'run_eval',
            events: [],
          },
          organizationId,
          projectId,
          conversationId: 'coordinator-conversation',
          provider,
        },
        {
          promptTypeRegistry: registry,
          handlerDeps: deps,
          runnerPicker: new RunnerPicker({
            sessionRunnerFacade: createTestSessionRunnerFacade(),
            oauthClient: createRunTestOAuthClient({ success: true, data: token }),
            logger: NOOP_LOGGER,
            runChangedFilesReader: createTestRunChangedFilesReader(),
            submissionToolRegistry: new SubmissionToolRegistry(),
            localAgentEndpoint: endpoint,
            childAgentLauncher: launcher,
          }),
        },
      );
      try {
        await run.handleMessage({
          promptType: 'run_eval',
          payload,
          references: { resolved: [], unresolved: [] },
          triggerContext: null,
        });
        await run.awaitIdle();
      } finally {
        run.cleanup();
      }
      if (startupFailure) {
        expect(messages).toHaveLength(0);
        expect(sdk.start).not.toHaveBeenCalled();
        expect(reports.get(attemptId)).toMatchObject({
          status: 'ERROR',
          error: { code: 'EVAL_STARTUP_FAILED' },
        });
        expect(reports.get(evalRunId)).toMatchObject({ status: 'FINISHED' });
        return;
      }
      expect(messages[0]?.data).toMatchObject({
        title: 'Starting Prompt',
        response: 'Research the pairing flow.',
        ragEnabled: false,
      });
      expect(JSON.stringify(messages)).not.toContain('SECRET-GRADING');
      expect(messages.every((message) => message.parentMessageId === null)).toBe(true);
      expect(messages).toHaveLength(2);
      expect(messages[1]?.data).toMatchObject({
        response: 'Research submitted.',
        ragEnabled: false,
      });
      expect(reports.get(invalidAttemptId)).toMatchObject({
        status: 'ERROR',
        error: { message: expect.stringContaining('must name its consumer handler') },
      });
      expect(reports.get(attemptId)?.['error']).toBeUndefined();
      expect(sdk.start).toHaveBeenCalledTimes(3);
      expect(reportRequests).toHaveLength(1);
      expect(reportRequests[0]!.headers).toMatchObject({
        'X-Agent-Session-ID': targetSessionId,
        'X-Conversation-ID': targetConversationId,
      });
      expect(reports.get(evalRunId)).toMatchObject({ status: 'FINISHED' });
      expect(reports.get(attemptId)).toMatchObject({
        status: 'COMPLETED',
        summary: { outputText: expect.stringContaining(research.analysis) },
        measurements: [
          { scope: 'TARGET_PREPARATION' },
          { scope: 'TARGET_HANDLER' },
          { scope: 'JUDGE' },
        ],
      });
    },
  );
});

describe('eval first-turn fidelity', () => {
  it.each(['project_assistant', 'entity_conversation', 'entity_conversation_opt_out'] as const)(
    'delivers the real first-turn prompt for %s to the provider',
    async (scenario) => {
      const focal = {
        entityType: 'PROJECT',
        entityId: '77777777-7777-4777-8777-777777777777',
      } as const;
      const coordinatorSession = {
        agentic_session_id: 'target',
        conversationId: 'target-conversation',
        provider: 'claude',
        services: [],
        entity: focal,
        contextMetadata: { organizationId: 'organization', projectId: 'project' },
      } as unknown as AgenticSession;
      const message = 'Explain this feature and what should happen next.';
      const caseTarget = {
        situation: 'The feature is under review.',
        focalItemId: focal.entityId,
        focalItemType: focal.entityType,
        supportingItemIds: ['cccccccc-cccc-4ccc-8ccc-cccccccccccc'],
        initiatingRequest: message,
        ...(scenario === 'project_assistant'
          ? { targetHandler: 'project_assistant', consumerHandler: 'entity_conversation' }
          : { targetHandler: 'entity_conversation' }),
      } satisfies EvalCaseTarget;
      const session = buildEvalAttemptSession(
        coordinatorSession,
        {
          provider: 'claude',
          model: 'selected-target',
          handlerConfig: {
            projectAssistant: { enabled: scenario !== 'entity_conversation_opt_out' },
          },
        },
        caseTarget,
      );
      const token = `header.${Buffer.from(JSON.stringify({ organizationId: 'organization' })).toString('base64url')}.signature`;
      const deps = createPromptTypeHandlerTestDeps({
        auth: createPromptTypeHandlerTestAuth(token),
        fetchImpl: async () => new Response(JSON.stringify({ data: [] })),
      });
      vi.spyOn(WorkflowAboutReader.prototype, 'read').mockResolvedValue({
        workflowAboutId: focal.entityId,
        workflowAboutType: 'project',
      });
      const registry = new PromptTypeRegistry({
        ...PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES,
        createReportProxy: new CreateReportProxy({
          auth: deps.auth,
          apiBaseUrl: deps.apiBaseUrl,
          reportEmissionEvents: new ReportEmissionEvents(),
          fetchImpl: async () =>
            new Response(JSON.stringify({ data: { id: 'report', mention: 'research' } }), {
              status: 201,
            }),
        }),
      });
      const handler = registry.get(caseTarget.targetHandler)!;
      const payload = buildEvalTargetPayload(caseTarget, {
        session,
        entity: resolveEvalTargetEntity(caseTarget),
        resolveHandler: (id) => registry.getChildHandler(id),
        logger: deps.logger,
      });
      if ('userMessage' in payload) {
        expect(payload.userMessage).toBe(message);
      }
      if ('entity' in payload) {
        expect(payload.entity).toEqual(focal);
      }
      const searchTarget = {
        situation: caseTarget.situation,
        supportingItemIds: caseTarget.supportingItemIds,
        initiatingRequest: message,
        targetHandler: 'agent_search',
      } satisfies EvalCaseTarget;
      expect(resolveEvalTargetEntity(searchTarget)).toBeNull();
      expect(
        buildEvalTargetPayload(searchTarget, {
          session,
          entity: null,
          resolveHandler: (id) => registry.getChildHandler(id),
          logger: deps.logger,
        }),
      ).toEqual({ payloadVersion: 1, userMessage: message });
      const research: CodingResearchReportPayload = {
        reportType: 'CODING_RESEARCH',
        frame: { focalId: focal.entityId, nodes: [] },
        analysis: 'Grounded research handed to the conversation.',
        summary: 'Research completed.',
        provenance: { discoveryCalls: [], edgesTraversed: [] },
        updates: [],
        readinessEvidence: [],
      };
      const expectedMemos =
        scenario === 'entity_conversation'
          ? [
              {
                source: 'project_assistant',
                content: renderCodingResearchMemo(research),
                writtenAt: '2026-01-01',
              },
            ]
          : [];
      const ordinary = await resolvePrompt({
        handler,
        run: session,
        runState: { ...createFirstTurnPromptRunState(), memos: expectedMemos },
        input: {
          promptType: handler.promptType,
          payload,
          references: { resolved: [], unresolved: [] },
          triggerContext: null,
        },
        handlerDeps: deps,
        turnId: 'real-turn',
        abortSignal: () => undefined,
        recentUserReplies: [],
        triggerParentMessageId: null,
        providerSessionDecision: 'first-turn-mint',
      });
      const role = await new SessionRoleGuidance(deps).prepare({
        session,
        handler,
        payload: ordinary.preparedPayload ?? payload,
        fresh: true,
        ...(ordinary.startupPromptInput ? { startup: ordinary.startupPromptInput } : {}),
        definitions: [],
      });
      const expected = [
        role.text,
        [ordinary.startupPromptInput?.renderedInput, ordinary.resolvedPrompt]
          .filter(Boolean)
          .join('\n\n---\n\n'),
      ]
        .filter(Boolean)
        .join('\n\n');
      const endpoint = new LocalAgentEndpoint();
      endpoint.set('http://local.test');
      const launcher = new ChildAgentLauncher({
        handlerDeps: deps,
        promptTypeRegistry: registry,
        repoStore: createTestRepoMappingStore(),
        oauthClient: createRunTestOAuthClient({ success: true, data: 'token' }),
        submissionToolRegistry: new SubmissionToolRegistry(),
        localAgentEndpoint: endpoint,
        logger: NOOP_LOGGER,
      });
      const forwarder = new PlatformMcpForwarder({
        oauthClient: createRunTestOAuthClient({ success: true, data: 'token' }),
        logger: NOOP_LOGGER,
      });
      let received: string | undefined;
      let researchCalls = 0;
      sdk.start.mockReset();
      sdk.start.mockImplementation(async (config, emit) => {
        const servers = config['mcpServers'] as Record<string, { url: string }>;
        const researchServer = servers['heyhey-submission-tools'];
        if (researchServer) {
          researchCalls += 1;
          const url = new URL(researchServer.url);
          const [, , , runId, turnId, token] = url.pathname.split('/').map(decodeURIComponent);
          const proxy = childPlatformMcpProxies.find({
            runId: runId!,
            turnId: turnId!,
            token: token!,
          });
          const result = await proxy!.handleJsonRpc(
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: {
                name: 'create_coding_research',
                arguments: JSON.parse(
                  JSON.stringify({
                    frame: research.frame,
                    analysis: research.analysis,
                    summary: research.summary,
                    provenance: research.provenance,
                    updates: research.updates,
                    readinessEvidence: research.readinessEvidence,
                  }),
                ),
              },
            },
            forwarder,
          );
          expect(JSON.stringify(result)).not.toContain('isError');
        }
        if (scenario === 'project_assistant' || !researchServer) {
          received = String(config['prompt']);
        }
        emit({
          type: 'assistant',
          message: { id: 'answer', content: [{ type: 'text', text: 'Completed.' }] },
        });
        emit({ type: 'result', subtype: 'success' });
      });
      const result = await launcher.launch({
        parentSession: {
          ...session,
          memos: [
            {
              source: 'coordinator',
              content: 'SECRET COORDINATOR CONTEXT',
              writtenAt: '2026-01-01',
            },
          ],
          sessionContext: {
            sessionRoleGuidance: { references: [], deliveries: {}, hasResearchFrame: true },
          },
        },
        handler,
        payload,
        entity: focal,
        handlerDeps: deps,
        signal: new AbortController().signal,
        evalExecution: {
          attemptId: 'attempt',
          targetSessionId: 'target',
          targetConversationId: 'target-conversation',
        },
      });
      expect(result.assistantCompleted).toBe(true);
      // Claude's platform system instructions occupy a separate system slot;
      // this is the complete per-turn prompt passed to the provider, byte for byte.
      expect(received).toBe(expected);
      expect(researchCalls).toBe(scenario === 'entity_conversation_opt_out' ? 0 : 1);
    },
  );
});

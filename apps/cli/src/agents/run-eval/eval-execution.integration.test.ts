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
import { ReportsApi } from '../../shared/api/generated';
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
                initiatingRequest: 'Research the pairing flow.',
                targetHandler:
                  "Project Assistant research, run with the request above as the user's prompt and Pairing as the focal item.",
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
            target: { ...valid.caseInput.target, targetHandler: 'unsupported_handler' },
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
        expect(sdk.start).not.toHaveBeenCalled();
        expect(reports.get(attemptId)).toMatchObject({
          status: 'ERROR',
          error: { code: 'EVAL_STARTUP_FAILED' },
        });
        expect(reports.get(evalRunId)).toMatchObject({ status: 'FINISHED' });
        return;
      }
      expect(reports.get(invalidAttemptId)).toMatchObject({
        status: 'ERROR',
        error: { message: expect.stringContaining('cannot be evaluated yet') },
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

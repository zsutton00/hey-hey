import { EvalAttemptExecution } from '../agents/run-eval/eval-attempt-execution';
import type { AgenticSession } from '../session/types';
import type { EvalRecordedAttempt } from '../shared/api/generated/api';
import { TasksApi, EntityContextApi } from '../shared/api/generated';
import { z } from 'zod';
import { AgentStartupPromptInput } from '../commands/agent-startup-prompt-input';
import { EntityContextLoader } from '../agents/entity-context/entity-context-loader';
import type { MessagePosterApiClient } from '../run/types';
import { createTestMonitorProjectContext } from '../run/run.test-support';
import { createPromptTypeHandlerTestDeps } from '../agents/prompt-type-handler.test-support';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import type { LocalCreateRunRequest } from '../shared/agent-bridge-contract/runtime-types';
import { createRunArgsFromSession } from '../run/run-activation';
import { buildRunMcpSessionContext } from '../run/run';
import { MessagePoster } from '../run/message-poster';
import { NOOP_LOGGER } from './logger';
/** @vitest-environment node */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../agents/providers/session-runner-config', () => ({
  loadAgentSessionRunnerConfig: vi
    .fn()
    .mockResolvedValue({ sourcePath: '/tmp/cfg.json', warnings: [] }),
  resolveAgentInvocationConfigPath: vi.fn(() => '/tmp/agent-invocation.json'),
}));

import { ProjectModeBundleMaterializer } from '../agents/project-mode';
import { RunStore } from '../run-store/run-store';
import { createTestRepoMappingStore } from '../run/run.test-support';
import type { StartRunTriggerPayload } from './conversation-dispatch/trigger-payload-schemas';
import { createTestOAuthClient } from './__tests__/helpers/test-oauth-client';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './__tests__/helpers/test-run-registry';
import { LocalAgentService } from './local-agent-service';
import { toCreateRunRequest } from './trigger-verification/dispatch';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';

// Creation and output boundaries use ordinary Runs with persisted metadata.

const AGENT_SESSION_ID = '3a8dd90c-f85e-4efc-a9c0-6fb3c58f0741';
const CONVERSATION_ID = 'conv-provider-switch';
const ENTITY = { entityType: 'TASK' as const, entityId: '9cb94de8-c331-41aa-911e-1c50508a302f' };

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const storeAt = (baseDir: string): RunStore => {
  const runsDir = path.join(baseDir, 'runs');
  return new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
};

const makeHarness = async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-provider-switch-'));
  tempDirs.push(baseDir);
  const runStore = storeAt(baseDir);
  await runStore.initialize();
  const runPrompt = vi.fn(() =>
    Promise.resolve({ providerSessionId: null, providerConversationId: null, errorCount: 0 }),
  );
  const projectModeBundleMaterializer = new ProjectModeBundleMaterializer();
  const postMessage = vi.fn(() => Promise.resolve({ id: 'message' }));
  const updateMessage = vi.fn<MessagePosterApiClient['updateMessage']>(() => Promise.resolve({}));
  const wiring = createTestRunRegistryWiring({
    handlerDeps: createPromptTypeHandlerTestDeps({
      runStore,
      fetchImpl: () => Promise.resolve(Response.json({ data: [] })),
    }),
    poster: new MessagePoster({
      apiClient: { postMessage, updateMessage },
      logger: NOOP_LOGGER,
      dataDir: baseDir,
    }),
    runStore,
    sessionRunner: { runPrompt, resumeSession: runPrompt },
    oauthClient: createTestOAuthClient({
      getAccessToken: vi.fn(() => Promise.resolve({ success: true as const, data: 'test-token' })),
    }),
    projectModeBundleMaterializer,
  });
  const service = new LocalAgentService({
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
    runStore,
    repoStore: createTestRepoMappingStore(),
    runRegistry: wiring.runRegistry,
    promptTypeRegistry: wiring.promptTypeRegistry,
    workflowsApi: wiring.workflowsApi,
    messagesApi: wiring.messagesApi,
    projectModeBundleMaterializer,
  });
  return { baseDir, runStore, service, runPrompt, wiring, postMessage, updateMessage };
};

const startRunPayload = (overrides: Partial<StartRunTriggerPayload>): StartRunTriggerPayload =>
  ({
    agentSessionId: AGENT_SESSION_ID,
    workflowName: 'coding_session',
    provider: 'claude',
    model: 'claude-test',
    contextMetadata: {
      capturedAt: '2026-10-06T00:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: AGENT_SESSION_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
    payload: { promptType: 'workflow_kickoff', entity: ENTITY, userMessage: 'Start' },
    ...overrides,
  }) as unknown as StartRunTriggerPayload;

describe('ordinary inert Run creation', () => {
  it('persists inertness, starts once, refuses follow-ups and conflicting reuse', async () => {
    const { service, runStore, runPrompt, wiring } = await makeHarness();
    const request = {
      ...toCreateRunRequest(startRunPayload({}), CONVERSATION_ID),
      inert: true,
      payload: {
        promptType: 'agent_search',
        payloadVersion: 1,
        entity: ENTITY,
        userMessage: 'Find project context',
      },
    } satisfies LocalCreateRunRequest;
    const result = await service.createRun(request);
    expect(result.status).toBe('started');
    await wiring.runRegistry.get(AGENT_SESSION_ID)?.awaitIdle();
    expect((await runStore.getRun(AGENT_SESSION_ID))?.inert).toBe(true);
    expect(runPrompt).toHaveBeenCalledOnce();
    await expect(service.createRun({ ...request, inert: false })).rejects.toMatchObject({
      statusCode: 409,
    });
    const stored = await runStore.getRun(AGENT_SESSION_ID);
    if (!stored) {
      throw new Error('Created Run is missing');
    }
    expect(buildRunMcpSessionContext(stored).inert).toBe(true);
    expect(runPrompt).toHaveBeenCalledWith(expect.objectContaining({ readOnlyFilesystem: true }));
    const restored = createTestRunRegistryWiring({ runStore }).runRegistry.create(
      createRunArgsFromSession(stored),
    );
    await expect(
      restored.handleMessage({
        promptType: LocalPromptType.AgentSearch,
        triggerContext: null,
        references: { resolved: [], unresolved: [] },
        payload: request.payload,
      }),
    ).rejects.toThrow('Inert Runs refuse');
    const run = wiring.runRegistry.get(AGENT_SESSION_ID);
    if (!run) {
      throw new Error('Active Run is missing');
    }
    await expect(
      run.handleMessage({
        promptType: LocalPromptType.AgentSearch,
        triggerContext: null,
        references: { resolved: [], unresolved: [] },
        payload: request.payload,
      }),
    ).rejects.toThrow('Inert Runs refuse');
  });

  it('refuses an unsupported provider before persistence', async () => {
    const { service, runStore } = await makeHarness();
    await expect(
      service.createRun({
        ...toCreateRunRequest(startRunPayload({ provider: 'opencode' }), CONVERSATION_ID),
        inert: true,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(await runStore.getRun(AGENT_SESSION_ID)).toBeNull();
  });
});

// Exercise the production provider runner; only the SDK and remote APIs are replaced.
const provider = vi.hoisted(() => ({
  start:
    vi.fn<
      (
        config: Record<string, unknown>,
        emit: (event: Record<string, unknown>) => void,
        permission: (name: string, input: unknown) => Promise<unknown>,
      ) => Promise<void>
    >(),
}));
vi.mock('../agent-runtime/index', async (original) => ({
  ...(await original<object>()),
  ClaudeCodeSdkClient: class {
    private emit: (event: Record<string, unknown>) => void = () => undefined;
    private permission: (name: string, input: unknown) => Promise<unknown> = () =>
      Promise.resolve({});
    onEvent(handler: typeof this.emit | null) {
      this.emit = handler ?? (() => undefined);
    }
    onPermissionRequest(handler: typeof this.permission) {
      this.permission = handler;
    }
    getSessionId() {
      return null;
    }
    getContextUsage() {
      return {};
    }
    disconnect() {
      return Promise.resolve();
    }
    async startSession(config: Record<string, unknown>) {
      await provider.start(config, this.emit, this.permission);
      return { ok: true, subtype: 'success', numTurns: 1, sessionId: 'provider-session' };
    }
  },
}));

import { SessionRunnerFacade } from './runtime/providers/select';
import { SubmissionToolRegistry } from '../agents/submission-tools/registry';
import { LocalAgentEndpoint } from './local-base-url';
import { ToolRuleStore } from '../session/tool-rules';
import { AgentSessionReader } from './monitors/agent-session-reader';
import { PlatformAuthContext } from './platform-auth-context';
import { WorkItemTypesApi, ProjectsApi, ConversationsApi } from '../shared/api/generated';
import { CreateReportProxy } from '../agents/submission-tools/create-report-proxy';
import { CreateReportTool } from '../agents/submission-tools/create-report-tool';
import { SubmissionToolAuth } from '../agents/submission-tools/submission-tool-auth';
import { ReportEmissionEvents } from '../agents/submission-tools/report-emission-events';
import { PlatformMcpForwarder } from '../agents/platform-mcp-proxy/forwarder';
import type { JsonRpcRequest, JsonObject } from '../agents/platform-mcp-proxy/session';
import { SubmissionToolsHttpController } from '../agents/submission-tools/http-mcp';
import type { Request, Response as ExpressResponse } from 'express';

const readJsonBody = (init: RequestInit | undefined): unknown => {
  if (typeof init?.body !== 'string') {
    throw new Error('Expected JSON request body');
  }
  const parsed: unknown = JSON.parse(init.body);
  return parsed;
};
const toolCallSchema = z.object({
  id: z.union([z.string(), z.number(), z.null()]),
  params: z.object({ name: z.string(), arguments: z.record(z.unknown()) }),
});

describe('ordinary Run output boundaries', () => {
  it.each([
    { inert: true, evalAttempt: true },
    { inert: true, evalAttempt: false },
    { inert: false, evalAttempt: false },
  ])(
    'keeps outputs governed by stored inertness ($inert), eval attempt ($evalAttempt)',
    async ({ inert, evalAttempt }) => {
      const baseDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-inert-boundaries-'));
      tempDirs.push(baseDir);
      vi.stubEnv('CLAUDE_CONFIG_DIR', baseDir);
      await import('node:fs/promises').then(({ writeFile }) =>
        writeFile(
          path.join(baseDir, '.claude.json'),
          JSON.stringify({
            mcpServers: { personal: { type: 'http', url: 'https://personal.test/mcp' } },
          }),
        ),
      );
      const runStore = storeAt(baseDir);
      await runStore.initialize();
      const repoStore = createTestRepoMappingStore();
      const token = `header.${Buffer.from(JSON.stringify({ organizationId: 'org-1' })).toString('base64url')}.signature`;
      const oauthClient = createTestOAuthClient({
        getAccessToken: () => Promise.resolve({ success: true as const, data: token }),
      });
      const submissionToolRegistry = new SubmissionToolRegistry();
      const endpoint = new LocalAgentEndpoint();
      endpoint.set('http://local.test');
      vi.spyOn(
        WorkItemTypesApi.prototype,
        'organizationsOrganizationIdProjectsProjectIdWorkItemTypesGet',
      ).mockResolvedValue({ data: { success: true, data: [] } } as never);
      vi.spyOn(ConversationsApi.prototype, 'getConversation').mockResolvedValue({
        data: {
          success: true,
          data: { workflowAboutId: ENTITY.entityId, workflowAboutType: 'task' },
        },
      } as never);
      vi.spyOn(ProjectsApi.prototype, 'findOneProject').mockResolvedValue({
        data: { success: true, data: { maturity: 'ESTABLISHED' } },
      } as never);
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(() =>
          Promise.resolve(Response.json({ jsonrpc: '2.0', result: { tools: [] } })),
        ),
      );
      const postMessage = vi.fn<MessagePosterApiClient['postMessage']>(() =>
        Promise.resolve({ data: { success: true, data: { id: 'posted-message' } } }),
      );
      const updateMessage = vi.fn<MessagePosterApiClient['updateMessage']>(() =>
        Promise.resolve({}),
      );
      const poster = new MessagePoster({
        apiClient: { postMessage, updateMessage },
        logger: NOOP_LOGGER,
        dataDir: baseDir,
      });
      const reportFetch = vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json({
            success: true,
            data: { id: 'report-evidence' },
            reportGuidance: { actions: ['DONE'] },
          }),
        ),
      );
      const reportTool = new CreateReportTool(
        new CreateReportProxy({
          runStore,
          auth: new SubmissionToolAuth(oauthClient),
          apiBaseUrl: 'https://api.test',
          fetchImpl: reportFetch,
          reportEmissionEvents: new ReportEmissionEvents(),
        }),
      );
      const facade = new SessionRunnerFacade({
        capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
        runStore,
        repoStore,
        oauthClient,
        localAgentEndpoint: endpoint,
        submissionToolRegistry,
        logger: NOOP_LOGGER,
        toolRuleStore: new ToolRuleStore(path.join(baseDir, 'tool-rules.json')),
        agentSessionReader: new AgentSessionReader({
          apiBaseUrl: 'https://api.test',
          authProvider: new PlatformAuthContext(
            oauthClient,
            createTestMonitorProjectContext(),
            NOOP_LOGGER,
          ),
          logger: NOOP_LOGGER,
          fetchImpl: () => Promise.resolve(Response.json({ data: { autoDecide: false } })),
        }),
      });
      const errors = vi.spyOn(NOOP_LOGGER, 'error');
      const auth = new SubmissionToolAuth(oauthClient);
      vi.spyOn(
        TasksApi.prototype,
        'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet',
      ).mockResolvedValue({
        data: {
          success: true,
          data: {
            id: ENTITY.entityId,
            name: 'Evidence task',
            type: 'STANDARD',
            organizationId: 'org-1',
            projectId: 'project-1',
            status: 'ACTIVE',
            source: 'user',
            sections: [],
          },
        },
      } as never);
      vi.spyOn(EntityContextApi.prototype, 'getEntityContext').mockResolvedValue({
        data: {
          success: true,
          data: {
            entityId: ENTITY.entityId,
            entityType: 'TASK',
            taskType: 'STANDARD',
            displayName: 'Evidence task',
            createdAt: '2026-10-01T00:00:00.000Z',
            content: { sections: {} },
          },
        },
      } as never);
      const startupPromptInput = new AgentStartupPromptInput({
        auth,
        apiBaseUrl: 'https://api.test',
        logger: NOOP_LOGGER,
        entityContextLoader: new EntityContextLoader({
          auth,
          apiBaseUrl: 'https://api.test',
          logger: NOOP_LOGGER,
        }),
        createClient: () => ({
          getProjectEntityPromptTemplateCatalog: () =>
            Promise.resolve({
              data: {
                success: true,
                data: {
                  projectId: 'project-1',
                  templates: [
                    {
                      templateKey: 'work-item-standard',
                      effective: {
                        selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
                      },
                    },
                  ],
                },
              },
            } as never),
          getEffectiveEntityPromptTemplate: () =>
            Promise.resolve({
              data: {
                success: true,
                message: 'OK',
                timestamp: '2026-10-01T00:00:00.000Z',
                statusCode: 200,
                data: {
                  templateKey: 'work-item-standard',
                  selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
                  syntaxVersion: 'V1',
                  content: 'Review the authoritative task.',
                  ownershipSource: { scope: 'CANONICAL' },
                  revisionId: 'template-revision',
                  revisionNumber: 1,
                  lifecycleState: 'PUBLISHED',
                  validationStatus: 'VALID',
                  publishedAt: '2026-10-01T00:00:00.000Z',
                },
              },
            } as never),
        }),
      });
      const wiring = createTestRunRegistryWiring({
        runStore,
        repoStore,
        oauthClient,
        submissionToolRegistry,
        sessionRunnerFacade: facade,
        baseSubmissionTools: [reportTool],
        poster,
        handlerDeps: createPromptTypeHandlerTestDeps({
          runStore,
          auth,
          startupPromptInput,
          fetchImpl: () => Promise.resolve(Response.json({ data: [] })),
        }),
      });
      const service = new LocalAgentService({
        capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
        ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
        runStore,
        repoStore,
        runRegistry: wiring.runRegistry,
        promptTypeRegistry: wiring.promptTypeRegistry,
        workflowsApi: wiring.workflowsApi,
        messagesApi: wiring.messagesApi,
        projectModeBundleMaterializer: new ProjectModeBundleMaterializer(),
      });
      const upstream = vi.fn<typeof fetch>((_url, init) => {
        const request = toolCallSchema.parse(readJsonBody(init));
        return Promise.resolve(
          Response.json({
            jsonrpc: '2.0',
            id: request.id,
            result: {
              content: [],
              structuredContent:
                request.params.name === 'start_proposal_group' ? { groupId: 'evidence-group' } : {},
            },
          }),
        );
      });
      const forwarder = new PlatformMcpForwarder({
        oauthClient,
        logger: NOOP_LOGGER,
        fetchImpl: upstream,
      });
      const controller = new SubmissionToolsHttpController(
        submissionToolRegistry,
        wiring.runRegistry,
        poster,
        NOOP_LOGGER,
      );
      const submit = async (token: string, name: string, args: Record<string, unknown>) => {
        let body: unknown;
        const res = {
          status() {
            return this;
          },
          json(value: unknown) {
            body = value;
            return this;
          },
        } as unknown as ExpressResponse;
        const req = {
          params: { token },
          body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
        } as unknown as Request;
        await controller.handle(req, res);
        return body;
      };
      provider.start.mockReset();
      provider.start.mockImplementation(async (config, emit, permission) => {
        const run = wiring.runRegistry.get(AGENT_SESSION_ID);
        const turn = run?.activeTurn;
        if (!run || !turn?.platformMcpProxy) {
          throw new Error('Expected an active ordinary Run and platform proxy');
        }
        if (inert) {
          expect(config['builtinTools']).toEqual(['Read', 'Glob', 'Grep', 'ToolSearch']);
        }
        if (inert) {
          expect(config['mcpServers']).not.toHaveProperty('personal');
          expect(config['mcpServers']).not.toHaveProperty('heyhey-browser');
          expect(await permission('Bash', { command: 'touch live-project' })).toMatchObject({
            behavior: 'deny',
            message: 'Tool unavailable to inert execution.',
          });
        } else {
          expect(config['mcpServers']).toHaveProperty('personal');
        }
        const proxy = turn.platformMcpProxy;
        const rpc = (name: string, args: JsonObject = {}) =>
          proxy.handleJsonRpc(
            {
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name, arguments: args },
            } satisfies JsonRpcRequest,
            forwarder,
          );
        await rpc('create_work_item', {
          name: 'Evidence proposal',
          ragEnabled: true,
          applicationEligible: true,
        });
        await rpc('start_proposal_group', { title: 'Evidence group' });
        await rpc('edit_work_item', {
          groupContext: { groupId: 'evidence-group', expectedRevision: 1 },
          ragEnabled: true,
          applicationEligible: true,
        });
        const mutationCount = upstream.mock.calls.length;
        const denied = await rpc('create_edge', {});
        if (inert) {
          expect(denied.body).toHaveProperty('error');
          expect(upstream).toHaveBeenCalledTimes(mutationCount);
        }
        const registration = submissionToolRegistry.getByRunId(AGENT_SESSION_ID);
        if (!registration) {
          throw new Error('Expected Run submission tools');
        }
        if (inert) {
          expect(registration.tools.map(({ name }) => name)).toEqual(['create_report']);
          expect(
            await submit(registration.token, 'submit_session_name', {
              name: 'Change live session',
            }),
          ).toHaveProperty('error');
        }
        expect(
          await submit(registration.token, 'create_report', {
            reportType: 'REVIEW',
            audience: 'PROJECT_VISIBLE',
            ragEnabled: true,
            payload: {
              reportType: 'REVIEW',
              summary: 'Inert output evidence.',
              findings: [],
            },
          }),
        ).not.toHaveProperty('error');
        for (const [id, text] of [
          ['progress-1', 'Inspecting evidence.'],
          ['progress-2', 'Evidence inspected.'],
          ['answer', 'Evidence answer.'],
        ]) {
          emit({ type: 'assistant', message: { id, content: [{ type: 'text', text }] } });
        }
        emit({ type: 'result', subtype: 'success' });
      });
      if (evalAttempt) {
        const execution = new EvalAttemptExecution(NOOP_LOGGER);
        execution.bind(service, runStore);
        const result = await execution.execute(
          { contextMetadata: startRunPayload({}).contextMetadata } as AgenticSession,
          {
            attemptId: '33333333-3333-4333-8333-333333333333',
            targetSessionId: AGENT_SESSION_ID,
            targetConversationId: CONVERSATION_ID,
            configuration: {
              id: 'configuration',
              target: {
                provider: 'claude',
                model: 'claude-test',
                handlerConfig: { projectAssistant: { enabled: false } },
              },
            },
            caseInput: {
              id: 'case',
              evalCaseId: 'eval-case',
              title: 'Review',
              target: {
                targetHandler: 'entity_conversation',
                focalItemId: ENTITY.entityId,
                focalItemType: 'TASK',
                initiatingRequest: 'Review this item.',
                situation: 'SECRET-SITUATION',
              },
              grading: { checks: [], rubric: [], expectations: 'SECRET-EXPECTATIONS' },
            },
          } satisfies EvalRecordedAttempt,
          { signal: new AbortController().signal },
        );
        expect(result).toMatchObject({ assistantCompleted: true, outputText: 'Evidence answer.' });
        expect(await runStore.getRunMetadata(AGENT_SESSION_ID)).toMatchObject({
          inert: true,
          conversationId: CONVERSATION_ID,
        });
        expect(String(provider.start.mock.calls[0]?.[0]['prompt'])).not.toContain('SECRET-');
      } else {
        await service.createRun({
          ...toCreateRunRequest(startRunPayload({}), CONVERSATION_ID),
          inert,
          config: {
            type: 'ENTITY_CONVERSATION',
            version: 'v1',
            model: 'claude-test',
            projectAssistant: { enabled: false },
          },
          payload: {
            promptType: 'entity_conversation',
            entity: { entityType: 'TASK', entityId: ENTITY.entityId },
            userMessage: 'Review this item.',
          },
        });
      }
      await wiring.runRegistry.get(AGENT_SESSION_ID)?.awaitIdle();
      expect(errors.mock.calls).toEqual([]);
      expect(provider.start).toHaveBeenCalledOnce();
      await expect(provider.start.mock.results[0]?.value).resolves.toBeUndefined();
      await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());
      const answer = postMessage.mock.calls
        .map(([request]) => request.createMessageDto)
        .find(
          (dto) =>
            dto.type === 'SYSTEM' &&
            dto.data.type === 'AGENT' &&
            dto.data.response === 'Evidence answer.',
        );
      expect(answer).toMatchObject({ status: 'completed', data: { response: 'Evidence answer.' } });
      if (inert) {
        for (const [request] of postMessage.mock.calls) {
          expect(request.createMessageDto.data).toMatchObject({ ragEnabled: false });
        }
      } else {
        expect(answer).toBeDefined();
        expect(answer?.data).not.toMatchObject({ ragEnabled: false });
      }
      await vi.waitFor(() => expect(updateMessage).toHaveBeenCalled());
      for (const [request] of updateMessage.mock.calls) {
        expect(request.updateMessageDto.data).toMatchObject({ ragEnabled: false });
      }
      expect(reportFetch).toHaveBeenCalledOnce();
      const report = readJsonBody(reportFetch.mock.calls[0]?.[1]);
      expect(report).toMatchObject({ ragEnabled: !inert });
      const proposalCalls = upstream.mock.calls
        .map(([, init]) => toolCallSchema.parse(readJsonBody(init)))
        .filter(({ params }) => ['create_work_item', 'edit_work_item'].includes(params.name));
      expect(proposalCalls).toHaveLength(2);
      expect(proposalCalls[1]?.params.arguments).toMatchObject({
        groupContext: { groupId: 'evidence-group', expectedRevision: 1 },
      });
      for (const call of proposalCalls) {
        expect(call.params.arguments).toMatchObject({
          ragEnabled: !inert,
          applicationEligible: !inert,
        });
      }
    },
  );
});

import { createReadinessSourceSnapshotFromStartupInput } from '../agents/implementation-readiness/source-snapshot';
/** @vitest-environment node */
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClaudeCodeSdkClient } from '../agent-runtime/index';
import { WorkItemTypesApi, ProjectsApi, AgentSessionsApi } from '../shared/api/generated/api';
import { PromptTypeRegistry } from '../agents/prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../agents/prompt-type-registry.test-support';
import type { AgentStartupPromptInputResult } from '../agents/prompt-type-handler';
import {
  createPromptTypeHandlerTestAuth,
  createPromptTypeHandlerTestDeps,
} from '../agents/prompt-type-handler.test-support';
import { SubmissionToolsHttpController } from '../agents/submission-tools/http-mcp';
import { RunStore } from '../run-store/run-store';
import { LocalAgentEndpoint } from '../server/local-base-url';
import { LocalAgentService } from '../server/local-agent-service';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';
import { InputAdmissionOwner } from '../server/input-admission/input-admission-owner';
import { InputAdmissionLifecycle } from '../server/input-admission/admission-lifecycle';
import { storedInput } from '../server/input-admission/input-admission-codec';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES } from '../server/__tests__/helpers/test-run-registry';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated/api';
import { type RunCollaborators } from './run';
import { RunRegistry } from './run-registry';
import { RunnerPicker } from './runners/pick-runner';
import { ChildAgentLauncher } from './child-agent-launcher';
import {
  createRunTestOAuthClient,
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunChangedFilesReader,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestSessionRunnerFacade,
  createTestMonitorProjectContext,
} from './run.test-support';

const RUN_ID = 'f73abfa6-0cf4-40dd-a1c3-e25ca0a163b8';
const SERVICE_ID = 'a8fb6fbb-5747-4480-89e3-fc4a43ab7745';
const TASK_ID = '6b0f7a51-2c4e-4d3b-9a8e-1f2d3c4b5a60';
const MACHINE_ID = 'a20d426f-043c-494c-9435-04d42f8d5433';
const ORGANIZATION_ID = '11c74456-d8e7-43e3-80ae-78bca6faf74d';
const PROJECT_ID = '050553ca-3887-4a91-8a34-cbaf631171fb';
const CONVERSATION_ID = '6efce8cc-5a4b-4196-860e-df11432db18a';
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const startupPromptInput: AgentStartupPromptInputResult = {
  startupInput: {
    task: {
      id: TASK_ID,
      title: 'Conversational planning',
      taskType: 'STANDARD',
      description: 'Discuss the intended behavior before approval.',
    },
    focalEntity: { entityType: 'TASK', entityId: TASK_ID },
    adjacentScopeTasks: [],
    evidenceItems: [],
  },
  renderedInput: 'CURRENT ENTITY CONTEXT',
  loadedEntityContext: {
    kind: 'entity',
    focalEntity: { entityType: 'TASK', entityId: TASK_ID },
    entity: {
      id: TASK_ID,
      title: 'Conversational planning',
      type: 'STANDARD',
      summary: 'Discuss the intended behavior before approval.',
      sections: [],
    } as never,
    context: {
      entityId: TASK_ID,
      entityType: 'TASK',
      displayName: 'Conversational planning',
      taskType: 'STANDARD',
      content: {
        sections: { description: 'Discuss the intended behavior before approval.' },
        status: 'ACTIVE',
        priority: 'MEDIUM',
        assigneeId: null,
        dueDate: null,
      },
      featureHierarchy: [],
      relatedEntities: [],
      planContext: null,
    } as never,
  },
  provenance: {
    templateKey: 'task',
    ownershipSource: { scope: 'CANONICAL' },
    revisionId: 'template-revision-1',
    revisionNumber: 1,
  },
  template: {
    templateKey: 'task',
    selector: { entityType: 'WORK_ITEM', workItemTypeKey: 'STANDARD' },
    syntaxVersion: 'V1',
    content: 'CURRENT ENTITY CONTEXT',
    provenance: {
      templateKey: 'task',
      ownershipSource: { scope: 'CANONICAL' },
      revisionId: 'template-revision-1',
      revisionNumber: 1,
    },
  },
};

// Internal admission, execution, tool mounting and persistence are real. Only the
// provider SDK and the platform's HTTP/message boundaries are controlled.
async function makeHarness(rejectFirstContext = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'conversational-planning-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  vi.spyOn(os, 'homedir').mockReturnValue(directory);
  const repo = path.join(directory, 'repo');
  await mkdir(repo);
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  const runStore = new RunStore({
    paths: {
      baseDir: directory,
      runsDir: path.join(directory, 'runs'),
      indexPath: path.join(directory, 'runs/index.json'),
      preferencesPath: path.join(directory, 'preferences.json'),
    },
  });
  await runStore.initialize();
  await runStore.createRun({
    entity: { entityType: 'TASK', entityId: TASK_ID },
    agentic_session_id: RUN_ID,
    services: [{ id: SERVICE_ID, path: repo }],
    launchServiceId: SERVICE_ID,
    provider: 'claude',
    provider_session_id: 'planner-provider',
    provider_conversation_id: null,
    conversationId: CONVERSATION_ID,
    contextMetadata: {
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      agentSessionId: RUN_ID,
    },
  } as never);
  await runStore.updateRunPromptType(RUN_ID, LocalPromptType.StartupSession);
  const sourceSnapshot = createReadinessSourceSnapshotFromStartupInput({
    runId: RUN_ID,
    startupPromptInput,
    capturedAt: '2026-10-24T19:00:00.000Z',
  });
  if (!sourceSnapshot) throw new Error('Missing readiness context.');
  await runStore.updateRunImplementationReadiness(RUN_ID, {
    state: 'CLEAR',
    sourceSnapshot,
    finding: null,
    resolution: { kind: 'NONE' },
  });
  const session = await runStore.getRun(RUN_ID);
  if (!session) throw new Error('Run was not persisted.');
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as RunCollaborators['logger'];
  const messages: Array<Record<string, unknown>> = [];
  let rejectNextContext = rejectFirstContext;
  const poster = createTestMessagePoster({
    createOutOfBand: vi.fn(async ({ dto }) => {
      if (rejectNextContext && JSON.stringify(dto).includes('coding_plan_version_v1')) {
        rejectNextContext = false;
        throw new Error('Planning storage temporarily unavailable.');
      }
      const id = randomUUID();
      messages.push({ ...dto, id, createdAt: new Date().toISOString() });
      return id;
    }),
  });
  const platformFetch: typeof fetch = vi.fn(
    async () => new Response(JSON.stringify({ data: messages })),
  );
  const token = `header.${Buffer.from(JSON.stringify({ organizationId: ORGANIZATION_ID, sub: randomUUID() })).toString('base64url')}.signature`;
  const oauthClient = createRunTestOAuthClient({ success: true, data: token });
  vi.spyOn(
    WorkItemTypesApi.prototype,
    'organizationsOrganizationIdProjectsProjectIdWorkItemTypesGet',
  ).mockResolvedValue({ data: { data: [] } } as never);
  vi.spyOn(ProjectsApi.prototype, 'findOneProject').mockResolvedValue({
    data: { data: { maturity: 'ESTABLISHED' } },
  } as never);
  vi.spyOn(ProjectsApi.prototype, 'projectInputExecution').mockResolvedValue({
    data: { data: { accepted: true } },
  } as never);
  vi.spyOn(AgentSessionsApi.prototype, 'settleAgentInteractionTurn').mockResolvedValue({
    data: { data: { accepted: true } },
  } as never);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ jsonrpc: '2.0', result: { tools: [] } }))),
  );
  const promptTypes = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES);
  const ownership = createTestRunOwnership((promptType) => promptTypes.get(promptType));
  const handlerDeps = createPromptTypeHandlerTestDeps({
    runStore,
    startupPromptInput: { resolve: vi.fn().mockResolvedValue(startupPromptInput) } as never,
    auth: createPromptTypeHandlerTestAuth(token),
    apiBaseUrl: 'https://api.example.test/api/v1',
    fetchImpl: platformFetch,
    logger,
  });
  const repoStore = createTestRepoMappingStore();
  const sessionRunnerFacade = createTestSessionRunnerFacade();
  const endpoint = new LocalAgentEndpoint();
  const childAgentLauncher = new ChildAgentLauncher({
    handlerDeps: createPromptTypeHandlerTestDeps(),
    promptTypeRegistry: promptTypes,
    repoStore,
    oauthClient,
    submissionToolRegistry: ownership.submissionToolRegistry,
    localAgentEndpoint: endpoint,
    logger,
  });
  const runnerPicker = new RunnerPicker({
    sessionRunnerFacade,
    childAgentLauncher,
    logger,
    runChangedFilesReader: createTestRunChangedFilesReader(),
  });
  const runRegistry = new RunRegistry({
    runCollaborators: {
      runStore,
      repoStore,
      poster,
      broadcaster: createTestRunEventPublisher(),
      ...ownership,
      handlerDeps,
      runnerPicker,
      logger,
    },
    submissionToolRegistry: ownership.submissionToolRegistry,
    sessionRunnerFacade,
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents: new RunLifecycleEvents(),
  });
  const run = runRegistry.create({
    runId: RUN_ID,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    conversationId: CONVERSATION_ID,
    provider: 'claude',
    session,
    hasProviderSession: true,
    skipProjectAssistant: true,
  });
  cleanups.push(async () => run.cleanup());
  const mcp = new SubmissionToolsHttpController(
    ownership.submissionToolRegistry,
    runRegistry,
    poster,
    logger,
  );
  const callTool = async (name: string, args: object) => {
    const registration = ownership.submissionToolRegistry.getByRunId(RUN_ID);
    if (!registration) throw new Error('Planning tools are not mounted.');
    let rpc: { result?: { isError?: boolean }; error?: { message: string } } = {};
    await mcp.handle(
      {
        params: { token: registration.token },
        body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } },
      } as unknown as Request,
      {
        status() {
          return this;
        },
        json(body: typeof rpc) {
          rpc = body;
          return this;
        },
      } as unknown as Response,
    );
    if (rpc.error) throw new Error(rpc.error.message);
    if (!rpc.result) throw new Error('Tool returned no result.');
    return rpc.result;
  };
  const prompts: string[] = [];
  vi.spyOn(ClaudeCodeSdkClient.prototype, 'onPermissionRequest').mockImplementation(() => {});
  vi.spyOn(ClaudeCodeSdkClient.prototype, 'onEvent').mockImplementation(() => {});
  vi.spyOn(ClaudeCodeSdkClient.prototype, 'getContextUsage').mockResolvedValue(null as never);
  vi.spyOn(ClaudeCodeSdkClient.prototype, 'getSessionId').mockReturnValue('planner-provider');
  vi.spyOn(ClaudeCodeSdkClient.prototype, 'disconnect').mockResolvedValue(undefined);
  vi.spyOn(ClaudeCodeSdkClient.prototype, 'startSession').mockImplementation(async (config) => {
    prompts.push(config.prompt);
    expect(
      ownership.submissionToolRegistry.getByRunId(RUN_ID)?.tools.map((tool) => tool.name),
    ).toContain('emit_coding_plan');
    if (prompts.length === 2 || prompts.length === 3) return undefined as never;
    const context = {
      markdown:
        '# Complete plan\n\nMake discussion replyable before approval. Keep exact agreed context and required Services.',
      requiredServiceIds: [SERVICE_ID],
      // The first version carries a discrepancy; the replacement drops it as moot.
      discrepancies:
        prompts.length === 1
          ? [
              {
                sourceRef: { sourceType: 'task' as const, sourceId: TASK_ID },
                sourceField: 'description',
                sourceExcerpt: 'Approval is required before implementation.',
                discrepancyText: 'The prior implementation accepts approval from text.',
                reasoning: 'Retain explicit approval.',
                severity: 'high' as const,
              },
            ]
          : [],
    };
    if (rejectFirstContext && prompts.length === 1)
      await expect(callTool('emit_coding_plan', context)).rejects.toThrow(
        'temporarily unavailable',
      );
    expect((await callTool('emit_coding_plan', context)).isError).not.toBe(true);
    return undefined as never;
  });
  const service = new LocalAgentService({
    ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
    capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
    logger,
    runStore,
    repoStore,
    runRegistry,
    promptTypeRegistry: promptTypes,
    workflowsApi: { getConversationPromptType: vi.fn() },
    messagesApi: { getMessage: vi.fn() },
  });
  const keys = createTestKeyPairStore({ currentMachineId: MACHINE_ID });
  vi.spyOn(keys, 'loadMachineCredential').mockResolvedValue('test-machine-credential');
  const owner = new InputAdmissionOwner(
    {
      directory: path.join(directory, 'inputs'),
      legacyStoreFile: path.join(directory, 'inputs.json'),
    },
    logger,
  );
  const lifecycle = new InputAdmissionLifecycle(
    owner,
    service,
    runRegistry,
    keys,
    'https://api.example.test/api/v1',
    logger,
    () => true,
    runStore,
  );
  service.bindInputAdmission(lifecycle);
  await lifecycle.start();
  cleanups.push(() => lifecycle.dispose());
  const reply = async (userMessage: string) => {
    const messageId = randomUUID();
    messages.push({
      id: messageId,
      type: 'USER',
      createdAt: new Date().toISOString(),
      data: { agentInput: { userMessage } },
    });
    const key = randomUUID();
    const event = {
      promptType: 'user_message',
      operationId: key,
      operationFingerprint: 'a'.repeat(64),
      triggerMessageId: randomUUID(),
      sourceUserMessageId: messageId,
      payload: { handlerPromptType: 'startup_session', userMessage, attachments: [] },
    };
    await lifecycle.admitInput(
      {
        key,
        fingerprint: 'a'.repeat(64),
        agentSessionId: RUN_ID,
        runId: RUN_ID,
        organizationId: ORGANIZATION_ID,
        projectId: PROJECT_ID,
        machineId: MACHINE_ID,
        userId: randomUUID(),
        messageId,
      },
      storedInput('trigger_frame', 'operation', {
        conversationId: CONVERSATION_ID,
        signedEvent: event,
        event,
      }),
    );
    await vi.waitFor(async () => {
      expect(await owner.openRecords(RUN_ID)).toEqual([]);
      expect(run.isProcessing).toBe(false);
    });
    expect(
      (logger.error as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([event]) => event === 'runtime.turn.run_failed',
      ),
    ).toEqual([]);
  };
  return { run, prompts, messages, reply, poster, owner };
}

describe('conversational planning through admission, Run, Turn and mounted tools', () => {
  it('preserves repeated replies and persisted issues without consuming approval or producing a report', async () => {
    const harness = await makeHarness();
    await harness.reply('Start the discussion.');
    await harness.reply('Keep keyboard access.');
    await harness.reply('Change only point E.');
    expect(
      harness.messages.filter((row) => JSON.stringify(row).includes('coding_plan_version_v1')),
    ).toHaveLength(1);
    await harness.reply('Looks good, go ahead.');
    expect(harness.prompts).toHaveLength(4);
    expect(harness.prompts[3]).toContain(
      'Only the explicit Approve control on the current complete emitted plan authorizes implementation',
    );
    expect(harness.prompts[3]?.match(/Keep keyboard access\./g)).toHaveLength(1);
    expect(harness.prompts[3]).toContain('Start the discussion.');
    expect(harness.prompts[3]).toContain('Change only point E.');
    expect(
      harness.messages.filter((row) => JSON.stringify(row).includes('coding_plan_version_v1')),
    ).toHaveLength(2);
    expect(
      harness.messages.filter((row) =>
        JSON.stringify(row).includes('The prior implementation accepts approval from text.'),
      ),
    ).toHaveLength(1);
    expect(harness.poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
    expect(harness.run.readReportChain()).toEqual([]);
    expect(harness.run.runId).toBe(RUN_ID);
    expect(
      (await harness.owner.session(RUN_ID)).every((record) => record.state === 'settled'),
    ).toBe(true);
  });
  it('lets the planner correct a failed persistence call while approval stays pending', async () => {
    const harness = await makeHarness(true);
    await harness.reply('Discuss the outcome.');
    expect(harness.prompts).toHaveLength(1);
    expect(
      harness.messages.filter((row) => JSON.stringify(row).includes('coding_plan_version_v1')),
    ).toHaveLength(1);
    expect(harness.poster.submitExternalAgentCompletion).not.toHaveBeenCalled();
  });
});

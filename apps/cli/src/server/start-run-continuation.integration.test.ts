/** @vitest-environment node */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const getMessages = vi.hoisted(() => vi.fn());

vi.mock('../agents/providers/session-runner-config', () => ({
  loadAgentSessionRunnerConfig: vi
    .fn()
    .mockResolvedValue({ sourcePath: '/tmp/cfg.json', warnings: [] }),
  resolveAgentInvocationConfigPath: vi.fn(() => '/tmp/agent-invocation.json'),
}));

// The platform message read is the only network boundary on this path.
vi.mock('../shared/runtime/clients/serviceClients', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../shared/runtime/clients/serviceClients')>()),
  conversationsClient: { getMessages },
}));

import { ProjectModeBundleMaterializer } from '../agents/project-mode';
import { RunStore } from '../run-store/run-store';
import { createTestRepoMappingStore } from '../run/run.test-support';
import {
  validateTriggerPayload,
  type StartRunTriggerPayload,
} from './conversation-dispatch/trigger-payload-schemas';
import { TEST_ADMITTED_HOST_ACTION } from './controller-authorization/admitted-host-action.test-support';
import { createTestOAuthClient } from './__tests__/helpers/test-oauth-client';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './__tests__/helpers/test-run-registry';
import { LocalAgentService } from './local-agent-service';
import { toCreateRunRequest } from './trigger-verification/dispatch';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';
import { CONTINUATION_MEMO_SOURCE } from './services/run-continuation';
import { ContinuationStartup } from './services/continuation-startup';
import { AgentSessionContinuationInspector } from './agent-session-continuation-inspector';
import { ClaudeSessionReader } from '../provider-transcripts/claude-session-reader';
import { AgentSessionRunnerError } from '../agents/providers/session-runner';
import { createTestKeyPairStore } from '../credentials/keypair.test-support';
import { NOOP_LOGGER } from './logger';

/**
 * A continuation's materialize-only start_run on the destination computer.
 *
 * Real path: start-run payload validation → `toCreateRunRequest` →
 * `LocalAgentService.createRunFromTrigger` → `RunService` → on-disk
 * `RunStore`. Faked boundaries only: provider runners, OAuth and the platform
 * message read.
 */

const AGENT_SESSION_ID = '7f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';
const CONTINUATION_ID = '5e4d3c2b-1a09-4f8e-9d7c-6b5a49382716';
const CONVERSATION_ID = 'conv-continuation';
const PROVIDER_SESSION_ID = '11111111-2222-4333-8444-555555555555';
const MACHINE_ID = '2b3c4d5e-6f70-4812-9a3b-4c5d6e7f8091';
const MACHINE_CREDENTIAL = 'machine-credential-token';
const FIRST_DELIVERY = '0e1f2a3b-4c5d-4e6f-8a9b-0c1d2e3f4a5b';
const RETRY_DELIVERY = '1f2a3b4c-5d6e-4f70-9a1b-2c3d4e5f6a7b';
const ENTITY = { entityType: 'TASK', entityId: '9cb94de8-c331-41aa-911e-1c50508a302f' } as const;

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

interface ReceivedReport {
  url: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

/** The platform's startup endpoint, reached over real HTTP. */
const startPlatform = async (statuses: number[] = []) => {
  const reports: ReceivedReport[] = [];
  const server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk) => (raw += chunk));
    request.on('end', () => {
      reports.push({
        url: request.url ?? '',
        authorization: request.headers.authorization,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      const status = statuses.shift() ?? 200;
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify(
          status === 200 ? { data: { accepted: true, state: 'SUCCEEDED' } } : { message: 'no' },
        ),
      );
    });
  });
  await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  // Production passes the normalized origin, which ends in /api/v1.
  return { reports, apiBaseUrl: `http://127.0.0.1:${port}/api/v1` };
};

const makeHarness = async () => {
  const baseDir = await mkdtemp(path.join(os.tmpdir(), 'heyhey-continuation-'));
  tempDirs.push(baseDir);
  const runsDir = path.join(baseDir, 'runs');
  const runStore = new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  await runStore.initialize();
  const runPrompt = vi.fn(() =>
    Promise.resolve({ providerSessionId: null, providerConversationId: null, errorCount: 0 }),
  );
  const projectModeBundleMaterializer = new ProjectModeBundleMaterializer();
  const wiring = createTestRunRegistryWiring({
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
  const claudeProjects = path.join(baseDir, 'claude-projects');
  await mkdir(claudeProjects, { recursive: true });
  return { baseDir, runStore, service, runPrompt, claudeProjects };
};

type Harness = Awaited<ReturnType<typeof makeHarness>>;

/** The provider process boundary: a no-prompt resume and catalog availability. */
const providerBoundary = (resume: () => Promise<void> = () => Promise.resolve()) => ({
  resumeProviderSessionWithoutPrompt: vi.fn(resume),
  isProviderAvailable: vi.fn(() => Promise.resolve(true)),
});

const startupOwner = async (
  harness: Harness,
  apiBaseUrl: string,
  providers: ReturnType<typeof providerBoundary>,
) => {
  const keyPairStore = createTestKeyPairStore();
  await keyPairStore.setCurrentMachineId(MACHINE_ID);
  await keyPairStore.storeMachineCredential(MACHINE_ID, MACHINE_CREDENTIAL);
  return new ContinuationStartup({
    runStore: harness.runStore,
    inspector: new AgentSessionContinuationInspector(
      harness.runStore,
      NOOP_LOGGER,
      [path.join(harness.baseDir, 'codex')],
      new ClaudeSessionReader({ projectsDir: harness.claudeProjects }),
    ),
    providers,
    keyPairStore,
    apiBaseUrl,
    dataDirectory: harness.baseDir,
    logger: NOOP_LOGGER,
    sleep: () => Promise.resolve(),
  });
};

/** This computer previously ran the session natively and kept the provider transcript. */
const seedNativeSession = async (harness: Harness) => {
  await harness.runStore.createRun({
    agentic_session_id: AGENT_SESSION_ID,
    provider: 'claude',
    provider_session_id: PROVIDER_SESSION_ID,
    provider_conversation_id: null,
    conversationId: CONVERSATION_ID,
    entity: ENTITY,
    services: [],
    model: 'claude-test',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'project-1',
      capturedAt: '2026-11-16T00:00:00.000Z',
      agentSessionId: AGENT_SESSION_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  });
  const folder = path.join(harness.claudeProjects, '-Users-someone-code-project');
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${PROVIDER_SESSION_ID}.jsonl`), '{"type":"user"}\n');
};

/** Delivery as the dispatcher performs it: materialize, then confirm startup. */
const deliver = async (
  harness: Harness,
  owner: ContinuationStartup,
  mode: 'NATIVE_RESUME' | 'SAVED_HISTORY',
  deliveryOperationId = FIRST_DELIVERY,
) => {
  const result = await harness.service.createRunFromTrigger(
    TEST_ADMITTED_HOST_ACTION,
    toCreateRunRequest(continuationStart(mode), CONVERSATION_ID),
  );
  expect(result.status).toBe('started');
  await owner.confirm({
    marker: { continuationId: CONTINUATION_ID, mode },
    agentSessionId: AGENT_SESSION_ID,
    organizationId: 'org-1',
    projectId: 'project-1',
    conversationId: CONVERSATION_ID,
    deliveryOperationId,
  });
};

/** The continuation start the platform authors from the session's first launch. */
const continuationStart = (mode: 'NATIVE_RESUME' | 'SAVED_HISTORY'): StartRunTriggerPayload =>
  validateTriggerPayload('start_run', {
    agentSessionId: AGENT_SESSION_ID,
    handlerPromptType: 'free_form',
    payload: {
      promptType: 'free_form',
      userMessage: 'Original ask',
      entity: ENTITY,
    },
    triggersAgent: false,
    continuation: { continuationId: CONTINUATION_ID, mode },
    provider: 'claude',
    model: 'claude-test',
    contextMetadata: {
      capturedAt: '2026-11-16T00:00:00.000Z',
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: AGENT_SESSION_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  }) as StartRunTriggerPayload;

const savedHistory = {
  data: {
    data: [
      {
        id: 'm1',
        type: 'USER',
        conversationId: CONVERSATION_ID,
        createdAt: '2026-11-16T10:00:01.000Z',
        data: { comment: 'Original ask' },
      },
      {
        id: 'm2',
        type: 'SYSTEM',
        conversationId: CONVERSATION_ID,
        createdAt: '2026-11-16T10:00:02.000Z',
        data: { type: 'AGENT', response: 'Earlier answer' },
      },
    ],
  },
};

describe('continuation start_run on the destination computer', () => {
  it('keeps the continuation marker through wire validation and requires materialize-only', () => {
    expect(continuationStart('SAVED_HISTORY').continuation).toEqual({
      continuationId: CONTINUATION_ID,
      mode: 'SAVED_HISTORY',
    });
    expect(() =>
      validateTriggerPayload('start_run', {
        ...continuationStart('SAVED_HISTORY'),
        triggersAgent: true,
      }),
    ).toThrow(/materialize-only/);
  });

  it('on a wiped or different computer materializes the same Run from saved history without a Turn', async () => {
    const { runStore, service, runPrompt } = await makeHarness();
    getMessages.mockResolvedValue(savedHistory);

    const result = await service.createRunFromTrigger(
      TEST_ADMITTED_HOST_ACTION,
      toCreateRunRequest(continuationStart('SAVED_HISTORY'), CONVERSATION_ID),
    );

    expect(result.status).toBe('started');
    const run = await runStore.getRun(AGENT_SESSION_ID);
    expect(run?.agentic_session_id).toBe(AGENT_SESSION_ID);
    expect(runStore.lookupByConversationId(CONVERSATION_ID)).toBe(AGENT_SESSION_ID);
    expect(run?.memos?.map((memo) => memo.source)).toEqual([CONTINUATION_MEMO_SOURCE]);
    expect(run?.memos?.[0]?.content).toContain('Earlier answer');
    // Nothing reruns: the person's next message supplies new work.
    expect(runPrompt).not.toHaveBeenCalled();
    expect((await runStore.listRuns()).map((r) => r.agentic_session_id)).toEqual([
      AGENT_SESSION_ID,
    ]);
  });

  it('confirms a saved-history continuation only after history is staged, without starting a Turn', async () => {
    const harness = await makeHarness();
    const platform = await startPlatform();
    const providers = providerBoundary();
    getMessages.mockResolvedValue(savedHistory);

    await deliver(
      harness,
      await startupOwner(harness, platform.apiBaseUrl, providers),
      'SAVED_HISTORY',
    );

    expect(platform.reports).toEqual([
      {
        url: `/api/v1/organizations/org-1/projects/project-1/agent-sessions/${AGENT_SESSION_ID}/continuations/${CONTINUATION_ID}/startup`,
        authorization: `Bearer ${MACHINE_CREDENTIAL}`,
        body: { deliveryOperationId: FIRST_DELIVERY, outcome: 'PREPARED_FROM_HISTORY' },
      },
    ]);
    expect(providers.isProviderAvailable).toHaveBeenCalledWith('claude');
    expect(providers.resumeProviderSessionWithoutPrompt).not.toHaveBeenCalled();
    // The new provider session mints with the person's next message, with full tools and the history memo.
    expect(harness.runPrompt).not.toHaveBeenCalled();
  });

  it('resumes the original provider session natively and answers a retried delivery without resuming twice', async () => {
    const harness = await makeHarness();
    await seedNativeSession(harness);
    const platform = await startPlatform();
    const providers = providerBoundary();
    const owner = await startupOwner(harness, platform.apiBaseUrl, providers);

    await deliver(harness, owner, 'NATIVE_RESUME');
    await deliver(harness, owner, 'NATIVE_RESUME', RETRY_DELIVERY);

    expect(platform.reports.map((report) => report.body)).toEqual([
      { deliveryOperationId: FIRST_DELIVERY, outcome: 'RESUMED' },
      { deliveryOperationId: RETRY_DELIVERY, outcome: 'RESUMED' },
    ]);
    expect(providers.resumeProviderSessionWithoutPrompt).toHaveBeenCalledOnce();
    expect(providers.resumeProviderSessionWithoutPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ provider_session_id: PROVIDER_SESSION_ID }),
    );
    expect(harness.runPrompt).not.toHaveBeenCalled();
    expect((await harness.runStore.getRun(AGENT_SESSION_ID))?.provider_session_id).toBe(
      PROVIDER_SESSION_ID,
    );
  });

  it('reports a rejected resume when native state vanished, instead of failing or starting fresh', async () => {
    const harness = await makeHarness();
    const platform = await startPlatform();
    const providers = providerBoundary();

    await deliver(
      harness,
      await startupOwner(harness, platform.apiBaseUrl, providers),
      'NATIVE_RESUME',
    );

    expect(platform.reports.map((report) => report.body)).toEqual([
      {
        deliveryOperationId: FIRST_DELIVERY,
        outcome: 'NATIVE_RESUME_REJECTED',
        reasonCode: 'NO_PROVIDER_SESSION',
      },
    ]);
    expect(providers.resumeProviderSessionWithoutPrompt).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
    expect(harness.runPrompt).not.toHaveBeenCalled();
  });

  it('reports the provider refusing to resume as a rejection, but a login failure as its own failure', async () => {
    const harness = await makeHarness();
    await seedNativeSession(harness);
    const platform = await startPlatform();
    const refused = providerBoundary(() =>
      Promise.reject(new AgentSessionRunnerError('SESSION_NOT_FOUND', 'gone')),
    );
    await deliver(
      harness,
      await startupOwner(harness, platform.apiBaseUrl, refused),
      'NATIVE_RESUME',
    );

    const loginFailed = providerBoundary(() =>
      Promise.reject(new AgentSessionRunnerError('INVALID_CREDENTIAL', 'log in again')),
    );
    await deliver(
      harness,
      await startupOwner(harness, platform.apiBaseUrl, loginFailed),
      'NATIVE_RESUME',
      RETRY_DELIVERY,
    );

    expect(platform.reports.map((report) => report.body)).toEqual([
      {
        deliveryOperationId: FIRST_DELIVERY,
        outcome: 'NATIVE_RESUME_REJECTED',
        reasonCode: 'PROVIDER_SESSION_NOT_FOUND',
      },
      {
        deliveryOperationId: RETRY_DELIVERY,
        outcome: 'FAILED',
        reasonCode: 'PROVIDER_INVALID_CREDENTIAL',
        detail: 'AgentSessionRunnerError',
      },
    ]);
  });

  it('retries a report the platform could not take, and stops on a rejection', async () => {
    const harness = await makeHarness();
    await seedNativeSession(harness);
    const unavailable = await startPlatform([503, 200]);
    await deliver(
      harness,
      await startupOwner(harness, unavailable.apiBaseUrl, providerBoundary()),
      'NATIVE_RESUME',
    );
    expect(unavailable.reports).toHaveLength(2);

    const rejecting = await startPlatform([404, 200]);
    await deliver(
      harness,
      await startupOwner(harness, rejecting.apiBaseUrl, providerBoundary()),
      'NATIVE_RESUME',
      RETRY_DELIVERY,
    );
    expect(rejecting.reports).toHaveLength(1);
  });
});

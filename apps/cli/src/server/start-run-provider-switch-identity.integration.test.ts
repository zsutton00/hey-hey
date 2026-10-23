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
import { TEST_ADMITTED_HOST_ACTION } from './controller-authorization/admitted-host-action.test-support';
import { createTestOAuthClient } from './__tests__/helpers/test-oauth-client';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from './__tests__/helpers/test-run-registry';
import { LocalAgentService } from './local-agent-service';
import { prepareRunIdentity } from './run-read-identity';
import { RunReadPreparationError } from './run-read-preparation-error';
import { toCreateRunRequest } from './trigger-verification/dispatch';
import { SETTLED_CATALOG_AVAILABILITY } from '../test-support/capability-catalog';

/**
 * One Agent Session owns exactly one Run for its whole life, whatever provider
 * each phase runs on. Reproduces the fork observed when research ran on Claude
 * and implement was approved on Codex with a platform-minted trigger `runId`.
 *
 * Real path: start-run trigger payload → `toCreateRunRequest` →
 * `LocalAgentService.createRunFromTrigger` → `RunService` → on-disk `RunStore`
 * and `run-index.json` → `prepareRunIdentity` read boundary.
 *
 * Faked boundaries only: provider runners, OAuth, and platform HTTP clients.
 */

const AGENT_SESSION_ID = '3a8dd90c-f85e-4efc-a9c0-6fb3c58f0741';
const PLATFORM_RUN_ID = '95d340a8-b227-5779-acde-1d3b2ed538f0';
const CONVERSATION_ID = 'conv-provider-switch';
const ENTITY = { entityType: 'TASK' as const, entityId: '9cb94de8-c331-41aa-911e-1c50508a302f' };

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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
  return { baseDir, runStore, service };
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

const start = async (
  service: LocalAgentService,
  overrides: Partial<StartRunTriggerPayload>,
): Promise<string> => {
  const result = await service.createRunFromTrigger(
    TEST_ADMITTED_HOST_ACTION,
    toCreateRunRequest(startRunPayload(overrides), CONVERSATION_ID),
  );
  if (result.status !== 'started') throw new Error(`start-run did not start: ${result.status}`);
  return result.run.agentic_session_id;
};

describe('provider switch keeps one Run per Agent Session', () => {
  it('serves a Codex start-run carrying a platform runId from the existing Claude Run', async () => {
    const { runStore, service } = await makeHarness();

    const researchRunId = await start(service, { provider: 'claude', model: 'claude-test' });
    const implementRunId = await start(service, {
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
      runId: PLATFORM_RUN_ID,
    });

    expect(researchRunId).toBe(AGENT_SESSION_ID);
    expect(implementRunId).toBe(AGENT_SESSION_ID);
    const runs = await runStore.listRuns();
    expect(runs.map((run) => run.agentic_session_id)).toEqual([AGENT_SESSION_ID]);
    expect(await runStore.getRun(PLATFORM_RUN_ID)).toBeNull();
    expect(runStore.lookupByAgentSessionId(AGENT_SESSION_ID)).toBe(AGENT_SESSION_ID);
    expect(runStore.lookupByConversationId(CONVERSATION_ID)).toBe(AGENT_SESSION_ID);
  });

  it('switches the provider on the same persisted Run and keeps it readable by its Agent Session id', async () => {
    const { baseDir, runStore, service } = await makeHarness();
    await start(service, { provider: 'claude', model: 'claude-test' });

    const switched = await runStore.updateRunImplementRuntime(AGENT_SESSION_ID, {
      provider: 'codex',
      model: 'gpt-6.1-sol',
      reasoningEffort: 'low',
    });

    expect(switched.agentic_session_id).toBe(AGENT_SESSION_ID);
    expect(switched.provider).toBe('codex');
    expect(
      prepareRunIdentity(AGENT_SESSION_ID, await runStore.getRun(AGENT_SESSION_ID)).runId,
    ).toBe(AGENT_SESSION_ID);

    // A cold start rebuilds the index from disk and still binds the session to its one Run.
    const restarted = storeAt(baseDir);
    await restarted.initialize();
    expect(restarted.lookupByAgentSessionId(AGENT_SESSION_ID)).toBe(AGENT_SESSION_ID);
    expect(restarted.lookupByConversationId(CONVERSATION_ID)).toBe(AGENT_SESSION_ID);
    expect((await restarted.getRun(AGENT_SESSION_ID))?.provider).toBe('codex');
  });

  it('rejects a read of a Run whose id is not its Agent Session id', async () => {
    const { runStore, service } = await makeHarness();
    await start(service, { provider: 'claude', model: 'claude-test' });
    const run = await runStore.getRun(AGENT_SESSION_ID);
    if (!run) throw new Error('Expected the Agent Session Run.');
    const forked = { ...run, agentic_session_id: PLATFORM_RUN_ID };

    expect(() => prepareRunIdentity(PLATFORM_RUN_ID, forked)).toThrow(RunReadPreparationError);
  });
});

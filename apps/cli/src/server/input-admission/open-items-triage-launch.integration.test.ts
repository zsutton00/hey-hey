/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

vi.mock('../../agents/providers/session-runner-config', () => ({
  loadAgentSessionRunnerConfig: vi
    .fn()
    .mockResolvedValue({ sourcePath: '/tmp/cfg.json', warnings: [] }),
  resolveAgentInvocationConfigPath: vi.fn(() => '/tmp/agent-invocation.json'),
}));

const platform = vi.hoisted(() => ({ project: vi.fn(), settle: vi.fn() }));
vi.mock('../../shared/api/generated/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ProjectsApi: class {
    projectInputExecution = platform.project;
  },
  AgentSessionsApi: class {
    settleAgentInteractionTurn = platform.settle;
  },
}));

import { createPromptTypeHandlerTestDeps } from '../../agents/prompt-type-handler.test-support';
import { createTestKeyPairStore } from '../../credentials/keypair.test-support';
import { RunStore } from '../../run-store/run-store';
import { createTestRepoMappingStore } from '../../run/run.test-support';
import { createTestOAuthClient } from '../__tests__/helpers/test-oauth-client';
import {
  createTestRunRegistryWiring,
  LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
} from '../__tests__/helpers/test-run-registry';
import { LocalAgentService } from '../local-agent-service';
import type { ServerLogger } from '../logger';
import { InputAdmissionLifecycle } from './admission-lifecycle';
import { storedInput, type InputIdentity } from './input-admission-codec';
import { InputAdmissionOwner } from './input-admission-owner';
import { SETTLED_CATALOG_AVAILABILITY } from '../../test-support/capability-catalog';

/**
 * An Open Items triage Run launched with no Service selected runs both its first Turn and a
 * follow-up Turn. Triage declares `service: 'optional'` and `launchEntity: 'required'` on its
 * handler, and a missing declaration only shows when the Run resolves its workspace.
 *
 * Real path: a stored start-run frame → input admission owner and lifecycle →
 * `LocalAgentService.materializeAdmittedRun` → `RunService` → Run → Turn → runner picker →
 * session-runner facade. A follow-up user message then takes the same admission path onto the
 * live Run. Only the provider runner, the platform HTTP boundary and the machine credential are
 * controlled.
 */
describe('Open Items triage launched without a Service', () => {
  const machineId = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const userId = randomUUID();
  const agentSessionId = randomUUID();
  const conversationId = randomUUID();
  let directory: string;
  const cleanups: Array<() => void | Promise<void>> = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'triage-launch-'));
    platform.project.mockResolvedValue({ data: { data: { accepted: true } } });
    platform.settle.mockResolvedValue({ data: { data: { accepted: true } } });
  });
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    vi.clearAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  const harness = async () => {
    const errors: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const logger = {
      trace: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (event: string, fields: Record<string, unknown> = {}) => {
        errors.push({ event, fields });
      },
      child() {
        return this;
      },
    } as unknown as ServerLogger;

    const runStore = new RunStore({
      paths: {
        baseDir: join(directory, 'runs-base'),
        runsDir: join(directory, 'runs-base', 'runs'),
        indexPath: join(directory, 'runs-base', 'runs', 'run-index.json'),
        preferencesPath: join(directory, 'runs-base', 'preferences.json'),
      },
    });
    await runStore.initialize();
    const repoStore = createTestRepoMappingStore();

    // Controlled provider boundary: every Turn the Run executes reaches it.
    const providerTurns: Array<{
      session: { promptType?: string; services: unknown[] };
      prompt: string;
    }> = [];
    const runProvider = vi.fn(async (_run: unknown, args: (typeof providerTurns)[number]) => {
      providerTurns.push(args);
      return {
        providerSessionId: `provider-session-${providerTurns.length}`,
        providerConversationId: null,
        errorCount: 0,
      };
    });

    // Controlled platform boundary: what triage reads to build its input.
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const data = url.endsWith('/open-items')
        ? { state: 'PRESENT', revision: 1, items: [], groups: [] }
        : url.includes('/attention')
          ? { events: [], pagination: { limit: 50, offset: 0, total: 0 } }
          : { items: [], userId, windowDays: 30 };
      return new Response(JSON.stringify({ data }), { status: 200 });
    });

    const wiring = createTestRunRegistryWiring({
      runStore,
      repoStore,
      logger,
      handlerDeps: createPromptTypeHandlerTestDeps({
        runStore,
        fetchImpl,
        apiBaseUrl: 'https://api.example.test/api/v1',
        logger,
      }),
      sessionRunner: {
        runPrompt: vi.fn((args) => runProvider(null, args as never)),
        resumeSession: vi.fn((args) => runProvider(null, args as never)),
      },
      oauthClient: createTestOAuthClient({
        getAccessToken: vi.fn(() =>
          Promise.resolve({ success: true as const, data: 'test-token' }),
        ),
      }),
    });
    const service = new LocalAgentService({
      capabilityCatalog: SETTLED_CATALOG_AVAILABILITY,
      ...LOCAL_AGENT_SERVICE_TEST_DEPENDENCIES,
      logger,
      runStore,
      repoStore,
      runRegistry: wiring.runRegistry,
      promptTypeRegistry: wiring.promptTypeRegistry,
      workflowsApi: wiring.workflowsApi,
      messagesApi: wiring.messagesApi,
    });

    const keyPairStore = createTestKeyPairStore({ currentMachineId: machineId });
    vi.spyOn(keyPairStore, 'loadMachineCredential').mockResolvedValue('machine-credential');
    const owner = new InputAdmissionOwner(
      { directory: join(directory, 'inputs'), legacyStoreFile: join(directory, 'inputs.json') },
      logger,
    );
    const lifecycle = new InputAdmissionLifecycle(
      owner,
      service,
      wiring.runRegistry,
      keyPairStore,
      'https://api.example.test/api/v1',
      logger,
      () => true,
      runStore,
    );
    service.bindInputAdmission(lifecycle);
    await lifecycle.start();
    cleanups.push(async () => {
      const disposed = lifecycle.dispose();
      wiring.runRegistry.get(agentSessionId)?.cleanup();
      await disposed;
    });

    const admit = async (
      event: Record<string, unknown>,
      identity: Pick<InputIdentity, 'key' | 'messageId'>,
    ) =>
      lifecycle.admitInput(
        {
          ...identity,
          fingerprint: 'a'.repeat(64),
          agentSessionId,
          runId: agentSessionId,
          organizationId,
          projectId,
          machineId,
          userId,
        },
        storedInput('trigger_frame', 'operation', {
          conversationId,
          signedEvent: event,
          event,
        }),
      );

    const settled = async () => {
      await vi.waitFor(async () => {
        const run = wiring.runRegistry.get(agentSessionId);
        expect(run?.isProcessing).toBe(false);
        expect(await owner.openRecords(agentSessionId)).toEqual([]);
      });
    };

    return { errors, runStore, owner, providerTurns, fetchImpl, admit, settled };
  };

  /** A start-run frame: the first launch, or a later Send on the same session. */
  const startRunEvent = (
    operationId: string,
    request: {
      requestKind: 'freshPass' | 'followUp';
      mode: 'tidyUp' | 'springCleaning';
      userMessage: string;
      guidance?: string;
    },
  ) => ({
    promptType: 'start_run',
    operationId,
    operationFingerprint: 'a'.repeat(64),
    triggerMessageId: randomUUID(),
    payload: {
      handlerPromptType: 'open_items_triage',
      payload: {
        promptType: 'open_items_triage',
        projectId,
        ...request,
        entity: { entityType: 'PROJECT', entityId: projectId },
      },
      attachments: [],
      agentSessionId,
      model: 'claude-test',
      provider: 'claude',
      contextMetadata: {
        organizationId,
        projectId,
        agentSessionId,
        capturedAt: '2026-10-16T00:00:00.000Z',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
    },
  });

  it('reaches its first provider Turn and a follow-up Turn', async () => {
    const { errors, runStore, owner, providerTurns, admit, settled } = await harness();

    const launchKey = randomUUID();
    await admit(
      startRunEvent(launchKey, {
        requestKind: 'freshPass',
        mode: 'springCleaning',
        userMessage: 'Focus on unfinished work.',
      }),
      { key: launchKey, messageId: null },
    );
    await vi.waitFor(() => expect(providerTurns).toHaveLength(1));
    await settled();

    const persisted = await runStore.getRun(agentSessionId);
    expect(persisted?.promptType).toBe('open_items_triage');
    expect(persisted?.services).toEqual([]);
    expect(persisted?.entity).toEqual({ entityType: 'PROJECT', entityId: projectId });
    expect(providerTurns[0]?.session.services).toEqual([]);

    const followUpKey = randomUUID();
    await admit(
      startRunEvent(followUpKey, {
        requestKind: 'followUp',
        mode: 'springCleaning',
        userMessage: 'Why is the first item ranked above the others?',
        guidance: 'Focus on unfinished work.',
      }),
      { key: followUpKey, messageId: null },
    );
    await vi.waitFor(() => expect(providerTurns).toHaveLength(2));
    await settled();

    expect(providerTurns[1]?.session.promptType).toBe('open_items_triage');
    expect(providerTurns[1]?.prompt).toContain('Focus on unfinished work.');
    expect(providerTurns[1]?.prompt).toContain('Why is the first item ranked above the others?');
    expect(errors.filter(({ event }) => event.includes('resolve_failed'))).toEqual([]);
    expect(
      (await owner.session(agentSessionId)).map((record) => [record.key, record.state]),
    ).toEqual([
      [launchKey, 'settled'],
      [followUpKey, 'settled'],
    ]);
  });
});

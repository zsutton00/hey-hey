import { createTestMessagePoster } from '../../run/run.test-support';
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
 * A Verify Feature Run starts in its own handler mode, reads the parent session through its own
 * tool grant, and keeps a user reply in the same mode.
 *
 * Real path: a stored start-run frame → input admission owner and lifecycle →
 * `LocalAgentService.materializeAdmittedRun` → `RunService` → Run → Turn → runner picker →
 * session-runner facade. A follow-up user message then takes the same admission path onto the
 * live Run. Only the provider runner, the platform HTTP boundary and the machine credential are
 * controlled.
 */
describe('Verify Feature launch', () => {
  const machineId = randomUUID();
  const organizationId = randomUUID();
  const projectId = randomUUID();
  const userId = randomUUID();
  const agentSessionId = randomUUID();
  const conversationId = randomUUID();
  const featureId = randomUUID();
  let directory: string;
  const cleanups: Array<() => void | Promise<void>> = [];
  let workItemType = 'FEATURE';

  beforeEach(async () => {
    workItemType = 'FEATURE';
    directory = await mkdtemp(join(tmpdir(), 'verify-feature-launch-'));
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
      session: {
        agentic_session_id: string;
        promptType?: string;
        provider_session_agent_id?: string | null;
        provider_session_id?: string | null;
        services: unknown[];
      };
      prompt: string;
      additionalAllowedTools?: readonly string[];
    }> = [];
    const runProvider = vi.fn(async (_run: unknown, args: (typeof providerTurns)[number]) => {
      providerTurns.push(args);
      // The real runner stamps the identity the Run minted on the session it was handed.
      await runStore.updateRunProviderIdentity(args.session.agentic_session_id, {
        providerSessionId: `provider-session-${String(providerTurns.length)}`,
        providerConversationId: null,
        providerSessionAgentId: args.session.provider_session_agent_id ?? null,
      });
      return {
        providerSessionId: `provider-session-${String(providerTurns.length)}`,
        providerConversationId: null,
        errorCount: 0,
      };
    });

    // Verify Feature reads the parent session through the model's tools, never in the CLI.
    const fetchImpl = vi.fn<typeof fetch>(() => {
      throw new Error('Verify Feature launch reached the platform unexpectedly.');
    });

    const handlerDeps = createPromptTypeHandlerTestDeps({
      runStore,
      fetchImpl,
      apiBaseUrl: 'https://api.example.test/api/v1',
      logger,
    });
    vi.mocked(handlerDeps.startupPromptInput.resolve).mockImplementation((request) =>
      Promise.resolve({
        startupInput: {
          task: { id: request.runEntity.entityId, taskType: 'FEATURE', description: '' },
          focalEntity: request.runEntity,
          adjacentScopeTasks: [],
          evidenceItems: [],
        },
        renderedInput: 'CURRENT ENTITY CONTEXT',
        loadedEntityContext: {
          kind: 'entity',
          focalEntity: request.runEntity,
          entity: {
            id: request.runEntity.entityId,
            name: 'Checkout flow',
            type: workItemType,
          } as never,
          context: {} as never,
        },
        provenance: {
          templateKey: 'test',
          ownershipSource: { scope: 'CANONICAL' },
          revisionId: 'test-revision',
          revisionNumber: 1,
        },
      }),
    );

    const wiring = createTestRunRegistryWiring({
      runStore,
      repoStore,
      logger,
      handlerDeps,
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
      createTestMessagePoster(),
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

  const parentAgentSessionId = randomUUID();
  const impactedMockupId = randomUUID();
  const concern = 'The checkout task shipped a retry loop the feature never mentions.';

  /** A start-run frame for the affected Feature carrying the flagged concern. */
  const startRunEvent = (operationId: string) => ({
    promptType: 'start_run',
    operationId,
    operationFingerprint: 'a'.repeat(64),
    triggerMessageId: randomUUID(),
    payload: {
      handlerPromptType: 'verify_feature',
      payload: {
        promptType: 'verify_feature',
        entity: { entityType: 'TASK', entityId: featureId },
        concern,
        parentAgentSessionId,
        impactedEntities: [{ entityType: 'MOCKUP', entityId: impactedMockupId }],
        userMessage: 'Please verify this concern.',
      },
      attachments: [],
      agentSessionId,
      model: 'claude-test',
      provider: 'claude',
      config: {
        type: 'ENTITY_CONVERSATION',
        version: 'v1',
        model: 'claude-test',
        verifyFeature: {
          concern,
          parentAgentSessionId,
          impactedEntities: [{ entityType: 'MOCKUP', entityId: impactedMockupId }],
        },
      },
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

  const userMessageEvent = (operationId: string, userMessage: string) => ({
    promptType: 'user_message',
    operationId,
    operationFingerprint: 'a'.repeat(64),
    triggerMessageId: randomUUID(),
    sourceUserMessageId: randomUUID(),
    payload: { handlerPromptType: 'verify_feature', userMessage, attachments: [] },
  });

  it('starts in the Verify Feature mode with the concern, the parent session and its own tool grant', async () => {
    const { errors, runStore, owner, providerTurns, admit, settled } = await harness();

    const launchKey = randomUUID();
    await admit(startRunEvent(launchKey), { key: launchKey, messageId: null });
    await vi.waitFor(() => expect(providerTurns).toHaveLength(1));
    await settled();

    const persisted = await runStore.getRun(agentSessionId);
    expect(persisted?.promptType).toBe('verify_feature');
    expect(persisted?.provider_session_agent_id).toBe('verify_feature');
    expect(persisted?.entity).toEqual({ entityType: 'TASK', entityId: featureId });
    expect(providerTurns[0]?.additionalAllowedTools).toContain('get_agent_session');
    expect(providerTurns[0]?.prompt).toContain(concern);
    expect(providerTurns[0]?.prompt).toContain(parentAgentSessionId);
    expect(providerTurns[0]?.prompt).toContain(`MOCKUP \`${impactedMockupId}\``);
    expect(providerTurns[0]?.prompt).toContain('Checkout flow');
    expect(providerTurns[0]?.prompt).toContain('Do not start or request another Feature Sync.');
    expect(errors.filter(({ event }) => event.includes('resolve_failed'))).toEqual([]);
    expect(
      (await owner.session(agentSessionId)).map((record) => [record.key, record.state]),
    ).toEqual([[launchKey, 'settled']]);
  });

  it('keeps a user reply in the Verify Feature mode on the same provider session', async () => {
    const { runStore, providerTurns, admit, settled } = await harness();

    const launchKey = randomUUID();
    await admit(startRunEvent(launchKey), { key: launchKey, messageId: null });
    await vi.waitFor(() => expect(providerTurns).toHaveLength(1));
    await settled();

    const replyKey = randomUUID();
    await admit(userMessageEvent(replyKey, 'Did the retry loop ever get a task?'), {
      key: replyKey,
      messageId: randomUUID(),
    });
    await vi.waitFor(() => expect(providerTurns).toHaveLength(2));
    await settled();

    expect(providerTurns[1]?.session.promptType).toBe('verify_feature');
    expect(providerTurns[1]?.prompt).toContain('Did the retry loop ever get a task?');
    const persisted = await runStore.getRun(agentSessionId);
    expect(persisted?.provider_session_agent_id).toBe('verify_feature');
    expect(providerTurns[1]?.session.provider_session_id).toBe('provider-session-1');
  });

  it('refuses to start on a work item that is not a Feature', async () => {
    workItemType = 'STANDARD';
    const { providerTurns, admit } = await harness();

    const launchKey = randomUUID();
    await admit(startRunEvent(launchKey), { key: launchKey, messageId: null });

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(providerTurns).toHaveLength(0);
  });
});

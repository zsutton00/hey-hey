import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { repositoryFeatureEnrichmentHandler } from '../agents/repository-feature-enrichment/repository-feature-enrichment.handler';
import { request } from '../agents/repository-feature-enrichment/repository-feature-enrichment.test-fixture';
import type { PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import { Run, type RunCollaborators } from './run';
import {
  createTestMessagePoster,
  createTestRepoMappingStore,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunnerPicker,
} from './run.test-support';
import type { RunnerContext } from './runners/types';

const RUN_ID = '77777777-7777-4777-8777-777777777777';

let root: string;
const openStore = (): RunStore =>
  new RunStore({
    paths: {
      baseDir: root,
      runsDir: path.join(root, 'runs'),
      indexPath: path.join(root, 'runs/index.json'),
      preferencesPath: path.join(root, 'preferences.json'),
    },
  });

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-handoff-runtime-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const createStoredRun = async (store: RunStore): Promise<AgenticSession> => {
  await store.initialize();
  return store.createRun({
    agentic_session_id: RUN_ID,
    // The Run starts on the start request's provider, not the handoff's.
    provider: 'claude',
    provider_session_id: `pending_${RUN_ID}`,
    provider_conversation_id: null,
    conversationId: request.conversationId,
    entity: null,
    services: [{ id: request.serviceId, path: '/tmp/repo' }],
    launchServiceId: request.serviceId,
    model: 'start-up-model',
    contextMetadata: {
      organizationId: 'organization',
      projectId: request.projectId,
      capturedAt: new Date().toISOString(),
      agentSessionId: RUN_ID,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  });
};

const openRun = (session: AgenticSession, store: RunStore, captured: RunnerContext[]): Run => {
  const collaborators: RunCollaborators = {
    runStore: store,
    repoStore: createTestRepoMappingStore(),
    poster: createTestMessagePoster(),
    broadcaster: createTestRunEventPublisher(),
    ...createTestRunOwnership(() => repositoryFeatureEnrichmentHandler),
    // Only the platform message-history read a reply makes is stubbed: an empty history.
    handlerDeps: {
      logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
      auth: { getAccessToken: async () => 'token' },
      apiBaseUrl: 'http://platform.test',
      fetchImpl: async () => Response.json({ data: [] }),
    } as unknown as PromptTypeHandlerDeps,
    runnerPicker: createTestRunnerPicker((ctx) => {
      captured.push(ctx);
      return {
        run: async () => {
          // The first turn mints the provider session a reply must resume.
          if (ctx.providerSessionDecision !== 'resume') {
            ctx.run.refreshSessionFields({
              provider_session_id: 'provider-session-1',
              provider_session_agent_id: ctx.handler.id,
            });
            ctx.run.setHasProviderSession(true, 'test runner minted the provider session');
          }
        },
      };
    }),
    logger: {
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as unknown as RunCollaborators['logger'],
  };

  return new Run(
    {
      runId: session.agentic_session_id,
      organizationId: 'organization',
      projectId: request.projectId,
      conversationId: request.conversationId,
      provider: session.provider as Run['provider'],
      session,
      hasProviderSession: false,
    },
    collaborators,
  );
};

const enrichmentInput = (payload: unknown): InternalRunPromptRequest =>
  ({
    promptType: 'repository_feature_enrichment',
    payload,
    references: { resolved: [], unresolved: [] },
    triggerContext: null,
  }) as InternalRunPromptRequest;

const settle = async (): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
};

describe('Run keeps the runtime a handoff selected', () => {
  it('runs enrichment replies on the handoff runtime, including after a restart', async () => {
    const store = openStore();
    const captured: RunnerContext[] = [];
    const run = openRun(await createStoredRun(store), store, captured);
    const handoffRuntime = {
      provider: request.provider,
      model: request.resolvedFrontierModel,
      reasoningEffort: request.reasoningEffort,
      fastMode: request.fastMode,
    };

    await run.handleMessage(enrichmentInput(request));
    await settle();
    await run.handleMessage(enrichmentInput({ userMessage: 'My answer' }));
    await vi.waitFor(() => expect(captured).toHaveLength(2));

    expect(captured).toHaveLength(2);
    expect(captured[1]!.providerSessionDecision).toBe('resume');
    for (const ctx of captured) {
      expect(ctx.run.provider).toBe(handoffRuntime.provider);
      expect(ctx.effectiveModel).toBe(handoffRuntime.model);
      expect(ctx.effectiveReasoningEffort).toBe(handoffRuntime.reasoningEffort);
      expect(ctx.run.session.fastMode).toBe(handoffRuntime.fastMode);
    }

    const restoredStore = openStore();
    await restoredStore.initialize();
    const restoredSession = (await restoredStore.getRun(RUN_ID))!;
    const restoredCaptured: RunnerContext[] = [];
    const restored = openRun(restoredSession, restoredStore, restoredCaptured);

    await restored.handleMessage(enrichmentInput({ userMessage: 'Another answer' }));
    await vi.waitFor(() => expect(restoredCaptured).toHaveLength(1));

    expect(restoredCaptured).toHaveLength(1);
    expect(restoredCaptured[0]!.run.provider).toBe(handoffRuntime.provider);
    expect(restoredCaptured[0]!.effectiveModel).toBe(handoffRuntime.model);
    expect(restoredCaptured[0]!.effectiveReasoningEffort).toBe(handoffRuntime.reasoningEffort);
    expect(restoredCaptured[0]!.run.session.fastMode).toBe(handoffRuntime.fastMode);
  });
});

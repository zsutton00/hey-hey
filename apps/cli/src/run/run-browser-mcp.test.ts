import { BrowserMcpAccess } from '../agents/browser-tools/browser-mcp-access';
import { browserHarness } from '../browser/__tests__/browser-test-support';
import { NOOP_LOGGER } from '../server/logger';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestRunEventPublisher,
  createTestMessagePoster,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunOwnership,
  createTestRunStore,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from './run.test-support';

import type { PromptTypeHandler, PromptTypeHandlerDeps } from '../agents/prompt-type-handler';
import type { RunStore } from '../run-store/run-store';
import type { InternalRunPromptRequest } from '../shared/agent-bridge-contract/contract';
import type { AgenticSession } from '../session/types';
import type { Runner } from '../turn/turn';
import { Run, type RunArgs, type RunCollaborators } from './run';
import { RunRegistry } from './run-registry';
import type { RunnerContext } from './runners/types';
import { RunLifecycleEvents } from '../server/run-lifecycle-events';

const handler: PromptTypeHandler<unknown> = {
  id: 'coding_freeform',
  promptType: 'coding_freeform',
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'gated_and_clarifiable',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => 'system prompt',
};

vi.mock('./resolve-prompt', () => ({
  resolvePrompt: () =>
    Promise.resolve({
      resolvedPrompt: 'resolved prompt',
      startingMessage: undefined,
      sessionContext: undefined,
      preparedPayload: undefined,
      isSubagentOwned: false,
      consumedPreviousProviderSession: false,
      promptTypeChanged: false,
    }),
}));

vi.mock('../server/services/run.service', () => ({
  validateResolvedPromptReferences: () => Promise.resolve(),
}));

const makeSession = (): AgenticSession =>
  ({
    agentic_session_id: 'run-1',
    provider: 'claude',
    provider_session_id: 'provider-session-1',
    provider_conversation_id: null,
    provider_session_agent_id: 'coding_freeform',
    status: 'ACTIVE',
    services: [{ id: 'svc-1', path: '/tmp/repo' }],
    launchServiceId: 'svc-1',
    conversationId: 'conv-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'proj-1',
    },
    events: [],
    promptType: 'coding_freeform',
  }) as unknown as AgenticSession;

const makeRunArgs = (session: AgenticSession = makeSession()): RunArgs => ({
  runId: 'run-1',
  organizationId: 'org-1',
  projectId: 'proj-1',
  conversationId: 'conv-1',
  provider: 'claude',
  session,
  hasProviderSession: true,
  skipProjectAssistant: true,
});

const makeBroadcaster = createTestRunEventPublisher;

const makePoster = () =>
  createTestMessagePoster({
    createOutOfBand: vi.fn().mockResolvedValue('message-1'),
  });

const makeRunStore = (): RunStore => {
  const store = createTestRunStore();
  vi.spyOn(store, 'updateRunPromptType').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunSessionContext').mockResolvedValue(makeSession());
  vi.spyOn(store, 'updateRunWorktreeState').mockResolvedValue(makeSession());
  vi.spyOn(store, 'addTouchedFiles').mockResolvedValue(undefined);
  vi.spyOn(store, 'addToolUsage').mockResolvedValue(undefined);
  vi.spyOn(store, 'updateRunPreviousProviderSession').mockResolvedValue(makeSession());
  vi.spyOn(store, 'getRun').mockResolvedValue(null);
  return store;
};

const makeLogger = (): RunCollaborators['logger'] =>
  ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  }) as unknown as RunCollaborators['logger'];

const makeCollaborators = (
  pickRunner: (ctx: RunnerContext) => Runner = () => ({ run: () => Promise.resolve() }),
): RunCollaborators => ({
  runStore: makeRunStore(),
  repoStore: createTestRepoMappingStore(),
  poster: makePoster(),
  broadcaster: makeBroadcaster(),
  ...createTestRunOwnership((promptType) =>
    promptType === 'coding_freeform' ? handler : undefined,
  ),
  handlerDeps: {} as unknown as PromptTypeHandlerDeps,
  runnerPicker: createTestRunnerPicker(pickRunner),
  logger: makeLogger(),
});

const makeRegistry = (
  collaborators: RunCollaborators,
  inactivityTimeoutMs = 0,
  forgetRun: (runId: string) => void = vi.fn(),
  runLifecycleEvents: RunLifecycleEvents = new RunLifecycleEvents(),
): RunRegistry => {
  const sessionRunnerFacade = createTestSessionRunnerFacade();
  vi.mocked(sessionRunnerFacade.forgetRun).mockImplementation(forgetRun);
  return new RunRegistry({
    runCollaborators: collaborators,
    submissionToolRegistry: collaborators.submissionToolRegistry,
    sessionRunnerFacade,
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents,
    ...(inactivityTimeoutMs > 0 ? { inactivityTimeoutMs } : {}),
  });
};

const makeInput = (): InternalRunPromptRequest => ({
  promptType: 'coding_freeform',
  payload: { promptType: 'coding_freeform', userMessage: 'continue' },
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
});

const finishOneTurn = async (run: Run): Promise<void> => {
  await run.handleMessage(makeInput());
  await run.awaitIdle();
};

describe('Run browser MCP continuity', () => {
  it('retains the page through a second message, provider rotation and idle re-materialization', async () => {
    const h = browserHarness();
    const lifecycle = new RunLifecycleEvents();
    const access = new BrowserMcpAccess(h.manager, lifecycle, h.tabs, NOOP_LOGGER);
    const pages: string[] = [];
    const tokens: string[] = [];
    const collaborators = makeCollaborators((ctx) => ({
      run: async () => {
        const mount = ctx.browserMcpMount!;
        expect(access.resolve(mount.token)).toBe(mount);
        tokens.push(mount.token);
        pages.push(
          await h.tabs.use(
            ctx.run.runId,
            ctx.run.projectId,
            async (_, selected) => selected.id,
            () => access.admitted(mount),
          ),
        );
      },
    }));
    collaborators.browserMcpAccess = access;
    const registry = makeRegistry(collaborators, 0, vi.fn(), lifecycle);
    access.bindRegistry(registry);
    const session = makeSession();
    const first = registry.create(makeRunArgs(session));
    await finishOneTurn(first);
    await finishOneTurn(first);
    first.hasProviderSession = false;
    await finishOneTurn(first);
    registry.claimAndEvict(first);
    expect(h.pages[0]!.closed).toBe(false);
    expect(access.resolve(tokens[2]!)).toBeNull();
    const restored = registry.create(makeRunArgs(session));
    await finishOneTurn(restored);
    expect(new Set(pages).size).toBe(1);
    expect(new Set(tokens).size).toBe(4);
    registry.remove(restored.runId, restored);
    await access.dispose();
    expect(h.pages[0]!.closed).toBe(true);
  });
  it('attaches pending annotations to the next user message and clears them after the Turn begins', async () => {
    const h = browserHarness();
    const prompts: string[] = [];
    let failNextPick = false;
    const collaborators = makeCollaborators((ctx) => {
      if (failNextPick) {
        failNextPick = false;
        throw new Error('runner unavailable');
      }
      prompts.push(ctx.resolvedPrompt);
      return { run: () => Promise.resolve() };
    });
    collaborators.browserAnnotations = h.tabs.annotations;
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    await h.tabs.use(run.runId, run.projectId, async () => {});
    await h.pages[0]!.goto('http://localhost:3000/settings');
    await h.annotate(h.pages[0]!, {
      op: 'add',
      annotation: {
        selector: '[data-testid="save-btn"]',
        role: 'button',
        text: 'Save changes',
        note: 'misaligned',
      },
    });
    const block = [
      'Browser annotations:',
      '1. localhost:3000/settings - [data-testid="save-btn"] button "Save changes"',
      '   Note: misaligned',
    ].join('\n');

    // A Run-owned input that is not the user's message leaves them pending.
    await finishOneTurn(run);
    expect(prompts[0]).toBe('resolved prompt');
    expect(h.tabs.annotations.pending(run.runId)).toHaveLength(1);

    failNextPick = true;
    await expect(run.handleMessage(makeInput(), { sourceUserMessageId: 'm-1' })).rejects.toThrow(
      'runner unavailable',
    );
    expect(h.tabs.annotations.pending(run.runId)).toHaveLength(1);

    await run.handleMessage(makeInput(), { sourceUserMessageId: 'm-2' });
    await run.awaitIdle();
    expect(prompts[1]).toBe(`resolved prompt\n\n${block}`);
    expect(h.tabs.annotations.pending(run.runId)).toEqual([]);

    await run.handleMessage(makeInput(), { sourceUserMessageId: 'm-3' });
    await run.awaitIdle();
    expect(prompts[2]).toBe('resolved prompt');
    registry.dispose();
    await h.tabs.dispose();
  });
  it('opens a selected Run tab for the user and tells the next user message once', async () => {
    const h = browserHarness();
    const prompts: string[] = [];
    const collaborators = makeCollaborators((ctx) => {
      prompts.push(ctx.resolvedPrompt);
      return { run: () => Promise.resolve() };
    });
    collaborators.browserTabNotices = h.tabs.notices;
    const registry = makeRegistry(collaborators);
    const run = registry.create(makeRunArgs());
    await h.tabs.use(run.runId, run.projectId, async (_family, owned) => {
      await owned.page.goto('http://localhost:3000/agent');
    });

    await h.tabs.open(run.runId, run.projectId, 'http://localhost:3000/user');
    h.tabs.notices.record(run.runId, { id: 'notice-1', url: 'http://localhost:3000/user' });
    expect(h.pages).toHaveLength(2);
    await h.tabs.use(run.runId, run.projectId, async (_family, selected) => {
      expect(selected.page.url()).toBe('http://localhost:3000/user');
    });

    // A Run-owned input that is not the user's message leaves it pending.
    await finishOneTurn(run);
    expect(prompts[0]).toBe('resolved prompt');
    expect(h.tabs.notices.pending(run.runId)).not.toBeNull();

    await run.handleMessage(makeInput(), { sourceUserMessageId: 'm-1' });
    await run.awaitIdle();
    expect(prompts[1]).toBe(
      'resolved prompt\n\nBrowser tab: the user opened a browser tab at http://localhost:3000/user. It is now the selected page for your browser tools.',
    );
    expect(h.tabs.notices.pending(run.runId)).toBeNull();

    await run.handleMessage(makeInput(), { sourceUserMessageId: 'm-2' });
    await run.awaitIdle();
    expect(prompts[2]).toBe('resolved prompt');
    registry.dispose();
    await h.tabs.dispose();
  });
  it('does not mount tools or launch Chrome when disabled', async () => {
    const h = browserHarness();
    await h.manager.setEnabled(false);
    const lifecycle = new RunLifecycleEvents();
    const access = new BrowserMcpAccess(h.manager, lifecycle, h.tabs, NOOP_LOGGER);
    const seen = vi.fn();
    const collaborators = makeCollaborators((ctx) => ({
      run: async () => {
        seen(ctx.browserMcpMount);
      },
    }));
    collaborators.browserMcpAccess = access;
    const registry = makeRegistry(collaborators, 0, vi.fn(), lifecycle);
    access.bindRegistry(registry);
    await finishOneTurn(registry.create(makeRunArgs()));
    expect(seen).toHaveBeenCalledWith(undefined);
    expect(h.getBrowser).not.toHaveBeenCalled();
    registry.dispose();
    await access.dispose();
  });
});

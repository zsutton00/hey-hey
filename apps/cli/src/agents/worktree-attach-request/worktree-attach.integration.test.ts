/** @vitest-environment node */

import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LocalPromptType } from '@hey-hey/contracts/agent-bridge';
import type {
  AgentRequestWorktreeAttachPayload,
  AgentSessionConfig,
  SystemMessageData,
} from '@hey-hey/contracts/api/models';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { toRepositoryPath, toServiceId } from '../../repo';
import { RunStore } from '../../run-store/run-store';
import { MessagePoster } from '../../run/message-poster';
import { renderServiceScopeRecovery } from '../../run/resolve-prompt';
import { Run } from '../../run/run';
import { RunRegistry } from '../../run/run-registry';
import {
  createTestMessagePoster,
  createTestMonitorProjectContext,
  createTestRepoMappingStore,
  createTestRunEventPublisher,
  createTestRunOwnership,
  createTestRunnerPicker,
  createTestSessionRunnerFacade,
} from '../../run/run.test-support';
import { RunLifecycleEvents } from '../../server/run-lifecycle-events';
import { NOOP_LOGGER } from '../../server/logger';
import type { AgenticSession, CreateAgenticSessionInput } from '../../session/types';
import type { InternalRunPromptRequest } from '../../shared/agent-bridge-contract/contract';
import { freeFormHandler } from '../coding-conversation/coding-conversation.handler';
import type { PromptTypeHandlerDeps } from '../prompt-type-handler';
import { PromptTypeRegistry } from '../prompt-type-registry';
import { PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES } from '../prompt-type-registry.test-support';
import { resolveRunWorkspace } from '../run-scope';
import { codingWorktreeAttachGuidance } from '../prompts/common';
import { requestAgentSessionServiceScopeTool } from '../service-scope-request/service-scope-tool';
import { projectModeHandler } from '../project-mode/project-mode.handler';
import { requestAgentSessionWorktreeAttachTool } from './worktree-attach-tool';

const SERVICE_ID = '00000000-0000-4000-8000-00000000000a';
const OUTSIDE_SERVICE_ID = '00000000-0000-4000-8000-00000000000b';
const RUN_ID = '00000000-0000-4000-8000-000000000001';
const ENTITY = { entityType: 'TASK', entityId: '22222222-2222-4222-8222-222222222222' } as const;

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

let root: string;
let repo: string;
const openRuns: Run[] = [];

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'worktree-attach-')));
  repo = path.join(root, 'service');
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  git(repo, 'commit', '-q', '--allow-empty', '-m', 'initial');
});

afterEach(async () => {
  for (const run of openRuns.splice(0)) {
    await run.awaitIdle();
    run.cleanup();
  }
  await rm(root, { recursive: true, force: true });
});

const addWorktree = (branch: string): string => {
  const worktreePath = path.join(root, 'worktrees', branch.replaceAll('/', '-'));
  git(repo, 'worktree', 'add', '-q', '-b', branch, worktreePath);
  return worktreePath;
};

const openStore = async (): Promise<RunStore> => {
  const baseDir = path.join(root, 'store');
  const store = new RunStore({
    paths: {
      baseDir,
      runsDir: path.join(baseDir, 'runs'),
      indexPath: path.join(baseDir, 'runs', 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  await store.initialize();
  return store;
};

interface SessionOptions {
  contextMetadata?: Record<string, string>;
  session?: Partial<CreateAgenticSessionInput>;
}

const createSession = (store: RunStore, options: SessionOptions = {}): Promise<AgenticSession> =>
  store.createRun({
    agentic_session_id: RUN_ID,
    entity: null,
    services: [{ id: SERVICE_ID, path: repo }],
    launchServiceId: SERVICE_ID,
    provider: 'claude',
    provider_session_id: '',
    provider_conversation_id: null,
    conversationId: 'conversation-1',
    contextMetadata: {
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: RUN_ID,
      capturedAt: '2026-11-20T00:00:00.000Z',
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
      ...options.contextMetadata,
    },
    ...options.session,
  });

type Work = (run: Run) => Promise<void>;

/** A real Run over real storage and git; only the platform and provider are faked. */
const startRun = (store: RunStore, session: AgenticSession, work: Work = async () => {}) => {
  const poster = createTestMessagePoster({ createOutOfBand: vi.fn(async () => 'card-message-1') });
  const broadcaster = createTestRunEventPublisher();
  const monitorAdmit = vi.fn();
  const repoStore = createTestRepoMappingStore(async (serviceId) =>
    serviceId === toServiceId(SERVICE_ID)
      ? {
          serviceId,
          repositoryPath: toRepositoryPath(repo),
          createdAt: '2026-11-20T00:00:00.000Z',
          updatedAt: '2026-11-20T00:00:00.000Z',
        }
      : null,
  );
  const run = new Run(
    {
      runId: RUN_ID,
      organizationId: 'org-1',
      projectId: 'project-1',
      conversationId: 'conversation-1',
      provider: 'claude',
      session,
      skipProjectAssistant: true,
    },
    {
      runStore: store,
      repoStore,
      poster,
      broadcaster,
      ...createTestRunOwnership(),
      handlerDeps: {
        auth: { getAccessToken: async () => 'token' },
        apiBaseUrl: 'https://api.example.test/api/v1',
        fetchImpl: async () => Response.json({ data: { results: [] } }),
      } as unknown as PromptTypeHandlerDeps,
      runnerPicker: createTestRunnerPicker((ctx) => ({ run: () => work(ctx.run) })),
      taskMonitorServiceScopeAdmission: () => ({ admit: monitorAdmit }) as never,
      logger: NOOP_LOGGER,
    },
  );
  openRuns.push(run);

  const currentState = (): string | undefined =>
    vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mock.lastCall?.[0].currentState;
  const postedCards = (): SystemMessageData[] =>
    vi
      .mocked(poster.createOutOfBand)
      .mock.calls.map(([message]) => message.dto.data as SystemMessageData);

  return { run, currentState, postedCards, monitorAdmit };
};

const message: InternalRunPromptRequest = {
  promptType: LocalPromptType.CodingFreeform,
  payload: { promptType: LocalPromptType.CodingFreeform, userMessage: 'do work' } as NonNullable<
    InternalRunPromptRequest['payload']
  >,
  references: { resolved: [], unresolved: [] },
  triggerContext: null,
};

const callTool = async (
  run: Run,
  args: { serviceId?: string; branch: string; reason?: string },
): Promise<string> => {
  const result = await requestAgentSessionWorktreeAttachTool.execute({
    run,
    runId: RUN_ID,
    args: { serviceId: SERVICE_ID, reason: 'The work is on that branch.', ...args },
  } as never);
  return result.content
    .map((content) => ('text' in content ? String(content['text']) : ''))
    .join('');
};

const runTurn = async (store: RunStore, session: AgenticSession, work: Work) => {
  const harness = startRun(store, session, work);
  await harness.run.handleMessage(message);
  await harness.run.awaitIdle();
  return harness;
};

const requestOn = (card: SystemMessageData) =>
  (card.uiElements?.[0]?.payload as AgentRequestWorktreeAttachPayload).worktreeAttachRequest;

const addUnreadableSavedRequest = async (): Promise<void> => {
  const runsDir = path.join(root, 'store', 'runs');
  for (const name of await readdir(runsDir, { recursive: true })) {
    const file = path.join(runsDir, name);
    const text = await readFile(file, 'utf8').catch(() => '');
    if (!text.includes('"worktreeAttachRequestPresentations"')) {
      continue;
    }
    const metadata = JSON.parse(text) as { worktreeAttachRequestPresentations: unknown[] };
    metadata.worktreeAttachRequestPresentations.push({ messageId: 'unreadable' });
    await writeFile(file, JSON.stringify(metadata));
    return;
  }
  throw new Error('No saved Run holds a worktree attach request.');
};

describe('worktree attach request', () => {
  it('refuses what cannot be attached, with the reason, and posts nothing', async () => {
    const store = await openStore();
    const replies: string[] = [];

    const { postedCards, currentState } = await runTurn(
      store,
      await createSession(store),
      async (run) => {
        replies.push(await callTool(run, { serviceId: OUTSIDE_SERVICE_ID, branch: 'feature/a' }));
        replies.push(await callTool(run, { branch: 'feature/missing' }));
        replies.push(await callTool(run, { branch: 'main' }));
      },
    );

    expect(replies[0]).toContain('request_agent_session_service_scope');
    expect(replies[1]).toContain('No registered worktree for branch feature/missing');
    expect(replies[2]).toContain('No registered worktree for branch main');
    expect(postedCards()).toEqual([]);
    expect(currentState()).not.toBe('AWAITING_APPROVAL');
  });

  it('treats the worktree already in use as a no-op', async () => {
    const worktreePath = addWorktree('feature/a');
    const store = await openStore();
    const session = await createSession(store, {
      session: {
        servicePlaceChoices: [
          { serviceId: SERVICE_ID, kind: 'WORKTREE', branch: 'feature/a', newBranch: false },
        ],
      },
    });
    let reply = '';

    const { postedCards } = await runTurn(store, session, async (run) => {
      reply = await callTool(run, { branch: 'feature/a' });
    });

    expect(reply).toContain(`already attached at ${worktreePath}`);
    expect(postedCards()).toEqual([]);
  });

  it('posts one card, waits for the person and changes nothing about where the Run works', async () => {
    const target = addWorktree('feature/changes');
    const store = await openStore();
    const replies: string[] = [];
    let during: AgenticSession | undefined;

    const { run, postedCards, currentState, monitorAdmit } = await runTurn(
      store,
      await createSession(store, { contextMetadata: { taskMonitorId: 'monitor-1' } }),
      async (activeRun) => {
        during = activeRun.session;
        replies.push(
          ...(await Promise.all([
            callTool(activeRun, { branch: 'feature/changes' }),
            callTool(activeRun, { branch: 'feature/changes' }),
          ])),
        );
        replies.push(await callTool(activeRun, { branch: 'feature/changes', reason: 'Another.' }));
      },
    );

    expect(postedCards()).toHaveLength(1);
    expect(replies[1]).toContain('already awaiting user review');
    expect(replies[2]).toContain('Another request in this session is already awaiting');

    const request = requestOn(postedCards()[0]!);
    expect(postedCards()[0]).toMatchObject({
      triggerNotification: true,
      uiElements: [
        {
          id: `agent-request-worktree-attach:${request.id}`,
          type: 'agent-request-worktree-attach',
          payload: { responseType: 'agent_request_worktree_attach_v1' },
        },
      ],
    });
    expect(request).toMatchObject({
      runId: RUN_ID,
      sessionId: RUN_ID,
      serviceId: SERVICE_ID,
      branch: 'feature/changes',
      worktreePath: target,
      reason: 'The work is on that branch.',
      currentPlace: { kind: 'MAIN_FOLDER', branch: 'main' },
      planBranch: null,
    });

    expect(currentState()).toBe('AWAITING_APPROVAL');
    expect(monitorAdmit).not.toHaveBeenCalled();
    await expect(run.handleMessage(message)).rejects.toThrow('awaiting a scope-review decision');

    const saved = (await store.getRun(RUN_ID))!;
    for (const after of [run.session, saved]) {
      expect(after.services).toEqual(during!.services);
      expect(after.scope).toEqual(during!.scope);
      expect(after.worktreeState).toBeUndefined();
      expect(after.servicePlaceChoices).toBeUndefined();
    }
    expect(saved.serviceScopeContinuation).toMatchObject({ delivery: 'pending' });
  });

  it('shows a plan session its worktree and the branch the plan keeps', async () => {
    const current = addWorktree('plan/commit-modal');
    addWorktree('fix/pairing-poll');
    const store = await openStore();
    const session = await createSession(store, {
      contextMetadata: { launchPlanId: 'plan-1' },
      session: { worktree: { enabled: true, branch: 'plan/commit-modal' } },
    });

    const { postedCards } = await runTurn(store, session, async (run) => {
      await callTool(run, { branch: 'fix/pairing-poll' });
    });

    expect(requestOn(postedCards()[0]!)).toMatchObject({
      currentPlace: { kind: 'WORKTREE', branch: 'plan/commit-modal', worktreePath: current },
      planBranch: 'plan/commit-modal',
    });
  });

  it('is still pending, with the same identity, after a CLI restart', async () => {
    addWorktree('feature/changes');
    const store = await openStore();
    const before = await runTurn(store, await createSession(store), async (run) => {
      await callTool(run, { branch: 'feature/changes' });
    });
    const request = requestOn(before.postedCards()[0]!);
    await vi.waitFor(async () => {
      expect((await store.getRun(RUN_ID))?.worktreeAttachRequestPresentations).toHaveLength(1);
    });
    // One unreadable saved request must not cost the Run its readable one.
    await addUnreadableSavedRequest();

    const restartedStore = await openStore();
    const after = startRun(restartedStore, (await restartedStore.getRun(RUN_ID))!);

    expect(after.run.serviceScope.getWorktreeAttachRequest(request.id)).toMatchObject({
      request,
      messageId: 'card-message-1',
    });
    expect(after.currentState()).toBe('AWAITING_APPROVAL');
    expect(after.run.serviceScope.isServiceScopeApprovalPauseActive()).toBe(true);
    await expect(after.run.handleMessage(message)).rejects.toThrow(
      'awaiting a scope-review decision',
    );
  });
});

describe('starting instructions and worktrees', () => {
  const projectModeConfig = {
    type: 'CODING_SESSION',
    version: 'v2',
    model: 'test-model',
    projectModeSelection: { schemaVersion: 'project-mode-selection.v1', modeId: ENTITY.entityId },
    projectModeSnapshot: {
      schemaVersion: 'project-mode-snapshot.v1',
      modeId: ENTITY.entityId,
      catalogDescription: 'A careful coding mode.',
      applicableWorkItemTypeKeys: ['STANDARD'],
      files: {
        schemaVersion: 'project-mode-files.v1',
        files: { 'MODE.md': 'Work carefully.' },
      },
      snapshotHash: 'a'.repeat(64),
    },
  } satisfies AgentSessionConfig;

  /** Resolves the workspace as a real Turn does, then renders both handlers' own prompt path. */
  const renderStartingInstructions = async (): Promise<string[]> => {
    await rm(path.join(root, 'store'), { recursive: true, force: true });
    const store = await openStore();
    let resolved: AgenticSession | undefined;
    await runTurn(store, await createSession(store), async (run) => {
      resolved = run.session;
    });
    const deps = { logger: NOOP_LOGGER } as unknown as PromptTypeHandlerDeps;

    const freeFormPayload = {
      promptType: LocalPromptType.FreeForm,
      entity: ENTITY,
      userMessage: 'do work',
    } as Parameters<typeof freeFormHandler.buildPrompt>[0];
    const entitySession = { ...resolved!, entity: ENTITY };
    const freeForm = await freeFormHandler.prepare!(entitySession, freeFormPayload, deps);

    const projectModeSession = { ...entitySession, config: projectModeConfig };
    const projectMode = await projectModeHandler.prepare!(
      projectModeSession,
      { promptType: LocalPromptType.ProjectMode, entity: ENTITY, userMessage: 'do work' },
      deps,
      { projectModeBundleDirectory: '/bundle' } as never,
    );

    return [
      freeFormHandler.buildPrompt(freeForm.payload),
      projectModeHandler.buildPrompt(projectMode.payload),
    ];
  };

  it('offer the attach request and explain it wherever Service access can be requested', () => {
    const offering = new PromptTypeRegistry(PROMPT_TYPE_REGISTRY_TEST_DEPENDENCIES)
      .list()
      .filter((handler) =>
        handler.submissionTools?.some((tool) => tool === requestAgentSessionServiceScopeTool),
      );
    const payload = {
      entity: ENTITY,
      userMessage: 'do work',
      _projectMode: { snapshot: projectModeConfig.projectModeSnapshot },
      _bundleLocation: '/bundle',
    };

    expect(offering.map((handler) => handler.id).sort()).toEqual([
      'coding_freeform',
      'debug',
      'entity_conversation',
      'free_form',
      'implement',
      'project_mode',
      'verify_feature',
    ]);
    for (const handler of offering) {
      expect(handler.submissionTools).toContain(requestAgentSessionWorktreeAttachTool);
      // Verify Feature borrows the conversation's tools and edits no repository.
      if (handler.id === 'verify_feature') {
        continue;
      }
      expect(handler.buildPrompt({ ...payload, promptType: handler.promptType })).toContain(
        codingWorktreeAttachGuidance,
      );
    }
  });

  it('name the place in use and never grow with the number of worktrees', async () => {
    const withNone = await renderStartingInstructions();
    for (let index = 0; index < 30; index += 1) {
      addWorktree(`feature/forgotten-${String(index)}`);
    }

    const withMany = await renderStartingInstructions();

    expect(withMany).toEqual(withNone);
    for (const instructions of withMany) {
      expect(instructions).toContain(`main folder \`${repo}\` on branch \`main\``);
      expect(instructions).toContain('git worktree list');
      expect(instructions).toContain('request_agent_session_worktree_attach');
    }
  });
});

const MACHINE_ID = '00000000-0000-4000-8000-0000000000aa';

/**
 * The platform as the decision sees it: it keeps the card the CLI stores and, like the real
 * endpoint, moves the Service only against a stored card that already shows the approval.
 */
class FakePlatform {
  public readonly cards = new Map<string, SystemMessageData>();
  public readonly attachCalls: Record<string, unknown>[] = [];
  public recordedPlace: Record<string, unknown> | null = null;
  public failAttachWith: Response | null = null;
  /** Where the platform says the Service works after a change; the requested worktree by default. */
  public answerWith: ((change: Record<string, unknown>) => Record<string, unknown>) | null = null;
  /** How many of the next card updates the platform rejects. */
  public failCardUpdates = 0;

  public readonly fetchImpl = async (url: string | URL, init?: RequestInit): Promise<Response> => {
    if (!String(url).endsWith('/service-places/attach')) {
      return Response.json({ data: { results: [] } });
    }
    const change = JSON.parse(String(init?.body)) as Record<string, unknown>;
    this.attachCalls.push(change);
    if (this.failAttachWith) {
      return this.failAttachWith;
    }
    const approved = [...this.cards.values()].some((card) => {
      const payload = card.uiElements?.[0]?.payload as AgentRequestWorktreeAttachPayload;
      return (
        payload.decision === 'approve' &&
        Boolean(payload.decidedAt) &&
        !payload.failureReason &&
        payload.worktreeAttachRequest.id === change['requestId'] &&
        payload.worktreeAttachRequest.worktreePath === change['worktreePath']
      );
    });
    if (!approved) {
      return new Response('NOT_APPROVED', { status: 400 });
    }
    this.recordedPlace = this.answerWith?.(change) ?? {
      serviceId: change['serviceId'],
      kind: 'WORKTREE',
      branch: change['branch'],
      worktreePath: change['worktreePath'],
    };
    return Response.json({ data: { servicePlaces: [this.recordedPlace] } });
  };

  public card(): AgentRequestWorktreeAttachPayload {
    const [card] = [...this.cards.values()];
    return card!.uiElements![0]!.payload as AgentRequestWorktreeAttachPayload;
  }
}

interface SeenTurn {
  prompt: string;
  recovery: string | null;
}

const startDecidingRun = (store: RunStore, session: AgenticSession, platform: FakePlatform) => {
  const poster = new MessagePoster({
    apiClient: {
      postMessage: async () => {
        throw new Error('Only the request card is created in these tests.');
      },
      updateMessage: async ({ id, updateMessageDto }) => {
        if (platform.failCardUpdates > 0) {
          platform.failCardUpdates -= 1;
          throw new Error('message service unavailable');
        }
        platform.cards.set(id, updateMessageDto.data as SystemMessageData);
        return {} as never;
      },
    },
    logger: NOOP_LOGGER,
    dataDir: path.join(root, 'poster'),
  });
  vi.spyOn(poster, 'createOutOfBand').mockImplementation(async () => 'card-message-1');
  const turns: SeenTurn[] = [];
  let firstTurn = true;
  const repoStore = createTestRepoMappingStore(async (serviceId) => ({
    serviceId,
    repositoryPath: toRepositoryPath(repo),
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-20T00:00:00.000Z',
  }));
  const broadcaster = createTestRunEventPublisher();
  const ownership = createTestRunOwnership();
  const registry = new RunRegistry({
    runCollaborators: {
      runStore: store,
      repoStore,
      poster,
      broadcaster,
      ...ownership,
      handlerDeps: {
        auth: { getAccessToken: async () => 'token' },
        apiBaseUrl: 'https://api.example.test/api/v1',
        fetchImpl: platform.fetchImpl,
      } as unknown as PromptTypeHandlerDeps,
      keyPairStore: { loadCurrentMachineId: async () => MACHINE_ID } as never,
      runnerPicker: createTestRunnerPicker((ctx) => ({
        run: async () => {
          turns.push({
            prompt: ctx.resolvedPrompt,
            recovery: ctx.serviceScopeRecovery
              ? renderServiceScopeRecovery(ctx.serviceScopeRecovery)
              : null,
          });
          if (firstTurn) {
            firstTurn = false;
            // The provider session the attach must not resume from another folder.
            ctx.run.setHasProviderSession(true, 'test-provider-session');
            await callTool(ctx.run, { branch: 'feature/changes' });
          }
        },
      })),
      logger: NOOP_LOGGER,
    },
    submissionToolRegistry: ownership.submissionToolRegistry,
    sessionRunnerFacade: createTestSessionRunnerFacade(),
    monitorProjectContext: createTestMonitorProjectContext(),
    runLifecycleEvents: new RunLifecycleEvents(),
  });
  const run = registry.create({
    runId: RUN_ID,
    organizationId: 'org-1',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    provider: 'claude',
    session,
    skipProjectAssistant: true,
  });
  openRuns.push(run);
  const currentState = (): string | undefined =>
    vi.mocked(broadcaster.emitAgentSessionCurrentStateObservation).mock.lastCall?.[0].currentState;
  return { run, registry, turns, currentState };
};

/** Runs the Turn that asks to attach `feature/changes`, then answers the card as the person. */
const requestThenDecide = async (
  options: {
    platform?: FakePlatform;
    session?: SessionOptions;
    beforeDecision?: (context: { run: Run; store: RunStore }) => Promise<void> | void;
    decision?: 'approve' | 'deny';
  } = {},
) => {
  const platform = options.platform ?? new FakePlatform();
  const store = await openStore();
  const harness = startDecidingRun(store, await createSession(store, options.session), platform);
  await harness.run.handleMessage(message);
  await harness.run.awaitIdle();
  const pending = [...(harness.run.session.worktreeAttachRequestPresentations ?? [])];
  const request = pending[0]!.request;
  const before = structuredClone(harness.run.session);
  await options.beforeDecision?.({ run: harness.run, store });

  // A monitored Run still hands an attach to the person, never to the Task Monitor.
  await expect(
    harness.registry.classifyPermissionDecisionOwner(
      RUN_ID,
      request.id,
      request.idempotencyToken,
      'monitor-1',
    ),
  ).resolves.toEqual({ kind: 'worktree_attach' });

  const answer = async (decision = options.decision ?? 'approve') => {
    const answered = await harness.registry.submitPermissionDecision(RUN_ID, {
      runId: RUN_ID,
      requestId: request.id,
      sessionId: request.sessionId,
      agentType: request.agentType,
      decision,
      reason: null,
      idempotencyToken: request.idempotencyToken,
    });
    await harness.run.awaitIdle();
    return answered;
  };
  const result = await answer();
  return { ...harness, platform, store, request, before, result, answer };
};

/** Starts the Turn the person sends next, so what the agent is told can be read. */
const nextTurnPrompt = async (run: Run, turns: SeenTurn[]): Promise<string> => {
  await run.handleMessage(message);
  await run.awaitIdle();
  return turns.at(-1)!.prompt;
};

const expectNothingChanged = async (
  outcome: Awaited<ReturnType<typeof requestThenDecide>>,
): Promise<void> => {
  const saved = (await outcome.store.getRun(RUN_ID))!;
  for (const after of [outcome.run.session, saved]) {
    expect(after.scope).toEqual(outcome.before.scope);
    expect(after.worktreeState).toEqual(outcome.before.worktreeState);
    expect(after.servicePlaceChoices).toEqual(outcome.before.servicePlaceChoices);
  }
  expect(git(repo, 'branch', '--show-current')).toBe('main');
};

describe('worktree attach decision', () => {
  it('moves the session into the approved worktree after the platform records it', async () => {
    const target = addWorktree('feature/changes');
    await writeFile(path.join(repo, 'uncommitted.txt'), 'left in the main folder');

    const outcome = await requestThenDecide();

    expect(outcome.result).toEqual({
      outcome: 'delivered',
      callbackType: 'worktree_attach_decision',
    });
    // The card was stored as approved before the platform was asked to move the Service.
    expect(outcome.platform.attachCalls).toEqual([
      {
        machineId: MACHINE_ID,
        serviceId: SERVICE_ID,
        branch: 'feature/changes',
        worktreePath: target,
        requestId: outcome.request.id,
      },
    ]);
    expect(outcome.platform.card()).toMatchObject({ decision: 'approve' });
    expect(outcome.platform.card().decidedAt).toBeTruthy();
    expect(outcome.platform.card().failureReason).toBeUndefined();

    const saved = (await outcome.store.getRun(RUN_ID))!;
    for (const after of [outcome.run.session, saved]) {
      expect(after.worktreeState?.[SERVICE_ID]).toEqual({
        worktreePath: target,
        branch: 'feature/changes',
        repoPath: repo,
      });
      expect(after.servicePlaceChoices).toEqual([
        { serviceId: SERVICE_ID, kind: 'WORKTREE', branch: 'feature/changes', newBranch: false },
      ]);
      expect(after.launchServiceId).toBe(SERVICE_ID);
      expect(after.reportedServicePlaceServiceIds).toContain(SERVICE_ID);
    }
    // The continuation edits only in the worktree, never in the folder it left.
    const workspace = await resolveRunWorkspace({
      session: outcome.run.session,
      repoStore: createTestRepoMappingStore(async () => null),
    });
    expect(workspace).toMatchObject({ ok: true, cwd: target, allowedRepositoryRoots: [target] });

    // Nothing moved between the folders, and the main folder kept its branch.
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(await readFile(path.join(repo, 'uncommitted.txt'), 'utf8')).toBe(
      'left in the main folder',
    );
    await expect(readFile(path.join(target, 'uncommitted.txt'), 'utf8')).rejects.toThrow();

    // The working folder changed, so a replacement provider session continued once from the
    // checkpoint and was told where it works now and what it left behind.
    await vi.waitFor(() => expect(outcome.turns).toHaveLength(2));
    await outcome.run.awaitIdle();
    const continued = outcome.turns[1]!;
    expect(continued.recovery).toContain('after an approved worktree attach');
    expect(continued.recovery).toContain(
      `now works in the worktree ${target} on branch feature/changes`,
    );
    expect(continued.recovery).toContain(`previously worked in ${repo}`);
    expect(continued.recovery).toContain('Nothing was moved or copied between the two folders');
    expect(outcome.currentState()).not.toBe('AWAITING_APPROVAL');
  });

  it('keeps the plan branch while this session moves', async () => {
    addWorktree('plan/commit-modal');
    const target = addWorktree('feature/changes');

    const outcome = await requestThenDecide({
      session: {
        contextMetadata: { launchPlanId: 'plan-1' },
        session: { worktree: { enabled: true, branch: 'plan/commit-modal' } },
      },
    });

    expect(outcome.result.outcome).toBe('delivered');
    expect(outcome.run.session.worktree).toEqual({ enabled: true, branch: 'plan/commit-modal' });
    expect(outcome.run.session.worktreeState?.[SERVICE_ID]?.worktreePath).toBe(target);
  });

  it('refuses a worktree that is gone by the time the person approves, and changes nothing', async () => {
    const target = addWorktree('feature/changes');

    const outcome = await requestThenDecide({
      beforeDecision: () => {
        git(repo, 'worktree', 'remove', target);
      },
    });

    expect(outcome.result).toEqual({
      outcome: 'failed',
      reason: `${target} is no longer a worktree of this Service's repository.`,
    });
    expect(outcome.platform.attachCalls).toEqual([]);
    expect(outcome.platform.card()).toMatchObject({
      decision: 'approve',
      failureReason: `${target} is no longer a worktree of this Service's repository.`,
    });
    await expectNothingChanged(outcome);
    expect(await nextTurnPrompt(outcome.run, outcome.turns)).toContain(
      `Attaching the worktree for branch feature/changes at ${target} failed`,
    );
  });

  it('keeps the editable folders when the platform cannot record the place', async () => {
    addWorktree('feature/changes');
    const platform = new FakePlatform();
    platform.failAttachWith = new Response('database unavailable', { status: 500 });

    const outcome = await requestThenDecide({ platform });

    expect(outcome.result).toEqual({
      outcome: 'failed',
      reason: 'Recording the new place failed with status 500: database unavailable',
    });
    expect(outcome.platform.card().failureReason).toBe(
      'Recording the new place failed with status 500: database unavailable',
    );
    await expectNothingChanged(outcome);
    expect(outcome.run.session.reportedServicePlaceServiceIds ?? []).not.toContain(SERVICE_ID);
  });

  it('keeps the editable folders when the platform answered success without moving the Service', async () => {
    addWorktree('feature/changes');
    const elsewhere = addWorktree('feature/later');
    const platform = new FakePlatform();
    platform.answerWith = (change) => ({
      serviceId: change['serviceId'],
      kind: 'WORKTREE',
      branch: 'feature/later',
      worktreePath: elsewhere,
    });

    const outcome = await requestThenDecide({ platform });

    expect(outcome.result.outcome).toBe('failed');
    expect(outcome.platform.card().failureReason).toContain(
      `it records the Service in the worktree ${elsewhere} on branch feature/later`,
    );
    await expectNothingChanged(outcome);
  });

  it('finishes the move when the platform moved but the local bookkeeping could not be saved', async () => {
    const target = addWorktree('feature/changes');

    const outcome = await requestThenDecide({
      beforeDecision: ({ store }) => {
        vi.spyOn(store, 'markServicePlacesReported').mockRejectedValueOnce(new Error('disk full'));
      },
    });

    expect(outcome.result).toMatchObject({ outcome: 'delivered' });
    expect(outcome.platform.card().failureReason).toBeUndefined();
    expect(outcome.run.session.worktreeState?.[SERVICE_ID]?.worktreePath).toBe(target);
    // This process never resends the old place, even though the Run store was not updated.
    expect(outcome.run.session.reportedServicePlaceServiceIds).toContain(SERVICE_ID);
    expect(outcome.run.session.capturedServicePlaces ?? []).toEqual([]);
  });

  it('keeps the folder it left and the checkpoint when a retry finishes a half-applied move', async () => {
    const target = addWorktree('feature/changes');

    const outcome = await requestThenDecide({
      beforeDecision: ({ run }) => {
        vi.spyOn(run, 'discardProviderSessionForScopeChange').mockRejectedValueOnce(
          new Error('provider did not stop'),
        );
      },
    });
    expect(outcome.result).toEqual({ outcome: 'failed', reason: 'provider did not stop' });
    expect(outcome.turns).toHaveLength(1);

    const retried = await outcome.answer('approve');

    expect(retried).toMatchObject({ outcome: 'delivered' });
    // The platform moved once; the retry only finished the local steps.
    expect(outcome.platform.attachCalls).toHaveLength(1);
    await vi.waitFor(() => expect(outcome.turns).toHaveLength(2));
    await outcome.run.awaitIdle();
    const continued = outcome.turns[1]!.recovery;
    expect(continued).toContain('after an approved worktree attach');
    expect(continued).toContain(`previously worked in ${repo}`);
    expect(continued).not.toContain(`previously worked in ${target}`);
  });

  it('still tells the agent about a denial whose card could not be updated, and repairs the card on a repeat answer', async () => {
    const target = addWorktree('feature/changes');
    const platform = new FakePlatform();

    const outcome = await requestThenDecide({
      platform,
      decision: 'deny',
      beforeDecision: () => {
        platform.failCardUpdates = 1;
      },
    });

    expect(outcome.result.outcome).toBe('failed');
    expect(platform.cards.size).toBe(0);
    await expectNothingChanged(outcome);
    expect(outcome.currentState()).not.toBe('AWAITING_APPROVAL');

    await expect(outcome.answer('deny')).resolves.toMatchObject({ outcome: 'delivered' });
    expect(platform.card()).toMatchObject({ decision: 'deny' });
    expect(await nextTurnPrompt(outcome.run, outcome.turns)).toContain(
      `The user denied attaching the worktree for branch feature/changes at ${target}`,
    );
  });

  it('changes nothing on denial and tells the agent', async () => {
    const target = addWorktree('feature/changes');

    const outcome = await requestThenDecide({ decision: 'deny' });

    expect(outcome.result).toEqual({
      outcome: 'delivered',
      callbackType: 'worktree_attach_decision',
    });
    expect(outcome.platform.attachCalls).toEqual([]);
    expect(outcome.platform.card()).toMatchObject({ decision: 'deny' });
    await expectNothingChanged(outcome);
    expect(outcome.currentState()).not.toBe('AWAITING_APPROVAL');
    const prompt = await nextTurnPrompt(outcome.run, outcome.turns);
    expect(prompt).toContain(
      `The user denied attaching the worktree for branch feature/changes at ${target}`,
    );
    expect(prompt).toContain(`still works in ${repo}`);
  });

  it('reports a repeated answer as delivered and an opposite one as already decided', async () => {
    addWorktree('feature/changes');
    const outcome = await requestThenDecide({ decision: 'deny' });
    const answer = {
      runId: RUN_ID,
      requestId: outcome.request.id,
      sessionId: outcome.request.sessionId,
      agentType: outcome.request.agentType,
      reason: null,
      idempotencyToken: outcome.request.idempotencyToken,
    };

    await expect(
      outcome.registry.submitPermissionDecision(RUN_ID, { ...answer, decision: 'deny' }),
    ).resolves.toMatchObject({ outcome: 'delivered' });
    await expect(
      outcome.registry.submitPermissionDecision(RUN_ID, { ...answer, decision: 'approve' }),
    ).resolves.toEqual({ outcome: 'dropped', reason: 'worktree_attach_request_already_decided' });
    expect(outcome.platform.attachCalls).toEqual([]);
  });
});

import { reviewHandler } from '../agents/review-subagent/review.handler';
import { mentionFormatReminder } from '../agents/prompts/common';
import { createPromptTypeHandlerTestDeps } from '../agents/prompt-type-handler.test-support';
import { describe, expect, it, vi } from 'vitest';
import { ChildAgentLauncher, type ChildAgentLauncherDependencies } from './child-agent-launcher';
import { researchHandler } from '../agents/research/research.handler';
import { agentSearchHandler } from '../agents/agent-search/agent-search.handler';
import type { AgenticSession } from '../session/types';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';

const harness = vi.hoisted(() => ({
  construct: vi.fn(),
  execute: vi.fn(async () => ({ assistantCompleted: true, outputText: 'findings' })),
  resolveWorkspace: vi.fn(async (_input: { session: AgenticSession }) => ({
    ok: true,
    cwd: '/repo',
    allowedRepositoryRoots: ['/repo'],
  })),
  resolveBindings: vi.fn(async (input: { serviceIds: readonly string[] }) => ({
    ok: true,
    services: input.serviceIds.map((id) => ({ id, path: `/repositories/${id}` })),
  })),
}));

vi.mock('./subagent', () => ({
  SubAgent: class {
    constructor(args: object) {
      harness.construct(args);
    }
    execute() {
      return harness.execute();
    }
  },
}));
vi.mock('../agents/run-scope', () => ({
  resolveRunWorkspace: harness.resolveWorkspace,
  resolveServiceBindingsForIds: harness.resolveBindings,
}));

const makeLauncher = () =>
  new ChildAgentLauncher({
    handlerDeps: createPromptTypeHandlerTestDeps(),
    promptTypeRegistry: {
      getChildHandler: (id: string) => (id === researchHandler.id ? researchHandler : undefined),
    },
    repoStore: {},
    oauthClient: {},
    submissionToolRegistry: {},
    localAgentEndpoint: {},
    logger: { debug: vi.fn() },
  } as unknown as ChildAgentLauncherDependencies);

const session = {
  agentic_session_id: 'parent',
  provider: 'codex',
  entity: null,
  services: [],
  provider_session_id: 'parent-provider',
  provider_conversation_id: null,
  status: 'idle',
  conversationId: 'conversation',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  events: [],
  contextMetadata: {
    organizationId: 'org',
    projectId: 'project',
    capturedAt: '2026-01-01',
    agentSessionId: 'parent',
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  },
} satisfies AgenticSession;

const sourceSession = {
  ...session,
  services: [
    { id: 'source', path: '/repositories/source' },
    { id: 'other', path: '/repositories/other' },
  ],
  launchServiceId: 'source',
  worktree: { enabled: true },
  worktreeState: {
    source: { repoPath: '/repositories/source', worktreePath: '/worktrees/source', branch: 'work' },
  },
} satisfies AgenticSession;

describe('ChildAgentLauncher', () => {
  it('launches a Service-optional child without resolving a missing parent repository', async () => {
    harness.resolveWorkspace.mockClear();
    harness.construct.mockClear();
    await makeLauncher().launch({
      parentSession: { ...session, services: [] },
      handler: agentSearchHandler,
      payload: { payloadVersion: 1, userMessage: 'Search the project' },
      signal: new AbortController().signal,
    });
    expect(harness.resolveWorkspace).not.toHaveBeenCalled();
    expect(harness.construct).toHaveBeenCalledWith(expect.objectContaining({ cwd: process.cwd() }));
  });

  it('launches the registered research handler with its read-only configuration', async () => {
    harness.construct.mockClear();
    const result = await makeLauncher().launchRegistered('research', {
      parentSession: session,
      payload: { userMessage: 'Inspect the code' },
      signal: new AbortController().signal,
    });
    expect(result).toEqual({ assistantCompleted: true, outputText: 'findings' });
    expect(harness.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        handler: researchHandler,
        config: researchHandler.childConfig,
        cwd: '/repo',
        allowedRepositoryRoots: ['/repo'],
      }),
    );
  });

  it('prepares independent Review once and preserves its file scope and recent user decisions', async () => {
    harness.construct.mockClear();
    const signal = new AbortController().signal;
    const promptContext = {
      turnId: 'child-execution',
      startedPromptTypes: new Set(['implement']),
      recentUserReplies: [
        { messageId: 'message', text: 'Keep the public behavior.', createdAt: '2026-01-01' },
      ],
      triggerParentMessageId: 'parent-message',
    };
    const prepare = vi.fn(reviewHandler.prepare!);
    const buildPrompt = vi.fn(reviewHandler.buildPrompt);
    const handler = { ...reviewHandler, prepare, buildPrompt };
    await makeLauncher().launch({
      parentSession: session,
      handler,
      payload: { userMessage: 'Inspect this change.' },
      signal,
      promptContext,
      touchedFiles: ['/repo/change.ts'],
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(buildPrompt).toHaveBeenCalledTimes(1);
    const context = buildPrompt.mock.calls[0]?.[1];
    expect(context).toMatchObject({ ...promptContext, abortSignal: expect.any(Function) });
    expect(context?.abortSignal?.()).toBe(signal);
    const supplied = harness.construct.mock.calls.at(-1)?.[0];
    expect(supplied.prompt).toContain('/repo/change.ts');
    expect(supplied.prompt).toContain('Keep the public behavior.');
    expect(supplied.prompt.endsWith(mentionFormatReminder)).toBe(true);
    expect(supplied.prompt.split(mentionFormatReminder)).toHaveLength(2);

    // A Run/eval already owns preparation. The launcher renders that enriched
    // payload without repeating preparation or fetching its context again.
    await makeLauncher().launch({
      parentSession: session,
      handler,
      payload: (await prepare.mock.results[0]!.value).payload,
      prepared: true,
      signal,
      promptContext,
      touchedFiles: ['/repo/change.ts'],
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(buildPrompt).toHaveBeenCalledTimes(2);
    expect(harness.construct.mock.calls.at(-1)?.[0].prompt).toBe(supplied.prompt);
  });

  it('rejects a handler without child configuration before workspace or provider startup', async () => {
    harness.resolveWorkspace.mockClear();
    harness.construct.mockClear();
    await expect(
      makeLauncher().launch({
        parentSession: session,
        handler: {
          id: 'ordinary',
          promptType: LocalPromptType.Research,
          service: 'required',
          launchEntity: 'required',
          implementationReadiness: 'none',
          runnerKind: 'provider_session',
          providerSessionCountsForContext: true,
          reports: [],
          buildPrompt: () => '',
        },
        payload: {},
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('ordinary');
    expect(harness.resolveWorkspace).not.toHaveBeenCalled();
    expect(harness.construct).not.toHaveBeenCalled();
  });

  it('runs an empty admitted Service set from the CLI directory without repository mapping', async () => {
    harness.resolveWorkspace.mockClear();
    harness.resolveBindings.mockClear();
    harness.construct.mockClear();
    await makeLauncher().launchRegistered('research', {
      parentSession: sourceSession,
      serviceIds: [],
      payload: { userMessage: 'Inspect the graph' },
      signal: new AbortController().signal,
    });
    expect(harness.resolveBindings).not.toHaveBeenCalled();
    expect(harness.resolveWorkspace).not.toHaveBeenCalled();
    expect(harness.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: process.cwd(),
        session: expect.objectContaining({ services: [] }),
      }),
    );
    expect(harness.construct.mock.calls.at(-1)?.[0].session).not.toHaveProperty('launchServiceId');
  });

  it('reuses the source workspace when the selected Services include its launch Service', async () => {
    harness.resolveWorkspace.mockClear();
    harness.resolveBindings.mockClear();
    harness.construct.mockClear();
    await makeLauncher().launchRegistered('research', {
      parentSession: sourceSession,
      serviceIds: ['source'],
      launchServiceId: 'source',
      payload: { userMessage: 'Inspect source' },
      signal: new AbortController().signal,
    });
    expect(harness.resolveBindings).not.toHaveBeenCalled();
    expect(harness.resolveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ session: sourceSession }),
    );
    expect(harness.construct).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedRepositoryRoots: ['/repo', '/repositories/source'],
        session: expect.objectContaining({
          services: [{ id: 'source', path: '/repositories/source' }],
          worktreeState: sourceSession.worktreeState,
        }),
      }),
    );
  });

  it.each([
    { serviceIds: ['other'], launchServiceId: 'other' },
    { serviceIds: ['other', 'third'], launchServiceId: 'third' },
  ])('resolves a selected Service workspace using $launchServiceId as anchor', async (scope) => {
    harness.resolveWorkspace.mockClear();
    await makeLauncher().launchRegistered('research', {
      parentSession: sourceSession,
      ...scope,
      payload: { userMessage: 'Inspect selected Services' },
      signal: new AbortController().signal,
    });
    expect(harness.resolveWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({
          services: scope.serviceIds.map((id) => ({ id, path: `/repositories/${id}` })),
          launchServiceId: scope.launchServiceId,
        }),
      }),
    );
    expect(harness.resolveWorkspace.mock.calls.at(-1)?.[0].session).not.toHaveProperty(
      'worktreeState',
    );
  });
});

vi.mock('../agents/prompts/session-start-context', () => ({
  readSessionStartContext: async () => ({
    workItemTypeDefinitions: [],
    intentFirst: false,
    maturity: 'ESTABLISHED',
  }),
}));

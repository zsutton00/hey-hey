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
    promptTypeRegistry: {
      getChildHandler: (id: string) => (id === researchHandler.id ? researchHandler : undefined),
    },
    repoStore: {},
    oauthClient: {},
    submissionToolRegistry: {},
    localAgentEndpoint: {},
    logger: { debug: vi.fn() },
  } as unknown as ChildAgentLauncherDependencies);

const session = { agentic_session_id: 'parent', provider: 'codex' } as AgenticSession;

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
} as AgenticSession;

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

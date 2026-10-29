import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { vi } from 'vitest';
import { RepoMappingStore, toRepositoryPath, toServiceId } from '../../repo/index';
import { RunStore } from '../../run-store/run-store';
import { createTestRun } from '../../run/run.test-support';
import type { Run } from '../../run/run';
import type { AgenticSession, AgenticSessionEvent } from '../../session/index';

const testPath = (owner: string): string =>
  path.join(os.tmpdir(), `heyhey-provider-owner-${crypto.randomUUID()}`, owner);

export const createProviderTestRunStore = (makeSession: () => AgenticSession): RunStore => {
  const baseDir = testPath('run-store');
  const runsDir = path.join(baseDir, 'runs');
  const store = new RunStore({
    paths: {
      baseDir,
      runsDir,
      indexPath: path.join(runsDir, 'run-index.json'),
      preferencesPath: path.join(baseDir, 'preferences.json'),
    },
  });
  const event: AgenticSessionEvent = {
    seq: 1,
    ts: '2026-02-20T00:00:00.000Z',
    app_session_id: 'provider-test-app-session',
    run_id: 'provider-test-run',
    actor: 'agent',
    event_type: 'agent_output',
    state_version: 1,
  };

  vi.spyOn(store, 'updateRunStatus').mockImplementation(async () => makeSession());
  vi.spyOn(store, 'updateRunProviderIdentity').mockImplementation(async () => makeSession());
  vi.spyOn(store, 'appendEvent').mockImplementation(async () => event);
  vi.spyOn(store, 'updateRunWorktreeState').mockImplementation(async () => makeSession());
  vi.spyOn(store, 'updateRunTokenUsage').mockImplementation(async () => makeSession());
  vi.spyOn(store, 'setRunTokenUsage').mockImplementation(async () => makeSession());
  return store;
};

export const createProviderTestRepoMappingStore = (
  repositoryPath: string | null = '/tmp/repo',
): RepoMappingStore => {
  const baseDir = testPath('repo-store');
  const store = new RepoMappingStore({
    mappingPath: path.join(baseDir, 'repos.json'),
    lockPath: path.join(baseDir, 'repos.lock'),
  });
  vi.spyOn(store, 'getBinding').mockImplementation(async () =>
    repositoryPath === null
      ? null
      : {
          serviceId: toServiceId('svc-1'),
          repositoryPath: toRepositoryPath(repositoryPath),
          createdAt: '2026-02-20T00:00:00.000Z',
          updatedAt: '2026-02-20T00:00:00.000Z',
        },
  );
  return store;
};

export const createProviderTestAgentOutputOwner = (onAgentOutput: Run['onAgentOutput']): Run => {
  const run = createTestRun();
  vi.spyOn(run, 'onAgentOutput').mockImplementation(onAgentOutput);
  return run;
};

/** Retain provider usage through the real store while preserving boundary spies. */
export async function retainProviderTestUsage(
  store: RunStore,
  session: AgenticSession,
): Promise<void> {
  await store.initialize();
  await store.createRun({
    agentic_session_id: session.agentic_session_id,
    provider_session_id: session.provider_session_id,
    provider: session.provider,
    entity: session.entity,
    conversationId: session.conversationId,
    services: session.services,
    ...(session.launchServiceId ? { launchServiceId: session.launchServiceId } : {}),
    contextMetadata: {
      capturedAt: new Date().toISOString(),
      organizationId: 'org-1',
      projectId: 'project-1',
      agentSessionId: session.agentic_session_id,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    },
  });
  vi.mocked(store.updateRunTokenUsage).mockRestore();
  vi.mocked(store.setRunTokenUsage).mockRestore();
  vi.spyOn(store, 'updateRunTokenUsage');
  vi.spyOn(store, 'setRunTokenUsage');
}

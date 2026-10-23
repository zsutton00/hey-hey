import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { RepoMappingStore, toServiceId } from '../repo';
import type { LocalAgentInfrastructureOptions } from '../server/local-agent-infrastructure';
import type { ProjectModeLaunchResumeProbeArgs } from './probe-project-mode-launch-resume-args';
import { createProjectModeLaunchResumeProbeDependencies } from './probe-project-mode-runtime';

vi.mock('../auth', () => ({ seedCredentialFromEnvIfAbsent: vi.fn().mockResolvedValue(false) }));
vi.mock('../agents/agent-application-runtime', () => ({ AgentApplicationRuntime: class {} }));
vi.mock('../server/run-application-runtime', () => ({
  RunApplicationRuntime: class {
    async dispose() {}
  },
}));
vi.mock('../server/local-agent-infrastructure', () => ({
  LocalAgentInfrastructure: class {
    repoStore: RepoMappingStore;
    runStore = { initialize: async () => {} };
    oauthClient = { getAccessToken: async () => ({ success: true, data: 'test-token' }) };
    apiRuntime = { transport: { setAuthToken: () => {} } };
    logger = { debug: () => {}, child: () => this.logger };
    constructor(options: LocalAgentInfrastructureOptions) {
      this.repoStore = new RepoMappingStore(options.repoMappingStoreOptions);
    }
    async dispose() {}
  },
}));

let temporaryDirectory: string | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  if (temporaryDirectory) await fs.rm(temporaryDirectory, { recursive: true, force: true });
});
it('keeps a probe worktree binding out of the shared profile and removes its isolated mapping', async () => {
  temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-binding-test-'));
  const sharedProfile = path.join(temporaryDirectory, 'shared');
  const checkout = path.join(temporaryDirectory, 'checkout');
  const worktree = path.join(checkout, '.worktrees', 'unrelated');
  await fs.mkdir(worktree, { recursive: true });
  vi.stubEnv('HEYHEY_REPO_DIR', sharedProfile);
  vi.stubEnv('HEYHEY_SESSION_DIR', path.join(temporaryDirectory, 'existing-sessions'));
  const serviceId = toServiceId('10000000-0000-4000-8000-000000000005');
  await new RepoMappingStore().setBinding(serviceId, checkout);
  const before = await fs.readFile(path.join(sharedProfile, 'repos.json'), 'utf8');
  const args: ProjectModeLaunchResumeProbeArgs = {
    apiBaseUrl: 'http://localhost:3000',
    repositoryPath: await fs.realpath(worktree),
    serviceId,
    organizationId: '10000000-0000-4000-8000-000000000001',
    projectId: '10000000-0000-4000-8000-000000000002',
    taskId: '10000000-0000-4000-8000-000000000003',
    modeId: '10000000-0000-4000-8000-000000000004',
    provider: 'codex',
    model: 'test-model',
    reasoningEffort: 'low',
    timeoutMs: 60_000,
    maxOutputBytes: 4_096,
  };
  const dependencies = await createProjectModeLaunchResumeProbeDependencies(args);
  const isolatedDirectory = process.env['HEYHEY_SESSION_DIR']!;
  try {
    expect(await fs.readFile(path.join(sharedProfile, 'repos.json'), 'utf8')).toBe(before);
    const isolated = new RepoMappingStore({
      mappingPath: path.join(isolatedDirectory, 'repos.json'),
      lockPath: path.join(isolatedDirectory, 'repos.lock'),
    });
    expect((await isolated.getBinding(serviceId))?.repositoryPath).toBe(args.repositoryPath);
    expect((await new RepoMappingStore().getBinding(serviceId))?.repositoryPath).toBe(
      await fs.realpath(checkout),
    );
  } finally {
    await dependencies.dispose();
  }
  await expect(fs.access(isolatedDirectory)).rejects.toThrow();
  expect(process.env['HEYHEY_SESSION_DIR']).toBe(
    path.join(temporaryDirectory, 'existing-sessions'),
  );
});

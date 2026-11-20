import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RepoMappingStore, toServiceId } from './index';
import { startAgenticSession } from '../commands/agent-session-starter';
import { RunStore } from '../run-store';
import { resolveRunWorkspace } from '../agents/run-scope';

let directory: string;
let root: string;
let other: string;
beforeEach(async () => {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'launch-checkout-')));
  root = path.join(directory, 'root');
  other = path.join(directory, 'other');
  await fs.mkdir(root);
  execFileSync('git', ['init', root]);
  execFileSync(
    'git',
    [
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.com',
      'commit',
      '--allow-empty',
      '-m',
      'initial',
    ],
    { cwd: root },
  );
  execFileSync('git', ['worktree', 'add', '-b', 'other', other], { cwd: root });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

it.each(['main', 'worktree'])(
  'starts and resumes in the selected %s checkout independently of the CLI location',
  async (selected) => {
    const repositoryPath = selected === 'main' ? root : other;
    const cliDirectory = selected === 'main' ? other : root;
    vi.spyOn(process, 'cwd').mockReturnValue(cliDirectory);
    const repoStore = new RepoMappingStore({
      mappingPath: path.join(directory, 'repos.json'),
      lockPath: path.join(directory, 'repos.lock'),
    });
    await repoStore.setBinding(toServiceId('service'), repositoryPath);
    const baseDir = path.join(directory, 'state');
    const runStore = new RunStore({
      paths: {
        baseDir,
        runsDir: path.join(baseDir, 'runs'),
        indexPath: path.join(baseDir, 'run-index.json'),
        preferencesPath: path.join(baseDir, 'preferences.json'),
      },
    });
    await runStore.initialize();
    const result = await startAgenticSession({
      context: { projectId: 'project', serviceIds: ['service'], launchServiceId: 'service' },
      entity: null,
      conversationId: 'conversation',
      repoStore,
      runStore,
      contextMetadata: {
        agentSessionId: 'session',
        capturedAt: new Date().toISOString(),
        organizationId: 'org',
        projectId: 'project',
        userComments: [],
        fileReferences: { resolved: [], unresolved: [] },
      },
    });
    expect(result.status).toBe('started');
    if (result.status !== 'started') throw new Error('Expected a started session');
    expect(result.session.services).toEqual([{ id: 'service', path: repositoryPath }]);
    // Later binding changes must not redirect an existing Run to the CLI checkout.
    await repoStore.setBinding(toServiceId('service'), cliDirectory);
    const saved = await runStore.getRun(result.session.agentic_session_id);
    if (!saved) throw new Error('Expected the persisted session');
    expect(await resolveRunWorkspace({ session: saved, repoStore })).toMatchObject({
      ok: true,
      cwd: repositoryPath,
      allowedRepositoryRoots: [repositoryPath],
      bindingRepositoryPath: repositoryPath,
    });
  },
);

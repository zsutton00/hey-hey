import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { findLaunchCheckoutConflict } from './launch-checkout';
import { RepoMappingStore, toRepositoryPath, toServiceId } from './index';
import { startAgenticSession } from '../commands/agent-session-starter';
import { RunStore } from '../run-store';
import { resolveRunWorkspace } from '../agents/run-scope';
import type { AgenticSession } from '../session';

let directory: string;
let root: string;
let other: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'launch-checkout-'));
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
  vi.spyOn(process, 'cwd').mockReturnValue(root);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(directory, { recursive: true, force: true });
});

it('rejects another checkout of the running repository for a non-worktree launch', async () => {
  expect(await findLaunchCheckoutConflict(other, false)).toContain('Non-worktree launch refused');
  expect(await findLaunchCheckoutConflict(root, false)).toBeNull();
  expect(await findLaunchCheckoutConflict(other, true)).toBeNull();
});
it('allows another service repository and a CLI started in a subdirectory of the selected checkout', async () => {
  const service = path.join(directory, 'service');
  await fs.mkdir(service);
  execFileSync('git', ['init', service]);
  expect(await findLaunchCheckoutConflict(service, false)).toBeNull();
  const subdirectory = path.join(root, 'src');
  await fs.mkdir(subdirectory);
  expect(await findLaunchCheckoutConflict(root, false, undefined, subdirectory)).toBeNull();
});
it('rejects a contaminated binding before persisting a new run', async () => {
  const repoStore = new RepoMappingStore();
  vi.spyOn(repoStore, 'getBinding').mockResolvedValue({
    serviceId: toServiceId('service'),
    repositoryPath: toRepositoryPath(other),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const runStore = new RunStore();
  const create = vi.spyOn(runStore, 'createRun');
  await expect(
    startAgenticSession({
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
    }),
  ).rejects.toThrow('Non-worktree launch refused');
  expect(create).not.toHaveBeenCalled();
});
it('rejects a persisted wrong checkout during resume even after the mapping is repaired', async () => {
  const repoStore = new RepoMappingStore();
  const readBinding = vi.spyOn(repoStore, 'getBinding');
  const session = {
    agentic_session_id: 'session',
    services: [{ id: 'service', path: other }],
    launchServiceId: 'service',
    contextMetadata: {},
  } as AgenticSession;
  const result = await resolveRunWorkspace({ session, repoStore });
  expect(result).toMatchObject({ ok: false, code: 'RUN_SCOPE_INVALID' });
  expect(readBinding).not.toHaveBeenCalled();
});

import { createServer, type Server } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestRun } from '../../run/run.test-support';
import { createWalkthroughSourceRouter } from './walkthrough-source';

const runId = '11111111-1111-4111-8111-111111111111';
const machineId = '22222222-2222-4222-8222-222222222222';
const serviceId = '33333333-3333-4333-8333-333333333333';
const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it('opens the current worktree file even when its excerpt changed, rejects foreign sources, and isolates subsequent requests', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'walkthrough-route-'));
  roots.push(root);
  await writeFile(path.join(root, 'policy.ts'), 'deny();\n');
  const run = createTestRun();
  run.session.agentic_session_id = runId;
  run.session.services = [{ id: serviceId, path: '/not-the-worktree' }];
  run.session.worktreeState = {
    [serviceId]: { worktreePath: root, repoPath: '/not-the-worktree', branch: 'test' },
  };
  const restore = vi.fn().mockResolvedValue(run);
  const app = express();
  app.use(express.json());
  app.use(
    '/runs',
    createWalkthroughSourceRouter({
      allowedOrigins: ['https://allowed.test'],
      keyPairStore: { loadCurrentMachineId: async () => machineId },
      restoreCoordinator: { restore },
    }),
  );
  const server = createServer(app);
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No address');
  const excerpt = {
    serviceId,
    file: 'policy.ts',
    startLine: 1,
    endLine: 1,
    language: 'typescript',
    code: 'deny();',
    sourceVersion: { kind: 'WORKSPACE' },
    verification: { status: 'VERIFIED', checkedAt: '2026-10-15T00:00:00Z' },
  };
  const post = (overrides = {}, origin = 'https://allowed.test') =>
    fetch('http://127.0.0.1:' + address.port + '/runs/' + runId + '/walkthrough/source', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ machineId, excerpt: { ...excerpt, ...overrides } }),
    });
  expect((await post({}, 'https://foreign.test')).status).toBe(403);
  expect(restore).not.toHaveBeenCalled();
  expect((await post({ file: '../policy.ts' })).status).toBe(422);
  expect((await post({ serviceId: machineId })).status).toBe(422);
  expect((await post({ code: 'invented();' })).status).toBe(200);
  const valid = await post();
  expect(valid.status).toBe(200);
  expect(await valid.json()).toEqual({
    runId,
    serviceId,
    file: 'policy.ts',
    path: path.join(root, 'policy.ts'),
    line: 1,
    column: 1,
  });
  await writeFile(path.join(root, 'policy.ts'), 'changed();\n');
  expect((await post()).status).toBe(200);
  await rm(path.join(root, 'policy.ts'));
  expect((await post()).status).toBe(422);
});

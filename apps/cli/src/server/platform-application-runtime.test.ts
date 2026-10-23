import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../run/run';
import type { AgenticSession } from '../session/types';
import { NOOP_LOGGER } from './logger';
import { LocalAgentRouter } from './local-agent-router';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

describe('PlatformApplicationRuntime local changed-file isolation', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it('delivers local detail without an upstream acknowledgement or subscription change', async () => {
    const runId = '44444444-4444-4444-8444-444444444444';
    const serviceId = '55555555-5555-4555-8555-555555555555';
    const identity = {
      serviceId,
      repoPath: '/workspace/service',
      filePath: 'src/example.ts',
    };
    const authenticatedSocket = {
      acknowledgement: vi.fn(),
      connected: true,
      subscriptions: new Set(['conversation:one', 'project:one']),
    };
    const subscriptionsBefore = [...authenticatedSocket.subscriptions];
    const run = {
      session: { agentic_session_id: runId } as AgenticSession,
      getFileChangeProjection: () => [{ serviceId, repoRelativePath: identity.filePath }],
    } as Run;
    const router = new LocalAgentRouter({
      allowedOrigins: ['https://allowed.test'],
      keyPairStore: {
        loadCurrentMachineId: vi.fn(async () => 'machine-1'),
      } as never,
      logger: NOOP_LOGGER,
      oauthClient: {} as never,
      repoStore: {} as never,
      runRegistry: {} as never,
      runChangedFilesReader: {
        getLiveRunChangedFileDetail: vi.fn(async () => ({
          ...identity,
          status: 'modify' as const,
          diff: '@@ -1 +1 @@',
          preContent: 'before',
          postContent: 'after',
        })),
      } as never,
      runReadRestoreCoordinator: {
        restore: vi.fn(async () => run),
      } as never,
      poster: {} as never,
      submissionToolRegistry: {} as never,
    });
    const server = createServer(router.app);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected router TCP port.');

    const response = await fetch(
      `http://127.0.0.1:${String(address.port)}/api/local/runs/${runId}/changed-files/detail`,
      {
        method: 'POST',
        headers: {
          origin: 'https://allowed.test',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ machineId: 'machine-1', file: identity }),
      },
    );

    expect(response.status).toBe(200);
    expect(authenticatedSocket.acknowledgement).not.toHaveBeenCalled();
    expect(authenticatedSocket.connected).toBe(true);
    expect([...authenticatedSocket.subscriptions]).toEqual(subscriptionsBefore);
  });
});

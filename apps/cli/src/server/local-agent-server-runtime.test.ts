import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Run } from '../run/run';
import { createTestLocalAgentServerRuntimeOwners } from './local-agent-server-runtime.test-support';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve) => server.close(() => resolve()));

const createOwners = (
  httpServer: Server,
  runs: Run[] = [],
  preferredPort = 0,
) =>
  createTestLocalAgentServerRuntimeOwners({
    httpServer,
    runs,
    host: '127.0.0.1',
    preferredPort,
  });

describe('LocalAgentServerRuntime', () => {
  const servers: Server[] = [];

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it('rolls back every owned resource when the required port is unavailable', async () => {
    const occupiedServer = createServer();
    servers.push(occupiedServer);
    await new Promise<void>((resolve) => occupiedServer.listen(0, '127.0.0.1', resolve));
    const address = occupiedServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected occupied TCP port.');

    const httpServer = createServer();
    const owners = createOwners(httpServer, [], address.port);
    const disposeApplication = vi.spyOn(owners.applicationLifecycle, 'dispose');
    const runtime = owners.runtime;

    await expect(runtime.start()).rejects.toThrow('is already in use');
    expect(disposeApplication).toHaveBeenCalledTimes(1);
  });

});

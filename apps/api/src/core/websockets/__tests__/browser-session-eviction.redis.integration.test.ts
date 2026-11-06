import Redis from 'ioredis';
import { Socket } from 'socket.io';
import { UserId } from '../../../types';
import { BrowserSessionEvictionService } from '../browser-session-eviction.service';
import { WebsocketUserConnectionLifecycleService } from '../websocket-user-connection-lifecycle.service';

const USER = '11111111-1111-4111-8111-111111111111' as UserId;
const OLD_SESSION = '22222222-2222-4222-8222-222222222222';
const NEW_SESSION = '33333333-3333-4333-8333-333333333333';

async function waitFor(condition: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

const socket = (id: string): Socket =>
  ({
    id,
    disconnected: false,
    emit: jest.fn(),
    disconnect: jest.fn(),
  }) as unknown as Socket;

/**
 * Two API replicas, each with its own socket registry, sharing one real
 * Redis. A session revoked on one replica must close on the other.
 */
describe('BrowserSessionEvictionService across replicas on real Redis', () => {
  let redisUrl: string | undefined;
  const clients: Redis[] = [];
  const services: BrowserSessionEvictionService[] = [];

  beforeAll(async () => {
    const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379');
    url.pathname = '/14';
    const probe = new Redis(url.toString(), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
    });
    try {
      await probe.connect();
      await probe.ping();
      redisUrl = url.toString();
    } catch {
      redisUrl = undefined;
    } finally {
      probe.disconnect();
    }
  });

  afterAll(async () => {
    await Promise.all(services.map((service) => service.onModuleDestroy()));
    clients.forEach((client) => client.disconnect());
  });

  const replica = async () => {
    const client = new Redis(redisUrl!);
    clients.push(client);
    const lifecycle = new WebsocketUserConnectionLifecycleService();
    const eviction = new BrowserSessionEvictionService(
      { getClient: () => client } as never,
      { db: { browserSessionFamily: { findMany: async () => [] } } } as never,
      lifecycle,
    );
    await eviction.onModuleInit();
    services.push(eviction);
    return { lifecycle, eviction };
  };

  it('closes the revoked session on the other replica and keeps the replacement', async () => {
    if (!redisUrl) {
      console.warn('Redis unavailable; skipping cross-replica eviction test');
      return;
    }
    const a = await replica();
    const b = await replica();
    const expiresAt = new Date(Date.now() + 60_000);
    const oldOnB = socket('old-b');
    const replacementOnB = socket('new-b');
    b.lifecycle.register(oldOnB, {
      userId: USER,
      expiresAt,
      sessionId: OLD_SESSION,
      authorizationVersion: 1,
    });
    b.lifecycle.register(replacementOnB, {
      userId: USER,
      expiresAt,
      sessionId: NEW_SESSION,
      authorizationVersion: 2,
    });

    await a.eviction.evictSessions([OLD_SESSION]);
    await a.eviction.evictStaleRevision(USER, 2);

    await waitFor(() => (oldOnB.disconnect as jest.Mock).mock.calls.length > 0);
    expect(oldOnB.disconnect).toHaveBeenCalledWith(true);
    expect(replacementOnB.disconnect).not.toHaveBeenCalled();
  });
});

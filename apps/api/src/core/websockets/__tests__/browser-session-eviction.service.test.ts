import { Socket } from 'socket.io';
import { UserId } from '../../../types';
import { BrowserSessionEvictionService } from '../browser-session-eviction.service';
import { WebsocketUserConnectionLifecycleService } from '../websocket-user-connection-lifecycle.service';

const USER = '11111111-1111-4111-8111-111111111111' as UserId;
const OLD_SESSION = '22222222-2222-4222-8222-222222222222';
const NEW_SESSION = '33333333-3333-4333-8333-333333333333';

/** One Redis pub/sub channel shared by every replica, like a real Redis. */
function sharedRedis() {
  const handlers = new Set<(channel: string, payload: string) => void>();
  let failPublish = false;
  const client = {
    publish: jest.fn(async (channel: string, payload: string) => {
      if (failPublish) {
        throw new Error('redis unavailable');
      }
      handlers.forEach((handler) => handler(channel, payload));
      return handlers.size;
    }),
    duplicate: () => ({
      on: (
        event: string,
        handler: (channel: string, payload: string) => void,
      ) => {
        if (event === 'message') {
          handlers.add(handler);
        }
      },
      subscribe: jest.fn().mockResolvedValue(1),
      removeListener: (_event: string, handler: never) =>
        handlers.delete(handler),
      quit: jest.fn().mockResolvedValue('OK'),
    }),
  };
  return {
    redis: { getClient: () => client },
    setPublishFailure: (value: boolean) => {
      failPublish = value;
    },
  };
}

const socket = (id: string): Socket =>
  ({
    id,
    disconnected: false,
    emit: jest.fn(),
    disconnect: jest.fn(),
  }) as unknown as Socket;

describe('BrowserSessionEvictionService across replicas', () => {
  const sessions = new Map<string, { revokedAt: Date | null }>();
  let revision = 1;
  const prisma = {
    db: {
      browserSessionFamily: {
        findMany: jest.fn(
          async ({ where }: { where: { sessionId: { in: string[] } } }) =>
            where.sessionId.in
              .filter((id) => sessions.has(id))
              .map((sessionId) => ({
                sessionId,
                revokedAt: sessions.get(sessionId)!.revokedAt,
                inactivityExpiresAt: new Date(Date.now() + 60_000),
                absoluteExpiresAt: new Date(Date.now() + 60_000),
                user: { authorizationRevision: revision, isActive: true },
              })),
        ),
      },
    },
  };

  const replicas = async (shared: ReturnType<typeof sharedRedis>) => {
    const build = async () => {
      const lifecycle = new WebsocketUserConnectionLifecycleService();
      const eviction = new BrowserSessionEvictionService(
        shared.redis as never,
        prisma as never,
        lifecycle,
      );
      await eviction.onModuleInit();
      return { lifecycle, eviction };
    };
    return [await build(), await build()] as const;
  };

  beforeEach(() => {
    sessions.clear();
    sessions.set(OLD_SESSION, { revokedAt: null });
    sessions.set(NEW_SESSION, { revokedAt: null });
    revision = 1;
  });

  it('closes the old session on every replica and keeps the replacement session', async () => {
    const shared = sharedRedis();
    const [a, b] = await replicas(shared);
    const oldOnA = socket('old-a');
    const oldOnB = socket('old-b');
    const replacementOnB = socket('new-b');
    const expiresAt = new Date(Date.now() + 60_000);
    a.lifecycle.register(oldOnA, {
      userId: USER,
      expiresAt,
      sessionId: OLD_SESSION,
      authorizationVersion: 1,
    });
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

    expect(oldOnA.disconnect).toHaveBeenCalledWith(true);
    expect(oldOnB.disconnect).toHaveBeenCalledWith(true);
    expect(replacementOnB.disconnect).not.toHaveBeenCalled();
    await Promise.all([
      a.eviction.onModuleDestroy(),
      b.eviction.onModuleDestroy(),
    ]);
  });

  it('reconciles against the database when a broadcast was missed', async () => {
    const shared = sharedRedis();
    const [a, b] = await replicas(shared);
    const oldOnB = socket('old-b');
    b.lifecycle.register(oldOnB, {
      userId: USER,
      expiresAt: new Date(Date.now() + 60_000),
      sessionId: OLD_SESSION,
      authorizationVersion: 1,
    });

    shared.setPublishFailure(true);
    sessions.set(OLD_SESSION, { revokedAt: new Date() });
    revision = 2;
    await a.eviction.evictSessions([OLD_SESSION]);
    expect(oldOnB.disconnect).not.toHaveBeenCalled();

    await expect(b.eviction.reconcile()).resolves.toBe(1);
    expect(oldOnB.disconnect).toHaveBeenCalledWith(true);
    await Promise.all([
      a.eviction.onModuleDestroy(),
      b.eviction.onModuleDestroy(),
    ]);
  });

  it('ignores malformed broadcasts', async () => {
    const shared = sharedRedis();
    const [a, b] = await replicas(shared);
    const current = socket('current');
    b.lifecycle.register(current, {
      userId: USER,
      expiresAt: new Date(Date.now() + 60_000),
      sessionId: NEW_SESSION,
      authorizationVersion: 1,
    });

    await shared.redis
      .getClient()
      .publish(
        'hey-hey:websockets:browser-session-eviction',
        '{"kind":"user"}',
      );

    expect(current.disconnect).not.toHaveBeenCalled();
    await Promise.all([
      a.eviction.onModuleDestroy(),
      b.eviction.onModuleDestroy(),
    ]);
  });
});

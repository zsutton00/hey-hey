import { ProjectMembershipRevocationService } from '../project-membership-revocation.service';
import { WebsocketConnectionManager } from '../websocket-connection-manager.service';

describe('membership revocation across API instances', () => {
  it('publishes after local eviction and revalidates the same user remotely', async () => {
    const subscribers: Array<(channel: string, payload: string) => void> = [];
    const publisher = {
      duplicate: () => ({
        on: (
          event: string,
          callback: (channel: string, payload: string) => void,
        ) => {
          if (event === 'message') subscribers.push(callback);
        },
        subscribe: jest.fn(),
        removeListener: jest.fn(),
        quit: jest.fn(),
      }),
      publish: jest.fn(async (channel: string, payload: string) => {
        subscribers.forEach((callback) => callback(channel, payload));
      }),
    };
    const first = new ProjectMembershipRevocationService({
      getClient: () => publisher,
    } as never);
    const second = new ProjectMembershipRevocationService({
      getClient: () => publisher,
    } as never);
    const local = jest.fn(async () => undefined);
    const remote = jest.fn(async () => undefined);
    first.registerRevalidation(local);
    second.registerRevalidation(remote);
    await first.onModuleInit();
    await second.onModuleInit();
    await first.membershipRemoved('alice');
    expect(local).toHaveBeenCalledWith('alice');
    expect(remote).toHaveBeenCalledWith('alice');
    expect(local.mock.invocationCallOrder[0]).toBeLessThan(
      publisher.publish.mock.invocationCallOrder[0]!,
    );
    await first.onModuleDestroy();
    await second.onModuleDestroy();
  });

  it('removes project and child rooms for the affected principal while retaining unrelated access', async () => {
    const manager = new WebsocketConnectionManager();
    const socket = (id: string) => ({
      id,
      join: jest.fn(),
      leave: jest.fn(),
      disconnected: false,
    });
    const alice = socket('alice-socket');
    const bob = socket('bob-socket');
    await manager.addConnection(
      alice as never,
      'alice' as never,
      ['org'] as never,
      ['revoked', 'retained'] as never,
      ['revoked-child', 'retained-child'] as never,
      [],
      [],
      'browser',
    );
    await manager.addConnection(
      bob as never,
      'bob' as never,
      ['org'] as never,
      ['revoked'] as never,
      [],
      [],
      [],
      'cli',
    );
    const authorize = jest.fn(
      async (_connection, room) => !room.id.startsWith('revoked'),
    );
    await manager.revalidateRooms(authorize, 'alice');
    expect(alice.leave.mock.calls.map(([room]) => room)).toEqual([
      'project:revoked',
      'conversation:revoked-child',
    ]);
    expect(bob.leave).not.toHaveBeenCalled();
    expect(
      manager
        .getAllConnections()
        .find((connection) => connection.userId === 'alice')?.projectIds,
    ).toEqual(['retained']);
  });
  it('reconciles missed removals when the Redis subscriber reconnects', async () => {
    const handlers = new Map<string, () => void>();
    const subscriber = {
      on: jest.fn((event, callback) => handlers.set(event, callback)),
      subscribe: jest.fn(),
      removeListener: jest.fn(),
      quit: jest.fn(),
    };
    const service = new ProjectMembershipRevocationService({
      getClient: () => ({ duplicate: () => subscriber }),
    } as never);
    const revalidate = jest.fn(async () => undefined);
    service.registerRevalidation(revalidate);
    await service.onModuleInit();
    handlers.get('ready')!();
    expect(revalidate).toHaveBeenCalledWith();
    await service.onModuleDestroy();
  });

  it('evicts rooms installed by authentication already in progress', async () => {
    const manager = new WebsocketConnectionManager();
    const socket = { id: 'joining', join: jest.fn(), leave: jest.fn() };
    await manager.addConnection(socket as never);
    let finishAuthentication!: () => void;
    const ready = new Promise<void>((resolve) => {
      finishAuthentication = resolve;
    });
    const authentication = manager.serializeRoomOperation(
      socket.id,
      async () => {
        await ready;
        await manager.addConnection(socket as never, 'alice' as never, [], [
          'revoked',
        ] as never);
      },
    );
    const eviction = manager.revalidateRooms(async () => false, 'alice');
    finishAuthentication();
    await Promise.all([authentication, eviction]);
    expect(socket.leave).toHaveBeenCalledWith('project:revoked');
    expect(manager.getConnection(socket.id)?.projectIds).toEqual([]);
  });
});

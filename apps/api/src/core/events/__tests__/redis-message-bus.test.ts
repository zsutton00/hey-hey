import { RedisMessageBus } from '../redis-message-bus.service';
import { EventEnvelope } from '../types/event-envelope';
import { EVENT_TYPES } from '../types/event.types';
import { RedisMemoryServer } from 'redis-memory-server';

describe('RedisMessageBus delivery', () => {
  let server: RedisMemoryServer;
  let buses: RedisMessageBus[] = [];
  beforeAll(async () => {
    server = new RedisMemoryServer({
      spawn: { env: { ...process.env, LC_ALL: 'C' } },
    });
    const url = `redis://${await server.getHost()}:${await server.getPort()}`;
    buses = [new RedisMessageBus(url), new RedisMessageBus(url)];
  }, 30000);
  afterAll(async () => {
    await Promise.all(buses.map((bus) => bus.onModuleDestroy()));
    await server?.stop();
  });
  it.each([
    [EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED, 4],
    // Every instance delivers retained execution state to its own sockets.
    [EVENT_TYPES.WORK_ITEM_EXECUTION_STATE.RETAINED, 4],
    ['test.event', 1],
    [`${EVENT_TYPES.WORK_ITEM_TYPE.CONFIG_CHANGED}.other`, 1],
  ])('delivers %s with its own semantics', async (type, count) => {
    const handlers = [jest.fn(), jest.fn()];
    await Promise.all(
      buses.map((bus, i) => bus.subscribe(type as string, handlers[i]!)),
    );
    const envelope = {
      event: { type, aggregateId: 'test', payload: {} },
      timestamp: new Date(0).toISOString(),
    } as EventEnvelope;
    await buses[0]!.publish(envelope);
    await buses[0]!.publish(envelope);
    const deadline = Date.now() + 2000;
    while (
      handlers.reduce((n, h) => n + h.mock.calls.length, 0) <
        (count as number) &&
      Date.now() < deadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(handlers.reduce((n, h) => n + h.mock.calls.length, 0)).toBe(count);
    if (count === 4)
      handlers.forEach((handler) => expect(handler).toHaveBeenCalledTimes(2));
  });

  it('reports losing and regaining its subscription connection', async () => {
    const states: string[] = [];
    const stop = buses[1]!.onSubscriptionStateChange((state) =>
      states.push(state),
    );
    const subscriber = (
      buses[1] as unknown as {
        subscriber: { disconnect(reconnect: boolean): void };
      }
    ).subscriber;

    subscriber.disconnect(true);
    const deadline = Date.now() + 5000;
    while (states.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    stop();

    expect(states).toEqual(['INTERRUPTED', 'RESTORED']);
  });
});

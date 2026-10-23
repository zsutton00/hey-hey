import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { EventRouter } from 'src/core/events/event-router';
import { RedisMessageBus } from 'src/core/events/redis-message-bus.service';
import { EventEnvelope } from 'src/core/events/types/event-envelope';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { RealtimeBridge } from '../websocket-bridge.service';
import { TriggerEmitter } from '../trigger-emitter.service';
import { WebsocketGateway } from '../websocket.gateway';

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Timed out waiting for condition');
}

describe('RealtimeBridge Redis relay integration', () => {
  let redisUrl: string | undefined;
  let publisher: Redis | undefined;
  let bus: RedisMessageBus | undefined;
  let eventRouter: EventRouter | undefined;
  let bridge: RealtimeBridge | undefined;
  let redisAvailable = false;
  let redisUnavailableReason: string | undefined;
  const emitMessageRealtime = jest.fn();
  const gateway = {
    emitMessageRealtime,
  } as unknown as WebsocketGateway;
  const triggerEmitter = {
    emitConversationTriggerForMessage: jest.fn().mockResolvedValue(undefined),
  } as unknown as TriggerEmitter;

  beforeAll(async () => {
    // RedisMessageBus dedups via a shared Redis key (`bus:dedup:*` + SET NX)
    // for cluster-wide at-most-once delivery. Any other RedisMessageBus on the
    // same Redis DB — a local dev server, a parallel jest worker — wins that
    // race, so this test's own bus instance would then drop its message as a
    // duplicate and the relay never fires. Pin the test to a dedicated DB so
    // its publish/subscribe cycle is isolated from any other consumer.
    const baseRedisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    const isolatedRedisUrl = new URL(baseRedisUrl);
    isolatedRedisUrl.pathname = '/15';
    const configuredRedisUrl = isolatedRedisUrl.toString();
    try {
      const probe = new Redis(configuredRedisUrl, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        connectTimeout: 1000,
      });
      await probe.connect();
      await probe.ping();
      await probe.quit();

      redisAvailable = true;
      redisUrl = configuredRedisUrl;
    } catch (error) {
      redisUnavailableReason =
        error instanceof Error ? error.message : String(error);
    }

    if (!redisAvailable || !redisUrl) {
      return;
    }

    publisher = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
    });
    bus = new RedisMessageBus(redisUrl);
    eventRouter = new EventRouter(bus);
    bridge = new RealtimeBridge(eventRouter, gateway, triggerEmitter);
    await bridge.onModuleInit();
  }, 30000);

  afterAll(async () => {
    if (bus) {
      await bus.onModuleDestroy();
    }
    if (publisher) {
      await publisher.quit();
    }
  }, 30000);

  beforeEach(() => {
    emitMessageRealtime.mockClear();
  });

  it('relays message.realtime envelopes from Redis bus to websocket gateway', async () => {
    if (!redisAvailable) {
      console.warn(
        `[websocket-bridge.redis.integration] skipped: ${redisUnavailableReason}`,
      );
      return;
    }

    const envelope = {
      event: {
        id: randomUUID(),
        type: EVENT_TYPES.MESSAGE.REALTIME,
        aggregateId: 'msg-redis-1',
        payload: {
          payloadType: EVENT_TYPES.MESSAGE.REALTIME,
          organizationId: 'org-1',
          projectId: 'proj-1',
          conversationId: 'conv-1',
          messageId: 'msg-redis-1',
          requestId: 'req-1',
          sequence: 1,
          kind: 'loading.update',
          source: 'hey-hey-agents',
          timestamp: new Date().toISOString(),
          payload: {
            loadingText: 'Working...',
          },
        },
      },
      timestamp: new Date().toISOString(),
      organizationId: 'org-1',
      projectId: 'proj-1',
      headers: {
        sourceService: 'hey-hey-agents',
      },
    } as unknown as EventEnvelope;

    await publisher!.publish(
      'hey-hey:bus:message.realtime',
      JSON.stringify(envelope),
    );

    await waitForCondition(() => emitMessageRealtime.mock.calls.length > 0);

    expect(emitMessageRealtime).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'message.realtime',
        organizationId: 'org-1',
        projectId: 'proj-1',
        conversationId: 'conv-1',
        messageId: 'msg-redis-1',
        requestId: 'req-1',
        sequence: 1,
        kind: 'loading.update',
        source: 'hey-hey-agents',
      }),
    );
  });
});

import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { RedisService } from './redis.service';
import { RedisMessageBus } from '../events/redis-message-bus.service';
import { composeConfiguration } from '../../../../cli/src/local-app/compose';
import { parseReleaseManifest } from '../../../../cli/src/release/release-manifest';

it('routes API RedisService, event publisher/subscriber and graph/search to the same private Redis', async () => {
  const image = {
    reference: `example.test/image@sha256:${'a'.repeat(64)}`,
    platforms: ['linux/amd64', 'linux/arm64'],
  };
  const release = parseReleaseManifest(
    JSON.stringify({
      schemaVersion: 1,
      cliVersion: 'fixture',
      images: {
        api: image,
        ui: image,
        graphSearch: image,
        postgres: image,
        redis: image,
      },
    }),
  );
  const config = composeConfiguration(
    { release, modelDirectory: '/fixture/models' },
    {
      admin: 'a'.repeat(64),
      api: 'b'.repeat(64),
      graph: 'c'.repeat(64),
      jwt: 'd'.repeat(64),
      encryption: 'e'.repeat(64),
      enrollmentCodeHmac: 'f'.repeat(64),
      signingKey: 'fixture-signing-key',
    },
    4100,
  );
  const clients: Redis[] = [];
  // Keep the actual ioredis configuration parser; replace only connection I/O.
  const connect = jest
    .spyOn(Redis.prototype, 'connect')
    .mockImplementation(function (this: Redis) {
      clients.push(this);
      return Promise.resolve();
    });
  const quit = jest.spyOn(Redis.prototype, 'quit').mockResolvedValue('OK');
  const environment = config.services.api.environment;
  const previousUrl = process.env.REDIS_URL;
  process.env.REDIS_URL = environment.REDIS_URL;
  const redis = new RedisService(new ConfigService(environment));
  const bus = new RedisMessageBus();
  try {
    const destination = new URL(
      config.services['graph-search'].environment.REDIS_URL,
    );
    expect(clients).toHaveLength(3);
    expect(clients).toContain(redis.getClient());
    for (const client of clients) {
      expect(client.options.host).toBe(destination.hostname);
      expect(client.options.port).toBe(Number(destination.port));
      expect(client.options.db).toBe(0);
      expect(client.options.password).toBeFalsy();
    }
    expect(destination.hostname).toBe('redis');
    expect(config.services.redis).not.toHaveProperty('ports');
  } finally {
    await redis.onModuleDestroy();
    await bus.onModuleDestroy();
    for (const client of clients) {
      client.disconnect();
    }
    connect.mockRestore();
    quit.mockRestore();
    if (previousUrl === undefined) {
      delete process.env.REDIS_URL;
    } else {
      process.env.REDIS_URL = previousUrl;
    }
  }
});

import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';
import { ConfigModule } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { RedisMessageBus } from '../../core/events/redis-message-bus.service';
import { createMockPrismaService } from '../../utils/testUtils';
import { LocalApplicationModule } from '../local-application.module';
import { LocalPasskeyRepairService } from '../local-passkey-repair.service';
import { AccountPasskeyService } from '../../auth/passkeys/account-passkey.service';

describe('Local application startup', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('resolves passkey repair and the local first-passkey authority through the shipped modules', async () => {
    jest.replaceProperty(process, 'env', {
      ...process.env,
      DEPLOYMENT_ENVIRONMENT: 'local',
      HEYHEY_LOCAL_APPLICATION: 'true',
      INTEGRATION_ENCRYPTION_KEY: 'local-startup-test-key',
      CLAUDE_API_KEY: 'local-startup-test-key',
      BROWSER_ACCESS_TOKEN_TTL_SECONDS: '900',
      BROWSER_SESSION_INACTIVITY_TTL_SECONDS: '604800',
      BROWSER_SESSION_ABSOLUTE_TTL_SECONDS: '2592000',
      PASSWORD_CHANGE_TOKEN_TTL_SECONDS: '900',
      MCP_SHUTDOWN_TIMEOUT_MS: '0',
    });
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const module = await Test.createTestingModule({
      imports: [
        AppModule,
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        LocalApplicationModule,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(createMockPrismaService())
      .overrideProvider(RedisService)
      .useValue({ getClient: () => ({}) })
      .overrideProvider(RedisMessageBus)
      .useValue({})
      .compile();

    try {
      expect(module.get(LocalPasskeyRepairService)).toBeInstanceOf(
        LocalPasskeyRepairService,
      );
      expect(
        module.get(AccountPasskeyService).acceptsFirstPasskeyWithoutProof,
      ).toBe(true);
    } finally {
      jest.useRealTimers();
      await module.close();
    }
  });
});

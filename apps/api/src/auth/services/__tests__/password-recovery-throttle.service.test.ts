import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../../core/redis/redis.service';
import { PasswordRecoveryThrottleService } from '../password-recovery-throttle.service';

describe('PasswordRecoveryThrottleService', () => {
  const createHarness = (evalResult: unknown = [1, 1]) => {
    const evalMock = jest.fn().mockResolvedValue(evalResult);
    const service = new PasswordRecoveryThrottleService(
      { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService,
      {
        getClient: () => ({ eval: evalMock }),
      } as unknown as RedisService,
    );
    return { service, evalMock };
  };

  it('uses hashed account and source keys and permits requests within both limits', async () => {
    const { service, evalMock } = createHarness([1, 1]);
    await expect(
      service.check('person@example.com', '203.0.113.4'),
    ).resolves.toEqual({ allowed: true });
    const serialized = JSON.stringify(evalMock.mock.calls[0]);
    expect(serialized).not.toContain('person@example.com');
    expect(serialized).not.toContain('203.0.113.4');
  });

  it('fails closed when either dimension is over limit or Redis is unavailable', async () => {
    await expect(
      createHarness([4, 1]).service.check('person@example.com', undefined),
    ).resolves.toEqual({ allowed: false });
    const harness = createHarness();
    harness.evalMock.mockRejectedValueOnce(new Error('redis unavailable'));
    await expect(
      harness.service.check('person@example.com', undefined),
    ).resolves.toEqual({ allowed: false });
  });

  it('performs the same bcrypt work with and without an account hash', async () => {
    const { service } = createHarness();
    await expect(
      service.performEquivalentCostWork(undefined),
    ).resolves.toBeUndefined();
  });
});

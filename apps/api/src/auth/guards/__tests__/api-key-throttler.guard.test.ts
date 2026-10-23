import {
  getThrottleActorKey,
  isGlobalRateLimitingEnabled,
} from '../api-key-throttler.guard';

describe('isGlobalRateLimitingEnabled', () => {
  it('enables global rate limiting only in production', () => {
    expect(isGlobalRateLimitingEnabled('production')).toBe(true);
    expect(isGlobalRateLimitingEnabled(' Production ')).toBe(true);
    expect(isGlobalRateLimitingEnabled('staging')).toBe(false);
    expect(isGlobalRateLimitingEnabled('development')).toBe(false);
    expect(isGlobalRateLimitingEnabled(undefined)).toBe(false);
  });

  it('does not confuse a production Node runtime with production deployment', () => {
    const originalNodeEnvironment = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = 'production';
      expect(isGlobalRateLimitingEnabled('staging')).toBe(false);
    } finally {
      if (originalNodeEnvironment === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnvironment;
      }
    }
  });
});

describe('getThrottleActorKey', () => {
  it('uses system subject when present', () => {
    expect(
      getThrottleActorKey({
        userId: 'system-user-id',
        systemSubject: 'svc:worker',
      }),
    ).toBe('system:svc:worker');
  });

  it('uses user id for authenticated browser traffic', () => {
    expect(
      getThrottleActorKey({
        userId: 'user-123',
        email: 'zac@example.com',
      }),
    ).toBe('user:user-123');
  });

  it('falls back to api key id when no user id is attached', () => {
    expect(
      getThrottleActorKey({
        apiKeyId: 'key-123',
        authType: 'api-key',
      }),
    ).toBe('api-key:key-123');
  });

  it('returns null when no authenticated actor is available', () => {
    expect(getThrottleActorKey(undefined)).toBeNull();
    expect(getThrottleActorKey({})).toBeNull();
  });
});

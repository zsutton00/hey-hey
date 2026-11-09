import {
  ACCOUNT_PASSWORD_PROOF_LIMIT,
  AccountProofThrottleService,
} from '../account-proof-throttle.service';
import type { UserId } from '../../../types';

describe('AccountProofThrottleService', () => {
  const userId = 'user-1' as UserId;

  it('allows password proof up to the per-account limit, then refuses', async () => {
    let attempts = 0;
    const service = new AccountProofThrottleService({
      getClient: () => ({ eval: async () => ++attempts }),
    } as never);

    for (let i = 0; i < ACCOUNT_PASSWORD_PROOF_LIMIT; i += 1) {
      await expect(service.allowPasswordProof(userId)).resolves.toBe(true);
    }
    await expect(service.allowPasswordProof(userId)).resolves.toBe(false);
  });

  it('refuses when the limiter is unavailable', async () => {
    const service = new AccountProofThrottleService({
      getClient: () => ({
        eval: async () => {
          throw new Error('redis down');
        },
      }),
    } as never);

    await expect(service.allowPasswordProof(userId)).resolves.toBe(false);
  });
});

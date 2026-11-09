import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';
import type { UserId } from '../../types';

/** Password proofs allowed per account in one window. */
export const ACCOUNT_PASSWORD_PROOF_LIMIT = 5;
export const ACCOUNT_PASSWORD_PROOF_WINDOW_SECONDS = 15 * 60;

/**
 * Limits current-password proof attempts per account, so a stolen browser
 * session cannot be used to guess the password through passkey changes.
 * Fails closed when Redis is unavailable, like password recovery throttling.
 */
@Injectable()
export class AccountProofThrottleService {
  private readonly logger = new Logger(AccountProofThrottleService.name);

  constructor(private readonly redisService: RedisService) {}

  async allowPasswordProof(userId: UserId): Promise<boolean> {
    const key = `auth:account-proof:password:${createHash('sha256').update(userId).digest('hex')}`;
    try {
      const attempts = (await this.redisService.getClient().eval(
        `
          local attempts = redis.call('INCR', KEYS[1])
          if attempts == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
          return attempts
        `,
        1,
        key,
        ACCOUNT_PASSWORD_PROOF_WINDOW_SECONDS,
      )) as number;
      return attempts <= ACCOUNT_PASSWORD_PROOF_LIMIT;
    } catch {
      this.logger.warn('Account proof throttle unavailable', {
        outcome: 'fail_closed',
      });
      return false;
    }
  }
}

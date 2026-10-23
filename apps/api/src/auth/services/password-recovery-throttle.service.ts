import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { RedisService } from '../../core/redis/redis.service';

const SENTINEL_PASSWORD_HASH =
  '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5v7Z0dY8f0n5G4kN3u2i1o0p9q8r7s6';

interface PasswordRecoveryThrottleDecision {
  allowed: boolean;
}

@Injectable()
export class PasswordRecoveryThrottleService {
  private readonly logger = new Logger(PasswordRecoveryThrottleService.name);
  private readonly accountLimit: number;
  private readonly sourceLimit: number;
  private readonly windowSeconds: number;

  constructor(
    configService: ConfigService,
    private readonly redisService: RedisService,
  ) {
    this.accountLimit = this.positiveInteger(
      configService.get('PASSWORD_RECOVERY_ACCOUNT_LIMIT'),
      3,
    );
    this.sourceLimit = this.positiveInteger(
      configService.get('PASSWORD_RECOVERY_SOURCE_LIMIT'),
      10,
    );
    this.windowSeconds = this.positiveInteger(
      configService.get('PASSWORD_RECOVERY_THROTTLE_WINDOW_SECONDS'),
      15 * 60,
    );
  }

  async check(
    normalizedEmail: string,
    ipAddress: string | undefined,
  ): Promise<PasswordRecoveryThrottleDecision> {
    const accountKey = this.key('account', normalizedEmail);
    const sourceKey = this.key('source', ipAddress?.trim() || 'unknown');
    try {
      const counts = (await this.redisService.getClient().eval(
        `
          local account = redis.call('INCR', KEYS[1])
          if account == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
          local source = redis.call('INCR', KEYS[2])
          if source == 1 then redis.call('EXPIRE', KEYS[2], ARGV[1]) end
          return { account, source }
        `,
        2,
        accountKey,
        sourceKey,
        this.windowSeconds,
      )) as [number, number];
      return {
        allowed:
          counts[0] <= this.accountLimit && counts[1] <= this.sourceLimit,
      };
    } catch {
      this.logger.warn('Password recovery throttle unavailable', {
        outcome: 'fail_closed',
      });
      return { allowed: false };
    }
  }

  async performEquivalentCostWork(passwordHash: string | undefined) {
    await bcrypt.compare(
      'password-recovery-cost-probe',
      passwordHash ?? SENTINEL_PASSWORD_HASH,
    );
  }

  private key(dimension: 'account' | 'source', value: string): string {
    const digest = createHash('sha256').update(value).digest('hex');
    return `auth:password-recovery:${dimension}:${digest}`;
  }

  private positiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value ?? fallback);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new Error('Password recovery throttle configuration is invalid');
    }
    return parsed;
  }
}

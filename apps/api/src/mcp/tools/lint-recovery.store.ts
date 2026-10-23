import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../core/redis/redis.service';

/**
 * Shared store for v1 proposal-tool lint recovery telemetry. A
 * `needs_revision` response writes a short-lived key; the next clean
 * call for the same (tool, agent, scope) consumes it and stamps
 * `recovery=true` on the telemetry log. The store is Redis-backed so
 * the signal survives a different replica handling the retry — that
 * matters because recovery rate is what gates promoting rules from
 * v1 into v2.
 */

const KEY_PREFIX = 'lint-recovery:';
const TTL_SECONDS = 60 * 60; // 1 hour — long enough for an agent retry loop, short enough to bound memory.

@Injectable()
export class LintRecoveryStore {
  private readonly logger = new Logger(LintRecoveryStore.name);

  constructor(private readonly redisService: RedisService) {}

  async markNeedsRevision(key: string): Promise<void> {
    try {
      await this.redisService
        .getClient()
        .set(`${KEY_PREFIX}${key}`, '1', 'EX', TTL_SECONDS);
    } catch (error) {
      this.logger.warn(
        `markNeedsRevision failed for key=${key}: ` +
          (error instanceof Error ? error.message : 'unknown'),
      );
    }
  }

  /**
   * Atomically read-and-delete the recovery marker for `key`. Returns
   * true if the previous call for this scope was a `needs_revision`,
   * false otherwise. Uses GETDEL (Redis 6.2+) so the read and delete
   * are a single round-trip and cannot race a concurrent retry.
   */
  async consumeRecovery(key: string): Promise<boolean> {
    try {
      const previous = await this.redisService
        .getClient()
        .getdel(`${KEY_PREFIX}${key}`);
      return previous !== null;
    } catch (error) {
      this.logger.warn(
        `consumeRecovery failed for key=${key}: ` +
          (error instanceof Error ? error.message : 'unknown'),
      );
      return false;
    }
  }
}

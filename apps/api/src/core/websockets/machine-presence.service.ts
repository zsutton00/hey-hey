import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ServiceRepoBinding } from '@hey-hey/contracts/api/models';
import { MachineId, UserId } from '../../types';

@Injectable()
export class MachinePresenceService {
  private readonly logger = new Logger(MachinePresenceService.name);
  private readonly PRESENCE_TTL_SECONDS = 90;
  private readonly BINDINGS_TTL_SECONDS = 120;

  constructor(private redisService: RedisService) {}

  async setPresence(machineId: MachineId, userId: UserId): Promise<void> {
    const client = this.redisService.getClient();
    await Promise.all([
      client.set(
        `machine:presence:${machineId}`,
        userId,
        'EX',
        this.PRESENCE_TTL_SECONDS,
      ),
      client.sadd(`machine:user:${userId}`, machineId),
    ]);
    this.logger.verbose('[presence] set', { machineId, userId });
  }

  async removePresence(machineId: MachineId, userId: UserId): Promise<void> {
    const client = this.redisService.getClient();
    await Promise.all([
      client.del(`machine:presence:${machineId}`),
      client.srem(`machine:user:${userId}`, machineId),
    ]);
    this.logger.verbose('[presence] removed', { machineId, userId });
  }

  async setBindings(
    machineId: MachineId,
    bindings: ServiceRepoBinding[],
    organizationId: string,
    sourcingSocketId: string,
  ): Promise<void> {
    const client = this.redisService.getClient();
    await client.hset(`machine:bindings:${machineId}`, {
      bindings: JSON.stringify(bindings),
      organizationId,
      sourcingSocketId,
    });
    await client.expire(
      `machine:bindings:${machineId}`,
      this.BINDINGS_TTL_SECONDS,
    );
    this.logger.verbose('[bindings] set', {
      machineId,
      bindingCount: bindings.length,
    });
  }

  async isPresent(machineId: MachineId): Promise<boolean> {
    const client = this.redisService.getClient();
    const count = await client.exists(`machine:presence:${machineId}`);
    this.logger.verbose('[presence] checked', {
      machineId,
      present: count === 1,
    });
    return count === 1;
  }

  /**
   * Presence of several machines in one Redis round trip. Repeated ids are
   * checked once and an empty set makes no request. A command that failed is
   * reported in `failed` with its cause; the others keep their own results.
   * Throws only when the pipeline as a whole could not run.
   */
  async arePresent(machineIds: readonly MachineId[]): Promise<{
    present: Set<MachineId>;
    failed: Map<MachineId, string>;
  }> {
    const present = new Set<MachineId>();
    const failed = new Map<MachineId, string>();
    const distinct = [...new Set(machineIds)];
    if (distinct.length === 0) {
      return { present, failed };
    }

    const pipeline = this.redisService.getClient().pipeline();
    distinct.forEach((machineId) =>
      pipeline.exists(`machine:presence:${machineId}`),
    );
    const results = await pipeline.exec();
    if (!results) {
      throw new Error('Redis pipeline returned no results');
    }

    distinct.forEach((machineId, index) => {
      const [error, count] = results[index] ?? [
        new Error('Redis pipeline returned no result for this command'),
        0,
      ];
      if (error) {
        failed.set(machineId, error.message);
      } else if (count === 1) {
        present.add(machineId);
      }
    });
    this.logger.verbose('[presence] batch checked', {
      checked: distinct.length,
      present: present.size,
      failed: failed.size,
    });

    return { present, failed };
  }

  async getBindings(machineId: MachineId): Promise<{
    bindings: ServiceRepoBinding[];
    organizationId: string;
    sourcingSocketId: string;
  } | null> {
    const client = this.redisService.getClient();
    const data = await client.hgetall(`machine:bindings:${machineId}`);
    if (
      !data ||
      !data.bindings ||
      !data.organizationId ||
      !data.sourcingSocketId
    )
      return null;
    return {
      bindings: JSON.parse(data.bindings) as ServiceRepoBinding[],
      organizationId: data.organizationId,
      sourcingSocketId: data.sourcingSocketId,
    };
  }

  async refreshBindingsTtl(machineId: MachineId): Promise<void> {
    const client = this.redisService.getClient();
    await client.expire(
      `machine:bindings:${machineId}`,
      this.BINDINGS_TTL_SECONDS,
    );
    this.logger.verbose('[bindings] TTL refreshed', { machineId });
  }

  async removeBindings(machineId: MachineId): Promise<void> {
    const client = this.redisService.getClient();
    await client.del(`machine:bindings:${machineId}`);
    this.logger.verbose('[bindings] removed', { machineId });
  }
}

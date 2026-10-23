import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { ServiceRepoBinding } from '../../generated';
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

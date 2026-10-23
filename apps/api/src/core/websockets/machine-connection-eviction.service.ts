import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { validate as isUuid } from 'uuid';
import { RedisService } from '../redis/redis.service';
import type { MachineId } from '../../types';
import { WebsocketConnectionManager } from './websocket-connection-manager.service';

const MACHINE_EVICTION_CHANNEL = 'hey-hey:websockets:machine-eviction';

/**
 * Closes every socket a revoked machine holds, on every API replica. Each
 * replica only tracks its own sockets, so a revocation disconnects locally and
 * broadcasts the machine id for the other replicas to do the same.
 */
@Injectable()
export class MachineConnectionEvictionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MachineConnectionEvictionService.name);
  private readonly publisher: Redis;
  private subscriber?: Redis;

  constructor(
    redis: RedisService,
    private readonly connections: WebsocketConnectionManager,
  ) {
    this.publisher = redis.getClient();
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.publisher.duplicate();
    this.subscriber.on('message', this.handleMessage);
    await this.subscriber.subscribe(MACHINE_EVICTION_CHANNEL);
    this.logger.log({
      event: 'machine_connection_eviction_subscribed',
      channel: MACHINE_EVICTION_CHANNEL,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) {
      return;
    }
    this.subscriber.removeListener('message', this.handleMessage);
    await this.subscriber.quit();
  }

  async evictMachine(machineId: MachineId): Promise<number> {
    const disconnected = this.disconnectLocal(machineId, 'publisher');
    const subscribers = await this.publisher.publish(
      MACHINE_EVICTION_CHANNEL,
      machineId,
    );
    this.logger.log({
      event: 'machine_connection_eviction_published',
      machineId,
      disconnected,
      subscribers,
    });
    return disconnected;
  }

  private readonly handleMessage = (channel: string, payload: string): void => {
    if (channel !== MACHINE_EVICTION_CHANNEL) {
      return;
    }
    if (!isUuid(payload)) {
      this.logger.warn({
        event: 'machine_connection_eviction_rejected',
        reason: 'invalid_machine_id',
      });
      return;
    }
    this.disconnectLocal(payload as MachineId, 'subscriber');
  };

  private disconnectLocal(
    machineId: MachineId,
    source: 'publisher' | 'subscriber',
  ): number {
    const disconnected = this.connections.forceDisconnectMachine(machineId);
    this.logger.log({
      event: 'machine_connections_evicted_locally',
      machineId,
      disconnected,
      source,
    });
    return disconnected;
  }
}

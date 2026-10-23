import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { validate as isUuid } from 'uuid';
import { RedisService } from '../redis/redis.service';
import type { OrganizationId } from '../../types';
import { WebsocketConnectionManager } from './websocket-connection-manager.service';

const ORGANIZATION_EVICTION_CHANNEL =
  'hey-hey:websockets:organization-eviction';

@Injectable()
export class OrganizationConnectionEvictionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    OrganizationConnectionEvictionService.name,
  );
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
    await this.subscriber.subscribe(ORGANIZATION_EVICTION_CHANNEL);
    this.logger.log({
      event: 'organization_connection_eviction_subscribed',
      channel: ORGANIZATION_EVICTION_CHANNEL,
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) {
      return;
    }
    this.subscriber.removeListener('message', this.handleMessage);
    await this.subscriber.quit();
  }

  async evictOrganization(organizationId: OrganizationId): Promise<number> {
    const disconnected = this.disconnectLocal(organizationId, 'publisher');
    const subscribers = await this.publisher.publish(
      ORGANIZATION_EVICTION_CHANNEL,
      organizationId,
    );
    this.logger.log({
      event: 'organization_connection_eviction_published',
      organizationId,
      disconnected,
      subscribers,
    });
    return disconnected;
  }

  private readonly handleMessage = (channel: string, payload: string): void => {
    if (channel !== ORGANIZATION_EVICTION_CHANNEL) {
      return;
    }
    if (!isUuid(payload)) {
      this.logger.warn({
        event: 'organization_connection_eviction_rejected',
        reason: 'invalid_organization_id',
      });
      return;
    }
    this.disconnectLocal(payload as OrganizationId, 'subscriber');
  };

  private disconnectLocal(
    organizationId: OrganizationId,
    source: 'publisher' | 'subscriber',
  ): number {
    const disconnected =
      this.connections.forceDisconnectOrganization(organizationId);
    this.logger.log({
      event: 'organization_connections_evicted_locally',
      organizationId,
      disconnected,
      source,
    });
    return disconnected;
  }
}

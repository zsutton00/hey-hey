import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import Redis from 'ioredis';
import { RedisService } from '../redis/redis.service';

const CHANNEL = 'hey-hey:websockets:membership-revalidation';

/** Publish only after membership removal commits; every API instance rereads persistence. */
@Injectable()
export class ProjectMembershipRevocationService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ProjectMembershipRevocationService.name);
  private readonly publisher: Redis;
  private subscriber?: Redis;
  private revalidate?: (userId?: string) => Promise<void>;

  constructor(redis: RedisService) {
    this.publisher = redis.getClient();
  }

  registerRevalidation(revalidate: (userId?: string) => Promise<void>): void {
    this.revalidate = revalidate;
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.publisher.duplicate();
    this.subscriber.on('message', this.handleMessage);
    this.subscriber.on('ready', this.handleReady);
    await this.subscriber.subscribe(CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    this.subscriber?.removeListener('message', this.handleMessage);
    this.subscriber?.removeListener('ready', this.handleReady);
    await this.subscriber?.quit();
  }

  async membershipRemoved(userId?: string): Promise<void> {
    try {
      await this.revalidate?.(userId);
    } finally {
      // A local socket failure must not prevent eviction on other instances.
      await this.publisher.publish(CHANNEL, userId ?? '*');
    }
  }

  // Redis pub/sub is transient: reconnect must reconcile removals missed offline.
  private readonly handleReady = (): void => {
    void this.revalidate?.().catch(() => {
      this.logger.error(
        'Membership room revalidation failed after Redis reconnect',
      );
    });
  };

  private readonly handleMessage = (channel: string, userId: string): void => {
    if (channel !== CHANNEL) return;
    void this.revalidate?.(userId === '*' ? undefined : userId).catch(() => {
      this.logger.error('Membership room revalidation failed');
    });
  };
}

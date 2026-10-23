import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

const redisServiceSet = new Set();

/**
 * Centralized Redis service that provides a singleton Redis connection
 * for all services in the application. This ensures consistent configuration
 * and prevents multiple Redis connections to the same server.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private redis!: Redis;

  constructor(private configService: ConfigService) {
    this.initializeRedis();

    if (process.env.NODE_ENV !== 'test') {
      redisServiceSet.add(this);
      if (redisServiceSet.size > 1) {
        throw new Error('multiple instances of RedisService');
      }
    }
  }

  /**
   * Get the Redis client instance
   */
  getClient(): Redis {
    return this.redis;
  }

  /**
   * Initialize Redis connection using ConfigService for configuration
   */
  private initializeRedis(): void {
    const config = {
      host: this.configService.get('REDIS_HOST') || 'localhost',
      port: this.configService.get('REDIS_PORT') || 6379,
      password: this.configService.get('REDIS_PASSWORD'),
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      maxRetriesPerRequest: 3,
    };

    this.logger.debug('Initializing Redis connection with config', {
      host: config.host,
      port: config.port,
      hasPassword: !!config.password,
    });

    this.redis = new Redis(config);

    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
    });

    this.redis.on('connect', () => {
      this.logger.log('Connected to Redis successfully');
    });

    this.redis.on('ready', () => {
      this.logger.log('Redis connection is ready');
    });

    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });

    this.redis.on('reconnecting', () => {
      this.logger.log('Reconnecting to Redis...');
    });
  }

  /**
   * Clean up Redis connection on module destroy
   */
  async onModuleDestroy(): Promise<void> {
    if (this.redis) {
      this.logger.log('Closing Redis connection');
      try {
        await this.redis.quit();
      } catch (err) {
        this.logger.error('error closing redis connection', err);
      }
    }
  }
}

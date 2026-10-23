import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RedisService } from './redis.service';

/**
 * Global Redis module that provides centralized Redis service
 * Available to all modules without explicit imports
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}

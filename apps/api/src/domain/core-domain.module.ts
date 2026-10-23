import { HttpModule } from '@nestjs/axios';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ModuleRef } from '@nestjs/core';
import { DomainEventModule } from '../core/events/domain-event.module';
import { RedisModule } from '../core/redis/redis.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DOMAIN_EXPORTS, DOMAIN_SERVICES } from './domain.providers';

@Global()
@Module({
  imports: [
    HttpModule,
    ConfigModule,
    PrismaModule,
    DomainEventModule,
    RedisModule,
  ],
  providers: [
    ...DOMAIN_SERVICES,
    {
      provide: 'APP_CONTEXT',
      useFactory: (moduleRef: ModuleRef) => moduleRef,
      inject: [ModuleRef],
    },
  ],
  exports: [...DOMAIN_EXPORTS, 'APP_CONTEXT'],
})
export class CoreDomainModule {}

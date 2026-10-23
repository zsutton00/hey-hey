import { HttpModule } from '@nestjs/axios';
import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseContextProvider } from './providers/database-context.provider';
import { SearchContextProvider } from './providers/search-context.provider';
import { ProviderRegistryService } from './registry/provider-registry.service';
import { ContextResolutionService } from './services/context-resolution.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, HttpModule, ConfigModule, AuthModule],
  providers: [
    ProviderRegistryService,
    ContextResolutionService,
    DatabaseContextProvider,
    SearchContextProvider,
  ],
  exports: [
    ContextResolutionService,
    DatabaseContextProvider,
    SearchContextProvider,
  ],
})
export class ContextModule implements OnModuleInit {
  constructor(
    private readonly contextResolution: ContextResolutionService,
    private readonly databaseProvider: DatabaseContextProvider,
    private readonly searchProvider: SearchContextProvider,
  ) {}

  async onModuleInit(): Promise<void> {
    // Register all providers with the resolution service
    this.contextResolution.registerProvider(this.databaseProvider);
    this.contextResolution.registerProvider(this.searchProvider);
  }
}

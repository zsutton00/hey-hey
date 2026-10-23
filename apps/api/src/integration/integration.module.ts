import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { IntegrationController } from '../controllers/integration.controller';
import { CoreDomainModule } from '../domain/core-domain.module';
import { DomainEventModule } from '../core/events/domain-event.module';
import { QueueModule } from '../core/queue/queue.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ConnectionTestService } from '../services/connection-test.service';
import { ConfigEncryptionService } from '../services/config-encryption.service';
import { KeyProviderFactory } from '../services/encryption/key-provider.factory';
import { UserSuggestionService } from '../services/user-suggestion.service';

// Integration handlers
import { GitHubIntegrationHandler } from './handlers/github.integration.handler';
import { JiraIntegrationHandler } from './handlers/jira.integration.handler';

// Job processors
import { SyncIntegrationProcessor } from './jobs/sync-integration.job';
import { GitHubWebhookService } from 'src/services/integrations/github-webhook.service';
import { IntegrationService } from 'src/services/integrations/integration.service';
import { GitHubOAuthService } from 'src/services/integrations/github-oauth.service';
import { GitHubRepositoryService } from 'src/services/integrations/github-repository.service';

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    DomainEventModule,
    CoreDomainModule,
    HttpModule,
  ],
  controllers: [IntegrationController],
  providers: [
    // Existing services
    IntegrationService,
    ConnectionTestService,
    ConfigEncryptionService,
    GitHubWebhookService,
    GitHubOAuthService,
    GitHubRepositoryService,
    KeyProviderFactory,
    UserSuggestionService,

    // New integration handlers
    GitHubIntegrationHandler,
    JiraIntegrationHandler,

    // Job processors
    SyncIntegrationProcessor,
  ],
  exports: [
    IntegrationService,
    ConnectionTestService,
    ConfigEncryptionService,
    GitHubWebhookService,
    GitHubOAuthService,
    GitHubRepositoryService,
    GitHubIntegrationHandler,
    JiraIntegrationHandler,
    SyncIntegrationProcessor,
  ],
})
export class IntegrationModule {}

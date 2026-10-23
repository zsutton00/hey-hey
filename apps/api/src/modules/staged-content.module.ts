/**
 * Staged Content Module
 *
 * Registers all services and providers for the staged content framework.
 * Provides dependency injection configuration for the generic staged content system.
 */

import { Module, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CoreDomainModule } from '../domain/core-domain.module';
import { PrismaModule } from '../prisma/prisma.module';
import { WorkflowModule } from '../services/workflows/workflow.module';
import { WorkItemModule } from '../services/work-item.module';
import { StagedContentRefinementController } from '../controllers/staged-content-refinement.controller';

// Core services
import { ContentTypeRegistryService } from '../services/staged-content/content-type-registry.service';
import { StageManagementService } from '../services/staged-content/stage-management.service';
import { StagedContentService } from '../services/staged-content/staged-content.service';
import { UrlAliasService } from '../services/url-alias.service';
import { DesignDocStagedContentAdapter } from '../adapters/staged-content/design-doc.adapter';

// Content type configurations
import { WORK_ITEM_CONTENT_TYPE } from '../config/content-types/work-item.config';
import { INITIATIVE_CONTENT_TYPE } from '../config/content-types/initiative.config';
import {
  ADR_DESIGN_DOC_CONTENT_TYPE,
  BRAINSTORM_DESIGN_DOC_CONTENT_TYPE,
  DECISION_DESIGN_DOC_CONTENT_TYPE,
} from '../config/content-types/design-doc.config';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    CoreDomainModule,
    forwardRef(() => WorkItemModule),
  ],
  controllers: [StagedContentRefinementController],
  providers: [
    // Core services
    ContentTypeRegistryService,
    StageManagementService,
    StagedContentService,
    DesignDocStagedContentAdapter,

    // Support services
    UrlAliasService,

    // DesignDocService is now provided globally by CoreDomainModule

    // Utilities
  ],
  exports: [
    ContentTypeRegistryService,
    StageManagementService,
    StagedContentService,
    DesignDocStagedContentAdapter,
    UrlAliasService,
    // DesignDocService is now exported globally by CoreDomainModule
  ],
})
export class StagedContentModule implements OnModuleInit {
  private readonly logger = new Logger(StagedContentModule.name);

  constructor(
    private readonly contentTypeRegistry: ContentTypeRegistryService,
  ) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('Initializing Staged Content Module');
    await this.registerDefaultContentTypes();
    this.logger.log('Staged Content Module initialized successfully');
  }

  /**
   * Register default content types during module initialization
   */
  private async registerDefaultContentTypes(): Promise<void> {
    try {
      // Register work item content type
      this.contentTypeRegistry.register(WORK_ITEM_CONTENT_TYPE);
      this.logger.log(`Registered content type: ${WORK_ITEM_CONTENT_TYPE.id}`);

      // Register initiative content type
      this.contentTypeRegistry.register(INITIATIVE_CONTENT_TYPE);
      this.logger.log(`Registered content type: ${INITIATIVE_CONTENT_TYPE.id}`);

      // Register design document content types
      this.contentTypeRegistry.register(ADR_DESIGN_DOC_CONTENT_TYPE);
      this.logger.log(
        `Registered content type: ${ADR_DESIGN_DOC_CONTENT_TYPE.id}`,
      );

      this.contentTypeRegistry.register(DECISION_DESIGN_DOC_CONTENT_TYPE);
      this.logger.log(
        `Registered content type: ${DECISION_DESIGN_DOC_CONTENT_TYPE.id}`,
      );

      this.contentTypeRegistry.register(BRAINSTORM_DESIGN_DOC_CONTENT_TYPE);
      this.logger.log(
        `Registered content type: ${BRAINSTORM_DESIGN_DOC_CONTENT_TYPE.id}`,
      );

      // Log registration statistics
      const stats = this.contentTypeRegistry.getStats();
      this.logger.log('Content type registration completed', {
        totalContentTypes: stats.totalContentTypes,
        byImplementationType: stats.byImplementationType,
        byEntityType: stats.byEntityType,
      });
    } catch (error) {
      this.logger.error('Failed to register default content types', error);
      throw error;
    }
  }
}

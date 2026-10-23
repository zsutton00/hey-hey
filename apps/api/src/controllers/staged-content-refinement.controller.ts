import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ProjectResourceAccessService } from '../auth/services/project-resource-access.service';
import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
/**
 * Unified Staged Content Controller
 *
 * Provides generic REST API endpoints for all types of staged content.
 * Routes internally to existing controllers while maintaining backward compatibility.
 * Enables gradual migration through feature flags.
 */

import {
  Body,
  ForbiddenException,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { StageOperationResult } from '../generated';
import { ContentTypeRegistryService } from '../services/staged-content/content-type-registry.service';
import { StagedContentService } from '../services/staged-content/staged-content.service';
import { OrganizationId, ProjectId } from '../types';
import {
  AdvanceRequest,
  ContentTypeId,
  RefineRequest,
  StageOperation,
} from '../types/staged-content.types';

/**
 * Unified Staged Content Controller
 *
 * URL Pattern: /api/v1/organizations/:organizationId/projects/:projectId/staged-content/:contentType/:entityId
 */
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/staged-content/:contentType/:entityId',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
@ApiTags('Staged Content')
@ApiBearerAuth()
export class StagedContentRefinementController {
  private readonly logger = new Logger(StagedContentRefinementController.name);

  constructor(
    private readonly projectResources: ProjectResourceAccessService,
    private readonly stagedContentService: StagedContentService,
    private readonly contentTypeRegistry: ContentTypeRegistryService,
  ) {}

  private async authorizeContent(
    userId: string,
    organizationId: OrganizationId,
    projectId: ProjectId,
    contentType: string,
    entityId: string,
  ): Promise<void> {
    const definition = this.contentTypeRegistry.get(
      contentType as ContentTypeId,
    );
    const resources = {
      DesignDoc: 'designDoc',
      Initiative: 'initiative',
      WorkItem: 'task',
    } as const;
    const resource =
      resources[definition.entitySchema.entityType as keyof typeof resources];
    if (!resource)
      throw new ForbiddenException('Content ownership cannot be resolved');
    await this.projectResources.assertResource(
      userId,
      organizationId,
      resource,
      entityId,
      projectId,
    );
  }

  /**
   * Advance to next stage
   */
  @Post('advance')
  @ApiOperation({
    summary: 'Advance to next stage',
    description: 'Move the staged content to the next stage in the progression',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully advanced to next stage',
    type: Object, // Would be OperationResponse in real implementation
  })
  @ApiResponse({
    status: 400,
    description: 'Cannot advance due to validation errors',
  })
  async advance(
    @CurrentUser('userId') userId: string,
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('contentType') contentType: string,
    @Param('entityId') entityId: string,
    @Body() advanceRequest: AdvanceRequest,
  ): Promise<StageOperationResult> {
    await this.authorizeContent(
      userId,
      organizationId,
      projectId,
      contentType,
      entityId,
    );
    this.logger.debug('BUG205 advance request received', {
      organizationId,
      projectId,
      contentType,
      entityId,
      targetStage: advanceRequest?.targetStage,
      skipValidation: advanceRequest?.skipValidation,
      options: advanceRequest?.options,
    });

    this.logger.log(`Advancing ${contentType}:${entityId} to next stage`, {
      organizationId,
      projectId,
      contentType,
      entityId,
      advanceRequest,
    });

    const operation: StageOperation = {
      contentTypeId: contentType as ContentTypeId,
      entityId,
      organizationId: organizationId,
      projectId,
      operationType: 'advance',
      payload: {
        targetStage: advanceRequest.targetStage,
        options: advanceRequest.options,
        validationOverride: advanceRequest.skipValidation,
      },
    };

    try {
      const result =
        await this.stagedContentService.processStageOperation(operation);

      this.logger.debug('BUG205 advance completed', {
        organizationId,
        projectId,
        contentType,
        entityId,
        success: result?.success,
        newStage: result?.newStage,
        message: result?.message,
        workflowId: result?.workflowId,
        conversationId: result?.conversationId,
      });

      return result;
    } catch (error) {
      this.logger.error('BUG205 advance failed', {
        organizationId,
        projectId,
        contentType,
        entityId,
        error: error instanceof Error ? error.message : error,
      });
      this.logger.error(`Failed to advance ${contentType}:${entityId}`, error);
      throw error;
    }
  }

  /**
   * AI-assisted content refinement
   */
  @Post('refine')
  @ApiOperation({
    summary: 'AI-assisted content refinement',
    description: 'Get AI assistance to refine content at the current stage',
  })
  @ApiResponse({
    status: 200,
    description: 'Content refinement completed successfully',
    type: Object, // Would be OperationResponse in real implementation
  })
  async refine(
    @CurrentUser('userId') userId: string,
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('contentType') contentType: string,
    @Param('entityId') entityId: string,
    @Body() refineRequest: RefineRequest,
  ): Promise<StageOperationResult> {
    await this.authorizeContent(
      userId,
      organizationId,
      projectId,
      contentType,
      entityId,
    );
    this.logger.log(`Refining ${contentType}:${entityId}`, {
      organizationId,
      projectId,
      contentType,
      entityId,
      message: refineRequest.message?.substring(0, 100), // Log first 100 chars
    });

    const operation: StageOperation = {
      contentTypeId: contentType as ContentTypeId,
      entityId,
      organizationId,
      projectId,
      operationType: 'refine',
      payload: {
        message: refineRequest.message,
        options: refineRequest.options,
      },
      metadata: {
        classifiedIntent: refineRequest.classifiedIntent,
        planId: refineRequest.planId,
      },
    };

    try {
      const result =
        await this.stagedContentService.processStageOperation(operation);

      return result;
    } catch (error) {
      this.logger.error(`Failed to refine ${contentType}:${entityId}`, error);
      throw error;
    }
  }

  /**
   * Finalize staged content
   */
  @Post('finalize')
  @ApiOperation({
    summary: 'Finalize staged content',
    description: 'Complete the staged content refinement process',
  })
  @ApiResponse({
    status: 200,
    description: 'Content finalized successfully',
    type: Object, // Would be OperationResponse in real implementation
  })
  async finalize(
    @CurrentUser('userId') userId: string,
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('contentType') contentType: string,
    @Param('entityId') entityId: string,
  ): Promise<StageOperationResult> {
    await this.authorizeContent(
      userId,
      organizationId,
      projectId,
      contentType,
      entityId,
    );
    this.logger.log(`Finalizing ${contentType}:${entityId}`, {
      organizationId,
      projectId,
      contentType,
      entityId,
    });

    const operation: StageOperation = {
      contentTypeId: contentType as ContentTypeId,
      entityId,
      organizationId,
      projectId,
      operationType: 'finalize',
      payload: {},
    };

    try {
      const result =
        await this.stagedContentService.processStageOperation(operation);

      return result;
    } catch (error) {
      this.logger.error(`Failed to finalize ${contentType}:${entityId}`, error);
      throw error;
    }
  }

  /**
   * Get available content types
   */
  @Get('/content-types')
  @ApiOperation({
    summary: 'Get available content types',
    description: 'List all supported content types in the system',
  })
  @ApiResponse({
    status: 200,
    description: 'Content types retrieved successfully',
  })
  async getContentTypes(): Promise<
    Array<{
      id: string;
      displayName: string;
      description: string;
      implementationType: string;
      stageCount: number;
      features: Record<string, boolean>;
    }>
  > {
    const contentTypes = this.contentTypeRegistry.getAll();

    return contentTypes.map((ct) => ({
      id: ct.id,
      displayName: ct.displayName,
      description: ct.description || '',
      implementationType: ct.implementationType as string,
      stageCount: ct.stages.length,
      features: (ct.features || {}) as Record<string, boolean>,
    }));
  }
}

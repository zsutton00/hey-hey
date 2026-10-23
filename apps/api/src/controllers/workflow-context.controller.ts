/**
 * Workflow Context Management Controller
 *
 * Provides API endpoints for Phase 3 context management features including
 * versioning, sharing, and transformation capabilities.
 */

import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  HttpException,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { ContextVersionManager } from '../workflows/context/context-version-manager';
import { ContextSharingManager } from '../workflows/context/context-sharing-manager';
import { ContextTransformationPipeline } from '../workflows/context/context-transformation-pipeline';
import { WorkflowId, OrganizationId } from '../types';
import {
  ContextVersionDto,
  CreateContextVersionDto,
  ContextSnapshotDto,
  CreateContextSnapshotDto,
  SharedContextDto,
  CreateSharedContextDto,
  ContextAccessRequestDto,
  ContextAccessResultDto,
  UpdateSharedContextDto,
  UpdateSharedContextResponseDto,
  TransformationPipelineDto,
  CreateTransformationPipelineDto,
  ProcessContextThroughPipelineDto,
  WorkflowContextCleanupResponseDto,
} from '../generated';

@ApiTags('workflow-context')
@Controller('workflow-context')
export class WorkflowContextController {
  constructor(
    private readonly versionManager: ContextVersionManager,
    private readonly sharingManager: ContextSharingManager,
    private readonly transformationPipeline: ContextTransformationPipeline,
  ) {}

  // Context Versioning Endpoints

  @Get('workflows/:workflowId/versions')
  @ApiOperation({
    summary: 'Get context versions for workflow',
    description: 'Returns all context versions for a specific workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to get versions for',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of versions to return',
  })
  @ApiResponse({
    status: 200,
    description: 'List of context versions',
  })
  getContextVersions(
    @Param('workflowId') workflowId: WorkflowId,
    @Query('limit') limit?: number,
  ): ContextVersionDto[] {
    // Placeholder implementation - would call actual service method
    return [
      {
        id: `version_${workflowId}_1`,
        workflowId,
        version: 1,
        context: { example: 'data' },
        metadata: {
          createdBy: 'system',
          reason: 'Auto-version',
          tags: ['auto'],
        },
        timestamp: new Date().toISOString(),
        contextHash: 'hash123',
      },
    ];
  }

  @Get('workflows/:workflowId/versions/:versionId')
  @ApiOperation({
    summary: 'Get specific context version',
    description: 'Returns a specific context version by ID',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiParam({
    name: 'versionId',
    description: 'The ID of the version to retrieve',
  })
  @ApiResponse({
    status: 200,
    description: 'Context version details',
  })
  getContextVersion(
    @Param('workflowId') workflowId: WorkflowId,
    @Param('versionId') versionId: string,
  ): ContextVersionDto {
    // Placeholder implementation - would call actual service method
    return {
      id: versionId,
      workflowId,
      version: 1,
      context: { example: 'data' },
      metadata: {
        createdBy: 'system',
        reason: 'Auto-version',
        tags: ['auto'],
      },
      timestamp: new Date().toISOString(),
      contextHash: 'hash123',
    };
  }

  @Post('workflows/:workflowId/versions')
  @ApiOperation({
    summary: 'Create new context version',
    description: 'Creates a new version of the workflow context',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiBody({
    description: 'Version creation parameters',
  })
  @ApiResponse({
    status: 201,
    description: 'Created context version',
  })
  createContextVersion(
    @Param('workflowId') workflowId: WorkflowId,
    @Body() body: CreateContextVersionDto,
  ): ContextVersionDto {
    const { context, metadata } = body;

    if (!context || !metadata) {
      throw new HttpException(
        'context and metadata are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Placeholder implementation - would call actual service method
    return {
      id: `version_${Date.now()}`,
      workflowId,
      version: 2,
      context,
      metadata,
      timestamp: new Date().toISOString(),
      contextHash: 'hash456',
    };
  }

  @Post('workflows/:workflowId/snapshots')
  @ApiOperation({
    summary: 'Create context snapshot',
    description: 'Creates a quick snapshot of the current context',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiBody({
    description: 'Snapshot parameters',
  })
  @ApiResponse({
    status: 201,
    description: 'Created context snapshot',
  })
  createContextSnapshot(
    @Param('workflowId') workflowId: WorkflowId,
    @Body() body: CreateContextSnapshotDto,
  ): ContextSnapshotDto {
    const { context, description, createdBy, tags } = body;

    // Placeholder implementation - would call actual service method
    return {
      id: `snapshot_${Date.now()}`,
      workflowId,
      context,
      description,
      createdBy,
      tags,
      timestamp: new Date().toISOString(),
    };
  }

  @Post('workflows/:workflowId/versions/:versionId/restore')
  @ApiOperation({
    summary: 'Restore to context version',
    description: 'Restores workflow to a specific context version',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiParam({
    name: 'versionId',
    description: 'The ID of the version to restore to',
  })
  @ApiResponse({
    status: 200,
    description: 'Restored context',
    schema: { type: 'object', description: 'Flow context data' },
  })
  restoreContextVersion(
    @Param('workflowId') workflowId: WorkflowId,
    @Param('versionId') versionId: string,
  ): Record<string, unknown> {
    // Placeholder implementation - would call actual service method
    return {
      core: { workflowId, currentNodeId: 'restored_node' },
      flowId: 'restored_flow',
      flowPath: [],
      custom: { restoredFromVersion: versionId },
    };
  }

  // Context Sharing Endpoints

  @Post('workflows/:workflowId/share')
  @ApiOperation({
    summary: 'Share workflow context',
    description: 'Shares workflow context with other workflows',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to share context from',
  })
  @ApiBody({
    description: 'Context sharing parameters',
  })
  @ApiResponse({
    status: 201,
    description: 'Created shared context',
  })
  shareContext(
    @Param('workflowId') workflowId: WorkflowId,
    @Body() body: CreateSharedContextDto,
  ): SharedContextDto {
    const {
      organizationId,
      projectId,
      context,
      shareConfig,
      permissions,
      contextVersion,
    } = body;

    // Placeholder implementation - would call actual service method
    return {
      id: `shared_${Date.now()}`,
      sourceWorkflowId: workflowId,
      organizationId,
      projectId,
      context,
      shareConfig,
      permissions,
      createdAt: new Date().toISOString(),
      contextVersion,
    };
  }

  @Post('workflows/:workflowId/context/:sharedContextId/access')
  @ApiOperation({
    summary: 'Request access to shared context',
    description: 'Requests access to a shared context from another workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the requesting workflow',
  })
  @ApiParam({
    name: 'sharedContextId',
    description: 'The ID of the shared context',
  })
  @ApiBody({
    description: 'Access request parameters',
  })
  @ApiResponse({
    status: 200,
    description: 'Context access result',
  })
  requestContextAccess(
    @Param('workflowId') workflowId: WorkflowId,
    @Param('sharedContextId') sharedContextId: string,
    @Body() body: ContextAccessRequestDto,
  ): ContextAccessResultDto {
    const { requestedPermissions, reason } = body;

    // Placeholder implementation - would call actual service method
    return {
      granted: true,
      sharedContextId,
      permissions: requestedPermissions || {
        canRead: true,
        canWrite: false,
        canShare: false,
      },
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
    };
  }

  @Get('workflows/:workflowId/shared-contexts')
  @ApiOperation({
    summary: 'Get shared contexts for workflow',
    description: 'Returns all shared contexts accessible to a workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiQuery({
    name: 'organizationId',
    required: false,
    description: 'Filter by organization ID',
  })
  @ApiResponse({
    status: 200,
    description: 'List of accessible shared contexts',
  })
  getSharedContexts(
    @Param('workflowId') workflowId: WorkflowId,
    @Query('organizationId') organizationId?: OrganizationId,
  ): SharedContextDto[] {
    // Placeholder implementation - would call actual service method
    return [];
  }

  @Put('workflows/:workflowId/context/:sharedContextId')
  @ApiOperation({
    summary: 'Update shared context',
    description: 'Updates a shared context (for live sharing)',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow updating the context',
  })
  @ApiParam({
    name: 'sharedContextId',
    description: 'The ID of the shared context to update',
  })
  @ApiBody({
    description: 'Context updates',
  })
  @ApiResponse({
    status: 200,
    description: 'Update success status',
  })
  updateSharedContext(
    @Param('workflowId') workflowId: WorkflowId,
    @Param('sharedContextId') sharedContextId: string,
    @Body() body: UpdateSharedContextDto,
  ) {
    const { contextUpdates, changeDescription } = body;

    const success = this.sharingManager.updateSharedContext(
      workflowId,
      sharedContextId,
      contextUpdates,
      changeDescription,
    );

    if (!success) {
      throw new HttpException(
        `Failed to update shared context ${sharedContextId}`,
        HttpStatus.FORBIDDEN,
      );
    }

    return {
      success,
      sharedContextId,
      updatedAt: new Date().toISOString(),
    };
  }

  // Context Transformation Endpoints

  @Get('workflows/:workflowId/pipelines')
  @ApiOperation({
    summary: 'Get transformation pipelines',
    description: 'Returns all transformation pipelines for a workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiResponse({
    status: 200,
    description: 'List of transformation pipelines',
  })
  getTransformationPipelines(
    @Param('workflowId') workflowId: WorkflowId,
  ): TransformationPipelineDto[] {
    // Placeholder implementation - would call actual service method
    return [];
  }

  @Post('workflows/:workflowId/pipelines')
  @ApiOperation({
    summary: 'Create transformation pipeline',
    description: 'Creates a new context transformation pipeline',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiBody({
    description: 'Pipeline configuration',
  })
  @ApiResponse({
    status: 201,
    description: 'Created transformation pipeline',
  })
  createTransformationPipeline(
    @Param('workflowId') workflowId: WorkflowId,
    @Body() body: CreateTransformationPipelineDto,
  ): TransformationPipelineDto {
    const { name, steps } = body;

    // Placeholder implementation - would call actual service method
    return {
      id: `pipeline_${Date.now()}`,
      name,
      workflowId,
      steps,
      createdAt: new Date().toISOString(),
      enabled: true,
    };
  }

  @Post('workflows/:workflowId/pipelines/:pipelineName/process')
  @ApiOperation({
    summary: 'Process context through pipeline',
    description: 'Processes a context through a transformation pipeline',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow',
  })
  @ApiParam({
    name: 'pipelineName',
    description: 'The name of the pipeline to use',
  })
  @ApiBody({
    description: 'Context to process',
  })
  @ApiResponse({
    status: 200,
    description: 'Processed context',
    schema: { type: 'object', description: 'Transformed flow context' },
  })
  async processContextThroughPipeline(
    @Param('workflowId') workflowId: WorkflowId,
    @Param('pipelineName') pipelineName: string,
    @Body() body: ProcessContextThroughPipelineDto,
  ): Promise<Record<string, unknown>> {
    // Placeholder implementation - would call actual service method
    return Promise.resolve({
      ...body.context,
      processedBy: pipelineName,
      processedAt: new Date().toISOString(),
    });
  }

  @Delete('workflows/:workflowId/cleanup')
  @ApiOperation({
    summary: 'Cleanup workflow context data',
    description: 'Cleans up all context data for a completed workflow',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to clean up',
  })
  @ApiResponse({
    status: 200,
    description: 'Cleanup status',
  })
  cleanupWorkflowContext(@Param('workflowId') workflowId: WorkflowId) {
    try {
      // Perform cleanup across all systems
      this.versionManager.cleanup(workflowId);
      this.sharingManager.cleanup(workflowId);
      this.transformationPipeline.cleanup(workflowId);

      return {
        success: true,
        workflowId,
        cleanedUp: {
          versions: 0, // Would need actual counts from cleanup methods
          sharedContexts: 0,
          pipelines: 0,
        },
        cleanedAt: new Date().toISOString(),
      };
    } catch (error) {
      throw new HttpException(
        `Failed to cleanup workflow context: ${(error as Error).message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

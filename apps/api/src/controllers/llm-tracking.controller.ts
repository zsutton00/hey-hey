import { ProjectAccessService } from '../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../auth/services/project-resource-access.service';
import {
  BadRequestException,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Query,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { LLMTrackingService } from '../services/llm/llm-tracking.service';
import { OrganizationId } from '../types';

@ApiTags('Debug/Admin')
@Controller('api/v1/llm-tracking')
export class LLMTrackingController {
  private readonly logger = new Logger(LLMTrackingController.name);

  constructor(
    private readonly llmTrackingService: LLMTrackingService,
    private readonly projectAccess: ProjectAccessService,
    private readonly projectResources: ProjectResourceAccessService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List LLM prompt/response records',
    description:
      'Get paginated list of LLM prompt/response records for debugging and analysis',
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number (1-indexed)',
    required: false,
    type: 'number',
    example: 1,
  })
  @ApiQuery({
    name: 'limit',
    description: 'Items per page',
    required: false,
    type: 'number',
    example: 20,
  })
  @ApiQuery({
    name: 'workflowId',
    description: 'Filter by workflow ID',
    required: false,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'conversationId',
    description: 'Filter by conversation ID',
    required: false,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Filter by project ID',
    required: false,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'orgId',
    description: 'Filter by organization ID (admin/debug override)',
    required: false,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'nodeId',
    description: 'Filter by node ID',
    required: false,
    type: 'string',
  })
  @ApiQuery({
    name: 'provider',
    description: 'Filter by LLM provider',
    required: false,
    type: 'string',
    example: 'anthropic',
  })
  @ApiQuery({
    name: 'success',
    description: 'Filter by success status',
    required: false,
    type: 'boolean',
  })
  @ApiQuery({
    name: 'startDate',
    description: 'Filter records created at or after this ISO timestamp',
    required: false,
    type: 'string',
    format: 'date-time',
  })
  @ApiQuery({
    name: 'endDate',
    description: 'Filter records created at or before this ISO timestamp',
    required: false,
    type: 'string',
    format: 'date-time',
  })
  @ApiResponse({
    status: 200,
    description: 'LLM prompt/response records retrieved successfully',
  })
  async listPromptResponses(
    @CurrentUser() user: AuthenticatedUser,
    @Query('page') page: number = 1,
    @Query('limit') limit?: number,
    @Query('workflowId') workflowId?: string,
    @Query('conversationId') conversationId?: string,
    @Query('projectId') projectId?: string,
    @Query('orgId') orgId?: string,
    @Query('nodeId') nodeId?: string,
    @Query('provider') provider?: string,
    @Query('success') success?: boolean,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    this.logger.log(
      `User ${user.userId} requesting LLM prompt/response records`,
    );

    try {
      const parsedStartDate = this.parseDateQuery('startDate', startDate);
      const parsedEndDate = this.parseDateQuery('endDate', endDate);
      if (parsedStartDate && parsedEndDate && parsedStartDate > parsedEndDate) {
        throw new BadRequestException(
          'startDate must be before or equal to endDate',
        );
      }

      const organizationId = orgId ?? user.currentOrgId;
      const accessibleProjectIds =
        await this.projectAccess.accessibleProjectIds(
          user.userId,
          organizationId,
        );
      if (projectId)
        await this.projectAccess.assertProject(
          user.userId,
          organizationId,
          projectId,
        );
      if (conversationId)
        await this.projectResources.assertResource(
          user.userId,
          organizationId,
          'conversation',
          conversationId,
        );

      // Apply authorization before pagination and before prompt content is read.
      const where: Record<string, unknown> = {
        organizationId,
        AND: [
          {
            OR: [
              { projectId: null },
              { projectId: { in: accessibleProjectIds } },
            ],
          },
        ],
      };

      if (workflowId) where.workflowId = workflowId;
      if (conversationId) where.conversationId = conversationId;
      if (projectId) where.projectId = projectId;
      if (nodeId) where.nodeId = nodeId;
      if (provider) where.provider = provider;
      if (success !== undefined) where.success = success;
      if (parsedStartDate || parsedEndDate) {
        where.createdAt = {
          ...(parsedStartDate ? { gte: parsedStartDate } : {}),
          ...(parsedEndDate ? { lte: parsedEndDate } : {}),
        };
      }

      // Calculate pagination
      const effectiveLimit =
        limit ?? (parsedStartDate && parsedEndDate ? undefined : 20);
      const skip =
        effectiveLimit === undefined ? undefined : (page - 1) * effectiveLimit;

      // Fetch records
      const records = await this.llmTrackingService.findMany({
        where,
        skip,
        take: effectiveLimit,
        orderBy: { createdAt: 'desc' },
      });

      return {
        data: records,
        pagination: {
          page,
          limit: effectiveLimit ?? records.length,
          total: records.length, // Note: This is not accurate total, would need separate count query
        },
      };
    } catch (error) {
      this.logger.error(
        `Failed to list prompt/response records: ${(error as Error).message}`,
        (error as Error).stack,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to retrieve LLM tracking records',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private parseDateQuery(paramName: string, value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }
    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      throw new BadRequestException(`Invalid ${paramName}: "${value}"`);
    }
    return parsedDate;
  }

  @Get('stats')
  @ApiOperation({
    summary: 'Get LLM usage statistics',
    description:
      'Get aggregate statistics about LLM usage for the current organization',
  })
  @ApiResponse({
    status: 200,
    description: 'Statistics retrieved successfully',
  })
  async getStats(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(
      `User ${user.userId} requesting LLM usage statistics for organization ${user.currentOrgId}`,
    );

    try {
      const accessibleProjectIds =
        await this.projectAccess.accessibleProjectIds(
          user.userId,
          user.currentOrgId,
        );
      const stats = await this.llmTrackingService.getStats(
        user.currentOrgId,
        accessibleProjectIds,
      );

      return {
        organizationId: user.currentOrgId,
        stats,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to get LLM usage statistics: ${(error as Error).message}`,
        (error as Error).stack,
      );

      if (error instanceof HttpException) throw error;
      throw new HttpException(
        'Failed to retrieve LLM usage statistics',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get single LLM prompt/response record',
    description: 'Get detailed information about a specific prompt/response',
  })
  @ApiParam({
    name: 'id',
    description: 'LLM prompt/response record ID',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Record retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Record not found',
  })
  async getPromptResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    this.logger.log(
      `User ${user.userId} requesting LLM prompt/response record: ${id}`,
    );

    try {
      await this.projectResources.assertResource(
        user.userId,
        user.currentOrgId,
        'llmRecord',
        id,
      );
      const record = await this.llmTrackingService.findById(id);

      if (!record) {
        throw new HttpException(
          `LLM prompt/response record ${id} not found`,
          HttpStatus.NOT_FOUND,
        );
      }

      // Verify user has access to this record's organization
      if (record.organizationId !== user.currentOrgId) {
        throw new HttpException(
          'Unauthorized access to this record',
          HttpStatus.FORBIDDEN,
        );
      }

      return record;
    } catch (error) {
      this.logger.error(
        `Failed to get prompt/response record ${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to retrieve LLM tracking record',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

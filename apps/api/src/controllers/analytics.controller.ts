import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  ParseBoolPipe,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  AttentionEvent,
  EventBatch,
  TrackAttentionEvents201Response,
  TrackEventBatch201Response,
} from '../generated';
import { AnalyticsService } from '../services/analytics/analytics.service';
import {
  AttentionEventService,
  AttentionEventSortMode,
  GetAttentionEventsResponseData,
} from '../services/analytics/attention-event.service';

@ApiTags('Analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('api/v1/analytics')
export class AnalyticsController {
  private readonly logger = new Logger(AnalyticsController.name);

  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly attentionEventService: AttentionEventService,
  ) {}

  @Post('events')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 100, ttl: 60 } })
  @ApiOperation({
    summary: 'Track batch of user analytics events',
    description:
      'Record a batch of user tracking events for analytics and behavioral insights.',
  })
  @ApiResponse({
    status: 201,
    description: 'Event batch recorded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid event batch data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token missing or invalid',
  })
  @ApiResponse({
    status: 413,
    description: 'Payload too large',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async trackEvents(
    @Body() batch: EventBatch,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TrackEventBatch201Response> {
    this.logger.debug(
      `Tracking analytics batch ${batch.batchId} for user ${user.userId}`,
    );

    const data = await this.analyticsService.recordEventBatch(user, batch);

    return {
      success: true,
      message: 'Event batch recorded successfully',
      data,
      timestamp: new Date().toISOString(),
      statusCode: HttpStatus.CREATED,
      path: req.path,
    };
  }

  @Post('attention')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 100, ttl: 60 } })
  @ApiOperation({
    summary: 'Track user attention events',
    description:
      'Record a batch of user attention events for engagement and focus tracking',
  })
  @ApiResponse({
    status: 201,
    description: 'Attention events recorded successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid attention events data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token missing or invalid',
  })
  @ApiResponse({
    status: 429,
    description: 'Rate limit exceeded',
  })
  async trackAttentionEvents(
    @Body() requestBody: { events: AttentionEvent[] },
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<TrackAttentionEvents201Response> {
    this.logger.debug(
      `Tracking ${requestBody.events.length} attention events for user ${user.userId}`,
    );

    const data = await this.attentionEventService.recordAttentionEvents(
      user,
      requestBody.events,
    );

    return {
      success: true,
      message: 'Attention events recorded successfully',
      data: {
        eventCount: data.eventCount,
        timestamp: data.timestamp,
      },
      timestamp: new Date().toISOString(),
      statusCode: HttpStatus.CREATED,
      path: req.path,
    };
  }

  @Get('attention')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 100, ttl: 60 } })
  @ApiOperation({
    summary: 'Get user attention events',
    description:
      'Retrieve paginated user attention events sorted by recency and time spent',
  })
  @ApiQuery({
    name: 'limit',
    type: Number,
    required: false,
    example: 10,
    description: 'Max results (1-50)',
  })
  @ApiQuery({
    name: 'offset',
    type: Number,
    required: false,
    example: 0,
    description: 'Pagination offset',
  })
  @ApiQuery({
    name: 'sort',
    type: String,
    required: false,
    example: 'mostRecent',
    description: 'Sort mode (mostRecent, mostActive, mixed)',
  })
  @ApiQuery({
    name: 'includeEntity',
    type: Boolean,
    required: false,
    example: false,
    description: 'When true, include the full entity payload for each event',
  })
  @ApiQuery({
    name: 'since',
    type: String,
    required: false,
    description:
      'ISO timestamp or unix ms. Default: 7 days ago. Example: 2025-12-01 or 1733193600000',
  })
  @ApiQuery({
    name: 'projectId',
    type: String,
    required: false,
    description: 'Filter events to a specific project',
  })
  @ApiResponse({
    status: 200,
    description: 'Attention events retrieved successfully',
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid query parameters',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - JWT token missing or invalid',
  })
  async getAttentionEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
    @Query('sort', new DefaultValuePipe('mostRecent'))
    sort: AttentionEventSortMode,
    @Query('includeEntity', new DefaultValuePipe(false), ParseBoolPipe)
    includeEntity: boolean,
    @Query('since') since?: string,
    @Query('projectId') projectId?: string,
  ): Promise<GetAttentionEventsResponseData> {
    // Validate limit
    if (limit < 1 || limit > 50) {
      throw new BadRequestException('limit must be between 1 and 50');
    }
    if (offset < 0) {
      throw new BadRequestException('offset must be >= 0');
    }
    if (!['mostRecent', 'mostActive', 'mixed'].includes(sort)) {
      throw new BadRequestException(
        'sort must be one of: mostRecent, mostActive, mixed',
      );
    }

    this.logger.debug(
      `Retrieving attention events for user ${user.userId} (limit: ${limit}, offset: ${offset}, sort: ${sort}, includeEntity: ${includeEntity}, projectId: ${projectId})`,
    );

    return this.attentionEventService.getAttentionEvents(user, {
      limit,
      offset,
      sort,
      includeEntity,
      since,
      projectId,
    });
  }
}

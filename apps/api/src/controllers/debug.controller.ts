import { UseGuards } from '@nestjs/common';
import {
  TIMELINE_MESSAGE_WHERE,
  timelineCreatedAt,
} from 'src/utils/message-timeline.util';
import { AdminGuard } from '../auth/guards/admin.guard';
import { ProjectAccessService } from '../auth/services/project-access.service';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Client } from '@temporalio/client';
import { uuidv4 } from 'lib0/random';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { NoLogging } from '../common/decorators/no-logging.decorator';
import { CustomLoggerService } from '../common/logger/logger.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import { OUTBOX_STORE_TOKEN } from '../core/events/tokens';
import { EVENT_TYPES } from '../core/events/types/event.types';
import { PrismaService } from '../prisma/prisma.service';
import { ArtifactService } from '../services/artifacts/artifact.service';
import { EmbeddingsClientService } from '../services/embeddings-client.service';
import { ConversationService } from '../services/conversation.service';
import { DependencyAnalyzer } from '../services/dependency-analyzer.service';
import { MessageService } from '../services/message.service';
import {
  DebugOutboxEventRecord,
  OutboxStore,
} from '../services/outbox-store.service';
import { InjectTemporalClient } from '../prisma/temporal.module';
import { WebsocketConnectionManager } from '../core/websockets/websocket-connection-manager.service';
import { EntityRelationshipResolverService } from '../services/relationships/entity-relationship-resolver.service';
import { FlowExecutionService } from '../services/workflows/flow-execution.service';
import {
  AgentSessionId,
  ConversationId,
  DesignDocId,
  InitiativeId,
  OrganizationId,
  PlanId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from '../types';
import { getWorkflowStatus } from '../workflows/conversation-flow.workflow';
import { isSerializableWorkflowState } from '../workflows/conversation-workflow-state';
import { $Enums } from '@prisma/client';
import { FlowContext } from '../types/flow-internal.types';
import {
  DebugEventReplayMode,
  DebugEventReplayRequestDto,
  DebugEventReplayResponseDto,
} from '../generated';
import { EventReplayRepairService } from '../services/events/event-replay-repair.service';

export class WebSocketConnectionDetailDto {
  connectionId: string;
  userId?: string;
  connectedAt: string;
  lastActivity: string;
  rooms: {
    organizations: string[];
    projects: string[];
    conversations: string[];
    initiatives: string[];
    user?: string;
  };
  eventSubscriptions?: string[];

  constructor(
    connectionId: string,
    connectedAt: string,
    lastActivity: string,
    rooms: {
      organizations: string[];
      projects: string[];
      conversations: string[];
      initiatives: string[];
      user?: string;
    },
    userId?: string,
    eventSubscriptions?: string[],
  ) {
    this.connectionId = connectionId;
    this.userId = userId;
    this.connectedAt = connectedAt;
    this.lastActivity = lastActivity;
    this.rooms = rooms;
    this.eventSubscriptions = eventSubscriptions;
  }
}

export class WebSocketChannelStatsDto {
  organizationChannels: Record<string, number>;
  projectChannels: Record<string, number>;
  conversationChannels: Record<string, number>;
  initiativeChannels: Record<string, number>;
  userChannels: Record<string, number>;

  constructor(
    organizationChannels: Record<string, number>,
    projectChannels: Record<string, number>,
    conversationChannels: Record<string, number>,
    initiativeChannels: Record<string, number>,
    userChannels: Record<string, number>,
  ) {
    this.organizationChannels = organizationChannels;
    this.projectChannels = projectChannels;
    this.conversationChannels = conversationChannels;
    this.initiativeChannels = initiativeChannels;
    this.userChannels = userChannels;
  }
}

export class WebSocketSubscriptionsDebugDto {
  totalConnections: number;
  connectionDetails: WebSocketConnectionDetailDto[];
  channelStats: WebSocketChannelStatsDto;
  summary: {
    averageRoomsPerConnection: number;
    mostSubscribedChannels: Array<{ channel: string; count: number }>;
    connectionHealthStatus: 'healthy' | 'degraded' | 'unhealthy';
  };

  constructor(
    totalConnections: number,
    connectionDetails: WebSocketConnectionDetailDto[],
    channelStats: WebSocketChannelStatsDto,
    summary: {
      averageRoomsPerConnection: number;
      mostSubscribedChannels: Array<{ channel: string; count: number }>;
      connectionHealthStatus: 'healthy' | 'degraded' | 'unhealthy';
    },
  ) {
    this.totalConnections = totalConnections;
    this.connectionDetails = connectionDetails;
    this.channelStats = channelStats;
    this.summary = summary;
  }
}

export interface ProjectDebugViewDto {
  projectId: ProjectId;
  organizationId: OrganizationId;

  // Project info
  project: {
    id: string;
    name: string;
    description?: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
  };

  // Conversations
  conversations: {
    total: number;
    active: number;
    completed: number;
    failed: number;
    recent: Array<{
      id: ConversationId;
      title?: string;
      status: $Enums.ConversationStatus;
      workflowName: string | null;
      initiatedBy: $Enums.InitiationType;
      createdAt: Date;
      updatedAt: Date;
      messageCount: number;
    }>;
  };

  // Messages
  messages: {
    total: number;
    byType: {
      USER: number;
      SYSTEM: number;
    };
    byStatus: Record<string, number>;
    recent: Array<{
      id: string;
      type: string;
      status: string;
      conversationId: string;
      createdAt: Date;
      parentMessageId?: string;
    }>;
  };

  // Artifacts
  artifacts: {
    total: number;
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    withEmbeddings: number;
    recent: Array<{
      id: string;
      type: string;
      title?: string;
      status: string;
      sourceType: string;
      sourceId: string;
      hasEmbedding: boolean;
      createdAt: Date;
    }>;
  };

  // Events (if available)
  events?: {
    total: number;
    byType: Record<string, number>;
    recent: Array<{
      id: string;
      eventType: string;
      aggregateId: string;
      payload: unknown;
      createdAt: Date;
    }>;
  };

  // Summary stats
  summary: {
    totalEntities: number;
    lastActivity: Date;
    activeSince: Date;
  };
}

export interface WorkflowStatusDebugDto {
  workflowId: WorkflowId;
  status: {
    name: string;
    runId: string;
    startTime: string;
    closeTime?: string;
    executionTime?: number;
  };
  taskQueue: string;
  workflowType: string;
  conversation?: {
    id: string;
    projectId: string;
    organizationId: string;
    title?: string;
    status: string;
  };
  debugInfo: {
    canReceiveSignals: boolean;
    isActive: boolean;
    lastActivity?: string;
  };
  currentStep?: {
    step: string;
    currentNodeId: string;
    phase: string;
    isComplete: boolean;
    iterations: number;
    hasOpener: boolean;
    lastActivity: string;
    pathTaken: string[];
  };
  logs?: {
    activities: Array<{
      activityType: string;
      activityId: string;
      timestamp: string;
      status:
        | 'SCHEDULED'
        | 'STARTED'
        | 'COMPLETED'
        | 'FAILED'
        | 'TIMED_OUT'
        | 'CANCELED';
      result?: unknown;
      failure?: {
        message: string;
        source: string;
        stackTrace?: string;
      };
    }>;
    failures: Array<{
      timestamp: string;
      message: string;
      source: string;
      stackTrace?: string;
      activityType?: string;
    }>;
    signals: Array<{
      signalName: string;
      timestamp: string;
      input?: unknown;
    }>;
  };
  error?: string;
}

export interface DebugOutboxEventsResponseDto {
  entityType: string;
  entityId: string;
  count: number;
  events: DebugOutboxEventRecord[];
}

function normalizeOutboxEntityType(entityType: string): string {
  return entityType.toLowerCase();
}

class DebugEntityRelationshipResolutionRequestDto {
  entityType!: WorkflowAboutType;
  entityId!: string;
  organizationId?: OrganizationId;
  conversationId?: ConversationId;
}

@ApiTags('Debug/Admin')
@UseGuards(AdminGuard)
@Controller('api/v1/debug/')
export class DebugController {
  private readonly logger = new Logger(DebugController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly artifactService: ArtifactService,
    private readonly messageService: MessageService,
    private readonly dependencyAnalyzer: DependencyAnalyzer,
    private readonly websocketConnectionManager: WebsocketConnectionManager,
    private readonly customLogger: CustomLoggerService,
    private readonly entityRelationshipResolverService: EntityRelationshipResolverService,
    private readonly flowExecutionService: FlowExecutionService,
    private readonly eventPublisher: DomainEventPublisher,
    @Inject(OUTBOX_STORE_TOKEN) private readonly outboxStore: OutboxStore,
    @InjectTemporalClient() private readonly temporalClient: Client,
    private readonly embeddingsClient: EmbeddingsClientService,
    private readonly eventReplayRepairService: EventReplayRepairService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  @Post('relationships/resolve')
  @ApiOperation({
    summary: 'Resolve related entity IDs for a workflow entity (debug)',
  })
  async debugResolveEntityRelationships(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: DebugEntityRelationshipResolutionRequestDto,
  ) {
    const organizationId =
      body.organizationId ?? user?.currentOrgId ?? undefined;
    if (!organizationId) {
      throw new BadRequestException('organizationId is required');
    }
    if (!body.entityType) {
      throw new BadRequestException('entityType is required');
    }
    if (!body.entityId) {
      throw new BadRequestException('entityId is required');
    }

    const resolution =
      await this.entityRelationshipResolverService.resolveForWorkflowAbout({
        organizationId,
        conversationId: body.conversationId,
        workflowAboutType: body.entityType,
        workflowAboutId: body.entityId,
      });

    return {
      success: true,
      input: {
        organizationId,
        conversationId: body.conversationId,
        entityType: body.entityType,
        entityId: body.entityId,
      },
      resolution,
    };
  }

  @Get('projects/view')
  @ApiOperation({
    summary: 'Get comprehensive project debug view',
    description:
      'Get all project-related entities (messages, conversations, artifacts, events) for debugging and admin purposes',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID to get debug view for',
    required: true,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'limit',
    description: 'Limit for recent items in each category',
    required: false,
    type: 'number',
    example: 10,
  })
  @ApiResponse({
    status: 200,
    description: 'Project debug view retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Project not found',
  })
  async getProjectDebugView(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('limit') limit?: number,
  ): Promise<ProjectDebugViewDto> {
    const recentLimit = limit || 10;

    this.logger.log(
      `User ${user.userId} requesting debug view for project: ${projectId}`,
    );

    try {
      // Get project info
      const project = await this.prisma.db.project.findUnique({
        where: { id: projectId },
        include: {
          organization: true,
        },
      });

      if (!project) {
        throw new HttpException('Project not found', HttpStatus.NOT_FOUND);
      }

      // Get conversations
      const conversationsData = await this.getConversationsData(
        projectId,
        recentLimit,
      );

      // Get messages
      const messagesData = await this.getMessagesData(projectId, recentLimit);

      // Get artifacts
      const artifactsData = await this.getArtifactsData(projectId, recentLimit);

      // Get events (optional, may not be available)
      const eventsData = await this.getEventsData(projectId, recentLimit);

      // Calculate summary
      const totalEntities =
        conversationsData.total +
        messagesData.total +
        artifactsData.total +
        (eventsData?.total || 0);

      const allDates = [
        project.createdAt,
        ...conversationsData.recent.map((c) => c.createdAt),
        ...messagesData.recent.map((m) => m.createdAt),
        ...artifactsData.recent.map((a) => a.createdAt),
      ];

      const lastActivity =
        allDates.length > 0
          ? new Date(Math.max(...allDates.map((d) => d.getTime())))
          : project.createdAt;

      const result: ProjectDebugViewDto = {
        projectId,
        organizationId: project.organizationId,
        project: {
          id: project.id,
          name: project.name,
          description: project.description ?? undefined,
          status: project.status,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
        },
        conversations: conversationsData,
        messages: messagesData,
        artifacts: artifactsData,
        events: eventsData,
        summary: {
          totalEntities,
          lastActivity,
          activeSince: project.createdAt,
        },
      };

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get debug view for project ${projectId}: ${(error as Error).message}`,
        (error as Error).stack,
      );

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Failed to retrieve project debug view',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async getConversationsData(projectId: ProjectId, limit: number) {
    const conversations = await this.prisma.db.conversation.findMany({
      where: { projectId },
      include: {
        _count: {
          select: { messages: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const statusCounts = conversations.reduce(
      (acc, conv) => {
        acc[conv.status] = (acc[conv.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      total: conversations.length,
      active:
        (statusCounts['STARTED'] || 0) +
        (statusCounts['IN_PROGRESS'] || 0) +
        (statusCounts['GENERATING_RESPONSE'] || 0),
      completed: statusCounts['COMPLETED'] || 0,
      failed: statusCounts['FAILED'] || 0,
      recent: conversations.slice(0, limit).map((conv) => ({
        id: conv.id,
        title: conv.title ?? undefined,
        status: conv.status,
        workflowName: conv.workflowName,
        initiatedBy: conv.initiatedBy,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv._count.messages,
      })),
    };
  }

  private async getMessagesData(projectId: ProjectId, limit: number) {
    const messages = await this.prisma.db.message.findMany({
      where: { projectId, ...TIMELINE_MESSAGE_WHERE },
      orderBy: { createdAt: 'desc' },
    });

    const byType = messages.reduce(
      (acc, msg) => {
        acc[msg.type] = (acc[msg.type] || 0) + 1;
        return acc;
      },
      { USER: 0, SYSTEM: 0 },
    );

    const byStatus = messages.reduce(
      (acc, msg) => {
        acc[msg.status] = (acc[msg.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return {
      total: messages.length,
      byType,
      byStatus,
      recent: messages.slice(0, limit).map((msg) => ({
        id: msg.id,
        type: msg.type,
        status: msg.status,
        conversationId: msg.conversationId,
        createdAt: timelineCreatedAt(msg),
        parentMessageId: msg.parentMessageId ?? undefined,
      })),
    };
  }

  private async getArtifactsData(projectId: ProjectId, limit: number) {
    const artifacts = await this.prisma.db.artifact.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
    });

    const byType = artifacts.reduce(
      (acc, art) => {
        acc[art.type] = (acc[art.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const byStatus = artifacts.reduce(
      (acc, art) => {
        acc[art.status] = (acc[art.status] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const withEmbeddings = artifacts.filter((art) => art.hasEmbedding).length;

    return {
      total: artifacts.length,
      byType,
      byStatus,
      withEmbeddings,
      recent: artifacts.slice(0, limit).map((art) => ({
        id: art.id,
        type: art.type,
        title: art.title ?? undefined,
        status: art.status,
        sourceType: art.sourceType,
        sourceId: art.sourceId,
        hasEmbedding: art.hasEmbedding,
        createdAt: art.createdAt,
      })),
    };
  }

  private async getEventsData(projectId: ProjectId, limit: number) {
    try {
      // This may not be available if the observable events system isn't implemented
      const events = await this.prisma.db.outboxEvent.findMany({
        where: {
          // Filter by project-related events
          OR: [{ aggregateId: projectId }, { projectId: projectId }],
        },
        orderBy: { createdAt: 'desc' },
        take: limit * 2, // Get more to account for filtering
      });

      const byType = events.reduce(
        (acc, event) => {
          acc[event.eventType] = (acc[event.eventType] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      return {
        total: events.length,
        byType,
        recent: events.slice(0, limit).map((event) => ({
          id: event.id,
          eventType: event.eventType,
          aggregateId: event.aggregateId,
          payload: event.payload,
          createdAt: event.createdAt,
        })),
      };
    } catch (error) {
      this.logger.warn(
        `Could not fetch events data: ${(error as Error).message}`,
      );
      return undefined;
    }
  }

  @Get('outbox-events/:entityType/:entityId')
  @ApiOperation({
    summary: 'Get outbox events for an entity',
    description:
      'Returns persisted outbox rows whose aggregate_type and aggregate_id match the provided entity.',
  })
  @ApiParam({
    name: 'entityType',
    description: 'Entity type stored in outbox_events.aggregate_type',
    type: 'string',
  })
  @ApiParam({
    name: 'entityId',
    description: 'Entity ID stored in outbox_events.aggregate_id',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'Outbox events retrieved successfully',
  })
  async getEntityOutboxEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ): Promise<DebugOutboxEventsResponseDto> {
    const normalizedEntityType = normalizeOutboxEntityType(entityType);

    this.logger.log(
      `User ${user.userId} requesting outbox events for entity: ${normalizedEntityType}:${entityId}`,
    );

    const events = await this.outboxStore.getEventsForEntity({
      entityType: normalizedEntityType,
      entityId,
    });

    return {
      entityType: normalizedEntityType,
      entityId,
      count: events.length,
      events,
    };
  }

  @Post('events/:eventId/retrigger')
  @ApiOperation({
    summary: 'Retrigger an outbox event by creating a new pending copy',
    description:
      'Clones an existing outbox event by ID, resets retry state, and queues it for republish.',
  })
  @ApiParam({
    name: 'eventId',
    description: 'Outbox event ID to retrigger',
    type: 'string',
    format: 'uuid',
  })
  @ApiResponse({
    status: 200,
    description: 'Outbox event retriggered successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Outbox event not found',
  })
  async retriggerOutboxEvent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('eventId') eventId: string,
  ): Promise<DebugEventReplayResponseDto> {
    this.logger.log(
      `User ${user.userId} retriggering outbox event: ${eventId}`,
    );

    return this.eventReplayRepairService.execute(
      {
        mode: DebugEventReplayMode.ReemitOriginal,
        eventId,
      },
      {
        userId: user.userId,
        organizationId: user.currentOrgId,
      },
    );
  }

  @Post('events/replay')
  @ApiOperation({
    summary: 'Validate and replay selected outbox events',
    description:
      'Validates selected organization-scoped outbox events, optionally repairs invalid payloads, and queues fresh pending replay copies without changing source rows.',
  })
  @ApiResponse({
    status: 200,
    description: 'Event validation and replay outcomes',
  })
  async replayDebugEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Body() request: DebugEventReplayRequestDto,
  ): Promise<DebugEventReplayResponseDto> {
    return this.eventReplayRepairService.execute(request, {
      userId: user.userId,
      organizationId: user.currentOrgId,
    });
  }

  @Get('projects/conversations')
  @ApiOperation({
    summary: 'Get conversations for project',
    description: 'Get detailed conversation list for a specific project',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID',
    required: true,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number',
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
  @ApiResponse({
    status: 200,
    description: 'Conversations retrieved successfully',
  })
  async getProjectConversations(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    this.logger.log(
      `User ${user.userId} requesting conversations for project: ${projectId}`,
    );

    return this.conversationService.getConversationsByProject(
      projectId,
      user.currentOrgId,
      {
        page,
        limit,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
      },
    );
  }

  @Get('projects/artifacts')
  @ApiOperation({
    summary: 'Get artifacts for project',
    description: 'Get detailed artifact list for a specific project',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID',
    required: true,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'page',
    description: 'Page number',
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
  @ApiResponse({
    status: 200,
    description: 'Artifacts retrieved successfully',
  })
  async getProjectArtifacts(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    this.logger.log(
      `User ${user.userId} requesting artifacts for project: ${projectId}`,
    );

    // TODO: Fix debug endpoints to use proper organization context
    // For now, use the user's current organization
    const organizationId = user.currentOrgId;

    return this.artifactService.findMany(
      {
        projectId,
        page,
        limit,
        orderBy: 'createdAt',
        orderDirection: 'desc',
      },
      organizationId,
    );
  }

  @Get('projects/messages')
  @ApiOperation({
    summary: 'Get messages for project',
    description: 'Get detailed message list for a specific project',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID',
    required: true,
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
    name: 'page',
    description: 'Page number',
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
  @ApiResponse({
    status: 200,
    description: 'Messages retrieved successfully',
  })
  async getProjectMessages(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('conversationId') conversationId?: ConversationId,
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    this.logger.log(
      `User ${user.userId} requesting messages for project: ${projectId}`,
    );

    // TODO: Fix debug endpoints to use proper organization context
    // For now, use the user's current organization
    const organizationId = user.currentOrgId;

    return this.messageService.getMessages(
      {
        projectId,
        conversationId,
        page,
        limit,
      },
      organizationId,
    );
  }

  @Get('dependencies')
  @ApiOperation({
    summary: 'Analyze NestJS dependency injection',
    description:
      'Get detailed view of all modules, providers, and their dependencies',
  })
  @ApiResponse({
    status: 200,
    description: 'Dependency analysis completed (check console logs)',
  })
  async analyzeDependencies() {
    this.logger.log('Dependency analysis requested');

    // This will log to console
    this.dependencyAnalyzer.analyzeDependencies();

    return {
      message:
        'Dependency analysis completed. Check server console logs for detailed output.',
      timestamp: new Date(),
    };
  }

  @Get('dependencies/service')
  @ApiOperation({
    summary: 'Analyze specific service dependencies',
    description:
      'Get detailed analysis of a specific service and its dependencies',
  })
  @ApiQuery({
    name: 'serviceName',
    description: 'Name of the service to analyze',
    required: true,
    type: 'string',
    example: 'ConversationService',
  })
  @ApiResponse({
    status: 200,
    description: 'Service analysis completed (check console logs)',
  })
  async analyzeService(@Query('serviceName') serviceName: string) {
    this.logger.log(`Analysis requested for service: ${serviceName}`);

    // This will log to console
    this.dependencyAnalyzer.analyzeSpecificService(serviceName);

    return {
      message: `Analysis for ${serviceName} completed. Check server console logs for detailed output.`,
      serviceName,
      timestamp: new Date(),
    };
  }

  @Get('dependencies/multiple-instances')
  @ApiOperation({
    summary: 'Check for multiple service instances',
    description:
      'Identify services that have multiple instances across different modules, which can cause issues with event publishing and state consistency',
  })
  @ApiResponse({
    status: 200,
    description: 'Multiple instance analysis completed (check console logs)',
  })
  async analyzeMultipleInstances() {
    this.logger.log('Multiple instance analysis requested');

    // This will log to console
    this.dependencyAnalyzer.analyzeMultipleInstanceIssues();

    return {
      message:
        'Multiple instance analysis completed. Check server console logs for detailed output.',
      warning:
        'Multiple instances can cause duplicate events and state inconsistencies',
      note: 'This only analyzes the current application context. Worker contexts are separate and not visible here.',
      timestamp: new Date(),
    };
  }

  @Post('projects/backfill-archived-events')
  @ApiExcludeEndpoint()
  @ApiOperation({
    summary: 'Backfill missing archived events for a project',
    description:
      'Finds archived initiatives, tasks, and design docs that are missing their corresponding outbox archived event, and emits the missing events.',
  })
  @ApiQuery({
    name: 'projectId',
    description: 'Project ID to backfill archived events for',
    required: true,
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'dryRun',
    description:
      'If true, only report what would be emitted without actually emitting events',
    required: false,
    type: 'boolean',
    example: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Backfill completed',
  })
  async backfillArchivedEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query('projectId') projectId: ProjectId,
    @Query('dryRun') dryRun?: boolean,
  ): Promise<{
    projectId: ProjectId;
    dryRun: boolean;
    found: { initiatives: number; tasks: number; designDocs: number };
    missingEvents: { initiatives: number; tasks: number; designDocs: number };
    emitted: { initiatives: number; tasks: number; designDocs: number };
  }> {
    const isDryRun = dryRun === true;

    this.logger.log(
      `User ${user.userId} backfilling archived events for project: ${projectId}${isDryRun ? ' (dry run)' : ''}`,
    );

    const organizationId = user.currentOrgId;

    // 1) Load all archived entities for the project
    const [initiatives, tasks, designDocs] = await Promise.all([
      this.prisma.db.initiative.findMany({
        where: {
          archivedAt: { not: null },
          OR: [
            { originatingProjectId: projectId },
            { projects: { some: { projectId } } },
          ],
        },
      }),
      this.prisma.db.task.findMany({
        where: {
          archivedAt: { not: null },
          projectId,
        },
      }),
      this.prisma.db.designDoc.findMany({
        where: {
          archivedAt: { not: null },
          projectId,
        },
      }),
    ]);

    const allEntityIds = [
      ...initiatives.map((i) => i.id),
      ...tasks.map((t) => t.id),
      ...designDocs.map((d) => d.id),
    ];

    // 2) Check which entities already have archived events in the outbox
    const existingEvents =
      allEntityIds.length > 0
        ? await this.prisma.db.outboxEvent.findMany({
            where: {
              aggregateId: { in: allEntityIds },
              eventType: {
                in: [
                  EVENT_TYPES.INITIATIVE.ARCHIVED,
                  EVENT_TYPES.TASK.ARCHIVED,
                  EVENT_TYPES.DESIGN_DOC.ARCHIVED,
                ],
              },
            },
            select: { aggregateId: true, eventType: true },
          })
        : [];

    const existingSet = new Set(
      existingEvents.map((e) => `${e.aggregateId}:${e.eventType}`),
    );

    // 3) Filter to entities missing their archived event
    const missingInitiatives = initiatives.filter(
      (i) => !existingSet.has(`${i.id}:${EVENT_TYPES.INITIATIVE.ARCHIVED}`),
    );
    const missingTasks = tasks.filter(
      (t) => !existingSet.has(`${t.id}:${EVENT_TYPES.TASK.ARCHIVED}`),
    );
    const missingDesignDocs = designDocs.filter(
      (d) => !existingSet.has(`${d.id}:${EVENT_TYPES.DESIGN_DOC.ARCHIVED}`),
    );

    // 4) Emit missing archived events (skip if dry run)
    const emitted = { initiatives: 0, tasks: 0, designDocs: 0 };

    if (!isDryRun) {
      for (const initiative of missingInitiatives) {
        await this.eventPublisher.publish({
          type: EVENT_TYPES.INITIATIVE.ARCHIVED,
          aggregateId: initiative.id as InitiativeId,
          payload: {
            payloadType: EVENT_TYPES.INITIATIVE.ARCHIVED,
            archivedAt: initiative.archivedAt!.toISOString(),
            organizationId,
            projectId,
            userId: user.userId,
          },
        });
        emitted.initiatives++;
      }

      for (const task of missingTasks) {
        await this.eventPublisher.publish({
          type: EVENT_TYPES.TASK.ARCHIVED,
          aggregateId: task.id as TaskId,
          payload: {
            payloadType: EVENT_TYPES.TASK.ARCHIVED,
            archivedAt: task.archivedAt!.toISOString(),
            initiativeId: task.initiativeId as InitiativeId,
            organizationId,
            projectId,
            userId: user.userId,
          },
        });
        emitted.tasks++;
      }

      for (const doc of missingDesignDocs) {
        await this.eventPublisher.publish({
          type: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
          aggregateId: doc.id as DesignDocId,
          payload: {
            payloadType: EVENT_TYPES.DESIGN_DOC.ARCHIVED,
            designDoc: {
              id: doc.id,
              name: doc.name,
              template: doc.template,
              status: doc.status,
              organizationId: doc.organizationId,
              projectId: doc.projectId,
              tags: doc.tags,
              createdAt: doc.createdAt.toISOString(),
              updatedAt: doc.updatedAt.toISOString(),
              summary: doc.summary ?? undefined,
            },
            organizationId,
            projectId,
            userId: user.userId,
          },
        });
        emitted.designDocs++;
      }
    }

    this.logger.log(
      `Backfill ${isDryRun ? 'dry run' : 'complete'} for project ${projectId}: ${isDryRun ? 'would emit' : 'emitted'} ${missingInitiatives.length} initiative, ${missingTasks.length} task, ${missingDesignDocs.length} design doc archived events`,
    );

    return {
      projectId,
      dryRun: isDryRun,
      found: {
        initiatives: initiatives.length,
        tasks: tasks.length,
        designDocs: designDocs.length,
      },
      missingEvents: {
        initiatives: missingInitiatives.length,
        tasks: missingTasks.length,
        designDocs: missingDesignDocs.length,
      },
      emitted,
    };
  }

  @Get('dependencies/context-info')
  @ApiOperation({
    summary: 'Get current application context information',
    description:
      'Shows which NestJS context this analyzer is running in and provides hints about other contexts',
  })
  @ApiResponse({
    status: 200,
    description: 'Context information retrieved',
  })
  async getContextInfo() {
    this.logger.log('Context information requested');

    console.log('\n🔍 === APPLICATION CONTEXT INFO ===');
    console.log(`Current context: Main Application (HTTP API)`);
    console.log(`Process ID: ${process.pid}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);

    // Check if worker context might exist
    const hasWorkerCode = require('fs').existsSync(
      './src/workflows/interaction/activities.ts',
    );
    if (hasWorkerCode) {
      console.log(
        '⚠️  POTENTIAL ISSUE: Found worker activities that likely create separate NestJS context',
      );
      console.log(
        '   This means services may be duplicated between main app and worker contexts',
      );
      console.log(
        '   To verify: Check your Temporal worker logs for service creation messages',
      );
    }

    return {
      contextType: 'Main Application',
      processId: process.pid,
      environment: process.env.NODE_ENV || 'development',
      warning: hasWorkerCode
        ? 'Worker activities detected - may have separate NestJS context with duplicate services'
        : null,
      recommendation: hasWorkerCode
        ? 'Check worker process logs to compare service instances'
        : null,
      timestamp: new Date(),
    };
  }

  @Get('current-user')
  @ApiOperation({
    summary: 'Get current authenticated user object for debugging',
    description:
      'Returns the full AuthenticatedUser object from JWT to debug missing fields like name',
  })
  @ApiResponse({
    status: 200,
    description: 'Current user object from JWT',
  })
  async getCurrentUser(@CurrentUser() user: AuthenticatedUser) {
    // Also fetch the user from database to compare
    const dbUser = await this.prisma.db.user.findUnique({
      where: { id: user.userId },
      select: { id: true, email: true, name: true, isActive: true },
    });

    return {
      jwtUser: user,
      databaseUser: dbUser,
      nameComparison: {
        jwtHasName: 'name' in user && user.name !== undefined,
        jwtName: user.name,
        dbHasName: dbUser?.name !== null && dbUser?.name !== undefined,
        dbName: dbUser?.name,
        match: user.name === dbUser?.name,
      },
      timestamp: new Date(),
      message: 'Comparing JWT user object vs database user record',
    };
  }

  @Get('projects/workflows/:workflowId/status')
  @NoLogging()
  @SkipThrottle()
  @ApiOperation({
    summary: 'Get workflow status for debugging',
    description:
      'Returns current workflow execution status, conversation context, current step information with path taken, debugging information, and optionally workflow execution logs including activity failures and signals',
  })
  @ApiParam({
    name: 'workflowId',
    description: 'The ID of the workflow to get status for',
    type: 'string',
    format: 'uuid',
  })
  @ApiQuery({
    name: 'includeLogs',
    description:
      'Include workflow execution logs and history (can be expensive)',
    required: false,
    type: 'boolean',
    example: false,
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow status information with current step details',
  })
  @ApiResponse({
    status: 404,
    description: 'Workflow not found',
  })
  @ApiResponse({
    status: 500,
    description: 'Failed to retrieve workflow status',
  })
  async getWorkflowStatus(
    @CurrentUser() _user: AuthenticatedUser,
    @Param('workflowId') workflowId: WorkflowId,
    @Query('includeLogs') includeLogs: boolean = false,
  ): Promise<WorkflowStatusDebugDto> {
    try {
      // Get workflow handle and description
      const workflowHandle = this.temporalClient.workflow.getHandle(workflowId);
      const workflowDescription = await workflowHandle.describe();

      // Calculate execution time if workflow has ended
      let executionTime: number | undefined;
      if (workflowDescription.closeTime) {
        executionTime =
          new Date(workflowDescription.closeTime).getTime() -
          new Date(workflowDescription.startTime).getTime();
      }

      // Try to find associated conversation for context
      let conversationContext: WorkflowStatusDebugDto['conversation'];
      try {
        const conversation = await this.prisma.db.conversation.findFirst({
          where: { workflowId },
          select: {
            id: true,
            projectId: true,
            organizationId: true,
            title: true,
            status: true,
          },
        });

        if (conversation) {
          conversationContext = {
            id: conversation.id,
            projectId: conversation.projectId,
            organizationId: conversation.organizationId,
            title: conversation.title ?? undefined,
            status: conversation.status,
          };
        }
      } catch (conversationError) {
        this.logger.warn(
          `Could not fetch conversation for workflow ${workflowId}: ${
            conversationError instanceof Error
              ? conversationError.message
              : 'Unknown error'
          }`,
        );
      }

      // Determine if workflow can receive signals and is active
      const isActive = workflowDescription.status.name === 'RUNNING';
      const canReceiveSignals = isActive;

      // Try to get current workflow step information if workflow is active
      let currentStepInfo: WorkflowStatusDebugDto['currentStep'];
      if (isActive) {
        try {
          const workflowStatus = await workflowHandle.query(getWorkflowStatus);
          currentStepInfo = {
            step: workflowStatus.step,
            currentNodeId: workflowStatus.currentNodeId,
            phase: workflowStatus.phase,
            isComplete: workflowStatus.isComplete,
            iterations: workflowStatus.iterations,
            hasOpener: workflowStatus.hasOpener,
            lastActivity: workflowStatus.lastActivity,
            pathTaken: workflowStatus.pathTaken,
          };
        } catch (queryError) {
          this.logger.warn(
            `Could not query workflow status for ${workflowId}: ${
              queryError instanceof Error ? queryError.message : 'Unknown error'
            }`,
          );
        }
      }

      // Get workflow execution history for logs and errors (only if requested)
      let workflowLogs: WorkflowStatusDebugDto['logs'];
      if (includeLogs) {
        try {
          const history = await workflowHandle.fetchHistory();
          const activities: Array<{
            activityType: string;
            activityId: string;
            timestamp: string;
            status:
              | 'SCHEDULED'
              | 'STARTED'
              | 'COMPLETED'
              | 'FAILED'
              | 'TIMED_OUT'
              | 'CANCELED';
            result?: unknown;
            failure?: {
              message: string;
              source: string;
              stackTrace?: string;
            };
          }> = [];
          const failures: Array<{
            timestamp: string;
            message: string;
            source: string;
            stackTrace?: string;
            activityType?: string;
          }> = [];
          const signals: Array<{
            signalName: string;
            timestamp: string;
            input?: unknown;
          }> = [];
          const events = history?.events ?? [];

          for (const event of events) {
            const timestamp = new Date(
              Number(event.eventTime?.seconds) * 1000 +
                Number(event.eventTime?.nanos) / 1000000,
            ).toISOString();

            type EventType = typeof event.eventType;

            switch (event.eventType) {
              case 'EVENT_TYPE_ACTIVITY_TASK_SCHEDULED' as unknown as EventType:
                if (event.activityTaskScheduledEventAttributes) {
                  activities.push({
                    activityType:
                      event.activityTaskScheduledEventAttributes.activityType
                        ?.name || 'unknown',
                    activityId:
                      event.activityTaskScheduledEventAttributes.activityId ||
                      'unknown',
                    timestamp,
                    status: 'SCHEDULED',
                  });
                }
                break;

              case 'EVENT_TYPE_ACTIVITY_TASK_STARTED' as unknown as EventType:
                if (event.activityTaskStartedEventAttributes) {
                  const scheduledEventId =
                    event.activityTaskStartedEventAttributes.scheduledEventId;
                  const activity = activities.find(
                    (a) => a.activityId === scheduledEventId?.toString(),
                  );
                  if (activity) {
                    activity.status = 'STARTED';
                  }
                }
                break;

              case 'EVENT_TYPE_ACTIVITY_TASK_COMPLETED' as unknown as EventType:
                if (event.activityTaskCompletedEventAttributes) {
                  const scheduledEventId =
                    event.activityTaskCompletedEventAttributes.scheduledEventId;
                  const activity = activities.find(
                    (a) => a.activityId === scheduledEventId?.toString(),
                  );
                  if (activity) {
                    activity.status = 'COMPLETED';
                    activity.result =
                      event.activityTaskCompletedEventAttributes.result;
                  }
                }
                break;

              case 'EVENT_TYPE_ACTIVITY_TASK_FAILED' as unknown as EventType:
                if (event.activityTaskFailedEventAttributes) {
                  const scheduledEventId =
                    event.activityTaskFailedEventAttributes.scheduledEventId;
                  const activity = activities.find(
                    (a) => a.activityId === scheduledEventId?.toString(),
                  );
                  const failure =
                    event.activityTaskFailedEventAttributes.failure;

                  if (activity) {
                    activity.status = 'FAILED';
                    activity.failure = {
                      message: failure?.message || 'Unknown error',
                      source: failure?.source || 'Activity',
                      stackTrace: failure?.stackTrace || undefined,
                    };
                  }

                  failures.push({
                    timestamp,
                    message: failure?.message || 'Unknown activity failure',
                    source: failure?.source || 'Activity',
                    stackTrace: failure?.stackTrace || undefined,
                    activityType: activity?.activityType,
                  });
                }
                break;

              case 'EVENT_TYPE_ACTIVITY_TASK_TIMED_OUT' as unknown as EventType:
                if (event.activityTaskTimedOutEventAttributes) {
                  const scheduledEventId =
                    event.activityTaskTimedOutEventAttributes.scheduledEventId;
                  const activity = activities.find(
                    (a) => a.activityId === scheduledEventId?.toString(),
                  );
                  if (activity) {
                    activity.status = 'TIMED_OUT';
                  }
                }
                break;

              case 'EVENT_TYPE_WORKFLOW_EXECUTION_FAILED' as unknown as EventType:
                if (event.workflowExecutionFailedEventAttributes) {
                  const failure =
                    event.workflowExecutionFailedEventAttributes.failure;
                  failures.push({
                    timestamp,
                    message: failure?.message || 'Workflow execution failed',
                    source: failure?.source || 'Workflow',
                    stackTrace: failure?.stackTrace || undefined,
                  });
                }
                break;

              case 'EVENT_TYPE_WORKFLOW_TASK_FAILED' as unknown as EventType:
                if (event.workflowTaskFailedEventAttributes) {
                  const failure =
                    event.workflowTaskFailedEventAttributes.failure;
                  failures.push({
                    timestamp,
                    message: failure?.message || 'Workflow task failed',
                    source: failure?.source || 'WorkflowTask',
                    stackTrace: failure?.stackTrace || undefined,
                  });
                }
                break;

              case 'EVENT_TYPE_WORKFLOW_EXECUTION_SIGNALED' as unknown as EventType:
                if (event.workflowExecutionSignaledEventAttributes) {
                  signals.push({
                    signalName:
                      event.workflowExecutionSignaledEventAttributes
                        .signalName || 'unknown',
                    timestamp,
                    input: event.workflowExecutionSignaledEventAttributes.input,
                  });
                }
                break;
            }
          }

          workflowLogs = {
            activities: activities,
            failures: failures,
            signals: signals,
          };
        } catch (historyError) {
          this.logger.warn(
            `Could not fetch workflow history for ${workflowId}: ${
              historyError instanceof Error
                ? historyError.message
                : 'Unknown error'
            }`,
          );
        }
      }

      const result: WorkflowStatusDebugDto = {
        workflowId,
        status: {
          name: workflowDescription.status.name,
          runId: workflowDescription.runId,
          startTime: new Date(workflowDescription.startTime).toISOString(),
          closeTime: workflowDescription.closeTime
            ? new Date(workflowDescription.closeTime).toISOString()
            : undefined,
          executionTime,
        },
        taskQueue: workflowDescription.taskQueue,
        workflowType: workflowDescription.type || 'unknown',
        conversation: conversationContext,
        debugInfo: {
          canReceiveSignals,
          isActive,
          lastActivity: workflowDescription.closeTime
            ? new Date(workflowDescription.closeTime).toISOString()
            : new Date(workflowDescription.startTime).toISOString(),
        },
        currentStep: currentStepInfo,
        logs: workflowLogs,
      };

      return result;
    } catch (error) {
      this.logger.error(
        `Failed to get workflow status for ${workflowId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
        error instanceof Error ? error.stack : undefined,
      );

      // Handle specific error cases
      if (error instanceof Error) {
        if (
          error.message.includes('not found') ||
          error.message.includes('NotFoundError')
        ) {
          throw new HttpException(
            `Workflow ${workflowId} not found`,
            HttpStatus.NOT_FOUND,
          );
        }
      }

      // Return error information in the response for debugging
      return {
        workflowId,
        status: {
          name: 'ERROR',
          runId: 'unknown',
          startTime: 'unknown',
        },
        taskQueue: 'unknown',
        workflowType: 'unknown',
        debugInfo: {
          canReceiveSignals: false,
          isActive: false,
        },
        error:
          error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  @Get('workflows/:workflowId/context')
  @ApiExcludeEndpoint()
  async getWorkflowContext(
    @CurrentUser() user: AuthenticatedUser,
    @Param('workflowId') workflowId: WorkflowId,
  ): Promise<{
    workflowId: WorkflowId;
    conversationId: ConversationId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    flowExecutionId: string;
    flowId: string;
    status: string;
    currentNode: string | null;
    context: FlowContext;
    contextFormat: 'serializable' | 'legacy';
    timestamp: string;
  }> {
    this.logger.log(
      `User ${user.userId} requesting workflow context for workflow: ${workflowId}`,
    );

    try {
      const conversation = await this.prisma.db.conversation.findFirst({
        where: { workflowId },
        select: {
          id: true,
          organizationId: true,
          projectId: true,
        },
      });

      if (!conversation) {
        throw new HttpException('Workflow not found', HttpStatus.NOT_FOUND);
      }

      const execution = await this.flowExecutionService.findByConversation(
        conversation.id as ConversationId,
        conversation.organizationId as OrganizationId,
      );

      if (!execution?.flowState) {
        throw new HttpException(
          'Workflow context not found',
          HttpStatus.NOT_FOUND,
        );
      }

      const context = isSerializableWorkflowState(execution.flowState)
        ? execution.flowState.context
        : (execution.flowState as FlowContext);

      return {
        workflowId,
        conversationId: conversation.id as ConversationId,
        organizationId: conversation.organizationId as OrganizationId,
        projectId: conversation.projectId as ProjectId,
        flowExecutionId: execution.id,
        flowId: execution.flowId,
        status: execution.status,
        currentNode: execution.currentNode,
        context,
        contextFormat: isSerializableWorkflowState(execution.flowState)
          ? 'serializable'
          : 'legacy',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Failed to fetch workflow context for ${workflowId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );

      throw new HttpException(
        'Failed to retrieve workflow context',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('websocket/subscriptions')
  @ApiOperation({
    summary: 'Get WebSocket subscriptions debug info',
    description:
      'Get detailed information about all active WebSocket connections and their room subscriptions',
  })
  @ApiResponse({
    status: 200,
    description: 'WebSocket subscriptions retrieved successfully',
  })
  async getWebSocketSubscriptions(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<WebSocketSubscriptionsDebugDto> {
    this.logger.log(
      `User ${user.userId} requesting WebSocket subscriptions debug info`,
    );

    const connections = this.websocketConnectionManager.getAllConnections();
    const channelCounts = this.websocketConnectionManager['getChannelCounts']();

    // Build detailed connection info
    const connectionDetails: WebSocketConnectionDetailDto[] = connections.map(
      (conn) => {
        const subscription = this.websocketConnectionManager.getSubscription(
          conn.id,
        );

        return {
          connectionId: conn.id,
          userId: conn.userId,
          connectedAt: conn.connectedAt.toISOString(),
          lastActivity: conn.lastActivity.toISOString(),
          rooms: {
            organizations: conn.organizationIds.map(
              (id) => `organization:${id}`,
            ),
            projects: conn.projectIds.map((id) => `project:${id}`),
            conversations: conn.conversationIds.map(
              (id) => `conversation:${id}`,
            ),
            initiatives: conn.initiativeIds.map((id) => `initiative:${id}`),
            user: conn.userId ? `user:${conn.userId}` : undefined,
          },
          eventSubscriptions: subscription?.eventTypes,
        };
      },
    );

    // Calculate channel stats by type
    const channelStats: WebSocketChannelStatsDto = {
      organizationChannels: {},
      projectChannels: {},
      conversationChannels: {},
      initiativeChannels: {},
      userChannels: {},
    };

    Object.entries(channelCounts).forEach(([channel, count]) => {
      if (channel.startsWith('organization:')) {
        channelStats.organizationChannels[channel] = count;
      } else if (channel.startsWith('project:')) {
        channelStats.projectChannels[channel] = count;
      } else if (channel.startsWith('conversation:')) {
        channelStats.conversationChannels[channel] = count;
      } else if (channel.startsWith('initiative:')) {
        channelStats.initiativeChannels[channel] = count;
      } else if (channel.startsWith('user:')) {
        channelStats.userChannels[channel] = count;
      }
    });

    // Calculate summary statistics
    const totalRooms = connectionDetails.reduce(
      (sum: number, conn) =>
        sum +
        conn.rooms.organizations.length +
        conn.rooms.projects.length +
        conn.rooms.conversations.length +
        conn.rooms.initiatives.length +
        (conn.rooms.user ? 1 : 0),
      0,
    );

    const averageRoomsPerConnection =
      connections.length > 0 ? totalRooms / connections.length : 0;

    // Find most subscribed channels
    const mostSubscribedChannels = Object.entries(channelCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10)
      .map(([channel, count]) => ({ channel, count }));

    // Determine connection health status
    let connectionHealthStatus: 'healthy' | 'degraded' | 'unhealthy' =
      'healthy';
    if (connections.length === 0) {
      connectionHealthStatus = 'unhealthy';
    } else if (averageRoomsPerConnection > 50 || connections.length > 1000) {
      connectionHealthStatus = 'degraded';
    }

    return {
      totalConnections: connections.length,
      connectionDetails,
      channelStats,
      summary: {
        averageRoomsPerConnection:
          Math.round(averageRoomsPerConnection * 100) / 100,
        mostSubscribedChannels,
        connectionHealthStatus,
      },
    };
  }

  @Get('websocket/channels')
  @ApiOperation({
    summary: 'Get WebSocket channel statistics',
    description:
      'Get detailed statistics about WebSocket channels and their subscriber counts',
  })
  @ApiResponse({
    status: 200,
    description: 'WebSocket channel statistics retrieved successfully',
  })
  async getWebSocketChannels(@CurrentUser() user: AuthenticatedUser) {
    this.logger.log(
      `User ${user.userId} requesting WebSocket channel statistics`,
    );

    const channelCounts = this.websocketConnectionManager['getChannelCounts']();
    const connections = this.websocketConnectionManager.getAllConnections();

    // Categorize channels
    const channelsByType: Record<
      | 'organization'
      | 'project'
      | 'conversation'
      | 'initiative'
      | 'user'
      | 'other',
      Record<string, number>
    > = {
      organization: {},
      project: {},
      conversation: {},
      initiative: {},
      user: {},
      other: {},
    };

    Object.entries(channelCounts).forEach(([channel, count]) => {
      if (channel.startsWith('organization:')) {
        channelsByType.organization[channel] = count;
      } else if (channel.startsWith('project:')) {
        channelsByType.project[channel] = count;
      } else if (channel.startsWith('conversation:')) {
        channelsByType.conversation[channel] = count;
      } else if (channel.startsWith('initiative:')) {
        channelsByType.initiative[channel] = count;
      } else if (channel.startsWith('user:')) {
        channelsByType.user[channel] = count;
      } else {
        channelsByType.other[channel] = count;
      }
    });

    // Calculate channel type summaries
    const channelTypeSummary = {
      organization: {
        totalChannels: Object.keys(channelsByType.organization).length,
        totalSubscribers: Object.values(channelsByType.organization).reduce(
          (sum, count) => sum + count,
          0,
        ),
        averageSubscribersPerChannel:
          Object.keys(channelsByType.organization).length > 0
            ? Object.values(channelsByType.organization).reduce(
                (sum, count) => sum + count,
                0,
              ) / Object.keys(channelsByType.organization).length
            : 0,
      },
      project: {
        totalChannels: Object.keys(channelsByType.project).length,
        totalSubscribers: Object.values(channelsByType.project).reduce(
          (sum, count) => sum + count,
          0,
        ),
        averageSubscribersPerChannel:
          Object.keys(channelsByType.project).length > 0
            ? Object.values(channelsByType.project).reduce(
                (sum, count) => sum + count,
                0,
              ) / Object.keys(channelsByType.project).length
            : 0,
      },
      conversation: {
        totalChannels: Object.keys(channelsByType.conversation).length,
        totalSubscribers: Object.values(channelsByType.conversation).reduce(
          (sum, count) => sum + count,
          0,
        ),
        averageSubscribersPerChannel:
          Object.keys(channelsByType.conversation).length > 0
            ? Object.values(channelsByType.conversation).reduce(
                (sum, count) => sum + count,
                0,
              ) / Object.keys(channelsByType.conversation).length
            : 0,
      },
      initiative: {
        totalChannels: Object.keys(channelsByType.initiative).length,
        totalSubscribers: Object.values(channelsByType.initiative).reduce(
          (sum, count) => sum + count,
          0,
        ),
        averageSubscribersPerChannel:
          Object.keys(channelsByType.initiative).length > 0
            ? Object.values(channelsByType.initiative).reduce(
                (sum, count) => sum + count,
                0,
              ) / Object.keys(channelsByType.initiative).length
            : 0,
      },
      user: {
        totalChannels: Object.keys(channelsByType.user).length,
        totalSubscribers: Object.values(channelsByType.user).reduce(
          (sum, count) => sum + count,
          0,
        ),
        averageSubscribersPerChannel:
          Object.keys(channelsByType.user).length > 0
            ? Object.values(channelsByType.user).reduce(
                (sum, count) => sum + count,
                0,
              ) / Object.keys(channelsByType.user).length
            : 0,
      },
    };

    // Find top channels overall
    const topChannels = Object.entries(channelCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 20)
      .map(([channel, count]) => ({ channel, subscriberCount: count }));

    // Find channels with no subscribers (potential cleanup candidates)
    const emptyChannels = Object.entries(channelCounts)
      .filter(([, count]) => count === 0)
      .map(([channel]) => channel);

    return {
      totalConnections: connections.length,
      totalChannels: Object.keys(channelCounts).length,
      channelsByType,
      channelTypeSummary,
      topChannels,
      emptyChannels,
      recommendations: {
        cleanupNeeded: emptyChannels.length > 0,
        potentialMemoryIssue: Object.keys(channelCounts).length > 10000,
        highTrafficChannels: topChannels.filter((c) => c.subscriberCount > 100),
      },
    };
  }

  @Get('websocket/connections/:connectionId')
  @ApiOperation({
    summary: 'Get individual WebSocket connection details',
    description:
      'Get detailed information about a specific WebSocket connection',
  })
  @ApiParam({
    name: 'connectionId',
    description: 'WebSocket connection ID',
    type: 'string',
  })
  @ApiResponse({
    status: 200,
    description: 'WebSocket connection details retrieved successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'Connection not found',
  })
  async getWebSocketConnection(
    @CurrentUser() user: AuthenticatedUser,
    @Param('connectionId') connectionId: string,
  ): Promise<WebSocketConnectionDetailDto> {
    this.logger.log(
      `User ${user.userId} requesting details for WebSocket connection: ${connectionId}`,
    );

    const connection =
      this.websocketConnectionManager.getConnection(connectionId);
    if (!connection) {
      throw new HttpException(
        `WebSocket connection ${connectionId} not found`,
        HttpStatus.NOT_FOUND,
      );
    }

    const subscription =
      this.websocketConnectionManager.getSubscription(connectionId);
    const socket = this.websocketConnectionManager.getSocket(connectionId);

    // Calculate connection duration
    const connectionDuration = Date.now() - connection.connectedAt.getTime();
    const lastActivityAge = Date.now() - connection.lastActivity.getTime();

    return {
      connectionId: connection.id,
      userId: connection.userId,
      connectedAt: connection.connectedAt.toISOString(),
      lastActivity: connection.lastActivity.toISOString(),
      rooms: {
        organizations: connection.organizationIds.map(
          (id) => `organization:${id}`,
        ),
        projects: connection.projectIds.map((id) => `project:${id}`),
        conversations: connection.conversationIds.map(
          (id) => `conversation:${id}`,
        ),
        initiatives: connection.initiativeIds.map((id) => `initiative:${id}`),
        user: connection.userId ? `user:${connection.userId}` : undefined,
      },
      eventSubscriptions: subscription?.eventTypes,
      // Additional details for individual connection lookup
      connectionHealth: {
        isConnected: !!socket?.connected,
        connectionDurationMs: connectionDuration,
        lastActivityAgeMs: lastActivityAge,
        totalRoomCount:
          connection.organizationIds.length +
          connection.projectIds.length +
          connection.conversationIds.length +
          connection.initiativeIds.length +
          (connection.userId ? 1 : 0),
      },
      socketInfo: socket
        ? {
            socketId: socket.id,
            connected: socket.connected,
            disconnected: socket.disconnected,
            rooms: Array.from(socket.rooms),
          }
        : undefined,
    } as WebSocketConnectionDetailDto & {
      connectionHealth?: {
        isConnected: boolean;
        connectionDurationMs: number;
        lastActivityAgeMs: number;
        totalRoomCount: number;
      };
      socketInfo?: {
        socketId: string;
        connected: boolean;
        disconnected: boolean;
        rooms: string[];
      };
    };
  }

  @Get('error-file-test')
  @ApiOperation({
    summary: 'Test error file writing',
    description:
      'Trigger a test error to verify ErrorFileWriter is creating files in logs/errors/',
  })
  @ApiResponse({
    status: 500,
    description:
      'Test error thrown successfully - check logs/errors/ for error file',
  })
  async testErrorFileWriter() {
    this.customLogger.error(
      'Test error triggered from debug endpoint',
      'Error stack trace from debug endpoint',
      'DEBUG_TEST',
    );

    // Also test logError method
    const testError = new Error('Test error object from debug endpoint');
    this.customLogger.logError(testError, {
      testEndpoint: 'debug/error-file-test',
      timestamp: new Date().toISOString(),
    });

    throw new HttpException(
      'Test error thrown successfully - check logs/errors/ directory for error files',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  @Get('embeddings/entity')
  @ApiOperation({
    summary: 'Get debug info for an entity from the embeddings service',
    description:
      "Returns the stored embeddings for a given entity type and source ID that belong to the project. Only the project's Owners may call it.",
  })
  @ApiQuery({
    name: 'type',
    required: true,
    type: String,
    description: 'Entity content type (e.g. task, initiative, message)',
  })
  @ApiQuery({
    name: 'id',
    required: true,
    type: String,
    description: 'Entity source ID',
  })
  @ApiQuery({
    name: 'projectId',
    required: true,
    type: String,
    description:
      'Project the entity belongs to; only embeddings from this project are returned',
  })
  @ApiResponse({ status: 200, description: 'Entity debug info retrieved' })
  @ApiResponse({
    status: 403,
    description: 'Caller is not an Owner of the project',
  })
  @ApiResponse({ status: 500, description: 'Failed to fetch from embeddings' })
  async getDebugEntity(
    @CurrentUser() user: AuthenticatedUser,
    @Query('type') type: string,
    @Query('id') id: string,
    @Query('projectId') projectId: ProjectId,
  ) {
    if (!type || !id || !projectId) {
      throw new BadRequestException('type, id and projectId are required');
    }

    await this.projectAccess.assertProjectRole(
      projectId,
      user.userId,
      'viewProjectEmbeddings',
    );

    this.logger.log('Fetching debug entity from embeddings service', {
      type,
      id,
      projectId,
    });

    const entity = await this.embeddingsClient.getDebugEntity(type, id);
    const documents = (entity.documents ?? []).filter(
      (document) => document.metadata?.projectId === projectId,
    );
    return {
      ...entity,
      found: documents.length > 0,
      count: documents.length,
      documents,
    };
  }
}

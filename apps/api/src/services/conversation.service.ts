import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import {
  ConversationCreatedEvent,
  ConversationStatusChangedEvent,
  ConversationUpdatedEvent,
} from 'src/core/events/types/domain-events';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import { DomainEventPublisher } from '../core/events/domain-event-publisher';
import {
  EventContextManager,
  WithEventContext,
} from '../core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../core/events/tokens';
import {
  AnyTransactionClient,
  ExtendedPrismaClient,
  PrismaService,
} from '../prisma/prisma.service';
import { InjectTemporalClient } from '../prisma/temporal.module';
import { WorkflowSignalHelper } from '../utils/workflow-signals.helper';
import { ConversationValidation } from '../validation/conversation.validation';
import { ArtifactService } from './artifacts/artifact.service';
import { MessageService } from './message.service';
import { TIMELINE_MESSAGE_WHERE } from 'src/utils/message-timeline.util';
import { ProjectService } from './project.service';
import { WorkflowTypeRegistryService } from './workflows/workflow-type-registry.service';

import { EntityType, Prisma, SuggestionDecision } from '@prisma/client';
import { Client } from '@temporalio/client';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import {
  ConversationId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from 'src/types';
import { removeUndefined } from 'src/utils/object.utils';
import { VersionConflictException } from '../core/exceptions/version-conflict.exception';
import type {
  SuggestionDecisionResponseDto,
  SuggestionType,
} from '../generated';
import {
  ArtifactSourceType,
  ConversationDeletedEventPayload,
  ConversationResponseDto,
  ConversationStatus,
  ConversationUpdateEventData,
  ConversationUpdatedEventPayload,
  CreateConversationDto,
  CreateDecisionRefinementConversationDto,
  UpdateConversationDto as GeneratedUpdateConversationDto,
  InitiationType,
  UpdateConversationDto,
  WorkflowName,
} from '../generated';
import type { SuggestionDecisionMetadata } from './suggestion-decision.service';
import {
  GOAL_PM_ROUTING_DECISION_TYPE,
  mapGoalPmRoutingDecision,
} from './goal-pm-routing-decision.service';

type ConversationIncludeArg = NonNullable<
  Parameters<ExtendedPrismaClient['conversation']['findFirst']>[0]
>['include'];

// Query parameter interfaces
interface GetConversationsQueryParams {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  status?: ConversationStatus | ConversationStatus[];
  workflowName?: string | string[];
  workflowAboutId?: string;
  workflowAboutType?: string;
  initiatedBy?: InitiationType;
  search?: string;
  includeSuggestionDecisions?: boolean;
}

interface GetActiveConversationsQueryParams
  extends Omit<GetConversationsQueryParams, 'status'> {
  projectId?: string;
}

interface GetWorkflowConversationsQueryParams {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  status?: ConversationStatus | ConversationStatus[];
  workflowName?: string;
}

// Conversation type with branded IDs and optionally requested decisions.
type ConversationWithRelations = Omit<
  Prisma.ConversationGetPayload<{
    include: {
      suggestionDecisions: true;
    };
  }>,
  'id' | 'projectId' | 'workflowId' | 'suggestionDecisions'
> & {
  id: ConversationId;
  projectId: ProjectId;
  workflowId?: WorkflowId | null;
  workflowAboutType?: string | null;
  suggestionDecisions?: SuggestionDecision[];
};

const ensureStrDate = (date: Date | string) =>
  typeof date === 'string' ? date : date.toISOString();

@Injectable()
export class ConversationService {
  private readonly logger = ContextAwareLogger.createServiceLogger(
    ConversationService.name,
  );

  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => ConversationValidation))
    private conversationValidation: ConversationValidation,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    @InjectTemporalClient()
    private temporalClient: Client,
    @Inject(forwardRef(() => MessageService))
    private messageService: MessageService,
    private projectService: ProjectService,
    private artifactService: ArtifactService,
    private workflowTypeRegistryService: WorkflowTypeRegistryService,
  ) {}

  private async mapToDto(
    conversation: ConversationWithRelations | null,
  ): Promise<ConversationResponseDto | null> {
    if (!conversation) return null;

    const suggestionDecisions = conversation.suggestionDecisions
      ? conversation.suggestionDecisions
          .filter((decision) => decision.type !== GOAL_PM_ROUTING_DECISION_TYPE)
          .map((decision) => this.mapSuggestionDecision(decision))
      : undefined;

    const dto: ConversationResponseDto = {
      id: conversation.id,
      createdBy: conversation.createdBy,
      restricted: conversation.restricted,
      projectId: conversation.projectId,
      organizationId: conversation.organizationId as OrganizationId,
      workflowId: conversation.workflowId ?? undefined,
      workflowAboutType: conversation.workflowAboutType ?? undefined,
      initiatedBy: conversation.initiatedBy as InitiationType,
      triggerEvent: conversation.triggerEvent ?? undefined,
      status: conversation.status as ConversationStatus,
      title: conversation.title ?? undefined,
      version: conversation.version,
      lastModifiedBy: conversation.lastModifiedBy ?? undefined,
      workflowName: conversation.workflowName as WorkflowName,
      workflowAboutId: conversation.workflowAboutId ?? undefined,
      createdAt: ensureStrDate(conversation.createdAt),
      updatedAt: ensureStrDate(conversation.updatedAt),
      ...(suggestionDecisions ? { suggestionDecisions } : {}),
      ...(conversation.suggestionDecisions
        ? {
            goalPmRoutingDecisions: conversation.suggestionDecisions
              .filter(
                (decision) => decision.type === GOAL_PM_ROUTING_DECISION_TYPE,
              )
              .map(mapGoalPmRoutingDecision),
          }
        : {}),
    };

    return dto;
  }

  private mapSuggestionDecision(
    decision: SuggestionDecision,
  ): SuggestionDecisionResponseDto {
    return {
      id: decision.suggestionId,
      type: decision.type as SuggestionType,
      accepted: decision.accepted,
      decidedBy: decision.decidedBy ?? null,
      createdAt: ensureStrDate(decision.createdAt),
      sourceConversationId:
        (decision.sourceConversationId as ConversationId | null) ?? undefined,
      sourceMessageId:
        (decision.sourceMessageId as MessageId | undefined) ?? undefined,
      metadata:
        (decision.metadata as SuggestionDecisionMetadata | null) ?? undefined,
    };
  }

  private buildConversationInclude(
    includeSuggestionDecisions?: boolean,
  ): ConversationIncludeArg {
    return {
      ...(includeSuggestionDecisions
        ? {
            suggestionDecisions: {
              orderBy: {
                createdAt: 'desc',
              },
            },
          }
        : {}),
    };
  }

  private buildConversationCreateData(
    createConversationDto: CreateConversationDto,
    organizationId: OrganizationId,
    createdBy?: UserId,
  ): Prisma.ConversationUncheckedCreateInput {
    return {
      restricted: true,
      projectId: createConversationDto.projectId,
      organizationId,
      createdBy,
      ...(createConversationDto.workflowId && {
        workflowId: createConversationDto.workflowId,
      }),
      ...(createConversationDto.workflowAboutType && {
        workflowAboutType: createConversationDto.workflowAboutType,
      }),
      initiatedBy: createConversationDto.initiatedBy,
      triggerEvent: createConversationDto.triggerEvent,
      title: createConversationDto.title,
      workflowName: createConversationDto.workflowName,
      status: createConversationDto.status || ConversationStatus.Started,
      version: 1,
      ...(createConversationDto.workflowAboutId && {
        workflowAboutId: createConversationDto.workflowAboutId,
      }),
    };
  }

  async createConversationInTransaction(
    tx: AnyTransactionClient,
    createConversationDto: CreateConversationDto,
    organizationId: OrganizationId,
    explicitConversationId?: ConversationId,
    createdBy?: UserId,
  ): Promise<ConversationWithRelations> {
    const conversationData = this.buildConversationCreateData(
      createConversationDto,
      organizationId,
      createdBy,
    );

    this.logger.debug('[createConversation] creating conversation in tx', {
      conversationData,
    });
    const conversation = (await tx.conversation.create({
      data: {
        ...(explicitConversationId ? { id: explicitConversationId } : {}),
        ...conversationData,
      },
    })) as ConversationWithRelations;

    await this.publishConversationCreatedEvent({
      tx: tx as Prisma.TransactionClient,
      aggregateId: conversation.id as ConversationId,
      organizationId,
      projectId: createConversationDto.projectId,
      workflowId: createConversationDto.workflowId,
      ...(conversation.workflowAboutId
        ? { workflowAboutId: conversation.workflowAboutId }
        : {}),
      ...(conversation.workflowAboutType
        ? { workflowAboutType: conversation.workflowAboutType }
        : {}),
      workflowName: conversation.workflowName as WorkflowName,
      ...(conversation.title ? { conversationTitle: conversation.title } : {}),
      initiatedBy: conversation.initiatedBy as InitiationType,
      status: conversation.status as ConversationStatus,
      version: conversation.version,
    });

    return conversation;
  }

  async createValidationSessionConversationInTransaction(params: {
    tx: AnyTransactionClient;
    organizationId: OrganizationId;
    projectId: ProjectId;
    validationSessionId: string;
    userId: UserId;
    title?: string;
  }): Promise<ConversationResponseDto> {
    const createConversationDto = {
      projectId: params.projectId,
      organizationId: params.organizationId,
      initiatedBy: InitiationType.User,
      triggerEvent: 'validation_session.created',
      ...(params.title ? { title: params.title } : {}),
      workflowName: 'validation-session' as unknown as WorkflowName,
      workflowAboutType: 'validation-session',
      workflowAboutId: params.validationSessionId,
      context: {},
    } as unknown as CreateConversationDto;

    const conversation = await this.createConversationInTransaction(
      params.tx,
      createConversationDto,
      params.organizationId,
      undefined,
      params.userId,
    );
    const dto = await this.mapToDto(conversation);

    if (!dto) {
      throw new InternalServerErrorException(
        'Failed to create validation session conversation',
      );
    }

    return dto;
  }

  async publishConversationUpdatedEvent(
    tx: Prisma.TransactionClient,
    params: {
      aggregateId: ConversationId;
      organizationId: OrganizationId;
      projectId: ProjectId;
      update: ConversationUpdateEventData;
      previousVersion: number;
      newVersion: number;
      changeType: 'user' | 'system';
      lastModifiedBy?: string;
    },
  ): Promise<string | null> {
    const latest = await tx.message.findFirst({
      where: { conversationId: params.aggregateId, ...TIMELINE_MESSAGE_WHERE },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });

    const payload: ConversationUpdatedEventPayload = {
      payloadType: EVENT_TYPES.CONVERSATION.UPDATED,
      organizationId: params.organizationId,
      projectId: params.projectId,
      update: params.update,
      latestMessageId: latest?.id,
      previousVersion: params.previousVersion,
      newVersion: params.newVersion,
      changeType: params.changeType,
      lastModifiedBy: params.lastModifiedBy,
    };

    const event: Omit<ConversationUpdatedEvent, 'id'> = {
      type: EVENT_TYPES.CONVERSATION.UPDATED,
      aggregateId: params.aggregateId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async publishConversationCreatedEvent(params: {
    aggregateId: ConversationId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    workflowId?: WorkflowId;
    workflowAboutId?: string;
    workflowAboutType?: string;
    workflowName: WorkflowName;
    conversationTitle?: string;
    initiatedBy: InitiationType;
    status: ConversationStatus;
    version?: number;
    tx?: Prisma.TransactionClient;
  }): Promise<string | null> {
    const payload: ConversationCreatedEvent['payload'] = {
      payloadType: EVENT_TYPES.CONVERSATION.CREATED,
      organizationId: params.organizationId,
      projectId: params.projectId,
      workflowId: params.workflowId,
      conversationId: params.aggregateId,
      ...(params.workflowAboutId
        ? { workflowAboutId: params.workflowAboutId }
        : {}),
      ...(params.workflowAboutType
        ? { workflowAboutType: params.workflowAboutType }
        : {}),
      workflowName: params.workflowName,
      ...(params.conversationTitle
        ? { conversationTitle: params.conversationTitle }
        : {}),
      initiatedBy: params.initiatedBy,
      status: params.status,
      version: params.version,
    };

    const event: Omit<ConversationCreatedEvent, 'id'> = {
      type: EVENT_TYPES.CONVERSATION.CREATED,
      aggregateId: params.aggregateId,
      payload,
    };

    if (params.tx) {
      return this.eventPublisher.publishInTransaction(params.tx, event);
    }

    return this.eventPublisher.publish(event);
  }

  private async publishConversationStatusChangedEvent(
    tx: Prisma.TransactionClient,
    params: {
      aggregateId: ConversationId;
      organizationId: OrganizationId;
      projectId: ProjectId;
      conversationId: ConversationId;
      previousStatus: ConversationStatus;
      newStatus: ConversationStatus;
      restoredBy?: string;
      timestamp: Date;
    },
  ): Promise<string | null> {
    const payload: ConversationStatusChangedEvent['payload'] = {
      payloadType: EVENT_TYPES.CONVERSATION.STATUS_CHANGED,
      organizationId: params.organizationId,
      projectId: params.projectId,
      conversationId: params.conversationId,
      previousStatus: params.previousStatus,
      newStatus: params.newStatus,
      restoredBy: params.restoredBy,
      timestamp: params.timestamp.toISOString(),
    };

    const event: Omit<ConversationStatusChangedEvent, 'id'> = {
      type: EVENT_TYPES.CONVERSATION.STATUS_CHANGED,
      aggregateId: params.aggregateId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  private async mapToDtoArray(
    conversations: ConversationWithRelations[],
  ): Promise<ConversationResponseDto[]> {
    const results = await Promise.all(
      conversations.map((c) => this.mapToDto(c)),
    );
    return results.filter((c) => c !== null);
  }

  private buildWhereClause(
    params: GetConversationsQueryParams,
    projectId?: string,
  ): Prisma.ConversationWhereInput {
    const where: Prisma.ConversationWhereInput = {};

    if (projectId) {
      where.projectId = projectId;
    }

    if (params.status) {
      if (Array.isArray(params.status)) {
        where.status = {
          in: params.status,
        };
      } else {
        where.status = params.status;
      }
    } else {
      // CRITICAL: Always exclude deleted conversations (soft delete) unless explicitly querying for them
      where.status = {
        not: ConversationStatus.Deleted,
      };
    }

    if (params.workflowName) {
      if (Array.isArray(params.workflowName)) {
        where.workflowName = {
          in: params.workflowName,
        };
      } else {
        where.workflowName = params.workflowName;
      }
    }

    if (params.workflowAboutId) {
      where.workflowAboutId = params.workflowAboutId;
    }

    if (params.workflowAboutType) {
      where.workflowAboutType = params.workflowAboutType;
    }

    if (params.initiatedBy) {
      where.initiatedBy = params.initiatedBy;
    }

    if (params.search) {
      where.OR = [
        {
          title: {
            contains: params.search,
            mode: 'insensitive',
          },
        },
        {
          workflowName: {
            contains: params.search,
            mode: 'insensitive',
          },
        },
      ];
    }

    return where;
  }

  private buildOrderBy(
    params: GetConversationsQueryParams,
  ): Prisma.ConversationOrderByWithRelationInput {
    const sortBy = params.sortBy || 'updatedAt';
    const sortOrder = params.sortOrder || 'desc';

    return {
      [sortBy]: sortOrder,
    };
  }

  @WithEventContext('ConversationService')
  async createConversation(
    createConversationDto: CreateConversationDto,
    organizationId: OrganizationId,
    options?: {
      createdBy?: UserId;
      onCreatedInTx?: (
        tx: Prisma.TransactionClient,
        conversation: ConversationWithRelations,
      ) => Promise<void>;
    },
  ): Promise<ConversationResponseDto | null> {
    this.logger.log('[createConversation] Starting conversation creation', {
      organizationId,
      projectId: createConversationDto.projectId,
      workflowId: createConversationDto.workflowId,
      title: createConversationDto.title,
    });

    try {
      // Set up event context with business data
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext) {
        // Update context with conversation-specific data
        currentContext.organizationId = organizationId;
        currentContext.projectId = createConversationDto.projectId;
        currentContext.workflowId = createConversationDto.workflowId;
      }

      // Use manual transaction to keep outbox atomic
      this.logger.debug('[createConversation] starting transaction');
      const conversation = await this.prisma.$transaction(async (tx) => {
        try {
          const conv = await this.createConversationInTransaction(
            tx,
            createConversationDto,
            organizationId,
            undefined,
            options?.createdBy,
          );
          if (options?.onCreatedInTx) {
            await options.onCreatedInTx(tx as Prisma.TransactionClient, conv);
          }
          return conv;
        } catch (err) {
          this.logger.error('Error creating conversation', err);
          throw err;
        }
      });

      this.logger.log(
        '[createConversation] Conversation created successfully',
        {
          conversationId: conversation.id,
          title: conversation.title,
          status: conversation.status,
          projectId: conversation.projectId,
          workflowId: conversation.workflowId,
        },
      );

      const dto = await this.mapToDto(
        conversation as ConversationWithRelations,
      );
      this.logger.log('[createConversation] Mapped to DTO', {
        dtoId: dto?.id,
        dtoTitle: dto?.title,
      });

      return dto;
    } catch (error) {
      this.logger.error('[createConversation] Failed to create conversation', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        organizationId,
        createConversationDto,
      });
      throw new InternalServerErrorException('Failed to create conversation');
    }
  }

  @WithEventContext('ConversationService')
  async updateConversation(
    id: ConversationId,
    organizationId: OrganizationId,
    updateConversationDto: UpdateConversationDto,
    userId?: string,
  ): Promise<ConversationResponseDto | null> {
    try {
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext) {
        currentContext.organizationId = organizationId;
        currentContext.conversationId = id;
      }

      const { expectedVersion, ...updateData } = updateConversationDto;

      if (expectedVersion === undefined || expectedVersion === null) {
        throw new BadRequestException(
          'expectedVersion is required for conversation updates',
        );
      }

      this.logger.debug(
        '[updateConversation] starting transaction with version check',
        {
          id,
          expectedVersion,
          updateData,
        },
      );

      const conversation = await this.prisma.$transaction(async (tx) => {
        try {
          // 1. Fetch current version for comparison
          const current = await tx.conversation.findUnique({
            where: { id },
            select: { version: true, projectId: true },
          });

          if (!current) {
            throw new NotFoundException(`Conversation ${id} not found`);
          }

          if (current.version !== expectedVersion) {
            throw new VersionConflictException(
              `Version conflict: expected ${expectedVersion}, got ${current.version}`,
              expectedVersion,
              current.version,
            );
          }

          this.logger.debug(
            '[updateConversation] updating conversation with version increment',
            {
              id,
              expectedVersion,
              updateData,
            },
          );

          // 2. Update with version increment using optimistic locking
          const conv = (await tx.conversation.update({
            where: {
              id,
              version: expectedVersion, // Optimistic locking
            },
            data: {
              ...removeUndefined(updateData),
              version: { increment: 1 }, // Atomic version increment
              lastModifiedBy: userId,
              updatedAt: new Date(),
            },
          })) as ConversationWithRelations;

          await this.publishConversationUpdatedEvent(tx, {
            aggregateId: id,
            organizationId,
            projectId: conv.projectId,
            update: {
              ...updateConversationDto,
              ...(updateConversationDto.workflowAboutId && {
                workflowAboutType: conv.workflowAboutType ?? undefined,
              }),
            } satisfies ConversationUpdateEventData,
            previousVersion: expectedVersion,
            newVersion: conv.version,
            changeType: 'user',
            lastModifiedBy: userId,
          });

          return conv;
        } catch (err) {
          this.logger.error(
            '[updateConversation] error updating conversation in tx',
            err,
          );
          throw err;
        }
      });

      this.logger.log('Conversation updated with version increment', {
        conversationId: conversation.id,
        previousVersion: expectedVersion,
        newVersion: conversation.version,
        updateData,
      });

      return this.mapToDto(conversation);
    } catch (error) {
      // Re-throw VersionConflictException without wrapping
      if (error instanceof VersionConflictException) {
        throw error;
      }

      this.logger.error('Failed to update conversation', {
        error: (error as Error).message,
        conversationId: id,
        updateConversationDto,
        organizationId,
      });
      throw new InternalServerErrorException('Failed to update conversation');
    }
  }

  /**
   * Increment conversation version atomically (for internal service use)
   * @param conversationId - The conversation ID to increment
   * @param tx - Optional transaction context
   * @returns Updated conversation with new version
   */
  async incrementConversationVersion(
    conversationId: ConversationId,
    userId?: string,
    tx?: Prisma.TransactionClient,
  ): Promise<{ previousVersion: number; newVersion: number }> {
    const prismaClient =
      tx || (this.prisma.db as unknown as Prisma.TransactionClient);

    const updatedConversation = await prismaClient.conversation.update({
      where: { id: conversationId },
      data: {
        version: { increment: 1 },
        lastModifiedBy: userId,
        updatedAt: new Date(),
      },
      select: { version: true },
    });

    return {
      previousVersion: updatedConversation.version - 1,
      newVersion: updatedConversation.version,
    };
  }

  /**
   * Internal system update without version checking (for workflows and internal operations)
   * @param conversationId - The conversation ID to update
   * @param organizationId - Organization ID for security
   * @param updateData - Data to update (without expectedVersion)
   * @param userId - Optional user ID for tracking
   * @returns Updated conversation
   */
  async updateConversationInternal(
    conversationId: ConversationId,
    organizationId: OrganizationId,
    updateData: Omit<UpdateConversationDto, 'expectedVersion'>,
    userId?: string,
  ): Promise<ConversationResponseDto | null> {
    try {
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext) {
        currentContext.organizationId = organizationId;
        currentContext.conversationId = conversationId;
      }

      this.logger.debug('[updateConversationInternal] starting transaction', {
        conversationId,
        updateData,
      });

      const sanitizedUpdate = removeUndefined(updateData);
      let didUpdate = false;

      const conversation = await this.prisma.$transaction(async (tx) => {
        try {
          const existing = await tx.conversation.findUnique({
            where: { id: conversationId },
          });

          if (!existing) {
            throw new NotFoundException(
              `Conversation ${conversationId} not found`,
            );
          }

          const hasChanges = Object.entries(sanitizedUpdate).some(
            ([key, value]) =>
              (existing as Record<string, unknown>)[key] !== value,
          );

          if (!hasChanges) {
            this.logger.debug(
              '[updateConversationInternal] skipping no-op update',
              {
                conversationId,
                updateData: sanitizedUpdate,
              },
            );
            return existing as ConversationWithRelations;
          }

          // Update with version increment (no version checking)
          const conv = (await tx.conversation.update({
            where: { id: conversationId },
            data: {
              ...sanitizedUpdate,
              version: { increment: 1 },
              lastModifiedBy: userId,
              updatedAt: new Date(),
            },
          })) as ConversationWithRelations;
          didUpdate = true;

          const previousVersion = conv.version - 1;
          const updatePayload = {
            ...sanitizedUpdate,
            expectedVersion: previousVersion,
            ...(sanitizedUpdate.workflowAboutId && {
              workflowAboutType: conv.workflowAboutType ?? undefined,
            }),
          } satisfies ConversationUpdateEventData;

          await this.publishConversationUpdatedEvent(tx, {
            aggregateId: conversationId,
            organizationId,
            projectId: conv.projectId,
            update: updatePayload,
            previousVersion,
            newVersion: conv.version,
            changeType: 'system',
            lastModifiedBy: userId,
          });

          return conv;
        } catch (err) {
          this.logger.error(
            '[updateConversationInternal] error updating conversation in tx',
            err,
          );
          throw err;
        }
      });

      if (didUpdate) {
        this.logger.log(
          'Conversation updated internally with version increment',
          {
            conversationId: conversation.id,
            newVersion: conversation.version,
            updateData: sanitizedUpdate,
          },
        );
      } else {
        this.logger.debug('[updateConversationInternal] no changes applied', {
          conversationId: conversation.id,
          updateData: sanitizedUpdate,
        });
      }

      return this.mapToDto(conversation);
    } catch (error) {
      this.logger.error('Failed to update conversation internally', {
        error: (error as Error).message,
        conversationId,
        updateData,
        organizationId,
      });
      throw new InternalServerErrorException('Failed to update conversation');
    }
  }

  async getConversation(
    id: ConversationId,
    organizationId: OrganizationId,
    options?: {
      includeSuggestionDecisions?: boolean;
    },
  ): Promise<ConversationResponseDto | null> {
    this.logger.debug('[getConversation] fetching conversation', {
      id,
      organizationId,
    });
    // we get an excessive depth ts error without this
    type Args = Parameters<typeof this.prisma.db.conversation.findFirst>[0];
    const args: Args = {
      where: {
        id,
        organizationId,
        // CRITICAL: Exclude deleted conversations (soft delete)
        status: {
          not: ConversationStatus.Deleted,
        },
      },
      include: this.buildConversationInclude(
        options?.includeSuggestionDecisions,
      ),
    };
    const conversation = (await this.prisma.db.conversation.findFirst(
      args,
    )) as ConversationWithRelations;

    return this.mapToDto(conversation);
  }

  async getConversationsByProject(
    projectId: ProjectId,
    organizationId: OrganizationId,
    queryParams: GetConversationsQueryParams = {},
  ): Promise<{
    data: ConversationResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    // CRITICAL: Validate project belongs to organization
    this.logger.debug(
      '[getConversationsByProject] validating project ownership',
      {
        projectId,
        organizationId,
      },
    );
    const project = await this.prisma.db.project.findFirst({
      where: {
        id: projectId,
        organizationId,
      },
    });

    if (!project) {
      throw new Error(
        `Project with ID ${projectId} not found in organization ${organizationId}`,
      );
    }
    const page = parseInt(String(queryParams.page || 1), 10);
    const limit = parseInt(String(queryParams.limit || 20), 10);
    const skip = (page - 1) * limit;

    const where = this.buildWhereClause(queryParams, projectId);
    const orderBy = this.buildOrderBy(queryParams);

    this.logger.debug(
      '[getConversationsByProject] fetching conversations and count',
      {
        where,
        orderBy,
        skip,
        limit,
      },
    );
    // we get an excessive depth ts error without this
    type Args = Parameters<typeof this.prisma.db.conversation.findMany>[0];
    const args: Args = {
      where,
      orderBy,
      skip,
      take: limit,
      include: this.buildConversationInclude(
        queryParams.includeSuggestionDecisions,
      ),
    };
    const [conversations, total] = await Promise.all([
      this.prisma.db.conversation.findMany(args),
      this.prisma.db.conversation.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: await this.mapToDtoArray(
        conversations as ConversationWithRelations[],
      ),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getActiveConversations(
    organizationId: OrganizationId,
    queryParams: GetActiveConversationsQueryParams = {},
  ): Promise<{
    data: ConversationResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = parseInt(String(queryParams.page || 1), 10);
    const limit = parseInt(String(queryParams.limit || 20), 10);
    const skip = (page - 1) * limit;

    // Build base where clause without status (since we set it explicitly here)
    const baseWhere = this.buildWhereClause(
      { ...queryParams, status: undefined },
      queryParams.projectId,
    );

    const where: Prisma.ConversationWhereInput = {
      ...baseWhere,
      status: {
        in: [
          ConversationStatus.NotStarted,
          ConversationStatus.Started,
          ConversationStatus.InProgress,
          ConversationStatus.GeneratingResponse,
        ],
      },
      organizationId,
    };

    const orderBy = this.buildOrderBy(queryParams);

    this.logger.debug(
      '[getActiveConversations] fetching active conversations and count',
      {
        where,
        orderBy,
        skip,
        limit,
      },
    );

    // we get an excessive depth ts error without this
    type Args = Parameters<typeof this.prisma.db.conversation.findMany>[0];
    const args: Args = {
      where,
      orderBy,
      skip,
      take: limit,
      include: this.buildConversationInclude(
        queryParams.includeSuggestionDecisions,
      ),
    };
    const [conversations, total] = await Promise.all([
      this.prisma.db.conversation.findMany(args),
      this.prisma.db.conversation.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);

    return {
      data: await this.mapToDtoArray(
        conversations as ConversationWithRelations[],
      ),
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getActiveConversationsFromAdapter(
    projectId: ProjectId,
    organizationId: OrganizationId,
    queryParams: GetActiveConversationsQueryParams = {},
  ): Promise<{
    data: ConversationResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    return this.getActiveConversations(organizationId, {
      projectId,
      ...queryParams,
    });
  }

  async getAllConversationsFromAdapter(
    projectId: ProjectId,
    organizationId: OrganizationId,
    queryParams: GetConversationsQueryParams = {},
  ): Promise<{
    data: ConversationResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const result = await this.getConversationsByProject(
      projectId,
      organizationId,
      queryParams,
    );

    return result;
  }

  async getConversationFromAdapter(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    options?: {
      includeSuggestionDecisions?: boolean;
    },
  ): Promise<ConversationResponseDto | null> {
    const result = await this.getConversation(conversationId, organizationId, {
      includeSuggestionDecisions: options?.includeSuggestionDecisions,
    });
    this.conversationValidation.validateConversationBelongsToProject(
      result,
      projectId,
    );
    return result;
  }

  /**
   * Resolve the user that "owns" this conversation — defined as the userId
   * on the most-recently-created `AgentSession` attached to it. Matches the
   * owner definition the trigger emitter uses (see
   * `TriggerRecipientResolver.resolveConversationRecipient`), so the
   * cli-status presence check answers the same "owner" question that
   * trigger routing does. Returns null when no agent session is yet
   * attributed to a user (lazy session creation).
   */
  async getOwnerUserId(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<UserId | null> {
    const agentSession = await this.prisma.db.agentSession.findFirst({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'desc' },
      select: { userId: true },
    });
    const ownerUserId = (agentSession?.userId as UserId | undefined) ?? null;
    this.logger.verbose('[ConversationService] resolved conversation owner', {
      conversationId,
      organizationId,
      ownerUserId,
      hasAgentSession: !!agentSession,
    });
    return ownerUserId;
  }

  async getOwnerMachineSelection(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<{ userId: UserId; machineId: MachineId | null } | null> {
    const agentSession = await this.prisma.db.agentSession.findFirst({
      where: { conversationId, organizationId },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, machineId: true },
    });
    if (!agentSession) return null;

    if (agentSession.machineId) {
      return {
        userId: agentSession.userId as UserId,
        machineId: agentSession.machineId as MachineId,
      };
    }

    const fallbackMachine = await this.prisma.db.machine.findFirst({
      where: {
        userId: agentSession.userId,
        organizationId,
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
        controllerCredentials: { some: { revokedAt: null } },
      },
      orderBy: { pairedAt: 'desc' },
      select: { id: true },
    });
    return {
      userId: agentSession.userId as UserId,
      machineId: (fallbackMachine?.id as MachineId | undefined) ?? null,
    };
  }

  async getConversationVersion(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<number> {
    const conversation = await this.prisma.db.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
        status: {
          not: ConversationStatus.Deleted,
        },
      },
      select: {
        version: true,
        projectId: true,
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.projectId !== projectId) {
      throw new BadRequestException(
        'Conversation does not belong to the specified project',
      );
    }

    return conversation.version;
  }

  async updateConversationFromAdapter(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    dto: GeneratedUpdateConversationDto,
  ): Promise<ConversationResponseDto | null> {
    const conversation = await this.getConversation(
      conversationId,
      organizationId,
    );
    this.conversationValidation.validateConversationBelongsToProject(
      conversation,
      projectId,
    );

    const serviceDto: UpdateConversationDto = {
      expectedVersion: dto.expectedVersion,
      status: dto.status,
      title: dto.title ?? undefined,
      workflowName: dto.workflowName,
      workflowId: dto.workflowId,
    };

    const result = await this.updateConversation(
      conversationId,
      organizationId,
      serviceDto,
    );
    return result;
  }

  async getConversationsByWorkflowEntityFromAdapter(
    organizationId: OrganizationId,
    projectId: ProjectId,
    workflowAboutId: string,
    workflowName: string,
    queryParams: GetWorkflowConversationsQueryParams = {},
    options: { includeDeleted?: boolean } = {},
  ): Promise<{
    data: ConversationResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const page = Number(queryParams.page) || 1;
    const limit = Number(queryParams.limit) || 10;
    const skip = (page - 1) * limit;
    const sortBy = queryParams.sortBy || 'createdAt';
    const sortOrder = queryParams.sortOrder || 'desc';

    // Extract only valid filter parameters from queryParams
    const {
      page: _,
      limit: __,
      sortBy: ___,
      sortOrder: ____,
      ...filterParams
    } = queryParams;

    const includeDeleted = options.includeDeleted ?? false;

    const whereMinimal: Prisma.ConversationWhereInput = {
      workflowAboutId,
      workflowName,
      projectId,
      project: {
        organizationId,
      },
      // Only include actual filter parameters (status, workflowName)
      ...(filterParams.status
        ? {
            status: Array.isArray(filterParams.status)
              ? { in: filterParams.status }
              : filterParams.status,
          }
        : includeDeleted
          ? {}
          : { status: { not: ConversationStatus.Deleted } }),
      ...(filterParams.workflowName && {
        workflowName: filterParams.workflowName,
      }),
    };

    // Debug logging
    this.logger.debug('Querying conversations by workflow entity', {
      workflowName: queryParams.workflowName,
      workflowAboutId,
      projectId,
      organizationId,
      queryParams,
    });

    this.logger.debug(
      '[getConversationsByWorkflowEntityFromAdapter] fetching conversations by workflow entity',
      {
        whereMinimal,
        sortBy,
        sortOrder,
        skip,
        limit,
      },
    );

    type Args = Parameters<typeof this.prisma.db.conversation.findMany>[0];
    const args: Args = {
      where: whereMinimal,
      include: this.buildConversationInclude(false),
      orderBy: {
        [sortBy]: sortOrder,
      },
      skip,
      take: limit,
    };

    const [conversations, total] = await Promise.all([
      this.prisma.db.conversation.findMany(args),
      this.prisma.db.conversation.count({
        where: whereMinimal,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);
    const data: ConversationResponseDto[] = await this.mapToDtoArray(
      conversations as ConversationWithRelations[],
    );

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  async getConversationsByWorkflowAbout(
    organizationId: OrganizationId,
    workflowAboutId: string,
    workflowAboutType: WorkflowAboutType,
    options: {
      includeSuggestionDecisions?: boolean;
      includeDeleted?: boolean;
    } = {},
  ): Promise<ConversationResponseDto[]> {
    const includeDeleted = options.includeDeleted ?? false;
    const conversations = await this.prisma.db.conversation.findMany({
      where: {
        organizationId,
        workflowAboutId,
        workflowAboutType,
        ...(includeDeleted
          ? {}
          : { status: { not: ConversationStatus.Deleted } }),
      },
      include: this.buildConversationInclude(
        options.includeSuggestionDecisions,
      ),
      orderBy: { createdAt: 'desc' },
    });

    return this.mapToDtoArray(conversations as ConversationWithRelations[]);
  }

  async findOne(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<ConversationResponseDto | null> {
    return this.getConversation(conversationId, organizationId);
  }

  /**
   * Atomically transition a conversation from NOT_STARTED to IN_PROGRESS.
   *
   * Used to guard the workflow-start path against concurrent callers (e.g.
   * a UI that fires the /start endpoint twice in rapid succession). The
   * conditional updateMany is the lock: only one of N concurrent writes
   * flips the row; the rest return count: 0 and the caller treats the
   * start as a no-op. Returns `claimed: false` if the row was not in
   * NOT_STARTED at the moment of the write.
   */
  async claimConversationForStart(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<{
    claimed: boolean;
    conversation: ConversationResponseDto | null;
  }> {
    this.logger.debug('[claimConversationForStart] attempting claim', {
      conversationId,
      organizationId,
    });

    const result = await this.prisma.db.conversation.updateMany({
      where: {
        id: conversationId,
        organizationId,
        status: ConversationStatus.NotStarted,
      },
      data: {
        status: ConversationStatus.InProgress,
        version: { increment: 1 },
        updatedAt: new Date(),
      },
    });

    const conversation = await this.getConversation(
      conversationId,
      organizationId,
    );

    const claimed = result.count === 1;
    this.logger.debug('[claimConversationForStart] claim result', {
      conversationId,
      claimed,
      currentStatus: conversation?.status,
    });

    return { claimed, conversation };
  }

  async updateConversationWorkflowId(
    conversationId: ConversationId,
    workflowId: string,
    organizationId: OrganizationId,
  ): Promise<ConversationResponseDto | null> {
    try {
      const updateResult = await this.updateConversationInternal(
        conversationId,
        organizationId,
        { workflowId: workflowId as WorkflowId },
        'system',
      );

      this.logger.log('Updated conversation with workflow ID', {
        conversationId,
        workflowId,
        organizationId,
      });

      return updateResult;
    } catch (error) {
      this.logger.error('Failed to update conversation workflow ID', {
        error: (error as Error).message,
        conversationId,
        workflowId,
        organizationId,
      });
      throw new InternalServerErrorException(
        'Failed to update conversation workflow ID',
      );
    }
  }

  @WithEventContext('ConversationService')
  async deleteConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
    deletedBy?: string,
    reason?: string,
    hardDelete?: boolean,
  ): Promise<ConversationResponseDto> {
    const shouldHardDelete = hardDelete ?? false;

    this.logger.log('[deleteConversation] Starting conversation deletion', {
      conversationId,
      organizationId,
      deletedBy,
      reason,
      hardDelete: shouldHardDelete,
    });

    try {
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext) {
        currentContext.organizationId = organizationId;
        currentContext.conversationId = conversationId;
      }

      const existingConversation = await this.getConversation(
        conversationId,
        organizationId,
      );
      if (!existingConversation) {
        throw new NotFoundException(`Conversation ${conversationId} not found`);
      }

      let workflowTerminated = false;
      const workflowId = existingConversation.workflowId;

      if (
        workflowId &&
        !this.workflowTypeRegistryService.isNonTemporalBackedWorkflow(
          existingConversation.workflowName,
        )
      ) {
        try {
          const workflowHandle =
            this.temporalClient.workflow.getHandle(workflowId);
          await workflowHandle.terminate(reason || 'Conversation deleted');
          workflowTerminated = true;
          this.logger.log(
            '[deleteConversation] Successfully terminated workflow',
            {
              conversationId,
              workflowId,
              reason,
            },
          );
        } catch (error) {
          this.logger.warn(
            '[deleteConversation] Failed to terminate workflow',
            {
              conversationId,
              workflowId,
              error: (error as Error).message,
              reason,
            },
          );
        }
      } else if (workflowId) {
        this.logger.debug(
          '[deleteConversation] skipping workflow termination for non-Temporal conversation',
          {
            conversationId,
            workflowId,
            workflowName: existingConversation.workflowName,
          },
        );
      }

      await this.prisma.$transaction(async (tx) => {
        if (shouldHardDelete) {
          await tx.message.deleteMany({
            where: {
              conversationId,
            },
          });

          await tx.conversation.delete({
            where: {
              id: conversationId,
            },
          });
        } else {
          await tx.conversation.update({
            where: {
              id: conversationId,
            },
            data: {
              status: ConversationStatus.Deleted,
              lastModifiedBy: deletedBy,
              updatedAt: new Date(),
            },
          });
        }

        const payload: ConversationDeletedEventPayload = {
          payloadType: EVENT_TYPES.CONVERSATION.DELETED,
          organizationId,
          projectId: existingConversation.projectId,
          workflowId,
          workflowTerminated,
          deletedBy,
          reason,
          hardDelete: shouldHardDelete,
          timestamp: new Date().toISOString(),
        };
        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.CONVERSATION.DELETED,
          aggregateId: conversationId,
          payload,
        });
      });

      this.logger.log(
        '[deleteConversation] Conversation deleted successfully',
        {
          conversationId,
          workflowId,
          workflowTerminated,
          deletedBy,
          hardDelete: shouldHardDelete,
        },
      );

      return existingConversation;
    } catch (error) {
      this.logger.error('[deleteConversation] Failed to delete conversation', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        conversationId,
        organizationId,
        deletedBy,
      });

      if (error instanceof NotFoundException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Failed to delete conversation: ${(error as Error).message}`,
      );
    }
  }

  async restoreConversation(
    conversationId: ConversationId,
    organizationId: OrganizationId,
    restoredBy?: string,
  ): Promise<void> {
    this.logger.log('[restoreConversation] Restoring conversation', {
      conversationId,
      organizationId,
      restoredBy,
    });

    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = organizationId;
      currentContext.conversationId = conversationId;
    }

    const existingConversation = await this.prisma.db.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
      },
    });

    if (!existingConversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    if (existingConversation.status !== ConversationStatus.Deleted) {
      this.logger.debug(
        '[restoreConversation] Conversation not deleted, skipping restore',
        {
          conversationId,
          organizationId,
          status: existingConversation.status,
        },
      );
      return;
    }

    const restoredStatus = ConversationStatus.InProgress;

    await this.prisma.$transaction(async (tx) => {
      const timestamp = new Date();

      await tx.conversation.update({
        where: { id: conversationId },
        data: {
          status: restoredStatus,
          lastModifiedBy: restoredBy,
          updatedAt: timestamp,
        },
      });

      await this.publishConversationStatusChangedEvent(tx, {
        aggregateId: conversationId,
        organizationId,
        projectId: existingConversation.projectId,
        conversationId,
        previousStatus: existingConversation.status as ConversationStatus,
        newStatus: restoredStatus,
        restoredBy,
        timestamp,
      });
    });
  }

  async deleteConversationFromAdapter(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    callerUserId: UserId,
    reason?: string,
    hardDelete?: boolean,
  ): Promise<ConversationResponseDto> {
    // Validate conversation belongs to project
    const conversation = await this.getConversation(
      conversationId,
      organizationId,
    );
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    this.conversationValidation.validateConversationBelongsToProject(
      conversation,
      projectId,
    );

    if (
      !callerUserId ||
      !conversation.createdBy ||
      conversation.createdBy !== callerUserId
    ) {
      throw new ForbiddenException(
        'Only the conversation creator can archive it',
      );
    }

    if (typeof hardDelete === 'boolean') {
      return this.deleteConversation(
        conversationId,
        organizationId,
        callerUserId,
        reason,
        hardDelete,
      );
    }

    return this.deleteConversation(
      conversationId,
      organizationId,
      callerUserId,
      reason,
    );
  }

  /**
   * Clone a conversation up to a specific node
   * @param sourceConversationId - Source conversation to clone from
   * @param organizationId - Organization ID for security
   * @param dto - Clone configuration including target node and optional title
   * @param userId - User ID performing the clone
   * @returns Cloned conversation with metadata
   */
  async cloneConversation(
    sourceConversationId: ConversationId,
    organizationId: OrganizationId,
    dto: { targetNodeId: string; title?: string | null },
    userId: UserId,
    workflowName: WorkflowName,
  ): Promise<{
    conversation: ConversationResponseDto;
    cloneMetadata: {
      sourceConversationId: string;
      targetNodeId: string;
      messagesCloned: number;
      initiativesCloned: number;
      artifactsCloned: number;
    };
  }> {
    const { targetNodeId, title } = dto;

    this.logger.log('[cloneConversation] Starting conversation clone', {
      sourceConversationId,
      targetNodeId,
      organizationId,
      userId,
    });

    try {
      // 1. Fetch the source conversation to validate and get details
      const sourceConversation = await this.getConversation(
        sourceConversationId,
        organizationId,
      );

      if (!sourceConversation) {
        throw new NotFoundException(
          `Source conversation ${sourceConversationId} not found`,
        );
      }

      if (sourceConversation.status === ConversationStatus.Deleted) {
        throw new BadRequestException('Cannot clone a deleted conversation');
      }

      // 2. Create new conversation with workflow
      let newConversation: ConversationResponseDto;

      this.logger.log('[cloneConversation] Processing workflow type', {
        workflowName,
        sourceWorkflowName: sourceConversation.workflowName,
      });

      switch (workflowName) {
        case WorkflowName.Onboarding: {
          this.logger.log('[cloneConversation] Entering ONBOARDING branch');
          // For onboarding workflows, create new project (which creates workflow automatically)
          const newProject = await this.projectService.create(
            {
              name: `${title || sourceConversation.title || 'Project'} (Clone)`,
              organizationId,
              description: `Cloned from conversation ${sourceConversationId}`,
            },
            userId,
          );

          // Wait for the conversation created by the project workflow
          const projectConversations = await this.waitForProjectConversation(
            newProject.id,
            organizationId,
          );

          if (projectConversations.data.length === 0) {
            throw new InternalServerErrorException(
              'Failed to create project conversation after waiting',
            );
          }

          if (!projectConversations.data[0]) {
            throw new Error('Could not create onboarding conversation');
          }
          newConversation = projectConversations.data[0];

          this.logger.log(
            '[cloneConversation] ONBOARDING: newConversation created',
            {
              newConversationId: newConversation?.id,
            },
          );
          break;
        }

        case WorkflowName.InitiativeRefinement:
        case WorkflowName.TaskRefinement:
        case WorkflowName.TaskGeneration: {
          this.logger.log(
            '[cloneConversation] Entering refinement workflow branch',
            {
              workflowName,
            },
          );

          // Create conversation first
          const clonedTitle =
            title || `${sourceConversation.title || 'Conversation'} (Clone)`;
          const result =
            workflowName === WorkflowName.TaskGeneration
              ? await this.createConversation(
                  {
                    projectId: sourceConversation.projectId,
                    organizationId,
                    initiatedBy: InitiationType.User,
                    triggerEvent: 'cloned',
                    title: clonedTitle,
                    workflowName: 'task-generation',
                    status: ConversationStatus.Started,
                    workflowAboutId: sourceConversation.workflowAboutId,
                    workflowAboutType: sourceConversation.workflowAboutType,
                    context: {
                      aboutId: (() => {
                        if (!sourceConversation.workflowAboutId) {
                          throw new BadRequestException(
                            'Task generation clones require workflowAboutId for context.aboutId',
                          );
                        }
                        return sourceConversation.workflowAboutId;
                      })(),
                      aboutType:
                        sourceConversation.workflowAboutType === 'task'
                          ? 'task'
                          : 'initiative',
                    },
                  },
                  organizationId,
                  { createdBy: userId },
                )
              : await this.createConversation(
                  {
                    projectId: sourceConversation.projectId,
                    organizationId,
                    initiatedBy: InitiationType.User,
                    triggerEvent: 'cloned',
                    title: clonedTitle,
                    workflowName:
                      workflowName === WorkflowName.InitiativeRefinement
                        ? 'initiative-refinement'
                        : 'task-refinement',
                    status: ConversationStatus.Started,
                    workflowAboutId: sourceConversation.workflowAboutId,
                    workflowAboutType: sourceConversation.workflowAboutType,
                    context: {},
                  },
                  organizationId,
                  { createdBy: userId },
                );

          if (!result) {
            throw new Error(`Could not create ${workflowName} conversation`);
          }

          newConversation = result;

          // Start workflow using WorkflowTypeRegistryService
          const workflowResult =
            await this.workflowTypeRegistryService.startWorkflowByType(
              workflowName,
              newConversation.id,
              sourceConversation.projectId,
              organizationId,
              userId,
              newConversation.title,
              sourceConversation.workflowAboutType as WorkflowAboutType,
              sourceConversation.workflowAboutId as string,
            );

          // Update conversation with workflow ID
          const updateResult = await this.updateConversationWorkflowId(
            newConversation.id,
            workflowResult.workflowId,
            organizationId,
          );

          if (!updateResult) {
            throw new Error(`Could not create ${workflowName} conversation`);
          }

          newConversation = updateResult;

          this.logger.log(
            '[cloneConversation] Refinement workflow: newConversation created',
            {
              newConversationId: newConversation.id,
              workflowId: workflowResult.workflowId,
            },
          );
          break;
        }

        default:
          throw new BadRequestException(
            `Cloning is not yet supported for workflow type: ${workflowName}`,
          );
      }

      // 3. Check for existing opener message in target conversation
      const existingMessages = await this.messageService.getMessages(
        { conversationId: newConversation.id, type: 'SYSTEM' },
        organizationId,
        false,
      );

      const opener = existingMessages?.[0];

      // 4. Clone messages up to the target node with opener handling
      this.logger.log('[cloneConversation] About to clone messages', {
        newConversationId: newConversation?.id,
        newConversationExists: !!newConversation,
        hasExistingOpener: !!opener,
      });

      const { messagesCloned, nodeIds } =
        await this.messageService.cloneMessagesForConversationWithOpenerHandling(
          sourceConversationId,
          newConversation.id,
          targetNodeId,
          organizationId,
          opener ? opener.id : null,
        );

      // 3.1. Clone artifacts based on nodeIds from cloned messages
      let artifactsCloned = 0;
      if (nodeIds.length > 0) {
        try {
          // Find artifacts from source conversation that have nodeIds in the cloned list
          const sourceArtifacts = await this.artifactService.findByNodeIds(
            nodeIds,
            sourceConversationId,
            organizationId,
          );

          if (sourceArtifacts.length > 0) {
            // Create cloned artifacts with new conversationId
            const clonedArtifactDtos = sourceArtifacts.map((artifact) => ({
              projectId: newConversation.projectId,
              organizationId,
              type: artifact.type,
              title: artifact.title,
              data: artifact.data,
              parentId: artifact.parentId,
              sourceType: ArtifactSourceType.Conversation,
              sourceId: newConversation.id, // Update to new conversation ID
              tags: artifact.tags,
              category: artifact.category,
              priority: artifact.priority,
              status: artifact.status,
              isPublic: artifact.isPublic,
              generateEmbedding: false, // Skip embedding generation for cloned artifacts
            }));

            artifactsCloned = await this.artifactService.createMany(
              clonedArtifactDtos,
              {
                workflowId: newConversation.workflowId,
              },
            );

            this.logger.log(
              '[cloneConversation] Artifacts cloned successfully',
              {
                sourceConversationId,
                newConversationId: newConversation.id,
                artifactsCloned,
                nodeIds,
              },
            );
          }
        } catch (error) {
          this.logger.error('[cloneConversation] Failed to clone artifacts', {
            error: (error as Error).message,
            sourceConversationId,
            newConversationId: newConversation.id,
            nodeIds,
          });
          // Continue even if artifact cloning fails
        }
      }

      // 4. Use skipToNode to position workflow at target node
      if (newConversation.workflowId) {
        try {
          // Get workflow handle
          const workflowHandle = this.temporalClient.workflow.getHandle(
            newConversation.workflowId as string,
          );

          // Send skipToNode signal to position workflow after target node
          // systemMessageComplete: true indicates the target node has already been executed (cloned messages)
          await WorkflowSignalHelper.sendSkipToNode(
            workflowHandle,
            newConversation.workflowId,
            targetNodeId,
            true, // systemMessageComplete - node already executed, wait for user input
          );

          this.logger.log(
            '[cloneConversation] Workflow positioned at target node',
            {
              conversationId: newConversation.id,
              workflowId: newConversation.workflowId,
              targetNodeId,
            },
          );
        } catch (error) {
          this.logger.error('[cloneConversation] Failed to position workflow', {
            error: (error as Error).message,
            conversationId: newConversation.id,
            workflowId: newConversation.workflowId,
          });
          // Continue even if workflow positioning fails
        }
      }

      // 5. Publish clone event
      if (
        workflowName === WorkflowName.TaskGeneration &&
        !newConversation.workflowAboutId
      ) {
        throw new BadRequestException(
          'Task generation clone event requires workflowAboutId',
        );
      }

      await this.publishConversationCreatedEvent({
        aggregateId: newConversation.id,
        organizationId: newConversation.organizationId,
        projectId: newConversation.projectId,
        workflowId: newConversation.workflowId,
        ...(newConversation.workflowAboutId
          ? { workflowAboutId: newConversation.workflowAboutId }
          : {}),
        ...(newConversation.workflowAboutType
          ? { workflowAboutType: newConversation.workflowAboutType }
          : {}),
        workflowName: newConversation.workflowName as WorkflowName,
        ...(newConversation.title
          ? { conversationTitle: newConversation.title }
          : {}),
        initiatedBy: newConversation.initiatedBy as InitiationType,
        status: newConversation.status as ConversationStatus,
        version: 1,
      });

      this.logger.log('[cloneConversation] Conversation cloned successfully', {
        sourceConversationId,
        newConversationId: newConversation.id,
        targetNodeId,
        messagesCloned,
        artifactsCloned,
      });

      return {
        conversation: newConversation,
        cloneMetadata: {
          sourceConversationId,
          targetNodeId,
          messagesCloned,
          initiativesCloned: 0,
          artifactsCloned,
        },
      };
    } catch (error) {
      this.logger.error('[cloneConversation] Failed to clone conversation', {
        error: (error as Error).message,
        stack: (error as Error).stack,
        sourceConversationId,
        targetNodeId,
        organizationId,
      });

      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      throw new InternalServerErrorException('Failed to clone conversation');
    }
  }

  /**
   * Wait for conversation to be created by project workflow with retry logic
   */
  private async waitForProjectConversation(
    projectId: ProjectId,
    organizationId: OrganizationId,
  ): Promise<{
    data: ConversationResponseDto[];
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const maxAttempts = 20; // Increased from 10 for workflow startup
    const delayMs = 500;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.logger.debug(
          '[waitForProjectConversation] Polling for conversation',
          {
            projectId,
            attempt,
            maxAttempts,
          },
        );

        const projectConversations = await this.getConversationsByProject(
          projectId,
          organizationId,
          { limit: 1 },
        );

        const conversation = projectConversations.data[0];
        const messageCount = conversation
          ? await this.prisma.db.message.count({
              where: { conversationId: conversation.id },
            })
          : 0;

        if (conversation && messageCount > 0) {
          this.logger.log('[waitForProjectConversation] Found conversation', {
            projectId,
            attempt,
            conversationId: conversation.id,
          });
          return projectConversations;
        }

        // Wait before next attempt
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (error) {
        this.logger.warn(
          '[waitForProjectConversation] Error polling for conversation',
          {
            projectId,
            attempt,
            error: (error as Error).message,
          },
        );

        // Wait before retry even on error
        if (attempt < maxAttempts) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      }
    }

    this.logger.error(
      '[waitForProjectConversation] Failed to find conversation after polling',
      {
        projectId,
        maxAttempts,
        totalWaitTime: maxAttempts * delayMs,
      },
    );

    // Return empty result to let caller handle the failure
    return {
      data: [],
      pagination: {
        page: 1,
        limit: 1,
        total: 0,
        totalPages: 0,
      },
    };
  }
}

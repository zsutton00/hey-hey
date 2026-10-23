import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import {
  Artifact,
  Prisma,
  ArtifactStatus as PrismaArtifactStatus,
  ArtifactType as PrismaArtifactType,
  Priority as PrismaPriority,
  EntityType,
} from '@prisma/client';
import * as crypto from 'crypto';
import { ArtifactDataService } from './artifact-data.service';
import { ArtifactDataValidators } from './artifact-data.validators';
import { ArtifactGraphService } from './artifact-graph.service';
import {
  CreateInfluenceDto,
  InfluenceService,
} from '../influence/influence.service';
import {
  ArtifactResponseDto,
  CreateArtifactDto,
  ArtifactData,
  PaginatedArtifactsDto,
  QueryArtifactsDto,
  SemanticSearchDto,
  SemanticSearchResponseDto,
  UpdateArtifactDto,
  ArtifactSourceType,
  ArtifactType,
} from '../../generated';
import {
  ArtifactId,
  ConversationId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../../types';
import { ensureStringDate } from '../../utils/date.util';
import { sanitizeArtifactTitle } from '../../utils/sanitization.util';
import {
  EventContextManager,
  WithWorkflowContext,
} from '../../core/events/observable-event.context';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import { PrismaService } from '../../prisma/prisma.service';
import { TagService } from '../tag.service';
import { TagSource as PrismaTagSource } from '@prisma/client';
import { InputJsonValue } from '@prisma/client/runtime/library';
import { ContextAwareLogger } from '../../core/logging/context-aware-logger.service';
import { EntityRegistryService } from '../entity-registry/entity-registry.service';

@Injectable()
export class ArtifactService {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(ArtifactService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
    private readonly tagService: TagService,
    private readonly dataService: ArtifactDataService,
    private readonly validators: ArtifactDataValidators,
    private readonly referenceService: ArtifactGraphService,
    private readonly influenceService: InfluenceService,
    private readonly entityRegistryService: EntityRegistryService,
  ) {}

  /**
   * Create artifact with typed data support
   * Only supports typed data format
   */
  @WithWorkflowContext((...args) => {
    const [createDto, source] = args as [
      CreateArtifactDto,
      { nodeId?: string; workflowId?: WorkflowId },
    ];
    return {
      sourceService: 'ArtifactService',
      sourceMethod: 'create',
      context: {
        organizationId: createDto.organizationId,
        projectId: createDto.projectId,
        nodeId: source.nodeId,
        workflowId: source.workflowId,
      },
      metadata: {
        operationType: `create_${createDto.data?.type || createDto.type}`,
      },
    };
  })
  async create(
    createDto: CreateArtifactDto,
    source: { nodeId?: string; workflowId?: WorkflowId } = {},
  ): Promise<ArtifactResponseDto> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    const correlationId = currentContext?.correlationId;

    this.logger.log('[createTyped] Creating typed artifact', {
      artifactType: createDto.data?.type || createDto.type,
      projectId: createDto.projectId,
      organizationId: createDto.organizationId,
      hasData: !!createDto.data,
      correlationId,
    });

    try {
      if (!createDto.data) {
        throw new Error('Typed data is required');
      }

      // Process typed data format - type narrowed after null check above
      const typedData = createDto.data;
      this.logger.debug('[createTyped] Processing typed data format', {
        dataType: typedData.type,
        dataKeys: Object.keys(typedData),
        correlationId,
      });

      // Validate the typed data
      this.validators.validateArtifactData(typedData, correlationId);

      // Sanitize the data
      const artifactData = this.dataService.sanitizeArtifactData(
        typedData,
        correlationId,
      );

      this.logger.debug(
        '[createTyped] Typed data validation and processing completed',
        {
          dataType: artifactData.type,
          hasReferences: this.validators.hasReferentialData(artifactData),
          correlationId,
        },
      );

      // Create artifact directly in database
      const result = await this.createInDatabase(createDto, source);

      this.logger.log('[createTyped] Typed artifact created successfully', {
        artifactId: result.id,
        artifactType: result.type,
        correlationId,
      });

      return result;
    } catch (error) {
      this.logger.error('[createTyped] Failed to create typed artifact', {
        error: error instanceof Error ? error.message : error,
        artifactType: createDto.data?.type || createDto.type,
        correlationId,
      });
      throw error;
    }
  }

  /**
   * Create multiple artifacts with typed data support in batch
   * Only supports typed data format
   */
  @WithWorkflowContext((...args) => {
    const [createDtos] = args as [CreateArtifactDto[]];
    const firstDto = createDtos[0];
    return {
      sourceService: 'ArtifactService',
      sourceMethod: 'createMany',
      context: {
        organizationId: firstDto?.organizationId,
        projectId: firstDto?.projectId,
      },
      metadata: {
        operationType: `createMany_${createDtos.length}_artifacts`,
      },
    };
  })
  async createMany(
    createDtos: CreateArtifactDto[],
    _source: { nodeId?: string; workflowId?: WorkflowId } = {},
  ): Promise<number> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    const correlationId = currentContext?.correlationId;

    this.logger.log('[createMany] Creating typed artifacts batch', {
      count: createDtos.length,
      organizationId: createDtos[0]?.organizationId,
      correlationId,
    });

    if (createDtos.length === 0) {
      return 0;
    }

    const processedDtos: CreateArtifactDto[] = [];

    try {
      // Process each DTO to validate and prepare for batch creation
      for (const createDto of createDtos) {
        if (!createDto.data) {
          throw new Error('Typed data is required');
        }

        // Validate the typed data - type narrowed after null check above
        const typedData = createDto.data;
        this.validators.validateArtifactData(typedData, correlationId);

        // Sanitize the data
        const artifactData = this.dataService.sanitizeArtifactData(
          typedData,
          correlationId,
        );

        processedDtos.push({ ...createDto, data: artifactData });
      }

      // Use direct database batch creation
      const createdCount = await this.createManyInDatabase(processedDtos);

      this.logger.log(
        '[createMany] Typed artifacts batch created successfully',
        {
          createdCount,
          requestedCount: createDtos.length,
          correlationId,
        },
      );

      // Return the count of successfully created artifacts
      return createdCount;
    } catch (error) {
      this.logger.error('[createMany] Failed to create typed artifacts batch', {
        error: error instanceof Error ? error.message : error,
        count: createDtos.length,
        correlationId,
      });
      throw error;
    }
  }

  async archiveBySource({
    organizationId,
    sourceType,
    sourceIds,
  }: {
    organizationId: OrganizationId;
    sourceType: ArtifactSourceType;
    sourceIds: ConversationId[];
  }): Promise<number> {
    if (!sourceIds.length) {
      return 0;
    }

    const archivedAt = new Date();
    let updatedCount = 0;

    await this.prisma.$transaction(async (tx) => {
      const artifactsToArchive = await tx.artifact.findMany({
        where: {
          organizationId,
          sourceType,
          sourceId: { in: sourceIds },
          status: { not: PrismaArtifactStatus.ARCHIVED },
        },
        select: {
          id: true,
          projectId: true,
          sourceId: true,
        },
      });

      if (!artifactsToArchive.length) {
        return;
      }

      const artifactIds = artifactsToArchive.map((artifact) => artifact.id);

      const result = await tx.artifact.updateMany({
        where: {
          organizationId,
          sourceType,
          sourceId: { in: sourceIds },
          id: { in: artifactIds },
          status: { not: PrismaArtifactStatus.ARCHIVED },
        },
        data: {
          status: PrismaArtifactStatus.ARCHIVED,
          archivedAt,
        },
      });

      updatedCount = result.count;

      for (const artifact of artifactsToArchive) {
        const projectId = artifact.projectId as ProjectId;

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.ARTIFACT.ARCHIVED,
          aggregateId: artifact.id as ArtifactId,
          payload: {
            payloadType: EVENT_TYPES.ARTIFACT.ARCHIVED,
            organizationId,
            projectId,
            artifactId: artifact.id as ArtifactId,
            sourceType,
            sourceId: artifact.sourceId,
            archivedAt: archivedAt.toISOString(),
            timestamp: archivedAt.toISOString(),
          },
        });
      }
    });

    return updatedCount;
  }

  async restoreArchivedBySource({
    organizationId,
    sourceType,
    sourceIds,
  }: {
    organizationId: OrganizationId;
    sourceType: ArtifactSourceType;
    sourceIds: ConversationId[];
  }): Promise<number> {
    if (!sourceIds.length) {
      return 0;
    }

    const restoredAt = new Date();
    let restoredCount = 0;

    await this.prisma.$transaction(async (tx) => {
      const artifactsToRestore = await tx.artifact.findMany({
        where: {
          organizationId,
          sourceType,
          sourceId: { in: sourceIds },
          status: PrismaArtifactStatus.ARCHIVED,
        },
        select: {
          id: true,
          projectId: true,
          sourceId: true,
        },
      });

      if (!artifactsToRestore.length) {
        return;
      }

      const artifactIds = artifactsToRestore.map((artifact) => artifact.id);

      const result = await tx.artifact.updateMany({
        where: {
          organizationId,
          sourceType,
          sourceId: { in: sourceIds },
          id: { in: artifactIds },
          status: PrismaArtifactStatus.ARCHIVED,
        },
        data: {
          status: PrismaArtifactStatus.ACTIVE,
          archivedAt: null,
        },
      });

      restoredCount = result.count;

      for (const artifact of artifactsToRestore) {
        const projectId = artifact.projectId as ProjectId;

        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.ARTIFACT.RESTORED,
          aggregateId: artifact.id as ArtifactId,
          payload: {
            payloadType: EVENT_TYPES.ARTIFACT.RESTORED,
            organizationId,
            projectId,
            artifactId: artifact.id as ArtifactId,
            sourceType,
            sourceId: artifact.sourceId,
            restoredAt: restoredAt.toISOString(),
            timestamp: restoredAt.toISOString(),
          },
        });
      }
    });

    return restoredCount;
  }

  /**
   * Resolve all references in artifact data
   * Fetches related messages, artifacts, and other referenced entities
   */
  @WithWorkflowContext((...args) => {
    const [artifactData, organizationId] = args as [
      ArtifactData,
      OrganizationId,
    ];
    return {
      sourceService: 'ArtifactService',
      sourceMethod: 'resolveReferences',
      context: {
        organizationId,
      },
      metadata: {
        operationType: `resolveReferences_${artifactData.type}`,
      },
    };
  })
  async resolveReferences(
    artifactData: ArtifactData,
    organizationId: OrganizationId,
  ): Promise<{
    data: ArtifactData;
    resolvedReferences: Awaited<
      ReturnType<ArtifactGraphService['resolveAllReferences']>
    >;
  }> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    const correlationId = currentContext?.correlationId;

    this.logger.debug('[resolveReferences] Resolving artifact references', {
      dataType: artifactData.type,
      correlationId,
    });

    const resolvedReferences = await this.referenceService.resolveAllReferences(
      artifactData,
      organizationId,
      correlationId,
    );

    this.logger.debug('[resolveReferences] References resolved', {
      dataType: artifactData.type,
      messageCount: resolvedReferences.messages.length,
      artifactCount: resolvedReferences.artifacts.length,
      hasQuestionContext: !!resolvedReferences.questionContext,
      correlationId,
    });

    return {
      data: artifactData,
      resolvedReferences,
    };
  }
  /**
   * Create artifact directly in database (moved from ArtifactService)
   */
  @WithWorkflowContext((...args) => {
    const [createDto, source] = args as [
      CreateArtifactDto,
      { nodeId?: string; workflowId?: WorkflowId },
    ];
    return {
      sourceService: 'ArtifactService',
      sourceMethod: 'createInDatabase',
      context: {
        organizationId: createDto.organizationId,
        projectId: createDto.projectId,
        nodeId: source.nodeId,
        workflowId: source.workflowId,
      },
      metadata: {
        operationType: `createInDatabase_${createDto.type}`,
      },
    };
  })
  private async createInDatabase(
    createDto: CreateArtifactDto,
    source: { nodeId?: string; workflowId?: WorkflowId } = {},
  ): Promise<ArtifactResponseDto> {
    try {
      // Set up event context with business data
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext) {
        currentContext.organizationId = createDto.organizationId;
        currentContext.projectId = createDto.projectId;
      }

      this.logger.log('Creating artifact with events', {
        type: createDto.type,
        title: createDto.title,
        projectId: createDto.projectId,
        organizationId: createDto.organizationId,
        correlationId: currentContext?.correlationId,
      });

      // Generate content hash for deduplication
      const contentHash = this.generateContentHash(createDto.data);

      // Sanitize title to prevent invalid names
      const sanitizedTitle = sanitizeArtifactTitle(createDto.title);

      // Create artifact and publish event in transaction
      this.logger.debug('[createInDatabase] starting transaction', {
        contentHash,
        createDto: {
          type: createDto.type,
          title: createDto.title,
          projectId: createDto.projectId,
          organizationId: createDto.organizationId,
        },
      });
      const artifact = await this.prisma.$transaction(async (tx) => {
        try {
          this.logger.debug('[createInDatabase] creating artifact in tx', {
            createDto: {
              type: createDto.type,
              title: createDto.title,
              projectId: createDto.projectId,
              organizationId: createDto.organizationId,
            },
          });
          // Create knowledge object in database
          const createdArtifact = await tx.artifact.create({
            data: {
              projectId: createDto.projectId,
              type: createDto.type as PrismaArtifactType,
              title: sanitizedTitle,
              data: createDto.data as unknown as InputJsonValue,
              organizationId: createDto.organizationId,
              parentId: createDto.parentId,
              rootId: createDto.parentId
                ? await this.findRootId(
                    createDto.parentId,
                    createDto.organizationId,
                  )
                : undefined,
              sourceType: createDto.sourceType,
              sourceId: createDto.sourceId,
              contentHash,
              tags: [] as string[], // Will be managed by TagService
              category: createDto.category,
              priority: createDto.priority as PrismaPriority,
              status: (createDto.status || 'ACTIVE') as PrismaArtifactStatus,
              isPublic: createDto.isPublic || false,
            },
            include: {
              project: true,
              parent: true,
              children: true,
            },
          });

          await this.entityRegistryService.registerEntity(
            {
              organizationId: createDto.organizationId,
              entityId: createdArtifact.id,
              entityType: EntityType.ARTIFACT,
              name: createdArtifact.title || 'Untitled Artifact',
            },
            tx,
          );

          // Create influences if provided (within same transaction)
          if (createDto.influences && createDto.influences.length > 0) {
            this.logger.debug('[createInDatabase] creating influences in tx', {
              influenceCount: createDto.influences.length,
              createdArtifactId: createdArtifact.id,
            });

            const influenceData = createDto.influences.map((influence) => ({
              influencedType: 'artifact' as const,
              influencedId: createdArtifact.id,
              influencingId: influence.entityId,
              reasoning: influence.reasoning,
              reasonType: influence.reasonType,
              confidence: influence.confidence,
              organizationId: createDto.organizationId,
            }));

            await this.influenceService.createMany(influenceData, tx);

            this.logger.debug('[createInDatabase] influences created', {
              influenceCount: influenceData.length,
              createdArtifactId: createdArtifact.id,
            });
          }

          // Publish domain event via outbox in same transaction
          await this.eventPublisher.publishInTransaction(tx, {
            type: EVENT_TYPES.ARTIFACT.CREATED,
            aggregateId: createdArtifact.id,
            payload: {
              payloadType: EVENT_TYPES.ARTIFACT.CREATED,
              artifact: createDto,
              organizationId: createdArtifact.organizationId as OrganizationId,
              projectId: createdArtifact.projectId as ProjectId,
              sourceType: createdArtifact.sourceType as ArtifactSourceType,
              sourceId: createdArtifact.sourceId,
            },
          });

          return createdArtifact;
        } catch (err) {
          this.logger.error(
            '[createInDatabase] error creating artifact in tx',
            err,
          );
          throw err;
        }
      });

      // Add tags using TagService if provided (after transaction)
      if (createDto.tags && createDto.tags.length > 0) {
        await this.tagService.addTagsToArtifact(
          artifact.id,
          createDto.organizationId,
          createDto.tags.map((name) => ({
            name,
            source: PrismaTagSource.USER,
          })),
        );
      }

      const result = this.toResponseDto(artifact);

      this.logger.log('Artifact created with events', {
        artifactId: artifact.id,
        type: artifact.type,
        correlationId: currentContext?.correlationId,
      });

      return result;
    } catch (error) {
      this.logger.error('Failed to create artifact', {
        error: (error as Error).message,
        createDto: {
          type: createDto.type,
          title: createDto.title,
          projectId: createDto.projectId,
        },
      });
      throw new BadRequestException(
        `Failed to create knowledge object: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Create multiple artifacts in batch (moved from ArtifactService)
   */
  @WithWorkflowContext((...args) => {
    const [createDtos] = args as [CreateArtifactDto[]];
    const firstDto = createDtos[0];
    return {
      sourceService: 'ArtifactService',
      sourceMethod: 'createManyInDatabase',
      context: {
        organizationId: firstDto?.organizationId,
        projectId: firstDto?.projectId,
      },
      metadata: {
        operationType: `createManyInDatabase_${createDtos.length}_artifacts`,
      },
    };
  })
  private async createManyInDatabase(
    createDtos: CreateArtifactDto[],
  ): Promise<number> {
    if (createDtos.length === 0) {
      return 0;
    }

    try {
      // Gather unique parentIds so we can fetch all in one query
      const parentIds = Array.from(
        new Set(
          createDtos
            .map((dto) => dto.parentId)
            .filter((id): id is string => Boolean(id)),
        ),
      );

      // Fetch rootIds for all parentIds in a single query
      const rootIdMap: Record<string, string> = {};
      if (parentIds.length > 0) {
        const firstOrgId = createDtos[0]?.organizationId;
        const parents = await this.prisma.db.artifact.findMany({
          where: {
            id: { in: parentIds },
            organizationId: firstOrgId,
          },
          select: { id: true, rootId: true },
        });
        for (const parent of parents) {
          rootIdMap[parent.id] = parent.rootId || parent.id;
        }
      }

      // Set up event context with business data from first DTO
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      if (currentContext && createDtos[0]) {
        currentContext.organizationId = createDtos[0].organizationId;
        currentContext.projectId = createDtos[0].projectId;
      }

      this.logger.log('Creating artifacts batch with events', {
        count: createDtos.length,
        projectId: createDtos[0]?.projectId,
        organizationId: createDtos[0]?.organizationId,
        correlationId: currentContext?.correlationId,
      });

      // Prepare artifact data for batch creation
      const artifactDataList = createDtos.map((createDto) => ({
        projectId: createDto.projectId,
        id: uuidv4(),
        type: createDto.type as PrismaArtifactType,
        title: sanitizeArtifactTitle(createDto.title),
        data: createDto.data as unknown as InputJsonValue,
        organizationId: createDto.organizationId,
        parentId: createDto.parentId,
        rootId: createDto.parentId
          ? rootIdMap[createDto.parentId] || createDto.parentId
          : undefined,
        sourceType: createDto.sourceType,
        sourceId: createDto.sourceId,
        contentHash: this.generateContentHash(createDto.data),
        tags: [] as string[], // Will be managed by TagService
        category: createDto.category,
        priority: createDto.priority as PrismaPriority,
        status: (createDto.status || 'ACTIVE') as PrismaArtifactStatus,
        isPublic: createDto.isPublic || false,
      }));

      // Create artifacts in database using transaction for consistency
      this.logger.debug('[createManyInDatabase] starting batch transaction', {
        artifactDataCount: artifactDataList.length,
        projectId: createDtos[0]?.projectId,
        organizationId: createDtos[0]?.organizationId,
      });
      const batchResult = await this.prisma.$transaction(async (tx) => {
        try {
          this.logger.debug(
            '[createManyInDatabase] creating artifacts batch in tx',
            {
              count: artifactDataList.length,
            },
          );
          const createdArtifacts = await tx.artifact.createMany({
            data: artifactDataList,
          });

          await this.entityRegistryService.registerEntities(
            artifactDataList.map((artifact) => ({
              organizationId: artifact.organizationId,
              entityId: artifact.id,
              entityType: EntityType.ARTIFACT,
              name: artifact.title || 'Untitled Artifact',
            })),
            tx,
          );

          // Create influences for all artifacts that have them (within same transaction)
          const allInfluenceData: CreateInfluenceDto[] = [];

          for (const [i, createDto] of createDtos.entries()) {
            const artifactData = artifactDataList[i];
            if (!artifactData) {
              throw new Error(
                `[createManyInDatabase] Missing artifact data at index ${i}`,
              );
            }

            if (createDto.influences && createDto.influences.length > 0) {
              const influenceData = createDto.influences.map((influence) => ({
                influencedType: 'artifact' as const,
                influencedId: artifactData.id,
                influencingId: influence.entityId,
                reasoning: influence.reasoning,
                reasonType: influence.reasonType,
                confidence: influence.confidence,
                organizationId: createDto.organizationId,
              }));

              allInfluenceData.push(...influenceData);
            }
          }

          // Create all influences in batch if any exist
          if (allInfluenceData.length > 0) {
            this.logger.debug(
              '[createManyInDatabase] creating influences batch in tx',
              {
                influenceCount: allInfluenceData.length,
                artifactCount: artifactDataList.length,
                influenceData: allInfluenceData.map((inf) => ({
                  influencedType: inf.influencedType,
                  influencedId: inf.influencedId,
                  influencingId: inf.influencingId,
                  reasonType: inf.reasonType,
                })),
              },
            );

            await this.influenceService.createMany(allInfluenceData, tx);

            this.logger.debug(
              '[createManyInDatabase] influences batch created',
              {
                influenceCount: allInfluenceData.length,
              },
            );
          }

          for (const createdArtifact of artifactDataList) {
            await this.eventPublisher.publishInTransaction(tx, {
              type: EVENT_TYPES.ARTIFACT.CREATED,
              aggregateId: createdArtifact.id,
              payload: {
                payloadType: EVENT_TYPES.ARTIFACT.CREATED,
                artifact: {
                  ...createdArtifact,
                  type: createdArtifact.type as ArtifactType,
                  data: createdArtifact.data as unknown as ArtifactData,
                },
                organizationId: createdArtifact.organizationId,
                projectId: createdArtifact.projectId as ProjectId,
                sourceType: createdArtifact.sourceType,
                sourceId: createdArtifact.sourceId,
              },
            });
          }

          return createdArtifacts;
        } catch (err) {
          this.logger.error(
            '[createManyInDatabase] error creating artifacts batch in tx',
            err,
          );
          throw err;
        }
      });

      // Add tags using TagService for each created artifact
      for (const [i, originalDto] of createDtos.entries()) {
        const artifactData = artifactDataList[i];
        if (!artifactData) {
          throw new Error(
            `[createManyInDatabase] Missing artifact data at index ${i}`,
          );
        }

        if (originalDto.tags && originalDto.tags.length > 0) {
          await this.tagService.addTagsToArtifact(
            artifactData.id,
            artifactData.organizationId,
            originalDto.tags.map((name) => ({
              name,
              source: PrismaTagSource.USER,
            })),
          );
        }
      }

      return batchResult.count;
    } catch (error) {
      this.logger.error('Failed to create artifacts batch', {
        error: (error as Error).message,
        count: createDtos.length,
        projectId: createDtos[0]?.projectId,
      });
      throw new BadRequestException(
        `Failed to create knowledge objects batch: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Find knowledge objects with filtering and pagination (moved from ArtifactService)
   */
  async findMany(
    queryDto: QueryArtifactsDto,
    organizationId: OrganizationId,
    accessibleProjectIds?: string[],
  ): Promise<PaginatedArtifactsDto> {
    try {
      const where: Prisma.ArtifactWhereInput = {
        // CRITICAL: Always filter by organization ID to prevent cross-org access
        organizationId,
        ...(accessibleProjectIds
          ? { AND: [{ projectId: { in: accessibleProjectIds } }] }
          : {}),
      };

      // Apply filters
      if (queryDto.ids) where.id = { in: queryDto.ids };
      if (queryDto.projectId) where.projectId = queryDto.projectId;
      if (queryDto.type) where.type = queryDto.type as PrismaArtifactType;
      if (queryDto.status)
        where.status = queryDto.status as PrismaArtifactStatus;
      if (queryDto.sourceType) where.sourceType = queryDto.sourceType;
      if (queryDto.sourceId) where.sourceId = queryDto.sourceId;
      if (queryDto.category) where.category = queryDto.category;
      if (queryDto.parentId) where.parentId = queryDto.parentId;
      if (queryDto.publicOnly) where.isPublic = true;
      if (queryDto.tags && queryDto.tags.length > 0) {
        where.tags = { hasSome: queryDto.tags.split(',') };
      }

      // Only show active by default
      if (!queryDto.status) {
        where.status = 'ACTIVE';
      }

      const orderField = queryDto.orderBy ?? 'createdAt';
      const orderBy: Prisma.ArtifactOrderByWithRelationInput = {
        [orderField]: queryDto.orderDirection || 'desc',
      };

      const skip =
        ((Number(queryDto.page) || 1) - 1) * (Number(queryDto.limit) || 20);
      const take = Number(queryDto.limit) || 20;

      this.logger.debug('[findMany] fetching artifacts and count', {
        where,
        orderBy,
        skip,
        take,
      });
      const [artifacts, total] = await Promise.all([
        this.prisma.db.artifact.findMany({
          where,
          orderBy,
          skip,
          take,
          include: {
            project: true,
            parent: true,
            children: true,
          },
        }),
        this.prisma.db.artifact.count({ where }),
      ]);

      const totalPages = Math.ceil(total / take);
      const currentPage = queryDto.page || 1;

      return {
        data: artifacts.map((ko) => this.toResponseDto(ko)),
        total,
        page: currentPage,
        limit: take,
        totalPages,
        hasNext: currentPage < totalPages,
        hasPrev: currentPage > 1,
      };
    } catch (error) {
      this.logger.error(
        `Failed to query knowledge objects: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new BadRequestException(
        `Failed to query knowledge objects: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Find a knowledge object by ID (moved from ArtifactService)
   */
  async findOne(
    id: string,
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto> {
    try {
      this.logger.debug('[findOne] fetching artifact', {
        id,
        organizationId,
      });
      const artifact = await this.prisma.db.artifact.findFirst({
        where: {
          id,
          // CRITICAL: Always filter by organization ID to prevent cross-org access
          organizationId,
        },
        include: {
          project: true,
          parent: true,
          children: true,
          relatedTo: {
            include: {
              target: {
                select: { id: true, title: true, type: true, tags: true },
              },
            },
          },
          relatedFrom: {
            include: {
              source: {
                select: { id: true, title: true, type: true, tags: true },
              },
            },
          },
        },
      });

      if (!artifact) {
        throw new NotFoundException(`Artifact with ID ${id} not found`);
      }

      return this.toResponseDto(artifact);
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.error(
        `[findOne] Failed to find knowledge object ${id}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw new BadRequestException(
        `Failed to find knowledge object: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Find artifacts that influenced an initiative or specific artifact
   */
  async findInfluences(
    params: {
      sourceId: string;
      reasonType?: string;
      sourceType?: ArtifactSourceType;
    },
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto[]> {
    const { sourceId, sourceType, reasonType } = params;

    try {
      this.logger.debug('[findInfluences] Resolving influences', {
        sourceId,
        organizationId,
        sourceType,
        reasonType,
      });

      // First find artifacts with this sourceId/sourceType
      const artifactsWithSource = await this.prisma.db.artifact.findMany({
        where: {
          organizationId,
          sourceId,
          ...(sourceType ? { sourceType } : {}),
        },
        select: { id: true },
      });

      const artifactIds = artifactsWithSource.map((a) => a.id);

      if (artifactIds.length === 0) {
        this.logger.debug('[findInfluences] No artifacts found with sourceId', {
          sourceId,
          sourceType,
        });
        return [];
      }

      // Find influences where these artifacts are influenced
      const influenceWhere: Prisma.InfluenceWhereInput = {
        organizationId,
        influencedId: { in: artifactIds },
        influencedType: 'artifact',
        influencingType: 'artifact', // Only return artifact influences
        ...(reasonType ? { reasonType } : {}),
      };

      const influences = await this.prisma.db.influence.findMany({
        where: influenceWhere,
        orderBy: {
          createdAt: 'desc',
        },
      });

      // Fetch the influencing artifacts
      const influencingArtifactIds = [
        ...new Set(influences.map((inf) => inf.influencingId)),
      ];

      if (influencingArtifactIds.length === 0) {
        this.logger.debug('[findInfluences] No influencing artifacts found', {
          sourceId,
          artifactCount: artifactIds.length,
        });
        return [];
      }

      const influencingArtifacts = await this.prisma.db.artifact.findMany({
        where: {
          id: { in: influencingArtifactIds },
          organizationId,
        },
      });

      const artifactMap = new Map<string, ArtifactResponseDto>();
      for (const artifact of influencingArtifacts) {
        const artifactDto = this.toResponseDto(artifact);
        if (!artifactMap.has(artifactDto.id)) {
          artifactMap.set(artifactDto.id, artifactDto);
        }
      }

      this.logger.debug('[findInfluences] Influences resolved', {
        sourceId,
        organizationId,
        influenceCount: influences.length,
        uniqueArtifactCount: artifactMap.size,
      });

      return Array.from(artifactMap.values());
    } catch (error) {
      this.logger.error('[findInfluences] Failed to find artifact influences', {
        sourceId,
        organizationId,
        error: (error as Error).message,
      });
      throw new BadRequestException(
        `Failed to find artifact influences: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Find artifacts by nodeIds for conversation cloning
   */
  async findByNodeIds(
    nodeIds: string[],
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto[]> {
    try {
      this.logger.debug('[findByNodeIds] fetching artifacts', {
        nodeIds,
        conversationId,
        organizationId,
        nodeCount: nodeIds.length,
      });

      if (nodeIds.length === 0) {
        return [];
      }

      const artifacts = await this.prisma.db.artifact.findMany({
        where: {
          // CRITICAL: Always filter by organization ID to prevent cross-org access
          organizationId,
          sourceId: conversationId,
          OR: nodeIds.map((nodeId) => ({
            data: {
              path: ['nodeId'],
              equals: nodeId,
            },
          })),
        },
        include: {
          project: true,
          parent: true,
          children: true,
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      this.logger.debug('[findByNodeIds] found artifacts', {
        foundCount: artifacts.length,
        requestedNodeIds: nodeIds,
        conversationId,
        organizationId,
      });

      return artifacts.map((artifact) => this.toResponseDto(artifact));
    } catch (error) {
      this.logger.error(
        `[findByNodeIds] Failed to find artifacts for nodeIds: ${(error as Error).message}`,
        {
          error: (error as Error).stack,
          nodeIds,
          conversationId,
          organizationId,
        },
      );
      throw new BadRequestException(
        `Failed to find artifacts for nodeIds: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Update a knowledge object (moved from ArtifactService)
   */
  @WithWorkflowContext((...args) => {
    const [id, updateDto, organizationId] = args as [
      string,
      UpdateArtifactDto,
      OrganizationId,
    ];
    return {
      sourceService: 'ArtifactService',
      sourceMethod: 'update',
      context: {
        organizationId,
      },
      metadata: {
        operationType: 'updateArtifact',
      },
    };
  })
  async update(
    id: string,
    updateDto: UpdateArtifactDto,
    organizationId: OrganizationId,
  ): Promise<ArtifactResponseDto> {
    try {
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      this.logger.log('[update] Updating artifact with events', {
        artifactId: id,
        organizationId,
        correlationId: currentContext?.correlationId,
      });

      // Check if artifact exists and belongs to the organization
      this.logger.debug('[update] checking artifact exists', {
        id,
        organizationId,
      });
      const existingArtifact = await this.prisma.db.artifact.findFirst({
        where: {
          id,
          // CRITICAL: Always filter by organization ID to prevent cross-org access
          organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          projectId: true,
          sourceType: true,
          sourceId: true,
          project: true,
        },
      });

      if (!existingArtifact) {
        throw new NotFoundException(`Artifact with ID ${id} not found`);
      }

      // Update context with artifact data
      if (currentContext) {
        currentContext.organizationId = existingArtifact.organizationId;
        currentContext.projectId = existingArtifact.projectId;
      }

      const updateData: Prisma.ArtifactUpdateInput = {
        ...(updateDto.title !== undefined && {
          title: sanitizeArtifactTitle(updateDto.title),
        }),
        ...(updateDto.data !== undefined && {
          data: updateDto.data as unknown as InputJsonValue,
        }),
        ...(updateDto.category !== undefined && {
          category: updateDto.category,
        }),
        ...(updateDto.priority !== undefined && {
          priority: updateDto.priority,
        }),
        ...(updateDto.status !== undefined && { status: updateDto.status }),
        ...(updateDto.isPublic !== undefined && {
          isPublic: updateDto.isPublic,
        }),
        updatedAt: new Date(),
      };

      // Handle tags separately with TagService (don't include in updateData)
      const tagsToUpdate = updateDto.tags;

      // Recalculate content hash and word count if content changed
      if (updateDto.data !== undefined) {
        updateData.contentHash = this.generateContentHash(updateDto.data);
      }

      // Update artifact and publish event in transaction
      this.logger.debug('[update] starting transaction', {
        id,
        updateData,
      });
      const updatedArtifact = await this.prisma.$transaction(async (tx) => {
        try {
          this.logger.debug('[update] updating artifact in tx', {
            id,
            updateData,
          });
          const updated = await tx.artifact.update({
            where: { id },
            data: updateData,
            include: {
              project: true,
              parent: true,
              children: true,
            },
          });

          // Publish domain event via outbox in same transaction
          await this.eventPublisher.publishInTransaction(tx, {
            type: EVENT_TYPES.ARTIFACT.UPDATED,
            aggregateId: updated.id,
            payload: {
              payloadType: EVENT_TYPES.ARTIFACT.UPDATED,
              update: updated,
              organizationId: updated.organizationId as OrganizationId,
              projectId: updated.projectId as ProjectId,
              sourceType: updated.sourceType as ArtifactSourceType,
              sourceId: updated.sourceId,
            },
          });

          return updated;
        } catch (err) {
          this.logger.error('[update] error updating artifact in tx', err);
          throw err;
        }
      });

      // Update tags using TagService if provided (after transaction)
      if (tagsToUpdate !== undefined) {
        await this.tagService.syncArtifactTags(
          id,
          organizationId,
          tagsToUpdate.map((name) => ({
            name,
            source: PrismaTagSource.USER,
          })),
        );
      }

      const result = this.toResponseDto(updatedArtifact);

      this.logger.log('Artifact updated with events', {
        artifactId: updatedArtifact.id,
        correlationId: currentContext?.correlationId,
      });

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('[update] Failed to update artifact', {
        error: (error as Error).message,
        artifactId: id,
      });
      throw new BadRequestException(
        `Failed to update knowledge object: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Delete a knowledge object (moved from ArtifactService)
   */
  @WithWorkflowContext((...args) => {
    const [id, organizationId] = args as [string, OrganizationId];
    return {
      sourceService: 'ArtifactService',
      sourceMethod: 'delete',
      context: {
        organizationId,
      },
      metadata: {
        operationType: 'deleteArtifact',
      },
    };
  })
  async delete(id: string, organizationId: OrganizationId): Promise<void> {
    try {
      const contextManager = EventContextManager.getInstance();
      const currentContext = contextManager.getCurrentContext();

      this.logger.log('[delete] Deleting artifact with events', {
        artifactId: id,
        organizationId,
        correlationId: currentContext?.correlationId,
      });

      // Check if artifact exists and belongs to the organization
      this.logger.debug('[delete] checking artifact exists', {
        id,
        organizationId,
      });
      const existingArtifact = await this.prisma.db.artifact.findFirst({
        where: {
          id,
          // CRITICAL: Always filter by organization ID to prevent cross-org access
          organizationId,
        },
        select: {
          id: true,
          organizationId: true,
          projectId: true,
          vectorId: true,
          hasEmbedding: true,
          sourceType: true,
          sourceId: true,
        },
      });

      if (!existingArtifact) {
        throw new NotFoundException(`Artifact with ID ${id} not found`);
      }

      // Update context with artifact data
      if (currentContext) {
        currentContext.organizationId = existingArtifact.organizationId;
        currentContext.projectId = existingArtifact.projectId;
      }

      // Delete the vector embedding if it exists
      if (existingArtifact.hasEmbedding && existingArtifact.vectorId) {
        try {
          // TODO: Implement deleteEmbedding method in EmbeddingsClientService
          // await this.embeddingsClient.deleteEmbedding(
          //   existingArtifact.vectorId,
          // );
          this.logger.debug(
            `Skipping embedding deletion for artifact ${id} - method not implemented`,
          );
        } catch (embeddingError) {
          this.logger.warn(
            `Failed to delete embedding for artifact ${id}: ${(embeddingError as Error).message}`,
          );
          // Continue with deletion even if embedding deletion fails
        }
      }

      // Delete artifact and publish event in transaction
      this.logger.debug('[delete] starting transaction', {
        id,
      });
      await this.prisma.$transaction(async (tx) => {
        try {
          this.logger.debug('[delete] deleting artifact in tx', {
            id,
          });
          // Delete the artifact from database
          await tx.artifact.delete({
            where: { id },
          });

          // Publish domain event via outbox in same transaction
          await this.eventPublisher.publishInTransaction(tx, {
            type: EVENT_TYPES.ARTIFACT.DELETED,
            aggregateId: id,
            payload: {
              payloadType: EVENT_TYPES.ARTIFACT.DELETED,
              artifactId: id as ArtifactId,
              organizationId: existingArtifact.organizationId,
              projectId: existingArtifact.projectId,
              sourceType: existingArtifact.sourceType as ArtifactSourceType,
              sourceId: existingArtifact.sourceId,
            },
          });
        } catch (err) {
          this.logger.error('[delete] error deleting artifact in tx', err);
          throw err;
        }
      });

      this.logger.log('Artifact deleted with events', {
        artifactId: id,
        correlationId: currentContext?.correlationId,
      });
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to delete artifact', {
        error: (error as Error).message,
        artifactId: id,
      });
      throw new BadRequestException(
        `Failed to delete knowledge object: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Perform semantic search across knowledge objects
   */
  semanticSearch(
    _searchDto: SemanticSearchDto,
    _organizationId: OrganizationId,
  ): Promise<SemanticSearchResponseDto> {
    const { ..._ } = _searchDto;
    throw new BadRequestException(
      'Semantic search is not implemented yet - will be available via events-based embedding service',
    );
  }

  /**
   * Helper methods (moved from ArtifactService)
   */
  private generateContentHash(data?: ArtifactData): string {
    if (!data) {
      return '';
    }
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex');
  }

  private async findRootId(
    parentId: string,
    organizationId?: OrganizationId,
  ): Promise<string> {
    const whereClause: { id: string; organizationId?: OrganizationId } = {
      id: parentId,
    };
    if (organizationId) {
      whereClause.organizationId = organizationId;
    }

    const parent = await this.prisma.db.artifact.findFirst({
      where: whereClause,
      select: { rootId: true, id: true },
    });

    return parent?.rootId || parent?.id || parentId;
  }

  private toResponseDto(
    artifact: Omit<Artifact, 'data'> & { data: unknown },
  ): ArtifactResponseDto {
    if (artifact.title == null) {
      throw new Error(`Artifact ${artifact.id} is missing a title`);
    }
    if (
      !artifact.data ||
      typeof artifact.data !== 'object' ||
      Array.isArray(artifact.data) ||
      !('type' in artifact.data)
    ) {
      throw new Error(`Artifact ${artifact.id} has invalid data payload`);
    }
    const typedData = artifact.data as unknown as ArtifactData;
    return {
      id: artifact.id as ArtifactId,
      projectId: artifact.projectId as ProjectId,
      type: artifact.type as unknown as ArtifactType,
      title: artifact.title,
      data: typedData,
      embeddingModel: artifact.embeddingModel ?? undefined,
      hasEmbedding: artifact.hasEmbedding ?? undefined,
      parentId: artifact.parentId ?? undefined,
      rootId: artifact.rootId ?? undefined,
      sourceType: artifact.sourceType as ArtifactSourceType,
      sourceId: artifact.sourceId ?? undefined,
      contentHash: artifact.contentHash ?? undefined,
      language: artifact.language ?? undefined,
      tags: artifact.tags || [],
      tagRelations: [], // Junction table no longer exists - use TagService for tag operations
      category: artifact.category ?? undefined,
      priority: artifact.priority ?? undefined,
      status: artifact.status ?? undefined,
      isPublic: artifact.isPublic,
      createdAt: ensureStringDate(artifact.createdAt),
      updatedAt: ensureStringDate(artifact.updatedAt),
      archivedAt: ensureStringDate(artifact.archivedAt ?? undefined),
    };
  }
}

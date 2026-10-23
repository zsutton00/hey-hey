import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  ConversationStatus,
  Initiative,
  InitiativeCreatorType,
  Prisma,
  TagSource as PrismaTagSource,
  WorkStatus as PrismaWorkStatus,
} from '@prisma/client';
import {
  buildInitiativeCreatedEventPayload,
  buildInitiativeEventContentSnapshot,
  buildInitiativeEventContentSnapshotFromSections,
  buildInitiativeEventUpdateSnapshot,
  extractInitiativeSectionContent,
} from 'src/utils/initiative-event.util';
import { DomainEventPublisher } from '../../core/events/domain-event-publisher';
import {
  EventContextManager,
  WithEventContext,
} from '../../core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import type {
  InitiativeContentChangedEvent,
  InitiativeUpdatedEvent,
  ServiceEvent,
} from '../../core/events/types/domain-events';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import {
  CreateInitiativeDto,
  InitiativeContentChangedEventPayload,
  InitiativeResponseDto,
  InitiativeSectionUpdateSource,
  InitiativeUpdatedEventPayload,
  Priority,
  UpdateInitiativeDto,
  WorkflowName,
  WorkItemSectionInput,
  WorkStatus,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import {
  MaterializedWorkItemSection,
  WorkItemSectionRecord,
} from '../../types/work-item-section.types';
import { ensureStringDate } from '../../utils/date.util';
import { ArtifactService } from '../artifacts/artifact.service';
import { TagService } from '../tag.service';
import {
  InitiativeArtifactService,
  InitiativeOriginalData,
} from './initiative-artifact.service';
import { InitiativeDraft } from './types';

const INITIATIVE_SECTION_FIELDS = [
  'description',
  'details',
  'acceptanceCriteria',
] as const;

type InitiativeSectionField = (typeof INITIATIVE_SECTION_FIELDS)[number];

type InitiativeSectionRecord = WorkItemSectionRecord & {
  initiativeId: string;
};

type InitiativeUpdateInput = Partial<
  Omit<InitiativeResponseDto, 'sections'>
> & {
  sections?: WorkItemSectionInput[];
  sectionUpdateSource?: InitiativeSectionUpdateSource;
};

const INITIATIVE_SECTION_ORDER: Record<InitiativeSectionField, number> = {
  description: 0,
  details: 1,
  acceptanceCriteria: 2,
};

/**
 * Side-effect payload produced by {@link InitiativeService.updateInTransaction}
 * for the caller to run after its outer tx commits. Mirrors the shape used by
 * {@link TaskService.updateInTransaction} and
 * {@link DesignDocService.updateInTransaction}: nothing in here is load-bearing
 * for atomicity, but skipping it leaves the initiative in a partially-updated
 * downstream state (tags not yet synced, artifact not yet refreshed).
 */
export type InitiativeUpdatePostCommit = {
  tagsToSync?: string[];
  statusChange?: {
    previousStatus: string;
    newStatus: string;
  };
  updateOriginalArtifact?: boolean;
};

@Injectable()
export class InitiativeService {
  private readonly logger = new Logger(InitiativeService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private eventPublisher: DomainEventPublisher,
    private tagService: TagService,
    private initiativeArtifactService: InitiativeArtifactService,
    private artifactService: ArtifactService,
    @Optional() _redisService?: unknown,
  ) {}

  // Utility methods for reducing code duplication

  /**
   * Sets up event context with common metadata for initiative operations
   */
  private setupEventContext(
    organizationId: OrganizationId,
    additionalMetadata?: Record<string, unknown>,
  ): void {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    if (currentContext) {
      currentContext.organizationId = organizationId;
      if (additionalMetadata) {
        currentContext.metadata = {
          ...currentContext.metadata,
          ...additionalMetadata,
        };
      }
    }
  }

  /**
   * Builds standard initiative data structure for database operations
   */
  private buildInitiativeData(
    dto: CreateInitiativeDto,
    organizationId: OrganizationId,
    options: {
      reasoning?: string;
      creatorType?: InitiativeCreatorType;
      sourceConversationId?: string;
      originatingProjectId: ProjectId;
    },
  ): Prisma.InitiativeCreateInput {
    const sectionValues = this.buildInitiativeSectionContentMap(dto.sections);
    return {
      name: dto.name,
      sections: {
        create: this.buildInitiativeSectionCreatePayload(sectionValues),
      },
      assignee: dto.assigneeId
        ? { connect: { id: dto.assigneeId } }
        : undefined,
      organization: { connect: { id: organizationId } },
      reasoning: options?.reasoning || dto.reasoning,
      creatorType: options?.creatorType || dto.creatorType,
      status: dto.status ?? WorkStatus.RefiningDescription,
      priority: dto.priority,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      sourceType: dto.sourceType ?? undefined,
      sourceId: dto.sourceId ?? undefined,
      originatingProject: {
        connect: { id: options.originatingProjectId },
      },
      // tags will be managed separately by TagService
      sourceConversation:
        options?.sourceConversationId || dto.sourceConversationId
          ? {
              connect: {
                id: options?.sourceConversationId || dto.sourceConversationId,
              },
            }
          : undefined,
    };
  }

  /**
   * Builds initiative data for batch operations (createMany)
   */
  private buildInitiativeBatchData(
    dto: CreateInitiativeDto,
    organizationId: OrganizationId,
    originatingProjectId: ProjectId,
  ): Prisma.InitiativeCreateManyInput {
    return {
      name: dto.name,
      assigneeId: dto.assigneeId as string | undefined,
      organizationId,
      reasoning: dto.reasoning,
      creatorType: dto.creatorType,
      status: dto.status ?? WorkStatus.RefiningDescription,
      priority: dto.priority,
      dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
      sourceType: dto.sourceType ?? undefined,
      sourceId: dto.sourceId ?? undefined,
      originatingProjectId,
      // tags will be managed separately by TagService
    };
  }

  private async createSectionsForInitiatives(
    initiatives: Initiative[],
    sources: CreateInitiativeDto[],
  ): Promise<void> {
    if (initiatives.length === 0) {
      return;
    }

    const payload: Array<{
      initiativeId: string;
      key: InitiativeSectionField;
      order: number;
      materializedMarkdown: string;
    }> = [];

    initiatives.forEach((initiative, index) => {
      const source = sources[index];
      if (!source) {
        throw new Error(
          `Invariant violation: missing initiative source data for index ${index}`,
        );
      }

      const sectionPayload = this.buildInitiativeSectionCreatePayload(
        this.buildInitiativeSectionContentMap(source.sections),
      );

      sectionPayload.forEach((section) => {
        payload.push({
          initiativeId: initiative.id,
          ...section,
        });
      });
    });

    await this.prisma.db.initiativeSection.createMany({ data: payload });
  }

  /**
   * Handles tag management for initiatives using TagService
   */
  private async handleInitiativeTags(
    initiativeId: string,
    organizationId: OrganizationId,
    tags: string[] | undefined,
    source: PrismaTagSource = PrismaTagSource.USER,
  ): Promise<void> {
    if (tags && tags.length > 0) {
      await this.tagService.addTagsToInitiative(
        initiativeId,
        organizationId,
        tags.map((name) => ({ name, source })),
      );
    }
  }

  private createEmptyChildCounts() {
    return {
      total: 0,
      done: 0,
      inProgress: 0,
      backlog: 0,
    };
  }

  private buildInitiativeSectionCreatePayload(
    values: Partial<Record<InitiativeSectionField, string | null | undefined>>,
  ): Array<{
    key: InitiativeSectionField;
    order: number;
    materializedMarkdown: string;
  }> {
    return INITIATIVE_SECTION_FIELDS.map((key) => {
      const content = values[key] ?? '';
      return {
        key,
        order: INITIATIVE_SECTION_ORDER[key],
        materializedMarkdown: content,
      };
    });
  }

  private buildInitiativeSectionUpdatesFromInput(
    sections?: WorkItemSectionInput[],
  ): Array<{ key: InitiativeSectionField; content: string }> {
    if (!sections || sections.length === 0) {
      return [];
    }

    const updates: Array<{ key: InitiativeSectionField; content: string }> = [];
    for (const section of sections) {
      const key = section.key as InitiativeSectionField;
      if (!INITIATIVE_SECTION_FIELDS.includes(key)) {
        throw new BadRequestException(
          `Unsupported initiative section key: ${section.key}`,
        );
      }
      if (typeof section.content !== 'string') {
        throw new BadRequestException(
          `Initiative section content must be a string for key: ${section.key}`,
        );
      }
      updates.push({
        key,
        content: section.content,
      });
    }

    return updates;
  }

  private buildInitiativeSectionContentMap(
    sections?: WorkItemSectionInput[],
  ): Partial<Record<InitiativeSectionField, string>> {
    const values: Partial<Record<InitiativeSectionField, string>> = {};
    if (!sections) {
      return values;
    }

    for (const section of sections) {
      const key = section.key as InitiativeSectionField;
      if (!INITIATIVE_SECTION_FIELDS.includes(key)) {
        throw new BadRequestException(
          `Unsupported initiative section key: ${section.key}`,
        );
      }
      if (typeof section.content !== 'string') {
        throw new BadRequestException(
          `Initiative section content must be a string for key: ${section.key}`,
        );
      }
      values[key] = section.content;
    }

    return values;
  }

  private async loadInitiativeEventContentSnapshot(
    initiativeId: InitiativeId,
  ): Promise<Record<InitiativeSectionField, string>> {
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      initiativeId,
    ]);
    const sections = sectionsByInitiativeId.get(initiativeId);
    return buildInitiativeEventContentSnapshotFromSections(sections);
  }

  private async hydrateInitiativeSections(
    sections: InitiativeSectionRecord[],
    _prismaClient: PrismaService['db'] | Prisma.TransactionClient = this.prisma
      .db,
  ): Promise<InitiativeSectionRecord[]> {
    return sections;
  }

  private async loadInitiativeSectionsMap(
    initiativeIds: string[],
    includeSectionKeys?: string[],
  ): Promise<Map<string, MaterializedWorkItemSection[]>> {
    if (initiativeIds.length === 0) {
      return new Map();
    }

    const rawSections = (await this.prisma.db.initiativeSection.findMany({
      where: {
        initiativeId: { in: initiativeIds },
        ...(includeSectionKeys && includeSectionKeys.length > 0
          ? { key: { in: includeSectionKeys } }
          : {}),
      },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        initiativeId: true,
        key: true,
        order: true,
        materializedMarkdown: true,
      },
    })) as InitiativeSectionRecord[];

    const hydrated = await this.hydrateInitiativeSections(rawSections);
    const sectionsByInitiativeId = new Map<
      string,
      MaterializedWorkItemSection[]
    >();

    for (const section of hydrated) {
      const list = sectionsByInitiativeId.get(section.initiativeId) ?? [];
      list.push({
        id: section.id,
        key: section.key,
        order: section.order,
        materializedMarkdown: section.materializedMarkdown ?? '',
        materializedProposalId: '',
      });
      sectionsByInitiativeId.set(section.initiativeId, list);
    }

    for (const initiativeId of initiativeIds) {
      const sections = sectionsByInitiativeId.get(initiativeId) ?? [];
      if (sections.length === 0) {
        if (!includeSectionKeys || includeSectionKeys.length === 0) {
          throw new BadRequestException(
            `Initiative ${initiativeId} is missing required sections.`,
          );
        }
        sectionsByInitiativeId.set(initiativeId, []);
        continue;
      }
      sections.sort((a, b) => a.order - b.order);
      sectionsByInitiativeId.set(initiativeId, sections);
    }

    return sectionsByInitiativeId;
  }

  private async buildTaskChildCountsMap(
    organizationId: OrganizationId,
    initiativeIds: string[],
  ): Promise<Map<string, ReturnType<typeof this.createEmptyChildCounts>>> {
    if (!initiativeIds.length) {
      return new Map();
    }

    const backlogStatuses = new Set<PrismaWorkStatus>([
      PrismaWorkStatus.GENERATED,
      PrismaWorkStatus.BACKLOG,
      PrismaWorkStatus.GENERATING_DESCRIPTION,
      PrismaWorkStatus.REFINING_DESCRIPTION,
      PrismaWorkStatus.REFINING_DETAILS,
      PrismaWorkStatus.REFINING_ACCEPTANCE_CRITERIA,
      PrismaWorkStatus.GENERATING_DETAILS,
      PrismaWorkStatus.GENERATING_DESCRIPTION_AND_DETAILS,
      PrismaWorkStatus.GENERATING_ACCEPTANCE_CRITERIA,
      PrismaWorkStatus.GENERATING_ALL,
      PrismaWorkStatus.ON_HOLD,
    ]);

    const inProgressStatuses = new Set<PrismaWorkStatus>([
      PrismaWorkStatus.ACTIVE,
    ]);

    const doneStatuses = new Set<PrismaWorkStatus>([
      PrismaWorkStatus.COMPLETED,
      PrismaWorkStatus.CANCELLED,
    ]);

    const grouped = await this.prisma.db.task.groupBy({
      by: ['initiativeId', 'status'],
      where: {
        organizationId,
        archivedAt: null,
        initiativeId: {
          in: initiativeIds,
        },
        parentTaskId: null,
      },
      _count: {
        _all: true,
      },
    });

    const countsMap = new Map<
      string,
      ReturnType<typeof this.createEmptyChildCounts>
    >();

    for (const row of grouped) {
      const current =
        countsMap.get(row.initiativeId) ?? this.createEmptyChildCounts();
      countsMap.set(row.initiativeId, current);

      current.total += row._count._all;

      if (doneStatuses.has(row.status)) {
        current.done += row._count._all;
      } else if (inProgressStatuses.has(row.status)) {
        current.inProgress += row._count._all;
      } else {
        current.backlog += row._count._all;
      }
    }

    return countsMap;
  }


  /**
   * Validates that sourceConversationId belongs to the organization
   */
  private async validateSourceConversation(
    sourceConversationId: string,
    organizationId: OrganizationId,
  ): Promise<void> {
    if (!sourceConversationId) return;

    try {
      const conversation = await this.prisma.db.conversation.findFirst({
        where: {
          id: sourceConversationId,
          project: {
            organizationId,
          },
        },
        select: {
          id: true,
          status: true,
          workflowName: true,
          project: {
            select: {
              organizationId: true,
            },
          },
        },
      });

      if (!conversation) {
        throw new Error(
          `Source conversation ${sourceConversationId} not found in organization ${organizationId}. ` +
            `Ensure the conversation exists and user has access. ` +
            `Common causes: conversation belongs to different organization, conversation was deleted, invalid UUID format.`,
        );
      }

      this.logger.debug('[validateSourceConversation] Validation successful', {
        sourceConversationId,
        organizationId,
        conversationStatus: conversation.status,
        workflowName: conversation.workflowName,
      });
    } catch (error) {
      this.logger.error('[validateSourceConversation] Validation failed', {
        error: (error as Error).message,
        sourceConversationId,
        organizationId,
      });
      throw error;
    }
  }

  /**
   * Executes a database operation within a transaction and publishes an event
   */
  private async executeWithEventTransaction<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
    eventDataBuilder: (result: T) => Omit<ServiceEvent, 'id'>,
    operationName: string,
  ): Promise<T> {
    this.logger.debug(`[${operationName}] starting transaction`);

    return await this.prisma.$transaction(async (tx) => {
      try {
        this.logger.debug(`[${operationName}] executing operation in tx`);
        const result = await operation(tx);

        // Build event data with the result
        const eventData = eventDataBuilder(result);

        // Publish event within the same transaction
        await this.eventPublisher.publishInTransaction(tx, eventData);

        return result;
      } catch (err) {
        this.logger.error(`[${operationName}] error in transaction`, err);
        throw err;
      }
    });
  }

  /**
   * Stores original initiative artifacts if the status qualifies for it
   */
  private async storeOriginalArtifactIfNeeded(
    initiatives: Array<InitiativeDraft & { status: WorkStatus }>,
    organizationId: OrganizationId,
    projectId: ProjectId,
    context?: {
      sourceId?: string;
      generationModel?: string;
      generationPrompt?: string;
      originalRequestContext?: Record<string, unknown>;
    },
    operationName: string = 'operation',
  ): Promise<void> {
    this.logger.debug(
      `[${operationName}] storeOriginalArtifactIfNeeded starting...`,
      {
        initiativeCount: initiatives.length,
        organizationId,
        projectId,
        contextProvided: !!context,
      },
    );

    this.logger.debug(`[${operationName}] filtered initiatives for artifacts`, {
      totalInitiatives: initiatives.length,
      initiativeIds: initiatives.map((i) => i.id),
    });

    if (initiatives.length > 0) {
      try {
        const sectionsByInitiativeId = await this.loadInitiativeSectionsMap(
          initiatives.map((initiative) => initiative.id),
        );
        const originalDataForArtifacts = initiatives.map((initiative) => ({
          ...extractInitiativeSectionContent(
            sectionsByInitiativeId.get(initiative.id),
          ),
          name: initiative.name,
          priority: initiative.priority || 'MEDIUM',
          estimatedEffort: undefined as string | undefined,
          tags: initiative.tags || [],
          reasoning: initiative.reasoning,
          influences: initiative.influences,
        }));

        const initiativeIds = initiatives.map((initiative) => ({
          id: initiative.id as InitiativeId,
        }));

        this.logger.debug(
          `[${operationName}] calling initiativeArtifactService.storeOriginalGeneration`,
          {
            originalDataCount: originalDataForArtifacts.length,
            initiativeIdsCount: initiativeIds.length,
            organizationId,
            projectId,
            contextData: {
              sourceId: context?.sourceId,
              generationModel: context?.generationModel || 'user-created',
              generationPrompt:
                context?.generationPrompt || 'initiative-creation',
            },
          },
        );

        await this.initiativeArtifactService.storeOriginalGeneration(
          originalDataForArtifacts,
          initiativeIds,
          organizationId,
          projectId,
          {
            sourceId: context?.sourceId,
            generationModel: context?.generationModel || 'user-created',
            generationPrompt:
              context?.generationPrompt || 'initiative-creation',
            originalRequestContext: context?.originalRequestContext || {
              source: `api-${operationName}`,
            },
          },
        );

        this.logger.debug(
          `[${operationName}] initiativeArtifactService.storeOriginalGeneration completed successfully`,
        );

        this.logger.debug(
          `[${operationName}] Stored ORIGINAL_INITIATIVE artifacts`,
          {
            artifactCount: initiatives.length,
            totalInitiatives: initiatives.length,
            organizationId,
            projectId,
          },
        );
      } catch (error) {
        this.logger.error(
          `[${operationName}] Failed to store ORIGINAL_INITIATIVE artifacts`,
          {
            error: (error as Error).message,
            errorStack: (error as Error).stack,
            organizationId,
            projectId,
            initiativeCount: initiatives.length,
          },
        );
        // Don't throw - artifacts are important but not critical enough to fail initiative creation
      }
    } else {
      this.logger.debug(`[${operationName}] no initiatives need artifacts`, {
        totalInitiatives: initiatives.length,
        statusChecks: initiatives.map((i) => ({
          id: i.id,
          status: i.status,
        })),
      });
    }
  }

  /**
   * Generic adapter helper that converts internal results to API response format
   */
  private convertToApiResponse<T>(
    result: T | T[] | null,
    childCountsMap?: Map<
      string,
      ReturnType<typeof this.createEmptyChildCounts>
    >,
    _legacyDesignDocCountsMap?: Map<string, number>,
    sectionsByInitiativeId?: Map<string, MaterializedWorkItemSection[]>,
  ): InitiativeResponseDto | InitiativeResponseDto[] | null {
    if (result === null) {
      return null;
    }
    if (Array.isArray(result)) {
      return result.map((item) =>
        this.toApiResponse(
          item as Initiative,
          childCountsMap?.get((item as Initiative).id),
          sectionsByInitiativeId?.get((item as Initiative).id),
        ),
      );
    }
    const initiative = result as Initiative;
    return this.toApiResponse(
      initiative,
      childCountsMap?.get(initiative.id),
      sectionsByInitiativeId?.get(initiative.id),
    );
  }

  // Data transformation methods
  private toApiResponse(
    initiative: Initiative,
    childCounts?: ReturnType<typeof this.createEmptyChildCounts>,
    sections?: MaterializedWorkItemSection[],
  ): InitiativeResponseDto {
    if (!initiative.priority) {
      throw new Error(
        `Invariant violation: initiative ${initiative.id} is missing priority`,
      );
    }
    if (!initiative.originatingProjectId) {
      throw new Error(
        `Invariant violation: initiative ${initiative.id} is missing originatingProjectId`,
      );
    }

    const linkedProjectIds = this.extractLinkedProjectIds(initiative);
    const filteredSections = this.filterSectionsForStatus(
      initiative.status as WorkStatus,
      sections,
    );
    return {
      id: initiative.id as InitiativeId,
      name: initiative.name,
      assigneeId: initiative.assigneeId
        ? (initiative.assigneeId as UserId)
        : undefined,
      status: initiative.status,
      priority: initiative.priority,
      dueDate: initiative.dueDate?.toISOString() ?? '',
      tags: initiative.tags ?? undefined,
      organizationId: initiative.organizationId as OrganizationId,
      sourceConversationId: initiative.sourceConversationId ?? undefined,
      sourceType: initiative.sourceType ?? undefined,
      sourceId: initiative.sourceId ?? undefined,
      creatorType: initiative.creatorType,
      reasoning: initiative.reasoning ?? undefined,
      originatingProjectId: initiative.originatingProjectId as ProjectId,
      linkedProjectIds,
      createdAt: ensureStringDate(initiative.createdAt),
      updatedAt: ensureStringDate(initiative.updatedAt),
      childCounts: childCounts ?? this.createEmptyChildCounts(),
      sections: filteredSections,
    };
  }

  private filterSectionsForStatus(
    status: WorkStatus,
    sections?: MaterializedWorkItemSection[],
  ): MaterializedWorkItemSection[] | undefined {
    if (!sections) {
      return sections;
    }
    if (status !== WorkStatus.RefiningDescription) {
      return sections;
    }
    return sections.map((section) => {
      if (section.key === 'details' || section.key === 'acceptanceCriteria') {
        return { ...section, materializedMarkdown: '' };
      }
      return section;
    });
  }

  private assertNoDirectSectionUpdates(
    update: Partial<Record<InitiativeSectionField, unknown>>,
  ): void {
    const blocked = INITIATIVE_SECTION_FIELDS.filter(
      (field) => update[field] !== undefined,
    );
    if (blocked.length > 0) {
      throw new BadRequestException(
        `Initiative content is edited via sections. Remove: ${blocked.join(', ')}`,
      );
    }
  }

  private shouldUpdateOriginalArtifactFromSource(
    source?: InitiativeSectionUpdateSource,
  ): boolean {
    return source === InitiativeSectionUpdateSource.AgentSuggested;
  }

  private async publishInitiativeContentChangedEvent(
    tx: Prisma.TransactionClient,
    params: {
      initiativeId: InitiativeId;
      content: Record<InitiativeSectionField, string>;
      organizationId: OrganizationId;
      projectId: ProjectId;
      linkedProjectIds: ProjectId[];
      originatingProjectId: ProjectId;
      userId?: UserId;
    },
  ): Promise<string | null> {
    const payload: InitiativeContentChangedEventPayload = {
      payloadType: EVENT_TYPES.INITIATIVE.CONTENT_CHANGED,
      content: params.content,
      organizationId: params.organizationId,
      projectId: params.projectId,
      originatingProjectId: params.originatingProjectId,
      linkedProjectIds: params.linkedProjectIds,
      userId: params.userId,
    };

    const event: Omit<InitiativeContentChangedEvent, 'id'> = {
      type: EVENT_TYPES.INITIATIVE.CONTENT_CHANGED,
      aggregateId: params.initiativeId,
      payload,
    };

    return this.eventPublisher.publishInTransaction(tx, event);
  }

  async applySectionUpdates(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
    updates: Array<{ key: InitiativeSectionField; content: string }>,
    options?: {
      sectionUpdateSource?: InitiativeSectionUpdateSource;
    },
  ): Promise<InitiativeResponseDto> {
    if (!updates.length) {
      const existing = await this.findOneForAdapter(
        initiativeId,
        organizationId,
      );
      if (!existing) {
        throw new NotFoundException(`Initiative ${initiativeId} not found`);
      }
      return existing;
    }

    const existingInitiative = await this.prisma.db.initiative.findFirst({
      where: {
        id: initiativeId,
        organizationId,
        archivedAt: null,
      },
      select: {
        id: true,
        originatingProjectId: true,
        status: true,
      },
    });
    if (!existingInitiative) {
      throw new NotFoundException(`Initiative ${initiativeId} not found`);
    }

    const originatingProjectId =
      existingInitiative.originatingProjectId as ProjectId | null;
    if (!originatingProjectId) {
      throw new BadRequestException(
        `Initiative ${initiativeId} is missing originating project data.`,
      );
    }

    this.logger.debug('Applying initiative section updates', {
      initiativeId,
      organizationId,
      sectionUpdateSource: options?.sectionUpdateSource ?? null,
      updates: updates.map((update) => ({
        key: update.key,
        contentLength: update.content.length,
      })),
    });

    await this.prisma.$transaction(async (tx) => {
      const updateKeys = updates.map((update) => update.key);
      const sections = await tx.initiativeSection.findMany({
        where: {
          initiativeId,
          key: { in: updateKeys },
        },
        select: {
          id: true,
          key: true,
        },
      });

      if (sections.length !== updateKeys.length) {
        throw new BadRequestException(
          `Initiative ${initiativeId} is missing required sections.`,
        );
      }

      const sectionMap = new Map(
        sections.map((section) => [section.key, section]),
      );

      for (const update of updates) {
        const existing = sectionMap.get(update.key);
        if (!existing) {
          this.logger.warn('Attempted to update missing initiative section', {
            initiativeId,
            sectionKey: update.key,
          });
          continue;
        }

        await tx.initiativeSection.update({
          where: { id: existing.id },
          data: {
            materializedMarkdown: update.content,
          },
        });
      }

      const sectionsForEvent = (await tx.initiativeSection.findMany({
        where: {
          initiativeId,
          key: { in: [...INITIATIVE_SECTION_FIELDS] },
        },
        orderBy: { order: 'asc' },
        select: {
          id: true,
          key: true,
          order: true,
          materializedMarkdown: true,
        },
      })) as MaterializedWorkItemSection[];

      const contentSnapshot = buildInitiativeEventContentSnapshotFromSections(
        sectionsForEvent.map((section) => ({
          id: section.id,
          key: section.key,
          order: section.order,
          materializedMarkdown: section.materializedMarkdown ?? '',
          materializedProposalId: section.materializedProposalId,
        })),
      );

      const links = await tx.projectInitiative.findMany({
        where: { initiativeId },
        select: { projectId: true },
      });

      await this.publishInitiativeContentChangedEvent(tx, {
        initiativeId,
        content: contentSnapshot,
        organizationId,
        projectId: originatingProjectId,
        linkedProjectIds: links.map((link) => link.projectId as ProjectId),
        originatingProjectId,
      });
    });

    if (
      this.shouldUpdateOriginalArtifactFromSource(options?.sectionUpdateSource)
    ) {
      await this.updateOriginalArtifactForRefinementOverwrites(
        organizationId,
        initiativeId,
      );
    }

    this.logger.debug('Applied initiative section updates', { initiativeId });

    const reloaded = await this.prisma.db.initiative.findUnique({
      where: { id: initiativeId },
    });
    if (!reloaded) {
      throw new NotFoundException(`Initiative ${initiativeId} not found`);
    }

    const childCountsMap = await this.buildTaskChildCountsMap(organizationId, [
      reloaded.id,
    ]);
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      reloaded.id,
    ]);

    return this.convertToApiResponse(
      reloaded,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto;
  }

  private async updateOriginalArtifactForRefinementOverwrites(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
  ): Promise<void> {
    const contentSnapshot =
      await this.loadInitiativeEventContentSnapshot(initiativeId);
    const updates: Partial<
      Pick<
        InitiativeOriginalData,
        'description' | 'details' | 'acceptanceCriteria'
      >
    > = {
      description: contentSnapshot.description,
      details: contentSnapshot.details,
      acceptanceCriteria: contentSnapshot.acceptanceCriteria,
    };

    try {
      await this.initiativeArtifactService.updateOriginalArtifactFields(
        initiativeId,
        organizationId,
        updates,
      );
    } catch (error) {
      this.logger.warn(
        '[updateOriginalArtifactForRefinementOverwrites] Failed to update ORIGINAL_INITIATIVE',
        {
          initiativeId,
          organizationId,
          error: error instanceof Error ? error.message : error,
        },
      );
    }
  }

  private extractLinkedProjectIds(initiative: Initiative): ProjectId[] {
    const directIds = (initiative as unknown as { linkedProjectIds?: string[] })
      .linkedProjectIds;
    if (directIds && directIds.length) {
      return directIds as ProjectId[];
    }
    const projects =
      (initiative as unknown as { projects?: Array<{ projectId: string }> })
        .projects || [];
    return projects.map((project) => project.projectId as ProjectId);
  }

  private attachLinkedProjects(
    initiative: Initiative,
    linkedProjectIds: ProjectId[],
  ): Initiative & { linkedProjectIds: ProjectId[] } {
    return {
      ...initiative,
      linkedProjectIds,
    };
  }

  private async listLinkedProjectIds(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
    tx?: Prisma.TransactionClient,
  ): Promise<ProjectId[]> {
    const client =
      tx ?? (this.prisma.db as unknown as Prisma.TransactionClient);
    const links = await client.projectInitiative.findMany({
      where: {
        initiativeId,
        project: {
          organizationId,
          deletedAt: null,
        },
      },
      select: {
        projectId: true,
      },
    });
    return links.map(
      (link: { projectId: string }) => link.projectId as ProjectId,
    );
  }

  // Adapter methods for external API integration
  async createForAdapter(
    dto: CreateInitiativeDto,
    organizationId: OrganizationId,
    projectId?: ProjectId,
  ): Promise<InitiativeResponseDto> {
    // Add validation for sourceConversationId
    if (dto.sourceConversationId) {
      await this.validateSourceConversation(
        dto.sourceConversationId,
        organizationId,
      );
    }

    const projectIdToUse = projectId || dto.projectId;
    if (!projectIdToUse) {
      throw new BadRequestException(
        'projectId is required to create an initiative',
      );
    }

    const result = await this.create(
      { ...dto, organizationId },
      projectIdToUse,
    );
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      result.id,
    ]);
    return this.convertToApiResponse(
      result,
      undefined,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto;
  }

  async findAllForAdapter(
    organizationId: OrganizationId,
    filters: {
      projectId: ProjectId;
      statuses?: WorkStatus[];
      priority?: string;
      tags?: string[];
      sourceType?: Prisma.InitiativeWhereInput['sourceType'];
      page?: number;
      limit?: number;
      includeSectionKeys?: string[];
    },
  ): Promise<InitiativeResponseDto[]> {
    const results = await this.findAll(organizationId, filters);

    const childCountsMap = await this.buildTaskChildCountsMap(
      organizationId,
      results.map((initiative) => initiative.id),
    );
    const sectionsByInitiativeId =
      filters.includeSectionKeys && filters.includeSectionKeys.length > 0
        ? await this.loadInitiativeSectionsMap(
            results.map((initiative) => initiative.id),
            filters.includeSectionKeys,
          )
        : new Map<string, MaterializedWorkItemSection[]>();
    return this.convertToApiResponse(
      results,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto[];
  }

  async findOneForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto | null> {
    const result = await this.findOne(id, organizationId);
    if (!result) {
      return null;
    }

    const childCountsMap = await this.buildTaskChildCountsMap(organizationId, [
      result.id,
    ]);
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      result.id,
    ]);

    return this.convertToApiResponse(
      result,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto | null;
  }

  async findByIdForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto | null> {
    return this.findOneForAdapter(id, organizationId);
  }

  async findByConversationForAdapter(
    conversationId: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto[]> {
    const results = await this.findByConversation(
      conversationId,
      organizationId,
    );
    const childCountsMap = await this.buildTaskChildCountsMap(
      organizationId,
      results.map((initiative) => initiative.id),
    );
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap(
      results.map((initiative) => initiative.id),
    );
    return this.convertToApiResponse(
      results,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto[];
  }

  async updateForAdapter(
    id: string,
    updatesInput: InitiativeUpdateInput,
    organizationId: OrganizationId,
    userId?: UserId,
    userEmail?: string,
    userName?: string,
  ): Promise<InitiativeResponseDto> {
    let updates = updatesInput;
    const sectionUpdates = this.buildInitiativeSectionUpdatesFromInput(
      updates.sections,
    );
    const sectionUpdateSource = updates.sectionUpdateSource;

    if (sectionUpdates.length > 0) {
      const {
        sections,
        sectionUpdateSource: _sectionUpdateSource,
        ...nonSectionUpdates
      } = updates;

      if (Object.keys(nonSectionUpdates).length === 0) {
        return this.applySectionUpdates(
          organizationId,
          id as InitiativeId,
          sectionUpdates,
          { sectionUpdateSource },
        );
      }

      await this.applySectionUpdates(
        organizationId,
        id as InitiativeId,
        sectionUpdates,
        { sectionUpdateSource },
      );
      updates = nonSectionUpdates;
    }

    const result = await this.update(
      id,
      updates,
      organizationId,
      userId,
      userEmail,
      userName,
    );
    const childCountsMap = await this.buildTaskChildCountsMap(organizationId, [
      result.id,
    ]);
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      result.id,
    ]);
    return this.convertToApiResponse(
      result,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto;
  }

  async removeForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto> {
    const result = await this.remove(id, organizationId);
    const childCountsMap = await this.buildTaskChildCountsMap(organizationId, [
      result.id,
    ]);
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      result.id,
    ]);
    return this.convertToApiResponse(
      result,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto;
  }

  @WithEventContext('InitiativeService')
  async create(
    createInitiativeDto: CreateInitiativeDto & {
      organizationId: OrganizationId;
    },
    projectId: ProjectId,
  ) {
    // Set up event context with business data
    this.setupEventContext(createInitiativeDto.organizationId);
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    if (currentContext && projectId && !currentContext.projectId) {
      currentContext.projectId = projectId;
    }

    this.logger.log('Creating initiative with events', {
      initiativeName: createInitiativeDto.name,
      organizationId: createInitiativeDto.organizationId,
      correlationId: currentContext?.correlationId,
    });

    const sectionValues = this.buildInitiativeSectionContentMap(
      createInitiativeDto.sections,
    );
    const contentSnapshot = buildInitiativeEventContentSnapshot(sectionValues);

    // Create initiative (different paths depending on whether it is linked to a project)
    let initiative: Initiative & { linkedProjectIds?: ProjectId[] };

    if (projectId) {
      // Simpler path when linking to a project – allows unit tests to spy on prisma.db.initiative.create directly
      this.logger.debug('[create] creating initiative with project link', {
        name: createInitiativeDto.name,
        organizationId: createInitiativeDto.organizationId,
        projectId,
      });
      const initiativeData = this.buildInitiativeData(
        createInitiativeDto,
        createInitiativeDto.organizationId,
        { originatingProjectId: projectId },
      );
      initiative = await this.prisma.db.initiative.create({
        data: {
          ...initiativeData,
          projects: {
            create: {
              projectId,
            },
          },
        },
      });

      // Add tags using TagService if provided
      await this.handleInitiativeTags(
        initiative.id,
        createInitiativeDto.organizationId,
        createInitiativeDto.tags,
      );

      const payload = buildInitiativeCreatedEventPayload({
        initiative,
        projectId,
        linkedProjectIds: projectId ? [projectId] : [],
        content: contentSnapshot,
      });

      // Publish event outside explicit transaction (single operation already committed)
      await this.eventPublisher.publish({
        type: EVENT_TYPES.INITIATIVE.CREATED,
        aggregateId: initiative.id,
        payload,
      });
    } else {
      // Use transaction to keep event publication atomic when not linking to a project
      const initiativeData = this.buildInitiativeData(
        createInitiativeDto,
        createInitiativeDto.organizationId,
        { originatingProjectId: projectId },
      );

      initiative = await this.executeWithEventTransaction(
        async (tx) => {
          const created = await tx.initiative.create({
            data: initiativeData,
          });

          return created;
        },
        (createdInitiative) => {
          const payload = buildInitiativeCreatedEventPayload({
            initiative: createdInitiative,
            projectId,
            linkedProjectIds: projectId ? [projectId] : [],
            content: contentSnapshot,
          });

          return {
            type: EVENT_TYPES.INITIATIVE.CREATED,
            aggregateId: createdInitiative.id,
            payload,
          };
        },
        'create',
      );

      // Add tags using TagService if provided (after transaction)
      await this.handleInitiativeTags(
        initiative.id,
        createInitiativeDto.organizationId,
        createInitiativeDto.tags,
      );
    }

    initiative = this.attachLinkedProjects(
      initiative,
      projectId ? [projectId] : [],
    );

    // Create ORIGINAL_INITIATIVE artifact if status requires it
    await this.storeOriginalArtifactIfNeeded(
      [
        {
          id: initiative.id,
          name: initiative.name,
          description: sectionValues.description ?? '',
          details: sectionValues.details ?? '',
          acceptanceCriteria: sectionValues.acceptanceCriteria ?? '',
          priority:
            this.convertPriorityFromDatabase(initiative.priority) ?? undefined,
          reasoning: initiative.reasoning ?? undefined,
          status: initiative.status,
          tags: createInitiativeDto.tags ?? [],
          influences: [] as InitiativeDraft['influences'], // No influences for manually created initiatives
        },
      ],
      initiative.organizationId as OrganizationId,
      projectId,
      {
        generationModel: 'user-created',
        generationPrompt: 'initiative-creation',
        originalRequestContext: { source: 'api-create' },
      },
      'create',
    );

    this.logger.log('Initiative created with events', {
      initiativeId: initiative.id,
      organizationId: initiative.organizationId,
      correlationId: currentContext?.correlationId,
    });

    return initiative;
  }

  /**
   * Tx-aware variant of `create` for callers that need initiative
   * creation to commit-or-rollback together with adjacent writes
   * (e.g. plan-shaping proposal approval, where the new initiative
   * lands alongside PlanStage / PlanRelationship rows in the same
   * Prisma transaction).
   *
   * Intentional deferrals vs `create`:
   * - Tags are NOT applied here. Plan-shaping proposals carry no tag
   *   list; if a future caller needs tags, attach them via TagService
   *   in a post-commit step.
   * - ORIGINAL_INITIATIVE artifact is NOT stored. That snapshot is an
   *   LLM-traceability concept for AI-drafted initiatives — initiatives
   *   created here are derived from a stage's title/description, not
   *   an LLM draft, so there is nothing meaningful to snapshot.
   *
   * `projectId` is required: the simpler "with project link" branch of
   * `create` is the only path we mirror; the tx-less event-only branch
   * has no analog because we already hold the tx.
   */
  async createInTransaction(
    tx: Prisma.TransactionClient,
    createInitiativeDto: CreateInitiativeDto & {
      organizationId: OrganizationId;
    },
    projectId: ProjectId,
  ): Promise<Initiative & { linkedProjectIds: ProjectId[] }> {
    this.setupEventContext(createInitiativeDto.organizationId);

    const sectionValues = this.buildInitiativeSectionContentMap(
      createInitiativeDto.sections,
    );
    const contentSnapshot = buildInitiativeEventContentSnapshot(sectionValues);

    const initiativeData = this.buildInitiativeData(
      createInitiativeDto,
      createInitiativeDto.organizationId,
      { originatingProjectId: projectId },
    );

    this.logger.log('[createInTransaction] creating initiative', {
      name: createInitiativeDto.name,
      organizationId: createInitiativeDto.organizationId,
      projectId,
    });

    const initiative = await tx.initiative.create({
      data: {
        ...initiativeData,
        projects: {
          create: { projectId },
        },
      },
    });

    const payload = buildInitiativeCreatedEventPayload({
      initiative,
      projectId,
      linkedProjectIds: [projectId],
      content: contentSnapshot,
    });

    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.INITIATIVE.CREATED,
      aggregateId: initiative.id,
      payload,
    });

    return this.attachLinkedProjects(initiative, [projectId]);
  }

  @WithEventContext('InitiativeService')
  async createMany(
    initiatives: CreateInitiativeDto[],
    organizationId: OrganizationId,
    projectId: ProjectId,
  ): Promise<Initiative[]> {
    if (!initiatives.length) {
      return [];
    }

    // Set up event context with batch metadata
    this.setupEventContext(organizationId, {
      batchOperation: true,
      batchTotal: initiatives.length,
    });
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    if (currentContext && projectId && !currentContext.projectId) {
      currentContext.projectId = projectId;
    }

    this.logger.log(
      'Creating multiple initiatives with batch insert and events',
      {
        count: initiatives.length,
        organizationId,
        correlationId: currentContext?.correlationId,
      },
    );

    // Prepare data for batch insert
    const insertData = initiatives.map((initiative) =>
      this.buildInitiativeBatchData(initiative, organizationId, projectId),
    );
    const contentSnapshots = initiatives.map((initiative) =>
      buildInitiativeEventContentSnapshot(
        this.buildInitiativeSectionContentMap(initiative.sections),
      ),
    );

    let createdInitiatives: Initiative[] = [];

    if (projectId) {
      this.logger.debug(
        '[createMany] starting transaction for batch creation with project',
        {
          count: initiatives.length,
          organizationId,
          projectId,
        },
      );
      createdInitiatives = await this.prisma.$transaction(async (tx) => {
        try {
          // Step 1: Bulk create initiatives
          this.logger.debug('[createMany] bulk creating initiatives in tx', {
            count: initiatives.length,
            organizationId,
          });
          await tx.initiative.createMany({ data: insertData });

          // Step 2: Fetch created initiatives (ordered to match input order)
          const createdRecords = await tx.initiative.findMany({
            where: {
              organizationId,
              name: { in: initiatives.map((i) => i.name) },
            },
            orderBy: { createdAt: 'desc' },
            take: initiatives.length,
          });

          // Step 3: Bulk create project links
          this.logger.debug('[createMany] bulk creating project links in tx', {
            initiativeCount: createdRecords.length,
            projectId,
          });
          const projectLinks = createdRecords.map((initiative) => ({
            initiativeId: initiative.id,
            projectId,
          }));
          await tx.projectInitiative.createMany({ data: projectLinks });

          // Step 4: Bulk publish events (still need individual events for proper downstream processing)
          this.logger.debug('[createMany] publishing events in tx', {
            eventCount: createdRecords.length,
          });
          for (const [index, created] of createdRecords.entries()) {
            const content = contentSnapshots[index];
            if (!content) {
              throw new Error(
                `Invariant violation: missing initiative content for index ${index}`,
              );
            }
            const payload = buildInitiativeCreatedEventPayload({
              initiative: created,
              projectId,
              linkedProjectIds: projectId ? [projectId] : [],
              content,
            });
            await this.eventPublisher.publishInTransaction(tx, {
              type: EVENT_TYPES.INITIATIVE.CREATED,
              aggregateId: created.id,
              payload,
            });
          }
          return createdRecords;
        } catch (err) {
          this.logger.error('[createMany] error in batch transaction', err);
          throw err;
        }
      });
    } else {
      // Perform batch insert with createMany for efficiency
      createdInitiatives = await this.prisma.$transaction(async (tx) => {
        await tx.initiative.createMany({ data: insertData });

        const createdRecords = await tx.initiative.findMany({
          where: {
            organizationId,
            name: { in: initiatives.map((i) => i.name) },
          },
          orderBy: { createdAt: 'desc' },
          take: initiatives.length,
        });

        // publish events inside transaction
        for (const [index, initiative] of createdRecords.entries()) {
          const content = contentSnapshots[index];
          if (!content) {
            throw new Error(
              `Invariant violation: missing initiative content for index ${index}`,
            );
          }
          const payload = buildInitiativeCreatedEventPayload({
            initiative,
            projectId,
            linkedProjectIds: projectId ? [projectId] : [],
            content,
          });
          await this.eventPublisher.publishInTransaction(tx, {
            type: EVENT_TYPES.INITIATIVE.CREATED,
            aggregateId: initiative.id,
            payload,
          });
        }
        return createdRecords;
      });
    }

    await this.createSectionsForInitiatives(createdInitiatives, initiatives);

    // Add tags using TagService for each created initiative (now uses bulk operations internally)
    for (const [index, initiative] of createdInitiatives.entries()) {
      const originalInitiative = initiatives[index];
      if (!originalInitiative) {
        throw new Error(
          `Invariant violation: missing original initiative for index ${index}`,
        );
      }

      await this.handleInitiativeTags(
        initiative.id,
        organizationId,
        originalInitiative.tags,
      );
    }

    // Create ORIGINAL_INITIATIVE artifacts for initiatives with qualifying statuses
    const initiativesForArtifacts = createdInitiatives.map((initiative) => {
      // Find the original DTO that matches this initiative
      const originalDto = initiatives.find(
        (dto) => dto.name === initiative.name,
      );
      const sectionValues = this.buildInitiativeSectionContentMap(
        originalDto?.sections,
      );
      return {
        id: initiative.id,
        name: initiative.name,
        description: sectionValues.description ?? '',
        details: sectionValues.details ?? '',
        acceptanceCriteria: sectionValues.acceptanceCriteria ?? '',
        priority:
          this.convertPriorityFromDatabase(initiative.priority) ?? undefined,
        reasoning: initiative.reasoning ?? undefined,
        status: initiative.status,
        tags: originalDto?.tags ?? [],
        influences: [] as InitiativeDraft['influences'], // No influences for manually created initiatives
      };
    });

    await this.storeOriginalArtifactIfNeeded(
      initiativesForArtifacts,
      organizationId,
      projectId,
      {
        generationModel: 'user-created',
        generationPrompt: 'initiative-batch-creation',
        originalRequestContext: { source: 'api-createMany' },
      },
      'createMany',
    );

    this.logger.log(
      'Multiple initiatives created with batch insert and events',
      {
        count: createdInitiatives.length,
        organizationId,
        correlationId: currentContext?.correlationId,
      },
    );

    if (projectId) {
      createdInitiatives = createdInitiatives.map((initiative) => ({
        ...initiative,
        linkedProjectIds: [projectId],
      })) as Initiative[];
    }

    return createdInitiatives;
  }

  async findAll(
    organizationId: OrganizationId,
    filters: {
      projectId: string;
      statuses?: WorkStatus[];
      priority?: string;
      tags?: string[];
      sourceType?: Prisma.InitiativeWhereInput['sourceType'];
      page?: number;
      limit?: number;
    },
  ) {
    if (!filters?.projectId) {
      throw new BadRequestException(
        'projectId is required to list initiatives',
      );
    }

    const page = filters?.page ?? 1;
    const limit = Math.min(filters?.limit ?? 20, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.InitiativeWhereInput = {
      organizationId,
      archivedAt: null, // Only return non-archived initiatives
      projects: {
        some: {
          projectId: filters.projectId,
        },
      },
    };

    where.status =
      filters?.statuses && filters.statuses.length > 0
        ? { in: filters.statuses as PrismaWorkStatus[] }
        : { not: PrismaWorkStatus.CANCELLED };

    if (filters?.priority) {
      where.priority = filters.priority as Priority;
    }

    if (filters?.tags && filters.tags.length > 0) {
      where.tags = {
        hasEvery: filters.tags,
      };
    }

    if (filters?.sourceType !== undefined) {
      const sourceTypeFilter = filters.sourceType;
      if (
        typeof sourceTypeFilter === 'object' &&
        sourceTypeFilter !== null &&
        'not' in sourceTypeFilter
      ) {
        const existingAnd = Array.isArray(where.AND) ? where.AND : [];
        where.AND = [
          ...existingAnd,
          {
            OR: [{ sourceType: null }, { sourceType: sourceTypeFilter }],
          },
        ];
      } else {
        where.sourceType = sourceTypeFilter;
      }
    }

    const i = await this.prisma.db.initiative.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      skip,
      take: limit,
    });

    return i;
  }

  async findOne(id: string, organizationId: OrganizationId) {
    this.logger.debug('[findOne] fetching initiative', {
      id,
      organizationId,
    });
    return this.prisma.db.initiative.findFirst({
      where: {
        id,
        organizationId,
        archivedAt: null,
      },
    });
  }

  async findManyByIds(
    organizationId: OrganizationId,
    initiativeIds: InitiativeId[],
    includeSectionKeys?: string[],
  ): Promise<Map<InitiativeId, InitiativeResponseDto>> {
    if (initiativeIds.length === 0) {
      return new Map();
    }

    const initiatives = await this.prisma.db.initiative.findMany({
      where: {
        id: { in: initiativeIds },
        organizationId,
        archivedAt: null,
      },
    });

    const sectionsByInitiativeId =
      includeSectionKeys && includeSectionKeys.length > 0
        ? await this.loadInitiativeSectionsMap(
            initiativeIds,
            includeSectionKeys,
          )
        : new Map<string, MaterializedWorkItemSection[]>();

    const responses = new Map<InitiativeId, InitiativeResponseDto>();
    for (const initiative of initiatives) {
      responses.set(
        initiative.id as InitiativeId,
        this.toApiResponse(
          initiative,
          undefined,
          sectionsByInitiativeId.get(initiative.id),
        ),
      );
    }

    return responses;
  }

  async findByConversation(
    conversationId: string,
    organizationId: OrganizationId,
  ) {
    this.logger.debug(
      '[findByConversation] fetching initiatives by conversation',
      {
        conversationId,
        organizationId,
      },
    );
    return this.prisma.db.initiative.findMany({
      where: {
        sourceConversationId: conversationId,
        organizationId,
        archivedAt: null,
      },
      orderBy: {
        createdAt: 'asc',
      },
      take: 100, // Reasonable limit to prevent memory issues
    });
  }

  @WithEventContext('InitiativeService')
  async update(
    id: string,
    updateInitiativeDto: UpdateInitiativeDto,
    organizationId: OrganizationId,
    userId?: UserId,
    userEmail?: string,
    userName?: string,
  ) {
    // Set up event context
    this.setupEventContext(organizationId, { initiativeId: id });
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log('Updating initiative with events', {
      initiativeId: id,
      correlationId: currentContext?.correlationId,
    });

    // Check if initiative exists and belongs to organization
    const existingInitiative = await this.findOne(id, organizationId);
    if (!existingInitiative) {
      throw new NotFoundException('Initiative not found');
    }

    this.assertNoDirectSectionUpdates(
      updateInitiativeDto as Record<string, unknown>,
    );

    const linkedProjectIds = await this.listLinkedProjectIds(
      id as InitiativeId,
      organizationId,
    );
    const originatingProjectId =
      existingInitiative.originatingProjectId as ProjectId | null;
    if (!originatingProjectId) {
      throw new Error(
        `Invariant violation: initiative ${id} is missing originatingProjectId`,
      );
    }
    const eventProjectId = originatingProjectId;

    if (currentContext && !currentContext.projectId) {
      currentContext.projectId = eventProjectId;
    }

    // Detect field-level changes for edit history
    const changes = this.detectFieldChanges(
      existingInitiative,
      updateInitiativeDto,
    );

    // If no changes detected, return existing initiative
    if (changes.length === 0) {
      this.logger.debug(
        '[update] No changes detected, returning existing initiative',
        {
          initiativeId: id,
        },
      );
      return existingInitiative;
    }

    const updateData: Prisma.InitiativeUpdateInput = {};

    if (updateInitiativeDto.name !== undefined) {
      updateData.name = updateInitiativeDto.name;
    }
    if (updateInitiativeDto.assigneeId !== undefined) {
      updateData.assignee = updateInitiativeDto.assigneeId
        ? { connect: { id: updateInitiativeDto.assigneeId as string } }
        : { disconnect: true };
    }
    if (updateInitiativeDto.reasoning !== undefined) {
      updateData.reasoning = updateInitiativeDto.reasoning;
    }
    if (updateInitiativeDto.status !== undefined) {
      updateData.status = updateInitiativeDto.status;
    }
    if (updateInitiativeDto.priority !== undefined) {
      updateData.priority = updateInitiativeDto.priority;
    }
    if (updateInitiativeDto.dueDate !== undefined) {
      updateData.dueDate = updateInitiativeDto.dueDate
        ? new Date(updateInitiativeDto.dueDate)
        : null;
    }

    // Set lastModified tracking when user makes changes
    if (userId) {
      updateData.lastModifier = { connect: { id: userId as string } };
      updateData.lastModifiedAt = new Date();
    }

    // Handle tags separately with TagService (don't include in updateData)
    const tagsToUpdate = updateInitiativeDto.tags;
    const updatePayload: UpdateInitiativeDto = {};
    if (updateInitiativeDto.name !== undefined) {
      updatePayload.name = updateInitiativeDto.name;
    }
    if (updateInitiativeDto.assigneeId !== undefined) {
      updatePayload.assigneeId = updateInitiativeDto.assigneeId ?? undefined;
    }
    if (updateInitiativeDto.reasoning !== undefined) {
      updatePayload.reasoning = updateInitiativeDto.reasoning ?? undefined;
    }
    if (updateInitiativeDto.status !== undefined) {
      updatePayload.status = updateInitiativeDto.status;
    }
    if (updateInitiativeDto.priority !== undefined) {
      updatePayload.priority = updateInitiativeDto.priority;
    }
    if (updateInitiativeDto.creatorType !== undefined) {
      updatePayload.creatorType = updateInitiativeDto.creatorType;
    }
    if (updateInitiativeDto.dueDate !== undefined) {
      updatePayload.dueDate = updateInitiativeDto.dueDate ?? undefined;
    }
    if (updateInitiativeDto.tags !== undefined) {
      updatePayload.tags = updateInitiativeDto.tags ?? [];
    }

    const updateSnapshot = buildInitiativeEventUpdateSnapshot(updatePayload);

    // Update initiative and publish event in transaction
    const updatedInitiative = await this.prisma.db.$transaction(async (tx) => {
      const updated = await tx.initiative.update({
        where: { id },
        data: updateData,
      });

      const payload: InitiativeUpdatedEventPayload = {
        payloadType: EVENT_TYPES.INITIATIVE.UPDATED,
        update: updateSnapshot,
        // Enhanced format for edit history
        changes,
        changedBy: userId
          ? {
              userId,
              email: userEmail || 'unknown',
              name: userName || 'Unknown User',
            }
          : undefined,
        totalFieldsChanged: changes.length,
        changeMetadata: {
          timestamp: new Date().toISOString(),
        },
        organizationId,
        projectId: eventProjectId,
        originatingProjectId,
        linkedProjectIds,
      };

      const event: Omit<InitiativeUpdatedEvent, 'id'> = {
        type: EVENT_TYPES.INITIATIVE.UPDATED,
        aggregateId: updated.id,
        payload,
      };

      // Publish updated event
      await this.eventPublisher.publishInTransaction(tx, event);

      // Publish status changed event if status has changed
      if (
        updateInitiativeDto.status &&
        existingInitiative.status !== updateInitiativeDto.status
      ) {
        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.INITIATIVE.STATUS_CHANGED,
          aggregateId: updated.id,
          payload: {
            payloadType: EVENT_TYPES.INITIATIVE.STATUS_CHANGED,
            previousStatus: existingInitiative.status,
            newStatus: updateInitiativeDto.status,
            organizationId,
            projectId: eventProjectId,
            originatingProjectId,
          },
        });
      }

      return updated;
    });

    // Update tags using TagService if provided (after transaction)
    if (tagsToUpdate !== undefined) {
      await this.tagService.syncInitiativeTags(
        id,
        organizationId,
        tagsToUpdate.map((name) => ({
          name,
          source: PrismaTagSource.USER,
        })),
        PrismaTagSource.USER,
      );
    }

    this.logger.log('Initiative updated with events', {
      initiativeId: updatedInitiative.id,
      correlationId: currentContext?.correlationId,
    });

    const updatedWithLinks = this.attachLinkedProjects(
      updatedInitiative,
      linkedProjectIds,
    );

    return updatedWithLinks;
  }

  /**
   * Transaction-aware initiative-update path. Performs the metadata/section
   * writes inside the caller's transaction so the entity write can be atomic
   * with whatever the caller is coordinating (e.g. proposal approval flipping
   * a PlanStage row alongside the backing initiative). Returns the updated
   * initiative row plus a `postCommit` payload describing side effects the
   * caller must run after its tx commits — tag sync and artifact refresh are
   * intentionally outside the tx (they were never atomic with the entity
   * write under the existing {@link update} either).
   *
   * Unlike {@link update}, this path does NOT publish per-field
   * `InitiativeUpdatedEvent` payloads. The proposal-approval enactor that
   * calls it publishes its own `proposal.approved` event with the full
   * approval context, which substitutes for the per-entity update event in
   * the same way {@link DesignDocService.updateInTransaction} works today.
   */
  async updateInTransaction(
    tx: Prisma.TransactionClient,
    id: string,
    updateInitiativeDto: UpdateInitiativeDto,
    organizationId: OrganizationId,
    userId?: UserId,
  ): Promise<{
    initiative: Initiative;
    postCommit: InitiativeUpdatePostCommit;
  }> {
    this.assertNoDirectSectionUpdates(
      updateInitiativeDto as Record<string, unknown>,
    );

    const existing = await tx.initiative.findFirst({
      where: { id, organizationId, archivedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`Initiative ${id} not found`);
    }

    const updateData: Prisma.InitiativeUpdateInput = {};
    if (updateInitiativeDto.name !== undefined) {
      updateData.name = updateInitiativeDto.name;
    }
    if (updateInitiativeDto.assigneeId !== undefined) {
      updateData.assignee = updateInitiativeDto.assigneeId
        ? { connect: { id: updateInitiativeDto.assigneeId as string } }
        : { disconnect: true };
    }
    if (updateInitiativeDto.reasoning !== undefined) {
      updateData.reasoning = updateInitiativeDto.reasoning;
    }
    if (updateInitiativeDto.status !== undefined) {
      updateData.status = updateInitiativeDto.status;
    }
    if (updateInitiativeDto.priority !== undefined) {
      updateData.priority = updateInitiativeDto.priority;
    }
    if (updateInitiativeDto.dueDate !== undefined) {
      updateData.dueDate = updateInitiativeDto.dueDate
        ? new Date(updateInitiativeDto.dueDate)
        : null;
    }
    if (userId) {
      updateData.lastModifier = { connect: { id: userId as string } };
      updateData.lastModifiedAt = new Date();
    }

    const incomingSections = (
      'sections' in updateInitiativeDto &&
      Array.isArray(
        (updateInitiativeDto as InitiativeUpdateInput).sections,
      )
        ? (updateInitiativeDto as InitiativeUpdateInput).sections
        : []
    ) as Array<{ key: string; content: string }>;

    const sectionUpdates = incomingSections.filter((section) =>
      (INITIATIVE_SECTION_FIELDS as readonly string[]).includes(section.key),
    );

    for (const section of sectionUpdates) {
      await tx.initiativeSection.updateMany({
        where: { initiativeId: id, key: section.key },
        data: { materializedMarkdown: section.content },
      });
    }

    let updated: Initiative = existing;
    if (Object.keys(updateData).length > 0) {
      updated = await tx.initiative.update({
        where: { id },
        data: updateData,
      });
    }

    const statusChanged =
      updateInitiativeDto.status !== undefined &&
      existing.status !== updateInitiativeDto.status;

    this.logger.log('[updateInTransaction] applied initiative update', {
      initiativeId: id,
      organizationId,
      fieldsChanged: Object.keys(updateData),
      sectionUpdates: sectionUpdates.length,
      statusChanged,
    });

    return {
      initiative: updated,
      postCommit: {
        tagsToSync:
          updateInitiativeDto.tags !== undefined
            ? (updateInitiativeDto.tags as string[])
            : undefined,
        statusChange:
          statusChanged && updateInitiativeDto.status
            ? {
                previousStatus: existing.status,
                newStatus: updateInitiativeDto.status as string,
              }
            : undefined,
      },
    };
  }

  /**
   * Runs the post-commit side effects produced by
   * {@link updateInTransaction}. Called by the proposal-approval flow once
   * its outer tx has committed, so the side-effect set lives in one place.
   * None of these are load-bearing for atomicity.
   */
  async runUpdatePostCommit(
    organizationId: OrganizationId,
    initiativeId: InitiativeId,
    postCommit: InitiativeUpdatePostCommit,
  ): Promise<void> {
    if (postCommit.tagsToSync !== undefined) {
      this.logger.log('[runUpdatePostCommit] syncing initiative tags', {
        initiativeId,
        organizationId,
        tagCount: postCommit.tagsToSync.length,
      });
      await this.tagService.syncInitiativeTags(
        initiativeId as string,
        organizationId,
        postCommit.tagsToSync.map((name) => ({
          name,
          source: PrismaTagSource.USER,
        })),
        PrismaTagSource.USER,
      );
    }
  }

  @WithEventContext('InitiativeService')
  async remove(id: string, organizationId: OrganizationId) {
    // Set up event context
    this.setupEventContext(organizationId, { initiativeId: id });
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();

    this.logger.log('Soft deleting initiative with events', {
      initiativeId: id,
      correlationId: currentContext?.correlationId,
    });

    // Check if initiative exists and belongs to organization
    const existingInitiative = await this.findOne(id, organizationId);
    if (!existingInitiative) {
      throw new NotFoundException('Initiative not found');
    }
    const eventProjectId =
      existingInitiative.originatingProjectId as ProjectId | null;
    if (!eventProjectId) {
      throw new Error(
        `Invariant violation: initiative ${id} is missing originatingProjectId`,
      );
    }
    if (currentContext && !currentContext.projectId) {
      currentContext.projectId = eventProjectId;
    }

    // Archive initiative and publish event in transaction
    const archivedInitiative =
      await this.executeWithEventTransaction<Initiative>(
        async (tx) => {
          return await tx.initiative.update({
            where: { id },
            data: {
              archivedAt: new Date(),
            },
          });
        },
        (archived) => ({
          type: EVENT_TYPES.INITIATIVE.ARCHIVED,
          aggregateId: archived.id,
          payload: {
            payloadType: EVENT_TYPES.INITIATIVE.ARCHIVED,
            archivedAt:
              archived.archivedAt?.toISOString() || new Date().toISOString(),
            organizationId,
            projectId: eventProjectId,
          },
        }),
        'remove',
      );

    this.logger.log('Initiative soft deleted with events', {
      initiativeId: archivedInitiative.id,
      correlationId: currentContext?.correlationId,
    });

    return archivedInitiative;
  }

  // Project-Initiative relationship management
  @WithEventContext('InitiativeService')
  async linkProject(
    initiativeId: InitiativeId,
    projectId: ProjectId,
    organizationId: OrganizationId,
    role?: string,
  ) {
    // Set up event context
    this.setupEventContext(organizationId, { initiativeId });
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    if (currentContext) {
      currentContext.projectId = projectId;
    }

    this.logger.log('Linking project to initiative with events', {
      initiativeId,
      projectId,
      role,
      correlationId: currentContext?.correlationId,
    });

    // Verify initiative exists and belongs to organization
    const initiative = await this.findOne(initiativeId, organizationId);
    if (!initiative) {
      throw new NotFoundException('Initiative not found');
    }

    // Verify project belongs to same organization
    const project = await this.prisma.db.project.findFirst({
      where: {
        id: projectId,
        organizationId,
        deletedAt: null,
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found in organization');
    }

    // Link project and publish event in transaction
    const projectInitiative = await this.executeWithEventTransaction(
      async (tx) => {
        const createdLink = await tx.projectInitiative.create({
          data: {
            projectId,
            initiativeId,
            role,
          },
        });
        if (!initiative.originatingProjectId) {
          await tx.initiative.update({
            where: { id: initiativeId },
            data: {
              originatingProjectId: projectId,
            },
          });
        }
        return createdLink;
      },
      () => ({
        type: EVENT_TYPES.INITIATIVE.PROJECT_LINKED,
        aggregateId: initiativeId,
        payload: {
          payloadType: EVENT_TYPES.INITIATIVE.PROJECT_LINKED,
          projectId,
          role,
          organizationId,
        },
      }),
      'linkProject',
    );

    this.logger.log('Project linked to initiative with events', {
      initiativeId,
      projectId,
      linkId: projectInitiative.id,
      correlationId: currentContext?.correlationId,
    });

    return projectInitiative;
  }

  @WithEventContext('InitiativeService')
  async unlinkProject(
    initiativeId: InitiativeId,
    projectId: ProjectId,
    organizationId: OrganizationId,
  ) {
    // Set up event context
    this.setupEventContext(organizationId, { initiativeId });
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    if (currentContext) {
      currentContext.projectId = projectId;
    }

    this.logger.log('Unlinking project from initiative with events', {
      initiativeId,
      projectId,
      correlationId: currentContext?.correlationId,
    });

    // Unlink project and publish event in transaction
    const result = await this.prisma.$transaction(async (tx) => {
      const deleteResult = await tx.projectInitiative.deleteMany({
        where: {
          projectId,
          initiativeId,
        },
      });

      // Only publish event if something was actually deleted
      if (deleteResult.count > 0) {
        await this.eventPublisher.publishInTransaction(tx, {
          type: EVENT_TYPES.INITIATIVE.PROJECT_UNLINKED,
          aggregateId: initiativeId,
          payload: {
            payloadType: EVENT_TYPES.INITIATIVE.PROJECT_UNLINKED,
            projectId: projectId,
            organizationId,
          },
        });
      }

      return deleteResult;
    });

    this.logger.log('Project unlinked from initiative with events', {
      initiativeId,
      projectId,
      deletedCount: result.count,
      correlationId: currentContext?.correlationId,
    });

    return result;
  }

  /**
   * Get initiative from conversation
   */
  async getInitiativeFromConversation(
    _conversationId: ConversationId,
    organizationId: OrganizationId,
    initiativeId: string,
  ): Promise<InitiativeDraft | null> {
    // Load initiative from database instead of ephemeral trigger data
    const dbInitiative = await this.findOne(initiativeId, organizationId);

    if (!dbInitiative) {
      return null;
    }

    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      dbInitiative.id,
    ]);
    const sectionContent = extractInitiativeSectionContent(
      sectionsByInitiativeId.get(dbInitiative.id) ?? [],
    );

    // Note: We don't validate sourceConversationId here because initiatives
    // are created in onboarding conversations but may be accessed from refinement conversations

    return {
      id: dbInitiative.id,
      name: dbInitiative.name,
      description: sectionContent.description,
      details: sectionContent.details,
      acceptanceCriteria: sectionContent.acceptanceCriteria,
      reasoning: dbInitiative.reasoning ?? undefined,
      priority:
        this.convertPriorityFromDatabase(dbInitiative.priority as Priority) ??
        undefined,
      tags: dbInitiative.tags ?? [],
      influences: [], // Database initiatives don't have stored influences
    };
  }

  /**
   * Convert database Priority to InitiativeDraft priority format
   */
  private convertPriorityFromDatabase(
    priority: null | string,
  ): 'low' | 'medium' | 'high' | 'critical' | null {
    if (!priority) return null;

    const priorityMap: Record<string, 'low' | 'medium' | 'high' | 'critical'> =
      {
        LOW: 'low',
        MEDIUM: 'medium',
        HIGH: 'high',
        CRITICAL: 'critical',
      };

    return priorityMap[priority.toLocaleUpperCase()] || null;
  }

  // Get projects linked to an initiative
  async getLinkedProjects(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ) {
    return this.prisma.db.projectInitiative.findMany({
      where: {
        initiativeId,
        project: {
          organizationId,
          deletedAt: null,
        },
        initiative: {
          organizationId,
          archivedAt: null,
        },
      },
      include: {
        project: true,
      },
    });
  }

  // Get initiatives linked to a project
  async getProjectInitiatives(
    projectId: string,
    organizationId: OrganizationId,
  ) {
    return this.prisma.db.projectInitiative.findMany({
      where: {
        projectId,
        initiative: {
          organizationId,
          archivedAt: null,
        },
      },
      include: {
        initiative: true,
      },
    });
  }

  // Initiative Refinement Methods

  /**
   * Get the active refinement conversation ID for an initiative
   */
  async getActiveRefinementConversation(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<string | null> {
    // Look for any refinement conversation (including completed ones)
    const conversation = await this.prisma.db.conversation.findFirst({
      where: {
        workflowAboutId: initiativeId,
        workflowName: WorkflowName.InitiativeRefinement,
        // Filter by organization through the project relationship
        organizationId,
      },
      select: {
        id: true,
        status: true,
        title: true,
      },
      orderBy: {
        updatedAt: 'desc', // Get the most recent one
      },
    });

    if (conversation) {
      // Smart conversation status handling - reset conversations to allow continued refinement
      const shouldRestart = (
        [
          ConversationStatus.DELETED,
          ConversationStatus.FAILED,
          ConversationStatus.RECOVERABLE,
        ] as ConversationStatus[]
      ).includes(conversation.status);

      if (shouldRestart) {
        const statusTransitionReason = this.getStatusTransitionReason(
          conversation.status,
        );

        this.logger.debug(
          '[getActiveRefinementConversation] restarting conversation',
          {
            conversationId: conversation.id,
            oldStatus: conversation.status,
            reason: statusTransitionReason,
          },
        );

        await this.prisma.db.conversation.update({
          where: { id: conversation.id },
          data: {
            status: 'IN_PROGRESS',
            title:
              conversation.title?.replace(
                / - (Completed|Failed|Recoverable).*$/,
                '',
              ) || conversation.title,
          },
        });

        this.logger.debug(
          '[getActiveRefinementConversation] restarted conversation',
          {
            conversationId: conversation.id,
            oldStatus: conversation.status,
            newStatus: 'IN_PROGRESS',
            reason: statusTransitionReason,
          },
        );
      }
    }

    console.log('[getActiveRefinementConversation] result', {
      initiativeId,
      organizationId,
      foundConversationId: conversation?.id || null,
      conversationStatus: conversation?.status || null,
    });

    this.logger.debug('[getActiveRefinementConversation] result', {
      initiativeId,
      organizationId,
      foundConversationId: conversation?.id || null,
      conversationStatus: conversation?.status || null,
    });

    return conversation?.id || null;
  }

  /**
   * Get reason for conversation status transition based on old status
   */
  private getStatusTransitionReason(oldStatus: string): string {
    switch (oldStatus) {
      case 'COMPLETED':
        return 'Conversation was completed but user wants to continue refinement';
      case 'FAILED':
        return 'Conversation failed but is being restarted for user access';
      case 'RECOVERABLE':
        return 'Conversation was in recoverable state and is now being resumed';
      default:
        return `Conversation status was ${oldStatus} and is being restarted`;
    }
  }

  /**
   * Clear the active refinement conversation for an initiative
   * This is now just closing the active conversation
   */
  async clearActiveRefinementConversation(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
  ): Promise<void> {
    // Find and close any active refinement conversations
    // Find conversations to update
    const conversations = await this.prisma.db.conversation.findMany({
      where: {
        workflowAboutId: initiativeId,
        workflowName: WorkflowName.InitiativeRefinement,
        organizationId,
        status: {
          in: ['STARTED', 'IN_PROGRESS', 'GENERATING_RESPONSE'],
        },
      },
      select: { id: true },
      take: 20, // Reasonable limit - rarely should have more than a few active conversations
      orderBy: { createdAt: 'desc' },
    });

    // Bulk update all conversations to completed status
    if (conversations.length > 0) {
      this.logger.debug(
        '[completeConversations] Bulk updating conversation status',
        {
          conversationCount: conversations.length,
          organizationId,
        },
      );

      await this.prisma.db.conversation.updateMany({
        where: {
          id: { in: conversations.map((c) => c.id) },
          // Security: organization isolation already enforced by the initial query filter
        },
        data: {
          status: 'COMPLETED',
          updatedAt: new Date(),
        },
      });

      // Note: version increment requires individual updates due to Prisma limitations
      // This could be optimized with raw SQL if version tracking becomes a bottleneck
      if (conversations.length <= 10) {
        // Only do individual version updates for small batches
        await Promise.all(
          conversations.map((conversation) =>
            this.prisma.db.conversation.update({
              where: { id: conversation.id },
              data: { version: { increment: 1 } },
            }),
          ),
        );
      }
    }
  }

  /**
   * Apply refinement changes to an initiative
   */
  @WithEventContext('InitiativeService')
  async applyRefinementChanges(
    initiativeId: InitiativeId,
    changes: {
      name?: string;
      description?: string;
      details?: string;
      acceptanceCriteria?: string;
      assigneeId?: string;
      priority?: Priority;
      tags?: string[];
    },
    organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    const updateData: Prisma.InitiativeUpdateInput = {
      updatedAt: new Date(),
    };
    const sectionUpdates: Array<{
      key: InitiativeSectionField;
      content: string;
    }> = [];

    if (changes.name !== undefined) {
      updateData.name = changes.name;
    }
    if (changes.description !== undefined) {
      sectionUpdates.push({
        key: 'description',
        content: changes.description ?? '',
      });
    }
    if (changes.details !== undefined) {
      sectionUpdates.push({
        key: 'details',
        content: changes.details ?? '',
      });
    }
    if (changes.acceptanceCriteria !== undefined) {
      sectionUpdates.push({
        key: 'acceptanceCriteria',
        content: changes.acceptanceCriteria ?? '',
      });
    }
    if (changes.assigneeId !== undefined) {
      updateData.assignee = changes.assigneeId
        ? { connect: { id: changes.assigneeId } }
        : { disconnect: true };
    }
    if (changes.priority !== undefined) {
      updateData.priority = changes.priority;
    }
    if (changes.tags !== undefined) {
      updateData.tags = changes.tags;
    }
    const updatePayload: UpdateInitiativeDto = {};
    if (changes.name !== undefined) {
      updatePayload.name = changes.name;
    }
    if (changes.assigneeId !== undefined) {
      updatePayload.assigneeId = changes.assigneeId as UserId;
    }
    if (changes.priority !== undefined) {
      updatePayload.priority = changes.priority;
    }
    if (changes.tags !== undefined) {
      updatePayload.tags = changes.tags ?? [];
    }

    if (sectionUpdates.length > 0) {
      await this.applySectionUpdates(
        organizationId,
        initiativeId,
        sectionUpdates,
      );
    }

    const initiative = await this.prisma.db.initiative.update({
      where: {
        id: initiativeId,
        organizationId,
      },
      data: updateData,
    });

    if (!initiative) {
      throw new NotFoundException(`Initiative ${initiativeId} not found`);
    }

    const linkedProjectIds = await this.listLinkedProjectIds(
      initiativeId,
      organizationId,
    );
    const eventProjectId = initiative.originatingProjectId as ProjectId | null;
    if (!eventProjectId) {
      throw new Error(
        `Invariant violation: initiative ${initiativeId} is missing originatingProjectId`,
      );
    }
    if (currentContext && !currentContext.projectId) {
      currentContext.projectId = eventProjectId;
    }

    const updateSnapshot = buildInitiativeEventUpdateSnapshot(updatePayload);

    // Publish event
    await this.eventPublisher.publish({
      type: EVENT_TYPES.INITIATIVE.UPDATED,
      aggregateId: initiative.id,
      payload: {
        payloadType: EVENT_TYPES.INITIATIVE.UPDATED,
        update: updateSnapshot,
        organizationId,
        projectId: eventProjectId,
        originatingProjectId: eventProjectId,
        linkedProjectIds,
      },
    });

    const initiativeWithLinks = this.attachLinkedProjects(
      initiative,
      linkedProjectIds,
    );

    const childCountsMap = await this.buildTaskChildCountsMap(organizationId, [
      initiativeWithLinks.id,
    ]);
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap([
      initiativeWithLinks.id,
    ]);
    return this.convertToApiResponse(
      initiativeWithLinks,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto;
  }

  /**
   * Create initiatives from drafts with original data artifact storage
   * This is the proper way to create initiatives from LLM-generated data
   */
  @WithEventContext('InitiativeService')
  async createFromDrafts(
    drafts: InitiativeDraft[],
    organizationId: OrganizationId,
    projectId: ProjectId,
    sourceConversationId?: ConversationId,
  ): Promise<Array<InitiativeResponseDto>> {
    const contextManager = EventContextManager.getInstance();
    const currentContext = contextManager.getCurrentContext();
    if (currentContext && projectId && !currentContext.projectId) {
      currentContext.projectId = projectId;
    }

    this.logger.log('[createFromDrafts] Creating initiatives from drafts', {
      draftCount: drafts.length,
      organizationId,
      projectId,
      sourceConversationId,
      correlationId: currentContext?.correlationId,
    });

    if (!drafts || drafts.length === 0) {
      throw new Error('Drafts array cannot be empty');
    }

    const createdInitiatives: Initiative[] = [];
    const originalDataForArtifacts: Array<{
      id: InitiativeId;
      originalData: InitiativeOriginalData;
    }> = [];

    for (const draft of drafts) {
      try {
        // Map draft priority to Prisma enum
        const priority = this.mapDraftPriorityToPrisma(draft.priority);

        // Create initiative in database
        const initiative = await this.prisma.db.initiative.create({
          data: {
            name: draft.name,
            reasoning: draft.reasoning,
            organizationId,
            status: 'REFINING_DESCRIPTION',
            priority,
            sourceConversationId,
            originatingProjectId: projectId,
            sections: {
              create: this.buildInitiativeSectionCreatePayload({
                description: draft.description,
                details: draft.details,
                acceptanceCriteria: draft.acceptanceCriteria,
              }),
            },
          },
        });

        this.logger.debug('[createFromDrafts] Created initiative', {
          initiativeId: initiative.id,
          name: initiative.name,
          status: initiative.status,
        });

        // Link to project
        if (projectId) {
          await this.prisma.db.projectInitiative.create({
            data: {
              projectId,
              initiativeId: initiative.id,
            },
          });
        }

        // Create tags if provided
        await this.handleInitiativeTags(
          initiative.id,
          organizationId,
          draft.tags,
          PrismaTagSource.SYSTEM_FAST,
        );

        // Prepare original data for artifact storage
        originalDataForArtifacts.push({
          id: initiative.id,
          originalData: {
            name: draft.name,
            description: draft.description,
            details: draft.details,
            acceptanceCriteria: draft.acceptanceCriteria,
            priority: draft.priority || 'medium',
            estimatedEffort: draft.estimatedEffort,
            tags: draft.tags || [],
            reasoning: draft.reasoning,
            influences: draft.influences,
          },
        });

        createdInitiatives.push(initiative);
        // Publish domain event
        const payload = buildInitiativeCreatedEventPayload({
          initiative,
          projectId,
          linkedProjectIds: projectId ? [projectId] : [],
          content: buildInitiativeEventContentSnapshot({
            description: draft.description,
            details: draft.details,
            acceptanceCriteria: draft.acceptanceCriteria,
          }),
        });
        await this.eventPublisher.publish({
          type: EVENT_TYPES.INITIATIVE.CREATED,
          aggregateId: initiative.id,
          payload,
        });
      } catch (error) {
        this.logger.error('[createFromDrafts] Failed to create initiative', {
          error: (error as Error).message,
          draftId: draft.id,
          draftName: draft.name,
        });
        throw error;
      }
    }

    // Store original LLM-generated data as artifacts for change detection
    const initiativesForArtifacts = originalDataForArtifacts.map((item) => {
      const result = createdInitiatives.find((r) => r.id === item.id);
      return {
        id: item.id,
        name: item.originalData.name,
        description: item.originalData.description ?? '',
        details: item.originalData.details ?? '',
        acceptanceCriteria: item.originalData.acceptanceCriteria ?? '',
        priority:
          this.convertPriorityFromDatabase(item.originalData.priority) ??
          undefined,
        reasoning: item.originalData.reasoning ?? undefined,
        status: result?.status || WorkStatus.RefiningDescription,
        tags: item.originalData.tags ?? [],
        influences: item.originalData.influences,
      };
    });

    // Extract LLM-generated influences from drafts for traceability
    const influences = drafts.flatMap((draft) => draft.influences);

    this.logger.debug('[createFromDrafts] Using LLM-generated influences', {
      influenceCount: influences.length,
      totalDrafts: drafts.length,
      correlationId: currentContext?.correlationId,
    });

    await this.storeOriginalArtifactIfNeeded(
      initiativesForArtifacts,
      organizationId,
      projectId,
      {
        sourceId: sourceConversationId,
        generationModel: 'llm-generated',
        generationPrompt: 'initiative-generation',
        originalRequestContext: { source: 'onboarding-flow' },
      },
      'createFromDrafts',
    );

    this.logger.log(
      '[createFromDrafts] Successfully created initiatives from drafts',
      {
        createdCount: createdInitiatives.length,
        organizationId,
        projectId,
        correlationId: currentContext?.correlationId,
      },
    );

    const childCountsMap = await this.buildTaskChildCountsMap(
      organizationId,
      createdInitiatives.map((initiative) => initiative.id),
    );
    const sectionsByInitiativeId = await this.loadInitiativeSectionsMap(
      createdInitiatives.map((initiative) => initiative.id),
    );
    return this.convertToApiResponse(
      createdInitiatives,
      childCountsMap,
      undefined,
      sectionsByInitiativeId,
    ) as InitiativeResponseDto[];
  }

  /**
   * Get conversation influences for initiative generation tracking
   */
  private async getConversationInfluences(
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<
    Array<{ artifactId: string; reasoning: string; reasonType: string }>
  > {
    try {
      // Fetch conversation artifacts
      const artifacts = await this.artifactService.findMany(
        {
          sourceId: conversationId,
          sourceType: 'CONVERSATION',
          status: 'ACTIVE',
          limit: 50,
        },
        organizationId,
      );

      // Map to influence structure
      return (
        artifacts?.data?.map((artifact: { id: string }) => ({
          artifactId: artifact.id,
          reasoning: 'Conversation context informed initiative design',
          reasonType: 'context',
        })) || []
      );
    } catch (error) {
      this.logger.warn('Failed to fetch conversation influences', {
        conversationId,
        organizationId,
        error: (error as Error).message,
      });
      return [];
    }
  }

  /**
   * Map draft priority to Prisma priority enum
   */
  private mapDraftPriorityToPrisma(priority?: string): Priority {
    if (!priority) return Priority.Medium;

    const mapping = {
      low: Priority.Low,
      medium: Priority.Medium,
      high: Priority.High,
      critical: Priority.Critical,
    };

    return (
      mapping[priority.toLowerCase() as keyof typeof mapping] || Priority.Medium
    );
  }

  /**
   * Detect field-level changes between original and updated initiative
   */
  private detectFieldChanges(
    original: Initiative,
    update: UpdateInitiativeDto,
  ): Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
    dataType: string;
  }> {
    const changes: Array<{
      field: string;
      oldValue: unknown;
      newValue: unknown;
      dataType: string;
    }> = [];

    // Define trackable fields
    const trackableFields: Array<keyof UpdateInitiativeDto> = [
      'name',
      'assigneeId',
      'priority',
      'status',
      'tags',
      'dueDate',
      'reasoning',
    ];

    for (const field of trackableFields) {
      if (field in update) {
        const oldValue = this.getOriginalValue(original, field);
        const newValue = update[field];

        // Deep comparison for complex types
        if (!this.isEqual(oldValue, newValue)) {
          changes.push({
            field,
            oldValue: this.serializeValue(oldValue),
            newValue: this.serializeValue(newValue),
            dataType: this.getDataType(newValue),
          });
        }
      }
    }

    return changes;
  }

  /**
   * Get the original value from the initiative for comparison
   */
  private getOriginalValue(
    original: Initiative,
    field: keyof UpdateInitiativeDto,
  ): unknown {
    switch (field) {
      case 'assigneeId':
        return original.assigneeId;
      case 'dueDate':
        return original.dueDate?.toISOString() || null;
      default:
        return original[field as keyof Initiative];
    }
  }

  /**
   * Deep equality comparison for detecting changes
   */
  private isEqual(a: unknown, b: unknown): boolean {
    // Handle null/undefined cases
    if (a === b) return true;
    if (a == null || b == null) return false;

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      return (
        a.length === b.length &&
        a.every((val, idx) => this.isEqual(val, b[idx]))
      );
    }

    // Handle objects
    if (typeof a === 'object' && typeof b === 'object') {
      const recordA = a as Record<string, unknown>;
      const recordB = b as Record<string, unknown>;
      const keysA = Object.keys(recordA);
      const keysB = Object.keys(recordB);
      return (
        keysA.length === keysB.length &&
        keysA.every((key) => this.isEqual(recordA[key], recordB[key]))
      );
    }

    return false;
  }

  /**
   * Serialize value for storage in event payload
   */
  private serializeValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (typeof value === 'object') return JSON.parse(JSON.stringify(value));
    return value;
  }

  /**
   * Get data type string for field changes
   */
  private getDataType(value: unknown): string {
    if (value === null) return 'null';
    if (Array.isArray(value)) return 'array';
    return typeof value;
  }
}

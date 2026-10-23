import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  EntitySummary,
  EntityType,
  Prisma,
  SummaryCategory,
  Subfacet,
  SubfacetStatus,
} from '@prisma/client';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { EventContextManager } from 'src/core/events/observable-event.context';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import {
  EVENT_TYPES,
  SummaryEventType,
} from 'src/core/events/types/event.types';
import {
  ExecutionContext,
  SummaryCreatedEventPayload,
  SummaryDeletedEventPayload,
  SummaryPayload,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId } from 'src/types';
import { SubfacetService } from './subfacet.service';

export interface CreateEntitySummaryInput {
  entityType: EntityType;
  entityId: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  summary: string;
  category: SummaryCategory;
  subfacets: string[];
}

@Injectable()
export class EntitySummaryService {
  private readonly logger = new Logger(EntitySummaryService.name);
  private readonly maxSubfacets = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly subfacetService: SubfacetService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
  ) {}

  async getCurrentSummariesByCategory(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category?: SummaryCategory;
    subfacetIds?: string[];
    entities?: Array<{ entityType: EntityType; entityId: string }>;
    limitPerSubfacet?: number;
    since?: Date;
    take?: number;
  }): Promise<
    Array<{
      entityType: EntityType;
      entityId: string;
      summary: string;
      category: SummaryCategory;
      updatedAt: Date;
      subfacets: Array<{ id: string; name: string; updatedAt: Date }>;
    }>
  > {
    const {
      organizationId,
      projectId,
      category,
      subfacetIds,
      entities,
      limitPerSubfacet = 10,
      since,
      take,
    } = params;
    const entityFilters = entities?.length
      ? Array.from(
          new Map(
            entities.map((entity) => [
              `${entity.entityType}:${entity.entityId}`,
              entity,
            ]),
          ).values(),
        )
      : undefined;
    const summaries = await this.prisma.db.entitySummary.findMany({
      where: {
        organizationId,
        projectId,
        isCurrent: true,
        ...(category ? { category } : {}),
        ...(subfacetIds?.length
          ? { subfacets: { some: { subfacetId: { in: subfacetIds } } } }
          : {}),
        ...(entityFilters?.length
          ? {
              OR: entityFilters.map((entity) => ({
                entityType: entity.entityType,
                entityId: entity.entityId,
              })),
            }
          : {}),
        ...(since ? { updatedAt: { gte: since } } : {}),
      },
      include: {
        subfacets: {
          include: {
            subfacet: true,
          },
          where: { subfacet: { status: SubfacetStatus.ACTIVE } },
          take: limitPerSubfacet,
          orderBy: [{ rank: 'asc' }, { updatedAt: 'desc' }],
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...(typeof take === 'number' ? { take } : {}),
    });

    return summaries.map((s) => ({
      entityType: s.entityType,
      entityId: s.entityId,
      summary: s.summary,
      category: s.category,
      updatedAt: s.updatedAt,
      subfacets: (s.subfacets || []).map((sf) => ({
        id: sf.subfacet.id,
        name: sf.subfacet.name,
        updatedAt: sf.subfacet.updatedAt,
      })),
    }));
  }

  async getCurrentSummariesForEntities(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    entities: Array<{ entityType: EntityType; entityId: string }>;
  }): Promise<
    Array<{
      entityType: EntityType;
      entityId: string;
      summary: string;
      updatedAt: Date;
    }>
  > {
    const { organizationId, projectId, entities } = params;
    const uniqueEntities = new Map<
      string,
      { entityType: EntityType; entityId: string }
    >();

    for (const entity of entities) {
      const key = `${entity.entityType}:${entity.entityId}`;
      if (!uniqueEntities.has(key)) {
        uniqueEntities.set(key, entity);
      }
    }

    if (uniqueEntities.size === 0) {
      return [];
    }

    const summaries = await this.prisma.db.entitySummary.findMany({
      where: {
        organizationId,
        projectId,
        isCurrent: true,
        OR: Array.from(uniqueEntities.values()).map((entity) => ({
          entityType: entity.entityType,
          entityId: entity.entityId,
        })),
      },
      select: {
        entityType: true,
        entityId: true,
        summary: true,
        updatedAt: true,
      },
    });

    return summaries.map((summary) => ({
      entityType: summary.entityType,
      entityId: summary.entityId,
      summary: summary.summary,
      updatedAt: summary.updatedAt,
    }));
  }

  async getCurrentSummariesForSubfacet(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    subfacetId: string;
    category?: SummaryCategory;
    since?: Date;
    take?: number;
  }): Promise<
    Array<{
      entityType: EntityType;
      entityId: string;
      summary: string;
      updatedAt: Date;
    }>
  > {
    const { organizationId, projectId, subfacetId, category, since, take } =
      params;
    if (!subfacetId) {
      return [];
    }

    const summaries = await this.prisma.db.entitySummary.findMany({
      where: {
        organizationId,
        projectId,
        isCurrent: true,
        ...(category ? { category } : {}),
        ...(since ? { updatedAt: { gte: since } } : {}),
        subfacets: {
          some: { subfacetId },
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...(typeof take === 'number' ? { take } : {}),
    });

    return summaries.map((summary) => ({
      entityType: summary.entityType,
      entityId: summary.entityId,
      summary: summary.summary,
      updatedAt: summary.updatedAt,
    }));
  }

  async getSubfacetCurrentSummaryCounts(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    subfacetId: string;
    category?: SummaryCategory;
    since?: Date;
  }): Promise<{ totalCurrent: number; changedSinceCutoff: number }> {
    const { organizationId, projectId, subfacetId, category, since } = params;
    if (!subfacetId) {
      return { totalCurrent: 0, changedSinceCutoff: 0 };
    }

    const baseWhere: Prisma.EntitySummaryWhereInput = {
      organizationId,
      projectId,
      isCurrent: true,
      ...(category ? { category } : {}),
      subfacets: {
        some: { subfacetId },
      },
    };

    const totalCurrent = await this.prisma.db.entitySummary.count({
      where: baseWhere,
    });

    if (!since) {
      return {
        totalCurrent,
        changedSinceCutoff: totalCurrent,
      };
    }

    const changedSinceCutoff = await this.prisma.db.entitySummary.count({
      where: {
        ...baseWhere,
        updatedAt: { gte: since },
      },
    });

    return { totalCurrent, changedSinceCutoff };
  }

  async getCurrentSummariesForSubfacetNames(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    subfacetNames: string[];
    category?: SummaryCategory;
    statuses?: SubfacetStatus[];
    take?: number;
  }): Promise<
    Array<{
      entityType: EntityType;
      entityId: string;
      summary: string;
      category: SummaryCategory;
      updatedAt: Date;
      subfacets: Array<{ id: string; name: string; updatedAt: Date }>;
    }>
  > {
    const {
      organizationId,
      projectId,
      subfacetNames,
      category,
      statuses = [SubfacetStatus.ACTIVE],
      take,
    } = params;
    const names = (subfacetNames || []).map((n) => n.trim()).filter(Boolean);
    if (!names.length) {
      return [];
    }
    if (!statuses.length) {
      return [];
    }

    const caseInsensitiveNameFilter = names.map((name) => ({
      name: { equals: name, mode: 'insensitive' as const },
    }));

    const summaries = await this.prisma.db.entitySummary.findMany({
      where: {
        organizationId,
        projectId,
        isCurrent: true,
        ...(category ? { category } : {}),
        subfacets: {
          some: {
            subfacet: {
              OR: caseInsensitiveNameFilter,
              status: { in: statuses },
              ...(category ? { category } : {}),
            },
          },
        },
      },
      include: {
        subfacets: {
          include: {
            subfacet: true,
          },
          where: { subfacet: { status: { in: statuses } } },
          orderBy: [{ rank: 'asc' }, { updatedAt: 'desc' }],
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...(typeof take === 'number' ? { take } : {}),
    });

    return summaries.map((s) => ({
      entityType: s.entityType,
      entityId: s.entityId,
      summary: s.summary,
      category: s.category,
      updatedAt: s.updatedAt,
      subfacets: (s.subfacets || []).map((sf) => ({
        id: sf.subfacet.id,
        name: sf.subfacet.name,
        updatedAt: sf.subfacet.updatedAt,
      })),
    }));
  }

  async createSummaryWithSubfacets(
    input: CreateEntitySummaryInput,
  ): Promise<{ summary: EntitySummary; subfacets: Subfacet[] }> {
    const subfacetNames = (input.subfacets || []).slice(0, this.maxSubfacets);
    this.logger.debug('[createSummaryWithSubfacets] resolving subfacets', {
      entityType: input.entityType,
      entityId: input.entityId,
      organizationId: input.organizationId,
      category: input.category,
      subfacetNames,
    });

    const resolvedSubfacets =
      await this.subfacetService.createSubfacetsWithDeduping({
        names: subfacetNames,
        category: input.category,
        max: this.maxSubfacets,
        organizationId: input.organizationId,
        projectId: input.projectId,
      });

    this.logger.debug('[createSummaryWithSubfacets] subfacets resolved', {
      entityType: input.entityType,
      entityId: input.entityId,
      organizationId: input.organizationId,
      category: input.category,
      resolvedSubfacetIds: resolvedSubfacets.map((sf) => sf.id),
    });

    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.entitySummary.findFirst({
        where: {
          entityType: input.entityType,
          entityId: input.entityId,
          organizationId: input.organizationId,
          projectId: input.projectId,
        },
        orderBy: { version: 'desc' },
      });

      const nextVersion = (latest?.version ?? 0) + 1;

      if (latest) {
        await tx.entitySummary.updateMany({
          where: {
            entityType: input.entityType,
            entityId: input.entityId,
            organizationId: input.organizationId,
            projectId: input.projectId,
            isCurrent: true,
          },
          data: { isCurrent: false },
        });
      }

      const summary = await tx.entitySummary.create({
        data: {
          entityType: input.entityType,
          entityId: input.entityId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          summary: input.summary,
          category: input.category,
          version: nextVersion,
          isCurrent: true,
        },
      });

      const facetsToLink = resolvedSubfacets.slice(0, this.maxSubfacets);
      for (const [index, subfacet] of facetsToLink.entries()) {
        await tx.entitySubfacet.create({
          data: {
            summaryId: summary.id,
            entityType: input.entityType,
            entityId: input.entityId,
            subfacetId: subfacet.id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            rank: index + 1,
          },
        });
      }

      this.logger.debug('[createSummaryWithSubfacets] Summary created', {
        entityType: input.entityType,
        entityId: input.entityId,
        organizationId: input.organizationId,
        version: nextVersion,
        subfacetCount: facetsToLink.length,
      });

      await this.publishSummaryEvents(
        tx,
        summary,
        facetsToLink,
        latest ? EVENT_TYPES.SUMMARY.UPDATED : EVENT_TYPES.SUMMARY.CREATED,
        input.entityType,
      );

      return { summary, subfacets: facetsToLink };
    });
  }

  /**
   * Rewrites current summaries that still reference deprecated subfacets by removing them.
   * Creates a new current summary version for each affected entity.
   */
  async removeDeprecatedSubfacetsFromCurrentSummaries(params: {
    organizationId: OrganizationId;
    category?: SummaryCategory;
    take?: number;
    projectId: ProjectId;
  }): Promise<{ processed: number; updated: number; skipped: number }> {
    const { organizationId, projectId, category, take } = params;
    const summaries = await this.prisma.db.entitySummary.findMany({
      where: {
        organizationId,
        projectId,
        isCurrent: true,
        ...(category ? { category } : {}),
        subfacets: {
          some: { subfacet: { status: SubfacetStatus.DEPRECATED } },
        },
      },
      include: {
        subfacets: {
          include: { subfacet: true },
          orderBy: [{ rank: 'asc' }, { updatedAt: 'desc' }],
        },
      },
      orderBy: { updatedAt: 'desc' },
      ...(typeof take === 'number' ? { take } : {}),
    });

    let updated = 0;
    let skipped = 0;

    for (const summary of summaries) {
      const activeNames = summary.subfacets
        .filter((sf) => sf.subfacet.status === SubfacetStatus.ACTIVE)
        .map((sf) => sf.subfacet.name);

      const nextNames = Array.from(new Set(activeNames)).slice(
        0,
        this.maxSubfacets,
      );

      const hasDeprecated = summary.subfacets.some(
        (sf) => sf.subfacet.status === SubfacetStatus.DEPRECATED,
      );
      const noChange =
        !hasDeprecated &&
        summary.subfacets.length === nextNames.length &&
        summary.subfacets.every(
          (sf, idx) => sf.subfacet.name === nextNames[idx],
        );

      if (noChange) {
        skipped += 1;
        continue;
      }

      await this.createSummaryWithSubfacets({
        entityType: summary.entityType,
        entityId: summary.entityId,
        organizationId: summary.organizationId,
        projectId: summary.projectId,
        summary: summary.summary,
        category: summary.category,
        subfacets: nextNames,
      });
      updated += 1;
    }

    return { processed: summaries.length, updated, skipped };
  }

  async deactivateCurrentSummaries(params: {
    organizationId: OrganizationId;
    entityType: EntityType;
    entityId: string;
    projectId: ProjectId;
  }): Promise<void> {
    const { organizationId, projectId, entityType, entityId } = params;
    await this.prisma.$transaction(async (tx) => {
      const currentSummaries = await tx.entitySummary.findMany({
        where: {
          organizationId,
          projectId,
          entityType,
          entityId,
          isCurrent: true,
        },
        include: {
          subfacets: {
            include: { subfacet: true },
            orderBy: [{ rank: 'asc' }, { updatedAt: 'desc' }],
          },
        },
      });

      if (!currentSummaries.length) {
        return;
      }

      await tx.entitySummary.updateMany({
        where: {
          organizationId,
          projectId,
          entityType,
          entityId,
          isCurrent: true,
        },
        data: {
          isCurrent: false,
        },
      });

      for (const summary of currentSummaries) {
        await this.publishSummaryDeletedEvents(tx, summary);
      }
    });
  }

  private buildSummaryEventBase(
    summary: EntitySummary,
  ): Omit<ExecutionContext, 'payloadType'> {
    const context = EventContextManager.getInstance().getCurrentContext();
    const projectId =
      (context?.projectId as ProjectId | undefined) ??
      (summary.projectId as ProjectId | undefined);

    if (!projectId) {
      throw new Error(
        '[buildSummaryEventBase] Project ID is required for summary events',
      );
    }

    return {
      organizationId: summary.organizationId as OrganizationId,
      projectId,
      requestId: context?.metadata?.requestId,
      workflowId: context?.workflowId ?? undefined,
      nodeId: context?.metadata?.nodeId,
      conversationId: context?.conversationId ?? undefined,
      userId: context?.userId ?? undefined,
      messageId: context?.messageId ?? undefined,
      correlationId: context?.correlationId,
      causationId: context?.causationId ?? undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private async publishSummaryEvents(
    tx: Prisma.TransactionClient,
    summary: EntitySummary,
    subfacets: Subfacet[],
    eventType: SummaryEventType,
    entityType: string,
  ): Promise<void> {
    const namedSubfacets = subfacets.filter((sf) => !!sf.name);
    const subfacetNames = namedSubfacets.map((sf) => sf.name);

    const basePayload = this.buildSummaryEventBase(summary);
    const summaryPayload: SummaryPayload = {
      summary: summary.summary,
      category: summary.category as SummaryPayload.CategoryEnum,
      subfacets: subfacetNames,
    };

    if (!subfacetNames.length) {
      this.logger.warn(
        '[publishSummaryEvents] No named subfacets linked to summary, skipping event emission',
        { summaryId: summary.id, eventType },
      );
      return;
    }

    if (namedSubfacets.length !== subfacets.length) {
      this.logger.warn(
        '[publishSummaryEvents] Dropping subfacets without names before emitting events',
        {
          summaryId: summary.id,
          dropped: subfacets.length - namedSubfacets.length,
        },
      );
    }

    const payload: SummaryCreatedEventPayload = {
      payloadType: eventType,
      ...basePayload,
      entityId: summary.entityId,
      entityType: summary.entityType,
      summary: summaryPayload,
      category: summary.category as SummaryPayload.CategoryEnum,
      subfacets: subfacetNames,
    };

    await this.eventPublisher.publishInTransaction(tx, {
      type: eventType,
      aggregateId: summary.id,
      payload,
    });
  }

  private async publishSummaryDeletedEvents(
    tx: Prisma.TransactionClient,
    summary: EntitySummary & {
      subfacets: Array<{ subfacet: Subfacet }>;
    },
  ): Promise<void> {
    const namedSubfacets = summary.subfacets.filter(
      ({ subfacet }) => !!subfacet?.name,
    );
    const subfacetNames = namedSubfacets.map(({ subfacet }) => subfacet.name);

    if (!subfacetNames.length) {
      this.logger.warn(
        '[publishSummaryDeletedEvents] No named subfacets; skipping deletion events',
        { summaryId: summary.id },
      );
      return;
    }

    if (namedSubfacets.length !== summary.subfacets.length) {
      this.logger.warn(
        '[publishSummaryDeletedEvents] Dropping subfacets without names before emitting deletion events',
        {
          summaryId: summary.id,
          dropped: summary.subfacets.length - namedSubfacets.length,
        },
      );
    }

    const basePayload = this.buildSummaryEventBase(summary);
    const payload: SummaryDeletedEventPayload = {
      payloadType: EVENT_TYPES.SUMMARY.DELETED,
      ...basePayload,
      entityId: summary.entityId,
      entityType: summary.entityType,
      category: summary.category as SummaryPayload.CategoryEnum,
      subfacets: subfacetNames,
    };

    await this.eventPublisher.publishInTransaction(tx, {
      type: EVENT_TYPES.SUMMARY.DELETED,
      aggregateId: summary.id,
      payload,
    });
  }
}

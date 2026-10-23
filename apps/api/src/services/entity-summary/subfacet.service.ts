import { Injectable, Logger } from '@nestjs/common';
import {
  Prisma,
  Subfacet,
  SubfacetStatus,
  SummaryCategory,
} from '@prisma/client';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { EventContextManager } from 'src/core/events/observable-event.context';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { SubfacetCreatedEventPayload } from 'src/generated/model/subfacetCreatedEventPayload';
import { SubfacetDeprecatedEventPayload } from 'src/generated/model/subfacetDeprecatedEventPayload';
import { TopologySubfacetDto } from 'src/generated/model/topologySubfacetDto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExecutionContext } from 'src/types/execution-context';
import { OrganizationId, ProjectId } from 'src/types';
import {
  ACTIVE_CAP_PER_CATEGORY,
  PROMOTE_TO_ACTIVE_SURVIVAL_COUNT,
} from './subfacet-lifecycle.policy';

type NormalizedFacet = {
  slug: string;
  tokens: string[];
};

type ExistingFacet = {
  subfacet: Subfacet;
  normalized: NormalizedFacet;
};

type SubfacetDbClient = Pick<PrismaService['db'], 'subfacet'>;
type SubfacetLifecycleEventType =
  (typeof EVENT_TYPES.SUBFACET)[keyof typeof EVENT_TYPES.SUBFACET];

interface ResolveSubfacetParams {
  names: string[];
  category: SummaryCategory;
  max?: number;
  similarityThreshold?: number;
  summaries?: Record<string, string | undefined>;
  organizationId: OrganizationId;
  projectId: ProjectId;
}

interface CreateSubfacetParams {
  names: string[];
  category: SummaryCategory;
  max?: number;
  summaries?: Record<string, string | undefined>;
  organizationId: OrganizationId;
  projectId: ProjectId;
}

interface DeprecateSubfacetsParams {
  names: string[];
  category: SummaryCategory;
  organizationId: OrganizationId;
  projectId: ProjectId;
}

interface UpdateSubfacetSummaryParams {
  subfacetId: string;
  summary: string;
}

interface PromoteProvisionalsToActiveParams {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category: SummaryCategory;
  minSurvivalCount?: number;
  limit?: number;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class SubfacetService {
  private readonly logger = new Logger(SubfacetService.name);
  private readonly defaultMax = 3;
  private readonly defaultSimilarityThreshold = 0.45;
  private readonly stopwords = new Set(['system', 'systems', 'based']);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventPublisher: DomainEventPublisher,
  ) {}

  async createSubfacetsWithDeduping(
    params: ResolveSubfacetParams,
  ): Promise<Subfacet[]> {
    const max = params.max ?? this.defaultMax;
    const similarityThreshold =
      params.similarityThreshold ?? this.defaultSimilarityThreshold;
    const inputNames = (params.names || [])
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, max);

    if (!inputNames.length) {
      this.logger.debug('[createSubfacetsWithDeduping] no names provided', {
        category: params.category,
      });
      return [];
    }

    this.logger.debug('[createSubfacetsWithDeduping] resolving subfacets', {
      category: params.category,
      requestedNames: inputNames,
      max,
      similarityThreshold,
    });

    const existing = await this.prisma.db.subfacet.findMany({
      where: {
        category: params.category,
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
    });

    const usedSlugs = new Set(existing.map((facet) => facet.slug));
    const activeExisting = existing.filter(
      (facet) => facet.status !== SubfacetStatus.DEPRECATED,
    );
    const normalizedExisting: ExistingFacet[] = activeExisting.map((facet) => ({
      subfacet: facet,
      normalized: this.normalize(facet.name),
    }));
    const activeNameMap = new Map(
      normalizedExisting.map((entry) => [
        entry.normalized.slug,
        entry.subfacet,
      ]),
    );

    const results: Subfacet[] = [];
    let createdCount = 0;

    for (const name of inputNames) {
      const normalized = this.normalize(name);

      const exactMatch = activeNameMap.get(normalized.slug);
      if (exactMatch && !results.find((r) => r.id === exactMatch.id)) {
        results.push(exactMatch);
        continue;
      }

      const best = this.findBestMatch(normalized, normalizedExisting);
      if (
        best &&
        best.score >= similarityThreshold &&
        !results.find((r) => r.id === best.subfacet.id)
      ) {
        results.push(best.subfacet);
        continue;
      }

      const created = await this.createSubfacetRecord({
        name,
        category: params.category,
        usedSlugs,
        summary: params.summaries?.[name],
        organizationId: params.organizationId,
        projectId: params.projectId,
      });

      usedSlugs.add(created.slug);
      normalizedExisting.push({
        subfacet: created,
        normalized: this.normalize(created.name),
      });
      results.push(created);
      createdCount += 1;

      if (results.length >= max) {
        break;
      }
    }

    this.logger.debug('[createSubfacetsWithDeduping] resolved subfacets', {
      category: params.category,
      requestedCount: inputNames.length,
      returnedCount: results.length,
      createdCount,
    });

    return results.slice(0, max);
  }

  async createSubfacets(params: CreateSubfacetParams): Promise<Subfacet[]> {
    const max = params.max ?? this.defaultMax;
    const inputNames = (params.names || [])
      .map((name) => name.trim())
      .filter(Boolean)
      .slice(0, max);

    if (!inputNames.length) {
      this.logger.debug('[createSubfacets] no names provided', {
        category: params.category,
      });
      return [];
    }

    this.logger.debug('[createSubfacets] creating subfacets', {
      category: params.category,
      requestedNames: inputNames,
      max,
    });

    const existing = await this.prisma.db.subfacet.findMany({
      where: {
        category: params.category,
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
    });

    const usedSlugs = new Set(existing.map((facet) => facet.slug));
    const activeExisting = existing.filter(
      (facet) => facet.status !== SubfacetStatus.DEPRECATED,
    );
    const activeNameMap = new Map(
      activeExisting.map((facet) => [this.normalize(facet.name).slug, facet]),
    );
    const results: Subfacet[] = [];

    for (const name of inputNames) {
      const normalized = this.normalize(name);
      const existingActive = activeNameMap.get(normalized.slug);
      if (existingActive && !results.find((r) => r.id === existingActive.id)) {
        results.push(existingActive);
        continue;
      }
      const created = await this.createSubfacetRecord({
        name,
        category: params.category,
        usedSlugs,
        summary: params.summaries?.[name],
        organizationId: params.organizationId,
        projectId: params.projectId,
      });
      results.push(created);
      usedSlugs.add(created.slug);

      if (results.length >= max) {
        break;
      }
    }

    this.logger.debug('[createSubfacets] created subfacets', {
      category: params.category,
      requestedCount: inputNames.length,
      returnedCount: results.length,
    });

    return results.slice(0, max);
  }

  async deprecateSubfacets(
    params: DeprecateSubfacetsParams,
  ): Promise<{ count: number }> {
    const names = (params.names || []).map((n) => n.trim()).filter(Boolean);
    if (!names.length) {
      this.logger.debug('[deprecateSubfacets] no names provided', {
        category: params.category,
      });
      return { count: 0 };
    }

    this.logger.debug('[deprecateSubfacets] deprecating subfacets', {
      category: params.category,
      organizationId: params.organizationId,
      projectId: params.projectId,
      names,
    });

    const deprecationResult = await this.deprecateActiveSubfacets({
      where: {
        category: params.category,
        organizationId: params.organizationId,
        projectId: params.projectId,
        name: { in: names },
      },
    });

    this.logger.debug('[deprecateSubfacets] deprecated subfacets', {
      category: params.category,
      count: deprecationResult.count,
    });

    return deprecationResult;
  }

  async listSubfacets(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category?: SummaryCategory;
    status?: SubfacetStatus;
    orderByUpdatedAtDesc?: boolean;
    take?: number;
    skip?: number;
  }): Promise<Subfacet[]> {
    return this.prisma.db.subfacet.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        ...(params?.category ? { category: params.category } : {}),
        ...(params?.status ? { status: params.status } : {}),
      },
      orderBy: params?.orderByUpdatedAtDesc
        ? { updatedAt: 'desc' }
        : { name: 'asc' },
      ...(typeof params?.take === 'number' ? { take: params.take } : {}),
      ...(typeof params?.skip === 'number' ? { skip: params.skip } : {}),
    });
  }

  async getSubfacetById(subfacetId: string): Promise<Subfacet | null> {
    if (!subfacetId) return null;
    return this.prisma.db.subfacet.findUnique({ where: { id: subfacetId } });
  }

  async updateSummary(params: UpdateSubfacetSummaryParams): Promise<Subfacet> {
    const now = new Date();
    return this.prisma.db.subfacet.update({
      where: { id: params.subfacetId },
      data: {
        summary: params.summary,
        lastSummarizedAt: now,
      },
    });
  }

  async createProvisionalSubfacet(params: {
    name: string;
    category: SummaryCategory;
    organizationId: OrganizationId;
    projectId: ProjectId;
    summary?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<Subfacet> {
    const db = this.getSubfacetDbClient(params.tx);
    const normalizedSlug =
      this.normalize(params.name).slug || this.slugify(params.name);
    const existing = await db.subfacet.findFirst({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category: params.category,
        slug: normalizedSlug,
        status: {
          in: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
        },
      },
    });
    if (existing) {
      return existing;
    }

    const usedSlugs = new Set(
      (
        await db.subfacet.findMany({
          where: {
            organizationId: params.organizationId,
            projectId: params.projectId,
            category: params.category,
          },
          select: { slug: true },
        })
      ).map((entry) => entry.slug),
    );

    return this.createSubfacetRecord({
      name: params.name,
      category: params.category,
      usedSlugs,
      summary: params.summary,
      status: SubfacetStatus.PROVISIONAL,
      organizationId: params.organizationId,
      projectId: params.projectId,
      tx: params.tx,
    });
  }

  async markSeenInConsolidation(params: {
    subfacetIds: string[];
    organizationId: OrganizationId;
    projectId: ProjectId;
    tx?: Prisma.TransactionClient;
  }): Promise<{ count: number }> {
    const ids = Array.from(new Set(params.subfacetIds.filter(Boolean)));
    if (!ids.length) {
      return { count: 0 };
    }

    const db = this.getSubfacetDbClient(params.tx);
    const result = await db.subfacet.updateMany({
      where: {
        id: { in: ids },
        organizationId: params.organizationId,
        projectId: params.projectId,
        status: { in: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL] },
      },
      data: {
        survivalCount: { increment: 1 },
        lastSeenInConsolidationAt: new Date(),
      },
    });
    return { count: result.count };
  }

  async promoteProvisionalsToActive(
    params: PromoteProvisionalsToActiveParams,
  ): Promise<{ count: number; promotedIds: string[] }> {
    const db = this.getSubfacetDbClient(params.tx);
    const minSurvivalCount =
      params.minSurvivalCount ?? PROMOTE_TO_ACTIVE_SURVIVAL_COUNT;
    const whereBase = {
      organizationId: params.organizationId,
      projectId: params.projectId,
      category: params.category,
    } satisfies Prisma.SubfacetWhereInput;

    const activeCount = await db.subfacet.count({
      where: {
        ...whereBase,
        status: SubfacetStatus.ACTIVE,
      },
    });
    const availableSlots = Math.max(ACTIVE_CAP_PER_CATEGORY - activeCount, 0);
    if (availableSlots === 0) {
      return { count: 0, promotedIds: [] };
    }

    const limit =
      typeof params.limit === 'number'
        ? Math.min(Math.max(params.limit, 0), availableSlots)
        : availableSlots;
    if (limit === 0) {
      return { count: 0, promotedIds: [] };
    }

    const candidates = await db.subfacet.findMany({
      where: {
        ...whereBase,
        status: SubfacetStatus.PROVISIONAL,
        survivalCount: { gte: minSurvivalCount },
      },
      orderBy: [
        { survivalCount: 'desc' },
        { lastSeenInConsolidationAt: 'desc' },
        { updatedAt: 'desc' },
      ],
      take: limit,
      select: { id: true },
    });
    if (!candidates.length) {
      return { count: 0, promotedIds: [] };
    }
    const promotedIds = candidates.map((candidate) => candidate.id);
    const result = await db.subfacet.updateMany({
      where: { id: { in: promotedIds } },
      data: { status: SubfacetStatus.ACTIVE },
    });
    if (result.count > 0) {
      const promotedSubfacets = await db.subfacet.findMany({
        where: {
          id: { in: promotedIds },
          organizationId: params.organizationId,
          projectId: params.projectId,
          category: params.category,
          status: SubfacetStatus.ACTIVE,
        },
      });
      await Promise.all(
        promotedSubfacets.map((subfacet) =>
          this.publishSubfacetCreatedEvent({ subfacet, tx: params.tx }),
        ),
      );
    }
    return { count: result.count, promotedIds };
  }

  async deprecateSubfacetsWithMetadata(params: {
    names?: string[];
    ids?: string[];
    category?: SummaryCategory;
    organizationId: OrganizationId;
    projectId: ProjectId;
    tx?: Prisma.TransactionClient;
  }): Promise<{ count: number }> {
    const ids = (params.ids || []).map((id) => id.trim()).filter(Boolean);
    const names = (params.names || [])
      .map((name) => name.trim())
      .filter(Boolean);
    if (!ids.length && !names.length) {
      return { count: 0 };
    }
    return this.deprecateActiveSubfacets({
      tx: params.tx,
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        ...(params.category ? { category: params.category } : {}),
        OR: [
          ...(ids.length ? [{ id: { in: ids } }] : []),
          ...(names.length ? [{ name: { in: names } }] : []),
        ],
      },
    });
  }

  async listByStatusAndCategory(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category: SummaryCategory;
    statuses: SubfacetStatus[];
    orderByUpdatedAtDesc?: boolean;
    take?: number;
    skip?: number;
  }): Promise<Subfacet[]> {
    return this.listSubfacets({
      organizationId: params.organizationId,
      projectId: params.projectId,
      category: params.category,
      orderByUpdatedAtDesc: params.orderByUpdatedAtDesc,
      take: params.take,
      skip: params.skip,
      ...(params.statuses.length === 1 ? { status: params.statuses[0] } : {}),
    }).then((subfacets) =>
      params.statuses.length === 1
        ? subfacets
        : subfacets.filter((subfacet) =>
            params.statuses.includes(subfacet.status),
          ),
    );
  }

  private normalize(value: string): NormalizedFacet {
    const lower = value.toLowerCase();
    const cleaned = lower
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/[_-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const tokens = cleaned
      .split(' ')
      .map((token) => this.stripToken(token))
      .filter(Boolean);

    const uniqueTokens = Array.from(new Set(tokens));
    const slug = uniqueTokens.join('-');

    return { slug, tokens: uniqueTokens };
  }

  private stripToken(token: string): string {
    const trimmed = token.replace(/based$/, '').replace(/s$/, '');
    if (!trimmed || this.stopwords.has(trimmed)) {
      return '';
    }
    return trimmed;
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/[_-]/g, ' ')
      .trim()
      .replace(/\s+/g, '-');
  }

  private findBestMatch(
    target: NormalizedFacet,
    existing: ExistingFacet[],
  ): { subfacet: Subfacet; score: number } | null {
    let best: { subfacet: Subfacet; score: number } | null = null;

    for (const candidate of existing) {
      const score = this.computeSimilarity(
        target.slug,
        candidate.normalized.slug,
      );
      if (!best || score > best.score) {
        best = { subfacet: candidate.subfacet, score };
      }
    }

    return best;
  }

  private computeSimilarity(a: string, b: string): number {
    if (!a || !b) return 0;

    const bigrams = (input: string): string[] => {
      const padded = ` ${input} `;
      const grams: string[] = [];
      for (let i = 0; i < padded.length - 1; i++) {
        grams.push(padded.slice(i, i + 2));
      }
      return grams;
    };

    const aGrams = bigrams(a);
    const bGrams = bigrams(b);
    if (!aGrams.length || !bGrams.length) return 0;

    const intersection = aGrams.filter((gram) => bGrams.includes(gram)).length;
    return (2 * intersection) / (aGrams.length + bGrams.length);
  }

  private async ensureUniqueSlug(
    baseSlug: string,
    usedSlugs: Set<string>,
  ): Promise<string> {
    let candidate = baseSlug || 'subfacet';
    let attempt = 1;

    while (usedSlugs.has(candidate)) {
      candidate = `${baseSlug}-${attempt}`;
      attempt += 1;
    }

    return candidate;
  }

  private async createSubfacetRecord(params: {
    name: string;
    category: SummaryCategory;
    usedSlugs: Set<string>;
    summary?: string;
    status?: SubfacetStatus;
    organizationId: OrganizationId;
    projectId: ProjectId;
    tx?: Prisma.TransactionClient;
  }): Promise<Subfacet> {
    const db = this.getSubfacetDbClient(params.tx);
    const normalized = this.normalize(params.name);
    const uniqueSlug = await this.ensureUniqueSlug(
      normalized.slug || this.slugify(params.name),
      params.usedSlugs,
    );

    const created = await db.subfacet.create({
      data: {
        name: params.name,
        slug: uniqueSlug,
        category: params.category,
        status: params.status ?? SubfacetStatus.ACTIVE,
        ...(params.summary ? { summary: params.summary } : {}),
        organizationId: params.organizationId,
        projectId: params.projectId,
      },
    });

    if (created.status === SubfacetStatus.ACTIVE) {
      await this.publishSubfacetCreatedEvent({
        subfacet: created,
        tx: params.tx,
      });
    }

    return created;
  }

  private async deprecateActiveSubfacets(params: {
    where: Prisma.SubfacetWhereInput;
    tx?: Prisma.TransactionClient;
  }): Promise<{ count: number }> {
    const db = this.getSubfacetDbClient(params.tx);
    const activeSubfacets = await db.subfacet.findMany({
      where: {
        ...params.where,
        status: SubfacetStatus.ACTIVE,
      },
    });
    if (!activeSubfacets.length) {
      return { count: 0 };
    }

    const activeIds = activeSubfacets.map((subfacet) => subfacet.id);
    const result = await db.subfacet.updateMany({
      where: {
        id: { in: activeIds },
        status: SubfacetStatus.ACTIVE,
      },
      data: {
        status: SubfacetStatus.DEPRECATED,
        deprecatedAt: new Date(),
      },
    });

    if (result.count === 0) {
      return { count: 0 };
    }

    const deprecatedSubfacets = await db.subfacet.findMany({
      where: {
        id: { in: activeIds },
        status: SubfacetStatus.DEPRECATED,
      },
    });
    await Promise.all(
      deprecatedSubfacets.map((subfacet) =>
        this.publishSubfacetDeprecatedEvent({ subfacet, tx: params.tx }),
      ),
    );

    return { count: result.count };
  }

  private buildSubfacetEventBase(
    subfacet: Subfacet,
  ): Omit<ExecutionContext, 'payloadType'> {
    const context = EventContextManager.getInstance().getCurrentContext();
    const projectId =
      (context?.projectId as ProjectId | undefined) ??
      (subfacet.projectId as ProjectId | undefined);

    if (!projectId) {
      throw new Error(
        '[buildSubfacetEventBase] Project ID is required for subfacet events',
      );
    }

    return {
      organizationId: subfacet.organizationId as OrganizationId,
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

  private toSubfacetSnapshot(subfacet: Subfacet): TopologySubfacetDto {
    return {
      id: subfacet.id,
      name: subfacet.name,
      slug: subfacet.slug,
      category: subfacet.category as TopologySubfacetDto['category'],
      status: subfacet.status as TopologySubfacetDto['status'],
      summary: subfacet.summary ?? null,
      lastSummarizedAt: subfacet.lastSummarizedAt?.toISOString() ?? null,
      createdAt: subfacet.createdAt.toISOString(),
      updatedAt: subfacet.updatedAt.toISOString(),
    };
  }

  private async publishSubfacetCreatedEvent(params: {
    subfacet: Subfacet;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    if (params.subfacet.status !== SubfacetStatus.ACTIVE) {
      return;
    }

    const payload: SubfacetCreatedEventPayload = {
      payloadType: EVENT_TYPES.SUBFACET.CREATED,
      ...this.buildSubfacetEventBase(params.subfacet),
      subfacet: this.toSubfacetSnapshot(params.subfacet),
    };
    await this.publishSubfacetEvent({
      eventType: EVENT_TYPES.SUBFACET.CREATED,
      subfacet: params.subfacet,
      payload,
      tx: params.tx,
    });
  }

  private async publishSubfacetDeprecatedEvent(params: {
    subfacet: Subfacet;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    if (params.subfacet.status !== SubfacetStatus.DEPRECATED) {
      return;
    }

    const payload: SubfacetDeprecatedEventPayload = {
      payloadType: EVENT_TYPES.SUBFACET.DEPRECATED,
      ...this.buildSubfacetEventBase(params.subfacet),
      subfacet: this.toSubfacetSnapshot(params.subfacet),
    };
    await this.publishSubfacetEvent({
      eventType: EVENT_TYPES.SUBFACET.DEPRECATED,
      subfacet: params.subfacet,
      payload,
      tx: params.tx,
    });
  }

  private async publishSubfacetEvent(params: {
    eventType: SubfacetLifecycleEventType;
    subfacet: Subfacet;
    payload: SubfacetCreatedEventPayload | SubfacetDeprecatedEventPayload;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const event = {
      type: params.eventType,
      aggregateId: params.subfacet.id,
      payload: params.payload,
    };
    if (params.tx) {
      await this.eventPublisher.publishInTransaction(params.tx, event);
      return;
    }
    await this.eventPublisher.publish(event);
  }

  private getSubfacetDbClient(tx?: Prisma.TransactionClient): SubfacetDbClient {
    if (!tx) {
      return this.prisma.db;
    }
    return { subfacet: tx.subfacet } as unknown as SubfacetDbClient;
  }
}

import { Injectable, Logger } from '@nestjs/common';
import {
  EntityType,
  Prisma,
  SubfacetStatus,
  SummaryCategory,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId } from 'src/types';

interface RecordSubfacetCandidateInput {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category: SummaryCategory;
  name: string;
  confidence?: number;
  rationale?: string;
  sourceEntityType?: EntityType;
  sourceEntityId?: string;
}

interface ListSubfacetCandidatesInput {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category?: SummaryCategory;
  limit?: number;
  includePromoted?: boolean;
}

interface ListPromotableCandidatesInput {
  organizationId: OrganizationId;
  projectId: ProjectId;
  category: SummaryCategory;
  limit: number;
  tx?: Prisma.TransactionClient;
}

@Injectable()
export class SubfacetCandidateService {
  private readonly logger = new Logger(SubfacetCandidateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordCandidate(
    input: RecordSubfacetCandidateInput,
  ): Promise<{ candidateId?: string; skippedReason?: string }> {
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      return { skippedReason: 'empty_name' };
    }

    const normalizedSlug = this.normalizeToSlug(trimmedName);
    if (!normalizedSlug) {
      return { skippedReason: 'invalid_slug' };
    }

    const matchingActive = await this.prisma.db.subfacet.findFirst({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        category: input.category,
        status: {
          in: [SubfacetStatus.ACTIVE, SubfacetStatus.PROVISIONAL],
        },
        slug: normalizedSlug,
      },
      select: { id: true },
    });
    if (matchingActive) {
      this.logger.debug('[recordCandidate] skipped; matches active subfacet', {
        organizationId: input.organizationId,
        projectId: input.projectId,
        category: input.category,
        normalizedSlug,
        activeSubfacetId: matchingActive.id,
      });
      return { skippedReason: 'matches_active_subfacet' };
    }

    const now = new Date();
    const candidate = await this.prisma.db.topologySubfacetCandidate.upsert({
      where: {
        organizationId_projectId_category_normalizedSlug: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          category: input.category,
          normalizedSlug,
        },
      },
      create: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        category: input.category,
        name: trimmedName,
        normalizedSlug,
        latestConfidence: input.confidence,
        latestRationale: input.rationale?.trim() || undefined,
        lastSourceEntityType: input.sourceEntityType,
        lastSourceEntityId: input.sourceEntityId,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        name: trimmedName,
        proposalCount: { increment: 1 },
        lastSeenAt: now,
        latestConfidence: input.confidence,
        latestRationale: input.rationale?.trim() || undefined,
        lastSourceEntityType: input.sourceEntityType,
        lastSourceEntityId: input.sourceEntityId,
      },
      select: { id: true },
    });

    return { candidateId: candidate.id };
  }

  async listCandidates(input: ListSubfacetCandidatesInput) {
    return this.prisma.db.topologySubfacetCandidate.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        ...(input.category ? { category: input.category } : {}),
        ...(input.includePromoted ? {} : { promotedAt: null }),
      },
      orderBy: [{ proposalCount: 'desc' }, { lastSeenAt: 'desc' }],
      take: Math.min(Math.max(input.limit ?? 100, 1), 500),
    });
  }

  async listPromotableCandidates(input: ListPromotableCandidatesInput) {
    if (input.tx) {
      return input.tx.topologySubfacetCandidate.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          category: input.category,
          promotedAt: null,
        },
        orderBy: [{ proposalCount: 'desc' }, { lastSeenAt: 'desc' }],
        take: Math.max(input.limit, 0),
      });
    }

    return this.prisma.db.topologySubfacetCandidate.findMany({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        category: input.category,
        promotedAt: null,
      },
      orderBy: [{ proposalCount: 'desc' }, { lastSeenAt: 'desc' }],
      take: Math.max(input.limit, 0),
    });
  }

  async markPromoted(params: {
    promotions: Array<{ candidateId: string; subfacetId: string }>;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    if (!params.promotions.length) {
      return;
    }
    const now = new Date();
    const tx = params.tx;
    if (tx) {
      await Promise.all(
        params.promotions.map((promotion) =>
          tx.topologySubfacetCandidate.update({
            where: { id: promotion.candidateId },
            data: {
              promotedAt: now,
              promotedSubfacetId: promotion.subfacetId,
            },
          }),
        ),
      );
      return;
    }

    await Promise.all(
      params.promotions.map((promotion) =>
        this.prisma.db.topologySubfacetCandidate.update({
          where: { id: promotion.candidateId },
          data: {
            promotedAt: now,
            promotedSubfacetId: promotion.subfacetId,
          },
        }),
      ),
    );
  }

  private normalizeToSlug(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .replace(/[_-]/g, ' ')
      .trim()
      .replace(/\s+/g, '-');
  }
}

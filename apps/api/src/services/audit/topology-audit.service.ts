import { Injectable } from '@nestjs/common';
import {
  CategorySummarizationRun,
  Prisma,
  SubfacetConsolidationRun,
  SubfacetSummarizationRun,
  SummaryCategory,
} from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId } from 'src/types';

export type CreateSubfacetConsolidationRunInput = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  requestId?: string;
  nodeName?: string;
  promptVersion?: string;
  parserVersion?: string;
  category: SummaryCategory;
  since: Date;
  until: Date;
  thresholdApplied: number;
  accumulatedSnapshot: Prisma.InputJsonValue;
  consolidatedBefore?: Prisma.InputJsonValue | null;
  consolidationResult: Prisma.InputJsonValue;
};

export type CreateCategorySummarizationRunInput = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  requestId?: string;
  nodeName?: string;
  promptVersion?: string;
  parserVersion?: string;
  category: SummaryCategory;
  since: Date;
  until: Date;
  thresholdApplied: number;
  accumulatedSnapshot: Prisma.InputJsonValue;
  consolidatedBefore?: Prisma.InputJsonValue | null;
  consolidationResult: Prisma.InputJsonValue;
};

export type CreateSubfacetSummarizationRunInput = {
  organizationId: OrganizationId;
  projectId: ProjectId;
  topologyConsolidationRunId?: string;
  temporalWorkflowId?: string;
  requestId?: string;
  nodeName?: string;
  promptVersion?: string;
  parserVersion?: string;
  category: SummaryCategory;
  subfacetId: string;
  since: Date;
  until: Date;
  thresholdApplied: number;
  accumulatedSnapshot: Prisma.InputJsonValue;
  consolidatedBefore?: Prisma.InputJsonValue | null;
  consolidationResult: Prisma.InputJsonValue;
};

@Injectable()
export class TopologyAuditService {
  constructor(private readonly prisma: PrismaService) {}

  private toNullableJson(
    value: Prisma.InputJsonValue | null | undefined,
  ): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue | undefined {
    if (value === null) {
      return Prisma.JsonNull;
    }
    return value;
  }

  async recordRun(
    input: CreateSubfacetConsolidationRunInput,
  ): Promise<SubfacetConsolidationRun> {
    return this.prisma.db.subfacetConsolidationRun.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        topologyConsolidationRunId: input.topologyConsolidationRunId,
        temporalWorkflowId: input.temporalWorkflowId,
        requestId: input.requestId,
        nodeName: input.nodeName,
        promptVersion: input.promptVersion,
        parserVersion: input.parserVersion,
        category: input.category,
        since: input.since,
        until: input.until,
        thresholdApplied: input.thresholdApplied,
        accumulatedSnapshot: input.accumulatedSnapshot,
        consolidatedBefore: this.toNullableJson(input.consolidatedBefore),
        consolidationResult: input.consolidationResult,
      },
    });
  }

  async recordCategoryRun(
    input: CreateCategorySummarizationRunInput,
  ): Promise<CategorySummarizationRun> {
    return this.prisma.db.categorySummarizationRun.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        topologyConsolidationRunId: input.topologyConsolidationRunId,
        temporalWorkflowId: input.temporalWorkflowId,
        requestId: input.requestId,
        nodeName: input.nodeName,
        promptVersion: input.promptVersion,
        parserVersion: input.parserVersion,
        category: input.category,
        since: input.since,
        until: input.until,
        thresholdApplied: input.thresholdApplied,
        accumulatedSnapshot: input.accumulatedSnapshot,
        consolidatedBefore: this.toNullableJson(input.consolidatedBefore),
        consolidationResult: input.consolidationResult,
      },
    });
  }

  async recordSubfacetSummaryRun(
    input: CreateSubfacetSummarizationRunInput,
  ): Promise<SubfacetSummarizationRun> {
    return this.prisma.db.subfacetSummarizationRun.create({
      data: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        topologyConsolidationRunId: input.topologyConsolidationRunId,
        temporalWorkflowId: input.temporalWorkflowId,
        requestId: input.requestId,
        nodeName: input.nodeName,
        promptVersion: input.promptVersion,
        parserVersion: input.parserVersion,
        category: input.category,
        subfacetId: input.subfacetId,
        since: input.since,
        until: input.until,
        thresholdApplied: input.thresholdApplied,
        accumulatedSnapshot: input.accumulatedSnapshot,
        consolidatedBefore: this.toNullableJson(input.consolidatedBefore),
        consolidationResult: input.consolidationResult,
      },
    });
  }

  async getLatestRun(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category: SummaryCategory;
  }): Promise<SubfacetConsolidationRun | null> {
    return this.prisma.db.subfacetConsolidationRun.findFirst({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category: params.category,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLatestCategoryRun(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category: SummaryCategory;
  }): Promise<CategorySummarizationRun | null> {
    return this.prisma.db.categorySummarizationRun.findFirst({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category: params.category,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getLatestSubfacetSummaryRun(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category: SummaryCategory;
    subfacetId: string;
  }): Promise<SubfacetSummarizationRun | null> {
    return this.prisma.db.subfacetSummarizationRun.findFirst({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category: params.category,
        subfacetId: params.subfacetId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listRecentRuns(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category?: SummaryCategory;
    limit?: number;
  }): Promise<SubfacetConsolidationRun[]> {
    const { organizationId, projectId, category, limit = 10 } = params;
    return this.prisma.db.subfacetConsolidationRun.findMany({
      where: {
        organizationId,
        projectId,
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listRecentCategoryRuns(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category?: SummaryCategory;
    limit?: number;
  }): Promise<CategorySummarizationRun[]> {
    const { organizationId, projectId, category, limit = 10 } = params;
    return this.prisma.db.categorySummarizationRun.findMany({
      where: {
        organizationId,
        projectId,
        ...(category ? { category } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async listRecentSubfacetSummaryRuns(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category?: SummaryCategory;
    subfacetId?: string;
    limit?: number;
  }): Promise<SubfacetSummarizationRun[]> {
    const {
      organizationId,
      projectId,
      category,
      subfacetId,
      limit = 10,
    } = params;
    return this.prisma.db.subfacetSummarizationRun.findMany({
      where: {
        organizationId,
        projectId,
        ...(category ? { category } : {}),
        ...(subfacetId ? { subfacetId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
}

import { Injectable } from '@nestjs/common';
import { SummaryCategory, TopologyCategorySummary } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId } from 'src/types';

@Injectable()
export class TopologyCategorySummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getCurrentSummary(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category: SummaryCategory;
  }): Promise<TopologyCategorySummary | null> {
    return this.prisma.db.topologyCategorySummary.findUnique({
      where: {
        organizationId_projectId_category: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          category: params.category,
        },
      },
    });
  }

  async upsertSummary(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category: SummaryCategory;
    summary: string;
    briefSummary: string;
  }): Promise<TopologyCategorySummary> {
    return this.prisma.db.topologyCategorySummary.upsert({
      where: {
        organizationId_projectId_category: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          category: params.category,
        },
      },
      create: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        category: params.category,
        summary: params.summary,
        briefSummary: params.briefSummary,
      },
      update: {
        summary: params.summary,
        briefSummary: params.briefSummary,
      },
    });
  }

  async listSummaries(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    category?: SummaryCategory;
  }): Promise<TopologyCategorySummary[]> {
    return this.prisma.db.topologyCategorySummary.findMany({
      where: {
        organizationId: params.organizationId,
        projectId: params.projectId,
        ...(params.category ? { category: params.category } : {}),
      },
      orderBy: { category: 'asc' },
    });
  }
}

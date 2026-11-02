import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, ReportType } from '@prisma/client';
import type {
  ProjectReportAttempt,
  ProjectReportHistoryEntry,
  ProjectReportHistoryPageDto,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { restrictReportWhere } from 'src/read-restriction/read-policy';
import { ProjectAccessService } from 'src/auth/services/project-access.service';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { toPublicProjectReportFailure } from './project-report-public-failure';
import { ProjectReportRequestService } from './project-report-request.service';

interface HistoryKey {
  type: 'REQUEST' | 'SAVED_REPORT';
  id: string;
  sortAt: Date;
}

function newestFirst(a: HistoryKey, b: HistoryKey): number {
  const byTime = b.sortAt.getTime() - a.sortAt.getTime();
  if (byTime !== 0) {
    return byTime;
  }

  return b.id.localeCompare(a.id);
}

@Injectable()
export class ProjectReportHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly requests: ProjectReportRequestService,
  ) {}

  async list(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    limit: number,
    offset: number,
  ): Promise<ProjectReportHistoryPageDto> {
    const accessible = await this.projectAccess.accessibleProjectIds(
      userId,
      organizationId,
    );
    if (!accessible.includes(projectId)) {
      throw new ForbiddenException('Project access has been revoked');
    }

    const [requestTotal, reportTotal, keys] = await Promise.all([
      this.prisma.db.projectReportRequest.count({
        where: this.requestWhere(organizationId, projectId, userId),
      }),
      this.prisma.db.report.count({
        where: this.savedReportWhere(organizationId, projectId, userId),
      }),
      this.loadPageKeys(organizationId, projectId, userId, limit, offset),
    ]);
    const total = requestTotal + reportTotal;
    const entries = await this.hydrate(organizationId, projectId, userId, keys);
    const next = offset + limit;

    return {
      entries,
      total,
      ...(next < total ? { nextOffset: next } : {}),
    };
  }

  private requestWhere(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Prisma.ProjectReportRequestWhereInput {
    return { organizationId, projectId, userId };
  }

  /**
   * A saved report that is the report of any attempt of the caller's requests
   * is represented by its request, so it takes no slot.
   */
  private savedReportWhere(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
  ): Prisma.ReportWhereInput {
    return restrictReportWhere({
      organizationId,
      projectId,
      reportType: ReportType.PROJECT_REPORT,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      projectReportAttempts: { none: { request: { userId } } },
    });
  }

  /**
   * The page of the merged list needs at most offset + limit rows from each
   * source, so each source is read newest first with that bound and the merge
   * is sliced to the page.
   */
  private async loadPageKeys(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    limit: number,
    offset: number,
  ): Promise<HistoryKey[]> {
    const take = offset + limit;
    const [requests, reports] = await Promise.all([
      this.prisma.db.projectReportRequest.findMany({
        where: this.requestWhere(organizationId, projectId, userId),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: { id: true, createdAt: true },
      }),
      this.prisma.db.report.findMany({
        where: this.savedReportWhere(organizationId, projectId, userId),
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take,
        select: { id: true, createdAt: true },
      }),
    ]);

    const keys: HistoryKey[] = [
      ...requests.map((row) => ({
        type: 'REQUEST' as const,
        id: row.id,
        sortAt: row.createdAt,
      })),
      ...reports.map((row) => ({
        type: 'SAVED_REPORT' as const,
        id: row.id,
        sortAt: row.createdAt,
      })),
    ];

    return keys.sort(newestFirst).slice(offset, take);
  }

  private async hydrate(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    page: HistoryKey[],
  ): Promise<ProjectReportHistoryEntry[]> {
    const requestIds = page.filter((key) => key.type === 'REQUEST');
    const rows = await this.prisma.db.projectReportRequest.findMany({
      where: {
        organizationId,
        projectId,
        userId,
        id: { in: requestIds.map((key) => key.id) },
      },
      include: { attempts: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));

    const entries: ProjectReportHistoryEntry[] = [];
    for (const key of page) {
      if (key.type === 'SAVED_REPORT') {
        entries.push({
          type: 'SAVED_REPORT',
          reportId: key.id,
          createdAt: key.sortAt.toISOString(),
        });
        continue;
      }

      const row = byId.get(key.id);
      if (!row) {
        continue;
      }
      const dto = this.requests.toDto(row);
      const attempt = dto.attempts.at(-1);
      if (!attempt) {
        continue;
      }
      const { failure, ...rest } = attempt;
      const latestAttempt = {
        ...rest,
        ...(failure ? { failure: toPublicProjectReportFailure(failure) } : {}),
      } satisfies ProjectReportAttempt;
      entries.push({
        type: 'REQUEST',
        requestId: dto.id,
        kind: dto.kind,
        submission: dto.submission,
        status: dto.status,
        latestAttempt,
        createdAt: dto.createdAt,
      });
    }

    return entries;
  }
}

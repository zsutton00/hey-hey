import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ActivityCorrelationMode } from 'src/generated';
import type {
  ActivityCorrelationRecordDto,
  CreateProjectReportRequestDto,
  ProjectReportActivityPageDto,
  ProjectReportPreviewDto,
  ProjectReportPreviewRequestDto,
  ProjectReportPreviewRow,
  ProjectReportScope,
  ProjectReportSubject,
} from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';
import { ActivityQueryService } from '../activity-correlation/activity-query.service';

export function projectReportSubjectKey(subject: ProjectReportSubject): string {
  return `${subject.entityType}:${subject.entityId}`;
}

export type ProjectReportSelection = {
  records: ActivityCorrelationRecordDto[];
  subjects: ProjectReportPreviewRow[];
};

@Injectable()
export class ProjectReportActivityService {
  private readonly logger = new Logger(ProjectReportActivityService.name);

  constructor(private readonly activityQuery: ActivityQueryService) {}

  async select(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    scope: ProjectReportScope;
    exclusions: ProjectReportSubject[];
  }): Promise<ProjectReportSelection> {
    if (input.scope.projectId !== input.projectId) {
      throw new BadRequestException(
        'Report scope project must match the route',
      );
    }
    const since = new Date(input.scope.windowStart);
    const until = new Date(input.scope.windowEnd);
    if (
      !Number.isFinite(since.getTime()) ||
      !Number.isFinite(until.getTime()) ||
      since >= until
    ) {
      throw new BadRequestException(
        'Report period must have valid increasing bounds',
      );
    }
    const includeAttentionEvents = input.scope.includeAttentionEvents ?? false;
    this.logger.debug('Selecting project report activity', {
      organizationId: input.organizationId,
      projectId: input.projectId,
      includeAttentionEvents,
      exclusionCount: input.exclusions.length,
    });
    const records = await this.activityQuery.selectActivity({
      organizationId: input.organizationId,
      // Report evidence omits viewing activity unless the scope opts in;
      // the shared queryActivity default stays unchanged.
      activityMode: includeAttentionEvents
        ? ActivityCorrelationMode.All
        : ActivityCorrelationMode.WithoutAttention,
      actorUserId: input.userId,
      projectId: input.projectId,
      since,
      until,
      ...(input.scope.userId
        ? { selectedUserId: input.scope.userId as UserId }
        : {}),
      ...(input.scope.activityTypes
        ? { activityTypes: input.scope.activityTypes }
        : {}),
      ...(input.scope.sources ? { sources: input.scope.sources } : {}),
    });
    const excluded = new Set(input.exclusions.map(projectReportSubjectKey));
    const bySubject = new Map<string, ProjectReportPreviewRow>();
    for (const record of records) {
      const subject = {
        entityType: record.entityType,
        entityId: record.entityId,
      } satisfies ProjectReportSubject;
      const key = projectReportSubjectKey(subject);
      const row = bySubject.get(key);
      if (row) {
        row.matchingActivityCount += 1;
        continue;
      }
      bySubject.set(key, {
        subject,
        title: record.title,
        matchingActivityCount: 1,
        explanation: `${record.type} on ${record.timestamp}`,
        excluded: excluded.has(key),
      } satisfies ProjectReportPreviewRow);
    }
    return { records, subjects: [...bySubject.values()] };
  }

  async preview(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    input: ProjectReportPreviewRequestDto,
  ): Promise<ProjectReportPreviewDto> {
    const selection = await this.select({
      organizationId,
      projectId,
      userId,
      scope: input.scope,
      exclusions: input.exclusions,
    });
    const matchingSubjectCount = selection.subjects.length;
    const excludedSubjectCount = selection.subjects.filter(
      (row) => row.excluded,
    ).length;
    const displayed = input.search
      ? selection.subjects.filter((row) =>
          row.title
            .toLocaleLowerCase()
            .includes(input.search!.toLocaleLowerCase()),
        )
      : selection.subjects;
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;
    return {
      subjects: displayed.slice(offset, offset + limit),
      matchingSubjectCount,
      includedSubjectCount: matchingSubjectCount - excludedSubjectCount,
      excludedSubjectCount,
      displayedSubjectCount: displayed.length,
      ...(offset + limit < displayed.length
        ? { nextOffset: offset + limit }
        : {}),
      queriedAt: new Date().toISOString(),
    } satisfies ProjectReportPreviewDto;
  }

  async page(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    requestId: string,
    attemptId: string,
    submission: CreateProjectReportRequestDto,
    limit: number,
    offset: number,
  ): Promise<ProjectReportActivityPageDto> {
    if (
      limit < 1 ||
      limit > 200 ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      !Number.isInteger(offset)
    ) {
      throw new BadRequestException('Invalid report activity page');
    }
    const selection = await this.select({
      organizationId,
      projectId,
      userId,
      scope: submission.scope,
      exclusions: submission.exclusions,
    });
    const excluded = new Set(
      submission.exclusions.map(projectReportSubjectKey),
    );
    const records = selection.records.filter(
      (record) => !excluded.has(projectReportSubjectKey(record)),
    );
    return {
      requestId,
      attemptId,
      records: records.slice(offset, offset + limit),
      total: records.length,
      ...(offset + limit < records.length
        ? { nextOffset: offset + limit }
        : {}),
      queriedAt: new Date().toISOString(),
    } satisfies ProjectReportActivityPageDto;
  }
}

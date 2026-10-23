import { Injectable, Logger } from '@nestjs/common';
import type {
  ActivityActorScopeDto,
  ProjectMetricDto,
  ProjectMetricsResponseDto,
} from 'src/generated';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { AcceptedEvidenceSelectorService } from './accepted-evidence-selector.service';
import {
  PROJECT_METRIC_IDENTITIES,
  ProjectMetricsRequest,
} from './project-metrics.types';

@Injectable()
export class ProjectMetricsService {
  private readonly logger = new Logger(ProjectMetricsService.name);

  constructor(
    private readonly acceptedEvidenceSelector: AcceptedEvidenceSelectorService,
  ) {}

  async getProjectMetrics(
    organizationId: OrganizationId,
    userId: UserId,
    projectId?: ProjectId,
    actorScope: ActivityActorScopeDto = { mode: 'ORGANIZATION' },
  ): Promise<ProjectMetricsResponseDto> {
    const request: ProjectMetricsRequest = {
      organizationId,
      userId,
      actorScope,
      ...(projectId === undefined ? {} : { projectId }),
    };
    const evidence = await this.acceptedEvidenceSelector.select(request);
    const counts = new Map<string, number>();
    for (const record of evidence.records) {
      counts.set(record.metric, (counts.get(record.metric) ?? 0) + 1);
    }

    const windowStart = evidence.windowStart.toISOString();
    const windowEnd = evidence.windowEnd.toISOString();
    const effectiveProjectIds = evidence.effectiveProjectIds.map(
      (effectiveProjectId) => String(effectiveProjectId),
    );
    const identities =
      actorScope.mode === 'PERSONAL'
        ? PROJECT_METRIC_IDENTITIES.filter(
            (metric) => !metric.startsWith('PROJECT_INFO_'),
          )
        : PROJECT_METRIC_IDENTITIES;
    const metrics: ProjectMetricDto[] = identities.map(
      (metric) => ({
        metric,
        value: counts.get(metric) ?? 0,
        activityContinuation: {
          metric,
          projectIds: [...effectiveProjectIds],
          windowStart,
          windowEnd,
          actorScope,
        },
      }),
    );

    this.logger.debug('[project-metrics] assembled response', {
      effectiveProjectCount: effectiveProjectIds.length,
      windowStart,
      windowEnd,
      metricValues: metrics.map(({ metric, value }) => ({ metric, value })),
    });

    return {
      metrics,
      actorScope,
      effectiveProjectIds,
      windowStart,
      windowEnd,
    } satisfies ProjectMetricsResponseDto;
  }
}

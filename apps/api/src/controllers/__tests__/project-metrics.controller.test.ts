import { BadRequestException } from '@nestjs/common';
import { ProjectMetricsController } from '../project-metrics.controller';
import { ProjectMetricsService } from 'src/services/project-metrics/project-metrics.service';

describe('ProjectMetricsController', () => {
  it('forwards the selected organization, user, and normalized project scope', async () => {
    const response = {
      metrics: [],
      actorScope: { mode: 'ORGANIZATION' },
      effectiveProjectIds: [],
      windowStart: '2026-09-03T12:00:00.000Z',
      windowEnd: '2026-09-04T12:00:00.000Z',
    };
    const getProjectMetrics = jest.fn().mockResolvedValue(response);
    const service = {
      getProjectMetrics,
    } as unknown as ProjectMetricsService;
    const controller = new ProjectMetricsController(service);

    await expect(
      controller.getProjectMetrics(
        'organization-1' as never,
        'user-1' as never,
        'ORGANIZATION',
        undefined,
        ' project-1 ',
      ),
    ).resolves.toBe(response);
    expect(getProjectMetrics).toHaveBeenCalledWith(
      'organization-1',
      'user-1',
      'project-1',
      { mode: 'ORGANIZATION' },
    );
  });

  it('leaves an omitted project scope undefined and rejects an empty query value', async () => {
    const getProjectMetrics = jest.fn().mockResolvedValue({});
    const service = {
      getProjectMetrics,
    } as unknown as ProjectMetricsService;
    const controller = new ProjectMetricsController(service);

    await controller.getProjectMetrics(
      'organization-1' as never,
      'user-1' as never,
      'ORGANIZATION',
    );
    expect(getProjectMetrics).toHaveBeenCalledWith(
      'organization-1',
      'user-1',
      undefined,
      { mode: 'ORGANIZATION' },
    );

    await expect(
      controller.getProjectMetrics(
        'organization-1' as never,
        'user-1' as never,
        'ORGANIZATION',
        undefined,
        '   ',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

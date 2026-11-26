import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AnalyticsService } from '../../services/analytics/analytics.service';
import { AttentionEventService } from '../../services/analytics/attention-event.service';
import { AttentionSummaryService } from '../../services/analytics/attention-summary.service';
import { AnalyticsController } from '../analytics.controller';

describe('AnalyticsController.getAttentionEvents limit boundary', () => {
  let controller: AnalyticsController;
  const mockAttentionEventService = {
    getAttentionEvents: jest.fn(),
  };
  const mockAnalyticsService = {};
  const mockAttentionSummaryService = { summarize: jest.fn() };

  const user = { userId: 'user-1' } as AuthenticatedUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: mockAnalyticsService },
        {
          provide: AttentionSummaryService,
          useValue: mockAttentionSummaryService,
        },
        {
          provide: AttentionEventService,
          useValue: mockAttentionEventService,
        },
      ],
    }).compile();

    controller = module.get<AnalyticsController>(AnalyticsController);
    jest.clearAllMocks();
    mockAttentionEventService.getAttentionEvents.mockResolvedValue({
      events: [],
      total: 0,
    });
  });

  it('accepts limit=1', async () => {
    await controller.getAttentionEvents(user, 1, 0, 'mostRecent', false);

    expect(mockAttentionEventService.getAttentionEvents).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ limit: 1 }),
    );
  });

  it('accepts limit=50 (new upper bound)', async () => {
    await controller.getAttentionEvents(user, 50, 0, 'mostRecent', false);

    expect(mockAttentionEventService.getAttentionEvents).toHaveBeenCalledWith(
      user,
      expect.objectContaining({ limit: 50 }),
    );
  });

  it('rejects limit=51 with BadRequestException and updated message', async () => {
    await expect(
      controller.getAttentionEvents(user, 51, 0, 'mostRecent', false),
    ).rejects.toThrow(
      new BadRequestException('limit must be between 1 and 50'),
    );

    expect(mockAttentionEventService.getAttentionEvents).not.toHaveBeenCalled();
  });

  it('summarizes the requested project for one or several entity types', async () => {
    await controller.getAttentionSummary(user, 'project-1', 'TASK');
    await controller.getAttentionSummary(user, 'project-1', [
      'TASK',
      'PROPOSAL',
    ]);

    expect(mockAttentionSummaryService.summarize.mock.calls).toEqual([
      [user, { projectId: 'project-1', entityTypes: ['TASK'] }],
      [user, { projectId: 'project-1', entityTypes: ['TASK', 'PROPOSAL'] }],
    ]);
  });

  it('rejects a summary without a project or for an unknown entity type', async () => {
    await expect(controller.getAttentionSummary(user)).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      controller.getAttentionSummary(user, 'project-1', ['TASK', 'WIDGET']),
    ).rejects.toThrow(BadRequestException);

    expect(mockAttentionSummaryService.summarize).not.toHaveBeenCalled();
  });
});

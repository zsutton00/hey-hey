import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AnalyticsService } from '../../services/analytics/analytics.service';
import { AttentionEventService } from '../../services/analytics/attention-event.service';
import { AnalyticsController } from '../analytics.controller';

describe('AnalyticsController.getAttentionEvents limit boundary', () => {
  let controller: AnalyticsController;
  const mockAttentionEventService = {
    getAttentionEvents: jest.fn(),
  };
  const mockAnalyticsService = {};

  const user = { userId: 'user-1' } as AuthenticatedUser;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnalyticsController],
      providers: [
        { provide: AnalyticsService, useValue: mockAnalyticsService },
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
});

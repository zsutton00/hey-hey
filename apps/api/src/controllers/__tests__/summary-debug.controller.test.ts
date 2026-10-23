import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { SummaryCategory, EntityType } from '@prisma/client';
import { SummaryDebugController } from '../summary-debug.controller';
import { EntitySummaryService } from '../../services/entity-summary/entity-summary.service';

describe('SummaryDebugController', () => {
  let controller: SummaryDebugController;
  const mockEntitySummaryService = {
    createSummaryWithSubfacets: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SummaryDebugController],
      providers: [
        { provide: ConfigService, useValue: { get: jest.fn() } },
        {
          provide: EntitySummaryService,
          useValue: mockEntitySummaryService,
        },
      ],
    }).compile();

    controller = module.get(SummaryDebugController);
    jest.clearAllMocks();
  });

  it('emits a summary update via the service', async () => {
    mockEntitySummaryService.createSummaryWithSubfacets.mockResolvedValue({
      summary: { id: 'sum-1', version: 2 },
      subfacets: [{ name: 'observability' }],
    });

    const result = await controller.emitSummaryUpdate(
      'org-1' as any,
      { currentOrgId: 'org-1' } as any,
      {
        entityType: EntityType.TASK,
        entityId: 'task-1',
        projectId: 'proj-1' as any,
        organizationId: 'org-1' as any,
        summary: 'updated summary',
        category: SummaryCategory.technology,
        subfacets: ['observability'],
      },
    );

    expect(
      mockEntitySummaryService.createSummaryWithSubfacets,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        entityType: EntityType.TASK,
        entityId: 'task-1',
        projectId: 'proj-1',
        summary: 'updated summary',
        category: SummaryCategory.technology,
        subfacets: ['observability'],
      }),
    );
    expect(result).toEqual({
      summaryId: 'sum-1',
      version: 2,
      subfacets: ['observability'],
    });
  });
});

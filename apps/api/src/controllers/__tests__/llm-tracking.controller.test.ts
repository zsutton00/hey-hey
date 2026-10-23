import { ProjectAccessService } from '../../auth/services/project-access.service';
import { ProjectResourceAccessService } from '../../auth/services/project-resource-access.service';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { LLMTrackingController } from '../llm-tracking.controller';
import { LLMTrackingService } from '../../services/llm/llm-tracking.service';

describe('LLMTrackingController', () => {
  let controller: LLMTrackingController;
  const access = {
    accessibleProjectIds: jest.fn(),
    assertProject: jest.fn(),
  };
  const resources = { assertResource: jest.fn() };

  const mockLLMTrackingService = {
    findMany: jest.fn(),
    getStats: jest.fn(),
    findById: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    access.accessibleProjectIds.mockResolvedValue(['allowed-project']);
    const module: TestingModule = await Test.createTestingModule({
      controllers: [LLMTrackingController],
      providers: [
        { provide: ProjectAccessService, useValue: access },
        { provide: ProjectResourceAccessService, useValue: resources },
        {
          provide: LLMTrackingService,
          useValue: mockLLMTrackingService,
        },
      ],
    }).compile();

    controller = module.get(LLMTrackingController);
    jest.clearAllMocks();
  });

  it('uses the current user org when orgId is not provided', async () => {
    mockLLMTrackingService.findMany.mockResolvedValueOnce([]);

    await controller.listPromptResponses(
      { userId: 'user-1', currentOrgId: 'org-user' } as any,
      1,
      20,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
    );

    expect(mockLLMTrackingService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: 'org-user',
          AND: [
            {
              OR: [
                { projectId: null },
                { projectId: { in: ['allowed-project'] } },
              ],
            },
          ],
        }),
      }),
    );
  });

  it('applies orgId override and createdAt date range filters', async () => {
    mockLLMTrackingService.findMany.mockResolvedValueOnce([]);

    await controller.listPromptResponses(
      { userId: 'user-1', currentOrgId: 'org-user' } as any,
      2,
      10,
      'workflow-1',
      'conversation-1',
      'project-1',
      'org-filter',
      'node-1',
      'openai',
      true,
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.000Z',
    );

    expect(mockLLMTrackingService.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-filter',
        AND: [
          {
            OR: [
              { projectId: null },
              { projectId: { in: ['allowed-project'] } },
            ],
          },
        ],
        workflowId: 'workflow-1',
        conversationId: 'conversation-1',
        projectId: 'project-1',
        nodeId: 'node-1',
        provider: 'openai',
        success: true,
        createdAt: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-31T23:59:59.000Z'),
        },
      },
      skip: 10,
      take: 10,
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns all matching records when date range is set and limit is omitted', async () => {
    mockLLMTrackingService.findMany.mockResolvedValueOnce([]);

    await controller.listPromptResponses(
      { userId: 'user-1', currentOrgId: 'org-user' } as any,
      1,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      '2026-01-01T00:00:00.000Z',
      '2026-01-31T23:59:59.000Z',
    );

    expect(mockLLMTrackingService.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-user',
        AND: [
          {
            OR: [
              { projectId: null },
              { projectId: { in: ['allowed-project'] } },
            ],
          },
        ],
        createdAt: {
          gte: new Date('2026-01-01T00:00:00.000Z'),
          lte: new Date('2026-01-31T23:59:59.000Z'),
        },
      },
      skip: undefined,
      take: undefined,
      orderBy: { createdAt: 'desc' },
    });
  });

  it('fails fast when startDate is invalid', async () => {
    await expect(
      controller.listPromptResponses(
        { userId: 'user-1', currentOrgId: 'org-user' } as any,
        1,
        20,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'not-a-date',
        undefined,
      ),
    ).rejects.toThrow(BadRequestException);
    expect(mockLLMTrackingService.findMany).not.toHaveBeenCalled();
  });
  it('rejects foreign records before reading prompt content', async () => {
    resources.assertResource.mockRejectedValue(new ForbiddenException());
    await expect(
      controller.getPromptResponse(
        { userId: 'alice', currentOrgId: 'org' } as any,
        'bob-record',
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(mockLLMTrackingService.findById).not.toHaveBeenCalled();
  });

  it('scopes usage aggregates and rejects inactive organization membership', async () => {
    const user = { userId: 'alice', currentOrgId: 'org' } as any;
    mockLLMTrackingService.getStats.mockResolvedValue({});
    await controller.getStats(user);
    expect(mockLLMTrackingService.getStats).toHaveBeenCalledWith('org', [
      'allowed-project',
    ]);
    access.accessibleProjectIds.mockRejectedValue(new ForbiddenException());
    mockLLMTrackingService.getStats.mockClear();
    await expect(controller.getStats(user)).rejects.toThrow(ForbiddenException);
    expect(mockLLMTrackingService.getStats).not.toHaveBeenCalled();
  });
});

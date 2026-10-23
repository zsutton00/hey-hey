import { PrismaService } from '../../../prisma/prisma.service';
import { LLMTrackingService } from '../llm-tracking.service';
import { OrganizationId, ProjectId } from '../../../types';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

describe('LLMTrackingService Cost Queries', () => {
  let service: LLMTrackingService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const prismaMock = {
      db: {
        lLMPromptResponse: {
          findMany: jest.fn(),
        },
      },
    } as unknown as PrismaService;

    const setup = await createServiceTestingModule({
      providers: [LLMTrackingService],
      overrides: [[PrismaService, prismaMock]],
    });

    service = setup.module.get<LLMTrackingService>(LLMTrackingService);
    prisma = setup.module.get<PrismaService>(PrismaService);
  });

  describe('getOrganizationCostSummary', () => {
    it('should calculate cost summary from prompt responses', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      const organizationId = 'org-123' as OrganizationId;

      const mockRecords = [
        {
          id: 'record-1',
          model: 'gpt-4-turbo',
          totalTokens: 100,
          totalCost: { toNumber: () => 0.002 },
        },
        {
          id: 'record-2',
          model: 'gpt-4-turbo',
          totalTokens: 150,
          totalCost: { toNumber: () => 0.003 },
        },
        {
          id: 'record-3',
          model: 'gpt-3.5-turbo',
          totalTokens: 200,
          totalCost: { toNumber: () => 0.001 },
        },
      ];

      (prisma.db.lLMPromptResponse.findMany as jest.Mock).mockResolvedValue(
        mockRecords,
      );

      const result = await service.getOrganizationCostSummary(
        organizationId,
        startDate,
        endDate,
      );

      expect(result).toEqual({
        organizationId,
        totalCalls: 3,
        totalTokens: 450,
        totalCost: 0.006,
        breakdown: [
          {
            model: 'gpt-4-turbo',
            calls: 2,
            tokens: 250,
            cost: 0.005,
          },
          {
            model: 'gpt-3.5-turbo',
            calls: 1,
            tokens: 200,
            cost: 0.001,
          },
        ],
        timeRange: {
          start: startDate,
          end: endDate,
        },
      });
    });
  });

  describe('getProjectCostSummaries', () => {
    it('should return project summaries ordered by total cost', async () => {
      const startDate = new Date('2023-01-01');
      const endDate = new Date('2023-01-31');
      const organizationId = 'org-123' as OrganizationId;

      const mockRecords = [
        {
          projectId: 'project-1' as ProjectId,
          project: { name: 'Apollo' },
          totalTokens: 100,
          totalCost: { toNumber: () => 0.002 },
        },
        {
          projectId: 'project-2' as ProjectId,
          project: { name: 'Zeus' },
          totalTokens: 200,
          totalCost: { toNumber: () => 0.01 },
        },
      ];

      (prisma.db.lLMPromptResponse.findMany as jest.Mock).mockResolvedValue(
        mockRecords,
      );

      const result = await service.getProjectCostSummaries(
        organizationId,
        startDate,
        endDate,
      );

      expect(result).toEqual([
        {
          projectId: 'project-2',
          projectName: 'Zeus',
          totalCalls: 1,
          totalTokens: 200,
          totalCost: 0.01,
          timeRange: {
            start: startDate,
            end: endDate,
          },
        },
        {
          projectId: 'project-1',
          projectName: 'Apollo',
          totalCalls: 1,
          totalTokens: 100,
          totalCost: 0.002,
          timeRange: {
            start: startDate,
            end: endDate,
          },
        },
      ]);
    });
  });
});

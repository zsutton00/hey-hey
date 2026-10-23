import {
  InitiativeOptimizationService,
  InitiativeChangeDetection,
} from '../initiative-optimization.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { InitiativeArtifactService } from '../initiative-artifact.service';
import * as TestUtils from '../../../utils/testUtils';
import { createServiceTestingModule } from '../../../../test/setup/testing-module.factory';

describe('InitiativeOptimizationService', () => {
  let service: InitiativeOptimizationService;
  let mockPrismaService: ReturnType<typeof TestUtils.createMockPrismaService>;
  let mockArtifactService: {
    getOriginalArtifactForInitiative: jest.Mock;
  };

  const initiativeId = TestUtils.testIds.initiative;
  const organizationId = TestUtils.testIds.organization;

  const baseInitiative = {
    name: 'Test Initiative',
    description: 'Seed description',
    priority: 'medium',
    tags: ['seed'],
    details: 'Seed details',
    acceptanceCriteria: 'Seed criteria',
    status: 'REFINING_DESCRIPTION',
  };

  const setCurrentSections = (
    overrides: {
      description?: string;
      details?: string;
      acceptanceCriteria?: string;
    } = {},
  ) => {
    const db = mockPrismaService.db as {
      initiativeSection?: { findMany?: jest.Mock };
    };
    if (!db.initiativeSection) {
      db.initiativeSection = {
        findMany: jest.fn(),
      } as any;
    } else if (!db.initiativeSection.findMany) {
      db.initiativeSection.findMany = jest.fn();
    }

    const initiativeSection = db.initiativeSection as {
      findMany: jest.Mock;
    };

    initiativeSection.findMany.mockResolvedValue(
      TestUtils.createMockMaterializedWorkItemSections({
        description: overrides.description ?? 'Seed description',
        details: overrides.details ?? 'Seed details',
        acceptanceCriteria: overrides.acceptanceCriteria ?? 'Seed criteria',
      }),
    );
  };

  const mockOriginalArtifact = (
    overrides: {
      description?: string;
      details?: string;
      acceptanceCriteria?: string;
    } = {},
  ) => {
    mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
      TestUtils.createMockArtifact({
        type: 'INITIATIVE_ORIGINAL' as any,
        data: {
          type: 'INITIATIVE_ORIGINAL',
          confidence: 0.95,
          reasoning: 'baseline',
          content: JSON.stringify({
            originalData: {
              name: baseInitiative.name,
              description: overrides.description ?? 'Seed description',
              details: overrides.details ?? 'Seed details',
              acceptanceCriteria:
                overrides.acceptanceCriteria ?? 'Seed criteria',
              priority: baseInitiative.priority,
              tags: baseInitiative.tags,
              reasoning: 'baseline',
            },
          }),
        } as any,
      }),
    );
  };

  beforeEach(async () => {
    mockPrismaService = TestUtils.createMockPrismaService();
    mockArtifactService = {
      getOriginalArtifactForInitiative: jest.fn(),
    };

    setCurrentSections();

    const setup = await createServiceTestingModule({
      providers: [
        InitiativeOptimizationService,
        PrismaService,
        InitiativeArtifactService,
      ],
      overrides: [
        [PrismaService, mockPrismaService],
        [InitiativeArtifactService, mockArtifactService],
      ],
    });

    service = setup.module.get(InitiativeOptimizationService);

    (service as any).logger = {
      log: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };

    jest.clearAllMocks();
  });

  describe('detectChanges', () => {
    it('throws when initiative is missing', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue(null);

      await expect(
        service.detectChanges(initiativeId, organizationId),
      ).rejects.toThrow(`Initiative ${initiativeId} not found`);
    });

    it('requires regeneration when original artifact is missing', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue({
        ...baseInitiative,
        status: 'REFINING_DESCRIPTION',
      });
      mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
        null,
      );

      const result = await service.detectChanges(initiativeId, organizationId);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toEqual(['description']);
      expect(result.changesSummary).toContain('No original artifact found');
    });

    it('returns pristine detection when current content matches original artifact', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue({
        ...baseInitiative,
        status: 'REFINING_DESCRIPTION',
      });
      mockOriginalArtifact();

      const result = await service.detectChanges(initiativeId, organizationId);

      expect(result.hasChanges).toBe(false);
      expect(result.changedFields).toEqual([]);
      expect(result.changesSummary).toBe('No changes detected');
      expect(result.semanticSimilarity.overall).toBe(1);
    });

    it('detects description edits while refining description', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue({
        ...baseInitiative,
        status: 'REFINING_DESCRIPTION',
      });
      setCurrentSections({ description: 'New description by user' });
      mockOriginalArtifact({ description: 'Seed description' });

      const result = await service.detectChanges(initiativeId, organizationId);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toEqual(['description']);
      expect(result.fieldLevelChanges.description?.current).toBe(
        'New description by user',
      );
      expect(result.confidenceScore).toBe(1);
    });

    it('ignores details diffs while still refining description', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue({
        ...baseInitiative,
        status: 'REFINING_DESCRIPTION',
      });
      setCurrentSections({ details: 'Updated details' });
      mockOriginalArtifact({ details: 'Seed details' });

      const result = await service.detectChanges(initiativeId, organizationId);

      expect(result.hasChanges).toBe(false);
      expect(result.changedFields).toEqual([]);
    });

    it('includes details edits once refining details', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue({
        ...baseInitiative,
        status: 'REFINING_DETAILS',
      });
      setCurrentSections({ details: 'Updated details' });
      mockOriginalArtifact({ details: 'Seed details' });

      const result = await service.detectChanges(initiativeId, organizationId);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toEqual(['details']);
      expect(result.fieldLevelChanges.details?.current).toBe('Updated details');
    });

    it('includes acceptance criteria edits when refining acceptance criteria', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue({
        ...baseInitiative,
        status: 'REFINING_ACCEPTANCE_CRITERIA',
      });
      setCurrentSections({ acceptanceCriteria: 'Updated AC' });
      mockOriginalArtifact({ acceptanceCriteria: 'Seed criteria' });

      const result = await service.detectChanges(initiativeId, organizationId);

      expect(result.hasChanges).toBe(true);
      expect(result.changedFields).toEqual(['acceptanceCriteria']);
      expect(result.fieldLevelChanges.acceptanceCriteria?.current).toBe(
        'Updated AC',
      );
    });

    it('throws when artifact payload is malformed', async () => {
      mockPrismaService.db.initiative.findFirst.mockResolvedValue({
        ...baseInitiative,
        status: 'REFINING_DESCRIPTION',
      });
      mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
        TestUtils.createMockArtifact({
          type: 'INITIATIVE_ORIGINAL' as any,
          data: {
            type: 'INITIATIVE_ORIGINAL',
            confidence: 0.95,
            reasoning: 'baseline',
            content: JSON.stringify({
              originalData: { description: 'only one field' },
            }),
          } as any,
        }),
      );

      await expect(
        service.detectChanges(initiativeId, organizationId),
      ).rejects.toThrow(/missing required field/i);
    });
  });

  describe('generateOptimizationContext', () => {
    it('skips LLM when no changes detected', async () => {
      const detection: InitiativeChangeDetection = {
        hasChanges: false,
        changesSummary: 'No changes detected',
        changedFields: [] as string[],
        confidenceScore: 1,
        originalData: null,
        currentData: baseInitiative,
        semanticSimilarity: { name: 1, description: 1, overall: 1 },
        fieldLevelChanges: {},
      };

      const context = await service.generateOptimizationContext(detection);

      expect(context.shouldSkipLlm).toBe(true);
      expect(context.optimizationHints).toContain(
        'No pending user edits detected',
      );
    });

    it('requests regeneration when user edits exist', async () => {
      const detection: InitiativeChangeDetection = {
        hasChanges: true,
        changesSummary: 'User edits pending for: description',
        changedFields: ['description'],
        confidenceScore: 1,
        originalData: null,
        currentData: baseInitiative,
        semanticSimilarity: { name: 1, description: 0, overall: 0 },
        fieldLevelChanges: {
          description: {
            original: 'old',
            current: 'new',
            similarity: 0,
            changeType: 'major' as const,
          },
        },
      };

      const context = await service.generateOptimizationContext(detection);

      expect(context.shouldSkipLlm).toBe(false);
      const [hint] = context.optimizationHints ?? [];
      if (!hint) {
        throw new Error('Expected optimization hint');
      }
      expect(hint).toContain('Pending user edits');
    });
  });

  describe('batchDetectChanges', () => {
    it('delegates to detectChanges for each initiative', async () => {
      const detectChangesSpy = jest
        .spyOn(service, 'detectChanges')
        .mockResolvedValue({
          hasChanges: false,
          changesSummary: 'No changes detected',
          changedFields: [],
          confidenceScore: 1,
          originalData: null,
          currentData: baseInitiative,
          semanticSimilarity: { name: 1, description: 1, overall: 1 },
          fieldLevelChanges: {},
        } as InitiativeChangeDetection);

      const results = await service.batchDetectChanges(
        [initiativeId],
        organizationId,
      );

      expect(detectChangesSpy).toHaveBeenCalledWith(
        initiativeId,
        organizationId,
      );
      expect(results.get(initiativeId)?.hasChanges).toBe(false);
    });
  });
});

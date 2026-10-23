import { Test, TestingModule } from '@nestjs/testing';
import { InitiativeOptimizationAdapterService } from '../initiative-optimization-adapter.service';
import { InitiativeService } from '../initiative.service';
import { InitiativeArtifactService } from '../initiative-artifact.service';
import { InitiativeOptimizationService } from '../initiative-optimization.service';
import {
  InitiativeResponseDto,
  ArtifactResponseDto,
  ArtifactType,
  Influence,
  Priority,
  InsightData,
} from '../../../generated';
import {
  OrganizationId,
  InitiativeId,
  UserId,
  ProjectId,
} from '../../../types';
import {
  ChangeDetectionResult,
  OptimizationContext,
} from '../../../types/refinable-entity.types';
import * as TestUtils from '../../../utils/testUtils';

const { testIds } = TestUtils;

describe('InitiativeOptimizationAdapterService', () => {
  let service: InitiativeOptimizationAdapterService;
  let mockInitiativeService: jest.Mocked<InitiativeService>;
  let mockArtifactService: jest.Mocked<InitiativeArtifactService>;
  let mockLegacyOptimizationService: jest.Mocked<InitiativeOptimizationService>;

  const testOrgId = testIds.organization;
  const testInitiativeId = testIds.initiative;
  const testProjectId = testIds.project;

  const mockArtifactBase = TestUtils.createMockArtifact({
    type: ArtifactType.Insight,
    data: {
      type: 'INSIGHT' as const,
      confidence: 1,
      reasoning: 'Test reasoning',
      content: '{}',
    } as InsightData,
  });

  beforeEach(async () => {
    // Create mocks using TestUtils
    mockInitiativeService = TestUtils.createMockInitiativeService();
    mockArtifactService =
      TestUtils.createMockInitiativeArtifactService() as unknown as jest.Mocked<InitiativeArtifactService>;
    mockLegacyOptimizationService =
      TestUtils.createMockInitiativeOptimizationService();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InitiativeOptimizationAdapterService,
        {
          provide: InitiativeService,
          useValue: mockInitiativeService,
        },
        {
          provide: InitiativeArtifactService,
          useValue: mockArtifactService,
        },
        {
          provide: InitiativeOptimizationService,
          useValue: mockLegacyOptimizationService,
        },
      ],
    }).compile();

    service = module.get<InitiativeOptimizationAdapterService>(
      InitiativeOptimizationAdapterService,
    );
  });

  describe('getEntityType', () => {
    it('should return initiative entity type', () => {
      // Act
      const entityType = (service as any).getEntityType();

      // Assert
      expect(entityType).toBe('initiative');
    });
  });

  describe('findOne', () => {
    it('should delegate to InitiativeService', async () => {
      // Arrange
      const mockInitiative = TestUtils.createMockInitiative({
        id: testInitiativeId,
        name: 'Test Initiative',
        sections: TestUtils.createMockMaterializedWorkItemSections({
          description: 'Test description',
          details: 'Test details',
          acceptanceCriteria: 'Test criteria',
        }),
        status: 'ACTIVE',
        priority: 'HIGH',
        assigneeId: 'user-123' as UserId,
        organizationId: testOrgId,
        sourceConversationId: 'conv-123',
        creatorType: 'USER',
        reasoning: 'Test reasoning',
        dueDate: '',
        tags: ['test'],
      });

      mockInitiativeService.findOneForAdapter.mockResolvedValue(mockInitiative);

      // Act
      const result = await (service as any).findOne(
        testInitiativeId,
        testOrgId,
      );

      // Assert - toInitiativeRefinableEntity now includes all fields
      expect(result).toEqual({
        id: testInitiativeId,
        name: 'Test Initiative',
        description: 'Test description',
        details: 'Test details',
        acceptanceCriteria: 'Test criteria',
        status: 'ACTIVE',
        priority: 'HIGH',
        assigneeId: 'user-123',
        organizationId: testOrgId,
        createdAt: mockInitiative.createdAt,
        updatedAt: mockInitiative.updatedAt,
        tags: ['test'],
        reasoning: 'Test reasoning',
      });
      expect(mockInitiativeService.findOneForAdapter).toHaveBeenCalledWith(
        testInitiativeId,
        testOrgId,
      );
    });
  });

  describe('detectChanges', () => {
    it('should use legacy optimization service and convert result', async () => {
      // Arrange
      const mockLegacyResult = {
        hasChanges: true,
        changesSummary: 'Description updated',
        changedFields: ['description'],
        confidenceScore: 0.8,
        originalData: null as any,
        currentData: {
          name: 'Test',
          description: 'Updated',
          priority: 'high',
          tags: [] as string[],
          status: 'REFINING_DESCRIPTION',
        },
        semanticSimilarity: {
          name: 1.0,
          description: 0.6,
          overall: 0.8,
        },
        fieldLevelChanges: {},
      };

      mockLegacyOptimizationService.detectChanges.mockResolvedValue(
        mockLegacyResult,
      );

      // Act
      const result = await service.detectChanges(testInitiativeId, testOrgId);

      // Assert
      expect(result.hasChanges).toBe(true);
      expect(result.changesSummary).toBe('Description updated');
      expect(result.affectedFields).toEqual(['description']);
      expect(result.confidenceScore).toBe(0.8);
      expect(result.changeType).toBe('major'); // description has high priority
      expect(mockLegacyOptimizationService.detectChanges).toHaveBeenCalledWith(
        testInitiativeId,
        testOrgId,
      );
    });

    it('should map change types correctly', async () => {
      // Test structural changes (name change or low confidence)
      const structuralChangeResult = {
        hasChanges: true,
        changesSummary: 'Name changed',
        changedFields: ['name'],
        confidenceScore: 0.2,
        originalData: null as any,
        currentData: {
          name: 'New Name',
          description: '',
          priority: '',
          tags: [] as string[],
          status: 'REFINING_DESCRIPTION',
        },
        semanticSimilarity: { name: 0.0, description: 1.0, overall: 0.2 },
        fieldLevelChanges: {},
      };

      mockLegacyOptimizationService.detectChanges.mockResolvedValue(
        structuralChangeResult,
      );

      // Act
      const result = await service.detectChanges(testInitiativeId, testOrgId);

      // Assert
      expect(result.changeType).toBe('structural');
    });

    it('should fallback to base implementation on error', async () => {
      // Arrange
      mockLegacyOptimizationService.detectChanges.mockRejectedValue(
        new Error('Legacy service failed'),
      );

      // Mock the base detectChanges method by setting up entity
      mockInitiativeService.findOneForAdapter.mockResolvedValue(
        TestUtils.createMockInitiative({
          id: testInitiativeId,
          name: 'Test Initiative',
          sections: TestUtils.createMockMaterializedWorkItemSections({
            description: 'Test description',
            details: '',
            acceptanceCriteria: '',
          }),
          status: 'ACTIVE',
          priority: 'MEDIUM',
          assigneeId: undefined,
          organizationId: testOrgId,
          sourceConversationId: 'conv-123',
          creatorType: 'USER',
          reasoning: undefined,
          dueDate: '',
          tags: [],
        }),
      );

      mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
        null,
      );

      // Act
      const result = await service.detectChanges(testInitiativeId, testOrgId);

      // Assert
      expect(result.hasChanges).toBe(true);
      expect(result.changesSummary).toContain('No original artifact found');
      expect(mockLegacyOptimizationService.detectChanges).toHaveBeenCalled();
    });
  });

  describe('generateOptimizationContext', () => {
    it('should use legacy service and convert context', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: true,
        changesSummary: 'Minor updates',
        confidenceScore: 0.7,
        affectedFields: ['description'],
        changeType: 'minor',
      };

      const mockLegacyContext = {
        shouldSkipLlm: false,
        optimizationHints: [
          'Light processing recommended',
          'Focus on description',
        ],
        confidenceScore: 0.7,
      };

      mockLegacyOptimizationService.generateOptimizationContext.mockResolvedValue(
        mockLegacyContext,
      );

      // Act
      const result = await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(result.shouldSkipLlm).toBe(false);
      expect(result.optimizationHints).toEqual([
        'Light processing recommended',
        'Focus on description',
      ]);
      expect(result.processingRecommendation).toBe('generate'); // Moderate confidence
      expect(result.estimatedProcessingTime).toBe(20); // Not skipping LLM
    });

    it('should recommend skipping when legacy service suggests it', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: false,
        changesSummary: 'No changes',
        confidenceScore: 0.95,
        affectedFields: [],
        changeType: 'minor',
      };

      const mockLegacyContext = {
        shouldSkipLlm: true,
        optimizationHints: ['No processing needed'],
        confidenceScore: 0.95,
      };

      mockLegacyOptimizationService.generateOptimizationContext.mockResolvedValue(
        mockLegacyContext,
      );

      // Act
      const result = await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(result.shouldSkipLlm).toBe(true);
      expect(result.processingRecommendation).toBe('skip');
      expect(result.estimatedProcessingTime).toBe(2); // Fast skip
    });

    it('should fallback to base implementation on error', async () => {
      // Arrange
      const changeDetection: ChangeDetectionResult = {
        hasChanges: true,
        changesSummary: 'Changes detected',
        confidenceScore: 0.8,
        affectedFields: ['description'],
        changeType: 'major',
      };

      mockLegacyOptimizationService.generateOptimizationContext.mockRejectedValue(
        new Error('Legacy context generation failed'),
      );

      // Act
      const result = await service.generateOptimizationContext(changeDetection);

      // Assert
      expect(result.shouldSkipLlm).toBe(false);
      expect(result.processingRecommendation).toBe('generate');
      expect(result.optimizationHints).toContain('Major changes detected');
      expect(
        mockLegacyOptimizationService.generateOptimizationContext,
      ).toHaveBeenCalled();
    });
  });

  describe('artifact service adapter', () => {
    let artifactServiceAdapter: any;

    beforeEach(() => {
      // Access the private adapter instance for testing
      artifactServiceAdapter = (service as any).artifactServiceAdapter;
    });

    describe('getOriginalArtifact', () => {
      it('should retrieve and convert original artifact', async () => {
        // Arrange
        const mockArtifact = TestUtils.createMockArtifact({
          type: ArtifactType.Insight,
          data: {
            type: 'INSIGHT' as const,
            confidence: 1,
            reasoning: 'Test reasoning',
            content: JSON.stringify({
              name: 'Original Initiative',
              description: 'Original description',
              details: 'Original details',
              acceptanceCriteria: 'Original criteria',
              priority: 'high',
              tags: ['original'],
              reasoning: 'Original reasoning',
            }),
          } as InsightData,
        });

        mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
          mockArtifact,
        );

        // Act
        const result = await artifactServiceAdapter.getOriginalArtifact(
          testInitiativeId,
          testOrgId,
        );

        // Assert
        expect(result).toBeDefined();
        expect(result.name).toBe('Original Initiative');
        expect(result.description).toBe('Original description');
        expect(result.details).toBe('Original details');
        expect(result.acceptanceCriteria).toBe('Original criteria');
        expect(result.priority).toBe('HIGH');
        expect(result.tags).toEqual(['original']);
        expect(
          mockArtifactService.getOriginalArtifactForInitiative,
        ).toHaveBeenCalledWith(testInitiativeId, testOrgId);
      });

      it('should return null when no artifact exists', async () => {
        // Arrange
        mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
          null,
        );

        // Act
        const result = await artifactServiceAdapter.getOriginalArtifact(
          testInitiativeId,
          testOrgId,
        );

        // Assert
        expect(result).toBeNull();
      });

      it('should throw error for invalid artifact type', async () => {
        // Arrange
        const mockArtifact = TestUtils.createMockArtifact({
          type: ArtifactType.Insight,
          data: {
            type: 'WRONG_TYPE' as any,
            content: '{}',
          } as unknown as InsightData,
        });

        mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
          mockArtifact,
        );

        // Act & Assert
        await expect(
          artifactServiceAdapter.getOriginalArtifact(
            testInitiativeId,
            testOrgId,
          ),
        ).rejects.toThrow('Expected INSIGHT artifact, got WRONG_TYPE');
      });

      it('should throw error for invalid JSON content', async () => {
        // Arrange
        const mockArtifact = TestUtils.createMockArtifact({
          type: ArtifactType.Insight,
          data: {
            type: 'INSIGHT' as const,
            confidence: 1,
            reasoning: 'Test reasoning',
            content: 'invalid-json',
          } as InsightData,
        });

        mockArtifactService.getOriginalArtifactForInitiative.mockResolvedValue(
          mockArtifact,
        );

        // Act & Assert
        await expect(
          artifactServiceAdapter.getOriginalArtifact(
            testInitiativeId,
            testOrgId,
          ),
        ).rejects.toThrow('Failed to parse original artifact data');
      });
    });

    describe('saveArtifactSnapshot', () => {
      it('should convert and save entity snapshot', async () => {
        // Arrange
        const entity = {
          id: testInitiativeId,
          name: 'Test Initiative',
          description: 'Test description',
          details: 'Test details',
          acceptanceCriteria: 'Test criteria',
          status: 'ACTIVE',
          priority: 'HIGH',
          assigneeId: 'user-123' as UserId,
          organizationId: testOrgId,
          createdAt: new Date(),
          updatedAt: new Date(),
          tags: ['test', 'snapshot'],
          reasoning: 'Test reasoning',
        };

        mockArtifactService.storeOriginalGeneration.mockResolvedValue([
          mockArtifactBase,
        ]);
        mockInitiativeService.findOneForAdapter.mockResolvedValue({
          ...TestUtils.createMockInitiative({
            id: testInitiativeId,
            organizationId: testOrgId,
          }),
          originatingProjectId: testProjectId,
        } as InitiativeResponseDto);

        // Act
        await artifactServiceAdapter.saveArtifactSnapshot(entity, testOrgId);

        // Assert
        expect(
          mockArtifactService.storeOriginalGeneration,
        ).toHaveBeenCalledWith(
          [
            {
              name: 'Test Initiative',
              description: 'Test description',
              details: 'Test details',
              acceptanceCriteria: 'Test criteria',
              priority: 'high',
              tags: ['test', 'snapshot'],
              reasoning: 'Test reasoning',
              influences: [] as Influence[],
            },
          ],
          [{ id: testInitiativeId }],
          testOrgId,
          testProjectId,
          {
            sourceId: testInitiativeId,
            generationModel: 'snapshot-save',
            generationPrompt: 'entity-snapshot',
            originalRequestContext: {
              source: 'optimization-service-snapshot',
              timestamp: expect.any(String),
            },
          },
        );
      });

      it('should handle null/undefined fields correctly', async () => {
        // Arrange
        const entity = {
          id: testInitiativeId,
          name: 'Test Initiative',
          description: 'Test description',
          details: '',
          acceptanceCriteria: '',
          status: 'ACTIVE',
          priority: null as unknown as Priority,
          assigneeId: null as unknown as UserId,
          organizationId: testOrgId,
          createdAt: new Date(),
          updatedAt: new Date(),
          reasoning: null as unknown as string,
          tags: null as unknown as string[],
        };

        mockArtifactService.storeOriginalGeneration.mockResolvedValue([
          mockArtifactBase,
        ]);
        mockInitiativeService.findOneForAdapter.mockResolvedValue({
          ...TestUtils.createMockInitiative({
            id: testInitiativeId,
            organizationId: testOrgId,
          }),
          originatingProjectId: testProjectId,
        } as InitiativeResponseDto);

        // Act
        await artifactServiceAdapter.saveArtifactSnapshot(entity, testOrgId);

        // Assert
        const expectedOriginalData = {
          name: 'Test Initiative',
          description: 'Test description',
          details: '',
          acceptanceCriteria: '',
          priority: 'medium', // Default mapping
          tags: [] as string[],
          reasoning: null as string | null,
          influences: [] as Influence[],
        };

        expect(
          mockArtifactService.storeOriginalGeneration,
        ).toHaveBeenCalledWith(
          [expectedOriginalData],
          [{ id: testInitiativeId }],
          testOrgId,
          testProjectId,
          expect.any(Object),
        );
      });
    });

    describe('priority mapping', () => {
      it('should map priority to database format correctly', () => {
        // Access private methods through any casting for testing
        const adapter = artifactServiceAdapter;

        expect(adapter.mapPriorityToDatabase('low')).toBe('LOW');
        expect(adapter.mapPriorityToDatabase('medium')).toBe('MEDIUM');
        expect(adapter.mapPriorityToDatabase('high')).toBe('HIGH');
        expect(adapter.mapPriorityToDatabase('critical')).toBe('CRITICAL');
        expect(adapter.mapPriorityToDatabase('unknown')).toBe('MEDIUM'); // Default
      });

      it('should map priority from database format correctly', () => {
        const adapter = artifactServiceAdapter;

        expect(adapter.mapPriorityFromDatabase('LOW')).toBe('low');
        expect(adapter.mapPriorityFromDatabase('MEDIUM')).toBe('medium');
        expect(adapter.mapPriorityFromDatabase('HIGH')).toBe('high');
        expect(adapter.mapPriorityFromDatabase('CRITICAL')).toBe('critical');
        expect(adapter.mapPriorityFromDatabase(null)).toBe('medium'); // Default
        expect(adapter.mapPriorityFromDatabase('UNKNOWN')).toBe('medium'); // Default
      });
    });
  });
});

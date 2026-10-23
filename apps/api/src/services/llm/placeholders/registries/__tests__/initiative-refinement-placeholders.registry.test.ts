import { InitiativeRefinementPlaceholderRegistry } from '../initiative-refinement-placeholders.registry';
import { PlaceholderContext } from '../../base/placeholder-types';
import type { InitiativeRefinementFlowContext } from '../../../../../types/flow-internal.types';
import * as TestUtils from '../../../../../utils/testUtils';

const { testIds } = TestUtils;

describe('InitiativeRefinementPlaceholderRegistry', () => {
  let mockContext: PlaceholderContext;
  let mockFlowContext: InitiativeRefinementFlowContext;
  let mockInitiativeService: jest.Mocked<any>;
  let mockArtifactService: jest.Mocked<any>;

  beforeEach(() => {
    mockInitiativeService = TestUtils.createMockInitiativeService();
    mockArtifactService = TestUtils.createMockArtifactService();

    mockFlowContext = {
      ...TestUtils.createMockFlowContext(),
      initiativeId: testIds.initiative,
    } as InitiativeRefinementFlowContext;

    mockContext = {
      flowContext: mockFlowContext,
      userMessage: TestUtils.createMockFlowUserMessage(),
      nodeBuildContext: {
        changeDetection: {
          hasChanges: true,
          changeType: 'major' as const,
          affectedFields: ['name', 'description'],
          summary:
            'Significant changes detected in name and description fields',
          confidence: 0.85,
        },
      },
      services: {
        initiativeService: mockInitiativeService,
        artifactService: mockArtifactService,
        taskService: {} as any,
        designDocService: {} as any,
        contextResolutionService: {
          resolveContext: jest.fn(),
        } as any,
      },
      options: {},
    };
  });

  const requireNodeBuildContext = () => {
    if (!mockContext.nodeBuildContext) {
      throw new Error('Expected nodeBuildContext');
    }
    return mockContext.nodeBuildContext;
  };

  describe('OPTIMIZATION_STRATEGY placeholder', () => {
    it('should return "structural" for low confidence change detection', () => {
      requireNodeBuildContext().changeDetection = {
        hasChanges: true,
        changeType: 'minor' as const,
        affectedFields: ['name'],
        summary: 'Minor change',
        confidence: 0.3, // Low confidence
      };

      const result =
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY.resolver(
          mockContext,
        );
      expect(result).toBe('structural');
    });

    it('should return "major" for major changes with many affected fields', () => {
      requireNodeBuildContext().changeDetection = {
        hasChanges: true,
        changeType: 'major' as const,
        affectedFields: ['name', 'description', 'priority', 'tags'],
        summary: 'Major changes across multiple fields',
        confidence: 0.8,
      };

      const result =
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY.resolver(
          mockContext,
        );
      expect(result).toBe('major');
    });

    it('should return "minor" for minor changes with high confidence', () => {
      requireNodeBuildContext().changeDetection = {
        hasChanges: true,
        changeType: 'minor' as const,
        affectedFields: ['description'],
        summary: 'Minor refinement needed',
        confidence: 0.9,
      };

      const result =
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY.resolver(
          mockContext,
        );
      expect(result).toBe('minor');
    });

    it('should return "minor" when no change detection data available', () => {
      mockContext.nodeBuildContext = {};

      const result =
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY.resolver(
          mockContext,
        );
      expect(result).toBe('minor');
    });
  });

  describe('CHANGE_DETECTION_SUMMARY placeholder', () => {
    it('should format change detection with changes present', () => {
      const result =
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION_SUMMARY.resolver(
          mockContext,
        );

      expect(result).toContain('## Change Detection Summary');
      expect(result).toContain('**Change Status**: Changes Detected');
      expect(result).toContain('**Change Type**: Major');
      expect(result).toContain('**Confidence**: 85.0%');
      expect(result).toContain('**Affected Fields**: name, description');
      expect(result).toContain(
        'Significant changes detected in name and description fields',
      );
    });

    it('should handle no change detection data', () => {
      mockContext.nodeBuildContext = {};

      const result =
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION_SUMMARY.resolver(
          mockContext,
        );

      expect(result).toContain('## Change Detection Summary');
      expect(result).toContain('No change detection data available');
      expect(result).toContain(
        'Current optimization will proceed with default strategy',
      );
    });

    it('should format no changes detected', () => {
      requireNodeBuildContext().changeDetection = {
        hasChanges: false,
        changeType: 'minor' as const,
        affectedFields: [],
        summary: 'No significant changes detected',
        confidence: 0.95,
      };

      const result =
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION_SUMMARY.resolver(
          mockContext,
        );

      expect(result).toContain('**Change Status**: No Changes Detected');
      expect(result).toContain('**Affected Fields**: None');
    });
  });

  describe('ORIGINAL_ARTIFACTS_SUMMARY placeholder', () => {
    it('should format artifacts summary with data', async () => {
      const mockArtifacts = [
        TestUtils.createMockArtifact({
          type: 'REQUIREMENT' as any,
          title: 'Test Requirement',
          updatedAt: '2024-01-15T10:00:00Z',
        }),
        TestUtils.createMockArtifact({
          type: 'TASK' as any,
          title: 'Test Task',
          updatedAt: '2024-01-16T12:00:00Z',
        }),
      ];

      mockArtifactService.findMany.mockResolvedValue({
        data: mockArtifacts,
        meta: { total: 2, page: 1, pageSize: 10 },
      });

      const result =
        await InitiativeRefinementPlaceholderRegistry.ORIGINAL_ARTIFACTS_SUMMARY.resolver(
          mockContext,
        );

      expect(result).toContain('## Original Artifacts Summary');
      expect(result).toContain('**Total Artifacts**: 2');
      expect(result).toContain('**Artifact Types**: REQUIREMENT, TASK');
      expect(result).toContain('2024-01-16T12:00:00.000Z'); // Latest update time
      expect(result).toContain('**Content Overview**:');
      expect(result).toContain('- Test Requirement: No content available...');
      expect(result).toContain('- Test Task: No content available...');
    });

    it('should handle no artifacts found', async () => {
      mockArtifactService.findMany.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, pageSize: 10 },
      });

      const result =
        await InitiativeRefinementPlaceholderRegistry.ORIGINAL_ARTIFACTS_SUMMARY.resolver(
          mockContext,
        );

      expect(result).toContain('## Original Artifacts Summary');
      expect(result).toContain('**Total Artifacts**: 0');
      expect(result).toContain('**Artifact Types**: ');
      expect(result).toContain('**Last Updated**: No artifacts');
      expect(result).toContain(
        'No original artifacts found for this initiative.',
      );
    });

    it('should handle service error gracefully', async () => {
      const mockError = new Error('Database connection failed');
      mockArtifactService.findMany.mockRejectedValue(mockError);

      const result =
        await InitiativeRefinementPlaceholderRegistry.ORIGINAL_ARTIFACTS_SUMMARY.resolver(
          mockContext,
        );

      expect(result).toContain('## Original Artifacts Summary');
      expect(result).toContain('**Error**: Unable to fetch original artifacts');
      expect(result).toContain(`**Initiative ID**: ${testIds.initiative}`);
      expect(result).toContain('**Reason**: Database connection failed');
    });
  });

  describe('OPTIMIZATION_CONTEXT placeholder', () => {
    it('should build complete optimization context', async () => {
      const mockArtifacts = [
        TestUtils.createMockArtifact({ type: 'REQUIREMENT' as any }),
      ];
      mockArtifactService.findMany.mockResolvedValue({
        data: mockArtifacts,
        meta: { total: 1, page: 1, pageSize: 10 },
      });

      const result =
        await InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_CONTEXT.resolver(
          mockContext,
        );

      expect(result).toContain('# Optimization Context');
      expect(result).toContain('## Current Strategy: Major');
      expect(result).toContain('## Change Detection Summary');
      expect(result).toContain('## Original Artifacts Summary');
      expect(result).toContain('## Optimization Guidelines');
      expect(result).toContain('Significant changes are expected');
    });

    it('should adapt guidelines based on strategy', async () => {
      // Set up for minor optimization
      requireNodeBuildContext().changeDetection = {
        hasChanges: true,
        changeType: 'minor' as const,
        affectedFields: ['description'],
        summary: 'Minor changes',
        confidence: 0.9,
      };

      mockArtifactService.findMany.mockResolvedValue({
        data: [],
        meta: { total: 0, page: 1, pageSize: 10 },
      });

      const result =
        await InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_CONTEXT.resolver(
          mockContext,
        );

      expect(result).toContain('## Current Strategy: Minor');
      expect(result).toContain('Focus on small refinements and improvements');
      expect(result).toContain('Maintain existing structure and core concepts');
    });
  });

  describe('CHANGE_DETECTION placeholder', () => {
    it('should format detailed change detection analysis', () => {
      const result =
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION.resolver(
          mockContext,
        );

      expect(result).toContain('## Change Detection Analysis');
      expect(result).toContain('**Has Changes**: Yes');
      expect(result).toContain('**Change Type**: Major');
      expect(result).toContain('**Confidence Level**: High (85.0%)');
      expect(result).toContain('**Affected Areas**:');
      expect(result).toContain('- name');
      expect(result).toContain('- description');
      expect(result).toContain(
        '**Analysis Summary**: Significant changes detected in name and description fields',
      );
      expect(result).toContain('**Optimization Approach**:');
      expect(result).toContain('Significant updates needed');
    });

    it('should handle no change detection data', () => {
      mockContext.nodeBuildContext = {};

      const result =
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION.resolver(
          mockContext,
        );

      expect(result).toContain('## Change Detection Analysis');
      expect(result).toContain(
        '**Status**: No change detection data available',
      );
      expect(result).toContain(
        '**Recommendation**: Proceed with standard optimization approach',
      );
    });

    it('should adapt optimization approach based on change type', () => {
      requireNodeBuildContext().changeDetection = {
        hasChanges: true,
        changeType: 'structural' as const,
        affectedFields: ['name', 'description', 'priority'],
        summary: 'Structural changes needed',
        confidence: 0.7,
      };

      const result =
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION.resolver(
          mockContext,
        );

      expect(result).toContain('**Change Type**: Structural');
      expect(result).toContain('Deep structural analysis recommended');
    });
  });

  describe('error handling', () => {
    it('should handle errors in optimization strategy determination', () => {
      // Test that the function works defensively - it should handle null flowContext without throwing
      const badContext = {
        ...mockContext,
        flowContext: null as any,
        nodeBuildContext: {}, // Clear the change detection that's causing it to return 'major'
      };

      // This should return 'minor' as the default strategy without change detection
      const result =
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY.resolver(
          badContext,
        );
      expect(result).toBe('minor');
    });

    it('should handle errors in change detection formatting', () => {
      // The function is defensive and returns a value for null changeDetection
      // Test that it handles null gracefully rather than throwing
      requireNodeBuildContext().changeDetection = null as any;

      const result =
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION.resolver(
          mockContext,
        );
      expect(result).toContain('No change detection data available');
    });
  });

  describe('placeholder definitions', () => {
    it('should have correct placeholder keys', () => {
      expect(
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY.key,
      ).toBe('optimizationStrategy');
      expect(
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION_SUMMARY.key,
      ).toBe('changeDetectionSummary');
      expect(
        InitiativeRefinementPlaceholderRegistry.ORIGINAL_ARTIFACTS_SUMMARY.key,
      ).toBe('originalArtifactsSummary');
      expect(
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_CONTEXT.key,
      ).toBe('optimizationContext');
      expect(InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION.key).toBe(
        'changeDetection',
      );
    });

    it('should have correct content block flags', () => {
      expect(
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY
          .isContentBlock,
      ).toBe(false);
      expect(
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION_SUMMARY
          .isContentBlock,
      ).toBe(true);
      expect(
        InitiativeRefinementPlaceholderRegistry.ORIGINAL_ARTIFACTS_SUMMARY
          .isContentBlock,
      ).toBe(true);
      expect(
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_CONTEXT
          .isContentBlock,
      ).toBe(true);
      expect(
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION.isContentBlock,
      ).toBe(true);
    });

    it('should have appropriate descriptions', () => {
      expect(
        InitiativeRefinementPlaceholderRegistry.OPTIMIZATION_STRATEGY
          .description,
      ).toBe('Current optimization strategy based on initiative context');
      expect(
        InitiativeRefinementPlaceholderRegistry.CHANGE_DETECTION_SUMMARY
          .description,
      ).toBe('Summary of detected changes in initiative');
      expect(
        InitiativeRefinementPlaceholderRegistry.ORIGINAL_ARTIFACTS_SUMMARY
          .description,
      ).toBe('Summary of original artifacts before optimization');
    });
  });
});

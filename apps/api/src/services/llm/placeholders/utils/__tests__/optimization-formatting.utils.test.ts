import {
  formatInitiativeForOptimization,
  formatChangeDetectionForOptimization,
  determineOptimizationStrategy,
  formatOptimizationStrategy,
  buildOptimizationPlaceholder,
  extractChangeDetection,
  InitiativeOptimizationData,
  ChangeDetectionResult,
} from '../optimization-formatting.utils';

describe('OptimizationFormattingUtils', () => {
  describe('formatInitiativeForOptimization', () => {
    const mockInitiative: InitiativeOptimizationData = {
      id: 'test-id',
      name: 'Test Initiative',
      description: 'A test initiative for optimization',
      priority: 'HIGH',
      status: 'ACTIVE',
      tags: ['test', 'optimization'],
      reasoning: 'This is a test reasoning',
    };

    it('should format complete initiative data', () => {
      const result = formatInitiativeForOptimization(
        mockInitiative,
        'level-2',
        ['level-1', 'level-2', 'level-3'],
      );

      expect(result).toContain('**Initiative**: Test Initiative');
      expect(result).toContain(
        '**Description**: A test initiative for optimization',
      );
      expect(result).toContain('**Priority**: HIGH');
      expect(result).toContain('**Status**: ACTIVE');
      expect(result).toContain('**Tags**: test, optimization');
      expect(result).toContain(
        '**Current Level**: level-2 (Available: level-1, level-2, level-3)',
      );
      expect(result).toContain('**Reasoning**: This is a test reasoning');
    });

    it('should handle missing optional fields', () => {
      const minimalInitiative: InitiativeOptimizationData = { id: 'test-id' };
      const result = formatInitiativeForOptimization(minimalInitiative);

      expect(result).toContain('**Initiative**: Unnamed Initiative');
      expect(result).toContain('**Description**: No description available');
      expect(result).toContain('**Priority**: Not set');
      expect(result).toContain('**Status**: Unknown');
      expect(result).toContain('**Tags**: None');
      expect(result).not.toContain('**Reasoning**');
      expect(result).not.toContain('**Current Level**');
    });

    it('should handle null initiative', () => {
      const result = formatInitiativeForOptimization(null);

      expect(result).toContain('**Initiative**: Not available');
      expect(result).toContain('**Status**: Unable to load initiative data');
    });

    it('should format level info correctly', () => {
      const result = formatInitiativeForOptimization(
        mockInitiative,
        'current-level',
      );

      expect(result).toContain('**Current Level**: current-level');
      expect(result).not.toContain('Available:');
    });
  });

  describe('formatChangeDetectionForOptimization', () => {
    const mockChangeDetection: ChangeDetectionResult = {
      hasChanges: true,
      changeType: 'major',
      affectedFields: ['name', 'description'],
      summary: 'Significant changes detected',
      confidence: 0.85,
    };

    it('should format complete change detection data', () => {
      const result = formatChangeDetectionForOptimization(mockChangeDetection);

      expect(result).toContain('## Change Detection');
      expect(result).toContain('**Changes Detected**: ✓ Yes');
      expect(result).toContain('**Change Magnitude**: MAJOR');
      expect(result).toContain('**Confidence**: ████████░░ 85%');
      expect(result).toContain('**Affected Areas**:');
      expect(result).toContain('  • name');
      expect(result).toContain('  • description');
      expect(result).toContain('**Summary**: Significant changes detected');
    });

    it('should handle no changes detected', () => {
      const noChanges: ChangeDetectionResult = {
        hasChanges: false,
        changeType: 'minor',
        affectedFields: [],
        summary: 'No changes needed',
        confidence: 0.95,
      };

      const result = formatChangeDetectionForOptimization(noChanges);

      expect(result).toContain('**Changes Detected**: ✗ No');
      expect(result).toContain(
        '**Affected Areas**: No specific areas identified',
      );
      expect(result).toContain('**Confidence**: █████████░ 95%'); // 9 filled, 1 empty for 95%
    });

    it('should handle undefined change detection', () => {
      const result = formatChangeDetectionForOptimization(undefined);

      expect(result).toContain('## Change Detection');
      expect(result).toContain('**Status**: No change detection performed');
      expect(result).toContain(
        '**Recommendation**: Proceed with standard optimization',
      );
    });

    it('should format confidence bar correctly', () => {
      const lowConfidence: ChangeDetectionResult = {
        hasChanges: true,
        changeType: 'minor',
        affectedFields: ['test'],
        summary: 'Low confidence',
        confidence: 0.3,
      };

      const result = formatChangeDetectionForOptimization(lowConfidence);
      expect(result).toContain('**Confidence**: ███░░░░░░░ 30%');
    });
  });

  describe('determineOptimizationStrategy', () => {
    it('should return minor strategy for no change detection', () => {
      const strategy = determineOptimizationStrategy();

      expect(strategy.type).toBe('minor');
      expect(strategy.reasoning).toContain(
        'No change detection data available',
      );
      expect(strategy.confidence).toBe(0.6);
      expect(strategy.recommendedActions).toContain('Polish existing content');
    });

    it('should return structural strategy for low confidence', () => {
      const lowConfidenceChange: ChangeDetectionResult = {
        hasChanges: true,
        changeType: 'minor',
        affectedFields: ['name'],
        summary: 'Uncertain changes',
        confidence: 0.3,
      };

      const strategy = determineOptimizationStrategy(lowConfidenceChange);

      expect(strategy.type).toBe('structural');
      expect(strategy.reasoning).toContain('Structural changes needed');
      expect(strategy.reasoning).toContain('30% confidence');
      expect(strategy.recommendedActions).toContain(
        'Completely re-evaluate initiative structure',
      );
    });

    it('should return structural strategy for structural change type', () => {
      const structuralChange: ChangeDetectionResult = {
        hasChanges: true,
        changeType: 'structural',
        affectedFields: ['name'],
        summary: 'Structural changes needed',
        confidence: 0.8,
      };

      const strategy = determineOptimizationStrategy(structuralChange);

      expect(strategy.type).toBe('structural');
      expect(strategy.recommendedActions).toContain(
        'Question basic assumptions',
      );
    });

    it('should return major strategy for many affected fields', () => {
      const majorChange: ChangeDetectionResult = {
        hasChanges: true,
        changeType: 'minor',
        affectedFields: ['name', 'description', 'priority', 'tags'],
        summary: 'Many fields affected',
        confidence: 0.8,
      };

      const strategy = determineOptimizationStrategy(majorChange);

      expect(strategy.type).toBe('major');
      expect(strategy.reasoning).toContain('4 areas');
      expect(strategy.recommendedActions).toContain(
        'Significant restructuring of affected sections',
      );
    });

    it('should return major strategy for major change type', () => {
      const majorChange: ChangeDetectionResult = {
        hasChanges: true,
        changeType: 'major',
        affectedFields: ['name'],
        summary: 'Major changes needed',
        confidence: 0.8,
      };

      const strategy = determineOptimizationStrategy(majorChange);

      expect(strategy.type).toBe('major');
      expect(strategy.reasoning).toContain('Major optimization needed');
    });

    it('should return minor strategy for minor changes with high confidence', () => {
      const minorChange: ChangeDetectionResult = {
        hasChanges: true,
        changeType: 'minor',
        affectedFields: ['description'],
        summary: 'Small refinements needed',
        confidence: 0.9,
      };

      const strategy = determineOptimizationStrategy(minorChange);

      expect(strategy.type).toBe('minor');
      expect(strategy.reasoning).toContain('high confidence (90%)');
      expect(strategy.recommendedActions).toContain(
        'Refine and polish existing content',
      );
    });
  });

  describe('formatOptimizationStrategy', () => {
    it('should format minor strategy with correct icon', () => {
      const strategy = {
        type: 'minor' as const,
        reasoning: 'Minor changes needed',
        confidence: 0.8,
        recommendedActions: ['Polish content', 'Improve clarity'],
      };

      const result = formatOptimizationStrategy(strategy);

      expect(result).toContain('## Optimization Strategy ✨');
      expect(result).toContain('**Approach**: Minor Optimization');
      expect(result).toContain('**Confidence**: 80%');
      expect(result).toContain('**Reasoning**: Minor changes needed');
      expect(result).toContain('  • Polish content');
      expect(result).toContain('  • Improve clarity');
    });

    it('should format major strategy with correct icon', () => {
      const strategy = {
        type: 'major' as const,
        reasoning: 'Significant changes needed',
        confidence: 0.7,
        recommendedActions: ['Restructure sections'],
      };

      const result = formatOptimizationStrategy(strategy);

      expect(result).toContain('## Optimization Strategy 🔧');
      expect(result).toContain('**Approach**: Major Optimization');
    });

    it('should format structural strategy with correct icon', () => {
      const strategy = {
        type: 'structural' as const,
        reasoning: 'Complete restructure needed',
        confidence: 0.5,
        recommendedActions: ['Rebuild from scratch'],
      };

      const result = formatOptimizationStrategy(strategy);

      expect(result).toContain('## Optimization Strategy 🔄');
      expect(result).toContain('**Approach**: Structural Optimization');
    });
  });

  describe('buildOptimizationPlaceholder', () => {
    const mockInitiative: InitiativeOptimizationData = {
      id: 'test-id',
      name: 'Test Initiative',
      description: 'Test description',
    };

    const mockChangeDetection: ChangeDetectionResult = {
      hasChanges: true,
      changeType: 'major',
      affectedFields: ['name'],
      summary: 'Test changes',
      confidence: 0.8,
    };

    it('should build complete optimization context', () => {
      const result = buildOptimizationPlaceholder(
        mockChangeDetection,
        mockInitiative,
        'level-1',
      );

      expect(result).toContain('# Initiative Optimization Context');
      expect(result).toContain('**Initiative**: Test Initiative');
      expect(result).toContain('## Change Detection');
      expect(result).toContain('## Optimization Strategy 🔧');
      expect(result).toContain('## Context Summary');
      expect(result).toContain('major optimization');
      expect(result).toContain('performed change detection');
      expect(result).toContain('high confidence');
    });

    it('should handle missing change detection', () => {
      const result = buildOptimizationPlaceholder(
        undefined,
        mockInitiative,
        'level-1',
      );

      expect(result).toContain('minor optimization');
      expect(result).toContain('not performed change detection');
      expect(result).toContain('moderate confidence');
    });

    it('should determine confidence level correctly', () => {
      const lowConfidenceChange: ChangeDetectionResult = {
        hasChanges: true,
        changeType: 'minor',
        affectedFields: ['name'],
        summary: 'Test',
        confidence: 0.5,
      };

      const result = buildOptimizationPlaceholder(
        lowConfidenceChange,
        mockInitiative,
      );

      expect(result).toContain('moderate confidence');
    });
  });

  describe('extractChangeDetection', () => {
    it('should extract valid change detection', () => {
      const nodeBuildContext = {
        changeDetection: {
          hasChanges: true,
          changeType: 'major',
          affectedFields: ['name', 'description'],
          summary: 'Test changes',
          confidence: 0.8,
        },
      };

      const result = extractChangeDetection(nodeBuildContext);

      expect(result).toEqual(nodeBuildContext.changeDetection);
    });

    it('should return undefined for missing change detection', () => {
      const result = extractChangeDetection({});
      expect(result).toBeUndefined();
    });

    it('should return undefined for invalid structure', () => {
      const nodeBuildContext = {
        changeDetection: {
          hasChanges: 'true', // Should be boolean
          changeType: 'major',
          affectedFields: 'name,description', // Should be array
          summary: 'Test changes',
          confidence: 0.8,
        },
      };

      const result = extractChangeDetection(nodeBuildContext);
      expect(result).toBeUndefined();
    });

    it('should handle null or undefined input', () => {
      expect(extractChangeDetection(undefined)).toBeUndefined();
      expect(extractChangeDetection(null as any)).toBeUndefined();
    });

    it('should handle non-object change detection', () => {
      const nodeBuildContext = {
        changeDetection: 'invalid',
      };

      const result = extractChangeDetection(nodeBuildContext);
      expect(result).toBeUndefined();
    });

    it('should validate all required fields', () => {
      const invalidCases = [
        { hasChanges: true }, // Missing other required fields
        { hasChanges: true, changeType: 'major' }, // Missing affectedFields, summary, confidence
        {
          hasChanges: true,
          changeType: 'major',
          affectedFields: [] as string[],
          summary: 'test',
        }, // Missing confidence
        {
          hasChanges: true,
          changeType: 123,
          affectedFields: [] as string[],
          summary: 'test',
          confidence: 0.8,
        }, // Invalid changeType
        {
          hasChanges: true,
          changeType: 'major',
          affectedFields: 'invalid',
          summary: 'test',
          confidence: 0.8,
        }, // Invalid affectedFields
      ];

      for (const invalidCase of invalidCases) {
        const result = extractChangeDetection({ changeDetection: invalidCase });
        expect(result).toBeUndefined();
      }
    });
  });
});

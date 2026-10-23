import { Logger } from '@nestjs/common';

const logger = new Logger('OptimizationFormattingUtils');

export interface InitiativeOptimizationData {
  id: string;
  name?: string;
  description?: string;
  priority?: string;
  status?: string;
  tags?: string[];
  reasoning?: string;
}

export interface ChangeDetectionResult {
  hasChanges: boolean;
  changeType: 'minor' | 'major' | 'structural';
  affectedFields: string[];
  summary: string;
  confidence: number;
  details?: Record<string, unknown>;
}

export interface OptimizationStrategy {
  type: 'minor' | 'major' | 'structural';
  reasoning: string;
  confidence: number;
  recommendedActions: string[];
}

/**
 * Formats initiative data for optimization context display
 */
export function formatInitiativeForOptimization(
  initiative: InitiativeOptimizationData | null,
  currentLevel?: string,
  levelNames?: string[],
): string {
  if (!initiative) {
    return '**Initiative**: Not available\n**Status**: Unable to load initiative data';
  }

  const levelInfo =
    currentLevel && levelNames
      ? `**Current Level**: ${currentLevel} (Available: ${levelNames.join(', ')})`
      : currentLevel
        ? `**Current Level**: ${currentLevel}`
        : '';

  return `**Initiative**: ${initiative.name || 'Unnamed Initiative'}
**Description**: ${initiative.description || 'No description available'}
**Priority**: ${initiative.priority || 'Not set'}
**Status**: ${initiative.status || 'Unknown'}
**Tags**: ${initiative.tags?.join(', ') || 'None'}
${levelInfo}
${initiative.reasoning ? `**Reasoning**: ${initiative.reasoning}` : ''}`;
}

/**
 * Formats change detection data for optimization display
 */
export function formatChangeDetectionForOptimization(
  changeDetection: ChangeDetectionResult | undefined,
): string {
  if (!changeDetection) {
    return `## Change Detection

**Status**: No change detection performed
**Recommendation**: Proceed with standard optimization`;
  }

  const confidenceBar =
    '█'.repeat(Math.floor(changeDetection.confidence * 10)) +
    '░'.repeat(10 - Math.floor(changeDetection.confidence * 10));

  return `## Change Detection

**Changes Detected**: ${changeDetection.hasChanges ? '✓ Yes' : '✗ No'}
**Change Magnitude**: ${changeDetection.changeType.toUpperCase()}
**Confidence**: ${confidenceBar} ${(changeDetection.confidence * 100).toFixed(0)}%

**Affected Areas**: ${
    changeDetection.affectedFields.length > 0
      ? '\n' +
        changeDetection.affectedFields.map((field) => `  • ${field}`).join('\n')
      : 'No specific areas identified'
  }

**Summary**: ${changeDetection.summary}`;
}

/**
 * Determines optimization strategy based on change detection and initiative context
 */
export function determineOptimizationStrategy(
  changeDetection?: ChangeDetectionResult,
  initiativeComplexity?: 'low' | 'medium' | 'high',
): OptimizationStrategy {
  // Default to minor optimization if no change detection
  if (!changeDetection) {
    return {
      type: 'minor',
      reasoning:
        'No change detection data available - proceeding with minor optimization',
      confidence: 0.6,
      recommendedActions: [
        'Polish existing content',
        'Improve clarity and readability',
        'Ensure consistency in terminology',
      ],
    };
  }

  // Determine strategy based on change type and confidence
  let strategyType: 'minor' | 'major' | 'structural';
  let recommendedActions: string[];
  let reasoning: string;

  if (
    changeDetection.changeType === 'structural' ||
    changeDetection.confidence < 0.4
  ) {
    strategyType = 'structural';
    reasoning = `Structural changes needed due to ${changeDetection.changeType} change type and ${(changeDetection.confidence * 100).toFixed(0)}% confidence`;
    recommendedActions = [
      'Completely re-evaluate initiative structure',
      'Consider fundamental changes to approach',
      'Question basic assumptions',
      'Rebuild from core principles',
    ];
  } else if (
    changeDetection.changeType === 'major' ||
    changeDetection.affectedFields.length > 3
  ) {
    strategyType = 'major';
    reasoning = `Major optimization needed - ${changeDetection.changeType} changes affecting ${changeDetection.affectedFields.length} areas`;
    recommendedActions = [
      'Significant restructuring of affected sections',
      'Update related components for consistency',
      'Validate changes across all dependencies',
      'Ensure coherence after modifications',
    ];
  } else {
    strategyType = 'minor';
    reasoning = `Minor optimization appropriate - ${changeDetection.changeType} changes with high confidence (${(changeDetection.confidence * 100).toFixed(0)}%)`;
    recommendedActions = [
      'Refine and polish existing content',
      'Make targeted improvements to identified areas',
      'Maintain existing structure and flow',
      'Focus on clarity and precision',
    ];
  }

  return {
    type: strategyType,
    reasoning,
    confidence: changeDetection.confidence,
    recommendedActions,
  };
}

/**
 * Formats optimization strategy for display
 */
export function formatOptimizationStrategy(
  strategy: OptimizationStrategy,
): string {
  const strategyIcon =
    strategy.type === 'structural'
      ? '🔄'
      : strategy.type === 'major'
        ? '🔧'
        : '✨';

  return `## Optimization Strategy ${strategyIcon}

**Approach**: ${strategy.type.charAt(0).toUpperCase() + strategy.type.slice(1)} Optimization
**Confidence**: ${(strategy.confidence * 100).toFixed(0)}%
**Reasoning**: ${strategy.reasoning}

**Recommended Actions**:
${strategy.recommendedActions.map((action) => `  • ${action}`).join('\n')}`;
}

/**
 * Creates a complete optimization context block
 */
export function buildOptimizationPlaceholder(
  changeDetection?: ChangeDetectionResult,
  initiative?: InitiativeOptimizationData,
  currentLevel?: string,
): string {
  const strategy = determineOptimizationStrategy(changeDetection);

  return `# Initiative Optimization Context

${formatInitiativeForOptimization(initiative ?? null, currentLevel)}

${formatChangeDetectionForOptimization(changeDetection)}

${formatOptimizationStrategy(strategy)}

## Context Summary

This initiative is ready for ${strategy.type} optimization based on the analysis above. 
The system has ${changeDetection ? 'performed' : 'not performed'} change detection 
and recommends proceeding with ${strategy.confidence >= 0.7 ? 'high' : 'moderate'} confidence.`;
}

/**
 * Utility to safely extract change detection from node build context
 */
export function extractChangeDetection(
  nodeBuildContext?: Record<string, unknown>,
): ChangeDetectionResult | undefined {
  try {
    const changeDetection = nodeBuildContext?.changeDetection;

    if (!changeDetection || typeof changeDetection !== 'object') {
      return undefined;
    }

    // Validate required fields
    const cd = changeDetection as Record<string, unknown>;
    if (
      typeof cd.hasChanges !== 'boolean' ||
      typeof cd.changeType !== 'string' ||
      !Array.isArray(cd.affectedFields) ||
      typeof cd.summary !== 'string' ||
      typeof cd.confidence !== 'number'
    ) {
      logger.warn('Invalid change detection structure in node build context', {
        changeDetection,
      });
      return undefined;
    }

    return cd as unknown as ChangeDetectionResult;
  } catch (error) {
    logger.error('Error extracting change detection from node build context', {
      error,
      nodeBuildContext,
    });
    return undefined;
  }
}

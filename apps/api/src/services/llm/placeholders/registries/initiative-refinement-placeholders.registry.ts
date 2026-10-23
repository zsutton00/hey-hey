import { Logger } from '@nestjs/common';
import { PlaceholderDefinition } from '../base/placeholder-definition';
import { PlaceholderContext } from '../base/placeholder-types';
import { StandardPlaceholderRegistry } from './standard-placeholders.registry';
import { InitiativeRefinementFlowContext } from '../../../../types/flow-internal.types';
import { errorToLoggable } from '../../../../utils/logging.util';
import { ArtifactResponseDto } from 'src/generated';

interface OptimizationStrategyContext {
  type: 'minor' | 'major' | 'structural';
  confidence: number;
  reasoning: string;
}

interface ChangeDetection {
  hasChanges: boolean;
  changeType: 'minor' | 'major' | 'structural';
  affectedFields: string[];
  summary: string;
  confidence: number;
}

interface OriginalArtifacts {
  count: number;
  types: string[];
  lastUpdated: string;
  summary: string;
}

export class InitiativeRefinementPlaceholderRegistry extends StandardPlaceholderRegistry {
  private static readonly logger = new Logger(
    InitiativeRefinementPlaceholderRegistry.name,
  );

  static readonly OPTIMIZATION_STRATEGY = new PlaceholderDefinition(
    'optimizationStrategy',
    'Current optimization strategy based on initiative context',
    (ctx: PlaceholderContext): string => {
      try {
        return InitiativeRefinementPlaceholderRegistry.determineOptimizationStrategy(
          ctx,
        );
      } catch (error) {
        InitiativeRefinementPlaceholderRegistry.logger.error(
          'Failed to determine optimization strategy',
          {
            flowContext: ctx.flowContext,
            error: errorToLoggable(error),
          },
        );
        throw error;
      }
    },
  );

  static readonly CHANGE_DETECTION_SUMMARY = new PlaceholderDefinition(
    'changeDetectionSummary',
    'Summary of detected changes in initiative',
    (ctx: PlaceholderContext): string => {
      try {
        return InitiativeRefinementPlaceholderRegistry.buildChangeDetectionSummary(
          ctx,
        );
      } catch (error) {
        InitiativeRefinementPlaceholderRegistry.logger.error(
          'Failed to build change detection summary',
          {
            flowContext: ctx.flowContext,
            error: errorToLoggable(error),
          },
        );
        throw error;
      }
    },
    true,
  );

  static readonly ORIGINAL_ARTIFACTS_SUMMARY = new PlaceholderDefinition(
    'originalArtifactsSummary',
    'Summary of original artifacts before optimization',
    async (ctx: PlaceholderContext): Promise<string> => {
      try {
        return await InitiativeRefinementPlaceholderRegistry.buildOriginalArtifactsSummary(
          ctx,
        );
      } catch (error) {
        InitiativeRefinementPlaceholderRegistry.logger.error(
          'Failed to build original artifacts summary',
          {
            flowContext: ctx.flowContext,
            error: errorToLoggable(error),
          },
        );
        throw error;
      }
    },
    true,
  );

  static readonly OPTIMIZATION_CONTEXT = new PlaceholderDefinition(
    'optimizationContext',
    'Full optimization context block with strategy and change analysis',
    async (ctx: PlaceholderContext): Promise<string> => {
      try {
        return await InitiativeRefinementPlaceholderRegistry.buildOptimizationContext(
          ctx,
        );
      } catch (error) {
        InitiativeRefinementPlaceholderRegistry.logger.error(
          'Failed to build optimization context',
          {
            flowContext: ctx.flowContext,
            error: errorToLoggable(error),
          },
        );
        throw error;
      }
    },
    true,
  );

  static readonly CHANGE_DETECTION = new PlaceholderDefinition(
    'changeDetection',
    'Change detection analysis from node build context',
    (ctx: PlaceholderContext): string => {
      try {
        const changeDetection = ctx.nodeBuildContext?.changeDetection as
          | ChangeDetection
          | undefined;
        return InitiativeRefinementPlaceholderRegistry.formatChangeDetectionForOptimization(
          changeDetection,
        );
      } catch (error) {
        InitiativeRefinementPlaceholderRegistry.logger.error(
          'Failed to format change detection',
          {
            changeDetection: ctx.nodeBuildContext?.changeDetection,
            error: errorToLoggable(error),
          },
        );
        throw error;
      }
    },
    true,
  );

  private static determineOptimizationStrategy(
    ctx: PlaceholderContext,
  ): string {
    const flowContext = ctx.flowContext as InitiativeRefinementFlowContext;
    const changeDetection = ctx.nodeBuildContext?.changeDetection as
      | ChangeDetection
      | undefined;

    if (!changeDetection) {
      return 'minor';
    }

    // Determine strategy based on change detection
    if (
      changeDetection.changeType === 'structural' ||
      changeDetection.confidence < 0.5
    ) {
      return 'structural';
    } else if (
      changeDetection.changeType === 'major' ||
      changeDetection.affectedFields.length > 3
    ) {
      return 'major';
    } else {
      return 'minor';
    }
  }

  private static buildChangeDetectionSummary(ctx: PlaceholderContext): string {
    const changeDetection = ctx.nodeBuildContext?.changeDetection as
      | ChangeDetection
      | undefined;

    if (!changeDetection) {
      return `## Change Detection Summary

No change detection data available.
Current optimization will proceed with default strategy.`;
    }

    return `## Change Detection Summary

**Change Status**: ${changeDetection.hasChanges ? 'Changes Detected' : 'No Changes Detected'}
**Change Type**: ${changeDetection.changeType.charAt(0).toUpperCase() + changeDetection.changeType.slice(1)}
**Confidence**: ${(changeDetection.confidence * 100).toFixed(1)}%
**Affected Fields**: ${changeDetection.affectedFields.length > 0 ? changeDetection.affectedFields.join(', ') : 'None'}

**Summary**: ${changeDetection.summary}`;
  }

  private static async buildOriginalArtifactsSummary(
    ctx: PlaceholderContext,
  ): Promise<string> {
    const flowContext = ctx.flowContext as InitiativeRefinementFlowContext;

    try {
      // Fetch original artifacts from the initiative
      const artifacts = await ctx.services.artifactService.findMany(
        {
          projectId: flowContext.core.projectId,
          sourceId: flowContext.initiativeId,
          status: 'ACTIVE',
          limit: 10,
        },
        flowContext.core.organizationId,
      );

      const artifactTypes = [
        ...new Set(
          artifacts.data.map((artifact: ArtifactResponseDto) => artifact.type),
        ),
      ];
      const lastUpdated =
        artifacts.data.length > 0
          ? new Date(
              Math.max(
                ...artifacts.data.map((a: ArtifactResponseDto) =>
                  new Date(a.updatedAt).getTime(),
                ),
              ),
            ).toISOString()
          : 'No artifacts';

      return `## Original Artifacts Summary

**Total Artifacts**: ${artifacts.data.length}
**Artifact Types**: ${artifactTypes.join(', ') || 'None'}
**Last Updated**: ${lastUpdated}

**Content Overview**: 
${
  artifacts.data.length > 0
    ? artifacts.data
        .slice(0, 3)
        .map((a: ArtifactResponseDto) => {
          // Extract content from artifact data structure
          const content =
            a.data && typeof a.data === 'object' && 'content' in a.data
              ? String(a.data.content)
              : 'No content available';
          return `- ${a.title || 'Untitled'}: ${content.substring(0, 100)}...`;
        })
        .join('\n')
    : 'No original artifacts found for this initiative.'
}`;
    } catch (error) {
      InitiativeRefinementPlaceholderRegistry.logger.error(
        'Failed to fetch original artifacts',
        {
          initiativeId: flowContext.initiativeId,
          projectId: flowContext.core.projectId,
          error: errorToLoggable(error),
        },
      );

      return `## Original Artifacts Summary

**Error**: Unable to fetch original artifacts
**Initiative ID**: ${flowContext.initiativeId}
**Reason**: ${error instanceof Error ? error.message : 'Unknown error'}`;
    }
  }

  private static async buildOptimizationContext(
    ctx: PlaceholderContext,
  ): Promise<string> {
    const strategy =
      InitiativeRefinementPlaceholderRegistry.determineOptimizationStrategy(
        ctx,
      );
    const changeDetectionSummary =
      InitiativeRefinementPlaceholderRegistry.buildChangeDetectionSummary(ctx);
    const originalArtifactsSummary =
      await InitiativeRefinementPlaceholderRegistry.buildOriginalArtifactsSummary(
        ctx,
      );

    return `# Optimization Context

## Current Strategy: ${strategy.charAt(0).toUpperCase() + strategy.slice(1)}

${changeDetectionSummary}

${originalArtifactsSummary}

## Optimization Guidelines

Based on the current strategy (${strategy}):

${
  strategy === 'minor'
    ? '- Focus on small refinements and improvements\n- Maintain existing structure and core concepts\n- Polish language and clarity'
    : strategy === 'major'
      ? '- Significant changes are expected\n- May involve restructuring sections\n- Ensure consistency across all changes'
      : '- Fundamental restructuring may be needed\n- Question basic assumptions\n- Consider complete rewrite of affected sections'
}`;
  }

  private static formatChangeDetectionForOptimization(
    changeDetection: ChangeDetection | undefined,
  ): string {
    if (!changeDetection) {
      return `## Change Detection Analysis

**Status**: No change detection data available
**Recommendation**: Proceed with standard optimization approach`;
    }

    const confidenceLevel =
      changeDetection.confidence >= 0.8
        ? 'High'
        : changeDetection.confidence >= 0.5
          ? 'Medium'
          : 'Low';

    return `## Change Detection Analysis

**Has Changes**: ${changeDetection.hasChanges ? 'Yes' : 'No'}
**Change Type**: ${changeDetection.changeType.charAt(0).toUpperCase() + changeDetection.changeType.slice(1)}
**Confidence Level**: ${confidenceLevel} (${(changeDetection.confidence * 100).toFixed(1)}%)

**Affected Areas**: 
${
  changeDetection.affectedFields.length > 0
    ? changeDetection.affectedFields.map((field) => `- ${field}`).join('\n')
    : '- No specific fields identified'
}

**Analysis Summary**: ${changeDetection.summary}

**Optimization Approach**: 
${
  changeDetection.changeType === 'structural'
    ? 'Deep structural analysis recommended - consider fundamental changes to initiative structure'
    : changeDetection.changeType === 'major'
      ? 'Significant updates needed - focus on the affected areas while maintaining coherence'
      : 'Minor refinements - polish existing content while preserving core structure'
}`;
  }
}

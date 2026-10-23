/**
 * Initiative Optimization Adapter Service
 *
 * Bridges the existing InitiativeOptimizationService to our new BaseOptimizationService
 * interface, providing a unified API while preserving existing sophisticated logic.
 */

import { Injectable } from '@nestjs/common';
import { TaskPriority, WorkStatus } from '../../generated';
import { InitiativeId, OrganizationId } from '../../types';
import {
  InitiativeRefinableEntity,
  toInitiativeRefinableEntity,
} from '../../types/initiative-refinement-adapter.types';
import {
  OptimizationContext as BaseOptimizationContext,
  ChangeDetectionResult,
  EntityType,
} from '../../types/refinable-entity.types';
import {
  BaseOptimizationService,
  WorkItemArtifactService,
} from '../base/base-optimization.service';
import {
  InitiativeArtifactService,
  InitiativeOriginalData,
} from './initiative-artifact.service';
import {
  InitiativeChangeDetection,
  InitiativeOptimizationService,
  OptimizationContext as LegacyOptimizationContext,
} from './initiative-optimization.service';
import { InitiativeService } from './initiative.service';

/**
 * Adapter service to bridge between generic WorkItemArtifactService interface
 * and the specific InitiativeArtifactService implementation
 */
@Injectable()
class InitiativeArtifactServiceAdapter
  implements WorkItemArtifactService<InitiativeRefinableEntity>
{
  constructor(
    private readonly initiativeArtifactService: InitiativeArtifactService,
    private readonly initiativeService: InitiativeService,
  ) {}

  async getOriginalArtifact(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeRefinableEntity | null> {
    const artifact =
      await this.initiativeArtifactService.getOriginalArtifactForInitiative(
        entityId as InitiativeId,
        organizationId,
      );

    if (!artifact) {
      return null;
    }

    // Parse the stored original data from the artifact
    try {
      if (artifact.data.type !== 'INSIGHT') {
        throw new Error(`Expected INSIGHT artifact, got ${artifact.data.type}`);
      }

      // Type guard for InsightData
      const insightData = artifact.data as { type: 'INSIGHT'; content: string };
      const originalData = JSON.parse(
        insightData.content,
      ) as InitiativeOriginalData;

      const originatingProjectId = artifact.projectId;
      if (!originatingProjectId) {
        throw new Error(
          `Original artifact for initiative ${entityId} is missing projectId`,
        );
      }

      return {
        id: entityId as InitiativeId,
        name: originalData.name,
        description: originalData.description,
        details: originalData.details ?? '',
        acceptanceCriteria: originalData.acceptanceCriteria ?? '',
        status: WorkStatus.RefiningDescription,
        priority: this.mapPriorityToDatabase(originalData.priority)?.toString(),
        assigneeId: undefined,
        organizationId,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
        tags: Array.isArray(originalData.tags) ? originalData.tags : [],
        reasoning: originalData.reasoning,
      };
    } catch (error) {
      throw new Error(
        `Failed to parse original artifact data for initiative ${entityId}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  async saveArtifactSnapshot(
    entity: InitiativeRefinableEntity,
    organizationId: OrganizationId,
  ): Promise<void> {
    const initiative = await this.initiativeService.findOneForAdapter(
      entity.id,
      organizationId,
    );
    if (!initiative) {
      throw new Error(
        `Initiative ${entity.id} not found in organization ${organizationId}`,
      );
    }
    const projectId = initiative.originatingProjectId;
    if (!projectId) {
      throw new Error(
        `Initiative ${entity.id} is missing originatingProjectId`,
      );
    }

    // Convert InitiativeRefinableEntity to InitiativeOriginalData format for storage
    const originalData: InitiativeOriginalData = {
      name: entity.name,
      description: entity.description,
      details: entity.details || '',
      acceptanceCriteria: entity.acceptanceCriteria || '',
      priority: this.mapPriorityFromDatabase(entity.priority),
      tags: Array.isArray(entity.tags) ? entity.tags : [],
      reasoning: entity.reasoning,
      influences: [], // Empty array for snapshot storage
    };

    // Store using the artifact service
    await this.initiativeArtifactService.storeOriginalGeneration(
      [originalData],
      [{ id: entity.id as InitiativeId }],
      organizationId,
      projectId,
      {
        sourceId: entity.id,
        generationModel: 'snapshot-save',
        generationPrompt: 'entity-snapshot',
        originalRequestContext: {
          source: 'optimization-service-snapshot',
          timestamp: new Date().toISOString(),
        },
      },
    );
  }

  private mapPriorityToDatabase(priority: string): TaskPriority {
    const mapping: Record<string, TaskPriority> = {
      low: 'LOW',
      medium: 'MEDIUM',
      high: 'HIGH',
      critical: 'CRITICAL',
    };
    return mapping[priority.toLowerCase()] || 'MEDIUM';
  }

  private mapPriorityFromDatabase(priority?: string | null): string {
    if (!priority) return 'medium';
    const mapping: Record<string, string> = {
      LOW: 'low',
      MEDIUM: 'medium',
      HIGH: 'high',
      CRITICAL: 'critical',
    };
    return mapping[priority.toUpperCase()] || 'medium';
  }
}

/**
 * Initiative optimization service adapter that extends BaseOptimizationService
 * while delegating to the existing comprehensive InitiativeOptimizationService
 */
@Injectable()
export class InitiativeOptimizationAdapterService extends BaseOptimizationService<InitiativeRefinableEntity> {
  private readonly artifactServiceAdapter: InitiativeArtifactServiceAdapter;

  constructor(
    private readonly initiativeService: InitiativeService,
    private readonly initiativeArtifactService: InitiativeArtifactService,
    private readonly legacyOptimizationService: InitiativeOptimizationService,
  ) {
    super('InitiativeOptimizationAdapterService');
    this.artifactServiceAdapter = new InitiativeArtifactServiceAdapter(
      this.initiativeArtifactService,
      this.initiativeService,
    );
  }

  // Abstract method implementations from BaseOptimizationService

  protected getEntityType(): EntityType {
    return 'initiative';
  }

  protected async findOne(
    id: string,
    organizationId: OrganizationId,
  ): Promise<InitiativeRefinableEntity | null> {
    const initiative = await this.initiativeService.findOneForAdapter(
      id,
      organizationId,
    );
    if (!initiative) {
      return null;
    }
    return toInitiativeRefinableEntity(initiative);
  }

  protected getArtifactService(): WorkItemArtifactService<InitiativeRefinableEntity> {
    return this.artifactServiceAdapter;
  }

  // Override the base detectChanges to use the sophisticated existing implementation
  async detectChanges(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<ChangeDetectionResult> {
    this.logger.debug(
      `Detecting changes for initiative ${entityId} using legacy optimization service`,
      {
        entityId,
        organizationId,
      },
    );

    try {
      // Use the existing sophisticated change detection
      const legacyResult = await this.legacyOptimizationService.detectChanges(
        entityId as InitiativeId,
        organizationId,
      );

      // Convert to our unified interface
      return this.convertToUnifiedChangeResult(legacyResult);
    } catch (error) {
      this.logger.error(`Error detecting changes for initiative ${entityId}`, {
        error: error instanceof Error ? error.message : error,
        entityId,
        organizationId,
      });

      // Fallback to base implementation
      return super.detectChanges(entityId, organizationId);
    }
  }

  // Override the base generateOptimizationContext to use existing logic
  async generateOptimizationContext(
    changeDetection: ChangeDetectionResult,
  ): Promise<BaseOptimizationContext> {
    try {
      // Convert unified change result back to legacy format for the existing service
      const legacyChangeDetection =
        this.convertToLegacyChangeResult(changeDetection);

      // Use the existing sophisticated optimization context generation
      const legacyContext =
        await this.legacyOptimizationService.generateOptimizationContext(
          legacyChangeDetection,
        );

      // Convert to our unified interface
      return this.convertToUnifiedOptimizationContext(legacyContext);
    } catch (error) {
      this.logger.error(
        'Error generating optimization context, falling back to base implementation',
        {
          error: error instanceof Error ? error.message : error,
        },
      );

      // Fallback to base implementation
      return super.generateOptimizationContext(changeDetection);
    }
  }

  // Private conversion methods

  private convertToUnifiedChangeResult(
    legacyResult: InitiativeChangeDetection,
  ): ChangeDetectionResult {
    return {
      hasChanges: legacyResult.hasChanges,
      changesSummary: legacyResult.changesSummary,
      confidenceScore: legacyResult.confidenceScore,
      affectedFields: legacyResult.changedFields,
      changeType: this.mapChangeType(legacyResult),
    };
  }

  private convertToLegacyChangeResult(
    unifiedResult: ChangeDetectionResult,
  ): InitiativeChangeDetection {
    // Create a minimal legacy format that would work with existing logic
    // This is a simplified conversion since we mainly use this for the reverse direction
    return {
      hasChanges: unifiedResult.hasChanges,
      changesSummary: unifiedResult.changesSummary || 'Changes detected',
      changedFields: unifiedResult.affectedFields || [],
      confidenceScore: unifiedResult.confidenceScore,
      originalData: null, // Would need more complex logic to reconstruct this
      currentData: {
        name: '',
        description: '',
        priority: '',
        tags: [],
        status: 'UNKNOWN',
      },
      semanticSimilarity: {
        name: 0.5,
        description: 0.5,
        overall: 0.5,
      },
      fieldLevelChanges: {},
    };
  }

  private convertToUnifiedOptimizationContext(
    legacyContext: LegacyOptimizationContext,
  ): BaseOptimizationContext {
    let processingRecommendation: 'generate' | 'skip' | 'review' = 'generate';

    if (legacyContext.shouldSkipLlm) {
      processingRecommendation = 'skip';
    } else if (legacyContext.confidenceScore < 0.7) {
      processingRecommendation = 'review';
    }

    return {
      shouldSkipLlm: legacyContext.shouldSkipLlm,
      optimizationHints: legacyContext.optimizationHints || [],
      processingRecommendation,
      estimatedProcessingTime: legacyContext.shouldSkipLlm ? 2 : 20,
    };
  }

  private mapChangeType(
    legacyResult: InitiativeChangeDetection,
  ): 'minor' | 'major' | 'structural' {
    // Analyze field-level changes to determine overall change type
    const hasStructuralChanges =
      legacyResult.changedFields.includes('name') ||
      legacyResult.changedFields.includes('all');

    const hasMajorChanges =
      legacyResult.changedFields.includes('description') ||
      legacyResult.changedFields.includes('priority');

    if (hasStructuralChanges || legacyResult.confidenceScore < 0.3) {
      return 'structural';
    } else if (hasMajorChanges || legacyResult.confidenceScore < 0.6) {
      return 'major';
    } else {
      return 'minor';
    }
  }
}

/**
 * Base Optimization Service
 *
 * Abstract base class that provides shared optimization logic for all work item types.
 * Handles change detection, optimization context generation, and decision-making
 * about when to skip or proceed with LLM processing.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  RefinableEntity,
  EntityType,
  ChangeDetectionResult,
  OptimizationContext,
  RefinementLevel,
} from '../../types/refinable-entity.types';
import { WorkItemTypeConfigService } from '../../config/work-item-type.config';
import { OrganizationId } from '../../types';

/**
 * Interface for artifact/snapshot services used in change detection
 * Each work item type may have different artifact storage mechanisms
 */
export interface WorkItemArtifactService<TEntity extends RefinableEntity> {
  getOriginalArtifact(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<TEntity | null>;
  saveArtifactSnapshot(
    entity: TEntity,
    organizationId: OrganizationId,
  ): Promise<void>;
}

/**
 * Abstract base class for work item optimization services
 *
 * Provides generic change detection and optimization logic that can be
 * customized by concrete implementations for specific work item types.
 */
@Injectable()
export abstract class BaseOptimizationService<TEntity extends RefinableEntity> {
  protected readonly logger: Logger;
  protected readonly advancedDebugPrefix = 'advanced_debug';

  constructor(protected readonly serviceName: string) {
    this.logger = new Logger(serviceName);
  }

  // Abstract methods that must be implemented by concrete services
  protected abstract getEntityType(): EntityType;
  protected abstract findOne(
    id: string,
    organizationId: OrganizationId,
  ): Promise<TEntity | null>;
  protected abstract getArtifactService(): WorkItemArtifactService<TEntity>;

  /**
   * Detect changes in a work item entity
   * Compares current state with original artifact to determine if LLM processing is needed
   */
  async detectChanges(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<ChangeDetectionResult> {
    this.logger.debug(
      `${this.advancedDebugPrefix} optimization.detect_changes.start`,
      {
        entityType: this.getEntityType(),
        entityId,
        organizationId,
      },
    );

    try {
      // Get current entity state
      const currentEntity = await this.findOne(entityId, organizationId);
      if (!currentEntity) {
        throw new Error(`${this.getEntityType()} ${entityId} not found`);
      }
      this.logger.debug(
        `${this.advancedDebugPrefix} optimization.detect_changes.current_entity_loaded`,
        {
          entityType: this.getEntityType(),
          entityId,
          organizationId,
          currentUpdatedAt: currentEntity.updatedAt,
        },
      );

      // Get original artifact for comparison
      const originalArtifact =
        await this.getArtifactService().getOriginalArtifact(
          entityId,
          organizationId,
        );
      if (!originalArtifact) {
        this.logger.warn(
          `${this.advancedDebugPrefix} optimization.detect_changes.original_missing_treat_as_changed`,
          {
            entityType: this.getEntityType(),
            entityId,
            organizationId,
          },
        );

        return {
          hasChanges: true,
          changesSummary: 'No original artifact found - first time processing',
          confidenceScore: 1.0,
          affectedFields: ['description', 'details', 'acceptanceCriteria'],
          changeType: 'structural',
        };
      }

      this.logger.debug(
        `${this.advancedDebugPrefix} optimization.detect_changes.original_loaded`,
        {
          entityType: this.getEntityType(),
          entityId,
          organizationId,
          originalUpdatedAt: originalArtifact.updatedAt,
        },
      );

      // Perform detailed change analysis
      const changeAnalysis = this.analyzeChanges(
        originalArtifact,
        currentEntity,
      );

      this.logger.debug(
        `${this.advancedDebugPrefix} optimization.detect_changes.completed`,
        {
          entityType: this.getEntityType(),
          entityId,
          hasChanges: changeAnalysis.hasChanges,
          changeType: changeAnalysis.changeType,
          confidenceScore: changeAnalysis.confidenceScore,
          affectedFields: changeAnalysis.affectedFields,
        },
      );

      return changeAnalysis;
    } catch (error) {
      this.logger.error(
        `${this.advancedDebugPrefix} optimization.detect_changes.error`,
        {
          entityType: this.getEntityType(),
          error: error instanceof Error ? error.message : error,
          entityId,
          organizationId,
        },
      );

      // On error, default to processing with changes to be safe
      return {
        hasChanges: true,
        changesSummary: `Error during change detection: ${error instanceof Error ? error.message : 'Unknown error'}`,
        confidenceScore: 0.5,
        affectedFields: [],
        changeType: 'major',
      };
    }
  }

  /**
   * Generate optimization context based on change detection results
   * Determines processing strategy and provides recommendations
   */
  async generateOptimizationContext(
    changeDetection: ChangeDetectionResult,
  ): Promise<OptimizationContext> {
    this.logger.debug(
      `${this.advancedDebugPrefix} optimization.context.start`,
      {
        entityType: this.getEntityType(),
        hasChanges: changeDetection.hasChanges,
        changeType: changeDetection.changeType,
        confidenceScore: changeDetection.confidenceScore,
      },
    );

    let context: OptimizationContext;

    // If no changes detected with high confidence, recommend skipping LLM
    if (!changeDetection.hasChanges && changeDetection.confidenceScore >= 0.8) {
      context = {
        shouldSkipLlm: true,
        optimizationHints: [
          'No significant changes detected',
          'Original content appears sufficient',
          'Consider direct status advancement',
        ],
        processingRecommendation: 'skip',
        estimatedProcessingTime: 2,
      };
    } else if (
      // If minor changes with medium confidence, provide nuanced recommendation
      changeDetection.changeType === 'minor' &&
      changeDetection.confidenceScore >= 0.6
    ) {
      context = {
        shouldSkipLlm: false,
        optimizationHints: [
          'Minor changes detected',
          'Light processing recommended',
          'Focus on changed fields: ' +
            (changeDetection.affectedFields?.join(', ') || 'unknown'),
        ],
        processingRecommendation: 'review',
        estimatedProcessingTime: 10,
      };
    } else {
      // For major changes or low confidence, recommend full processing
      context = {
        shouldSkipLlm: false,
        optimizationHints: [
          changeDetection.changeType === 'major'
            ? 'Major changes detected'
            : 'Structural changes detected',
          'Full LLM processing recommended',
          'Generate comprehensive content updates',
          changeDetection.changesSummary ||
            'Significant modifications require analysis',
        ],
        processingRecommendation: 'generate',
        estimatedProcessingTime:
          changeDetection.changeType === 'structural' ? 30 : 20,
      };
    }
    this.logger.debug(
      `${this.advancedDebugPrefix} optimization.context.completed`,
      {
        entityType: this.getEntityType(),
        shouldSkipLlm: context.shouldSkipLlm,
        processingRecommendation: context.processingRecommendation,
        estimatedProcessingTime: context.estimatedProcessingTime,
        hintsCount: context.optimizationHints.length,
      },
    );
    return context;
  }

  /**
   * Analyze changes between original and current entity
   * This is the core change detection logic
   */
  protected analyzeChanges(
    original: TEntity,
    current: TEntity,
  ): ChangeDetectionResult {
    const changes: string[] = [];
    const affectedFields: string[] = [];
    let changeIntensity = 0;

    // Check each refinement field for changes
    const fieldsToCheck = [
      'description',
      'details',
      'acceptanceCriteria',
    ] as const;

    for (const field of fieldsToCheck) {
      const originalValue = this.normalizeFieldValue(original[field]);
      const currentValue = this.normalizeFieldValue(current[field]);
      this.logger.debug(
        `${this.advancedDebugPrefix} optimization.analyze.field_compare`,
        {
          entityType: this.getEntityType(),
          entityId: current.id,
          field,
          originalLength: originalValue.length,
          currentLength: currentValue.length,
          changed: originalValue !== currentValue,
        },
      );

      if (originalValue !== currentValue) {
        const changeDescription = this.describeFieldChange(
          field,
          originalValue,
          currentValue,
        );
        changes.push(changeDescription);
        affectedFields.push(field);

        // Calculate change intensity based on field importance and change magnitude
        const fieldWeight = this.getFieldWeight(field);
        const changeMagnitude = this.calculateChangeMagnitude(
          originalValue,
          currentValue,
        );
        changeIntensity += fieldWeight * changeMagnitude;
        this.logger.debug(
          `${this.advancedDebugPrefix} optimization.analyze.field_changed`,
          {
            entityType: this.getEntityType(),
            entityId: current.id,
            field,
            fieldWeight,
            changeMagnitude,
            accumulatedChangeIntensity: changeIntensity,
            changeDescription,
          },
        );
      }
    }

    // Determine change type and confidence
    const hasChanges = changes.length > 0;
    let changeType: 'minor' | 'major' | 'structural';
    let confidenceScore: number;

    if (changeIntensity <= 0.3) {
      changeType = 'minor';
      confidenceScore = 0.9;
    } else if (changeIntensity <= 0.7) {
      changeType = 'major';
      confidenceScore = 0.8;
    } else {
      changeType = 'structural';
      confidenceScore = 0.95;
    }

    // If no changes, high confidence
    if (!hasChanges) {
      confidenceScore = 0.95;
    }

    const analysis = {
      hasChanges,
      changesSummary:
        changes.length > 0 ? changes.join('; ') : 'No changes detected',
      confidenceScore,
      affectedFields,
      changeType,
    };
    this.logger.debug(
      `${this.advancedDebugPrefix} optimization.analyze.summary`,
      {
        entityType: this.getEntityType(),
        entityId: current.id,
        hasChanges: analysis.hasChanges,
        changeType: analysis.changeType,
        confidenceScore: analysis.confidenceScore,
        affectedFields: analysis.affectedFields,
        changesSummary: analysis.changesSummary,
      },
    );
    return analysis;
  }

  /**
   * Normalize field values for comparison
   * Handles null, undefined, and whitespace normalization
   */
  protected normalizeFieldValue(value: unknown): string {
    if (value === null || value === undefined) {
      return '';
    }
    // eslint-disable-next-line @typescript-eslint/no-base-to-string
    return String(value).trim();
  }

  /**
   * Describe the change in a specific field
   */
  protected describeFieldChange(
    field: string,
    originalValue: string,
    currentValue: string,
  ): string {
    if (originalValue === '' && currentValue !== '') {
      return `${field} was added`;
    }
    if (originalValue !== '' && currentValue === '') {
      return `${field} was removed`;
    }

    const lengthChange = currentValue.length - originalValue.length;
    if (Math.abs(lengthChange) > originalValue.length * 0.5) {
      return `${field} was significantly modified (${lengthChange > 0 ? 'expanded' : 'shortened'})`;
    }

    return `${field} was updated`;
  }

  /**
   * Get weight for field importance in change calculation
   */
  protected getFieldWeight(field: string): number {
    const weights: Record<string, number> = {
      name: 0.4,
      description: 0.6,
      details: 0.8,
      acceptanceCriteria: 0.9,
      priority: 0.3,
      assigneeId: 0.2,
    };
    return weights[field] || 0.5;
  }

  /**
   * Calculate magnitude of change between two text values
   * Returns 0-1 where 1 represents complete replacement
   */
  protected calculateChangeMagnitude(
    original: string,
    current: string,
  ): number {
    if (original === current) {
      return 0;
    }
    if (original === '' || current === '') {
      return 1;
    }

    // Simple Levenshtein-based similarity calculation
    const maxLength = Math.max(original.length, current.length);
    const similarity = this.calculateSimilarity(original, current);
    return 1 - similarity;
  }

  /**
   * Calculate text similarity (simplified implementation)
   * Returns 0-1 where 1 represents identical text
   */
  protected calculateSimilarity(text1: string, text2: string): number {
    if (text1 === text2) return 1;
    if (text1.length === 0 || text2.length === 0) return 0;

    // Simple word-based similarity
    const words1 = new Set(text1.toLowerCase().split(/\s+/));
    const words2 = new Set(text2.toLowerCase().split(/\s+/));

    const intersection = new Set(
      Array.from(words1).filter((word) => words2.has(word)),
    );
    const union = new Set(Array.from(words1).concat(Array.from(words2)));

    return intersection.size / union.size;
  }

  /**
   * Save current entity state as artifact for future comparison
   */
  async saveEntitySnapshot(
    entity: TEntity,
    organizationId: OrganizationId,
  ): Promise<void> {
    try {
      await this.getArtifactService().saveArtifactSnapshot(
        entity,
        organizationId,
      );
      this.logger.debug(
        `Saved artifact snapshot for ${this.getEntityType()} ${entity.id}`,
        {
          entityId: entity.id,
          organizationId,
        },
      );
    } catch (error) {
      this.logger.error(
        `Error saving artifact snapshot for ${this.getEntityType()} ${entity.id}`,
        {
          error: error instanceof Error ? error.message : error,
          entityId: entity.id,
          organizationId,
        },
      );
      // Don't throw - snapshot failure shouldn't break the main flow
    }
  }

  /**
   * Determine if entity field is empty and needs initial generation
   */
  isFieldEmpty(entity: TEntity, level: RefinementLevel): boolean {
    let fieldValue: string | null | undefined;

    switch (level) {
      case 'description':
        fieldValue = entity.description;
        break;
      case 'details':
        fieldValue = entity.details;
        break;
      case 'acceptanceCriteria':
        fieldValue = entity.acceptanceCriteria;
        break;
      default:
        return false;
    }

    return !fieldValue || fieldValue.trim() === '';
  }

  /**
   * Get optimization configuration for this entity type
   */
  protected getTypeConfig() {
    return WorkItemTypeConfigService.getConfig(this.getEntityType());
  }
}

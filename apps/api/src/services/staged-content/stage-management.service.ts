/**
 * Stage Management Service
 *
 * Handles stage transitions, progress calculations, and validation rules
 * for the staged content framework. Provides utilities for managing
 * content progression through defined stages.
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  ContentTypeDefinition,
  StagedContentEntity,
  StageDefinition,
  StageTransition,
  ValidationError,
} from '../../types/staged-content.types';

@Injectable()
export class StageManagementService {
  private readonly logger = new Logger(StageManagementService.name);

  /**
   * Get the current stage definition for an entity
   * @param entity - The staged content entity
   * @param contentType - The content type definition
   * @returns Current stage definition
   * @throws Error if stage not found
   */
  getCurrentStage(
    entity: StagedContentEntity,
    contentType: ContentTypeDefinition,
  ): StageDefinition {
    const currentStageId = entity.currentStage;
    const stage = contentType.stages.find((s) => s.id === currentStageId);

    if (!stage) {
      throw new Error(
        `Stage '${currentStageId}' not found in content type '${contentType.id}'. ` +
          `Available stages: ${contentType.stages.map((s) => s.id).join(', ')}`,
      );
    }

    return stage;
  }

  /**
   * Get the initial stage for a content type
   * @param contentType - The content type definition
   * @returns Initial stage definition (lowest order)
   */
  getInitialStage(contentType: ContentTypeDefinition): StageDefinition {
    const sortedStages = [...contentType.stages].sort(
      (a, b) => a.order - b.order,
    );

    if (sortedStages.length === 0) {
      throw new Error(`Content type '${contentType.id}' has no stages defined`);
    }

    const firstStage = sortedStages[0];
    if (!firstStage) {
      throw new Error(`Content type '${contentType.id}' has no stages defined`);
    }

    return firstStage;
  }

  /**
   * Get the next possible stages for the current stage
   * @param currentStage - The current stage definition
   * @param contentType - The content type definition
   * @returns Array of next stage definitions
   */
  getNextStages(
    currentStage: StageDefinition,
    contentType: ContentTypeDefinition,
  ): StageDefinition[] {
    return currentStage.nextStages
      .map((stageId) => contentType.stages.find((s) => s.id === stageId))
      .filter((stage): stage is StageDefinition => stage !== undefined);
  }

  /**
   * Check if a stage is terminal (no next stages)
   * @param stage - The stage definition to check
   * @returns True if the stage is terminal
   */
  isTerminalStage(stage: StageDefinition): boolean {
    return stage.isTerminal || stage.nextStages.length === 0;
  }

  /**
   * Calculate progress for an entity based on content type configuration
   * @param entity - The staged content entity
   * @param contentType - The content type definition
   * @returns Progress percentage (0-100)
   */
  calculateProgress(
    entity: StagedContentEntity,
    contentType: ContentTypeDefinition,
  ): number {
    const progressType = contentType.entitySchema.progressCalculation;

    switch (progressType) {
      case 'linear':
        return this.calculateLinearProgress(entity, contentType);
      case 'weighted':
        return this.calculateWeightedProgress(entity, contentType);
      case 'custom':
        return this.calculateCustomProgress(entity, contentType);
      default:
        this.logger.warn(
          `Unknown progress calculation type: ${progressType}, defaulting to linear`,
        );
        return this.calculateLinearProgress(entity, contentType);
    }
  }

  /**
   * Validate a stage transition
   * @param entity - The entity being transitioned
   * @param fromStage - The current stage definition
   * @param toStage - The target stage definition
   * @returns Array of validation errors (empty if valid)
   */
  async validateStageTransition(
    entity: StagedContentEntity,
    fromStage: StageDefinition,
    toStage: StageDefinition,
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    this.logger.log(
      `Validating transition from ${fromStage.id} to ${toStage.id} for entity ${entity.id}`,
    );

    // Check if target stage is in allowed next stages
    if (!fromStage.nextStages.includes(toStage.id)) {
      errors.push({
        field: 'stage',
        rule: 'custom_function',
        message: `Cannot transition from ${fromStage.displayName} to ${toStage.displayName}`,
        code: 'INVALID_STAGE_TRANSITION',
        severity: 'error',
        suggestedFix: `Valid next stages: ${fromStage.nextStages.join(', ')}`,
      });
    }

    // Validate current stage completion requirements
    const stageValidationErrors = await this.validateStageCompletion(
      entity,
      fromStage,
    );
    errors.push(...stageValidationErrors);

    // Validate stage ordering (prevent backwards movement unless explicitly allowed)
    if (
      toStage.order <= fromStage.order &&
      !this.isBackwardTransitionAllowed(fromStage, toStage)
    ) {
      errors.push({
        field: 'stage',
        rule: 'custom_function',
        message: `Backward transition from ${fromStage.displayName} to ${toStage.displayName} not allowed`,
        code: 'BACKWARD_TRANSITION_NOT_ALLOWED',
        severity: 'error',
        suggestedFix:
          'Complete current stage before advancing, or use stage rollback if supported',
      });
    }

    this.logger.log(
      `Stage transition validation completed: ${errors.length} errors found`,
    );
    return errors;
  }

  /**
   * Validate that a stage is complete and ready for transition
   * @param entity - The entity to validate
   * @param stage - The stage definition to validate
   * @returns Array of validation errors
   */
  async validateStageCompletion(
    entity: StagedContentEntity,
    stage: StageDefinition,
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    // Validate each rule defined for the stage
    for (const rule of stage.validationRules) {
      const ruleErrors = await this.validateRule(entity, rule);
      errors.push(...ruleErrors);
    }

    return errors;
  }

  /**
   * Create a stage transition record
   * @param entity - The entity being transitioned
   * @param fromStage - The previous stage ID
   * @param toStage - The new stage ID
   * @param triggeredBy - Who/what triggered the transition
   * @param reason - Optional reason for the transition
   * @returns Stage transition record
   */
  createStageTransition(
    entity: StagedContentEntity,
    fromStage: string,
    toStage: string,
    triggeredBy: string,
    reason?: string,
  ): StageTransition {
    return {
      fromStage,
      toStage,
      timestamp: new Date(),
      triggeredBy,
      transitionType: 'advance',
      reason,
      metadata: {
        automatedTransition: false,
        validationResults: [],
        userAction: 'manual_transition',
      },
    };
  }

  /**
   * Get stage completion percentage based on filled required fields
   * @param entity - The entity to analyze
   * @param stage - The stage definition
   * @returns Completion percentage for the stage (0-100)
   */
  getStageCompletionPercentage(
    entity: StagedContentEntity,
    stage: StageDefinition,
  ): number {
    const requiredFields = stage.contentFields;
    let completedFields = 0;

    for (const field of requiredFields) {
      const value = (entity as any)[field];
      if (value && typeof value === 'string' && value.trim().length > 0) {
        completedFields++;
      }
    }

    return Math.round((completedFields / requiredFields.length) * 100);
  }

  /**
   * Calculate linear progress (equal weight for each stage)
   */
  private calculateLinearProgress(
    entity: StagedContentEntity,
    contentType: ContentTypeDefinition,
  ): number {
    const currentStage = this.getCurrentStage(entity, contentType);
    const totalStages = contentType.stages.length;

    return Math.round((currentStage.order / totalStages) * 100);
  }

  /**
   * Calculate weighted progress (custom weights per stage)
   */
  private calculateWeightedProgress(
    entity: StagedContentEntity,
    contentType: ContentTypeDefinition,
  ): number {
    const currentStage = this.getCurrentStage(entity, contentType);
    const weightings = contentType.entitySchema.weightings || {};

    // Calculate total weight
    const totalWeight = Object.values(weightings).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    if (totalWeight === 0) {
      // Fallback to linear if no weightings defined
      return this.calculateLinearProgress(entity, contentType);
    }

    // Calculate completed weight
    let completedWeight = 0;
    for (const stage of contentType.stages) {
      if (stage.order <= currentStage.order) {
        completedWeight += weightings[stage.id] || 0;
      }
    }

    return Math.round((completedWeight / totalWeight) * 100);
  }

  /**
   * Calculate custom progress using configured calculator
   */
  private calculateCustomProgress(
    entity: StagedContentEntity,
    contentType: ContentTypeDefinition,
  ): number {
    const calculatorName = contentType.entitySchema.customProgressCalculator;

    if (!calculatorName) {
      this.logger.warn(
        `Custom progress calculator not defined for ${contentType.id}, using linear`,
      );
      return this.calculateLinearProgress(entity, contentType);
    }

    // TODO: Implement custom calculator registry and lookup
    this.logger.warn(
      `Custom progress calculator '${calculatorName}' not implemented, using linear`,
    );
    return this.calculateLinearProgress(entity, contentType);
  }

  /**
   * Validate a single validation rule
   */
  private async validateRule(
    entity: StagedContentEntity,
    rule: import('../../types/staged-content.types').StageValidationRule,
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    switch (rule.type) {
      case 'field_required':
        if (rule.field) {
          const value = (entity as any)[rule.field];
          if (
            !value ||
            (typeof value === 'string' && value.trim().length === 0)
          ) {
            errors.push({
              field: rule.field,
              rule: 'field_required',
              message: rule.errorMessage || `${rule.field} is required`,
              code: 'FIELD_REQUIRED',
              severity: 'error',
              suggestedFix: `Please provide a value for ${rule.field}`,
            });
          }
        }
        break;

      case 'min_length':
        if (rule.field && rule.minLength) {
          const value = (entity as any)[rule.field];
          if (
            typeof value === 'string' &&
            value.trim().length < rule.minLength
          ) {
            errors.push({
              field: rule.field,
              rule: 'min_length',
              message:
                rule.errorMessage ||
                `${rule.field} must be at least ${rule.minLength} characters`,
              code: 'MIN_LENGTH_VIOLATION',
              severity: 'error',
              suggestedFix: `Add more content to meet the minimum length of ${rule.minLength} characters`,
            });
          }
        }
        break;

      case 'max_length':
        if (rule.field && rule.maxLength) {
          const value = (entity as any)[rule.field];
          if (typeof value === 'string' && value.length > rule.maxLength) {
            errors.push({
              field: rule.field,
              rule: 'max_length',
              message:
                rule.errorMessage ||
                `${rule.field} must be no more than ${rule.maxLength} characters`,
              code: 'MAX_LENGTH_VIOLATION',
              severity: 'error',
              suggestedFix: `Reduce content to meet the maximum length of ${rule.maxLength} characters`,
            });
          }
        }
        break;

      case 'custom_function':
        // TODO: Implement custom validation function registry
        this.logger.warn(
          `Custom validation function '${rule.customValidator}' not implemented`,
        );
        break;

      default:
        this.logger.warn(`Unknown validation rule type: ${rule.type}`);
    }

    return errors;
  }

  /**
   * Check if backward transition is allowed between stages
   */
  private isBackwardTransitionAllowed(
    fromStage: StageDefinition,
    toStage: StageDefinition,
  ): boolean {
    // Currently, backward transitions are not allowed
    // This could be enhanced to support rollback scenarios
    return false;
  }
}

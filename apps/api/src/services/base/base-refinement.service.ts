/**
 * Base Refinement Service
 *
 * Abstract base class that provides shared refinement logic for all work item types.
 * Concrete implementations handle type-specific operations while this class provides
 * common functionality like change application, context management, and error handling.
 */

import { Injectable, Logger } from '@nestjs/common';
import { WorkItemTypeConfigService } from '../../config/work-item-type.config';
import { OrganizationId, UserId } from '../../types';
import { ConversationResponseDto } from '../../generated';
import {
  ContentUpdates,
  EntityType,
  RefinableEntity,
  RefinementContext,
  RefinementLevel,
  RefinementOperationResult,
  RefinementSession,
  isValidRefinementLevel,
} from '../../types/refinable-entity.types';

/**
 * Interface that all work item refinement services must implement
 * Provides type-safe contract for entity-specific operations
 */
export interface WorkItemRefinementService<TEntity extends RefinableEntity> {
  findOneForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<TEntity | null>;
  updateForAdapter(
    id: string,
    updates: Partial<TEntity>,
    organizationId: OrganizationId,
  ): Promise<TEntity>;
  createRefinementConversation(
    entityId: string,
    entityType: string,
    organizationId: OrganizationId,
    projectId?: string,
    planId?: string,
    userId?: UserId,
  ): Promise<{ conversation: ConversationResponseDto; entities: TEntity[] }>;
  getActiveRefinementConversation(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<string | null>;
}

/**
 * Abstract base class for all work item refinement services
 *
 * Provides shared refinement logic while allowing concrete implementations
 * to handle entity-specific operations through abstract methods.
 */
@Injectable()
export abstract class BaseRefinementService<TEntity extends RefinableEntity> {
  protected readonly logger: Logger;

  constructor(protected readonly serviceName: string) {
    this.logger = new Logger(serviceName);
  }

  // Abstract methods that must be implemented by concrete services
  protected abstract getEntityType(): EntityType;
  protected abstract getWorkItemService(): WorkItemRefinementService<TEntity>;
  protected abstract getCurrentLevelFromStatus(status: string): RefinementLevel;
  protected abstract getNextLevel(
    currentLevel: RefinementLevel,
  ): RefinementLevel | null;

  /**
   * Find a work item entity for refinement adapter use
   */
  async findOne(
    id: string,
    organizationId: OrganizationId,
  ): Promise<TEntity | null> {
    try {
      const entity = await this.getWorkItemService().findOneForAdapter(
        id,
        organizationId,
      );
      if (!entity) {
        this.logger.warn(`${this.getEntityType()} ${id} not found`, {
          id,
          organizationId,
        });
        return null;
      }
      return entity;
    } catch (error) {
      this.logger.error(`Error finding ${this.getEntityType()} ${id}`, {
        error: error instanceof Error ? error.message : error,
        id,
        organizationId,
      });
      throw new Error(
        `Failed to find ${this.getEntityType()} ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Update a work item entity through the adapter
   */
  async update(
    id: string,
    updates: Partial<TEntity>,
    organizationId: OrganizationId,
  ): Promise<TEntity> {
    try {
      const updatedEntity = await this.getWorkItemService().updateForAdapter(
        id,
        updates,
        organizationId,
      );
      this.logger.debug(`Updated ${this.getEntityType()} ${id}`, {
        id,
        organizationId,
        updatedFields: Object.keys(updates),
      });
      return updatedEntity;
    } catch (error) {
      this.logger.error(`Error updating ${this.getEntityType()} ${id}`, {
        error: error instanceof Error ? error.message : error,
        id,
        organizationId,
        updates,
      });
      throw new Error(
        `Failed to update ${this.getEntityType()} ${id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Apply refinement changes to a work item
   * This is the core shared refinement logic
   */
  async applyRefinementChanges(
    entityId: string,
    changes: ContentUpdates,
    organizationId: OrganizationId,
    context?: RefinementContext,
  ): Promise<TEntity> {
    this.logger.log(
      `Applying refinement changes to ${this.getEntityType()} ${entityId}`,
      {
        entityId,
        organizationId,
        changedFields: Object.keys(changes),
      },
    );

    // Validate entity exists
    const entity = await this.findOne(entityId, organizationId);
    if (!entity) {
      throw new Error(`${this.getEntityType()} ${entityId} not found`);
    }

    // Prepare updates - filter out undefined values
    const updates: Partial<TEntity> = {};
    if (changes.description !== undefined) {
      updates.description = changes.description as TEntity['description'];
    }
    if (changes.details !== undefined) {
      updates.details = changes.details as TEntity['details'];
    }
    if (changes.acceptanceCriteria !== undefined) {
      updates.acceptanceCriteria =
        changes.acceptanceCriteria as TEntity['acceptanceCriteria'];
    }
    if (changes.priority !== undefined) {
      updates.priority = changes.priority as TEntity['priority'];
    }
    if (changes.assigneeId !== undefined) {
      updates.assigneeId = changes.assigneeId as TEntity['assigneeId'];
    }

    // Apply the updates
    const updatedEntity = await this.update(entityId, updates, organizationId);

    this.logger.log(
      `Successfully applied refinement changes to ${this.getEntityType()} ${entityId}`,
      {
        entityId,
        organizationId,
        appliedFields: Object.keys(updates),
      },
    );

    return updatedEntity;
  }

  /**
   * Get current refinement level for an entity
   */
  getCurrentRefinementLevel(entity: TEntity): RefinementLevel {
    try {
      return this.getCurrentLevelFromStatus(entity.status);
    } catch (error) {
      this.logger.warn(
        `Could not determine refinement level from status ${entity.status}, defaulting to description`,
        {
          entityId: entity.id,
          status: entity.status,
          entityType: this.getEntityType(),
        },
      );
      return 'description';
    }
  }

  /**
   * Get next refinement level for an entity
   */
  getNextRefinementLevel(entity: TEntity): RefinementLevel | null {
    const currentLevel = this.getCurrentRefinementLevel(entity);
    return this.getNextLevel(currentLevel);
  }

  /**
   * Check if entity can advance to next refinement level
   */
  canAdvanceToNextLevel(entity: TEntity, level?: RefinementLevel): boolean {
    const targetLevel = level || this.getCurrentRefinementLevel(entity);

    // Check if content exists for current level
    switch (targetLevel) {
      case 'description':
        return !!(entity.description && entity.description.trim().length > 0);
      case 'details':
        return !!(entity.details && entity.details.trim().length > 0);
      case 'acceptanceCriteria':
        return !!(
          entity.acceptanceCriteria &&
          entity.acceptanceCriteria.trim().length > 0
        );
      default:
        return false;
    }
  }

  /**
   * Create a refinement session for an entity
   */
  async createRefinementSession(
    entityId: string,
    entityType: string,
    organizationId: OrganizationId,
    projectId?: string,
  ): Promise<RefinementSession> {
    this.logger.log(
      `Creating refinement session for ${this.getEntityType()} ${entityId}`,
      {
        entityId,
        organizationId,
        projectId,
      },
    );

    // Get the entity
    const entity = await this.findOne(entityId, organizationId);
    if (!entity) {
      throw new Error(`${this.getEntityType()} ${entityId} not found`);
    }

    // Create refinement conversation
    const result = await this.getWorkItemService().createRefinementConversation(
      entityId,
      entityType,
      organizationId,
      projectId,
    );
    if (!result.conversation.workflowId) {
      throw new Error('Refinement conversation is missing workflowId');
    }

    const currentLevel = this.getCurrentRefinementLevel(entity);

    const session: RefinementSession = {
      conversationId: result.conversation.id,
      workflowId: result.conversation.workflowId,
      currentLevel,
      entitySnapshot: entity,
      sessionMetadata: {
        entityType: this.getEntityType(),
        entityId,
        organizationId,
        projectId,
        createdAt: new Date().toISOString(),
      },
    };

    this.logger.log(
      `Created refinement session for ${this.getEntityType()} ${entityId}`,
      {
        entityId,
        conversationId: session.conversationId,
        workflowId: session.workflowId,
        currentLevel: session.currentLevel,
      },
    );

    return session;
  }

  /**
   * Get active refinement conversation for an entity
   */
  async getActiveRefinementConversation(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<string | null> {
    try {
      return await this.getWorkItemService().getActiveRefinementConversation(
        entityId,
        organizationId,
      );
    } catch (error) {
      this.logger.error(
        `Error getting active refinement conversation for ${this.getEntityType()} ${entityId}`,
        {
          error: error instanceof Error ? error.message : error,
          entityId,
          organizationId,
        },
      );
      return null;
    }
  }

  /**
   * Validate refinement level for entity type
   */
  validateRefinementLevel(level: string): RefinementLevel {
    if (!isValidRefinementLevel(level)) {
      throw new Error(
        `Invalid refinement level: ${level}. Must be one of: description, details, acceptanceCriteria`,
      );
    }

    const entityType = this.getEntityType();
    const config = WorkItemTypeConfigService.getConfig(entityType);
    const levelExists = config.refinementLevels.some((l) => l.id === level);

    if (!levelExists) {
      throw new Error(
        `Refinement level ${level} not supported for ${entityType}`,
      );
    }

    return level;
  }

  /**
   * Get refinement configuration for this entity type
   */
  getTypeConfig() {
    return WorkItemTypeConfigService.getConfig(this.getEntityType());
  }

  /**
   * Create standard refinement operation result
   */
  protected createOperationResult(
    entityId: string,
    message: string,
    status: string,
    currentLevel: RefinementLevel,
    workflowId?: string,
    metadata?: Record<string, unknown>,
  ): RefinementOperationResult {
    return {
      success: true,
      message,
      status,
      entityId,
      currentLevel,
      workflowId,
      timestamp: new Date(),
      metadata: {
        entityType: this.getEntityType(),
        ...metadata,
      },
    };
  }

  /**
   * Create error result
   */
  protected createErrorResult(
    entityId: string,
    error: string,
    currentLevel: RefinementLevel = 'description',
  ): RefinementOperationResult {
    return {
      success: false,
      message: error,
      status: 'error',
      entityId,
      currentLevel,
      timestamp: new Date(),
      metadata: {
        entityType: this.getEntityType(),
      },
    };
  }
}

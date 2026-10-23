/**
 * Work Item Staged Content Adapter
 *
 * Bridges Initiative and Task entities to the generic staged content framework.
 * Maps entity fields to/from staged content fields while preserving
 * existing business logic and service boundaries.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InitiativeResponseDto, WorkflowName } from '../../generated';
import { StagedContentAdapter } from '../../interfaces/staged-content-adapter.interface';
import { ConversationService } from '../../services/conversation.service';
import { InitiativeService } from '../../services/initiatives/initiative.service';
import { TaskService } from '../../services/tasks/task.service';
import { InitiativeId, OrganizationId, ProjectId, TaskId } from '../../types';
import { StagedContentBase } from '../../types/staged-content-base.types';
import {
  ContentTypeDefinition,
  StageDefinition,
  ValidationError,
} from '../../types/staged-content.types';
import { materializedSectionsToContentMap } from '../../utils/work-item-section.util';
import { getCurrentSectionFromStatus } from '../../utils/work-item.util';
import { getTaskCurrentRefinementLevel } from '../../utils/task-refinement-profile.util';
import { WorkItemTypeRegistryService } from '../../services/tasks/work-item-type-registry.service';

// Define a union type for work items that includes necessary fields
interface WorkItemEntity extends StagedContentBase {
  name?: string;
  description?: string;
  details?: string;
  acceptanceCriteria?: string;
  requirements?: string;
  priority?: string;
  assigneeId?: string;
  entityType?: 'initiative' | 'task';
}

@Injectable()
export class WorkItemStagedContentAdapter
  implements StagedContentAdapter<WorkItemEntity>
{
  private readonly logger = new Logger(WorkItemStagedContentAdapter.name);

  constructor(
    private readonly initiativeService: InitiativeService,
    private readonly taskService: TaskService,
    private readonly conversationService: ConversationService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  private toIsoString(value: Date | string): string {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  }

  /**
   * Find entity by ID with explicit entity type
   * Maintains existing service boundaries - no direct database access
   */
  async findEntity(
    entityId: string,
    organizationId: string,
    entityType?: 'initiative' | 'task',
  ): Promise<WorkItemEntity | null> {
    this.logger.log(
      `Finding work item entity: ${entityId} (type: ${entityType || 'auto-detect'}) in org: ${organizationId}`,
    );

    try {
      if (entityType === 'initiative' || !entityType) {
        // Look for initiative
        const initiative = await this.initiativeService.findOneForAdapter(
          entityId as InitiativeId,
          organizationId as OrganizationId,
        );

        if (initiative) {
          return this.mapInitiativeToStagedEntity(initiative);
        }

        if (entityType === 'initiative') {
          // If specifically looking for initiative and not found, return null
          return null;
        }
      }

      if (entityType === 'task' || !entityType) {
        // For tasks, use the adapter method that doesn't require initiativeId
        this.logger.debug(
          `Looking for task ${entityId} ${entityType ? '' : '(fallback from initiative)'}`,
        );

        const task = await this.taskService.findOneForAdapter(
          entityId,
          organizationId as OrganizationId,
        );

        if (task) {
          return this.mapTaskToStagedEntity(task);
        }
      }

      return null;
    } catch (error) {
      this.logger.error(`Error finding work item entity ${entityId}:`, error);
      return null;
    }
  }

  /**
   * Update entity with partial updates
   * Routes to appropriate service based on entity type
   */
  async updateEntity(
    entityId: string,
    updates: Partial<WorkItemEntity>,
    organizationId: string,
    entityType?: 'initiative' | 'task',
  ): Promise<WorkItemEntity> {
    this.logger.log(
      `Updating work item entity: ${entityId} (type: ${entityType || 'auto-detect'}) with updates:`,
      updates,
    );

    try {
      if (entityType === 'initiative') {
        return await this.updateInitiative(entityId, updates, organizationId);
      } else if (entityType === 'task') {
        return await this.updateTask(entityId, updates, organizationId);
      } else {
        // Auto-detect: First, determine entity type by finding the entity
        const existingEntity = await this.findEntity(entityId, organizationId);
        if (!existingEntity) {
          throw new Error(
            `Work item entity ${entityId} not found in organization ${organizationId}`,
          );
        }

        // Try to update based on detected type
        if (existingEntity.entityType === 'initiative') {
          return await this.updateInitiative(entityId, updates, organizationId);
        } else {
          return await this.updateTask(entityId, updates, organizationId);
        }
      }
    } catch (error) {
      this.logger.error(`Error updating work item entity ${entityId}:`, error);
      throw error;
    }
  }

  /**
   * Create conversation for work item
   * Uses existing conversation service
   */
  async createConversation(
    entityId: string,
    organizationId: string,
    projectId: string,
    planId?: string,
  ): Promise<{ id: string; workflowId?: string }> {
    this.logger.log(`Creating conversation for work item: ${entityId}`);

    try {
      const workItem = await this.findEntity(entityId, organizationId);
      if (!workItem) {
        throw new Error(
          `Work item entity ${entityId} not found in organization ${organizationId}`,
        );
      }

      const aboutType =
        workItem.entityType === 'initiative' ? 'initiative' : 'task';

      // Create conversation using existing service
      const conversation = await this.conversationService.createConversation(
        {
          organizationId: organizationId as OrganizationId,
          projectId: projectId as ProjectId,
          status: 'STARTED', // Use appropriate ConversationStatus
          title: `Work Item Refinement - ${entityId}`,
          workflowName: 'task-generation', // Use appropriate workflow name
          workflowAboutId: entityId,
          workflowAboutType: aboutType,
          initiatedBy: 'USER',
          triggerEvent: 'staged_content_session_created',
          context: {
            aboutId: entityId,
            aboutType,
          },
        },
        organizationId as OrganizationId,
      );
      if (!conversation) {
        throw new Error('Failed to create conversation');
      }

      return {
        id: conversation.id,
        workflowId: conversation.workflowId || undefined,
      };
    } catch (error) {
      this.logger.error(
        `Error creating conversation for work item ${entityId}:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Find active conversation for work item
   * Searches for conversations related to the entity
   */
  async findActiveConversation(
    entityId: string,
    organizationId: string,
  ): Promise<{ id: string; workflowId?: string } | null> {
    this.logger.log(`Finding active conversation for work item: ${entityId}`);

    try {
      // Find conversations related to this entity
      // This requires enhancement to the conversation service to support entity-based lookup
      // For now, return null to indicate no active conversation
      this.logger.debug(
        `Active conversation lookup for work item ${entityId} requires service enhancement`,
      );
      return null;
    } catch (error) {
      this.logger.error(
        `Error finding active conversation for work item ${entityId}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Validate stage transition for work item
   * Applies business rules for stage progression
   */
  async validateStageTransition(
    entity: WorkItemEntity,
    fromStage: string,
    toStage: string,
  ): Promise<ValidationError[]> {
    const errors: ValidationError[] = [];

    this.logger.log(
      `Validating stage transition: ${fromStage} -> ${toStage} for entity ${entity.id}`,
    );

    // Basic validation: ensure required fields are present for current stage
    switch (fromStage) {
      case 'description':
        if (!entity.description || entity.description.trim().length < 10) {
          errors.push({
            field: 'description',
            rule: 'min_length',
            message:
              'Description must be at least 10 characters before advancing',
            code: 'MIN_LENGTH_VIOLATION',
            severity: 'error',
            suggestedFix: 'Add more detail to the description',
          });
        }
        break;

      case 'acceptanceCriteria':
        if (
          !entity.acceptanceCriteria ||
          entity.acceptanceCriteria.trim().length < 15
        ) {
          errors.push({
            field: 'acceptanceCriteria',
            rule: 'min_length',
            message: 'Acceptance criteria must be at least 15 characters',
            code: 'MIN_LENGTH_VIOLATION',
            severity: 'error',
            suggestedFix: 'Define clear completion criteria',
          });
        }
        break;
    }

    // Validate logical progression
    const stageOrder = { description: 1, acceptanceCriteria: 2 };
    const fromOrder = stageOrder[fromStage as keyof typeof stageOrder];
    const toOrder = stageOrder[toStage as keyof typeof stageOrder];

    if (toOrder && fromOrder && toOrder <= fromOrder) {
      errors.push({
        field: 'stage',
        rule: 'custom_function',
        message: `Cannot move backwards from ${fromStage} to ${toStage}`,
        code: 'INVALID_STAGE_TRANSITION',
        severity: 'error',
        suggestedFix:
          'Stages must progress forward: description → acceptanceCriteria',
      });
    }

    this.logger.log(
      `Stage transition validation completed: ${errors.length} errors found`,
    );
    return errors;
  }

  /**
   * Calculate progress for work item
   * Uses linear progression based on stage completion
   */
  async calculateProgress(
    entity: WorkItemEntity,
    contentType: ContentTypeDefinition,
  ): Promise<number> {
    const currentStage = entity.currentStage;
    const totalStages = contentType.stages.length;

    // Find current stage order
    const stage = contentType.stages.find((s) => s.id === currentStage);
    if (!stage) {
      this.logger.warn(
        `Stage ${currentStage} not found in content type ${contentType.id}`,
      );
      return 0;
    }

    // Calculate linear progress
    const progress = Math.round((stage.order / totalStages) * 100);

    this.logger.log(
      `Calculated progress for ${entity.id}: ${progress}% (stage ${stage.order}/${totalStages})`,
    );
    return progress;
  }

  /**
   * Get current stage definition for entity
   */
  getCurrentStage(
    entity: WorkItemEntity,
    contentType: ContentTypeDefinition,
  ): StageDefinition {
    const stage = contentType.stages.find((s) => s.id === entity.currentStage);
    if (!stage) {
      throw new Error(
        `Stage '${entity.currentStage}' not found in content type '${contentType.id}'`,
      );
    }
    return stage;
  }

  /**
   * Check if entity can advance to target stage
   */
  async canAdvanceToStage(
    entity: WorkItemEntity,
    currentStage: StageDefinition,
    targetStage: StageDefinition,
  ): Promise<boolean> {
    // Check if target stage is in next stages list
    if (!currentStage.nextStages.includes(targetStage.id)) {
      return false;
    }

    // Validate stage transition
    const errors = await this.validateStageTransition(
      entity,
      currentStage.id,
      targetStage.id,
    );

    return errors.length === 0;
  }

  /**
   * Map Initiative entity to WorkItemEntity
   */
  private mapInitiativeToStagedEntity(
    initiative: InitiativeResponseDto,
  ): WorkItemEntity {
    const currentLevel = getCurrentSectionFromStatus(initiative.status);
    const content = materializedSectionsToContentMap(initiative.sections);

    return {
      id: initiative.id,
      name: initiative.name,
      description: content.description || undefined,
      details: content.details || undefined,
      acceptanceCriteria: content.acceptanceCriteria || undefined,
      status: initiative.status,
      priority: initiative.priority ?? undefined,
      assigneeId: initiative.assigneeId ?? undefined,
      organizationId: initiative.organizationId,
      projectId: undefined,
      createdAt: this.toIsoString(initiative.createdAt),
      updatedAt: this.toIsoString(initiative.updatedAt),
      entityType: 'initiative' as const,
      currentStage: currentLevel,
    };
  }

  /**
   * Map Task entity to WorkItemEntity
   */
  private mapTaskToStagedEntity(task: any): WorkItemEntity {
    const levels = this.workItemTypeRegistry.getTaskRefinementLevels(
      task.type,
      task.projectId,
    );
    const currentLevel = getTaskCurrentRefinementLevel(task.status, levels);
    const content = materializedSectionsToContentMap(task.sections);

    const isGoalTask = task.type === 'GOAL';

    return {
      id: task.id,
      name: task.name,
      description: content.description || undefined,
      details: content.details || undefined,
      acceptanceCriteria: isGoalTask
        ? undefined
        : content.acceptanceCriteria || undefined,
      requirements: isGoalTask ? undefined : content.requirements || undefined,
      status: task.status,
      priority: task.priority,
      assigneeId: task.assigneeId,
      organizationId: task.organizationId as OrganizationId,
      projectId: task.initiativeId as ProjectId, // Map initiativeId to projectId for compatibility
      createdAt: this.toIsoString(task.createdAt),
      updatedAt: this.toIsoString(task.updatedAt),
      entityType: 'task' as const,
      currentStage: currentLevel,
    };
  }

  /**
   * Map staged entity updates to task update format
   */
  private mapStagedEntityToTaskUpdates(
    updates: Partial<WorkItemEntity>,
  ): Partial<any> {
    const taskUpdates: any = {};
    const sectionUpdates: Array<{ key: string; content: string }> = [];

    // Map common fields
    if (updates.name !== undefined) taskUpdates.name = updates.name;
    if (updates.description !== undefined) {
      sectionUpdates.push({
        key: 'description',
        content: updates.description ?? '',
      });
    }
    if (updates.acceptanceCriteria !== undefined) {
      sectionUpdates.push({
        key: 'acceptanceCriteria',
        content: updates.acceptanceCriteria ?? '',
      });
    }
    if (updates.requirements !== undefined) {
      sectionUpdates.push({
        key: 'requirements',
        content: updates.requirements ?? '',
      });
    }
    if (updates.priority !== undefined) taskUpdates.priority = updates.priority;
    if (updates.assigneeId !== undefined)
      taskUpdates.assigneeId = updates.assigneeId;
    if (updates.status !== undefined) taskUpdates.status = updates.status;
    if (sectionUpdates.length > 0) taskUpdates.sections = sectionUpdates;

    return taskUpdates;
  }

  /**
   * Update initiative entity
   */
  private async updateInitiative(
    entityId: string,
    updates: Partial<WorkItemEntity>,
    organizationId: string,
  ): Promise<WorkItemEntity> {
    // Map staged content updates to initiative updates
    const initiativeUpdates: any = {};
    const sectionUpdates: Array<{
      key: 'description' | 'details' | 'acceptanceCriteria';
      content: string;
    }> = [];

    if (updates.description !== undefined) {
      sectionUpdates.push({
        key: 'description',
        content: updates.description ?? '',
      });
    }
    if (updates.details !== undefined) {
      sectionUpdates.push({
        key: 'details',
        content: updates.details ?? '',
      });
    }
    if (updates.acceptanceCriteria !== undefined) {
      sectionUpdates.push({
        key: 'acceptanceCriteria',
        content: updates.acceptanceCriteria ?? '',
      });
    }
    if (updates.priority !== undefined) {
      initiativeUpdates.priority = updates.priority;
    }
    if (updates.assigneeId !== undefined) {
      initiativeUpdates.assigneeId = updates.assigneeId;
    }

    let updatedResponse: InitiativeResponseDto | null = null;

    if (sectionUpdates.length > 0) {
      updatedResponse = await this.initiativeService.applySectionUpdates(
        organizationId as OrganizationId,
        entityId as InitiativeId,
        sectionUpdates,
      );
    }

    if (Object.keys(initiativeUpdates).length === 0) {
      if (!updatedResponse) {
        throw new Error(
          `Invariant violation: no updates were applied to initiative ${entityId}`,
        );
      }
      return this.mapInitiativeToStagedEntity(updatedResponse);
    }

    const updatedInitiative = await this.initiativeService.updateForAdapter(
      entityId as InitiativeId,
      initiativeUpdates,
      organizationId as OrganizationId,
    );

    return this.mapInitiativeToStagedEntity(updatedInitiative);
  }

  /**
   * Update task entity
   */
  private async updateTask(
    entityId: string,
    updates: Partial<WorkItemEntity>,
    organizationId: string,
  ): Promise<WorkItemEntity> {
    this.logger.log(
      `Updating task ${entityId} in organization ${organizationId}`,
    );

    try {
      // Convert WorkItemEntity updates to TaskResponseDto format
      const taskUpdates = this.mapStagedEntityToTaskUpdates(updates);

      // Use the adapter method that doesn't require initiativeId
      const updatedTask = await this.taskService.updateForAdapter(
        entityId as TaskId,
        taskUpdates,
        organizationId as OrganizationId,
      );

      // Convert back to WorkItemEntity format
      return this.mapTaskToStagedEntity(updatedTask);
    } catch (error) {
      this.logger.error(`Failed to update task ${entityId}:`, error);
      throw error;
    }
  }

  /**
   * Calculate linear progress based on current level
   */
  private calculateLinearProgress(currentLevel: string): number {
    const progressMap = {
      description: 33,
      details: 67,
      acceptanceCriteria: 100,
    };

    return progressMap[currentLevel as keyof typeof progressMap] || 0;
  }
}

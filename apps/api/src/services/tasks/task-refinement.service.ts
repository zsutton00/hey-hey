/**
 * Task Refinement Service
 *
 * Implements the generic refinement interface for tasks, providing
 * task-specific implementations while leveraging shared refinement logic.
 */

import { Injectable } from '@nestjs/common';
import { WorkStatus } from '@prisma/client';
import {
  ConversationResponseDto,
  ConversationStatus,
  InitiationType,
  TaskPriority,
  TaskResponseDto,
  TaskSectionUpdateSource,
  WorkItemSectionInput,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { OrganizationId, ProjectId, TaskId, UserId } from '../../types';
import {
  EntityType,
  RefinementLevel,
} from '../../types/refinable-entity.types';
import {
  safeToTaskRefinableEntity,
  TaskRefinableEntity,
} from '../../types/task-refinement-adapter.types';
import {
  CANONICAL_REFINEMENT_LEVELS,
  getTaskCurrentRefinementLevel,
  getTaskNextRefinementLevel,
  getTaskRefiningStatusForLevel,
} from '../../utils/task-refinement-profile.util';
import {
  BaseRefinementService,
  WorkItemRefinementService,
} from '../base/base-refinement.service';
import { ConversationService } from '../conversation.service';
import { ConversationWorkflowService } from '../workflows/conversation-workflow.service';
import { TaskService } from './task.service';
import { WorkItemTypeRegistryService } from './work-item-type-registry.service';

/**
 * Task-specific refinement service implementation
 * Extends BaseRefinementService with task-specific behavior
 */
@Injectable()
export class TaskRefinementService
  extends BaseRefinementService<TaskRefinableEntity>
  implements WorkItemRefinementService<TaskRefinableEntity>
{
  constructor(
    private readonly taskService: TaskService,
    private readonly conversationWorkflowService: ConversationWorkflowService,
    private readonly prisma: PrismaService,
    private readonly conversationService: ConversationService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {
    super('TaskRefinementService');
  }

  // Abstract method implementations from BaseRefinementService

  protected getEntityType(): EntityType {
    return 'task';
  }

  protected getWorkItemService(): WorkItemRefinementService<TaskRefinableEntity> {
    return this;
  }

  protected getCurrentLevelFromStatus(status: string): RefinementLevel {
    // When only status is available (no task type), default to the full
    // canonical level set so the abstract fallback matches the STANDARD profile.
    return getTaskCurrentRefinementLevel(status, CANONICAL_REFINEMENT_LEVELS);
  }

  protected getNextLevel(
    currentLevel: RefinementLevel,
  ): RefinementLevel | null {
    if (currentLevel === 'details') {
      return 'acceptanceCriteria';
    }
    return getTaskNextRefinementLevel(
      currentLevel as 'description' | 'acceptanceCriteria',
      CANONICAL_REFINEMENT_LEVELS,
    );
  }

  override getCurrentRefinementLevel(
    entity: TaskRefinableEntity,
  ): RefinementLevel {
    const levels = this.workItemTypeRegistry.getTaskRefinementLevels(
      entity.type,
      entity.projectId,
    );
    return getTaskCurrentRefinementLevel(entity.status, levels);
  }

  override getNextRefinementLevel(
    entity: TaskRefinableEntity,
  ): RefinementLevel | null {
    const currentLevel = this.getCurrentRefinementLevel(entity);
    if (currentLevel === 'details') {
      return 'acceptanceCriteria';
    }
    const levels = this.workItemTypeRegistry.getTaskRefinementLevels(
      entity.type,
      entity.projectId,
    );
    return getTaskNextRefinementLevel(
      currentLevel as 'description' | 'acceptanceCriteria',
      levels,
    );
  }

  // WorkItemRefinementService interface implementations

  async findOneForAdapter(
    id: string,
    organizationId: OrganizationId,
  ): Promise<TaskRefinableEntity | null> {
    const task = await this.taskService.findOneForAdapter(
      id as TaskId,
      organizationId,
    );
    if (!task) {
      return null;
    }
    return safeToTaskRefinableEntity(task);
  }

  async updateForAdapter(
    id: string,
    updates: Partial<TaskRefinableEntity>,
    organizationId: OrganizationId,
  ): Promise<TaskRefinableEntity> {
    const sectionUpdates: WorkItemSectionInput[] = [];
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

    // Convert updates to TaskResponseDto format
    const taskUpdates: Partial<Omit<TaskResponseDto, 'sections'>> & {
      sections?: WorkItemSectionInput[];
      sectionUpdateSource?: TaskSectionUpdateSource;
    } = {
      name: updates.name,
      status: updates.status as WorkStatus,
      priority: updates.priority
        ? (updates.priority as TaskPriority)
        : undefined,
      assigneeId: updates.assigneeId ?? undefined,
      parentTaskId: updates.parentTaskId ?? undefined,
      type: updates.type,
      // Add other fields as needed
    };
    if (sectionUpdates.length > 0) {
      taskUpdates.sections = sectionUpdates;
      taskUpdates.sectionUpdateSource = TaskSectionUpdateSource.AgentSuggested;
    }

    const updatedTask = await this.taskService.updateForAdapter(
      id as TaskId,
      taskUpdates,
      organizationId,
    );
    const refinableEntity = safeToTaskRefinableEntity(updatedTask);

    if (!refinableEntity) {
      throw new Error(
        `Failed to convert updated task to refinable entity: ${id}`,
      );
    }

    return refinableEntity;
  }

  async applySectionUpdates(
    organizationId: OrganizationId,
    taskId: TaskId,
    updates: Array<{ key: string; content: string }>,
  ): Promise<TaskResponseDto> {
    return this.taskService.applySectionUpdates(
      organizationId,
      taskId,
      updates as Array<{ key: any; content: string }>,
      { updateOriginalArtifact: true },
    );
  }

  async createRefinementConversation(
    entityId: string,
    entityType: string,
    organizationId: OrganizationId,
    projectId?: string,
    planId?: string,
    userId?: UserId,
  ): Promise<{
    conversation: ConversationResponseDto;
    entities: TaskRefinableEntity[];
  }> {
    this.logger.log(`Creating refinement conversation for task ${entityId}`, {
      entityId,
      organizationId,
      projectId,
    });

    // Validate that the task exists
    const task = await this.findOneForAdapter(entityId, organizationId);
    if (!task) {
      throw new Error(
        `Task ${entityId} not found in organization ${organizationId}`,
      );
    }

    if (!projectId) {
      throw new Error(
        'Project ID is required for task refinement conversations',
      );
    }

    // Create conversation for task refinement using the conversation service
    const conversation =
      await this.conversationWorkflowService.createConversation(
        {
          organizationId,
          projectId: projectId as ProjectId,
          workflowAboutId: entityId,
          workflowAboutType: entityType,
          initiatedBy: InitiationType.User,
          workflowName: 'task-refinement',
          context: {},
          // Note: We'll need to add taskId field to conversation creation
        },
        organizationId,
        ...(userId ? [{ userId }] : []),
      );

    return {
      ...conversation,
      entities: [task],
    };
  }

  async getActiveRefinementConversation(
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<string | null> {
    this.logger.debug(
      '[getActiveRefinementConversation] searching for task conversation',
      {
        taskId: entityId,
        organizationId,
        expectedWorkflowName: 'task-refinement',
      },
    );

    // Look for any task refinement conversation (including completed ones)
    const conversation = await this.prisma.db.conversation.findFirst({
      where: {
        workflowAboutId: entityId,
        workflowName: 'task-refinement',
        organizationId,
        NOT: {
          status: ConversationStatus.Deleted,
        },
      },
      select: {
        id: true,
        status: true,
        title: true,
        version: true,
      },
      orderBy: {
        updatedAt: 'desc', // Get the most recent one
      },
    });

    if (conversation) {
      // Smart conversation status handling - reset conversations to allow continued refinement
      const shouldRestart = ['COMPLETED', 'FAILED', 'RECOVERABLE'].includes(
        conversation.status as string,
      );

      if (shouldRestart) {
        const statusTransitionReason = this.getStatusTransitionReason(
          conversation.status as string,
        );

        this.logger.debug(
          '[getActiveRefinementConversation] restarting task conversation',
          {
            conversationId: conversation.id,
            oldStatus: conversation.status,
            reason: statusTransitionReason,
          },
        );

        try {
          await this.conversationService.updateConversationInternal(
            conversation.id,
            organizationId,
            {
              status: 'IN_PROGRESS' as ConversationStatus,
              title: conversation.title
                ? conversation.title.replace(
                    / - (Completed|Failed|Recoverable).*$/,
                    '',
                  )
                : undefined,
            },
          );

          this.logger.debug(
            '[getActiveRefinementConversation] restarted task conversation',
            {
              conversationId: conversation.id,
              oldStatus: conversation.status,
              newStatus: 'IN_PROGRESS',
              reason: statusTransitionReason,
            },
          );
        } catch (error) {
          this.logger.error(
            '[getActiveRefinementConversation] failed to restart conversation',
            {
              conversationId: conversation.id,
              error: error instanceof Error ? error.message : String(error),
            },
          );
          // Return null if we can't restart the conversation
          return null;
        }
      }
    }

    this.logger.debug('[getActiveRefinementConversation] result', {
      taskId: entityId,
      organizationId,
      foundConversationId: conversation?.id || null,
      conversationStatus: conversation?.status || null,
    });

    return conversation?.id || null;
  }

  /**
   * Get reason for conversation status transition based on old status
   */
  private getStatusTransitionReason(oldStatus: string): string {
    switch (oldStatus) {
      case 'COMPLETED':
        return 'Task conversation was completed but user wants to continue refinement';
      case 'FAILED':
        return 'Task conversation failed but is being restarted for user access';
      case 'RECOVERABLE':
        return 'Task conversation was in recoverable state and is now being resumed';
      default:
        return `Task conversation status was ${oldStatus} and is being restarted`;
    }
  }

  /**
   * Get the appropriate status for a given refinement level
   * Maps refinement levels back to task statuses
   */
  getStatusForLevel(level: RefinementLevel): WorkStatus {
    switch (level) {
      case 'description':
        return getTaskRefiningStatusForLevel('description');
      case 'details':
      case 'acceptanceCriteria':
        return getTaskRefiningStatusForLevel('acceptanceCriteria');
      default:
        return 'BACKLOG';
    }
  }

  /**
   * Check if task can advance to next refinement level
   * Overrides base implementation with task-type-aware profile logic
   */
  canAdvanceToNextLevel(
    task: TaskRefinableEntity,
    level?: RefinementLevel,
  ): boolean {
    const targetLevel = level || this.getCurrentRefinementLevel(task);
    const levels = this.workItemTypeRegistry.getTaskRefinementLevels(
      task.type,
      task.projectId,
    );

    switch (targetLevel) {
      case 'description':
        return !!(task.description && task.description.trim().length > 0);
      case 'details':
      case 'acceptanceCriteria':
        // A single-level type (no acceptanceCriteria) advances freely; a
        // two-level type requires acceptance-criteria content.
        return !levels.includes('acceptanceCriteria')
          ? true
          : !!(
              task.acceptanceCriteria &&
              task.acceptanceCriteria.trim().length > 0
            );
      default:
        return false;
    }
  }

  /**
   * Determine if task field is empty and needs initial generation
   * Task-specific implementation of field emptiness check
   */
  isFieldEmpty(task: TaskRefinableEntity, level: RefinementLevel): boolean {
    let fieldValue: string | null | undefined;

    switch (level) {
      case 'description':
        fieldValue = task.description;
        break;
      case 'details':
      case 'acceptanceCriteria':
        fieldValue = task.acceptanceCriteria;
        break;
      default:
        return true;
    }

    return !fieldValue || fieldValue.trim() === '';
  }
}

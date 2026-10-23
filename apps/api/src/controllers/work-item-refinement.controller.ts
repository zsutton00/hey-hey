import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Priority } from '@prisma/client';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import {
  AdvanceWorkItemLevel200ResponseAllOfData,
  ConversationResponseDto,
  ConversationStatus,
  FinalizeWorkItemRefinement200ResponseAllOfData,
  InitiationType,
  InitiativeResponseDto,
  TaskPriority,
  RefineWorkItem200ResponseAllOfData,
  TaskResponseDto,
  UpdateWorkItemContent200ResponseAllOfDataData,
  UpdateWorkItemContent200ResponseAllOfDataDataWorkItem,
  WorkItemAdvanceRequestDto,
  WorkItemContentUpdateDto,
  WorkStatus,
} from '../generated';
import { ConversationService } from '../services/conversation.service';
import { InitiativeRefinementService } from '../services/initiatives/initiative-refinement.service';
import { InitiativeService } from '../services/initiatives/initiative.service';
import { TaskRefinementService } from '../services/tasks/task-refinement.service';
import { TaskService } from '../services/tasks/task.service';
import { WorkflowRouterService } from '../services/workflows/workflow-router.service';
import { WorkflowTypeRegistryService } from '../services/workflows/workflow-type-registry.service';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
  WorkflowAboutType,
} from '../types';
import { InitiativeRefinableEntity } from '../types/initiative-refinement-adapter.types';
import {
  EntityType,
  RefinableEntity,
  RefinementLevel,
  getNextRefinementLevel,
  isValidEntityType,
  isValidRefinementLevel,
} from '../types/refinable-entity.types';
import { TaskRefinableEntity } from '../types/task-refinement-adapter.types';
import { getCurrentSectionFromStatus } from '../utils/work-item.util';
import {
  canTaskFinalizeAtLevel,
  CANONICAL_REFINEMENT_LEVELS,
  getTaskCurrentRefinementLevel,
  getTaskNextRefinementLevel,
  getTaskRefinementProgressPercentage,
  isTaskSectionAllowedForType,
  TaskRefinementLevel,
} from '../utils/task-refinement-profile.util';
import { WorkItemTypeRegistryService } from '../services/tasks/work-item-type-registry.service';

// Create union type for refined entities
type WorkItemEntity =
  | RefinableEntity
  | TaskRefinableEntity
  | InitiativeRefinableEntity;

const INITIATIVE_SECTION_KEYS = [
  'description',
  'details',
  'acceptanceCriteria',
] as const;

type WorkItemSectionKey = (typeof INITIATIVE_SECTION_KEYS)[number];

/**
 * Unified Work Item Refinement Controller
 *
 * Provides generic refinement endpoints that work with both initiatives and tasks.
 * Routes to appropriate service implementation based on entity type parameter.
 *
 * URL Pattern: /api/v1/organizations/:organizationId/projects/:projectId/work-items/:entityType/:entityId/refinement
 */
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/work-items/:entityType/:entityId/refinement',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
@ApiTags('Work Item Refinement')
export class WorkItemRefinementController {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(WorkItemRefinementController.name);

  constructor(
    private readonly initiativeRefinementService: InitiativeRefinementService,
    private readonly taskRefinementService: TaskRefinementService,
    private readonly initiativeService: InitiativeService,
    private readonly taskService: TaskService,
    private readonly conversationService: ConversationService,
    private readonly workflowRouterService: WorkflowRouterService,
    private readonly workflowTypeRegistryService: WorkflowTypeRegistryService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
  ) {}

  /**
   * Ordered refinement levels for a task work item, derived from its type's
   * sections via the registry. Only valid for the task entity type.
   */
  private deriveTaskLevels(
    workItem: WorkItemEntity,
    projectId: ProjectId,
  ): readonly TaskRefinementLevel[] {
    return this.workItemTypeRegistry.getTaskRefinementLevels(
      (workItem as TaskRefinableEntity).type,
      projectId,
    );
  }

  /**
   * Get appropriate refinement service based on entity type
   */
  private getRefinementService(entityType: EntityType) {
    switch (entityType) {
      case 'initiative':
        return this.initiativeRefinementService;
      case 'task':
        return this.taskRefinementService;
      default:
        throw new BadRequestException(
          `Unsupported entity type: ${entityType as string}`,
        );
    }
  }

  /**
   * Validate entity type parameter
   */
  private validateEntityType(entityType: string): EntityType {
    if (!isValidEntityType(entityType)) {
      throw new BadRequestException(
        `Invalid entity type: ${entityType}. Must be 'initiative' or 'task'`,
      );
    }
    return entityType;
  }

  /**
   * Validate refinement level parameter
   */
  private validateRefinementLevel(level: string): RefinementLevel {
    if (!isValidRefinementLevel(level)) {
      throw new BadRequestException(
        `Invalid refinement level: ${level}. Must be 'description', 'details', or 'acceptanceCriteria'`,
      );
    }
    return level;
  }

  private assertNoLegacyTaskDetailsLevel(
    entityType: EntityType,
    currentLevel: RefinementLevel,
    targetLevel?: RefinementLevel,
  ): void {
    if (entityType !== 'task') {
      return;
    }

    if (currentLevel === 'details' || targetLevel === 'details') {
      throw new BadRequestException(
        "Task refinement level 'details' is no longer supported. Use 'description' and 'acceptanceCriteria'.",
      );
    }
  }

  /**
   * Generic method to find work item by type
   */
  private async findWorkItem(
    entityType: EntityType,
    entityId: string,
    organizationId: OrganizationId,
  ): Promise<WorkItemEntity | null> {
    const refinementService = this.getRefinementService(entityType);
    return refinementService.findOneForAdapter(entityId, organizationId);
  }

  /**
   * Generic method to update work item by type
   */
  private async updateWorkItem(
    entityType: EntityType,
    entityId: string,
    updates: Partial<WorkItemEntity>,
    organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto | TaskResponseDto> {
    if (entityType === 'initiative') {
      const initiativeUpdates: Partial<
        Omit<InitiativeResponseDto, 'sections'>
      > = {};
      if (updates.name !== undefined) {
        initiativeUpdates.name = updates.name;
      }
      if (updates.status !== undefined) {
        initiativeUpdates.status = updates.status as WorkStatus;
      }
      if (updates.priority !== undefined) {
        initiativeUpdates.priority = updates.priority as Priority;
      }
      if (updates.assigneeId !== undefined) {
        initiativeUpdates.assigneeId = updates.assigneeId as UserId;
      }
      return this.initiativeService.updateForAdapter(
        entityId as InitiativeId,
        initiativeUpdates,
        organizationId,
      );
    }

    const taskUpdates: Partial<Omit<TaskResponseDto, 'sections'>> = {};
    if (updates.name !== undefined) {
      taskUpdates.name = updates.name;
    }
    if (updates.status !== undefined) {
      taskUpdates.status = updates.status as WorkStatus;
    }
    if (updates.priority !== undefined) {
      taskUpdates.priority = updates.priority as TaskPriority;
    }
    if (updates.assigneeId !== undefined) {
      taskUpdates.assigneeId = updates.assigneeId as string;
    }
    return this.taskService.updateForAdapter(
      entityId as TaskId,
      taskUpdates,
      organizationId,
    );
  }

  private validateSectionUpdates(
    entityType: EntityType,
    sections?: WorkItemContentUpdateDto['sections'],
    taskLevels?: readonly TaskRefinementLevel[],
  ): Array<{ key: WorkItemSectionKey; content: string }> {
    if (!sections || sections.length === 0) {
      return [];
    }

    const seenKeys = new Set<WorkItemSectionKey>();
    return sections.map((section) => {
      const key = section.key as WorkItemSectionKey;
      if (
        entityType === 'initiative' &&
        !INITIATIVE_SECTION_KEYS.includes(key)
      ) {
        throw new BadRequestException(
          `Unsupported section key: ${section.key}`,
        );
      }
      if (
        entityType === 'task' &&
        !isTaskSectionAllowedForType(
          key,
          taskLevels ?? CANONICAL_REFINEMENT_LEVELS,
        )
      ) {
        throw new BadRequestException(
          `Unsupported section key: ${section.key}`,
        );
      }
      if (typeof section.content !== 'string') {
        throw new BadRequestException(
          `Section content must be a string for key: ${section.key}`,
        );
      }
      if (seenKeys.has(key)) {
        throw new BadRequestException(`Duplicate section key: ${section.key}`);
      }
      seenKeys.add(key);
      return {
        key,
        content: section.content,
      };
    });
  }
  /**
   * Process refinement request for a work item
   */
  @Post('start')
  @ApiOperation({
    summary: 'Refine work item',
    description:
      'Send a refinement request (message or content update) for processing',
  })
  @ApiParam({ name: 'entityType', enum: ['initiative', 'task'] })
  async refineWorkItem(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('entityType') entityTypeParam: string,
    @Param('entityId') entityId: string,
    @CurrentUser('userId') userId: UserId,
  ): Promise<RefineWorkItem200ResponseAllOfData> {
    const entityType = this.validateEntityType(entityTypeParam);

    this.logger.debug('[refineWorkItem] starting...', {
      organizationId,
      projectId,
      entityTypeParam,
      entityId,
    });

    // Find the work item
    const workItem = await this.findWorkItem(
      entityType,
      entityId,
      organizationId,
    );
    if (!workItem) {
      throw new NotFoundException(`${entityType} not found`);
    }

    // Get or create refinement conversation
    const refinementService = this.getRefinementService(entityType);
    let conversationId =
      await refinementService.getActiveRefinementConversation(
        entityId as InitiativeId,
        organizationId,
      );

    let conversation: ConversationResponseDto | null = null;
    if (!conversationId) {
      const result = await refinementService.createRefinementConversation(
        entityId,
        entityType,
        organizationId,
        projectId,
        undefined,
        userId,
      );
      if (!result.conversation) {
        throw new NotFoundException('Conversation could not be created');
      }
      conversation = result.conversation;
      conversationId = conversation.id;
    } else {
      // Get conversation to access workflowId
      conversation = await this.conversationService.findOne(
        conversationId as ConversationId,
        organizationId,
      );
    }

    if (!conversation) {
      throw new NotFoundException(`Conversation ${conversationId} not found`);
    }

    if (!conversation.workflowId) {
      throw new BadRequestException('Conversation has no associated workflow');
    }

    // Check if workflow is still running
    const isWorkflowRunning =
      await this.workflowRouterService.isWorkflowRunning(
        conversation.workflowId,
      );

    if (!isWorkflowRunning) {
      this.logger.log('Workflow is not running, starting new workflow', {
        conversationId,
        workflowId: conversation.workflowId,
        workflowName: conversation.workflowName,
      });

      try {
        // Start a new workflow - it will automatically resume from the last FlowExecution state
        // The workflow's initializeConversationFlow activity handles resumption by:
        // 1. Finding the existing FlowExecution for this conversation
        // 2. Checking if it's resumable
        // 3. Restoring the flowState and currentNode if resumable
        // 4. Otherwise starting fresh from the beginning
        const workflowResult =
          await this.workflowTypeRegistryService.startWorkflowByType(
            conversation.workflowName,
            conversationId as ConversationId,
            conversation.projectId,
            organizationId,
            'system' as UserId,
            conversation.title,
            conversation.workflowAboutType as WorkflowAboutType,
            conversation.workflowAboutId as string,
          );

        this.logger.log('Workflow restarted successfully', {
          conversationId,
          newWorkflowId: workflowResult.workflowId,
        });

        // Return response with restarted workflow details
        const currentLevel =
          entityType === 'task'
            ? getTaskCurrentRefinementLevel(
                workItem.status,
                this.deriveTaskLevels(workItem, projectId),
              )
            : getCurrentSectionFromStatus(workItem.status);

        return {
          entityId,
          conversationId,
          workflowId: workflowResult.workflowId,
          currentLevel,
        };
      } catch (error) {
        this.logger.error('Failed to restart workflow', {
          error: (error as Error).message,
          conversationId,
          workflowId: conversation.workflowId,
        });
        throw new BadRequestException(
          `Workflow is not running and restart failed: ${(error as Error).message}`,
        );
      }
    }

    // Process refinement using direct service approach
    this.logger.log(`Processing refinement for ${entityType} ${entityId}`, {
      entityType,
      entityId,
      organizationId,
    });

    // workItem already found above

    // Note: Conversation handling is managed by the existing refinement services

    const currentLevel =
      entityType === 'task'
        ? getTaskCurrentRefinementLevel(
            workItem.status,
            this.deriveTaskLevels(workItem, projectId),
          )
        : getCurrentSectionFromStatus(workItem.status);

    // Default: general message acknowledgment
    return {
      entityId,
      conversationId,
      workflowId: conversation.workflowId,
      currentLevel,
    };
  }

  /**
   * Update work item content with bulk field updates
   */
  @Patch('content')
  @ApiOperation({
    summary: 'Update work item content',
    description: 'Update multiple fields of the work item content',
  })
  @ApiParam({ name: 'entityType', enum: ['initiative', 'task'] })
  async updateContent(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('entityType') entityTypeParam: string,
    @Param('entityId') entityId: string,
    @Body() updateRequest: WorkItemContentUpdateDto,
  ): Promise<UpdateWorkItemContent200ResponseAllOfDataData> {
    const entityType = this.validateEntityType(entityTypeParam);

    // Find the work item
    const workItem = await this.findWorkItem(
      entityType,
      entityId,
      organizationId,
    );
    if (!workItem) {
      throw new NotFoundException(`${entityType} not found`);
    }

    // Build update object
    const updates: Partial<InitiativeResponseDto | TaskResponseDto> = {};
    const updatedFields: string[] = [];
    const sectionUpdates = this.validateSectionUpdates(
      entityType,
      updateRequest.sections,
      entityType === 'task'
        ? this.deriveTaskLevels(workItem, projectId)
        : undefined,
    );
    if (updateRequest.priority !== undefined) {
      updates.priority = updateRequest.priority as Priority;
      updatedFields.push('priority');
    }
    if (updateRequest.assigneeId !== undefined) {
      updates.assigneeId = updateRequest.assigneeId;
      updatedFields.push('assigneeId');
    }

    if (updatedFields.length === 0 && sectionUpdates.length === 0) {
      throw new BadRequestException(
        'At least one field must be provided for update',
      );
    }

    let updatedWorkItem: InitiativeResponseDto | TaskResponseDto | null = null;

    if (sectionUpdates.length > 0) {
      updatedFields.push(...sectionUpdates.map((section) => section.key));

      if (entityType === 'initiative') {
        updatedWorkItem =
          await this.initiativeRefinementService.applySectionUpdates(
            organizationId,
            entityId as InitiativeId,
            sectionUpdates,
          );
      } else {
        updatedWorkItem = await this.taskRefinementService.applySectionUpdates(
          organizationId,
          entityId as TaskId,
          sectionUpdates,
        );
      }
    }

    if (Object.keys(updates).length > 0) {
      updatedWorkItem = await this.updateWorkItem(
        entityType,
        entityId,
        updates,
        organizationId,
      );
    }

    if (!updatedWorkItem) {
      throw new BadRequestException(
        'At least one field must be provided for update',
      );
    }

    this.logger.log(`Updated ${entityType} content`, {
      entityId,
      updatedFields,
      requestFeedback: updateRequest.requestFeedback,
    });

    return {
      workItem:
        updatedWorkItem as UpdateWorkItemContent200ResponseAllOfDataDataWorkItem,
      updatedFields,
      feedbackRequested: updateRequest.requestFeedback || false,
    };
  }

  /**
   * Advance work item to next refinement level
   */
  @Post('advance')
  @ApiOperation({
    summary: 'Advance refinement level',
    description: 'Move work item to the next refinement level',
  })
  @ApiParam({ name: 'entityType', enum: ['initiative', 'task'] })
  async advanceLevel(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('entityType') entityTypeParam: string,
    @Param('entityId') entityId: string,
    @Body() advanceRequest: WorkItemAdvanceRequestDto,
  ): Promise<AdvanceWorkItemLevel200ResponseAllOfData> {
    const entityType = this.validateEntityType(entityTypeParam);
    const currentLevel = this.validateRefinementLevel(
      advanceRequest.currentLevel,
    );
    this.assertNoLegacyTaskDetailsLevel(
      entityType,
      currentLevel,
      advanceRequest.targetLevel,
    );

    // Find the work item
    const workItem = await this.findWorkItem(
      entityType,
      entityId,
      organizationId,
    );
    if (!workItem) {
      throw new NotFoundException(`${entityType} not found`);
    }

    // Validate current level matches work item state
    const taskLevels =
      entityType === 'task'
        ? this.deriveTaskLevels(workItem, projectId)
        : undefined;
    const actualCurrentLevel =
      entityType === 'task'
        ? getTaskCurrentRefinementLevel(workItem.status, taskLevels!)
        : getCurrentSectionFromStatus(workItem.status);
    if (actualCurrentLevel !== currentLevel && !advanceRequest.skipValidation) {
      throw new BadRequestException(
        `Current level mismatch. Expected ${currentLevel}, but work item is at ${actualCurrentLevel}`,
      );
    }

    // Determine target level
    const requestedTargetLevel = advanceRequest.targetLevel;
    const targetLevel =
      entityType === 'task'
        ? requestedTargetLevel ||
          getTaskNextRefinementLevel(
            actualCurrentLevel as 'description' | 'acceptanceCriteria',
            taskLevels!,
          )
        : requestedTargetLevel || getNextRefinementLevel(currentLevel);
    if (!targetLevel) {
      throw new BadRequestException(
        `Cannot advance beyond ${currentLevel} level`,
      );
    }

    // Get refinement service and check if advancement is allowed
    const refinementService = this.getRefinementService(entityType);
    const canAdvance =
      entityType === 'initiative'
        ? this.initiativeRefinementService.canAdvanceToNextLevel(
            workItem as InitiativeRefinableEntity,
            currentLevel,
          )
        : this.taskRefinementService.canAdvanceToNextLevel(
            workItem as TaskRefinableEntity,
            actualCurrentLevel,
          );

    if (!canAdvance && !advanceRequest.skipValidation) {
      throw new BadRequestException(
        `Cannot advance to ${targetLevel} level. Current level content is incomplete`,
      );
    }

    // Update status to reflect new level
    const statusUpdate = this.getStatusForLevel(
      entityType,
      targetLevel,
      taskLevels,
    );
    const updatedWorkItem = await this.updateWorkItem(
      entityType,
      entityId,
      statusUpdate,
      organizationId,
    );

    this.logger.log(
      `Advanced ${entityType} from ${currentLevel} to ${targetLevel}`,
      {
        entityId,
        previousLevel: currentLevel,
        newLevel: targetLevel,
      },
    );

    return {
      entityId,
      currentLevel:
        targetLevel as AdvanceWorkItemLevel200ResponseAllOfData.CurrentLevelEnum,
    };
  }

  /**
   * Finalize work item refinement
   */
  @Post('finalize')
  @ApiOperation({
    summary: 'Finalize refinement',
    description: 'Complete the refinement process and mark work item as ready',
  })
  @ApiParam({ name: 'entityType', enum: ['initiative', 'task'] })
  async finalizeRefinement(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('entityType') entityTypeParam: string,
    @Param('entityId') entityId: string,
  ): Promise<FinalizeWorkItemRefinement200ResponseAllOfData> {
    const entityType = this.validateEntityType(entityTypeParam);

    // Find the work item
    const workItem = await this.findWorkItem(
      entityType,
      entityId,
      organizationId,
    );
    if (!workItem) {
      throw new NotFoundException(`${entityType} not found`);
    }

    // Check if ready for finalization
    const taskLevels =
      entityType === 'task'
        ? this.deriveTaskLevels(workItem, projectId)
        : undefined;
    const currentLevel =
      entityType === 'task'
        ? getTaskCurrentRefinementLevel(workItem.status, taskLevels!)
        : getCurrentSectionFromStatus(workItem.status);
    const canFinalize =
      entityType === 'task'
        ? canTaskFinalizeAtLevel(
            currentLevel as 'description' | 'acceptanceCriteria',
            taskLevels!,
          )
        : currentLevel === 'acceptanceCriteria';

    // The finalize level is the last level in the type's derived set:
    // 'description' for a single-level type, 'acceptanceCriteria' otherwise.
    const finalizedLevel =
      entityType === 'task' && taskLevels
        ? taskLevels[taskLevels.length - 1]
        : 'acceptanceCriteria';

    if (!canFinalize) {
      throw new BadRequestException(
        `Cannot finalize ${entityType} at ${currentLevel} level. Must be at ${finalizedLevel} level`,
      );
    }

    // Update to finalized status
    const finalizeUpdate = this.getFinalizedStatus(entityType);
    const updatedWorkItem = await this.updateWorkItem(
      entityType,
      entityId,
      finalizeUpdate,
      organizationId,
    );

    this.logger.log(`Finalized ${entityType} refinement`, {
      entityId,
      finalStatus: updatedWorkItem.status,
    });

    return {
      success: true,
      message: `${entityType} refinement finalized successfully`,
      status: 'finalized',
      entityId,
      currentLevel:
        finalizedLevel as FinalizeWorkItemRefinement200ResponseAllOfData.CurrentLevelEnum,
      metadata: {
        finalizedAt: new Date().toISOString(),
        finalStatus: updatedWorkItem.status as WorkStatus,
      },
    };
  }

  /**
   * Get refinement status and progress
   */
  @Get('status')
  @ApiOperation({
    summary: 'Get refinement status',
    description:
      'Get current refinement level, progress, and available actions',
  })
  @ApiParam({ name: 'entityType', enum: ['initiative', 'task'] })
  async getRefinementStatus(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('entityType') entityTypeParam: string,
    @Param('entityId') entityId: string,
  ) {
    const entityType = this.validateEntityType(entityTypeParam);

    // Find the work item
    const workItem = await this.findWorkItem(
      entityType,
      entityId,
      organizationId,
    );
    if (!workItem) {
      throw new NotFoundException(`${entityType} not found`);
    }

    const taskLevels =
      entityType === 'task'
        ? this.deriveTaskLevels(workItem, projectId)
        : undefined;
    const currentLevel =
      entityType === 'task'
        ? getTaskCurrentRefinementLevel(workItem.status, taskLevels!)
        : getCurrentSectionFromStatus(workItem.status);
    const nextLevel =
      entityType === 'task'
        ? getTaskNextRefinementLevel(
            currentLevel as 'description' | 'acceptanceCriteria',
            taskLevels!,
          )
        : getNextRefinementLevel(currentLevel);
    const canFinalize =
      entityType === 'task'
        ? canTaskFinalizeAtLevel(
            currentLevel as 'description' | 'acceptanceCriteria',
            taskLevels!,
          )
        : currentLevel === 'acceptanceCriteria';

    // Get refinement service for validation
    const canAdvance =
      !!nextLevel &&
      (entityType === 'initiative'
        ? this.initiativeRefinementService.canAdvanceToNextLevel(
            workItem as InitiativeRefinableEntity,
            currentLevel,
          )
        : this.taskRefinementService.canAdvanceToNextLevel(
            workItem as TaskRefinableEntity,
            currentLevel,
          ));

    return {
      entityId,
      entityType,
      currentLevel,
      nextLevel,
      status: workItem.status,
      progress: {
        currentLevel,
        nextLevel,
        progressPercentage: this.calculateProgress(
          currentLevel,
          entityType,
          taskLevels,
        ),
        canAdvance,
        canFinalize,
      },
      contentState: {
        hasDescription: !!workItem.description?.trim(),
        hasDetails: !!workItem.details?.trim(),
        hasAcceptanceCriteria: !!workItem.acceptanceCriteria?.trim(),
      },
      availableActions: [
        ...(canAdvance ? ['advance'] : []),
        ...(canFinalize ? ['finalize'] : []),
        'update_content',
        'refine_message',
      ],
    };
  }

  // Helper methods

  /**
   * Calculate progress percentage based on current level
   */
  private calculateProgress(
    level: RefinementLevel,
    entityType: EntityType,
    taskLevels?: readonly TaskRefinementLevel[],
  ): number {
    if (entityType === 'task') {
      const normalizedLevel =
        level === 'details' ? 'acceptanceCriteria' : level;
      return getTaskRefinementProgressPercentage(
        normalizedLevel as 'description' | 'acceptanceCriteria',
        taskLevels ?? CANONICAL_REFINEMENT_LEVELS,
      );
    }

    switch (level) {
      case 'description':
        return 33;
      case 'details':
        return 66;
      case 'acceptanceCriteria':
        return 100;
      default:
        return 0;
    }
  }

  /**
   * Get appropriate status update for advancing to a level
   */
  private getStatusForLevel(
    entityType: EntityType,
    level: RefinementLevel,
    taskLevels?: readonly TaskRefinementLevel[],
  ): { status: WorkStatus } {
    // This is a simplified mapping - in practice, you'd use the configuration system
    const statusMappings = {
      initiative: {
        description: { status: WorkStatus.RefiningDescription },
        details: { status: WorkStatus.RefiningDetails },
        acceptanceCriteria: {
          status: WorkStatus.RefiningAcceptanceCriteria,
        },
      },
      task: {
        description: { status: WorkStatus.RefiningDescription },
        details: { status: WorkStatus.RefiningAcceptanceCriteria },
        acceptanceCriteria: { status: WorkStatus.RefiningAcceptanceCriteria },
      },
    };

    if (
      entityType === 'task' &&
      taskLevels &&
      !taskLevels.includes('acceptanceCriteria')
    ) {
      throw new BadRequestException(
        'This task type has no next refinement level to advance to',
      );
    }

    const allowedLevels = [
      'description',
      'details',
      'acceptanceCriteria',
    ] as const;

    if (!allowedLevels.includes(level as (typeof allowedLevels)[number])) {
      throw new BadRequestException(
        `Unsupported refinement level '${level}' for ${entityType}`,
      );
    }

    return statusMappings[entityType][level as (typeof allowedLevels)[number]];
  }

  /**
   * Get finalized status for entity type
   */
  private getFinalizedStatus(entityType: EntityType): { status: WorkStatus } {
    switch (entityType) {
      case 'initiative':
        return { status: WorkStatus.Active };
      case 'task':
        return { status: WorkStatus.Active };
      default:
        throw new BadRequestException(
          `Unknown entity type: ${entityType as string}`,
        );
    }
  }
}

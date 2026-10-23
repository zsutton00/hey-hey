/**
 * Staged Content Service
 *
 * Main orchestration service for the staged content framework.
 * Routes operations to existing services based on content type and implementation strategy.
 * Preserves all existing functionality while providing generic interface.
 */

import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { TaskRefinableEntity } from 'src/types/task-refinement-adapter.types';
import { DesignDocStagedContentAdapter } from '../../adapters/staged-content/design-doc.adapter';
import { WorkItemStagedContentAdapter } from '../../adapters/staged-content/work-item.adapter';
import {
  AdrStatus,
  StageOperationResult,
  WorkflowName,
  WorkStatus,
} from '../../generated';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowAboutType,
  WorkflowId,
} from '../../types';
import { RefinementLevel } from '../../types/refinable-entity.types';
import {
  ContentTypeDefinition,
  ContentTypeId,
  StageAction,
  StagedContentEntity,
  StageDefinition,
  StageOperation,
  ValidationError,
} from '../../types/staged-content.types';
import { StagedDesignDoc } from '../../types/staged-design-doc.types';
import { ConversationService } from '../conversation.service';
import { InitiativeRefinementService } from '../initiatives/initiative-refinement.service';
import { TaskRefinementService } from '../tasks/task-refinement.service';
import { TaskOptimizationService } from '../tasks/task-optimization.service';
import {
  InitiativeChangeDetection,
  InitiativeOptimizationService,
} from '../initiatives/initiative-optimization.service';
import { WorkflowRouterService } from '../workflows/workflow-router.service';
import { WorkflowTypeRegistryService } from '../workflows/workflow-type-registry.service';
import { ContentTypeRegistryService } from './content-type-registry.service';
import {
  ADR_REFINEMENT_NODES,
  INITIATIVE_REFINEMENT_NODES,
  TASK_REFINEMENT_NODES,
} from '../../flows/constants/node-ids';
import {
  getGeneratingStatusForSection,
  getNextSection,
} from '../../utils/work-item.util';
import { errorToLoggable } from 'src/utils/logging.util';
import { ConversationWorkflowError } from 'src/core/exceptions/workflow.exceptions';

type WorkItemEntity = StagedContentEntity & {
  entityType?: 'initiative' | 'task';
  name?: string;
  description?: string;
  details?: string;
  acceptanceCriteria?: string;
  priority?: string;
  assigneeId?: string;
  currentStage: string;
};

@Injectable()
export class StagedContentService {
  private readonly logger = new Logger(StagedContentService.name);
  private readonly advancedDebugPrefix = 'advanced_debug';

  constructor(
    private readonly contentTypeRegistry: ContentTypeRegistryService,
    private readonly designDocAdapter: DesignDocStagedContentAdapter,
    private readonly workItemAdapter: WorkItemStagedContentAdapter,
    private readonly taskRefinementService: TaskRefinementService,
    private readonly taskOptimizationService: TaskOptimizationService,
    private readonly initiativeRefinementService: InitiativeRefinementService,
    private readonly initiativeOptimizationService: InitiativeOptimizationService,
    private readonly conversationService: ConversationService,
    private readonly workflowRouterService: WorkflowRouterService,
    private readonly workflowTypeRegistryService: WorkflowTypeRegistryService,
  ) {}

  private toIsoString(value: Date | string): string {
    if (value instanceof Date) {
      return value.toISOString();
    }

    return value;
  }

  private logAdvancedDebug(
    step: string,
    metadata: Record<string, unknown>,
  ): void {
    this.logger.debug(`${this.advancedDebugPrefix} ${step}`, metadata);
  }

  /**
   * Process a stage operation
   * Routes to appropriate implementation based on content type
   */
  async processStageOperation(
    operation: StageOperation,
  ): Promise<StageOperationResult> {
    this.logger.log(
      `Processing ${operation.operationType} operation for ${operation.contentTypeId}:${operation.entityId}`,
    );

    const contentType = this.contentTypeRegistry.get(operation.contentTypeId);

    try {
      switch (operation.contentTypeId) {
        case 'work-item':
          return this.processWorkItemOperation(operation, contentType);
        case 'adr':
        case 'brainstorm':
        case 'decision':
          return this.processDesignDocOperation(operation, contentType);
        case 'initiative':
          return this.processInitiativeOperation(operation, contentType);
        default:
          throw new Error(
            `Unsupported content type: ${operation.contentTypeId as string}`,
          );
      }
    } catch (error) {
      this.logger.error(
        `Failed to process operation for ${operation.contentTypeId}:${operation.entityId}`,
        error,
      );
      throw error;
    }
  }

  /**
   * Process operation for work items
   * Delegates to work item refinement services for workflow orchestration
   */
  private async processWorkItemOperation(
    operation: StageOperation,
    contentType: ContentTypeDefinition,
  ): Promise<StageOperationResult> {
    const { entityId, organizationId, projectId } = operation;
    const planId = operation.metadata?.planId;

    let entity = (await this.workItemAdapter.findEntity(
      entityId,
      organizationId,
    )) as WorkItemEntity | null;

    if (!entity) {
      throw new NotFoundException(
        `Work item ${entityId} not found in organization ${organizationId}`,
      );
    }

    const entityType = this.resolveWorkItemEntityType(contentType, entity);

    switch (operation.operationType) {
      case 'refine': {
        const refinementService = this.getWorkItemRefinementService(entityType);
        const sessionContext = await this.ensureWorkItemRefinementSession(
          refinementService,
          entity,
          entityType,
          organizationId,
          projectId,
          planId,
        );

        entity = await this.reloadWorkItemEntity(
          entityId,
          organizationId,
          entityType,
        );

        const currentStage = this.getStageDefinition(
          contentType,
          entity.currentStage,
        );
        const progress = await this.computeWorkItemProgress(
          entity,
          contentType,
        );
        const actions = this.buildWorkItemActions(currentStage);

        return {
          success: true,
          message: 'Refinement request acknowledged',
          entity: entity as StagedContentEntity,
          newStage: currentStage.id,
          progress,
          actions,
          conversationId: sessionContext.conversationId,
          workflowId: sessionContext.workflowId,
          timestamp: new Date().toISOString(),
        };
      }

      case 'advance': {
        const currentStage = this.getStageDefinition(
          contentType,
          entity.currentStage,
        );
        const targetStageId =
          operation.payload?.targetStage || currentStage.nextStages[0];

        if (!targetStageId) {
          throw new BadRequestException(
            `Stage '${currentStage.id}' does not have a configured next stage`,
          );
        }

        const targetStage = this.getStageDefinition(contentType, targetStageId);

        this.logAdvancedDebug('work_item.advance.routing_context', {
          entityId,
          organizationId,
          projectId,
          entityType,
          currentStage: currentStage.id,
          targetStage: targetStage.id,
          skipValidation: Boolean(operation.payload?.validationOverride),
        });

        let validationErrors: ValidationError[] = [];
        if (this.workItemAdapter.validateStageTransition) {
          validationErrors = await this.workItemAdapter.validateStageTransition(
            entity,
            currentStage.id,
            targetStage.id,
          );
        }
        this.logAdvancedDebug('work_item.advance.stage_validation_result', {
          entityId,
          currentStage: currentStage.id,
          targetStage: targetStage.id,
          validationErrorCount: validationErrors.length,
          validationErrors: validationErrors.map((error) => error.message),
        });

        const skipValidation = Boolean(operation.payload?.validationOverride);
        this.logAdvancedDebug('work_item.advance.skip_validation_flag', {
          entityId,
          skipValidation,
        });

        if (validationErrors.length > 0 && !skipValidation) {
          const errorMessages = this.formatValidationMessages(validationErrors);
          throw new BadRequestException(
            `Cannot advance to ${targetStage.displayName}: ${errorMessages}`,
          );
        }

        if (
          !skipValidation &&
          this.workItemAdapter.canAdvanceToStage &&
          !(await this.workItemAdapter.canAdvanceToStage(
            entity,
            currentStage,
            targetStage,
          ))
        ) {
          throw new BadRequestException(
            `Cannot advance to ${targetStage.displayName}. Current stage requirements are not met`,
          );
        }

        const refinementService = this.getWorkItemRefinementService(entityType);
        const refinableEntity = await refinementService.findOne(
          entityId,
          organizationId,
        );

        if (!refinableEntity) {
          throw new NotFoundException(
            `${entityType} ${entityId} not found in organization ${organizationId}`,
          );
        }

        if (!skipValidation) {
          const canAdvance = refinementService.canAdvanceToNextLevel(
            refinableEntity as TaskRefinableEntity,
            currentStage.id as RefinementLevel,
          );
          this.logAdvancedDebug('work_item.advance.can_advance_check', {
            entityId,
            currentStage: currentStage.id,
            targetStage: targetStage.id,
            canAdvance,
          });

          if (!canAdvance) {
            throw new BadRequestException(
              `Cannot advance to ${targetStage.displayName}. Current stage requirements are not met`,
            );
          }
        }

        const statusMapping = contentType.entitySchema?.statusMapping || {};
        const targetStatus = statusMapping[targetStage.id];

        if (!targetStatus) {
          throw new BadRequestException(
            `No status mapping defined for stage '${targetStage.id}' in content type '${contentType.id}'`,
          );
        }

        const routingDecision = await this.decideWorkItemRouting(
          entity,
          entityType,
          targetStage.id,
          organizationId,
        );

        this.logAdvancedDebug('work_item.advance.routing_decision', {
          entityId,
          organizationId,
          entityType,
          targetStage: targetStage.id,
          targetNode: routingDecision.targetNode,
          shouldSkipGeneration: routingDecision.shouldSkipGeneration,
          needsInitialGeneration: routingDecision.needsInitialGeneration,
        });

        const sessionContext = await this.ensureWorkItemRefinementSession(
          refinementService,
          entity,
          entityType,
          organizationId,
          projectId,
        );

        const generatingStatus = routingDecision.shouldSkipGeneration
          ? undefined
          : this.getWorkItemGeneratingStatus(entityType, targetStage.id);

        const statusToApply = (generatingStatus || targetStatus) as WorkStatus;
        this.logAdvancedDebug('work_item.advance.status_resolution', {
          entityId,
          targetStage: targetStage.id,
          targetStatus,
          generatingStatus,
          resolvedStatus: statusToApply,
          shouldSkipGeneration: routingDecision.shouldSkipGeneration,
        });

        await this.workItemAdapter.updateEntity(
          entityId,
          { status: statusToApply },
          organizationId,
          entityType,
        );
        this.logAdvancedDebug('work_item.advance.entity_status_updated', {
          entityId,
          statusApplied: statusToApply,
        });

        entity = await this.reloadWorkItemEntity(
          entityId,
          organizationId,
          entityType,
        );

        if (
          sessionContext.workflowId &&
          !routingDecision.shouldSkipGeneration
        ) {
          this.logAdvancedDebug('work_item.advance.workflow_skip_to_node', {
            entityId,
            workflowId: sessionContext.workflowId,
            targetNode: routingDecision.targetNode,
          });
          await this.workflowRouterService.sendSkipToNode(
            sessionContext.workflowId,
            routingDecision.targetNode,
          );
        } else {
          this.logAdvancedDebug('work_item.advance.workflow_skip_not_sent', {
            entityId,
            workflowId: sessionContext.workflowId,
            shouldSkipGeneration: routingDecision.shouldSkipGeneration,
          });
        }

        const progress = await this.computeWorkItemProgress(
          entity,
          contentType,
        );
        const actions = this.buildWorkItemActions(
          this.getStageDefinition(contentType, entity.currentStage),
        );

        const normalizedErrors =
          validationErrors.length > 0 ? validationErrors : undefined;

        return {
          success: true,
          message: routingDecision.shouldSkipGeneration
            ? `Advanced to ${targetStage.displayName} without regeneration`
            : `Generating ${targetStage.displayName} content`,
          entity: entity as StagedContentEntity,
          newStage: entity.currentStage,
          progress,
          actions,
          errors: normalizedErrors,
          warnings:
            skipValidation && validationErrors.length > 0
              ? validationErrors.map((error) => error.message)
              : undefined,
          validationErrors: normalizedErrors,
          timestamp: new Date().toISOString(),
          conversationId: sessionContext.conversationId,
          workflowId: sessionContext.workflowId,
        };
      }

      case 'finalize': {
        const currentStage = this.getStageDefinition(
          contentType,
          entity.currentStage,
        );

        if (!currentStage.isTerminal && currentStage.nextStages.length > 0) {
          throw new BadRequestException(
            `Cannot finalize work item while in non-terminal stage '${currentStage.id}'`,
          );
        }

        const finalizedStatus = this.getFinalizedWorkItemStatus(entityType);

        await this.workItemAdapter.updateEntity(
          entityId,
          { status: finalizedStatus },
          organizationId,
          entityType,
        );

        entity = await this.reloadWorkItemEntity(
          entityId,
          organizationId,
          entityType,
        );

        const progress = await this.computeWorkItemProgress(
          entity,
          contentType,
        );
        const actions = this.buildWorkItemActions(
          this.getStageDefinition(contentType, entity.currentStage),
        );

        return {
          success: true,
          message: 'Work item refinement finalized',
          entity: entity as StagedContentEntity,
          newStage: entity.currentStage,
          progress,
          actions,
          timestamp: new Date().toISOString(),
        };
      }

      default:
        throw new Error(
          `Unsupported operation type: ${operation.operationType as string}`,
        );
    }
  }

  /**
   * Process operation for initiatives
   * Routes to InitiativeRefinementController for sophisticated features
   */
  private async processInitiativeOperation(
    operation: StageOperation,
    contentType: ContentTypeDefinition,
  ): Promise<StageOperationResult> {
    switch (operation.operationType) {
      case 'refine':
        // Route to initiative refinement with message classification
        return this.processInitiativeRefinementOperation(
          operation,
          contentType,
        );

      default:
        throw new Error('Initiative operation not yet implemented');
    }
  }

  private getWorkItemRefinementService(
    entityType: 'initiative' | 'task',
  ): TaskRefinementService | InitiativeRefinementService {
    return entityType === 'initiative'
      ? this.initiativeRefinementService
      : this.taskRefinementService;
  }

  private async ensureWorkItemRefinementSession(
    refinementService: TaskRefinementService | InitiativeRefinementService,
    entity: WorkItemEntity,
    entityType: 'initiative' | 'task',
    organizationId: OrganizationId,
    projectId?: ProjectId,
    planId?: string,
  ): Promise<{ conversationId?: ConversationId; workflowId?: WorkflowId }> {
    let conversationId =
      (await refinementService.getActiveRefinementConversation(
        entity.id as InitiativeId,
        organizationId,
      )) || undefined;

    let conversationRecord =
      conversationId &&
      (await this.conversationService.getConversation(
        conversationId as ConversationId,
        organizationId,
      ));

    if (!conversationRecord) {
      conversationId = undefined;
    }

    if (!conversationId) {
      const resolvedProjectId = projectId || entity.projectId;

      if (!resolvedProjectId) {
        throw new BadRequestException(
          'Project context is required to start refinement for this work item',
        );
      }

      const sessionResult =
        await refinementService.createRefinementConversation(
          entity.id,
          entityType,
          organizationId,
          resolvedProjectId,
          planId,
        );

      conversationRecord = sessionResult.conversation;
      conversationId = conversationRecord.id;
    }

    if (!conversationRecord) {
      conversationRecord = await this.conversationService.getConversation(
        conversationId as ConversationId,
        organizationId,
      );
    }

    if (!conversationRecord) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found for organization ${organizationId}`,
      );
    }

    if (
      !conversationRecord.workflowAboutId ||
      !conversationRecord.workflowAboutType
    ) {
      throw new ConversationWorkflowError(
        `Conversation request missing workflowAbout field(s) ${JSON.stringify({
          workflowAboutId: conversationRecord.workflowAboutId,
          workflowAboutType: conversationRecord.workflowAboutType,
        })}`,
      );
    }

    let workflowId = conversationRecord.workflowId;

    if (
      workflowId &&
      !(await this.workflowRouterService.isWorkflowRunning(workflowId))
    ) {
      workflowId = undefined;
    }

    if (!workflowId) {
      const workflowName = conversationRecord.workflowName
        ? this.workflowTypeRegistryService.validateWorkflowName(
            conversationRecord.workflowName,
          )
        : undefined;

      if (!workflowName) {
        throw new BadRequestException(
          'Conversation has no associated workflow definition',
        );
      }

      const workflowProjectId =
        conversationRecord.projectId || entity.projectId || projectId;

      if (!workflowProjectId) {
        throw new BadRequestException(
          'Cannot determine project context for work item workflow',
        );
      }

      const workflowResult =
        await this.workflowTypeRegistryService.startWorkflowByType(
          workflowName,
          conversationRecord.id,
          workflowProjectId,
          organizationId,
          'system' as UserId,
          conversationRecord.title,
          conversationRecord.workflowAboutType as WorkflowAboutType,
          conversationRecord.workflowAboutId,
        );

      workflowId = workflowResult.workflowId as WorkflowId;

      conversationRecord =
        await this.conversationService.updateConversationWorkflowId(
          conversationRecord.id,
          workflowId,
          organizationId,
        );
      if (!conversationRecord) {
        throw new NotFoundException(
          `Conversation ${conversationId} not found for organization ${organizationId}`,
        );
      }
    }

    return {
      conversationId: conversationRecord.id,
      workflowId,
    };
  }

  /**
   * Process operation for design documents
   * Routes to DesignDocStagedContentAdapter
   */
  private async processDesignDocOperation(
    operation: StageOperation,
    contentType: ContentTypeDefinition,
  ): Promise<StageOperationResult> {
    switch (operation.operationType) {
      case 'advance':
        return this.advanceDesignDoc(operation, contentType);
      case 'refine':
        return this.refineDesignDoc(operation, contentType);
      default:
        throw new Error(
          `Design document operation '${operation.operationType}' not yet implemented`,
        );
    }
  }

  private async advanceDesignDoc(
    operation: StageOperation,
    contentType: ContentTypeDefinition,
  ): Promise<StageOperationResult> {
    const { entityId, organizationId, projectId } = operation;

    this.logAdvancedDebug('design_doc.advance.start', {
      entityId,
      organizationId,
      targetStage: operation.payload?.targetStage,
    });

    const entity = await this.designDocAdapter.findEntity(
      entityId,
      organizationId,
    );
    if (!entity) {
      throw new NotFoundException(
        `Design document ${entityId} not found in organization ${organizationId}`,
      );
    }

    const currentStage = this.getStageDefinition(
      contentType,
      entity.currentStage,
    );

    const nextStageId =
      operation.payload?.targetStage || currentStage.nextStages[0];

    if (!nextStageId) {
      throw new BadRequestException(
        `Stage '${currentStage.id}' does not have a configured next stage`,
      );
    }

    const targetStage = this.getStageDefinition(contentType, nextStageId);

    const validationErrors = await this.designDocAdapter.validateStageContent(
      entityId,
      currentStage.id,
      organizationId,
    );
    this.logAdvancedDebug('design_doc.advance.stage_validation_result', {
      entityId,
      currentStage: currentStage.id,
      requestedTargetStage: nextStageId,
      validationErrorCount: validationErrors.length,
      validationErrors: validationErrors.map((error) => error.message),
    });

    const skipValidation = Boolean(operation.payload?.validationOverride);
    this.logAdvancedDebug('design_doc.advance.skip_validation_flag', {
      entityId,
      skipValidation,
    });
    if (validationErrors.length && !skipValidation) {
      const errorMessages = validationErrors
        .map((error) => error.message)
        .join('; ');
      throw new BadRequestException(
        `Cannot advance from ${currentStage.displayName} due to validation errors: ${errorMessages}`,
      );
    }

    const statusMapping = contentType.entitySchema.statusMapping || {};
    const targetStatus = statusMapping[targetStage.id];
    if (!targetStatus) {
      throw new BadRequestException(
        `No status mapping defined for stage '${targetStage.id}' in content type '${contentType.id}'`,
      );
    }

    const requiresWorkflow = this.shouldTriggerDesignDocWorkflow(
      entity,
      targetStage,
    );
    this.logAdvancedDebug('design_doc.advance.workflow_requirement', {
      entityId,
      targetStage: targetStage.id,
      requiresWorkflow,
      stageContentFields: targetStage.contentFields ?? [],
    });

    const generatingStatus = requiresWorkflow
      ? this.getGeneratingDesignDocStatus(targetStage.id)
      : undefined;

    if (requiresWorkflow && !generatingStatus) {
      this.logger.warn(
        `Generating status not configured for stage '${targetStage.id}'`,
      );
    }

    const statusToApply = generatingStatus ?? targetStatus;
    this.logAdvancedDebug('design_doc.advance.status_resolution', {
      entityId,
      targetStage: targetStage.id,
      targetStatus,
      generatingStatus,
      resolvedStatus: statusToApply,
    });

    const updatedEntity = await this.designDocAdapter.updateEntity(
      entityId,
      {
        status: statusToApply,
      },
      organizationId,
    );

    let workflowMetadata: {
      conversationId?: ConversationId;
      workflowId?: WorkflowId;
    } = {};

    if (requiresWorkflow) {
      workflowMetadata = await this.triggerDesignDocWorkflow(
        updatedEntity,
        organizationId,
        projectId,
        targetStage,
      );
      this.logAdvancedDebug('design_doc.advance.workflow_triggered', {
        entityId,
        conversationId: workflowMetadata.conversationId,
        workflowId: workflowMetadata.workflowId,
      });
    } else {
      this.logAdvancedDebug('design_doc.advance.workflow_skipped', {
        entityId,
        targetStage: targetStage.id,
      });
    }

    const progress = this.calculateStageProgress(targetStage, contentType);
    const actions = this.buildDesignDocActions(targetStage);
    const normalizedErrors =
      validationErrors.length > 0 ? validationErrors : undefined;

    return {
      success: true,
      message: `Advanced to ${targetStage.displayName}`,
      entity: updatedEntity as StagedContentEntity,
      newStage: targetStage.id,
      progress,
      actions,
      errors: normalizedErrors,
      warnings:
        skipValidation && validationErrors.length > 0
          ? validationErrors.map((error) => error.message)
          : undefined,
      validationErrors: normalizedErrors,
      timestamp: new Date().toISOString(),
      conversationId: workflowMetadata.conversationId,
      workflowId: workflowMetadata.workflowId,
    };
  }

  private async refineDesignDoc(
    operation: StageOperation,
    contentType: ContentTypeDefinition,
  ): Promise<StageOperationResult> {
    const { entityId, organizationId, projectId } = operation;
    const planId = operation.metadata?.planId;

    this.logger.log('Processing design document refinement request', {
      entityId,
      organizationId,
      projectId,
    });

    const entity = await this.designDocAdapter.findEntity(
      entityId,
      organizationId,
    );
    if (!entity) {
      throw new NotFoundException(
        `Design document ${entityId} not found in organization ${organizationId}`,
      );
    }

    const currentStage = this.getStageDefinition(
      contentType,
      entity.currentStage,
    );

    const conversationId = await this.ensureDesignDocConversation(
      entity,
      organizationId,
      projectId,
      planId,
    );

    let conversationRecord = await this.conversationService.getConversation(
      conversationId as ConversationId,
      organizationId,
    );

    if (!conversationRecord) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found for organization ${organizationId}`,
      );
    }

    const conversationWorkflowName = conversationRecord.workflowName
      ? this.workflowTypeRegistryService.validateWorkflowName(
          conversationRecord.workflowName,
        )
      : WorkflowName.Adr;

    const workflowProjectId =
      (conversationRecord.projectId || entity.projectId || projectId) ??
      undefined;

    if (!workflowProjectId) {
      throw new BadRequestException(
        'Cannot determine project context for design document workflow',
      );
    }

    const projectContext = workflowProjectId;

    let workflowId = conversationRecord.workflowId;

    if (
      !workflowId ||
      !(await this.workflowRouterService.isWorkflowRunning(workflowId))
    ) {
      this.logger.log('Starting design document workflow', {
        conversationId: conversationRecord.id,
        workflowName: conversationWorkflowName,
      });

      const workflowResult =
        await this.workflowTypeRegistryService.startWorkflowByType(
          conversationWorkflowName,
          conversationRecord.id,
          projectContext,
          organizationId,
          'system' as UserId,
          conversationRecord.title,
          conversationRecord.workflowAboutType as WorkflowAboutType,
          conversationRecord.workflowAboutId as string,
        );

      workflowId = workflowResult.workflowId as WorkflowId;
      conversationRecord =
        await this.conversationService.updateConversationWorkflowId(
          conversationRecord.id,
          workflowId,
          organizationId,
        );
      if (!conversationRecord) {
        throw new NotFoundException(
          `Conversation ${conversationId} not found for organization ${organizationId}`,
        );
      }
    }

    const progress = this.calculateStageProgress(currentStage, contentType);
    const actions = this.buildDesignDocActions(currentStage);

    return {
      success: true,
      message: 'Refinement request acknowledged',
      entity,
      newStage: currentStage.id,
      progress,
      actions,
      conversationId: conversationRecord.id,
      workflowId: workflowId ?? undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private async ensureDesignDocConversation(
    entity: StagedDesignDoc,
    organizationId: OrganizationId,
    projectId?: ProjectId,
    planId?: string,
  ): Promise<string> {
    const resolvedProjectId = entity.projectId || projectId;

    if (!resolvedProjectId) {
      throw new BadRequestException(
        'Cannot start refinement without a project context for the design document',
      );
    }

    const existing = await this.designDocAdapter.findActiveConversation(
      entity.id,
      organizationId,
      resolvedProjectId,
    );
    if (existing) {
      return existing.id;
    }

    try {
      const created = await this.designDocAdapter.createConversation(
        entity.id,
        organizationId,
        resolvedProjectId,
        planId,
      );
      return created.id;
    } catch (error) {
      this.logger.error('Failed to create design document conversation', {
        entityId: entity.id,
        organizationId,
        error: error instanceof Error ? error.message : errorToLoggable(error),
      });
      throw new BadRequestException(
        'Unable to establish refinement conversation for the design document',
      );
    }
  }

  private getStageDefinition(
    contentType: ContentTypeDefinition,
    stageId: string,
  ): StageDefinition {
    const stage = contentType.stages.find(
      (definition) => definition.id === stageId,
    );
    if (!stage) {
      throw new BadRequestException(
        `Stage '${stageId}' not found for content type '${contentType.id}'`,
      );
    }
    return stage;
  }

  private calculateStageProgress(
    stage: StageDefinition,
    contentType: ContentTypeDefinition,
  ): number {
    const totalStages = contentType.stages.length || 1;
    return Math.round((stage.order / totalStages) * 100);
  }

  private getGeneratingDesignDocStatus(stageId: string): AdrStatus | undefined {
    switch (stageId) {
      case 'decision':
        return AdrStatus.AdrGeneratingDecision;
      case 'consequences':
        return AdrStatus.AdrGeneratingConsequences;
      default:
        return undefined;
    }
  }

  private isGeneratingDesignDocStatus(status?: AdrStatus): boolean {
    if (!status) {
      return false;
    }

    return (
      status === AdrStatus.AdrGeneratingDecision ||
      status === AdrStatus.AdrGeneratingConsequences
    );
  }

  private shouldTriggerDesignDocWorkflow(
    entity: StagedDesignDoc,
    stage: StageDefinition,
  ): boolean {
    if (!stage.contentFields || stage.contentFields.length === 0) {
      return false;
    }

    return stage.contentFields.some((field) => {
      const value = (entity as Record<string, unknown>)[field];
      if (typeof value !== 'string' || value.trim().length === 0) {
        return true;
      }

      const minRule = stage.validationRules?.find(
        (rule) => rule.field === field && rule.type === 'min_length',
      );

      return Boolean(
        minRule && typeof minRule.minLength === 'number'
          ? value.trim().length < minRule.minLength
          : false,
      );
    });
  }

  private buildDesignDocActions(stage: StageDefinition): StageAction[] {
    const actions: StageAction[] = [
      {
        type: 'content_update',
        label: 'Update Content',
        description: `Update ${stage.displayName.toLowerCase()} content`,
        enabled: true,
        requiresInput: true,
        validationRequired: false,
      },
    ];

    if (!stage.isTerminal && stage.nextStages.length > 0) {
      actions.push({
        type: 'advance',
        label: 'Advance to Next Stage',
        description: `Move to ${stage.nextStages[0]} stage`,
        enabled: true,
        requiresInput: false,
        validationRequired: true,
      });
    }

    actions.push({
      type: 'refine',
      label: 'AI Refinement',
      description: 'Request AI assistance for the current stage',
      enabled: true,
      requiresInput: true,
      validationRequired: false,
    });

    if (stage.isTerminal || stage.nextStages.length === 0) {
      actions.push({
        type: 'finalize',
        label: 'Finalize',
        description: 'Complete the design document',
        enabled: true,
        requiresInput: false,
        validationRequired: true,
      });
    }

    return actions;
  }

  private resolveDesignDocWorkflowNode(
    stage: StageDefinition,
    entity?: StagedDesignDoc,
  ): string {
    if (
      entity &&
      this.isGeneratingDesignDocStatus(entity.status as AdrStatus | undefined)
    ) {
      return ADR_REFINEMENT_NODES.AGENT_NEXT_LEVEL;
    }

    return stage.workflowNodeId || ADR_REFINEMENT_NODES.AGENT_ANALYSIS;
  }

  private async triggerDesignDocWorkflow(
    entity: StagedDesignDoc,
    organizationId: OrganizationId,
    projectId: ProjectId,
    targetStage: StageDefinition,
  ): Promise<{ conversationId: ConversationId; workflowId: WorkflowId }> {
    const conversationId = await this.ensureDesignDocConversation(
      entity,
      organizationId,
      projectId,
    );

    let conversationRecord = await this.conversationService.getConversation(
      conversationId as ConversationId,
      organizationId,
    );

    if (!conversationRecord) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found for organization ${organizationId}`,
      );
    }

    if (
      !conversationRecord.workflowAboutId ||
      !conversationRecord.workflowAboutType
    ) {
      throw new ConversationWorkflowError(
        `Conversation request missing workflowAbout field(s) ${JSON.stringify({
          workflowAboutId: conversationRecord.workflowAboutId,
          workflowAboutType: conversationRecord.workflowAboutType,
        })}`,
      );
    }

    const conversationWorkflowName = conversationRecord.workflowName
      ? this.workflowTypeRegistryService.validateWorkflowName(
          conversationRecord.workflowName,
        )
      : WorkflowName.Adr;

    const workflowProjectId =
      (conversationRecord.projectId || entity.projectId || projectId) ??
      undefined;

    if (!workflowProjectId) {
      throw new InternalServerErrorException(
        'Cannot determine project context for design document workflow',
      );
    }

    let workflowId = conversationRecord.workflowId;

    if (
      !workflowId ||
      !(await this.workflowRouterService.isWorkflowRunning(workflowId))
    ) {
      const workflowResult =
        await this.workflowTypeRegistryService.startWorkflowByType(
          conversationWorkflowName,
          conversationRecord.id,
          workflowProjectId,
          organizationId,
          'system' as UserId,
          conversationRecord.title,
          conversationRecord.workflowAboutType as WorkflowAboutType,
          conversationRecord.workflowAboutId,
        );

      workflowId = workflowResult.workflowId as WorkflowId;

      conversationRecord =
        await this.conversationService.updateConversationWorkflowId(
          conversationRecord.id,
          workflowId,
          organizationId,
        );
      if (!conversationRecord) {
        throw new NotFoundException(
          `Conversation ${conversationId} not found for organization ${organizationId}`,
        );
      }
    }

    const workflowNodeId = this.resolveDesignDocWorkflowNode(
      targetStage,
      entity,
    );

    if (!workflowNodeId) {
      throw new InternalServerErrorException(
        'Cannot determine next workflow node ID',
      );
    }

    await this.workflowRouterService.sendSkipToNode(workflowId, workflowNodeId);

    return {
      conversationId: conversationRecord.id,
      workflowId: workflowId,
    };
  }

  /**
   * Process initiative refinement operation with sophisticated features
   */
  private async processInitiativeRefinementOperation(
    operation: StageOperation,
    contentType: ContentTypeDefinition,
  ): Promise<StageOperationResult> {
    const { entityId, organizationId, projectId } = operation;

    let entity = (await this.workItemAdapter.findEntity(
      entityId,
      organizationId,
      'initiative',
    )) as WorkItemEntity | null;

    if (!entity) {
      throw new NotFoundException(
        `Initiative ${entityId} not found in organization ${organizationId}`,
      );
    }

    const sessionContext = await this.ensureWorkItemRefinementSession(
      this.initiativeRefinementService,
      entity,
      'initiative',
      organizationId,
      projectId,
    );

    if (!sessionContext.conversationId) {
      throw new ConversationWorkflowError(
        'Initiative refinement session missing conversation ID',
        {
          workflowAboutType: 'initiative',
        },
      );
    }

    let conversationRecord = await this.conversationService.getConversation(
      sessionContext.conversationId,
      organizationId,
    );

    if (!conversationRecord) {
      throw new NotFoundException(
        `Conversation ${sessionContext.conversationId} not found for organization ${organizationId}`,
      );
    }

    const conversationWorkflowName = conversationRecord.workflowName
      ? this.workflowTypeRegistryService.validateWorkflowName(
          conversationRecord.workflowName,
        )
      : WorkflowName.InitiativeRefinement;

    const workflowProjectId =
      (conversationRecord.projectId || entity.projectId || projectId) ??
      undefined;

    if (!workflowProjectId) {
      throw new BadRequestException(
        'Cannot determine project context for initiative refinement workflow',
      );
    }

    let workflowId = conversationRecord.workflowId as WorkflowId | undefined;

    if (
      !workflowId ||
      !(await this.workflowRouterService.isWorkflowRunning(workflowId))
    ) {
      const workflowResult =
        await this.workflowTypeRegistryService.startWorkflowByType(
          conversationWorkflowName,
          conversationRecord.id,
          workflowProjectId,
          organizationId,
          'system' as UserId,
          conversationRecord.title,
          conversationRecord.workflowAboutType as WorkflowAboutType,
          conversationRecord.workflowAboutId as string,
        );

      workflowId = workflowResult.workflowId as WorkflowId;

      conversationRecord =
        await this.conversationService.updateConversationWorkflowId(
          conversationRecord.id,
          workflowId,
          organizationId,
        );
      if (!conversationRecord) {
        throw new NotFoundException(
          `Conversation ${sessionContext.conversationId} not found for organization ${organizationId}`,
        );
      }
    }

    entity = await this.reloadWorkItemEntity(
      entityId,
      organizationId,
      'initiative',
    );

    const currentStage = this.getStageDefinition(
      contentType,
      entity.currentStage,
    );
    const progress = await this.computeWorkItemProgress(entity, contentType);
    const actions = this.buildWorkItemActions(currentStage);

    return {
      success: true,
      message: 'Refinement request acknowledged',
      entity: entity as StagedContentEntity,
      newStage: currentStage.id,
      progress,
      actions,
      conversationId: conversationRecord.id,
      workflowId: workflowId ?? undefined,
      timestamp: new Date().toISOString(),
    };
  }

  private async decideWorkItemRouting(
    entity: WorkItemEntity,
    entityType: 'initiative' | 'task',
    targetStageId: string,
    organizationId: OrganizationId,
  ): Promise<{
    targetNode: string;
    shouldSkipGeneration: boolean;
    needsInitialGeneration: boolean;
  }> {
    const targetLevel = this.mapStageIdToLevel(targetStageId);

    this.logAdvancedDebug('work_item.routing.start', {
      entityId: entity.id,
      entityType,
      targetStageId,
      targetLevel,
      organizationId,
    });

    if (entityType === 'task') {
      return this.decideTaskRouting(entity, targetLevel, organizationId);
    }

    return this.decideInitiativeRouting(
      entity,
      targetLevel,
      organizationId,
      targetStageId,
    );
  }

  private mapStageIdToLevel(
    stageId: string,
  ): 'description' | 'details' | 'acceptanceCriteria' {
    switch (stageId) {
      case 'description':
        return 'description';
      case 'details':
        return 'details';
      case 'acceptanceCriteria':
        return 'acceptanceCriteria';
      default:
        throw new BadRequestException(
          `Unsupported stage id '${stageId}' for work item routing`,
        );
    }
  }

  private needsInitialGeneration(
    entity: WorkItemEntity,
    level: 'description' | 'details' | 'acceptanceCriteria',
  ): boolean {
    const value = (entity as Record<string, unknown>)[level];
    return !value || (typeof value === 'string' && value.trim().length === 0);
  }

  private async decideTaskRouting(
    entity: WorkItemEntity,
    targetLevel: 'description' | 'details' | 'acceptanceCriteria',
    organizationId: OrganizationId,
  ): Promise<{
    targetNode: string;
    shouldSkipGeneration: boolean;
    needsInitialGeneration: boolean;
  }> {
    if (this.needsInitialGeneration(entity, targetLevel)) {
      this.logAdvancedDebug('task.routing.initial_generation_required', {
        entityId: entity.id,
        targetLevel,
        organizationId,
      });
      return {
        targetNode: TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        shouldSkipGeneration: false,
        needsInitialGeneration: true,
      };
    }

    try {
      this.logAdvancedDebug('task.routing.detect_changes.start', {
        entityId: entity.id,
        targetLevel,
        organizationId,
      });
      const optimizationResult =
        await this.taskOptimizationService.detectChanges(
          entity.id,
          organizationId,
        );

      this.logAdvancedDebug('task.routing.detect_changes.result', {
        entityId: entity.id,
        hasChanges: optimizationResult.hasChanges,
        changeType: optimizationResult.changeType,
        confidenceScore: optimizationResult.confidenceScore,
        affectedFields: optimizationResult.affectedFields,
        changesSummary: optimizationResult.changesSummary,
      });

      const optimizationContext =
        await this.taskOptimizationService.generateOptimizationContext(
          optimizationResult,
        );

      this.logAdvancedDebug('task.routing.optimization_context', {
        entityId: entity.id,
        shouldSkipLlm: optimizationContext.shouldSkipLlm,
        processingRecommendation: optimizationContext.processingRecommendation,
        estimatedProcessingTime: optimizationContext.estimatedProcessingTime,
        optimizationHints: optimizationContext.optimizationHints,
      });

      if (optimizationContext.shouldSkipLlm) {
        return {
          targetNode: TASK_REFINEMENT_NODES.AGENT_EDITOR,
          shouldSkipGeneration: true,
          needsInitialGeneration: false,
        };
      }

      return {
        targetNode: TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        shouldSkipGeneration: false,
        needsInitialGeneration: false,
      };
    } catch (error) {
      this.logger.error(
        'Error during task routing decision, defaulting to generation',
        {
          entityId: entity.id,
          targetLevel,
          organizationId,
          error:
            error instanceof Error ? error.message : errorToLoggable(error),
        },
      );

      return {
        targetNode: TASK_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        shouldSkipGeneration: false,
        needsInitialGeneration: false,
      };
    }
  }

  private async decideInitiativeRouting(
    entity: WorkItemEntity,
    targetLevel: 'description' | 'details' | 'acceptanceCriteria',
    organizationId: OrganizationId,
    targetStageId: string,
  ): Promise<{
    targetNode: string;
    shouldSkipGeneration: boolean;
    needsInitialGeneration: boolean;
  }> {
    if (this.needsInitialGeneration(entity, targetLevel)) {
      this.logAdvancedDebug('initiative.routing.initial_generation_required', {
        entityId: entity.id,
        targetLevel,
        organizationId,
      });
      return {
        targetNode: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        shouldSkipGeneration: false,
        needsInitialGeneration: true,
      };
    }

    try {
      this.logAdvancedDebug('initiative.routing.detect_changes.start', {
        entityId: entity.id,
        targetLevel,
        organizationId,
      });
      const optimizationResult =
        await this.initiativeOptimizationService.detectChanges(
          entity.id as InitiativeId,
          organizationId,
        );
      this.logAdvancedDebug('initiative.routing.detect_changes.result', {
        entityId: entity.id,
        hasChanges: optimizationResult.hasChanges,
        confidenceScore: optimizationResult.confidenceScore,
        changedFields: optimizationResult.changedFields,
        changesSummary: optimizationResult.changesSummary,
      });

      const optimizationContext =
        await this.initiativeOptimizationService.generateOptimizationContext(
          optimizationResult,
        );
      this.logAdvancedDebug('initiative.routing.optimization_context', {
        entityId: entity.id,
        shouldSkipLlm: optimizationContext.shouldSkipLlm,
        confidenceScore: optimizationContext.confidenceScore,
        optimizationHints: optimizationContext.optimizationHints,
        changesSummary: optimizationContext.changesSummary,
      });

      if (optimizationContext.shouldSkipLlm) {
        return {
          targetNode: INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT,
          shouldSkipGeneration: true,
          needsInitialGeneration: false,
        };
      }

      return {
        targetNode: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        shouldSkipGeneration: false,
        needsInitialGeneration: false,
      };
    } catch (error) {
      this.logger.error(
        'Error during initiative routing decision, defaulting to generation',
        {
          entityId: entity.id,
          targetStageId,
          organizationId,
          error:
            error instanceof Error ? error.message : errorToLoggable(error),
        },
      );

      return {
        targetNode: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        shouldSkipGeneration: false,
        needsInitialGeneration: false,
      };
    }
  }

  private resolveWorkItemEntityType(
    contentType: ContentTypeDefinition,
    entity?: WorkItemEntity | null,
  ): 'initiative' | 'task' {
    if (entity?.entityType === 'initiative' || entity?.entityType === 'task') {
      return entity.entityType;
    }

    if (contentType.type === 'initiative' || contentType.id === 'initiative') {
      return 'initiative';
    }

    return 'task';
  }

  private getFinalizedWorkItemStatus(
    entityType: 'initiative' | 'task',
  ): WorkStatus {
    switch (entityType) {
      case 'initiative':
        return WorkStatus.Active;
      case 'task':
        return WorkStatus.Completed;
      default:
        throw new BadRequestException(
          `Unknown entity type: ${entityType as string}`,
        );
    }
  }

  private async reloadWorkItemEntity(
    entityId: string,
    organizationId: OrganizationId,
    entityType: 'initiative' | 'task',
  ): Promise<WorkItemEntity> {
    const refreshed = (await this.workItemAdapter.findEntity(
      entityId,
      organizationId,
      entityType,
    )) as WorkItemEntity | null;

    if (!refreshed) {
      throw new NotFoundException(
        `Work item ${entityId} not found in organization ${organizationId}`,
      );
    }

    return refreshed;
  }

  private async computeWorkItemProgress(
    entity: WorkItemEntity,
    contentType: ContentTypeDefinition,
  ): Promise<number> {
    if (this.workItemAdapter.calculateProgress) {
      try {
        return await this.workItemAdapter.calculateProgress(
          entity,
          contentType,
        );
      } catch (error) {
        this.logger.warn('Failed to compute work item progress via adapter', {
          entityId: entity.id,
          contentType: contentType.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const stage = this.getStageDefinition(contentType, entity.currentStage);
    return this.calculateStageProgress(stage, contentType);
  }

  private getWorkItemGeneratingStatus(
    _entityType: 'initiative' | 'task',
    stageId: string,
  ): string | undefined {
    const level =
      stageId === 'details'
        ? 'details'
        : stageId === 'acceptanceCriteria'
          ? 'acceptanceCriteria'
          : 'description';

    return getGeneratingStatusForSection(level);
  }

  private buildWorkItemActions(stage: StageDefinition): StageAction[] {
    const actions: StageAction[] = [
      {
        type: 'content_update',
        label: `Update ${stage.displayName}`,
        description: `Update ${stage.displayName.toLowerCase()} content`,
        enabled: true,
        requiresInput: true,
        validationRequired: false,
      },
      {
        type: 'refine',
        label: 'AI Refinement',
        description: 'Request AI assistance for the current stage',
        enabled: true,
        requiresInput: true,
        validationRequired: false,
      },
    ];

    if (!stage.isTerminal && stage.nextStages.length > 0) {
      actions.push({
        type: 'advance',
        label: 'Advance to Next Stage',
        description: `Move to ${stage.nextStages[0]} stage`,
        enabled: true,
        requiresInput: false,
        validationRequired: true,
      });
    }

    if (stage.isTerminal || stage.nextStages.length === 0) {
      actions.push({
        type: 'finalize',
        label: 'Finalize',
        description: 'Mark the work item as ready',
        enabled: true,
        requiresInput: false,
        validationRequired: true,
      });
    }

    return actions;
  }

  private formatValidationMessages(errors: ValidationError[]): string {
    return errors.map((error) => error.message).join('; ');
  }

  /**
   * Get content type definition for validation
   */
  getContentType(contentTypeId: ContentTypeId): ContentTypeDefinition {
    return this.contentTypeRegistry.get(contentTypeId);
  }

  /**
   * Check if a content type is supported
   */
  isContentTypeSupported(contentTypeId: ContentTypeId): boolean {
    return this.contentTypeRegistry.has(contentTypeId);
  }

  /**
   * Get all available content types
   */
  getAvailableContentTypes(): ContentTypeDefinition[] {
    return this.contentTypeRegistry.getAll();
  }
}

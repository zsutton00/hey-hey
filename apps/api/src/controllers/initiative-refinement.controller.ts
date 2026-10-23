import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Initiative } from '@prisma/client';
import { ContextAwareLogger } from 'src/core/logging/context-aware-logger.service';
import { INITIATIVE_REFINEMENT_NODES } from 'src/flows/constants';
import { InitiativeResponseDto } from 'src/generated';
import { InitiativeDraft } from 'src/services/initiatives/types';
import {
  getCurrentSectionFromStatus,
  getGeneratingStatusForSection,
  getNextSection,
  getNextStatusFromSection,
  isGeneratingStatus,
} from 'src/utils/work-item.util';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { InitiativeLifecycleService } from '../services/initiatives/initiative-lifecycle.service';
import { InitiativeOptimizationService } from '../services/initiatives/initiative-optimization.service';
import { InitiativeService } from '../services/initiatives/initiative.service';
import { MessageClassificationService } from '../services/message-classification/message-classification.service';
import { MessageIntent } from '../services/message-classification/types/classification.types';
import { WorkflowRouterService } from '../services/workflows/workflow-router.service';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  WorkflowId,
} from '../types';

interface InitiativeRefinementRequestDto {
  message?: string;
  contentUpdate?: {
    content: string;
    level: 'description' | 'details' | 'acceptanceCriteria';
    previousContent: string;
  };
  // New level-aware classification support
  classifiedIntent?:
    | 'approve_level'
    | 'edit_content'
    | 'finalize'
    | 'general_response';
}

type InitiativeConversation = NonNullable<
  Awaited<
    ReturnType<InitiativeLifecycleService['getInitiativeCreationConversation']>
  >
>;
type InitiativeConversationWithWorkflow = InitiativeConversation & {
  workflowId: WorkflowId;
};

@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/initiative-refinement',
)
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class InitiativeRefinementController {
  private readonly logger: ContextAwareLogger =
    ContextAwareLogger.createServiceLogger(InitiativeRefinementController.name);

  constructor(
    private readonly initiativeLifecycleService: InitiativeLifecycleService,
    private readonly workflowRouterService: WorkflowRouterService,
    private readonly initiativeService: InitiativeService,
    private readonly initiativeOptimizationService: InitiativeOptimizationService,
    private readonly messageClassificationService: MessageClassificationService,
  ) {}

  /**
   * Map MessageIntent enum to controller's expected intent values
   */
  private mapIntentToControllerValue(
    intent: MessageIntent,
  ): 'approve_level' | 'edit_content' | 'finalize' | 'general_response' {
    switch (intent) {
      case MessageIntent.APPROVAL:
        return 'approve_level';
      case MessageIntent.CONTENT_UPDATE:
      case MessageIntent.INITIATIVE_FEEDBACK:
        return 'edit_content';
      case MessageIntent.REVIEW_REQUEST:
        return 'finalize';
      case MessageIntent.GENERAL:
      case MessageIntent.REJECTION:
      default:
        return 'general_response';
    }
  }

  /**
   * Helper method to get progress information from initiative status
   */
  private getProgressInfo(status: string): {
    currentLevel: 'description' | 'details' | 'acceptanceCriteria';
    levelIndex: number;
    totalLevels: number;
    progressPercentage: number;
    nextLevel?: 'description' | 'details' | 'acceptanceCriteria';
  } {
    const currentLevel = getCurrentSectionFromStatus(status);
    const levels: Array<'description' | 'details' | 'acceptanceCriteria'> = [
      'description',
      'details',
      'acceptanceCriteria',
    ];
    const levelIndex = levels.indexOf(currentLevel);
    const nextLevel =
      levelIndex < levels.length - 1 ? levels[levelIndex + 1] : undefined;

    return {
      currentLevel,
      levelIndex,
      totalLevels: levels.length,
      progressPercentage: Math.round(((levelIndex + 1) / levels.length) * 100),
      nextLevel,
    };
  }

  /**
   * Helper method to get classification-based response message
   */
  private getClassificationBasedMessage(
    intent: string | undefined,
    currentLevel: 'description' | 'details' | 'acceptanceCriteria',
  ): string {
    switch (intent) {
      case 'approve_level':
        return `Processing approval for ${currentLevel} level. Moving to next stage...`;
      case 'edit_content':
        return `Processing content changes for ${currentLevel} level...`;
      case 'finalize':
        return 'Processing finalization request. Completing refinement...';
      case 'general_response':
        return 'Processing your message and determining next steps...';
      default:
        return 'Analyzing your feedback with level-aware classification...';
    }
  }

  /**
   * Helper method to get target field name for a given level transition
   */
  private getTargetFieldForLevel(
    currentLevel: 'description' | 'details' | 'acceptanceCriteria',
  ): keyof InitiativeDraft | null {
    const nextLevel = getNextSection(currentLevel);
    switch (nextLevel) {
      case 'details':
        return 'details';
      case 'acceptanceCriteria':
        return 'acceptanceCriteria';
      default:
        return null; // No next level (already at final level)
    }
  }

  /**
   * Helper method to check if target field is empty and needs initial generation
   */
  private isTargetFieldEmpty(
    initiative: InitiativeDraft | InitiativeResponseDto | Initiative,
    targetField: keyof InitiativeDraft | null,
  ): boolean {
    if (!targetField) return false;

    const fieldValue = initiative[targetField as keyof typeof initiative];
    return (
      !fieldValue ||
      (typeof fieldValue === 'string' && fieldValue.trim() === '')
    );
  }

  /**
   * Helper method to determine if we should force generation for empty target fields
   */
  private shouldForceGenerationForEmptyField(
    initiative: InitiativeDraft | InitiativeResponseDto | Initiative,
    currentLevel: 'description' | 'details' | 'acceptanceCriteria',
  ): boolean {
    const targetField = this.getTargetFieldForLevel(currentLevel);
    return this.isTargetFieldEmpty(initiative, targetField);
  }

  /**
   * Helper method to generate appropriate deepen response messages
   */
  private getDeepenResponseMessage(
    initiativeName: string,
    currentLevel: string,
    shouldSkipGeneration: boolean,
    needsInitialGeneration: boolean,
  ): { message: string; status: string; estimatedProcessingTime: string } {
    const nextLevel = getNextSection(
      currentLevel as 'description' | 'details' | 'acceptanceCriteria',
    );
    const nextLevelName = nextLevel || 'final';

    if (shouldSkipGeneration) {
      return {
        message: `Deepened ${initiativeName} from ${currentLevel} level. Status advanced to ${nextLevelName} level - no new content needed.`,
        status: 'status_advanced',
        estimatedProcessingTime: '~2-5 seconds',
      };
    }

    if (needsInitialGeneration) {
      const targetContentType =
        nextLevel === 'details'
          ? 'technical implementation details'
          : nextLevel === 'acceptanceCriteria'
            ? 'success criteria and validation requirements'
            : 'content';

      return {
        message: `Generating ${targetContentType} for ${initiativeName}. This will help define the ${nextLevel} level specifications.`,
        status: 'generating_initial_content',
        estimatedProcessingTime: '~15-30 seconds',
      };
    }

    return {
      message: `Deepening ${initiativeName} from ${currentLevel} level. Processing changes and generating next level content...`,
      status: 'deepening_in_progress',
      estimatedProcessingTime: '~15-30 seconds',
    };
  }

  /**
   * Determine appropriate workflow node based on initiative content analysis
   */
  private async determineWorkflowNode(
    initiativeId: InitiativeId,
    organizationId: OrganizationId,
    currentLevel: string,
    initiative?: InitiativeDraft | InitiativeResponseDto | Initiative,
  ): Promise<{
    targetNode: string;
    shouldSkipGeneration: boolean;
    needsInitialGeneration: boolean;
  }> {
    let needsInitialGeneration = false;

    try {
      // Load initiative if not provided to check target field
      // Use findOne (not findOneForAdapter) to get raw database data without status-based field filtering
      const initiativeData =
        initiative ||
        (await this.initiativeService.findOne(initiativeId, organizationId));

      if (!initiativeData) {
        this.logger.warn(
          'Initiative not found for content analysis, defaulting to content generation',
          { initiativeId, organizationId },
        );
        return {
          targetNode: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          shouldSkipGeneration: false,
          needsInitialGeneration: true,
        };
      }

      // Check if target field is empty - if so, always generate regardless of changes
      needsInitialGeneration = this.shouldForceGenerationForEmptyField(
        initiativeData,
        currentLevel as 'description' | 'details' | 'acceptanceCriteria',
      );

      if (needsInitialGeneration) {
        this.logger.debug('Target field is empty, forcing content generation', {
          initiativeId,
          currentLevel,
          organizationId,
        });
        return {
          targetNode: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          shouldSkipGeneration: false,
          needsInitialGeneration,
        };
      }

      // Target field has content, now check if current level was changed
      const changeDetection =
        await this.initiativeOptimizationService.detectChanges(
          initiativeId,
          organizationId,
        );

      this.logger.debug('Change detection results for /deepen', {
        hasChanges: changeDetection.hasChanges,
        changesSummary: changeDetection.changesSummary,
        confidenceScore: changeDetection.confidenceScore,
        initiativeId,
        currentLevel,
      });

      // Generate optimization context for routing decision
      const optimizationContext =
        await this.initiativeOptimizationService.generateOptimizationContext(
          changeDetection,
        );

      this.logger.debug('Optimization context for /deepen', {
        shouldSkipLlm: optimizationContext.shouldSkipLlm,
        optimizationHints: optimizationContext.optimizationHints,
        initiativeId,
      });

      if (optimizationContext.shouldSkipLlm) {
        // No significant changes detected and target field exists, skip generation
        this.logger.debug(
          'No changes detected and target field exists, skipping generation',
          {
            initiativeId,
            currentLevel,
            organizationId,
          },
        );
        return {
          targetNode: INITIATIVE_REFINEMENT_NODES.PROMPT_INPUT,
          shouldSkipGeneration: true,
          needsInitialGeneration,
        };
      } else {
        // Significant changes detected, regenerate content for next level
        this.logger.debug(
          'Changes detected, regenerating content for next level',
          {
            initiativeId,
            currentLevel,
            organizationId,
          },
        );
        return {
          targetNode: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
          shouldSkipGeneration: false,
          needsInitialGeneration,
        };
      }
    } catch (optimizationError) {
      this.logger.error(
        'Error in optimization logic for /deepen, defaulting to content generation',
        {
          error:
            optimizationError instanceof Error
              ? optimizationError.message
              : optimizationError,
          initiativeId,
          currentLevel,
        },
      );

      // Safe fallback: always generate content on error
      return {
        targetNode: INITIATIVE_REFINEMENT_NODES.AGENT_NEXT_LEVEL,
        shouldSkipGeneration: false,
        needsInitialGeneration,
      };
    }
  }

  private async validateDeepenPrerequisites(
    organizationId: OrganizationId,
    conversationId: ConversationId,
    initiativeId: InitiativeId,
  ): Promise<{
    initiative: Initiative;
    conversation: InitiativeConversationWithWorkflow;
  }> {
    // Load the initiative directly
    const initiative = await this.initiativeService.findOne(
      initiativeId,
      organizationId,
    );

    if (!initiative) {
      this.logger.warn(
        '[deepenInitiativeByConversation] initiative not found',
        {
          initiativeId,
          organizationId,
        },
      );
      throw new NotFoundException('Initiative not found');
    }

    this.logger.debug('[deepenInitiativeByConversation] initiative loaded', {
      initiativeId,
      initiativeStatus: initiative.status,
      initiativeName: initiative.name,
    });

    if (isGeneratingStatus(initiative.status)) {
      this.logger.warn(
        '[deepenInitiativeByConversation] cannot deepen while generating',
        {
          initiativeId,
          currentStatus: initiative.status,
          organizationId,
        },
      );
      throw new BadRequestException(
        `Cannot deepen initiative while AI is generating content. Current status: ${initiative.status}. Please wait for generation to complete.`,
      );
    }

    const activeConversationId =
      await this.initiativeService.getActiveRefinementConversation(
        initiativeId,
        organizationId,
      );

    if (!activeConversationId) {
      throw new NotFoundException(
        'No active refinement conversation found for this initiative',
      );
    }

    if (activeConversationId !== conversationId) {
      throw new BadRequestException(
        'Provided conversation ID does not match active refinement conversation',
      );
    }

    const conversation =
      await this.initiativeLifecycleService.getInitiativeCreationConversation(
        conversationId,
        organizationId,
      );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const workflowId = conversation.workflowId;
    if (!workflowId) {
      throw new BadRequestException('Conversation has no associated workflow');
    }

    const ensuredConversation: InitiativeConversationWithWorkflow = {
      ...conversation,
      workflowId,
    };

    this.logger.debug(
      '[deepenInitiativeByConversation] checking workflow status',
      {
        workflowId: ensuredConversation.workflowId,
        initiativeId,
      },
    );

    const isWorkflowRunning =
      await this.workflowRouterService.isWorkflowRunning(
        ensuredConversation.workflowId,
      );

    this.logger.debug(
      '[deepenInitiativeByConversation] workflow status check result',
      {
        workflowId: ensuredConversation.workflowId,
        isWorkflowRunning,
        initiativeId,
      },
    );

    if (!isWorkflowRunning) {
      this.logger.warn(
        '[deepenInitiativeByConversation] workflow not running',
        {
          workflowId: ensuredConversation.workflowId,
          initiativeId,
          conversationId,
        },
      );
      throw new BadRequestException('Workflow is not running or has completed');
    }

    return { initiative, conversation: ensuredConversation };
  }

  /**
   * Get conversation with initiatives for initiative refinement
   */
  // @Get('conversations/:conversationId')
  // async getInitiativeRefinementConversation(
  //   @Param('organizationId') organizationId: OrganizationId,
  //   @Param('projectId') _projectId: ProjectId,
  //   @Param('conversationId') conversationId: ConversationId,
  // ) {
  //   // Get the conversation and associated initiatives
  //   const conversation =
  //     await this.initiativeLifecycleService.getInitiativeCreationConversation(
  //       conversationId,
  //       organizationId,
  //     );

  //   if (!conversation) {
  //     throw new NotFoundException('Conversation not found');
  //   }

  //   const initiatives =
  //     await this.initiativeLifecycleService.getInitiativesFromConversation(
  //       conversation,
  //       organizationId,
  //     );

  //   return {
  //     conversation,
  //     initiatives,
  //     summary: {
  //       totalInitiatives: initiatives.length,
  //       reviewedCount: 0, // Not tracking review status in InitiativeDraft
  //       canFinalize: false, // Not tracking review status in InitiativeDraft
  //     },
  //   };
  // }

  /**
   * Start or get refinement session for an initiative (UI-friendly)
   * Enhanced with level-aware status information
   */
  // @Get('initiatives/:initiativeId')
  // async getOrCreateInitiativeRefinementSession(
  //   @Param('organizationId') organizationId: OrganizationId,
  //   @Param('projectId') projectId: ProjectId,
  //   @Param('initiativeId') initiativeId: string,
  // ) {
  //   // First, try to find existing refinement conversation for this initiative
  //   const existingConversation =
  //     await this.initiativeLifecycleService.findConversationForInitiative(
  //       initiativeId,
  //       organizationId,
  //       projectId,
  //     );

  //   let conversation;
  //   let initiatives: InitiativeDraft[];

  //   if (existingConversation) {
  //     conversation = existingConversation;
  //     initiatives =
  //       await this.initiativeLifecycleService.getInitiativesFromConversation(
  //         conversation,
  //         organizationId,
  //       );
  //   } else {
  //     // Create new refinement conversation for this initiative
  //     const result =
  //       await this.initiativeLifecycleService.createRefinementConversation(
  //         initiativeId,
  //         organizationId,
  //         projectId,
  //       );
  //     conversation = result.conversation;
  //     initiatives = result.initiatives;
  //   }

  //   // Get the target initiative to provide level-aware status
  //   const targetInitiative = await this.initiativeService.findOne(
  //     initiativeId,
  //     organizationId,
  //   );

  //   const progressInfo = targetInitiative
  //     ? this.getProgressInfo(targetInitiative.status)
  //     : null;

  //   return {
  //     conversation,
  //     initiatives,
  //     targetInitiativeId: initiativeId,
  //     // Enhanced with level-aware progress information
  //     levelAwareStatus: progressInfo
  //       ? {
  //           currentLevel: progressInfo.currentLevel,
  //           progressPercentage: progressInfo.progressPercentage,
  //           nextLevel: progressInfo.nextLevel,
  //           canApprove: true, // User can always approve current level
  //           canFinalize: progressInfo.currentLevel === 'acceptanceCriteria',
  //           statusDescription: targetInitiative
  //             ? getStatusDescription(targetInitiative.status)
  //             : '',
  //         }
  //       : null,
  //     summary: {
  //       totalInitiatives: initiatives.length,
  //     },
  //   };
  // }

  /**
   * Refine specific initiative by conversation and initiative ID
   * Enhanced with level-aware message classification
   */
  // @Post('conversations/:conversationId/initiatives/:initiativeId/refine')
  // async refineInitiativeByConversation(
  //   @Param('organizationId') organizationId: OrganizationId,
  //   @Param('projectId') projectId: ProjectId,
  //   @Param('conversationId') conversationId: ConversationId,
  //   @Param('initiativeId') initiativeId: InitiativeId,
  //   @Body() refinementRequest: InitiativeRefinementRequestDto,
  // ) {
  //   // Load the initiative directly instead of going through conversation
  //   const initiative = await this.initiativeService.findOne(
  //     initiativeId,
  //     organizationId,
  //   );

  //   if (!initiative) {
  //     throw new NotFoundException('Initiative not found');
  //   }

  //   // Get the active refinement conversation for this initiative
  //   const activeConversationId =
  //     await this.initiativeService.getActiveRefinementConversation(
  //       initiativeId,
  //       organizationId,
  //     );

  //   if (!activeConversationId) {
  //     throw new NotFoundException(
  //       'No active refinement conversation found for this initiative',
  //     );
  //   }

  //   // Validate that the provided conversationId matches the active one
  //   if (activeConversationId !== conversationId) {
  //     throw new BadRequestException(
  //       'Provided conversation ID does not match active refinement conversation',
  //     );
  //   }

  //   // Get conversation to access workflowId with retry logic
  //   let conversation =
  //     await this.initiativeLifecycleService.getInitiativeCreationConversation(
  //       conversationId,
  //       organizationId,
  //     );

  //   // If conversation not found, it might be a timing issue - retry once
  //   if (!conversation) {
  //     this.logger.warn(
  //       '[refineInitiativeByConversation] Conversation not found on first attempt, retrying...',
  //       {
  //         conversationId,
  //         organizationId,
  //       },
  //     );

  //     // Wait a bit and retry once
  //     await new Promise((resolve) => setTimeout(resolve, 100));
  //     conversation =
  //       await this.initiativeLifecycleService.getInitiativeCreationConversation(
  //         conversationId,
  //         organizationId,
  //       );
  //   }

  //   if (!conversation) {
  //     throw new NotFoundException(
  //       `Conversation ${conversationId} not found. This may indicate a data consistency issue.`,
  //     );
  //   }

  //   if (!conversation.workflowId) {
  //     throw new BadRequestException('Conversation has no associated workflow');
  //   }

  //   if (!refinementRequest.message && !refinementRequest.contentUpdate) {
  //     throw new BadRequestException(
  //       'Either message or contentUpdate is required',
  //     );
  //   }

  //   // Check if workflow is still running
  //   const isWorkflowRunning =
  //     await this.workflowRouterService.isWorkflowRunning(
  //       conversation.workflowId,
  //     );

  //   if (!isWorkflowRunning) {
  //     throw new BadRequestException('Workflow is not running or has completed');
  //   }

  //   const timestamp = new Date();

  //   if (refinementRequest.message) {
  //     // Get current level from initiative status for level-aware classification
  //     const currentLevel = getCurrentSectionFromStatus(initiative.status);

  //     // Perform level-aware message classification if not already provided
  //     let classifiedIntent = refinementRequest.classifiedIntent;
  //     let classificationResult = null;

  //     if (!classifiedIntent) {
  //       try {
  //         // Use the new level-aware classification service
  //         classificationResult =
  //           await this.messageClassificationService.classifyMessageWithLevel(
  //             refinementRequest.message,
  //             {
  //               conversationId,
  //               projectId,
  //               organizationId,
  //             },
  //             currentLevel,
  //             organizationId,
  //           );
  //         classifiedIntent = this.mapIntentToControllerValue(
  //           classificationResult.intent,
  //         );
  //       } catch (error) {
  //         this.logger.warn('Message classification failed, using fallback', {
  //           error: error instanceof Error ? error.message : 'Unknown error',
  //           initiativeId,
  //           conversationId,
  //         });
  //         classifiedIntent = 'general_response'; // Safe fallback
  //       }
  //     }

  //     // Send feedback signal to workflow with classification info using generic structured message
  //     await this.workflowRouterService.sendStructuredMessage(
  //       conversation.workflowId,
  //       projectId,
  //       conversationId,
  //       'refinement_feedback',
  //       {
  //         initiativeId,
  //         message: refinementRequest.message,
  //         organizationId,
  //         projectId,
  //         conversationId,
  //         classifiedIntent,
  //         currentLevel,
  //         classificationConfidence: classificationResult?.confidence,
  //       },
  //     );

  //     this.logger.log(
  //       `Sent level-aware refinement feedback signal for initiative ${initiativeId}`,
  //       {
  //         conversationId,
  //         workflowId: conversation.workflowId,
  //         organizationId,
  //         classifiedIntent,
  //         currentLevel,
  //         confidence: classificationResult?.confidence,
  //       },
  //     );

  //     return {
  //       success: true,
  //       message: this.getClassificationBasedMessage(
  //         classifiedIntent,
  //         currentLevel,
  //       ),
  //       status: 'feedback_sent',
  //       workflowId: conversation.workflowId,
  //       timestamp,
  //       // Enhanced response with classification info
  //       levelAwareClassification: {
  //         intent: classifiedIntent,
  //         currentLevel,
  //         confidence: classificationResult?.confidence,
  //         reasoning: classificationResult?.reasoning,
  //       },
  //     };
  //   } else if (refinementRequest.contentUpdate) {
  //     // Send content update signal to workflow using generic structured message
  //     await this.workflowRouterService.sendStructuredMessage(
  //       conversation.workflowId,
  //       projectId,
  //       conversationId,
  //       'content_update',
  //       {
  //         initiativeId,
  //         contentUpdate: refinementRequest.contentUpdate,
  //         organizationId,
  //         projectId,
  //         conversationId,
  //       },
  //     );

  //     this.logger.log(
  //       `Sent content update signal for initiative ${initiativeId}`,
  //       {
  //         conversationId,
  //         workflowId: conversation.workflowId,
  //         level: refinementRequest.contentUpdate.level,
  //         organizationId,
  //       },
  //     );

  //     return {
  //       success: true,
  //       message: 'Content update sent to workflow. Analysis in progress...',
  //       status: 'content_update_sent',
  //       workflowId: conversation.workflowId,
  //       timestamp,
  //       level: refinementRequest.contentUpdate.level,
  //     };
  //   }
  // }

  /**
   * NEW: Level-aware message processing endpoint
   * Provides intelligent routing based on message classification
  //  */
  // @Post(
  //   'conversations/:conversationId/initiatives/:initiativeId/process-message',
  // )
  // async processLevelAwareMessage(
  //   @Param('organizationId') organizationId: OrganizationId,
  //   @Param('projectId') projectId: ProjectId,
  //   @Param('conversationId') conversationId: ConversationId,
  //   @Param('initiativeId') initiativeId: InitiativeId,
  //   @Body() messageRequest: { message: string },
  // ) {
  //   // Load initiative to get current status/level
  //   const initiative = await this.initiativeService.findOne(
  //     initiativeId,
  //     organizationId,
  //   );

  //   if (!initiative) {
  //     throw new NotFoundException('Initiative not found');
  //   }

  //   const currentLevel = getCurrentSectionFromStatus(initiative.status);
  //   const progressInfo = this.getProgressInfo(initiative.status);

  //   // Perform level-aware classification
  //   const classificationResult =
  //     await this.messageClassificationService.classifyMessageWithLevel(
  //       messageRequest.message,
  //       {
  //         conversationId,
  //         projectId,
  //         organizationId,
  //       },
  //       currentLevel,
  //       organizationId,
  //     );

  //   return {
  //     success: true,
  //     classification: {
  //       intent: classificationResult.intent,
  //       confidence: classificationResult.confidence,
  //       reasoning: classificationResult.reasoning,
  //     },
  //     currentState: {
  //       level: currentLevel,
  //       status: initiative.status,
  //       statusDescription: getStatusDescription(initiative.status),
  //       progress: progressInfo,
  //     },
  //     recommendedAction: this.getRecommendedAction(
  //       classificationResult.intent,
  //       currentLevel,
  //       progressInfo,
  //     ),
  //     nextSteps: this.getNextSteps(
  //       classificationResult.intent,
  //       currentLevel,
  //       progressInfo,
  //     ),
  //   };
  // }

  /**
   * Helper method to get recommended action based on classification
  //  */
  // private getRecommendedAction(
  //   intent: string,
  //   currentLevel: string,
  //   progressInfo: any,
  // ): string {
  //   switch (intent) {
  //     case 'approve_level':
  //       return progressInfo.nextLevel
  //         ? `Approve current ${currentLevel} level and advance to ${progressInfo.nextLevel}`
  //         : `Approve final ${currentLevel} level and complete refinement`;
  //     case 'edit_content':
  //       return `Edit ${currentLevel} level content with user feedback`;
  //     case 'finalize':
  //       return 'Finalize all refinement levels and complete initiative';
  //     case 'general_response':
  //       return 'Provide clarification or continue conversation';
  //     default:
  //       return 'Process user message and determine appropriate response';
  //   }
  // }

  // /**
  //  * Helper method to get next steps based on classification
  //  */
  // private getNextSteps(
  //   intent: string,
  //   currentLevel: string,
  //   progressInfo: any,
  // ): string[] {
  //   const steps = [];

  //   switch (intent) {
  //     case 'approve_level':
  //       steps.push(
  //         `Update initiative status from current level (${currentLevel})`,
  //       );
  //       if (progressInfo.nextLevel) {
  //         steps.push(`Advance to ${progressInfo.nextLevel} level`);
  //         steps.push(`Present ${progressInfo.nextLevel}-specific interface`);
  //       } else {
  //         steps.push('Mark initiative as ready for implementation');
  //         steps.push('Complete refinement workflow');
  //       }
  //       break;
  //     case 'edit_content':
  //       steps.push(`Apply content changes to ${currentLevel} level`);
  //       steps.push(`Update initiative data in database`);
  //       steps.push(`Continue refinement at current level`);
  //       break;
  //     case 'finalize':
  //       steps.push('Validate all refinement levels are complete');
  //       steps.push('Generate final refinement summary');
  //       steps.push('Mark initiative as ACTIVE status');
  //       steps.push('Complete refinement workflow');
  //       break;
  //     case 'general_response':
  //       steps.push('Provide conversational response');
  //       steps.push('Continue level-aware classification loop');
  //       break;
  //   }

  //   return steps;
  // }

  /**
   * Deepen initiative by conversation and initiative ID
   */
  @Post('conversations/:conversationId/initiatives/:initiativeId/deepen')
  async deepenInitiativeByConversation(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') _projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @Param('initiativeId') initiativeId: InitiativeId,
    @Body() _deepenRequest: { currentLevel: 'description' | 'details' },
  ) {
    this.logger.debug('[deepenInitiativeByConversation] starting', {
      organizationId,
      conversationId,
      initiativeId,
      requestBody: _deepenRequest,
    });

    const timestamp = new Date();
    const { initiative, conversation } = await this.validateDeepenPrerequisites(
      organizationId,
      conversationId,
      initiativeId,
    );

    const initialStatus = initiative.status;
    const currentLevel = getCurrentSectionFromStatus(initialStatus);

    // Determine appropriate workflow node based on content analysis
    const routingDecision = await this.determineWorkflowNode(
      initiativeId,
      organizationId,
      currentLevel,
      initiative,
    );

    // If no content generation is needed, advance the status level
    if (routingDecision.shouldSkipGeneration) {
      // Advance status to next level when no content generation is needed
      const nextLevel = getNextSection(currentLevel);
      if (nextLevel) {
        const nextStatus = getNextStatusFromSection(currentLevel);
        await this.initiativeService.update(
          initiativeId,
          { status: nextStatus },
          organizationId,
        );

        this.logger.log(
          `Advanced initiative status from ${initialStatus} to ${nextStatus} - no content generation needed`,
          {
            conversationId,
            organizationId,
            currentLevel,
            nextLevel,
            targetNode: routingDecision.targetNode,
          },
        );
      }
    } else {
      const nextLevel = getNextSection(currentLevel);
      if (!nextLevel) {
        throw new BadRequestException(
          `Cannot determine next section for level ${currentLevel}`,
        );
      }
      const generatingStatus = getGeneratingStatusForSection(nextLevel);

      await this.initiativeService.update(
        initiativeId,
        { status: generatingStatus },
        organizationId,
      );

      this.logger.log(
        `Set initiative ${initiativeId} to ${generatingStatus} for content generation`,
        {
          conversationId,
          organizationId,
          previousStatus: initialStatus,
          currentLevel,
          targetNode: routingDecision.targetNode,
        },
      );
    }

    // Route to intelligent decision-based node
    await this.workflowRouterService.sendSkipToNode(
      conversation.workflowId,
      routingDecision.targetNode,
    );

    this.logger.log(
      `Routed initiative ${initiativeId} to ${routingDecision.targetNode} based on content analysis`,
      {
        conversationId,
        workflowId: conversation.workflowId,
        currentLevel,
        organizationId,
        targetNode: routingDecision.targetNode,
        shouldSkipGeneration: routingDecision.shouldSkipGeneration,
      },
    );

    // Determine the actual current level after potential status advancement
    const finalCurrentLevel = routingDecision.shouldSkipGeneration
      ? getNextSection(currentLevel) || currentLevel
      : currentLevel;

    // Determine if this is initial generation or refinement
    const responseData = this.getDeepenResponseMessage(
      initiative.name,
      currentLevel,
      routingDecision.shouldSkipGeneration,
      routingDecision.needsInitialGeneration,
    );

    return {
      success: true,
      message: responseData.message,
      status: responseData.status,
      workflowId: conversation.workflowId,
      timestamp,
      currentLevel: finalCurrentLevel,
      targetNode: routingDecision.targetNode,
      estimatedProcessingTime: responseData.estimatedProcessingTime,
      ...(initialStatus === 'REFINING_DESCRIPTION'
        ? { transitionedFrom: 'REFINING_DESCRIPTION' as const }
        : {}),
    };
  }

  /**
   * Finalize initiative by conversation and initiative ID
   */
  @Post('conversations/:conversationId/initiatives/:initiativeId/finalize')
  async finalizeInitiativeByConversation(
    @Param('organizationId') organizationId: OrganizationId,
    @Param('projectId') _projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @Param('initiativeId') initiativeId: InitiativeId,
  ) {
    try {
      // Finalize the sp
      // Load the initiative directly
      const initiative = await this.initiativeService.findOne(
        initiativeId,
        organizationId,
      );

      if (!initiative) {
        throw new NotFoundException('Initiative not found');
      }

      // Check if the initiative has been reviewed
      if (initiative.status !== 'REFINING_ACCEPTANCE_CRITERIA') {
        throw new BadRequestException(
          'Initiative must be complete before finalization',
        );
      }

      await this.initiativeService.update(
        initiativeId,
        {
          status: 'ACTIVE',
        },
        organizationId,
      );

      return {
        success: true,
        data: {
          message: 'Initiative successfully finalized',
          initiative,
          conversationId,
        },
      };
    } catch (error) {
      if ((error as Error).message.includes('not ready for finalization')) {
        throw new BadRequestException((error as Error).message);
      }
      throw error;
    }
  }
}

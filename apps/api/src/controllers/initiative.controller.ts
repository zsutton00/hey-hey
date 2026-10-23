import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  CreateInitiativeDto,
  InitiativeResponseDto,
  InitiativeSourceType,
  Priority,
  UpdateInitiativeDto,
  WorkStatus,
} from '../generated';
import { InitiativeLifecycleService } from '../services/initiatives/initiative-lifecycle.service';
import { InitiativeService } from '../services/initiatives/initiative.service';

import { Client } from '@temporalio/client';
import {
  FlexibleAuthenticatedUser,
  isJwtUser,
} from 'src/auth/decorators/current-api-user.decorator';
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { FlexibleAuthGuard } from 'src/auth/guards/flexible-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import {
  ConversationId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import { InjectTemporalClient } from '../prisma/temporal.module';
import { ConversationService } from '../services/conversation.service';
import { StartConversationFlowWorkflowInput } from '../workflows/conversation-flow.workflow';

@ProjectResourceId('initiative')
@Controller('api/v1/organizations/:organizationId/initiatives')
@UseGuards(FlexibleAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class InitiativeController {
  private readonly logger = new Logger(InitiativeController.name);

  constructor(
    private readonly initiativeService: InitiativeService,
    private readonly conversationService: ConversationService,
    private readonly initiativeLifecycleService: InitiativeLifecycleService,
    @InjectTemporalClient() private readonly temporalClient: Client,
  ) {}

  @Post()
  async create(
    @Body() createInitiativeDto: CreateInitiativeDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto> {
    this.logger.debug(`[create] starting`, {
      createInitiativeDto,
      organizationId,
      sourceConversationId: createInitiativeDto.sourceConversationId,
      projectId: createInitiativeDto.projectId,
    });
    return this.initiativeService.createForAdapter(
      createInitiativeDto,
      organizationId,
      createInitiativeDto.projectId,
    );
  }

  @Get()
  async findAll(
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('status') status?: string | string[],
    @Query('priority') priority?: Priority,
    @Query('tags') tags?: string | string[],
    @Query('projectId') projectId?: ProjectId,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('includeSectionKeys') includeSectionKeys?: string | string[],
  ): Promise<InitiativeResponseDto[]> {
    if (!projectId) {
      throw new BadRequestException('projectId is required');
    }

    const sectionKeys = this.normalizeSectionKeys(includeSectionKeys);
    const filters = {
      statuses: this.normalizeStatuses(status),
      priority,
      tags: Array.isArray(tags) ? tags : tags ? [tags] : undefined,
      sourceType: { not: InitiativeSourceType.Plan },
      projectId,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      ...(sectionKeys ? { includeSectionKeys: sectionKeys } : {}),
    };

    return this.initiativeService.findAllForAdapter(organizationId, filters);
  }

  @Get(':initiativeId')
  async findOne(
    @Param('initiativeId') initiativeId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto> {
    const initiative = await this.initiativeService.findOneForAdapter(
      initiativeId,
      organizationId,
    );
    if (!initiative) {
      throw new NotFoundException('Initiative not found');
    }
    return initiative;
  }

  @Patch(':initiativeId')
  async update(
    @Param('initiativeId') initiativeId: string,
    @Body() updateInitiativeDto: UpdateInitiativeDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @CurrentUser('email') userEmail: string,
    @CurrentUser('name') userName: string,
  ): Promise<InitiativeResponseDto> {
    return this.initiativeService.updateForAdapter(
      initiativeId,
      updateInitiativeDto,
      organizationId,
      userId,
      userEmail,
      userName,
    );
  }

  private normalizeStatuses(
    status?: string | string[],
  ): WorkStatus[] | undefined {
    const statuses = Array.isArray(status)
      ? status
      : typeof status === 'string'
        ? status.split(',').map((value) => value.trim())
        : undefined;

    const filteredStatuses = statuses?.filter(
      (value) =>
        value && value !== 'undefined' && value !== 'null' && value !== 'false',
    ) as WorkStatus[] | undefined;

    return filteredStatuses && filteredStatuses.length > 0
      ? filteredStatuses
      : undefined;
  }

  private normalizeSectionKeys(
    includeSectionKeys?: string | string[],
  ): string[] | undefined {
    const keys = Array.isArray(includeSectionKeys)
      ? includeSectionKeys
      : typeof includeSectionKeys === 'string'
        ? includeSectionKeys.split(',')
        : [];
    const normalized = keys
      .map((key) => key.trim())
      .filter((key) => key.length > 0);
    return normalized.length > 0 ? normalized : undefined;
  }

  @Delete(':initiativeId')
  async remove(
    @Param('initiativeId') initiativeId: string,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto> {
    return this.initiativeService.removeForAdapter(
      initiativeId,
      organizationId,
    );
  }

  /**
   * Link a project to an initiative
   */
  @Post(':initiativeId/projects/:projectId')
  async linkProject(
    @Param('initiativeId') initiativeId: InitiativeId,
    @Param('projectId') projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body('role') role?: string,
  ) {
    const result = await this.initiativeService.linkProject(
      initiativeId,
      projectId,
      organizationId,
      role,
    );

    return {
      success: true,
      message: 'Project linked to initiative successfully',
      data: result,
      initiativeId,
      projectId,
    };
  }

  /**
   * Unlink a project from an initiative
   */
  @Delete(':initiativeId/projects/:projectId')
  async unlinkProject(
    @Param('initiativeId') initiativeId: InitiativeId,
    @Param('projectId') projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
  ) {
    const result = await this.initiativeService.unlinkProject(
      initiativeId,
      projectId,
      organizationId,
    );

    return {
      success: true,
      message: 'Project unlinked from initiative successfully',
      data: { deletedCount: result.count },
      initiativeId,
      projectId,
    };
  }

  /**
   * Get all projects linked to an initiative
   */
  @Get(':initiativeId/projects')
  async getLinkedProjects(
    @Param('initiativeId') initiativeId: InitiativeId,
    @CurrentOrganization() organizationId: OrganizationId,
  ) {
    const projectLinks = await this.initiativeService.getLinkedProjects(
      initiativeId,
      organizationId,
    );

    return {
      success: true,
      data: projectLinks,
      initiativeId,
      count: projectLinks.length,
    };
  }

  // Initiative Refinement Endpoints

  /**
   * Start initiative refinement conversation
   */
  @Post(':initiativeId/refine')
  async startRefinement(
    @Param('initiativeId') initiativeId: InitiativeId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser() user: FlexibleAuthenticatedUser,
    @Body() body: { reasoning?: string; projectId?: ProjectId },
  ): Promise<{ conversationId: ConversationId; workflowId: string }> {
    // Extract userId based on auth type
    const userId = isJwtUser(user) ? user.userId : user.userId;

    // Get the initiative details first
    const initiative = await this.initiativeService.findByIdForAdapter(
      initiativeId,
      organizationId,
    );

    if (!initiative) {
      throw new NotFoundException(`Initiative ${initiativeId} not found`);
    }

    // Find existing refinement conversation (auto-create if missing)
    let existingConversationId =
      await this.initiativeService.getActiveRefinementConversation(
        initiativeId,
        organizationId,
      );

    this.logger.debug('[startRefinement] starting', {
      initiativeId,
      existingConversationId,
    });

    // Auto-create refinement conversation if it doesn't exist (for UI-created initiatives)
    if (!existingConversationId) {
      this.logger.debug(
        '[startRefinement] No refinement conversation found, creating automatically',
        {
          initiativeId,
          organizationId,
          projectId: body.projectId,
          reason: 'UI-created initiative needs refinement conversation',
        },
      );

      try {
        // Determine the project ID - require from body since initiative doesn't have projectId
        const projectId = body.projectId;
        if (!projectId) {
          throw new BadRequestException(
            `Cannot create refinement conversation: projectId is required in request body for initiative ${initiativeId}`,
          );
        }

        // Create the refinement conversation
        const conversationResult =
          await this.initiativeLifecycleService.createRefinementConversation(
            initiativeId,
            organizationId,
            projectId,
            undefined,
            userId,
          );

        const createdConversation = conversationResult.conversation;
        if (!createdConversation) {
          throw new BadRequestException(
            `Failed to create refinement conversation for initiative ${initiativeId}`,
          );
        }
        existingConversationId = createdConversation.id;

        this.logger.debug(
          '[startRefinement] Successfully created refinement conversation',
          {
            initiativeId,
            conversationId: existingConversationId,
            projectId,
          },
        );
      } catch (error) {
        this.logger.error(
          '[startRefinement] Failed to auto-create refinement conversation',
          {
            error: (error as Error).message,
            stack: (error as Error).stack,
            initiativeId,
            organizationId,
          },
        );
        throw new BadRequestException(
          `Failed to create refinement conversation for initiative ${initiativeId}: ${(error as Error).message}`,
        );
      }
    }

    if (existingConversationId) {
      // Get the conversation to check workflow status with retry logic
      let conversation = await this.conversationService.getConversation(
        existingConversationId as ConversationId,
        organizationId,
      );

      // If conversation not found, it might be a timing issue - retry once
      if (!conversation) {
        this.logger.warn(
          '[startRefinement] Conversation not found on first attempt, retrying...',
          {
            conversationId: existingConversationId,
            organizationId,
          },
        );

        // Wait a bit and retry once
        await new Promise((resolve) => setTimeout(resolve, 100));
        conversation = await this.conversationService.getConversation(
          existingConversationId as ConversationId,
          organizationId,
        );
      }

      this.logger.debug('[startRefinement] getConversation', {
        hasConversation: !!conversation,
        conversationId: existingConversationId,
      });

      if (!conversation) {
        throw new NotFoundException(
          `Conversation ${existingConversationId} not found. This may indicate a data consistency issue.`,
        );
      }

      if (conversation) {
        if (conversation.workflowId) {
          try {
            // Check if the workflow is still running
            const workflowHandle = this.temporalClient.workflow.getHandle(
              conversation.workflowId,
            );
            const workflowDescription = await workflowHandle.describe();

            this.logger.debug('[startRefinement] getHandle', {
              workflowDescription: {
                executionTime: workflowDescription.executionTime,
                startTime: workflowDescription.startTime,
                status: workflowDescription.status.name,
              },
            });

            if (workflowDescription.status.name === 'RUNNING') {
              // Workflow is still active, return existing details
              return {
                conversationId: existingConversationId as ConversationId,
                workflowId: conversation.workflowId,
              };
            }
          } catch (error) {
            // Workflow not found or terminated, we'll start a new one
            console.log(
              'Existing workflow not active, starting new one:',
              (error as Error).message,
            );
          }
        }

        // Start new workflow with existing conversation
        if (!body.projectId) {
          throw new BadRequestException(
            'projectId is required in request body for initiative refinement',
          );
        }

        const workflowId =
          `initiative-refinement-${initiativeId}-${Date.now()}` as WorkflowId;

        const workflowInput: StartConversationFlowWorkflowInput = {
          projectId: body.projectId,
          workflowId,
          organizationId,
          flowId: 'initiative-refinement',
          userId,
          initiatedBy: 'USER' as const,
          triggerEvent: 'initiative_refinement',
          title: `Refine Initiative: ${initiative.name}`,
          workflowName: 'initiative-refinement',
          workflowAboutId: initiative.id,
          workflowAboutType: 'initiative',
          userResponseTimeout: '2d',
          conversationId: existingConversationId as ConversationId, // Resume with existing conversation
          additionalContext: {
            initiativeId: initiative.id,
          },
        };

        await this.conversationService.updateConversationInternal(
          conversation.id,
          organizationId,
          {
            workflowId,
          },
        );

        // TODO: need to handle if one of these fails
        await this.temporalClient.workflow.start('conversationFlowWorkflow', {
          args: [workflowInput],
          taskQueue: 'conversation-queue',
          workflowId: workflowId,
        });

        this.logger.debug('[startRefinement] startWorkflow', {
          workflowInput,
        });

        return {
          conversationId: existingConversationId as ConversationId,
          workflowId,
        };
      }
    }

    // This should never happen since we auto-create conversations above
    throw new Error(
      `Unexpected error: conversation should exist after auto-creation for initiative ${initiativeId}`,
    );
  }

  /**
   * Check active refinement conversation status
   */
  @Get(':initiativeId/refinement/status')
  async getRefinementStatus(
    @Param('initiativeId') initiativeId: InitiativeId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<{
    hasActiveRefinement: boolean;
    conversationId?: ConversationId;
    workflowId?: string;
  }> {
    const conversationId =
      await this.initiativeService.getActiveRefinementConversation(
        initiativeId,
        organizationId,
      );

    if (!conversationId) {
      return { hasActiveRefinement: false };
    }

    // Check if conversation still exists and is active
    const conversation = await this.conversationService.getConversation(
      conversationId as ConversationId,
      organizationId,
    );

    if (!conversation) {
      // Clean up stale reference
      await this.initiativeService.clearActiveRefinementConversation(
        initiativeId,
        organizationId,
      );
      return { hasActiveRefinement: false };
    }

    return {
      hasActiveRefinement: true,
      conversationId: conversationId as ConversationId,
      workflowId: conversation.workflowId,
    };
  }

  /**
   * Complete initiative refinement
   */
  @Post(':initiativeId/refinement/complete')
  async completeRefinement(
    @Param('initiativeId') initiativeId: InitiativeId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body()
    body: {
      changes?: {
        name?: string;
        description?: string;
        details?: string;
        acceptanceCriteria?: string;
        assigneeId?: string;
        priority?: Priority;
        tags?: string[];
      };
      finalNotes?: string;
    },
  ): Promise<InitiativeResponseDto> {
    // Apply any final changes
    let updatedInitiative = await this.initiativeService.findByIdForAdapter(
      initiativeId,
      organizationId,
    );

    if (!updatedInitiative) {
      throw new NotFoundException(`Initiative ${initiativeId} not found`);
    }

    if (body.changes) {
      updatedInitiative = await this.initiativeService.applyRefinementChanges(
        initiativeId,
        body.changes,
        organizationId,
      );
    }

    // Clear the active refinement conversation
    await this.initiativeService.clearActiveRefinementConversation(
      initiativeId,
      organizationId,
    );

    return updatedInitiative;
  }
}

// Separate controller for conversation-specific initiatives
@ProjectResourceId('initiative')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId/initiatives',
)
@UseGuards(FlexibleAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class ConversationInitiativeController {
  constructor(private readonly initiativeService: InitiativeService) {}

  @Get()
  async getInitiativesByConversation(
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<InitiativeResponseDto[]> {
    return await this.initiativeService.findByConversationForAdapter(
      conversationId,
      organizationId,
    );
  }
}

import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Client } from '@temporalio/client';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { InjectTemporalClient } from '../prisma/temporal.module';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import {
  SuggestionDecisionResult,
  SuggestionDecisionService,
} from '../services/suggestion-decision.service';
import { TaskService } from '../services/tasks/task.service';
import { InitiativeService } from '../services/initiatives/initiative.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  UserId,
  WorkflowId,
} from '../types';
import {
  CreateSuggestedDesignDocRequestDto,
  CreateSuggestedDesignDocResponseDto,
  CreateSuggestedTaskRequestDto,
  CreateSuggestedTaskResponseDto,
  ListSuggestionDecisionsResponseDto,
  SuggestionDecisionRequestDto,
  SuggestionDecisionResponseDto,
  SuggestionType,
} from 'src/generated';
import { createSuggestedTaskWorkflow } from '../workflows/create-suggested-task.workflow';
import { CreateSuggestedTaskWorkflowInput } from '../workflows/create-suggested-task.types';
import { createSuggestedDesignDocWorkflow } from '../workflows/create-suggested-design-doc.workflow';
import { CreateSuggestedDesignDocWorkflowInput } from '../workflows/create-suggested-design-doc.types';

@ApiTags('Suggestions')
@ApiBearerAuth()
@Controller('api/v1/organizations/:organizationId/suggestions')
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class SuggestionController {
  constructor(
    @InjectTemporalClient() private readonly temporalClient: Client,
    private readonly suggestionDecisionService: SuggestionDecisionService,
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly taskService: TaskService,
    private readonly initiativeService: InitiativeService,
  ) {}

  @Get(':type/:suggestionId')
  @ApiOperation({
    summary: 'Get the current status of a suggestion',
    description:
      'Returns accepted (true), rejected (false), or null when no record exists',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggestion status retrieved',
  })
  async getSuggestionDecision(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('type') type: SuggestionType,
    @Param('suggestionId') suggestionId: string,
  ): Promise<SuggestionDecisionResponseDto> {
    const result = await this.suggestionDecisionService.getDecision(
      organizationId,
      type,
      suggestionId,
    );

    return this.toResponseDto(result);
  }

  @Get()
  @ApiOperation({
    summary: 'List suggestion decisions by conversation or message',
    description:
      'Returns suggestion decisions filtered by sourceConversationId and/or sourceMessageId.',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggestion decisions retrieved',
  })
  async listSuggestionDecisions(
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('sourceConversationId') sourceConversationId?: ConversationId,
    @Query('sourceMessageId') sourceMessageId?: MessageId,
  ): Promise<ListSuggestionDecisionsResponseDto> {
    if (!sourceConversationId && !sourceMessageId) {
      throw new BadRequestException(
        'sourceConversationId or sourceMessageId is required',
      );
    }

    const decisions = await this.suggestionDecisionService.listDecisions({
      organizationId,
      sourceConversationId,
      sourceMessageId,
    });

    return {
      decisions: decisions.map((decision) => this.toResponseDto(decision)),
    };
  }

  @Post(':type/:suggestionId')
  @ApiOperation({
    summary: 'Record an accept/reject decision for a suggestion',
    description:
      'Upserts the suggestion decision so future lookups can immediately reflect the choice',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggestion decision recorded',
  })
  async recordSuggestionDecision(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId | undefined,
    @Param('type') type: SuggestionType,
    @Param('suggestionId') suggestionId: string,
    @Body() body: SuggestionDecisionRequestDto,
  ): Promise<SuggestionDecisionResponseDto> {
    const result = await this.suggestionDecisionService.recordDecision({
      organizationId,
      type,
      suggestionId,
      accepted: body.accepted,
      decidedBy: userId,
      sourceConversationId: body.sourceConversationId,
      sourceMessageId: body.sourceMessageId,
      metadata: body.metadata,
    });

    return this.toResponseDto(result);
  }

  @Post('generate-task')
  @ApiOperation({
    summary: 'Generate a single task from a suggested action selection',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggested task workflow started',
  })
  async generateTaskFromSuggestion(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId | undefined,
    @Body() body: CreateSuggestedTaskRequestDto,
  ): Promise<CreateSuggestedTaskResponseDto> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (!body.suggestionId) {
      throw new BadRequestException('suggestionId is required');
    }
    if (!body.sourceConversationId) {
      throw new BadRequestException('sourceConversationId is required');
    }
    if (!body.sourceMessageId) {
      throw new BadRequestException('sourceMessageId is required');
    }

    const conversation = await this.conversationService.getConversation(
      body.sourceConversationId,
      organizationId,
    );
    if (!conversation) {
      throw new BadRequestException(
        `Conversation ${body.sourceConversationId} not found`,
      );
    }

    if (conversation.projectId !== body.projectId) {
      throw new BadRequestException(
        `Conversation ${body.sourceConversationId} does not belong to project ${body.projectId}`,
      );
    }

    const sourceMessage = await this.messageService.getMessageForAdapter(
      body.sourceMessageId,
      organizationId,
      true,
    );
    if (!sourceMessage) {
      throw new BadRequestException(
        `Message ${body.sourceMessageId} not found`,
      );
    }

    if (sourceMessage.conversationId !== body.sourceConversationId) {
      throw new BadRequestException(
        `Message ${body.sourceMessageId} does not belong to conversation ${body.sourceConversationId}`,
      );
    }

    if (body.parentTaskId) {
      const parentTask = await this.taskService.findOneForAdapter(
        body.parentTaskId,
        organizationId,
      );
      if (!parentTask) {
        throw new BadRequestException(
          `Parent task ${body.parentTaskId} not found`,
        );
      }
      if (
        body.initiativeId &&
        parentTask.initiativeId &&
        parentTask.initiativeId !== body.initiativeId
      ) {
        throw new BadRequestException(
          `Parent task ${body.parentTaskId} does not belong to initiative ${body.initiativeId}`,
        );
      }
    }

    const workflowId =
      `create-suggested-task-${body.sourceMessageId}-${Date.now()}` as WorkflowId;

    const input: CreateSuggestedTaskWorkflowInput = {
      organizationId,
      projectId: body.projectId,
      initiativeId: body.initiativeId,
      name: body.name,
      parentTaskId: body.parentTaskId,
      sourceConversationId: body.sourceConversationId,
      sourceMessageId: body.sourceMessageId,
      trigger: body.trigger,
    };

    await this.temporalClient.workflow.start(createSuggestedTaskWorkflow, {
      args: [input],
      taskQueue: 'conversation-queue',
      workflowId,
      searchAttributes: {
        UserId: [userId],
        SourceConversationID: [body.sourceConversationId],
      },
    });

    await this.suggestionDecisionService.recordDecision({
      organizationId,
      type: SuggestionType.SuggestedActionTask,
      suggestionId: body.suggestionId,
      accepted: true,
      decidedBy: userId,
      sourceConversationId: body.sourceConversationId,
      sourceMessageId: body.sourceMessageId,
      metadata: {
        kind: 'CREATE_SUGGESTED_TASK',
        workflowId,
      },
    });

    return { workflowId };
  }

  @Post('generate-design-doc')
  @ApiOperation({
    summary: 'Generate a design doc from a suggested action selection',
  })
  @ApiResponse({
    status: 200,
    description: 'Suggested design doc workflow started',
  })
  async generateDesignDocFromSuggestion(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId | undefined,
    @Body() body: CreateSuggestedDesignDocRequestDto,
  ): Promise<CreateSuggestedDesignDocResponseDto> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    if (!body.projectId) {
      throw new BadRequestException('projectId is required');
    }
    if (!body.suggestionId) {
      throw new BadRequestException('suggestionId is required');
    }
    if (!body.sourceConversationId) {
      throw new BadRequestException('sourceConversationId is required');
    }
    if (!body.sourceMessageId) {
      throw new BadRequestException('sourceMessageId is required');
    }
    if (!body.name) {
      throw new BadRequestException('name is required');
    }
    if (!body.template) {
      throw new BadRequestException('template is required');
    }

    const conversation = await this.conversationService.getConversation(
      body.sourceConversationId,
      organizationId,
    );
    if (!conversation) {
      throw new BadRequestException(
        `Conversation ${body.sourceConversationId} not found`,
      );
    }

    if (conversation.projectId !== body.projectId) {
      throw new BadRequestException(
        `Conversation ${body.sourceConversationId} does not belong to project ${body.projectId}`,
      );
    }

    const sourceMessage = await this.messageService.getMessageForAdapter(
      body.sourceMessageId,
      organizationId,
      true,
    );
    if (!sourceMessage) {
      throw new BadRequestException(
        `Message ${body.sourceMessageId} not found`,
      );
    }

    if (sourceMessage.conversationId !== body.sourceConversationId) {
      throw new BadRequestException(
        `Message ${body.sourceMessageId} does not belong to conversation ${body.sourceConversationId}`,
      );
    }

    const initiativeForValidation = body.initiativeId
      ? await this.initiativeService.findOneForAdapter(
          body.initiativeId,
          organizationId,
        )
      : null;
    if (body.initiativeId) {
      if (!initiativeForValidation) {
        throw new BadRequestException(
          `Initiative ${body.initiativeId} not found`,
        );
      }
      if (initiativeForValidation.originatingProjectId !== body.projectId) {
        throw new BadRequestException(
          `Initiative ${body.initiativeId} does not belong to project ${body.projectId}`,
        );
      }
    }

    if (body.taskId) {
      const task = await this.taskService.findOneForAdapter(
        body.taskId,
        organizationId,
      );
      if (!task) {
        throw new BadRequestException(`Task ${body.taskId} not found`);
      }
      if (body.initiativeId && task.initiativeId !== body.initiativeId) {
        throw new BadRequestException(
          `Task ${body.taskId} does not belong to initiative ${body.initiativeId}`,
        );
      }

      if (task.projectId !== body.projectId) {
        throw new BadRequestException(
          `Task ${body.taskId} does not belong to project ${body.projectId}`,
        );
      }
    }

    const workflowId =
      `create-suggested-design-doc-${body.sourceMessageId}-${Date.now()}` as WorkflowId;

    const input: CreateSuggestedDesignDocWorkflowInput = {
      organizationId,
      projectId: body.projectId,
      name: body.name,
      description: body.description,
      template: body.template,
      initiativeId: body.initiativeId,
      taskId: body.taskId,
      sourceConversationId: body.sourceConversationId,
      sourceMessageId: body.sourceMessageId,
      trigger: body.trigger,
    };

    await this.temporalClient.workflow.start(createSuggestedDesignDocWorkflow, {
      args: [input],
      taskQueue: 'conversation-queue',
      workflowId,
      searchAttributes: {
        UserId: [userId],
        SourceConversationID: [body.sourceConversationId],
      },
    });

    await this.suggestionDecisionService.recordDecision({
      organizationId,
      type: SuggestionType.SuggestedActionDesignDoc,
      suggestionId: body.suggestionId,
      accepted: true,
      decidedBy: userId,
      sourceConversationId: body.sourceConversationId,
      sourceMessageId: body.sourceMessageId,
      metadata: {
        kind: 'CREATE_SUGGESTED_DESIGN_DOC',
        workflowId,
      },
    });

    return { workflowId };
  }

  private toResponseDto(
    result: SuggestionDecisionResult,
  ): SuggestionDecisionResponseDto {
    return {
      id: result.id,
      type: result.type,
      accepted: result.accepted,
      decidedBy: result.decidedBy ?? null,
      createdAt: result.createdAt?.toISOString() ?? null,
      sourceConversationId: result.sourceConversationId ?? undefined,
      sourceMessageId: result.sourceMessageId ?? undefined,
      metadata: result.metadata ?? undefined,
    };
  }
}

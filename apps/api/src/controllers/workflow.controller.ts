import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiProperty,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Client } from '@temporalio/client';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { InjectTemporalClient } from '../prisma/temporal.module';
import { PrismaService } from '../prisma/prisma.service';
import { FlowExecutionService } from '../services/workflows/flow-execution.service';
import { WorkflowVisibilityService } from '../services/workflows/workflow-visibility.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../types';
import { getWorkflowStatus } from '../workflows/conversation-flow.workflow';
import {
  PromptTypeResponseDto as PromptTypeResponseModel,
  WorkflowName,
} from '../generated';
import { LocalPromptType } from '../generated/local';

type WorkflowStateValue = PromptTypeResponseModel.WorkflowStateEnum;
const WORKFLOW_STATE_VALUES: readonly WorkflowStateValue[] = [
  PromptTypeResponseModel.WorkflowStateEnum.AgentPending,
  PromptTypeResponseModel.WorkflowStateEnum.LiveNonAgent,
  PromptTypeResponseModel.WorkflowStateEnum.Terminal,
];

export class WorkflowExecutionSummaryDto {
  @ApiProperty({ description: 'Temporal workflow ID' })
  workflowId!: WorkflowId;

  @ApiProperty({ description: 'Temporal run ID' })
  runId!: string;

  @ApiProperty({ description: 'Temporal workflow type name' })
  workflowType!: string;

  @ApiProperty({ description: 'Workflow execution status' })
  status!: string;

  @ApiProperty({ description: 'Workflow start timestamp' })
  startTime!: string;

  @ApiProperty({
    description: 'Workflow completion timestamp, if finished',
    nullable: true,
  })
  closeTime!: string | null;
}

export class ListWorkflowExecutionsResponseDto {
  @ApiProperty({
    type: [WorkflowExecutionSummaryDto],
    description: 'Workflow executions for the current user',
  })
  workflows!: WorkflowExecutionSummaryDto[];

  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Opaque pagination token for the next page, if any',
  })
  nextPageToken!: string | null;
}

const WORKFLOW_NAME_VALUES = Object.values(WorkflowName);

export class WorkflowNodeResponseDto {
  @ApiProperty({
    nullable: true,
    description:
      'ID of the workflow node the conversation is currently sitting on. Null when the conversation has no active workflow attached or the workflow has reached a terminal state.',
  })
  currentNodeId!: string | null;

  @ApiProperty({
    nullable: true,
    enum: WORKFLOW_NAME_VALUES,
    description:
      'Template name of the workflow attached to the conversation. Null when the conversation has never been bound to a workflow.',
  })
  workflowName!: WorkflowName | null;
}

const PROMPT_TYPE_RESPONSE_VALUES: readonly LocalPromptType[] = [
  LocalPromptType.startup_session,
  LocalPromptType.feature_sync_analyze,
  LocalPromptType.feature_sync_iterate,
  LocalPromptType.repository_grounding,
  LocalPromptType.implement,
];

export class PromptTypeResponseDto {
  @ApiProperty({
    required: true,
    nullable: false,
    enum: WORKFLOW_STATE_VALUES,
    description:
      "Three-state discriminator for where the conversation's workflow stands. agent-pending: workflow paused on an EXTERNAL_AGENT node (live or via a paused execution resolving to one) — the CLI owns the next turn and nodeId/triggerMessageId may be non-null. live-non-agent: workflow is still alive but parked on a non-EXTERNAL_AGENT node (e.g. a QUESTIONS review gate) — the CLI has no pending turn; nodeId and triggerMessageId are null and promptType is the flow's terminalPromptType. terminal: workflow complete, gone with no paused execution, or never attached. Consumers MUST branch on this rather than inferring state from the nullable fields below.",
  })
  workflowState!: WorkflowStateValue;

  @ApiProperty({
    nullable: true,
    enum: PROMPT_TYPE_RESPONSE_VALUES,
    description:
      "LocalPromptType the CLI should use to dispatch the next turn. Resolves from the active EXTERNAL_AGENT node, then the flow template's terminalPromptType, then null when the conversation has no workflow.",
  })
  promptType!: LocalPromptType | null;

  @ApiProperty({
    nullable: true,
    description:
      'ID of the EXTERNAL_AGENT node the conversation is currently paused on. Populated only when the workflow is active and the current node is EXTERNAL_AGENT; null in every other case (no workflow, workflow complete or gone, non-EXTERNAL_AGENT current node).',
  })
  nodeId!: string | null;

  @ApiProperty({
    nullable: true,
    description:
      'Id of the open SYSTEM trigger message awaiting completion under nodeId. Null when nodeId is null, or when the projection finds no pending trigger for the current node. Pairs with nodeId so callers can author the completion message without caching trigger context locally.',
  })
  triggerMessageId!: string | null;
}

@ApiTags('Workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
@Controller('api/v1/organizations/:organizationId')
export class WorkflowController {
  private readonly logger = new Logger(WorkflowController.name);

  constructor(
    private readonly workflowVisibilityService: WorkflowVisibilityService,
    private readonly prisma: PrismaService,
    private readonly flowExecutionService: FlowExecutionService,
    @InjectTemporalClient() private readonly temporalClient: Client,
  ) {}

  @Get('workflows')
  @ApiOperation({ summary: 'List workflows for the current user' })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
    description: 'Maximum number of workflow executions to return (max 200)',
  })
  @ApiQuery({
    name: 'nextPageToken',
    required: false,
    type: String,
    description: 'Opaque pagination token from the previous response',
  })
  @ApiQuery({
    name: 'workflowType',
    required: false,
    type: String,
    description: 'Filter by Temporal workflow type name',
  })
  @ApiQuery({
    name: 'sourceConversationId',
    required: false,
    type: String,
    description: 'Filter by source conversation ID',
  })
  @ApiResponse({
    status: 200,
    description: 'Workflow executions retrieved successfully',
    type: ListWorkflowExecutionsResponseDto,
  })
  async listUserWorkflows(
    @CurrentOrganization() _organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId | undefined,
    @Query('limit') limit?: string,
    @Query('nextPageToken') nextPageToken?: string,
    @Query('workflowType') workflowType?: string,
    @Query('sourceConversationId') sourceConversationId?: ConversationId,
  ): Promise<ListWorkflowExecutionsResponseDto> {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }

    const parsedLimit = limit ? Number(limit) : 50;
    if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
      throw new BadRequestException('limit must be a positive number');
    }

    const pageSize = Math.min(parsedLimit, 200);

    return this.workflowVisibilityService.listUserWorkflows({
      userId,
      workflowType,
      sourceConversationId,
      pageSize,
      nextPageToken,
    });
  }

  @Get('projects/:projectId/conversations/:conversationId/workflow-node')
  @ApiOperation({
    summary: 'Get the current workflow node for a conversation',
    description:
      "Returns the current node the conversation's workflow is sitting on, plus the workflow template name. Intended for dispatch-time lookups (e.g. composer submission) — consumers map currentNodeId to their own enums locally. Returns null currentNodeId for conversations with no active workflow or a terminated workflow.",
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'conversationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Workflow node lookup succeeded',
    type: WorkflowNodeResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversationWorkflowNode(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
  ): Promise<WorkflowNodeResponseDto> {
    this.logger.debug(
      `Looking up workflow node for conversation=${conversationId} project=${projectId} organization=${organizationId}`,
    );

    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId, organizationId, projectId },
      select: { id: true, workflowId: true, workflowName: true },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found in project ${projectId}`,
      );
    }

    const workflowName = (conversation.workflowName ??
      null) as WorkflowName | null;

    if (!conversation.workflowId) {
      return { currentNodeId: null, workflowName };
    }

    const workflowId = conversation.workflowId as WorkflowId;

    try {
      const handle = this.temporalClient.workflow.getHandle(workflowId);
      const status = await handle.query(getWorkflowStatus);

      if (status.isComplete) {
        return { currentNodeId: null, workflowName };
      }

      return { currentNodeId: status.currentNodeId ?? null, workflowName };
    } catch (error) {
      const errorName = error instanceof Error ? error.name : '';
      const errorMessage =
        error instanceof Error ? error.message.toLowerCase() : '';
      const isWorkflowGone =
        errorName === 'WorkflowNotFoundError' ||
        errorMessage.includes('workflow execution already completed') ||
        errorMessage.includes('workflow not found');

      if (isWorkflowGone) {
        this.logger.debug(
          `Workflow ${workflowId} is gone (${errorName || 'unknown error'}); returning null currentNodeId`,
        );
        return { currentNodeId: null, workflowName };
      }

      throw error;
    }
  }

  @Get('projects/:projectId/conversations/:conversationId/prompt-type')
  @ApiOperation({
    summary: 'Get the current prompt-type for a conversation',
    description:
      "Returns the CLI LocalPromptType to use when dispatching the next turn for a conversation, plus a workflowState discriminator that tells consumers which of three states the workflow is in: agent-pending (paused on an EXTERNAL_AGENT node — the CLI owns the next turn), live-non-agent (still alive but parked on a non-agent gate such as a QUESTIONS review — waiting on the user, NOT terminated), or terminal (complete, gone with no paused execution, or never attached). Consumers MUST branch on workflowState — promptType alone can no longer distinguish 'live on a user gate' from 'workflow over'.",
  })
  @ApiParam({ name: 'organizationId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'projectId', type: 'string', format: 'uuid' })
  @ApiParam({ name: 'conversationId', type: 'string', format: 'uuid' })
  @ApiResponse({
    status: 200,
    description: 'Prompt-type lookup succeeded',
    type: PromptTypeResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Conversation not found' })
  async getConversationPromptType(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
  ): Promise<PromptTypeResponseDto> {
    this.logger.debug(
      `Looking up prompt-type for conversation=${conversationId} project=${projectId} organization=${organizationId}`,
    );

    const conversation = await this.prisma.db.conversation.findFirst({
      where: { id: conversationId, organizationId, projectId },
      select: { id: true, workflowId: true, workflowName: true },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} not found in project ${projectId}`,
      );
    }

    return this.flowExecutionService.resolveConversationPromptType({
      conversationId,
      workflowId: conversation.workflowId as WorkflowId | null,
      workflowName: conversation.workflowName as WorkflowName | null,
      organizationId,
    });
  }
}

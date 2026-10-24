import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Patch,
  ParseBoolPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  AgentSessionDto,
  HostActionPreparation,
  PaginatedAgentSessionResponseDto,
  CreateAgentSessionDto,
  UpdateAgentSessionDto,
  WorkflowName,
  CreateAgentSessionConversationDto,
  CreateAgentSessionConversationResponseDto,
  PermissionDecisionRequestDto,
  QuestionAnswerRequestDto,
  CompactRunRequestDto,
  RestartPlanGenerationResponseDto,
  ResolveWorkItemCoordinatorAgentSessionDto,
  ResolveWorkItemCoordinatorAgentSessionResponseDto,
  CliReadErrorCode,
  CliReadProjectSessionCostsListRequest,
  CliReadRequestDto,
  CliReadResponseDto,
  HostActionCategory,
  HostActionTargetKind,
  HostAffectingActionType,
  GrantAgentSessionServicesDto,
} from 'src/generated';
import { validate as isUuid } from 'uuid';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import {
  AuthToken,
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import {
  AgentSessionId,
  ConversationId,
  MachineId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from 'src/types';
import { ConversationWorkflowError } from '../core/exceptions/workflow.exceptions';
import { TriggerEmitter } from '../core/websockets/trigger-emitter.service';
import { CliReadEmitter } from '../core/websockets/cli-read-emitter.service';
import { MachinePresenceService } from '../core/websockets/machine-presence.service';
import { WorkItemPlanGenerationService } from '../services/plan/work-item-plan-generation.service';
import { ExecutionGrantService } from '../services/controller-authorization/execution-grant.service';
import { hashControllerAction } from '../generated/controller-action-contract';
import * as crypto from 'node:crypto';
import type { Request } from 'express';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import {
  AgentSessionService,
  parseAgentSessionListSortQuery,
  parseAgentSessionPageLimitQuery,
  parseAgentSessionServiceIdQuery,
  parseAgentSessionTaskIdQuery,
  parseAgentSessionStatusesQuery,
  parseAgentSessionTypeQuery,
  parseAgentSessionUserIdQuery,
  parseEntityTypeQuery,
} from '../services/agent-session.service';

const VALID_WORKFLOW_TYPES = Object.values(WorkflowName) as string[];

@ApiTags('AgentSessions')
@Controller(
  'api/v1/organizations/:organizationId/projects/:projectId/agent-sessions',
)
@UseGuards(JwtAuthGuard, OrganizationGuard, ProjectAccessGuard)
export class AgentSessionController {
  private readonly logger = new Logger(AgentSessionController.name);

  constructor(
    private readonly agentSessionService: AgentSessionService,
    private readonly triggerEmitter: TriggerEmitter,
    private readonly cliReadEmitter: CliReadEmitter,
    private readonly planGenerationService: WorkItemPlanGenerationService,
    private readonly executionGrantService: ExecutionGrantService,
    private readonly machinePresenceService: MachinePresenceService,
  ) {}

  @Post(':agentSessionId/cli-reads')
  @UseGuards(ControllerBindingOriginGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Read typed host-owned state from the bound CLI' })
  async readCliState(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() request: CliReadRequestDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Req() httpRequest?: Request,
  ): Promise<CliReadResponseDto> {
    this.logger.log('[cli-read] endpoint request received', {
      agentSessionId,
      projectId,
      organizationId,
      userId,
      operation: request.operation,
    });
    const session = await this.agentSessionService.findOne(
      organizationId,
      agentSessionId,
    );
    if (session.projectId !== projectId) {
      throw new HttpException(
        'Agent session not found in project',
        HttpStatus.NOT_FOUND,
      );
    }
    if (session.userId !== userId) {
      throw new HttpException(
        'Agent session is owned by a different user',
        HttpStatus.FORBIDDEN,
      );
    }
    if (
      (request.operation === 'run.changed_files.count' ||
        request.operation === 'run.changed_files.inventory' ||
        request.operation === 'run.changed_files.detail' ||
        request.operation === 'run.context_usage.get') &&
      request.runId !== agentSessionId
    ) {
      return this.cliReadEmitter.error(
        request,
        CliReadErrorCode.RunIdMismatch,
        'The requested Run does not match the Agent Session.',
      );
    }
    if (
      request.operation ===
        CliReadProjectSessionCostsListRequest.OperationEnum
          .ProjectSessionCostsList &&
      request.projectId !== projectId
    ) {
      return this.cliReadEmitter.error(
        request,
        CliReadErrorCode.InvalidProjectContext,
        'The requested project does not match the route project.',
      );
    }
    if (!session.conversationId) {
      return this.cliReadEmitter.error(
        request,
        CliReadErrorCode.InvalidRunContext,
        'The Agent Session has no bound conversation.',
      );
    }
    if (!session.machineId) {
      return this.cliReadEmitter.error(
        request,
        CliReadErrorCode.MachineNotBound,
        'The Agent Session has no durable CLI machine binding.',
      );
    }

    const executionAdmission =
      await this.executionGrantService.assertAgentSessionAuthorized({
        authorization: request.authorization,
        inputs: {
          kind: 'CLI_READ',
          body: (({ authorization: _proof, ...inputs }) => ({
            requestId: crypto.randomUUID(),
            agentSessionId: session.id,
            ...inputs,
          }))(request),
        },
        organizationId,
        projectId,
        userId,
        controllerBindingSecret: readControllerBindingSecret(httpRequest),
        actionCategory: HostActionCategory.CliRead,
        actionType: HostAffectingActionType.CliRead,
        targetKind: HostActionTargetKind.AgentSession,
        agentSessionId: session.id as AgentSessionId,
        conversationId: session.conversationId,
        machineId: session.machineId as MachineId,
      });

    return this.cliReadEmitter.read({
      request,
      machineId: session.machineId as MachineId,
      userId,
      organizationId,
      projectId,
      conversationId: session.conversationId,
      agentSessionId: session.id,
      admission: {
        authorizationId: executionAdmission.authorizationId,
        envelopeAuthorization: executionAdmission.envelopeAuthorization,
        actionPayloadHash: this.hashExecutionAction(executionAdmission.action),
      },
    });
  }

  @Post()
  @ApiOperation({ summary: 'Create an agent session' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({ status: 201, description: 'Created agent session' })
  async create(
    @Body() dto: CreateAgentSessionDto,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @AuthToken() userToken: string | null = null,
  ): Promise<AgentSessionDto> {
    return this.agentSessionService.create(
      organizationId,
      projectId,
      userId,
      dto,
      userToken,
    );
  }

  @Post('work-item-coordinator')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Resolve or atomically create the canonical coordinator for a work item',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiResponse({
    status: 200,
    description: 'Resolved canonical work-item coordinator Agent Session',
  })
  async resolveWorkItemCoordinator(
    @Body() dto: ResolveWorkItemCoordinatorAgentSessionDto,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<ResolveWorkItemCoordinatorAgentSessionResponseDto> {
    this.logger.debug('Received work-item coordinator resolution request', {
      organizationId,
      projectId,
      coordinatorType: dto.type,
      workItemType: dto.workItemType,
      workItemId: dto.workItemId,
    });
    return this.agentSessionService.resolveWorkItemCoordinator(
      organizationId,
      projectId,
      userId,
      dto,
    );
  }

  @Get()
  @ApiOperation({ summary: 'List agent sessions' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'ids',
    required: false,
    isArray: true,
    description:
      'Filter by agent session IDs (repeat query param or comma-separated values).',
  })
  @ApiQuery({
    name: 'includeService',
    required: false,
    type: Boolean,
    description:
      'When true, include the linked service summary for each agent session.',
  })
  @ApiQuery({
    name: 'entityType',
    required: false,
    type: String,
    description:
      'Filter by the entity type this session is about (e.g. TASK, DESIGN_DOC, PLAN, INITIATIVE, PROPOSAL).',
  })
  @ApiQuery({
    name: 'entityId',
    required: false,
    type: String,
    description:
      'Filter by the entity ID this session is about. Pair with entityType.',
  })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    type: String,
    description: 'Filter by linked service ID.',
  })
  @ApiQuery({
    name: 'type',
    required: false,
    enum: [
      'CODING',
      'DAILY_SESSION',
      'TASK_REFINING',
      'ENTITY_CONVERSATION',
      'PROJECT_CONVERSATION',
      'DESIGN_DOC_REFINING',
      'PROPOSAL_REFINING',
      'AGENT_SEARCH',
      'PLAN_GENERATION',
    ],
    description: 'Filter by agent session type.',
  })
  async findAll(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('ids') ids?: string | string[],
    @Query('userId') userId?: string,
    @Query('conversationId') conversationId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('includeService', new ParseBoolPipe({ optional: true }))
    includeService?: boolean,
    @Query('type') type?: string,
  ): Promise<AgentSessionDto[]> {
    return this.agentSessionService.findAll(
      organizationId,
      projectId,
      {
        ids: this.normalizeIds(ids),
        userId,
        conversationId,
        entityType: parseEntityTypeQuery(entityType),
        entityId,
        serviceId,
        type: parseAgentSessionTypeQuery(type),
      },
      includeService ?? false,
    );
  }

  private normalizeIds(ids?: string | string[]): string[] | undefined {
    if (ids === undefined) {
      return undefined;
    }

    const rawValues = Array.isArray(ids) ? ids : [ids];
    const normalized = rawValues.flatMap((value) =>
      value.split(',').map((part) => part.trim()),
    );

    if (
      normalized.length === 0 ||
      normalized.some((value) => value.length < 1)
    ) {
      throw new BadRequestException('ids must contain non-empty values');
    }

    if (normalized.some((value) => !isUuid(value))) {
      throw new BadRequestException('ids must contain valid UUID values');
    }

    return normalized;
  }

  @Get('paginated')
  @ApiOperation({
    summary: 'List agent sessions with cursor pagination',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiQuery({
    name: 'type',
    required: false,
    type: String,
    description: 'Filter by agent session type.',
  })
  @ApiQuery({
    name: 'status',
    required: false,
    isArray: true,
    type: String,
    description: 'Filter by repeated lifecycle status values.',
  })
  @ApiQuery({
    name: 'sort',
    required: false,
    enum: ['LAST_MESSAGE'],
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    type: Number,
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    type: String,
  })
  @ApiQuery({
    name: 'userId',
    required: false,
    type: String,
    description: 'Filter by owning or initiating user within the project.',
  })
  @ApiQuery({
    name: 'serviceId',
    required: false,
    type: String,
    description: 'Filter by selected service within the project.',
  })
  @ApiQuery({
    name: 'taskId',
    required: false,
    type: String,
    description: 'Filter by a matching TASK attachment within the project.',
  })
  async findPaginated(
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('type') type?: string,
    @Query('status') status?: string | string[],
    @Query('sort') sort?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('userId') userId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('taskId') taskId?: string,
  ): Promise<PaginatedAgentSessionResponseDto> {
    return this.agentSessionService.findPaginated(organizationId, projectId, {
      type: parseAgentSessionTypeQuery(type),
      statuses: parseAgentSessionStatusesQuery(status),
      sort: parseAgentSessionListSortQuery(sort),
      limit: parseAgentSessionPageLimitQuery(limit),
      userId: parseAgentSessionUserIdQuery(userId),
      serviceId: parseAgentSessionServiceIdQuery(serviceId),
      taskId: parseAgentSessionTaskIdQuery(taskId),
      ...(cursor !== undefined ? { cursor } : {}),
    });
  }

  @Get(':agentSessionId')
  @ApiOperation({ summary: 'Get agent session by ID' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  @ApiQuery({
    name: 'includeService',
    required: false,
    type: Boolean,
    description:
      'When true, include the linked service summary for the agent session.',
  })
  @ApiQuery({
    name: 'includeUser',
    required: false,
    type: Boolean,
    description:
      'When true, include the linked user details for the agent session.',
  })
  async findOne(
    @Param('agentSessionId') agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('includeService', new ParseBoolPipe({ optional: true }))
    includeService?: boolean,
    @Query('includeUser', new ParseBoolPipe({ optional: true }))
    includeUser?: boolean,
  ): Promise<AgentSessionDto> {
    return this.agentSessionService.findOne(organizationId, agentSessionId, {
      includeService: includeService ?? false,
      includeUser: includeUser ?? false,
    });
  }

  @Patch(':agentSessionId')
  @ApiOperation({ summary: 'Update an agent session' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  async update(
    @Param('agentSessionId') agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @Body() dto: UpdateAgentSessionDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @AuthToken() userToken: string | null = null,
  ): Promise<AgentSessionDto> {
    if (!dto.machineId) {
      throw new BadRequestException('machineId is required');
    }
    return this.agentSessionService.update(
      organizationId,
      agentSessionId,
      dto,
      userToken,
    );
  }

  @Post(':agentSessionId/service-grants')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Add Services to an Agent Session' })
  async grantServices(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() grant: GrantAgentSessionServicesDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<AgentSessionDto> {
    const bindingSnapshot = await this.machinePresenceService.getBindings(
      grant.machineId as MachineId,
    );
    if (!bindingSnapshot || bindingSnapshot.organizationId !== organizationId) {
      throw new BadRequestException(
        'The authenticated machine has no live bindings for this organization',
      );
    }
    return this.agentSessionService.grantServices({
      organizationId,
      projectId,
      agentSessionId,
      userId,
      grant,
      liveBoundServiceIds: bindingSnapshot.bindings.map(
        ({ serviceId }) => serviceId,
      ),
    });
  }

  @Post(':agentSessionId/conversation')
  @ApiOperation({
    summary: 'Create a conversation on an existing agent session',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  @ApiResponse({
    status: 201,
    description: 'Conversation created and linked to the agent session',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad request — missing or unknown workflowType',
  })
  @ApiResponse({
    status: 409,
    description: 'Conflict — agent session already has a conversation',
  })
  async createConversation(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) projectId: ProjectId,
    @Body() body: CreateAgentSessionConversationDto,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<CreateAgentSessionConversationResponseDto> {
    this.logger.log(
      `[createConversation] received request agentSessionId=${agentSessionId} workflowType=${String(body.workflowType)} workflowAboutType=${String(body.workflowAboutType)} workflowAboutId=${String(body.workflowAboutId)}`,
    );

    if (!body.workflowType) {
      throw new BadRequestException('workflowType is required');
    }
    if (!VALID_WORKFLOW_TYPES.includes(body.workflowType as string)) {
      throw new BadRequestException(
        `Unknown workflowType "${body.workflowType}". Acceptable values: ${VALID_WORKFLOW_TYPES.join(', ')}`,
      );
    }
    try {
      const result =
        await this.agentSessionService.createConversationForSession(
          organizationId,
          projectId,
          agentSessionId,
          body,
        );
      this.logger.log(
        `[createConversation] succeeded agentSessionId=${agentSessionId} conversationId=${result.conversation.id}`,
      );
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `[createConversation] failed agentSessionId=${agentSessionId} workflowType=${String(body.workflowType)}: ${message}`,
        stack,
      );
      if (error instanceof ConversationWorkflowError) {
        throw new HttpException(
          {
            success: false,
            message: error.message,
            code: 'WORKFLOW_ERROR',
            context: error.context,
            timestamp: new Date().toISOString(),
            statusCode: HttpStatus.BAD_REQUEST,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  @Post(':agentSessionId/stop')
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Stop the active CLI run owning the conversation linked to this agent session',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  @ApiResponse({ status: 204, description: 'Stop control envelope emitted' })
  @ApiResponse({ status: 403, description: 'Cross-user stop attempt' })
  @ApiResponse({ status: 404, description: 'Unknown agent session' })
  async stopRun(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<void> {
    const session = await this.agentSessionService.findOne(
      organizationId,
      agentSessionId,
    );

    if (session.userId !== userId) {
      // Cross-user attempt — the acting user must own the agent session.
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — agent session is owned by a different user',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (!session.conversationId) {
      // No conversation is bound yet — there is no Run to stop. Idempotent
      // no-op from the UI's perspective; surface as 204.
      this.logger.log(
        `[stopRun] no conversation bound to session agentSessionId=${agentSessionId}`,
      );
      return;
    }

    const result = await this.triggerEmitter.emitStopRunControl({
      runId: agentSessionId,
      conversationId: session.conversationId as ConversationId,
      actingUserId: userId,
      organizationId,
      projectId: session.projectId as ProjectId,
    });

    if (!result.emitted && result.reason === 'owner_mismatch') {
      // Defense-in-depth: the emitter performs an independent owner check
      // against the conversation's resolved recipient. A drift between the
      // session row and the resolver implies stale state — refuse.
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — conversation owner mismatch',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @Post(':agentSessionId/compact')
  @UseGuards(ControllerBindingOriginGuard)
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Compact the active CLI run owning the conversation linked to this agent session',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  @ApiResponse({ status: 204, description: 'Compact control envelope emitted' })
  @ApiResponse({ status: 403, description: 'Cross-user compact attempt' })
  @ApiResponse({ status: 404, description: 'Unknown agent session' })
  async compactRun(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body() dto: CompactRunRequestDto,
    @Req() request?: Request,
  ): Promise<void> {
    const session = await this.agentSessionService.findOne(
      organizationId,
      agentSessionId,
    );

    if (session.userId !== userId) {
      // Cross-user attempt — the acting user must own the agent session.
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — agent session is owned by a different user',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (!session.conversationId) {
      // No conversation is bound yet — there is no Run to compact. Idempotent
      // no-op from the UI's perspective; surface as 204.
      this.logger.log(
        `[compactRun] no conversation bound to session agentSessionId=${agentSessionId}`,
      );
      return;
    }

    if (!session.machineId) {
      throw new HttpException(
        'Agent Session has no bound machine',
        HttpStatus.FORBIDDEN,
      );
    }
    const executionAdmission =
      await this.executionGrantService.assertAgentSessionAuthorized({
        authorization: dto.authorization,
        inputs: {
          kind: 'CONTROL',
          body: {
            kind: 'compact_run',
            agentSessionId: session.id,
            conversationId: session.conversationId as ConversationId,
            runId: agentSessionId,
          },
        },
        organizationId,
        projectId: session.projectId as ProjectId,
        userId,
        controllerBindingSecret: readControllerBindingSecret(request),
        actionCategory: HostActionCategory.AuthorityIncreasingControl,
        actionType: HostAffectingActionType.ConversationControlCompactRun,
        targetKind: HostActionTargetKind.AgentSession,
        agentSessionId: session.id as AgentSessionId,
        conversationId: session.conversationId,
        machineId: session.machineId as MachineId,
      });

    const result = await this.triggerEmitter.emitCompactRunControl({
      agentSessionId: session.id,
      runId: agentSessionId,
      conversationId: session.conversationId as ConversationId,
      actingUserId: userId,
      organizationId,
      projectId: session.projectId as ProjectId,
      authorizationId: executionAdmission.authorizationId,
      envelopeAuthorization: executionAdmission.envelopeAuthorization,
      actionPayloadHash: this.hashExecutionAction(executionAdmission.action),
    });

    if (!result.emitted && result.reason === 'owner_mismatch') {
      // Defense-in-depth: the emitter performs an independent owner check
      // against the conversation's resolved recipient. A drift between the
      // session row and the resolver implies stale state — refuse.
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — conversation owner mismatch',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @Post(':agentSessionId/permission-decision')
  @UseGuards(ControllerBindingOriginGuard)
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Deliver a user permission decision to the CLI run owning the conversation linked to this agent session',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  @ApiResponse({
    status: 204,
    description: 'Permission-decision control envelope emitted',
  })
  @ApiResponse({ status: 403, description: 'Cross-user decision attempt' })
  @ApiResponse({ status: 404, description: 'Unknown agent session' })
  async permissionDecision(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @Body() dto: PermissionDecisionRequestDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Req() request?: Request,
  ): Promise<void> {
    const session = await this.agentSessionService.findOne(
      organizationId,
      agentSessionId,
    );

    if (session.userId !== userId) {
      // Cross-user attempt — the acting user must own the agent session.
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — agent session is owned by a different user',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (!session.conversationId) {
      // No conversation is bound yet — there is no Run awaiting a decision.
      // Idempotent no-op from the UI's perspective; surface as 204.
      this.logger.log(
        `[permissionDecision] no conversation bound to session agentSessionId=${agentSessionId} requestId=${dto.requestId}`,
      );
      return;
    }

    if (!session.machineId) {
      throw new HttpException(
        'Agent Session has no bound machine',
        HttpStatus.FORBIDDEN,
      );
    }
    const executionAdmission =
      await this.executionGrantService.assertAgentSessionAuthorized({
        authorization: dto.authorization,
        inputs: {
          kind: 'CONTROL',
          body: (({ authorization: _proof, ...inputs }) => ({
            kind: 'permission_decision' as const,
            agentSessionId: session.id,
            ...inputs,
          }))(dto),
        },
        organizationId,
        projectId: session.projectId as ProjectId,
        userId,
        controllerBindingSecret: readControllerBindingSecret(request),
        actionCategory: HostActionCategory.AuthorityIncreasingControl,
        actionType:
          HostAffectingActionType.ConversationControlPermissionDecision,
        targetKind: HostActionTargetKind.AgentSession,
        agentSessionId: session.id as AgentSessionId,
        conversationId: session.conversationId,
        machineId: session.machineId as MachineId,
      });

    const result = await this.triggerEmitter.emitPermissionDecisionControl({
      agentSessionId: session.id,
      conversationId: session.conversationId as ConversationId,
      actingUserId: userId,
      organizationId,
      projectId: session.projectId as ProjectId,
      decision: dto.decision,
      requestId: dto.requestId,
      sessionId: dto.sessionId,
      agentType: dto.agentType,
      reason: dto.reason,
      idempotencyToken: dto.idempotencyToken,
      authorizationId: executionAdmission.authorizationId,
      envelopeAuthorization: executionAdmission.envelopeAuthorization,
      actionPayloadHash: this.hashExecutionAction(executionAdmission.action),
    });

    if (!result.emitted && result.reason === 'owner_mismatch') {
      // Defense-in-depth: the emitter performs an independent owner check
      // against the conversation's resolved recipient. A drift between the
      // session row and the resolver implies stale state — refuse.
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — conversation owner mismatch',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  @Post(':agentSessionId/question-answer')
  @UseGuards(ControllerBindingOriginGuard)
  @HttpCode(204)
  @ApiOperation({
    summary:
      "Deliver a user's answers to an agent question to the CLI run owning the conversation linked to this agent session",
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  @ApiResponse({
    status: 204,
    description: 'Question-answer control envelope emitted',
  })
  @ApiResponse({ status: 403, description: 'Cross-user answer attempt' })
  @ApiResponse({ status: 404, description: 'Unknown agent session' })
  async questionAnswer(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @Body() dto: QuestionAnswerRequestDto,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Req() request?: Request,
  ): Promise<void> {
    const session = await this.agentSessionService.findOne(
      organizationId,
      agentSessionId,
    );

    if (session.userId !== userId) {
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — agent session is owned by a different user',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (!session.conversationId) {
      // No conversation is bound yet, so no Run can be waiting on an answer.
      this.logger.log(
        `[questionAnswer] no conversation bound to session agentSessionId=${agentSessionId} requestId=${dto.requestId}`,
      );
      return;
    }

    if (!session.machineId) {
      throw new HttpException(
        'Agent Session has no bound machine',
        HttpStatus.FORBIDDEN,
      );
    }
    const executionAdmission =
      await this.executionGrantService.assertAgentSessionAuthorized({
        authorization: dto.authorization,
        inputs: {
          kind: 'CONTROL',
          body: (({ authorization: _proof, ...inputs }) => ({
            kind: 'question_answer' as const,
            agentSessionId: session.id,
            ...inputs,
          }))(dto),
        },
        organizationId,
        projectId: session.projectId as ProjectId,
        userId,
        controllerBindingSecret: readControllerBindingSecret(request),
        actionCategory: HostActionCategory.Conversation,
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: HostActionTargetKind.AgentSession,
        agentSessionId: session.id as AgentSessionId,
        conversationId: session.conversationId,
        machineId: session.machineId as MachineId,
      });

    this.logger.log(
      `[questionAnswer] emitting agentSessionId=${agentSessionId} requestId=${dto.requestId} answerCount=${Object.keys(dto.answers).length}`,
    );
    const result = await this.triggerEmitter.emitQuestionAnswerControl({
      agentSessionId: session.id,
      conversationId: session.conversationId as ConversationId,
      actingUserId: userId,
      organizationId,
      projectId: session.projectId as ProjectId,
      requestId: dto.requestId,
      sessionId: dto.sessionId,
      agentType: dto.agentType,
      answers: dto.answers,
      idempotencyToken: dto.idempotencyToken,
      authorizationId: executionAdmission.authorizationId,
      envelopeAuthorization: executionAdmission.envelopeAuthorization,
      actionPayloadHash: this.hashExecutionAction(executionAdmission.action),
    });

    if (!result.emitted && result.reason === 'owner_mismatch') {
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — conversation owner mismatch',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private hashExecutionAction(action: HostActionPreparation): string {
    return hashControllerAction(action);
  }

  @Post(':agentSessionId/restart-plan-generation')
  @ApiOperation({
    summary: 'Restart the plan-generation run linked to this agent session',
  })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  @ApiResponse({
    status: 200,
    description:
      'Tore down the prior run and relaunched a fresh PlanFromDesignDoc ' +
      'run from the preserved design doc; returns the new conversation id. ' +
      'An idempotent no-op (nothing bound / already torn down) returns ' +
      'restarted=false with no conversationId.',
  })
  @ApiResponse({ status: 403, description: 'Cross-user restart attempt' })
  @ApiResponse({ status: 404, description: 'Unknown agent session' })
  async restartPlanGeneration(
    @Param('agentSessionId', ParseUUIDPipe) agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
  ): Promise<RestartPlanGenerationResponseDto> {
    const session = await this.agentSessionService.findOne(
      organizationId,
      agentSessionId,
    );

    if (session.userId !== userId) {
      // Cross-user attempt — the acting user must own the agent session.
      throw new HttpException(
        {
          success: false,
          message: 'Forbidden — agent session is owned by a different user',
          code: 'OWNER_MISMATCH',
          timestamp: new Date().toISOString(),
          statusCode: HttpStatus.FORBIDDEN,
        },
        HttpStatus.FORBIDDEN,
      );
    }

    if (session.entityType !== 'TASK' || !session.entityId) {
      throw new BadRequestException(
        'Plan generation session must reference a PLAN work item',
      );
    }
    await this.planGenerationService.reset(
      organizationId,
      _projectId,
      session.entityId as TaskId,
      userId,
    );
    const replacement = await this.planGenerationService.prepare(
      organizationId,
      _projectId,
      session.entityId as TaskId,
      userId,
    );
    if (!replacement.conversationId)
      throw new Error('Prepared Plan generation session has no conversation');
    return { restarted: true, conversationId: replacement.conversationId };
  }

  @Delete(':agentSessionId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an agent session' })
  @ApiParam({ name: 'organizationId', description: 'Organization ID' })
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiParam({ name: 'agentSessionId', description: 'Agent session ID' })
  async remove(
    @Param('agentSessionId') agentSessionId: string,
    @Param('projectId', ParseUUIDPipe) _projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<void> {
    await this.agentSessionService.remove(organizationId, agentSessionId);
  }
}

import { ProjectAccessGuard } from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { validate as isUuid, v4 as uuidv4 } from 'uuid';
import * as crypto from 'node:crypto';
import {
  AgentOperation as PersistedAgentOperation,
  AgentOperationKind as PrismaAgentOperationKind,
  AgentOperationState as PrismaAgentOperationState,
} from '@prisma/client';
import {
  ConversationId,
  AgentSessionId,
  MachineId,
  MessageId,
  MockLlmSessionId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from 'src/types';
import {
  CurrentOrganization,
  CurrentUser,
} from '../auth/decorators/current-user.decorator';
import { OrganizationGuard } from '../auth/guards/organization.guard';
import { VersionConflictException } from '../core/exceptions/version-conflict.exception';
import { ConversationWorkflowError } from '../core/exceptions/workflow.exceptions';
import { WebsocketConnectionManager } from '../core/websockets/websocket-connection-manager.service';
import {
  AgentTriggerStartRun,
  AvailableSkipNodesResponseDto,
  CloneConversationDto,
  ConversationCliStatusResponseDto,
  ConversationResponseDto,
  ConversationStartResponseDto,
  ConversationTriggerRetryResponseDto,
  ConversationStartRunRequestDto,
  ConversationStartRunResponseDto,
  ConversationStatus,
  ConversationVersionResponseDto,
  CreateConversationDto,
  CreateOnboardingConversationDto,
  InitiationType,
  MessageStatus,
  MachineExecutionReadinessState,
  MessageType,
  PaginatedConversationResponse,
  SkipToNodeRequestDto,
  MessageResponseDto,
  SkipToNodeResponseDto,
  SystemMessageData,
  UpdateConversationDto,
  UserMessageData,
  WorkflowName,
  RunCreatePayload,
  RunCreatePayloadWorkflowKickoff,
  RunEntityReference,
  HostActionTargetKind,
  HostAffectingActionType,
  SubmitWorkflowAnswerRequestDto,
  SubmitWorkflowAnswerResponseDto,
} from '../generated';
import { AgentSessionService } from '../services/agent-session.service';
import { EvalRunService } from '../services/eval-runs/eval-run.service';
import { ProposalAgentFixService } from '../services/proposal/proposal-agent-fix.service';
import { ProjectReportLaunchService } from '../services/project-reports/project-report-launch.service';
import {
  ExecutionGrantService,
  type InteractiveGrantAdmission,
} from '../services/controller-authorization/execution-grant.service';
import { canonicalizeJcs } from '../core/websockets/trigger-canonicalization';
import { MachineExecutionReadinessService } from '../services/machine-pairing/machine-execution-readiness.service';
import { ConversationService } from '../services/conversation.service';
import {
  CreateMessageInput,
  MessageService,
} from '../services/message.service';
import {
  hasCompleteOnboardingMockProviderConfiguration,
  MOCK_LLM_SESSION_CONTEXT_KEY,
  MOCK_LLM_SESSION_HEADER,
} from '../services/llm/mock-llm-routing';
import { ConversationWorkflowService } from '../services/workflows/conversation-workflow.service';
import { FlowExecutionService } from '../services/workflows/flow-execution.service';
import { NodeExecutionService } from '../services/workflows/node-execution.service';
import { WorkflowExecutionService } from '../services/workflows/workflow-execution.service';
import { WorkflowRouterService } from '../services/workflows/workflow-router.service';
import { FlowContext } from '../types/flow-internal.types';
import { isSerializableWorkflowState } from '../workflows/conversation-workflow-state';
import { AgentOperationRegistryService } from '../services/agent-operation/agent-operation-registry.service';
import { AgentOperationSubmissionService } from '../services/agent-operation/agent-operation-submission.service';
import { AgentOperationWorkflowAnswerService } from '../services/agent-operation/agent-operation-workflow-answer.service';
import type { Request } from 'express';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import { PendingTriggerService } from '../services/workflows/pending-trigger.service';
import { TriggerEmitter } from '../core/websockets/trigger-emitter.service';

function isOnboardingCreateConversationDto(
  dto: CreateConversationDto,
): dto is CreateOnboardingConversationDto {
  return dto.workflowName === WorkflowName.Onboarding;
}

const WORKFLOW_START_READINESS_DELAYS_MS = [0, 50, 100, 200, 400] as const;

// Query parameter DTOs - these should match your OpenAPI spec parameters
export class GetConversationsQueryDto {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  status?: ConversationStatus | ConversationStatus[];
  workflowName?: string | string[];
  workflowAboutId?: string;
  workflowAboutType?: string;
  initiatedBy?: InitiationType;
  search?: string;
  includeSuggestionDecisions?: boolean | string;
}

export class GetActiveConversationsQueryDto {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  workflowName?: string;
  initiatedBy?: InitiationType;
  search?: string;
  includeSuggestionDecisions?: boolean | string;
}

export class GetInitiativeConversationsQueryDto {
  page?: number;
  limit?: number;
  sortBy?: 'createdAt' | 'updatedAt' | 'title';
  sortOrder?: 'asc' | 'desc';
  status?: ConversationStatus | ConversationStatus[];
  workflowName?: string;
}

// Custom interface that matches the actual OpenAPI spec responses
interface IConversationControllerSpec {
  createConversation(
    projectId: ProjectId,
    organizationId: OrganizationId,
    createConversationDto: CreateConversationDto,
    mockLlmSessionHeader?: string,
  ): Promise<ConversationResponseDto>;

  getActiveConversations(
    projectId: ProjectId,
    organizationId: OrganizationId,
    queryParams?: GetActiveConversationsQueryDto,
  ): Promise<PaginatedConversationResponse>;

  getAllConversations(
    projectId: ProjectId,
    organizationId: OrganizationId,
    queryParams?: GetConversationsQueryDto,
  ): Promise<PaginatedConversationResponse>;

  getConversation(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    includeSuggestionDecisions?: string,
  ): Promise<ConversationResponseDto>;

  getVersion(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<ConversationVersionResponseDto>;

  getCliStatus(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    callerUserId: UserId,
  ): Promise<ConversationCliStatusResponseDto>;

  retryConversationOpenTrigger(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<ConversationTriggerRetryResponseDto>;

  updateConversation(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    updateConversationDto: UpdateConversationDto,
  ): Promise<ConversationResponseDto>;

  startConversation(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<ConversationStartResponseDto>;

  startConversationRun(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    callerUserId: UserId,
    requestDto: ConversationStartRunRequestDto,
  ): Promise<ConversationStartRunResponseDto>;

  submitWorkflowAnswer(
    projectId: ProjectId,
    agentSessionId: AgentSessionId,
    organizationId: OrganizationId,
    callerUserId: UserId,
    requestDto: SubmitWorkflowAnswerRequestDto,
  ): Promise<SubmitWorkflowAnswerResponseDto>;

  skipToNode(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
    skipToNodeDto: SkipToNodeRequestDto,
  ): Promise<SkipToNodeResponseDto>;

  getAvailableSkipNodes(
    projectId: ProjectId,
    conversationId: ConversationId,
    organizationId: OrganizationId,
  ): Promise<AvailableSkipNodesResponseDto>;
}

// Submission stamps the admitted Service scope after this request is built, so
// a replayed request compares against the persisted trigger without it.
function withoutAdmittedServiceScope(
  data: SystemMessageData,
): SystemMessageData {
  const trigger = data.triggersAgent as AgentTriggerStartRun | undefined;
  if (!trigger?.admittedServiceScope) return data;
  const { admittedServiceScope: _admitted, ...rest } = trigger;
  return { ...data, triggersAgent: rest };
}

@Controller('api/v1/organizations/:organizationId/projects/:projectId')
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class ConversationController implements IConversationControllerSpec {
  private readonly logger = new Logger(ConversationController.name);

  constructor(
    private readonly conversationService: ConversationService,
    private readonly messageService: MessageService,
    private readonly conversationWorkflowService: ConversationWorkflowService,
    private readonly workflowExecutionService: WorkflowExecutionService,
    private readonly flowEngineService: NodeExecutionService,
    private readonly workflowRouterService: WorkflowRouterService,
    private readonly flowExecutionService: FlowExecutionService,
    private readonly connectionManager: WebsocketConnectionManager,
    private readonly agentSessionService: AgentSessionService,
    private readonly machineExecutionReadinessService: MachineExecutionReadinessService,
    private readonly executionGrantService: ExecutionGrantService,
    private readonly agentOperationRegistry: AgentOperationRegistryService,
    private readonly pendingTriggerService: PendingTriggerService,
    private readonly triggerEmitter: TriggerEmitter,
    private readonly projectReportLaunchService: ProjectReportLaunchService,
    private readonly evalRunService: EvalRunService,
    private readonly proposalAgentFixService: ProposalAgentFixService,
    @Optional()
    private readonly agentOperationSubmission?: AgentOperationSubmissionService,
    @Optional()
    private readonly agentOperationWorkflowAnswer?: AgentOperationWorkflowAnswerService,
  ) {}

  @Post('conversations/:conversationId/retry-open-trigger')
  @HttpCode(HttpStatus.OK)
  async retryConversationOpenTrigger(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @Param('organizationId') organizationId: OrganizationId,
  ): Promise<ConversationTriggerRetryResponseDto> {
    this.logger.log('retry-open-trigger requested', {
      conversationId,
      organizationId,
      projectId,
    });
    const pending =
      await this.pendingTriggerService.resolveLatestOpenTriggerForConversation(
        conversationId,
      );
    if (!pending.triggerMessageId) {
      throw new NotFoundException(
        'No open trigger exists for the current workflow node',
      );
    }

    await this.triggerEmitter.emitConversationTriggerForMessage({
      conversationId,
      messageId: pending.triggerMessageId,
      organizationId,
      projectId,
    });

    this.logger.log('retry-open-trigger emission accepted', {
      conversationId,
      triggerMessageId: pending.triggerMessageId,
    });
    return { accepted: true, triggerMessageId: pending.triggerMessageId };
  }

  private startRunFingerprint(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId: ConversationId;
    requestDto: ConversationStartRunRequestDto;
  }): string {
    const {
      authorization: _authorization,
      operationId: _operationId,
      operationFingerprint: _operationFingerprint,
      ...request
    } = params.requestDto;
    return crypto
      .createHash('sha256')
      .update(
        canonicalizeJcs({
          kind: 'START_RUN',
          organizationId: params.organizationId,
          projectId: params.projectId,
          conversationId: params.conversationId,
          request,
        }),
        'utf8',
      )
      .digest('hex');
  }

  private recordedStartRunResponse(
    operation: PersistedAgentOperation,
  ): ConversationStartRunResponseDto {
    if (
      operation.triggerMessageId &&
      (operation.state === PrismaAgentOperationState.SUCCEEDED ||
        operation.state === PrismaAgentOperationState.DISPATCH_PENDING)
    ) {
      return {
        dispatched: true,
        operationId: operation.operationId,
        operationFingerprint: operation.fingerprint,
        operationState:
          operation.state === PrismaAgentOperationState.SUCCEEDED
            ? 'SUCCEEDED'
            : 'DISPATCH_PENDING',
        triggerMessageId: operation.triggerMessageId as MessageId,
      };
    }
    if (operation.state === PrismaAgentOperationState.RECONCILING) {
      if (!operation.triggerMessageId) {
        throw new ConflictException({
          code: 'AGENT_OPERATION_CORRELATION_MISSING',
          message: 'The reconciling operation is missing its trigger message.',
        });
      }
      return {
        dispatched: true,
        operationId: operation.operationId,
        operationFingerprint: operation.fingerprint,
        operationState: 'RECONCILING',
        triggerMessageId: operation.triggerMessageId as MessageId,
      };
    }
    throw new ConflictException({
      code: operation.failureCode ?? 'AGENT_OPERATION_TERMINAL',
      message:
        operation.failureMessage ??
        'The operation is terminal and cannot be restarted.',
    });
  }

  private async waitForWorkflowUserMessageSignalReadyBeforeKickoff(params: {
    workflowId: WorkflowId;
    conversationId: ConversationId;
    organizationId: OrganizationId;
    projectId: ProjectId;
  }): Promise<void> {
    for (const delayMs of WORKFLOW_START_READINESS_DELAYS_MS) {
      if (delayMs > 0) {
        await this.sleep(delayMs);
      }

      const workflowIsReady =
        await this.workflowRouterService.isWorkflowUserMessageSignalReady(
          params.workflowId,
        );
      if (workflowIsReady) {
        return;
      }
    }

    this.logger.warn(
      '[ConversationController] deferred workflow did not become user-message signal ready before kickoff',
      params,
    );

    throw new ServiceUnavailableException({
      success: false,
      message: 'Workflow did not become ready for kickoff message dispatch',
      code: 'WORKFLOW_START_TIMEOUT',
      workflowId: params.workflowId,
      conversationId: params.conversationId,
      timestamp: new Date().toISOString(),
      statusCode: 503,
      path: `/organizations/${params.organizationId}/projects/${params.projectId}/conversations/${params.conversationId}/start-run`,
    });
  }

  private async sleep(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  private validateWorkflowStartRunEntity(
    payload: RunCreatePayload | undefined,
  ): RunEntityReference | undefined {
    if (payload === undefined) {
      this.logger.debug(
        '[ConversationController] startConversationRun focal validation accepted bind-only workflow launch',
        {
          event: 'start_run.focal_validation.accepted',
          focalScope: 'bind_only',
        },
      );
      return undefined;
    }

    if (
      payload.promptType !==
      RunCreatePayloadWorkflowKickoff.PromptTypeEnum.WorkflowKickoff
    ) {
      this.logger.debug(
        '[ConversationController] startConversationRun focal validation rejected workflow payload',
        {
          event: 'start_run.focal_validation.rejected',
          payloadPromptType: payload.promptType,
          reason: 'workflow_payload_must_be_workflow_kickoff',
        },
      );
      throw new BadRequestException({
        code: 'INVALID_START_RUN_FOCAL_ENTITY',
        message:
          'Workflow start-run payload must be the workflow_kickoff variant when present',
      });
    }

    const entity = payload.entity;
    if (entity === undefined) {
      this.logger.debug(
        '[ConversationController] startConversationRun focal validation accepted explicit unscoped launch',
        {
          event: 'start_run.focal_validation.accepted',
          focalScope: 'unscoped',
        },
      );
      return undefined;
    }

    const entityTypeIsValid =
      entity !== null &&
      Object.values(RunEntityReference.EntityTypeEnum).includes(
        entity.entityType,
      );
    if (
      !entity ||
      !entityTypeIsValid ||
      typeof entity.entityId !== 'string' ||
      !isUuid(entity.entityId)
    ) {
      this.logger.debug(
        '[ConversationController] startConversationRun focal validation rejected entity declaration',
        {
          event: 'start_run.focal_validation.rejected',
          entityType:
            entity && typeof entity.entityType === 'string'
              ? entity.entityType
              : undefined,
          entityId:
            entity && typeof entity.entityId === 'string'
              ? entity.entityId
              : undefined,
          reason: 'malformed_entity_declaration',
        },
      );
      throw new BadRequestException({
        code: 'INVALID_START_RUN_FOCAL_ENTITY',
        message:
          'Start-run payload.entity must contain a supported entityType and UUID entityId',
      });
    }

    this.logger.debug(
      '[ConversationController] startConversationRun focal validation accepted scoped launch',
      {
        event: 'start_run.focal_validation.accepted',
        focalScope: 'entity',
        entityType: entity.entityType,
        entityId: entity.entityId,
      },
    );
    return entity;
  }

  @Post('conversations')
  async createConversation(
    @Param('projectId') projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() createConversationDto: CreateConversationDto,
    @Headers(MOCK_LLM_SESSION_HEADER) mockLlmSessionHeader?: string,
    @CurrentUser('userId') callerUserId?: UserId,
  ): Promise<ConversationResponseDto> {
    if (
      createConversationDto.projectId &&
      createConversationDto.projectId !== projectId
    ) {
      throw new BadRequestException(
        'Project ID in request body must match the route parameter',
      );
    }

    const mockLlmSessionId = this.resolveMockLlmSessionId(
      createConversationDto,
      mockLlmSessionHeader,
    );

    let dto: CreateConversationDto = {
      ...createConversationDto,
      projectId,
      organizationId,
    };
    if (
      mockLlmSessionId &&
      isOnboardingCreateConversationDto(createConversationDto)
    ) {
      const context: CreateOnboardingConversationDto['context'] & {
        [MOCK_LLM_SESSION_CONTEXT_KEY]: MockLlmSessionId;
      } = {
        ...createConversationDto.context,
        [MOCK_LLM_SESSION_CONTEXT_KEY]: mockLlmSessionId,
      };
      dto = {
        ...createConversationDto,
        projectId,
        organizationId,
        context,
      };
    }

    try {
      const result = callerUserId
        ? await this.conversationWorkflowService.createConversation(
            dto,
            organizationId,
            { userId: callerUserId },
          )
        : await this.conversationWorkflowService.createConversation(
            dto,
            organizationId,
          );
      return result.conversation;
    } catch (error) {
      if (error instanceof ConversationWorkflowError) {
        throw new HttpException(
          {
            success: false,
            message: error.message,
            code: 'WORKFLOW_ERROR',
            context: error.context,
            timestamp: new Date().toISOString(),
            statusCode: 400,
            path: `/organizations/${organizationId}/projects/${projectId}/conversations`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }
      throw error;
    }
  }

  private resolveMockLlmSessionId(
    createConversationDto: CreateConversationDto,
    rawHeader: string | undefined,
  ): MockLlmSessionId | undefined {
    if (rawHeader === undefined) return undefined;

    if (createConversationDto.workflowName !== WorkflowName.Onboarding) {
      throw new BadRequestException(
        `${MOCK_LLM_SESSION_HEADER} is accepted only for onboarding`,
      );
    }
    if (!hasCompleteOnboardingMockProviderConfiguration()) {
      throw new BadRequestException(
        `${MOCK_LLM_SESSION_HEADER} requires explicit mock-provider configuration`,
      );
    }

    const value = rawHeader.trim();
    if (!isUuid(value)) {
      throw new BadRequestException(
        `${MOCK_LLM_SESSION_HEADER} must be a UUID`,
      );
    }
    return value as MockLlmSessionId;
  }

  @Get('conversations/active')
  async getActiveConversations(
    @Param('projectId') projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query() queryParams?: GetActiveConversationsQueryDto,
  ): Promise<PaginatedConversationResponse> {
    return this.conversationService.getActiveConversationsFromAdapter(
      projectId,
      organizationId,
      {
        ...(queryParams || {}),
        includeSuggestionDecisions:
          queryParams?.includeSuggestionDecisions === true ||
          queryParams?.includeSuggestionDecisions === 'true',
      },
    );
  }

  @Get('conversations')
  async getAllConversations(
    @Param('projectId') projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query() queryParams?: GetConversationsQueryDto,
  ): Promise<PaginatedConversationResponse> {
    const workflowNames = this.normalizeWorkflowNames(
      queryParams?.workflowName,
    );
    const statuses = this.normalizeStatus(queryParams?.status);

    const normalizedQueryParams = {
      ...(queryParams || {}),
      includeSuggestionDecisions:
        queryParams?.includeSuggestionDecisions === true ||
        queryParams?.includeSuggestionDecisions === 'true',
      ...(queryParams?.workflowName !== undefined
        ? { workflowName: workflowNames }
        : {}),
      ...(queryParams?.status !== undefined ? { status: statuses } : {}),
    };

    return this.conversationService.getAllConversationsFromAdapter(
      projectId,
      organizationId,
      normalizedQueryParams,
    );
  }

  @Get('conversations/:conversationId')
  async getConversation(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Query('includeSuggestionDecisions') includeSuggestionDecisions?: string,
  ): Promise<ConversationResponseDto> {
    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        conversationId,
        organizationId,
        {
          includeSuggestionDecisions: includeSuggestionDecisions === 'true',
        },
      );
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }
    return conversation;
  }

  @Get('conversations/:conversationId/version')
  async getVersion(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ConversationVersionResponseDto> {
    const version = await this.conversationService.getConversationVersion(
      projectId,
      conversationId,
      organizationId,
    );

    return { version };
  }

  @Get('conversations/:conversationId/cli-status')
  async getCliStatus(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') callerUserId: UserId,
  ): Promise<ConversationCliStatusResponseDto> {
    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        conversationId,
        organizationId,
      );
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const selection = await this.conversationService.getOwnerMachineSelection(
      conversationId,
      organizationId,
    );

    if (!selection) {
      this.logger.verbose(
        '[ConversationController] cli-status: no owner agent session yet',
        { conversationId, callerUserId },
      );
      return {
        connected: false,
        selectedMachineId: null,
        authorizationProtocolVersion: null,
        executionReadiness: MachineExecutionReadinessState.NoMachineSelected,
      };
    }

    const connected = this.connectionManager.hasCliConnectionForUser(
      selection.userId,
    );
    const readiness = selection.machineId
      ? await this.machineExecutionReadinessService.resolve({
          machineId: selection.machineId,
          userId: selection.userId,
          organizationId,
        })
      : null;
    this.logger.verbose('[ConversationController] cli-status resolved', {
      conversationId,
      callerUserId,
      ownerUserId: selection.userId,
      connected,
    });
    return {
      connected,
      selectedMachineId: readiness?.machineId ?? selection.machineId,
      authorizationProtocolVersion:
        readiness?.authorizationProtocolVersion ?? null,
      executionReadiness:
        readiness?.executionReadiness ??
        MachineExecutionReadinessState.NoMachineSelected,
    };
  }

  @Get('conversations/:conversationId/messages/latest')
  async getLatestMessage(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<MessageResponseDto | null> {
    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        conversationId,
        organizationId,
      );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return this.messageService.getLatestMessage(conversationId, organizationId);
  }

  @Patch('conversations/:conversationId')
  async updateConversation(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() updateConversationDto: UpdateConversationDto,
  ): Promise<ConversationResponseDto> {
    try {
      const updatedConversation =
        await this.conversationService.updateConversationFromAdapter(
          projectId,
          conversationId,
          organizationId,
          updateConversationDto,
        );
      if (!updatedConversation) {
        throw new NotFoundException('Conversation not found');
      }
      return updatedConversation;
    } catch (error) {
      if (error instanceof VersionConflictException) {
        throw new HttpException(
          {
            success: false,
            message: error.message,
            code: 'VERSION_CONFLICT',
            expectedVersion: error.expectedVersion,
            actualVersion: error.actualVersion,
            conflictingFields: error.conflictingFields,
            timestamp: new Date().toISOString(),
            statusCode: 409,
            path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}`,
          },
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  @Delete('conversations/:conversationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteConversation(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') callerUserId: UserId,
    @Body() deleteOptions?: { reason?: string; hardDelete?: boolean },
  ): Promise<void> {
    try {
      await this.conversationService.deleteConversationFromAdapter(
        projectId,
        conversationId,
        organizationId,
        callerUserId,
        deleteOptions?.reason,
        deleteOptions?.hardDelete ?? false,
      );
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Conversation not found');
      }

      if (error instanceof ConversationWorkflowError) {
        throw new HttpException(
          {
            success: false,
            message: error.message,
            code: 'WORKFLOW_ERROR',
            context: error.context,
            timestamp: new Date().toISOString(),
            statusCode: 400,
            path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw error;
    }
  }

  @Post('conversations/:conversationId/clone')
  async cloneConversation(
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: string,
    @Body() cloneDto: CloneConversationDto,
  ): Promise<{
    conversation: ConversationResponseDto;
    cloneMetadata: {
      sourceConversationId: string;
      targetNodeId: string;
      messagesCloned: number;
      initiativesCloned: number;
    };
  }> {
    try {
      // Validate that the conversation belongs to the project
      const sourceConversation =
        await this.conversationService.getConversationFromAdapter(
          projectId,
          conversationId as ConversationId,
          organizationId,
        );

      if (!sourceConversation) {
        throw new NotFoundException('Source conversation not found');
      }

      // Perform the clone operation
      const result = await this.conversationService.cloneConversation(
        conversationId as ConversationId,
        organizationId,
        {
          targetNodeId: cloneDto.targetNodeId,
          title: cloneDto.title,
        },
        userId,
        sourceConversation.workflowName,
      );

      return result;
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }

      if (error instanceof BadRequestException) {
        throw new HttpException(
          {
            success: false,
            message: error.message,
            code: 'INVALID_CLONE_PARAMS',
            timestamp: new Date().toISOString(),
            statusCode: 400,
            path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}/clone`,
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to clone conversation',
          code: 'CLONE_ERROR',
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
          statusCode: 500,
          path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}/clone`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('workflows/:workflowName/:workflowAboutId/conversations')
  async getWorkflowConversations(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Param('workflowName') workflowName: string,
    @Param('workflowAboutId') workflowAboutId: string,
    @Query() queryParams?: GetInitiativeConversationsQueryDto,
  ): Promise<PaginatedConversationResponse> {
    const statuses = this.normalizeStatus(queryParams?.status);
    return this.conversationService.getConversationsByWorkflowEntityFromAdapter(
      organizationId,
      projectId,
      workflowAboutId,
      workflowName,
      {
        ...(queryParams || {}),
        status: statuses,
      },
    );
  }

  @Post('conversations/:conversationId/start')
  async startConversation(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<ConversationStartResponseDto> {
    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        conversationId,
        organizationId,
      );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    switch (conversation.status) {
      case ConversationStatus.NotStarted: {
        const result =
          await this.conversationWorkflowService.startConversationWorkflow(
            conversationId,
            organizationId,
          );
        return {
          status: result.conversation.status,
          started: true,
          ...(result.workflowId
            ? { workflowId: result.workflowId as WorkflowId }
            : {}),
        };
      }

      case ConversationStatus.Started:
      case ConversationStatus.InProgress:
      case ConversationStatus.GeneratingResponse:
      case ConversationStatus.Recoverable: {
        return {
          status: conversation.status,
          started: false,
          ...(conversation.workflowId
            ? { workflowId: conversation.workflowId as WorkflowId }
            : {}),
        };
      }

      case ConversationStatus.Completed:
      case ConversationStatus.Failed:
      case ConversationStatus.Deleted:
      default: {
        throw new HttpException(
          {
            success: false,
            message: `Conversation is in terminal state '${conversation.status}' and cannot be started`,
            code: 'CONVERSATION_TERMINAL_STATE',
            currentStatus: conversation.status,
            timestamp: new Date().toISOString(),
            statusCode: 409,
            path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}/start`,
          },
          HttpStatus.CONFLICT,
        );
      }
    }
  }

  @Post('conversations/:conversationId/start-run')
  @UseGuards(ControllerBindingOriginGuard)
  async startConversationRun(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') callerUserId: UserId,
    @Body() requestDto: ConversationStartRunRequestDto,
    @Req() request?: Request,
    machineEffectAdmission?: InteractiveGrantAdmission,
    acceptedFingerprint?: string,
  ): Promise<ConversationStartRunResponseDto> {
    if (!requestDto.machineId) {
      throw new BadRequestException({
        code: 'INVALID_MACHINE_ID',
        message: 'machineId is required for start-run requests.',
      });
    }
    if (!machineEffectAdmission && !requestDto.authorization) {
      this.logger.warn(
        '[ConversationController] startConversationRun rejected missing controller authorization',
        {
          organizationId,
          projectId,
          conversationId,
          agentSessionId: requestDto.agentSessionId,
        },
      );
      throw new BadRequestException({
        code: 'INVALID_CONTROLLER_AUTHORIZATION',
        message: 'authorization is required for start-run requests.',
      });
    }
    const fastModeSelection =
      requestDto.fastMode === undefined
        ? 'omitted'
        : requestDto.fastMode
          ? 'enabled'
          : 'disabled';
    this.logger.log('[ConversationController] startConversationRun enter', {
      conversationId,
      projectId,
      organizationId,
      callerUserId,
      handlerPromptType: requestDto.handlerPromptType,
      model: requestDto.model,
      provider: requestDto.provider,
      reasoningEffort: requestDto.reasoningEffort,
      fastModeSelection,
      serviceIds: requestDto.serviceIds,
      launchServiceId: requestDto.launchServiceId,
      worktreeEnabled: requestDto.worktree?.enabled ?? false,
      worktreeBranch: requestDto.worktree?.branch,
      agentSessionId: requestDto.agentSessionId,
    });

    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        conversationId,
        organizationId,
      );
    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const ownerUserId = await this.conversationService.getOwnerUserId(
      conversationId,
      organizationId,
    );
    if (!ownerUserId || ownerUserId !== callerUserId) {
      this.logger.log(
        '[ConversationController] startConversationRun: caller is not conversation owner',
        { conversationId, callerUserId, ownerUserId },
      );
      throw new ForbiddenException(
        'Only the conversation owner can dispatch a CLI run',
      );
    }

    const projectReportBinding =
      await this.projectReportLaunchService.assertStartRun({
        organizationId,
        projectId,
        userId: callerUserId,
        conversationId,
        requestDto,
      });

    await this.evalRunService.assertStartRun({
      organizationId,
      projectId,
      userId: callerUserId,
      conversationId,
      requestDto,
    });

    await this.proposalAgentFixService.assertStartRun({
      organizationId,
      projectId,
      userId: callerUserId,
      conversationId,
      requestDto,
    });

    const expectedFingerprint =
      acceptedFingerprint ??
      this.startRunFingerprint({
        organizationId,
        projectId,
        conversationId,
        requestDto,
      });
    if (requestDto.operationFingerprint !== expectedFingerprint) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_FINGERPRINT_INVALID',
        message: 'The operation fingerprint does not match the start request.',
      });
    }
    let executionAdmission: InteractiveGrantAdmission;
    try {
      executionAdmission =
        machineEffectAdmission ??
        (await this.executionGrantService.assertInteractiveAuthorized({
          authorization: requestDto.authorization!,
          organizationId,
          projectId,
          userId: callerUserId,
          controllerBindingSecret: readControllerBindingSecret(request),
          actionType: HostAffectingActionType.ConversationTrigger,
          targetKind: HostActionTargetKind.AgentSession,
          targetId: requestDto.agentSessionId,
          conversationId,
          agentSessionId: requestDto.agentSessionId as AgentSessionId,
          ...(requestDto.machineId
            ? { machineId: requestDto.machineId as MachineId }
            : {}),
        }));
    } catch (error) {
      if (projectReportBinding) {
        await this.projectReportLaunchService.failLaunch(
          projectReportBinding.requestId,
          projectReportBinding.attemptId,
          'AUTHORIZATION_FAILED',
        );
      }
      throw error;
    }
    const begunOperation = await this.agentOperationRegistry.begin({
      operationId: requestDto.operationId,
      organizationId,
      projectId,
      userId: callerUserId,
      agentSessionId: requestDto.agentSessionId as AgentSessionId,
      conversationId,
      kind: PrismaAgentOperationKind.START_RUN,
      fingerprint: requestDto.operationFingerprint,
    });
    if (begunOperation.disposition !== 'EXECUTE') {
      const recorded =
        begunOperation.disposition === 'JOIN'
          ? await this.agentOperationRegistry.waitForTerminal(
              requestDto.operationId,
            )
          : begunOperation.operation;
      return this.recordedStartRunResponse(recorded);
    }
    const reservedIds = this.agentOperationRegistry.reservedMessageIds(
      begunOperation.operation,
    );
    let operationCommitted = false;
    let launchClaimed = false;
    let launchClaimLost = false;

    try {
      await this.agentOperationRegistry.recordAuthorization(
        requestDto.operationId,
        begunOperation.executionOwner,
        executionAdmission.authorizationId,
        executionAdmission.envelopeAuthorization.kind,
      );

      const isWorkflowArm = requestDto.workflowName != null;
      const startRunBinding =
        await this.agentSessionService.resolveStartRunConversationBinding({
          organizationId,
          projectId,
          agentSessionId: requestDto.agentSessionId,
          conversationId,
          conversationWorkflowName: conversation.workflowName,
          requestedWorkflowName: requestDto.workflowName,
        });
      const isRepositoryImportMaterialization =
        startRunBinding.kind === 'REPOSITORY_IMPORT_MATERIALIZATION' ||
        startRunBinding.kind === 'WORK_TRACKER_IMPORT_MATERIALIZATION';
      const focalEntity = isWorkflowArm
        ? this.validateWorkflowStartRunEntity(requestDto.payload)
        : undefined;
      const focalScope = !isWorkflowArm
        ? 'turn_firing_payload'
        : requestDto.payload === undefined
          ? 'bind_only'
          : focalEntity
            ? 'entity'
            : 'unscoped';

      const resolvedStartRunConfig =
        await this.agentSessionService.resolveStartRunConfiguration({
          organizationId,
          agentSessionId: requestDto.agentSessionId,
          taskMonitorId: requestDto.contextMetadata.taskMonitorId,
          config: requestDto.config,
        });
      const startRunConfig = resolvedStartRunConfig ?? requestDto.config;

      launchClaimed = await this.agentSessionService.claimStartRunLaunch(
        organizationId,
        requestDto.agentSessionId,
      );
      if (!launchClaimed) {
        launchClaimLost = true;
        this.logger.log(
          '[ConversationController] startConversationRun duplicate launch suppressed',
          {
            conversationId,
            ownerUserId,
            agentSessionId: requestDto.agentSessionId,
          },
        );
        throw new ConflictException({
          success: false,
          message: 'Agent session has already been launched',
          code: 'START_RUN_ALREADY_LAUNCHED',
          timestamp: new Date().toISOString(),
          statusCode: 409,
          path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}/start-run`,
        });
      }

      const initialMessage = requestDto.initialMessage;
      const pregeneratedMessageId = reservedIds.triggerMessageId;
      const persistedTriggerMessage = await this.messageService.getMessage(
        pregeneratedMessageId,
        organizationId,
        false,
      );
      if (
        persistedTriggerMessage &&
        (persistedTriggerMessage.conversationId !== conversationId ||
          persistedTriggerMessage.projectId !== projectId)
      ) {
        await this.agentSessionService.releaseStartRunLaunchClaim(
          organizationId,
          requestDto.agentSessionId,
        );
        throw new ConflictException(
          'The authorization request is already bound to another message',
        );
      }
      const isPersistedOperationReplay = Boolean(persistedTriggerMessage);
      const additionalMessages: CreateMessageInput[] = [];
      let userKickoffMessage: CreateMessageInput | undefined;
      // `triggersAgent` governs dispatch orthogonally to role and defaults to
      // true, so every existing launch path keeps dispatching. A SYSTEM seed with
      // `triggersAgent: false` is the non-dispatching mode: the greeting is the
      // standing first row, the Run is materialized, but no first turn fires.
      const suppressDispatch =
        requestDto.triggersAgent === false ||
        (initialMessage?.role === MessageType.System &&
          initialMessage.triggersAgent === false);

      if (
        !isPersistedOperationReplay &&
        initialMessage?.role === MessageType.System
      ) {
        const greetingId = uuidv4() as MessageId;
        // QUESTIONS is the passive-greeting render type the refiners seed their
        // synthetic opener as; it carries no `triggersAgent` and no dispatch gate,
        // so the run still boots exclusively from the SYSTEM start_run row below.
        const greetingData: SystemMessageData = {
          type: SystemMessageData.TypeEnum.Questions,
          response: '',
        };

        this.logger.log(
          '[ConversationController] startConversationRun authoring SYSTEM initialMessage greeting',
          {
            conversationId,
            greetingId,
            ownerUserId,
            role: initialMessage.role,
            handlerPromptType: requestDto.handlerPromptType,
          },
        );

        additionalMessages.push({
          id: greetingId,
          type: 'SYSTEM',
          conversationId,
          projectId,
          status: MessageStatus.Completed,
          data: greetingData,
        });
      }

      // Two start_run arms, distinguished by `workflowName`:
      //   - Workflow-orchestrated (materialize-only): `workflowName` is set and
      //     no `handlerPromptType`/`payload` rides. The CLI materializes the Run
      //     and binds the conversation but fires no turn; the Temporal workflow
      //     drives every turn via its own SYSTEM triggers.
      //   - Turn-firing: `handlerPromptType` + `payload` ride and the CLI fires
      //     the first turn.
      // Both arms: turn-firing carries the kickoff as the payload's typed
      // userMessage field; the workflow arm pairs `workflowName` with the
      // `workflow_kickoff` payload that carries both kickoff text and the
      // optional canonical focal entity into Run materialization.
      const kickoffText =
        requestDto.payload && 'userMessage' in requestDto.payload
          ? requestDto.payload.userMessage
          : undefined;
      // Workflow arms always need a canonical USER row, even when the launch
      // carries no user-authored text. The empty CONTROL row is the durable
      // Temporal kickoff delivered after the CLI acknowledges the materialize-
      // only start-run; without it, the operation can succeed while the
      // workflow never advances.
      const hasUserKickoff =
        (isWorkflowArm && !isRepositoryImportMaterialization) ||
        (initialMessage?.role === MessageType.User && !!kickoffText?.length);

      const buildUserKickoff = (
        kickoffMessageId: MessageId,
      ): CreateMessageInput => {
        const kickoffData: UserMessageData = kickoffText
          ? {
              comment: kickoffText,
              ...(!isWorkflowArm
                ? { attachments: requestDto.attachments }
                : {}),
            }
          : {
              type: 'CONTROL',
              comment: ' ',
            };

        this.logger.log(
          '[ConversationController] startConversationRun authoring USER kickoff message',
          {
            conversationId,
            kickoffMessageId,
            ownerUserId,
            isWorkflowArm,
            handlerPromptType: requestDto.handlerPromptType,
            workflowName: requestDto.workflowName,
          },
        );

        return {
          id: kickoffMessageId,
          type: 'USER',
          userId: ownerUserId,
          conversationId,
          projectId,
          status: MessageStatus.Completed,
          data: kickoffData,
        };
      };

      // Both arms persist the USER kickoff before the SYSTEM start_run trigger.
      // The workflow arm also records a dedicated delivery obligation in the
      // same transaction; its ordinary MESSAGE.CREATED event is projection-only
      // and does not own Temporal activation.
      if (!isPersistedOperationReplay && hasUserKickoff && !isWorkflowArm) {
        this.logger.log(
          '[ConversationController] Adding user message for non workflow arm',
          { conversationId },
        );
        userKickoffMessage = buildUserKickoff(reservedIds.messageId);
      } else if (
        !isPersistedOperationReplay &&
        hasUserKickoff &&
        isWorkflowArm
      ) {
        if (!conversation.workflowId || !requestDto.workflowName) {
          throw new ConflictException({
            code: 'WORKFLOW_KICKOFF_BINDING_MISSING',
            message:
              'A workflow kickoff requires the conversation workflow binding.',
          });
        }
        // Persist the canonical kickoff and its dedicated Temporal delivery
        // obligation atomically with the durable START_RUN operation.
        userKickoffMessage = buildUserKickoff(reservedIds.messageId);
      }

      let triggerPayload: AgentTriggerStartRun['payload'];
      if (isWorkflowArm) {
        triggerPayload = {
          workflowName: requestDto.workflowName,
          ...(requestDto.payload ? { payload: requestDto.payload } : {}),
          model: requestDto.model,
          reasoningEffort: requestDto.reasoningEffort,
          provider: requestDto.provider,
          ...(startRunConfig !== undefined ? { config: startRunConfig } : {}),
          ...(requestDto.fastMode !== undefined
            ? { fastMode: requestDto.fastMode }
            : {}),
          contextMetadata: requestDto.contextMetadata,
          // Non-coding sessions (refiners, entity conversations) carry no
          // services — omit the service fields rather than forwarding empties.
          ...(requestDto.serviceIds && requestDto.serviceIds.length > 0
            ? {
                serviceIds: requestDto.serviceIds,
                launchServiceId: requestDto.launchServiceId,
              }
            : {}),
          ...(requestDto.worktree ? { worktree: requestDto.worktree } : {}),
          agentSessionId: requestDto.agentSessionId,
        };
      } else {
        triggerPayload = {
          handlerPromptType: requestDto.handlerPromptType,
          attachments: requestDto.attachments,
          // The tab the user opened before the session existed; the CLI adopts
          // it before turn one. Only the id rides the envelope.
          ...(requestDto.stagedBrowserTab !== undefined
            ? { stagedBrowserTab: requestDto.stagedBrowserTab }
            : {}),
          payload: requestDto.payload,
          model: requestDto.model,
          reasoningEffort: requestDto.reasoningEffort,
          provider: requestDto.provider,
          ...(startRunConfig !== undefined ? { config: startRunConfig } : {}),
          ...(requestDto.fastMode !== undefined
            ? { fastMode: requestDto.fastMode }
            : {}),
          contextMetadata: requestDto.contextMetadata,
          // Non-coding sessions (refiners, entity conversations) carry no
          // services — omit the service fields rather than forwarding empties.
          ...(requestDto.serviceIds && requestDto.serviceIds.length > 0
            ? {
                serviceIds: requestDto.serviceIds,
                launchServiceId: requestDto.launchServiceId,
              }
            : {}),
          ...(requestDto.worktree ? { worktree: requestDto.worktree } : {}),
          agentSessionId: requestDto.agentSessionId,
          // Non-dispatching SYSTEM seed: keep the handler/payload bound so the CLI
          // materializes the Run and the conversationId → runId binding survives
          // for the user's first message, but mark the turn-firing arm
          // materialize-only so no first turn fires. Omitted on every other path
          // (default true) to leave them byte-for-byte unchanged.
          ...(suppressDispatch ? { triggersAgent: false } : {}),
        } satisfies AgentTriggerStartRun['payload'];
      }

      this.logger.debug(
        '[ConversationController] startConversationRun materialized signed-trigger payload',
        {
          event: 'start_run.materialized',
          conversationId,
          arm: isWorkflowArm ? 'workflow' : 'turn_firing',
          focalScope,
          entityType: focalEntity?.entityType,
          entityId: focalEntity?.entityId,
        },
      );

      if (suppressDispatch) {
        this.logger.log(
          '[ConversationController] startConversationRun suppressing first-turn dispatch — non-dispatching SYSTEM seed (triggersAgent=false); materializing Run only',
          {
            conversationId,
            ownerUserId,
            handlerPromptType: requestDto.handlerPromptType,
          },
        );
      }

      const trigger: AgentTriggerStartRun = {
        promptType: AgentTriggerStartRun.PromptTypeEnum.StartRun,
        operationId: requestDto.operationId,
        operationFingerprint: requestDto.operationFingerprint,
        triggerMessageId: pregeneratedMessageId,
        payload: triggerPayload,
      };

      const systemMessageData: SystemMessageData = {
        type: SystemMessageData.TypeEnum.Agent,
        triggersAgent: trigger,
      };

      if (
        persistedTriggerMessage &&
        (persistedTriggerMessage.type !== MessageType.System ||
          canonicalizeJcs(
            withoutAdmittedServiceScope(
              persistedTriggerMessage.data as SystemMessageData,
            ),
          ) !== canonicalizeJcs(systemMessageData))
      ) {
        await this.agentSessionService.releaseStartRunLaunchClaim(
          organizationId,
          requestDto.agentSessionId,
        );
        throw new ConflictException(
          'The authorization request is already bound to different work',
        );
      }

      if (!this.agentOperationSubmission) {
        throw new ServiceUnavailableException(
          'Durable operation submission is not configured',
        );
      }
      const snapshot = await this.agentOperationSubmission.submitPrepared({
        operationId: requestDto.operationId,
        operationFingerprint: requestDto.operationFingerprint,
        organizationId,
        projectId,
        userId: callerUserId,
        agentSessionId: requestDto.agentSessionId as AgentSessionId,
        conversationId,
        kind: PrismaAgentOperationKind.START_RUN,
        admission: executionAdmission,
        executionOwner: begunOperation.executionOwner,
        additionalMessages,
        ...(userKickoffMessage ? { userMessage: userKickoffMessage } : {}),
        ...(userKickoffMessage &&
        isWorkflowArm &&
        !isRepositoryImportMaterialization
          ? {
              workflowKickoffDelivery: {
                workflowId: conversation.workflowId!,
                workflowName: requestDto.workflowName!,
              },
            }
          : {}),
        triggerMessage: {
          id: pregeneratedMessageId,
          type: 'SYSTEM',
          conversationId,
          projectId,
          status: MessageStatus.Completed,
          data: systemMessageData,
        },
        ...(projectReportBinding
          ? {
              onSubmittedInTx: (tx) =>
                this.projectReportLaunchService.startAcceptedInTransaction(
                  tx,
                  projectReportBinding.requestId,
                  projectReportBinding.attemptId,
                ),
            }
          : {}),
      });
      operationCommitted = true;
      if (!snapshot.triggerMessageId) {
        throw new ConflictException({
          code: 'AGENT_OPERATION_CORRELATION_MISSING',
          message: 'The committed operation is missing its trigger message.',
        });
      }
      return {
        dispatched: true,
        operationId: snapshot.operationId,
        operationFingerprint: snapshot.fingerprint,
        operationState:
          snapshot.state === 'SUCCEEDED'
            ? 'SUCCEEDED'
            : snapshot.state === 'RECONCILING'
              ? 'RECONCILING'
              : snapshot.state === 'DENIED'
                ? 'DENIED'
                : snapshot.state === 'FAILED'
                  ? 'FAILED'
                  : 'DISPATCH_PENDING',
        triggerMessageId: snapshot.triggerMessageId as MessageId,
      };
    } catch (error) {
      // A start-run that lost the launch claim is not the one launching the
      // report; failing the attempt would kill the concurrent winner.
      if (projectReportBinding && !operationCommitted && !launchClaimLost) {
        await this.projectReportLaunchService.failLaunch(
          projectReportBinding.requestId,
          projectReportBinding.attemptId,
          'START_RUN_FAILED',
        );
      }
      if (launchClaimed && !operationCommitted) {
        try {
          await this.agentSessionService.releaseStartRunLaunchClaim(
            organizationId,
            requestDto.agentSessionId,
          );
        } catch (releaseError) {
          this.logger.error(
            '[ConversationController] failed to release start-run launch claim after rollback',
            {
              conversationId,
              agentSessionId: requestDto.agentSessionId,
              error:
                releaseError instanceof Error
                  ? releaseError.message
                  : String(releaseError),
            },
          );
        }
      }
      const message =
        error instanceof Error ? error.message : 'Start run failed';
      await this.agentOperationRegistry.fail(
        requestDto.operationId,
        begunOperation.executionOwner,
        error instanceof HttpException
          ? `HTTP_${error.getStatus()}`
          : 'START_RUN_FAILED',
        message,
      );
      throw error;
    }
  }

  @Post('agent-sessions/:agentSessionId/workflow-answers')
  @UseGuards(ControllerBindingOriginGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  async submitWorkflowAnswer(
    @Param('projectId') projectId: ProjectId,
    @Param('agentSessionId') agentSessionId: AgentSessionId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') callerUserId: UserId,
    @Body() requestDto: SubmitWorkflowAnswerRequestDto,
    @Req() request?: Request,
  ): Promise<SubmitWorkflowAnswerResponseDto> {
    if (!this.agentOperationWorkflowAnswer) {
      throw new ServiceUnavailableException(
        'Workflow answer submission is unavailable.',
      );
    }
    if (requestDto.agentSessionId !== agentSessionId) {
      throw new ConflictException({
        code: 'WORKFLOW_ANSWER_SESSION_MISMATCH',
        message: 'The request does not match the Agent Session path.',
      });
    }
    const {
      operationFingerprint: _fingerprint,
      authorization: _authorization,
      ...semanticRequest
    } = requestDto;
    const expectedFingerprint = this.agentOperationWorkflowAnswer.fingerprint(
      semanticRequest,
      { organizationId, projectId },
    );
    if (requestDto.operationFingerprint !== expectedFingerprint) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_FINGERPRINT_INVALID',
        message:
          'The operation fingerprint does not match the workflow answer.',
      });
    }
    const admission =
      await this.executionGrantService.assertInteractiveAuthorized({
        authorization: requestDto.authorization,
        organizationId,
        projectId,
        userId: callerUserId,
        controllerBindingSecret: readControllerBindingSecret(request),
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: HostActionTargetKind.AgentSession,
        targetId: agentSessionId,
        conversationId: requestDto.conversationId as ConversationId,
        agentSessionId,
      });
    const begunOperation = await this.agentOperationRegistry.begin({
      operationId: requestDto.operationId,
      organizationId,
      projectId,
      userId: callerUserId,
      agentSessionId,
      conversationId: requestDto.conversationId as ConversationId,
      kind: PrismaAgentOperationKind.WORKFLOW_ANSWER,
      fingerprint: requestDto.operationFingerprint,
    });
    if (begunOperation.disposition !== 'EXECUTE') {
      return begunOperation.disposition === 'JOIN'
        ? this.agentOperationWorkflowAnswer.waitForResponse(
            requestDto.operationId,
          )
        : this.agentOperationWorkflowAnswer.responseForOperation(
            begunOperation.operation,
          );
    }

    try {
      return await this.agentOperationWorkflowAnswer.admit({
        request: requestDto,
        principal: { organizationId, projectId, userId: callerUserId },
        admission,
        executionOwner: begunOperation.executionOwner,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Workflow answer failed';
      await this.agentOperationRegistry.fail(
        requestDto.operationId,
        begunOperation.executionOwner,
        error instanceof HttpException
          ? `HTTP_${error.getStatus()}`
          : 'WORKFLOW_ANSWER_FAILED',
        message,
      );
      throw error;
    }
  }

  @Post('conversations/:conversationId/skip-to-node')
  async skipToNode(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
    @Body() skipToNodeDto: SkipToNodeRequestDto,
  ): Promise<SkipToNodeResponseDto> {
    try {
      // Verify conversation exists and user has access
      const conversation =
        await this.conversationService.getConversationFromAdapter(
          projectId,
          conversationId,
          organizationId,
        );

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      if (!conversation.workflowName) {
        throw new BadRequestException(
          'Conversation is not associated with a workflow',
        );
      }

      if (conversation.workflowName === WorkflowName.AgentSession) {
        throw new HttpException(
          'Skip-to-node is not supported for non-Temporal conversations',
          HttpStatus.CONFLICT,
        );
      }

      if (!conversation.workflowId) {
        throw new BadRequestException(
          'Conversation does not have a workflowId',
        );
      }

      // Get the flow template
      const flowTemplate = this.flowEngineService.getFlow(
        conversation.workflowName,
      );

      if (!flowTemplate) {
        throw new NotFoundException(
          `Workflow template '${conversation.workflowName}' not found`,
        );
      }

      // Get current workflow execution state
      const flowExecution = await this.flowExecutionService.findByConversation(
        conversationId,
        organizationId,
      );

      if (!flowExecution || !flowExecution.currentNode) {
        throw new BadRequestException('Workflow execution not found');
      }

      if (!flowExecution.flowState) {
        throw new BadRequestException('Workflow state not found');
      }

      // Extract FlowContext from flowState (handles both legacy and new format)
      const flowContext: FlowContext = isSerializableWorkflowState(
        flowExecution.flowState,
      )
        ? flowExecution.flowState.context
        : flowExecution.flowState;

      // Validate the skip
      const validation = await this.workflowExecutionService.validateSkipToNode(
        flowTemplate,
        flowExecution.currentNode,
        skipToNodeDto.targetNode,
        flowContext,
        organizationId,
      );

      if (!validation.canSkip) {
        // Determine status code based on reason
        const isStateConflict =
          validation.reason?.includes('must have') ||
          validation.reason?.includes('required') ||
          validation.reason?.includes('not found');

        throw new HttpException(
          {
            success: false,
            message: validation.reason || 'Cannot skip to target node',
            code: isStateConflict ? 'STATE_CONFLICT' : 'INVALID_SKIP_TARGET',
            currentNode: flowExecution.currentNode,
            targetNode: skipToNodeDto.targetNode,
            timestamp: new Date().toISOString(),
            statusCode: isStateConflict ? 409 : 400,
            path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}/skip-to-node`,
          },
          isStateConflict ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST,
        );
      }

      // Execute the skip via Temporal workflow signal
      await this.workflowRouterService.sendSkipToNode(
        conversation.workflowId,
        skipToNodeDto.targetNode,
      );

      return {
        success: true,
        currentNode: skipToNodeDto.targetNode,
        message: `Successfully skipped to node '${skipToNodeDto.targetNode}'`,
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to skip to node',
          code: 'SKIP_ERROR',
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
          statusCode: 500,
          path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}/skip-to-node`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('conversations/:conversationId/available-skip-nodes')
  async getAvailableSkipNodes(
    @Param('projectId') projectId: ProjectId,
    @Param('conversationId') conversationId: ConversationId,
    @CurrentOrganization() organizationId: OrganizationId,
  ): Promise<AvailableSkipNodesResponseDto> {
    try {
      // Verify conversation exists and user has access
      const conversation =
        await this.conversationService.getConversationFromAdapter(
          projectId,
          conversationId,
          organizationId,
        );

      if (!conversation) {
        throw new NotFoundException('Conversation not found');
      }

      if (!conversation.workflowName) {
        throw new BadRequestException(
          'Conversation is not associated with a workflow',
        );
      }

      if (conversation.workflowName === WorkflowName.AgentSession) {
        throw new HttpException(
          'Available skip nodes are not supported for non-Temporal conversations',
          HttpStatus.CONFLICT,
        );
      }

      // Get the flow template
      const flowTemplate = this.flowEngineService.getFlow(
        conversation.workflowName,
      );

      if (!flowTemplate) {
        throw new NotFoundException(
          `Workflow template '${conversation.workflowName}' not found`,
        );
      }

      // Get current workflow execution state
      const flowExecution = await this.flowExecutionService.findByConversation(
        conversationId,
        organizationId,
      );

      if (!flowExecution || !flowExecution.currentNode) {
        throw new BadRequestException('Workflow execution not found');
      }

      if (!flowExecution.flowState) {
        throw new BadRequestException('Workflow state not found');
      }

      // Extract FlowContext from flowState (handles both legacy and new format)
      const flowContext: FlowContext = isSerializableWorkflowState(
        flowExecution.flowState,
      )
        ? flowExecution.flowState.context
        : flowExecution.flowState;

      // Get available skip nodes
      const nodes = await this.workflowExecutionService.getAvailableSkipNodes(
        flowTemplate,
        flowExecution.currentNode,
        flowContext,
        organizationId,
      );

      return { nodes };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof HttpException
      ) {
        throw error;
      }

      throw new HttpException(
        {
          success: false,
          message: 'Failed to get available skip nodes',
          code: 'SKIP_NODES_ERROR',
          error: (error as Error).message,
          timestamp: new Date().toISOString(),
          statusCode: 500,
          path: `/organizations/${organizationId}/projects/${projectId}/conversations/${conversationId}/available-skip-nodes`,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private normalizeWorkflowNames(
    workflowName?: string | string[],
  ): WorkflowName[] | undefined {
    const workflowNames = Array.isArray(workflowName)
      ? workflowName
      : typeof workflowName === 'string'
        ? workflowName.split(',').map((value) => value.trim())
        : undefined;

    const filteredWorkflowNames = workflowNames?.filter(
      (value) =>
        value && value !== 'undefined' && value !== 'null' && value !== 'false',
    ) as WorkflowName[] | undefined;

    return filteredWorkflowNames && filteredWorkflowNames.length > 0
      ? filteredWorkflowNames
      : undefined;
  }

  private normalizeStatus(
    status?: ConversationStatus | ConversationStatus[],
  ): ConversationStatus[] | undefined {
    if (!status) {
      return undefined;
    }

    const statuses = Array.isArray(status)
      ? status
      : typeof status === 'string'
        ? (status as string).split(',').map((value) => value.trim())
        : undefined;

    const filteredStatuses = statuses?.filter(
      (value) =>
        value && value !== 'undefined' && value !== 'null' && value !== 'false',
    ) as ConversationStatus[] | undefined;

    return filteredStatuses && filteredStatuses.length > 0
      ? filteredStatuses
      : undefined;
  }
}

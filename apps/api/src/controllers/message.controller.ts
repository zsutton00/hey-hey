import {
  isControllerActionInputs,
  messageControllerInputs,
} from '../generated/controller-action-contract';
import {
  ProjectAccessGuard,
  ProjectResourceId,
} from '../auth/guards/project-access.guard';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  InternalServerErrorException,
  HttpException,
  Logger,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Client } from '@temporalio/client';
import {
  CurrentOrganization,
  CurrentUser,
} from 'src/auth/decorators/current-user.decorator';
import { OrganizationGuard } from 'src/auth/guards/organization.guard';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'node:crypto';
import {
  AgentOperation as PersistedAgentOperation,
  AgentOperationKind as PrismaAgentOperationKind,
  AgentOperationState as PrismaAgentOperationState,
} from '@prisma/client';
import {
  AgentTriggerUserMessage,
  ConversationResponseDto,
  CreateSystemMessage,
  CreateUserMessage,
  SubmitExecutableUserMessageRequestDto,
  GetMessagesQueryDto,
  ConversationMessageHistoryPageDto,
  MessageRecordDto,
  MessageResponseDto,
  MessageRetryResponse,
  RetryMessage200Response,
  SearchConversationMessagesResponseDto,
  UpdateMessageDto,
  UserMessageData,
  WorkflowName,
  HostActionTargetKind,
  HostAffectingActionType,
  MessageStatus,
  SystemMessageData,
} from '../generated';
import { InjectTemporalClient } from '../prisma/temporal.module';
import { ConversationService } from '../services/conversation.service';
import { MessageService } from '../services/message.service';
import {
  ExecutionGrantService,
  type InteractiveGrantAdmission,
} from '../services/controller-authorization/execution-grant.service';
import { FlowExecutionService } from '../services/workflows/flow-execution.service';
import { WorkflowTypeRegistryService } from '../services/workflows/workflow-type-registry.service';
import { UserMessageExtractor } from '../utils/user-message-extractor';
import { getAgentInputPromptType } from '../utils/type-checks';
import { WorkflowSignalHelper } from '../utils/workflow-signals.helper';
import { getWorkflowStatus } from '../workflows/conversation-flow.workflow';
import { canonicalizeJcs } from '../core/websockets/trigger-canonicalization';
import { AgentOperationRegistryService } from '../services/agent-operation/agent-operation-registry.service';
import { AgentOperationSubmissionService } from '../services/agent-operation/agent-operation-submission.service';
// Removed IMessageController interface due to organization context changes
import {
  ConversationId,
  AgentSessionId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from 'src/types';
import type { Request } from 'express';
import { ControllerBindingOriginGuard } from '../common/guards/controller-binding-origin.guard';
import { readControllerBindingSecret } from '../services/controller-authorization/controller-binding-cookie.service';
import {
  genericSystemMessageViolation,
  genericUserMessageViolation,
  genericMessageUpdateViolation,
} from '../services/message-authority/generic-message-write-policy';

@ProjectResourceId('message')
@Controller('api/v1/organizations/:organizationId/projects/:projectId/messages')
@UseGuards(OrganizationGuard, ProjectAccessGuard)
export class MessageController {
  private readonly logger = new Logger(MessageController.name);

  constructor(
    private readonly messageService: MessageService,
    private readonly conversationService: ConversationService,
    private readonly flowExecutionService: FlowExecutionService,
    private readonly workflowTypeRegistry: WorkflowTypeRegistryService,
    @InjectTemporalClient() private readonly temporalClient: Client,
    private readonly executionGrantService: ExecutionGrantService,
    @Optional()
    private readonly agentOperationRegistry?: AgentOperationRegistryService,
    @Optional()
    private readonly agentOperationSubmission?: AgentOperationSubmissionService,
  ) {}

  private submitMessageFingerprint(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    request: SubmitExecutableUserMessageRequestDto;
  }): string {
    const {
      authorization: _authorization,
      operationId: _operationId,
      operationFingerprint: _operationFingerprint,
      ...message
    } = params.request;
    return crypto
      .createHash('sha256')
      .update(
        canonicalizeJcs({
          kind: 'DIRECT_TRIGGER',
          organizationId: params.organizationId,
          projectId: params.projectId,
          message,
        }),
        'utf8',
      )
      .digest('hex');
  }

  private async recordedMessageResponse(
    operation: PersistedAgentOperation,
    organizationId: OrganizationId,
  ): Promise<MessageRecordDto> {
    if (
      operation.messageId &&
      (operation.state === PrismaAgentOperationState.SUCCEEDED ||
        operation.state === PrismaAgentOperationState.DISPATCH_PENDING)
    ) {
      const message = await this.messageService.getMessageForAdapter(
        operation.messageId,
        organizationId,
        true,
      );
      if (message) return message;
    }
    throw new ConflictException({
      code: operation.failureCode ?? 'AGENT_OPERATION_TERMINAL',
      message:
        operation.failureMessage ??
        'The operation is terminal and cannot be restarted.',
    });
  }

  @Get()
  async getMessages(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Query() query: GetMessagesQueryDto,
    @Query('includeResponses') includeResponses?: string,
    @Query('includeProposals') includeProposals?: string,
    @Query('includeReports') includeReports?: string,
  ): Promise<MessageResponseDto[] | ConversationMessageHistoryPageDto> {
    const shouldIncludeResponses = includeResponses !== 'false';
    const shouldIncludeProposals = includeProposals !== 'false';
    const shouldIncludeReports = includeReports === 'true';
    return this.messageService.getMessagesForAdapter(
      query,
      organizationId,
      projectId,
      shouldIncludeResponses,
      shouldIncludeProposals,
      shouldIncludeReports,
    );
  }

  // `search` must be declared before `:id` so Nest matches it as a literal
  // segment rather than treating the word "search" as a message id.
  @Get('search')
  async searchMessages(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('projectId') projectId: ProjectId,
    @Query('workflowAboutId') workflowAboutId: string,
    @Query('workflowAboutType') workflowAboutType: string,
    @Query('query') query: string,
    @Query('limit') limit?: string,
  ): Promise<SearchConversationMessagesResponseDto[]> {
    if (!workflowAboutId) {
      throw new BadRequestException('`workflowAboutId` is required');
    }
    if (!workflowAboutType) {
      throw new BadRequestException('`workflowAboutType` is required');
    }
    const parsedLimit =
      limit !== undefined && limit !== '' ? Number(limit) : undefined;
    if (parsedLimit !== undefined && !Number.isFinite(parsedLimit)) {
      throw new BadRequestException('`limit` must be a number');
    }
    return this.messageService.searchByWorkflowAbout({
      organizationId,
      projectId,
      workflowAboutId,
      workflowAboutType,
      query,
      limit: parsedLimit,
    });
  }

  @Get(':id')
  async getMessage(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') id: string,
    @Query('includeResponses') includeResponses?: string,
  ): Promise<MessageRecordDto> {
    const shouldIncludeResponses = includeResponses !== 'false';
    const message = await this.messageService.getMessageForAdapter(
      id,
      organizationId,
      shouldIncludeResponses,
    );
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    return message;
  }

  @Post()
  @UseGuards(ControllerBindingOriginGuard)
  async postMessage(
    @Param('projectId') projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Body()
    createMessageDto:
      | SubmitExecutableUserMessageRequestDto
      | CreateSystemMessage,
    @Req() request?: Request,
    machineEffectAdmission?: InteractiveGrantAdmission,
  ): Promise<MessageRecordDto> {
    const conversation =
      await this.conversationService.getConversationFromAdapter(
        projectId,
        createMessageDto.conversationId as ConversationId,
        organizationId,
      );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (createMessageDto.type === 'USER') {
      this.assertValidInboundUserMessageData(
        createMessageDto as SubmitExecutableUserMessageRequestDto,
        machineEffectAdmission !== undefined,
      );
    } else {
      this.assertValidInboundSystemMessageData(
        createMessageDto.data as SystemMessageData,
      );
    }

    const executableRequest =
      createMessageDto.type === 'USER'
        ? (createMessageDto as SubmitExecutableUserMessageRequestDto)
        : null;
    if (!executableRequest) {
      const messageWithContext: CreateSystemMessage = {
        ...(createMessageDto as CreateSystemMessage),
        projectId,
        userId: createMessageDto.userId || 'system',
      };
      return this.messageService.addMessageFromAdapter(
        messageWithContext,
        organizationId,
      );
    }

    if (
      !executableRequest.operationId ||
      !executableRequest.operationFingerprint ||
      !executableRequest.agentSessionId
    ) {
      throw new BadRequestException(
        'operationId, operationFingerprint, and agentSessionId are required for USER message submission.',
      );
    }

    // Test doubles and older composition roots can still provide the
    // registry without the new submission owner. Keep that boundary
    // compatible while the production module uses the atomic path below.
    if (!this.agentOperationSubmission) {
      if (!this.agentOperationRegistry) {
        throw new InternalServerErrorException(
          'Durable operation registry is not configured',
        );
      }
      const begunOperation = await this.agentOperationRegistry.begin({
        operationId: executableRequest.operationId,
        organizationId,
        projectId,
        userId,
        agentSessionId: executableRequest.agentSessionId as AgentSessionId,
        conversationId: executableRequest.conversationId as ConversationId,
        kind: PrismaAgentOperationKind.DIRECT_TRIGGER,
        fingerprint: executableRequest.operationFingerprint,
      });
      if (begunOperation.disposition !== 'EXECUTE') {
        const recorded =
          begunOperation.disposition === 'JOIN'
            ? await this.agentOperationRegistry.waitForTerminal(
                executableRequest.operationId,
              )
            : begunOperation.operation;
        return this.recordedMessageResponse(recorded, organizationId);
      }
      const reservedIds = this.agentOperationRegistry.reservedMessageIds(
        begunOperation.operation,
      );

      try {
        const executionAdmission =
          machineEffectAdmission ??
          (await this.executionGrantService.assertInteractiveAuthorized({
            authorization: executableRequest.authorization,
            inputs: messageControllerInputs(executableRequest.data),
            organizationId,
            projectId,
            userId,
            controllerBindingSecret: readControllerBindingSecret(request),
            actionType: HostAffectingActionType.ConversationTrigger,
            targetKind: HostActionTargetKind.AgentSession,
            targetId: executableRequest.agentSessionId,
            conversationId: executableRequest.conversationId as ConversationId,
            agentSessionId: executableRequest.agentSessionId as AgentSessionId,
          }));
        await this.agentOperationRegistry.recordAuthorization(
          executableRequest.operationId,
          begunOperation.executionOwner,
          executionAdmission.authorizationId,
          executionAdmission.envelopeAuthorization.kind,
        );
        const messageDtoWithoutAuthorization = (({
          authorization: _authorization,
          operationId: _operationId,
          operationFingerprint: _operationFingerprint,
          agentSessionId: _agentSessionId,
          ...message
        }) => message)(executableRequest);
        let messageWithContext: CreateUserMessage & { id?: MessageId } = {
          ...messageDtoWithoutAuthorization,
          id: reservedIds.messageId,
          projectId,
          userId: executableRequest.userId || userId,
        };
        messageWithContext = await this.stampUserMessageDispatch(
          messageWithContext,
          conversation,
          organizationId,
          executableRequest.operationId,
          executableRequest.operationFingerprint,
        );
        const stampedData = messageWithContext.data as UserMessageData;
        const stampedTrigger = stampedData.triggersAgent;
        if (!stampedTrigger || stampedTrigger.promptType !== 'user_message') {
          const message = await this.messageService.addMessageFromAdapter(
            messageWithContext,
            organizationId,
          );
          await this.executionGrantService.deriveInteractiveGrant({
            admission: executionAdmission,
            authorizedTurnId: reservedIds.messageId,
          });
          await this.agentOperationRegistry.succeed({
            operationId: executableRequest.operationId,
            executionOwner: begunOperation.executionOwner,
            messageId: reservedIds.messageId,
            triggerMessageId: reservedIds.messageId,
            result: { deferredDispatch: true },
          });
          return message;
        }
        const trigger: AgentTriggerUserMessage = {
          ...stampedTrigger,
          operationId: executableRequest.operationId,
          operationFingerprint: executableRequest.operationFingerprint,
          triggerMessageId: reservedIds.triggerMessageId,
          sourceUserMessageId: reservedIds.messageId,
        };
        const { triggersAgent: _triggersAgent, ...userData } = stampedData;
        messageWithContext = { ...messageWithContext, data: userData };
        const message = await this.messageService.addMessageFromAdapter(
          messageWithContext,
          organizationId,
        );
        await this.messageService.addMessage(
          {
            id: reservedIds.triggerMessageId,
            type: 'SYSTEM',
            conversationId: executableRequest.conversationId as ConversationId,
            projectId,
            status: MessageStatus.Completed,
            data: {
              type: SystemMessageData.TypeEnum.Agent,
              triggersAgent: trigger,
            } satisfies SystemMessageData,
          },
          organizationId,
          'postMessage:agentOperationTrigger',
        );
        await this.executionGrantService.deriveInteractiveGrant({
          admission: executionAdmission,
          authorizedTurnId: reservedIds.triggerMessageId,
        });
        await this.agentOperationRegistry.succeed({
          operationId: executableRequest.operationId,
          executionOwner: begunOperation.executionOwner,
          messageId: reservedIds.messageId,
          triggerMessageId: reservedIds.triggerMessageId,
          result: { created: true },
        });
        return message;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Message submission failed';
        await this.agentOperationRegistry.fail(
          executableRequest.operationId,
          begunOperation.executionOwner,
          error instanceof HttpException
            ? `HTTP_${error.getStatus()}`
            : 'DIRECT_TRIGGER_FAILED',
          message,
        );
        throw error;
      }
    }
    const expectedFingerprint = this.submitMessageFingerprint({
      organizationId,
      projectId,
      request: executableRequest,
    });
    if (executableRequest.operationFingerprint !== expectedFingerprint) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_FINGERPRINT_INVALID',
        message:
          'The operation fingerprint does not match the message submission.',
      });
    }
    const executionAdmission =
      machineEffectAdmission ??
      (await this.executionGrantService.assertInteractiveAuthorized({
        authorization: executableRequest.authorization,
        inputs: messageControllerInputs(executableRequest.data),
        organizationId,
        projectId,
        userId,
        controllerBindingSecret: readControllerBindingSecret(request),
        actionType: HostAffectingActionType.ConversationTrigger,
        targetKind: HostActionTargetKind.AgentSession,
        targetId: executableRequest.agentSessionId,
        conversationId: executableRequest.conversationId as ConversationId,
        agentSessionId: executableRequest.agentSessionId as AgentSessionId,
      }));
    const messageDtoWithoutAuthorization = (({
      authorization: _authorization,
      operationId: _operationId,
      operationFingerprint: _operationFingerprint,
      agentSessionId: _agentSessionId,
      ...message
    }) => message)(executableRequest);

    // Resolve workflow/project from trusted server-side context
    let messageWithContext: CreateUserMessage & { id?: MessageId } = {
      ...messageDtoWithoutAuthorization,
      projectId,
      userId: executableRequest.userId || userId,
    };

    // Stamp the dispatch decision onto the USER row BEFORE insert (the
    // wire-discriminator contract). This must happen pre-insert so the stamped
    // `data.triggersAgent` rides the create-path projections —
    // `conversation.updated.messageAdded` → `emitConversationTriggerForMessage`
    // and the `pending_open_trigger` store — that only fire on create.
    messageWithContext = await this.stampUserMessageDispatch(
      messageWithContext,
      conversation,
      organizationId,
      executableRequest.operationId,
      executableRequest.operationFingerprint,
    );
    const stampedData = messageWithContext.data as UserMessageData;
    const stampedTrigger = stampedData.triggersAgent;
    if (!stampedTrigger || stampedTrigger.promptType !== 'user_message') {
      throw new ConflictException({
        code: 'AGENT_OPERATION_TRIGGER_MISSING',
        message:
          'The submitted Agent Session message did not resolve to a durable trigger.',
      });
    }
    const trigger: AgentTriggerUserMessage = {
      ...stampedTrigger,
      operationId: executableRequest.operationId,
      operationFingerprint: executableRequest.operationFingerprint,
      triggerMessageId: stampedTrigger.triggerMessageId,
      sourceUserMessageId: messageWithContext.id as MessageId,
    };
    const { triggersAgent: _triggersAgent, ...userData } = stampedData;
    messageWithContext = { ...messageWithContext, data: userData };

    if (!this.agentOperationSubmission) {
      throw new InternalServerErrorException(
        'Durable operation submission is not configured',
      );
    }
    const snapshot = await this.agentOperationSubmission.submit({
      operationId: executableRequest.operationId,
      operationFingerprint: executableRequest.operationFingerprint,
      organizationId,
      projectId,
      userId,
      agentSessionId: executableRequest.agentSessionId as AgentSessionId,
      conversationId: executableRequest.conversationId as ConversationId,
      kind: PrismaAgentOperationKind.DIRECT_TRIGGER,
      admission: executionAdmission,
      userMessage: {
        ...messageWithContext,
        type: 'USER' as const,
        data: messageWithContext.data as UserMessageData,
      },
      triggerMessage: {
        id: stampedTrigger.triggerMessageId as MessageId,
        type: 'SYSTEM',
        conversationId: executableRequest.conversationId as ConversationId,
        projectId,
        status: MessageStatus.Completed,
        data: {
          type: SystemMessageData.TypeEnum.Agent,
          triggersAgent: trigger,
        } satisfies SystemMessageData,
      },
    });
    if (!snapshot.messageId) {
      if (!this.agentOperationRegistry) {
        throw new InternalServerErrorException(
          'Durable operation registry is not configured',
        );
      }
      const terminal = await this.agentOperationRegistry.waitForTerminal(
        executableRequest.operationId,
      );
      return this.recordedMessageResponse(terminal, organizationId);
    }
    const message = await this.messageService.getMessageForAdapter(
      snapshot.messageId,
      organizationId,
      true,
    );
    if (!message) throw new NotFoundException('Submitted message not found');
    return message;
  }

  /**
   * Classify an inbound USER message against the wire-discriminator contract
   * (@[feature:3e746c36-29f4-411e-814b-aaa79ce14f3e|CLI Run Input Dispatch])
   * and, when the dispatch rides a stamped row rather than a Temporal signal,
   * stamp `data.triggersAgent` onto the USER row before insert.
   *
   * The decision must be made here, pre-insert, because the trigger frame is
   * shipped by the create-path projections (`emitConversationTriggerForMessage`
   * on `conversation.updated.messageAdded`, plus the `pending_open_trigger`
   * store) which only fire on message create — never on update.
   *
   * The dispatch discriminator and typed payload are read from the nested
   * `data.agentInput` envelope (the typed dispatch shape); only the resulting
   * `data.triggersAgent` stamp is written back at the `data` root.
   *
   * Cases (validation upstream guarantees exactly one of `agentInput.promptType`
   * / `agentInput.workflowName`):
   *  - `promptType` → stamp; `handlerPromptType` is the wire `promptType`.
   *  - non-Temporal-backed `workflowName` → stamp; `handlerPromptType` is the
   *    workflow's resolver-supplied routing key (defensive: there is no
   *    Temporal workflow to signal or resume).
   *  - Temporal-backed `workflowName`, live `workflowId` → do NOT stamp; the
   *    message processor signals downstream.
   *  - Temporal-backed `workflowName`, no `workflowId` but a resumable paused
   *    execution → do NOT stamp; the processor resumes downstream.
   *  - Temporal-backed `workflowName`, no `workflowId`, nothing resumable →
   *    stamp the workflow's `terminalPromptType`.
   *
   * `triggerMessageId` and `sourceUserMessageId` both equal the pre-generated
   * USER row id: the trigger rides the USER row itself, and the trigger-emitter
   * validates `triggerMessageId === row.id` before signing. The server-stamped
   * value is the ONLY trusted source of `triggersAgent` (see
   * @[task:5bd98aa4-f136-4146-88f7-3042432e95ce|CLI Channel Security]).
   */
  private async stampUserMessageDispatch(
    dto: CreateUserMessage,
    conversation: ConversationResponseDto,
    organizationId: OrganizationId,
    operationId?: string,
    operationFingerprint?: string,
  ): Promise<CreateUserMessage> {
    const data = dto.data as UserMessageData;
    const conversationId = dto.conversationId as ConversationId;
    const agentInput = data.agentInput;
    const wirePromptType = getAgentInputPromptType(agentInput);
    const handlerPromptType = wirePromptType;
    const dispatchCase = 'promptType' as const;

    if (!handlerPromptType) {
      this.logger.warn(
        '[stampUserMessageDispatch] no handlerPromptType resolvable — leaving USER message unstamped',
        { conversationId, dispatchCase },
      );
      return dto;
    }

    // Executable USER submissions arrive with the authorization request ID
    // preassigned as the durable message identity. Preserve it so the
    // resulting grant's authorized_turn_id references the row that is
    // actually persisted; non-authorized internal callers still get a fresh
    // server-generated ID.
    const messageId = ((dto as CreateUserMessage & { id?: MessageId }).id ??
      uuidv4()) as MessageId;
    const resolvedOperationId = operationId ?? uuidv4();
    const resolvedOperationFingerprint =
      operationFingerprint ??
      crypto
        .createHash('sha256')
        .update(
          canonicalizeJcs({
            kind: 'LEGACY_MESSAGE',
            conversationId,
            messageId,
            data,
          }),
          'utf8',
        )
        .digest('hex');
    const userMessage = UserMessageExtractor.extractContentFromData(data, '');
    const attachments = data.attachments ?? [];
    const payload = messageControllerInputs(data).payload;
    const trigger: AgentTriggerUserMessage = {
      operationId: resolvedOperationId,
      operationFingerprint: resolvedOperationFingerprint,
      promptType: AgentTriggerUserMessage.PromptTypeEnum.UserMessage,
      triggerMessageId: messageId,
      sourceUserMessageId: messageId,
      payload,
    };

    this.logger.log(
      '[stampUserMessageDispatch] stamping USER row triggersAgent',
      {
        conversationId,
        messageId,
        dispatchCase,
        handlerPromptType,
        userMessageLength: userMessage.length,
        attachmentCount: attachments.length,
      },
    );

    return {
      ...dto,
      id: messageId,
      data: { ...data, triggersAgent: trigger },
    } as CreateUserMessage & { id: MessageId };
  }

  /**
   * Enforce the wire-discriminator contract for inbound USER messages
   * (@[feature:3e746c36-29f4-411e-814b-aaa79ce14f3e|CLI Run Input Dispatch]):
   * a USER submission selects its dispatch target with exactly one of
   * `data.agentInput.promptType` or `data.agentInput.workflowName`, never both
   * and never neither. The discriminator lives in the nested `agentInput`
   * envelope; `data.triggersAgent` is server-stamped only — the server writes it
   * onto
   * the persisted USER row during dispatch — so a UI-supplied value is
   * rejected here rather than trusted. The signing/binding invariant this
   * upholds is owned by
   * @[task:5bd98aa4-f136-4146-88f7-3042432e95ce|CLI Channel Security].
   */
  private assertValidInboundUserMessageData(
    createMessageDto: CreateUserMessage,
    admittedMachineEffect = false,
  ): void {
    const data = createMessageDto.data as UserMessageData | undefined;

    if (data) {
      const violation = genericUserMessageViolation(
        data,
        admittedMachineEffect,
      );
      if (violation) throw new BadRequestException(violation);
    }

    const agentInput = data?.agentInput;
    // Read the discriminators independently (not via the mutually-exclusive
    // narrowing) so an illegal both-set submission is still caught here at the
    // untrusted inbound boundary, before the union's structural exclusion is
    // assumed downstream.
    const hasPromptType = getAgentInputPromptType(agentInput) !== null;
    const hasWorkflowName =
      !!agentInput &&
      typeof (agentInput as { workflowName?: unknown }).workflowName ===
        'string';
    if (hasWorkflowName) {
      throw new BadRequestException(
        'Workflow answers must use the dedicated workflow-answer endpoint',
      );
    }
    if (!data || !hasPromptType) {
      throw new BadRequestException(
        'A USER message must carry data.agentInput.promptType; workflow answers use the dedicated workflow-answer endpoint',
      );
    }

    if (
      agentInput?.promptType === 'feature_sync_iterate' &&
      !Array.isArray(agentInput.discrepancies)
    ) {
      throw new BadRequestException(
        'feature_sync_iterate USER messages require data.agentInput.discrepancies',
      );
    }
    if (
      agentInput?.promptType === 'plan_shaping_feature_sync_iterate' &&
      !isControllerActionInputs(messageControllerInputs(data))
    ) {
      throw new BadRequestException(
        'plan_shaping_feature_sync_iterate USER messages require the canonical planId, designDocId, discrepancies and decisions',
      );
    }
  }

  private assertValidInboundSystemMessageData(data: SystemMessageData): void {
    const violation = genericSystemMessageViolation(data);
    if (violation) throw new BadRequestException(violation);
  }

  @Patch(':id')
  async updateMessage(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') id: string,
    @Body() updateMessageDto: UpdateMessageDto,
  ): Promise<MessageResponseDto> {
    if (updateMessageDto.data) {
      const violation = genericMessageUpdateViolation(updateMessageDto.data);
      if (violation) throw new BadRequestException(violation);
      const existing = await this.messageService.getMessageForAdapter(
        id,
        organizationId,
        false,
      );
      const existingAuthorityViolation =
        existing?.type === 'SYSTEM'
          ? genericSystemMessageViolation(existing.data)
          : existing?.type === 'USER'
            ? genericUserMessageViolation(existing.data, false)
            : null;
      if (existingAuthorityViolation) {
        throw new BadRequestException(
          `Server-owned message authority cannot be replaced through generic update: ${existingAuthorityViolation}`,
        );
      }
    }
    return this.messageService.updateMessageFromAdapter(
      id,
      organizationId,
      updateMessageDto,
    );
  }

  @Post(':id/prepend')
  async prependMessage(
    @Param('projectId') projectId: ProjectId,
    @CurrentOrganization() organizationId: OrganizationId,
    @CurrentUser('userId') userId: UserId,
    @Param('id') id: string,
    @Body() createMessageDto: CreateUserMessage | CreateSystemMessage,
  ): Promise<MessageResponseDto> {
    if (createMessageDto.type === 'SYSTEM') {
      this.assertValidInboundSystemMessageData(
        createMessageDto.data as SystemMessageData,
      );
    } else {
      const violation = genericUserMessageViolation(
        createMessageDto.data as UserMessageData,
        false,
      );
      if (violation) throw new BadRequestException(violation);
    }
    const messageWithContext: CreateUserMessage | CreateSystemMessage = {
      ...createMessageDto,
      projectId,
      userId:
        createMessageDto.type === 'SYSTEM'
          ? createMessageDto.userId || 'system'
          : createMessageDto.userId || userId,
    };

    return this.messageService.prependMessageFromAdapter(
      id as MessageId,
      messageWithContext,
      organizationId,
    );
  }

  @Post(':id/retry')
  async retryMessage(
    @CurrentOrganization() organizationId: OrganizationId,
    @Param('id') messageId: string,
  ): Promise<RetryMessage200Response> {
    // Get message and validate access
    const message = await this.messageService.getMessageForAdapter(
      messageId,
      organizationId,
      false, // Don't include responses for retry operation
    );

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    // Get conversation associated with the message
    const conversation = await this.conversationService.findOne(
      message.conversationId as ConversationId,
      organizationId,
    );

    if (!conversation) {
      throw new BadRequestException('Conversation not found for this message');
    }

    if (conversation.workflowName === WorkflowName.AgentSession) {
      throw new BadRequestException(
        'Retry is not supported for non-Temporal conversations',
      );
    }

    if (!conversation.workflowId) {
      throw new BadRequestException(
        'No workflow associated with this conversation',
      );
    }

    try {
      // Delete the failed message completely
      await this.messageService.deleteMessage(
        messageId as MessageId,
        organizationId,
        'retry-mechanism',
      );

      let replayedNodeId: string | null = null;

      // Send replayNode signal to properly restart the current node from the beginning
      if (conversation.workflowId) {
        // Get workflow handle and check if it's running
        const workflowHandle = this.temporalClient.workflow.getHandle(
          conversation.workflowId,
        );
        const workflowDescription = await workflowHandle.describe();

        if (workflowDescription.status.name !== 'RUNNING') {
          throw new BadRequestException(
            `Workflow is not running (status: ${workflowDescription.status.name})`,
          );
        }

        // Get current workflow state to determine which node to replay
        const workflowStatus = await workflowHandle.query(getWorkflowStatus);
        replayedNodeId = workflowStatus.currentNodeId;
        await WorkflowSignalHelper.sendReplayNode(
          workflowHandle,
          conversation.workflowId,
        );
      }

      const response: RetryMessage200Response = {
        success: true,
        message: `Message deleted${replayedNodeId ? ` and node replayed` : ''}`,
        data: {
          status: MessageRetryResponse.StatusEnum.RetryInitiated,
          message: `The failed message was deleted${replayedNodeId ? ` and node replay initiated for: ${replayedNodeId}` : ''}`,
        },
        timestamp: new Date().toISOString(),
        statusCode: 200,
        path: `/organizations/${organizationId}/projects/${conversation.projectId}/messages/${messageId}/retry`,
      };

      return response;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      throw new InternalServerErrorException(
        `Failed to retry workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}

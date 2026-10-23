import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import {
  AgentTrigger,
  AgentOperationDispatchAcceptedAcknowledgement,
  ConversationControlCompactRun,
  ConversationControlPermissionDecision,
  ConversationControlQuestionAnswer,
  ConversationControlStopRun,
  SystemMessageData,
  MonitorCommandAcknowledgement,
  MonitorCommandBody,
  MonitorCommandBodyV2,
  MonitorAuthorityNeutralBodyV2,
  MonitorCommandRejectedAcknowledgement,
  SubmitTaskMonitorCommandResponseDto,
  UserMessageData,
  WebSocketConversationControlEvent,
  WebSocketConversationTriggerEvent,
  WebSocketMonitorCommandEvent,
  WebSocketConversationReductionEvent,
  ApplicationEffectLaunchBody,
  ExactActionDeliveryBody,
  MonitorAuthorityReductionBodyV2,
  WebSocketApplicationEffectEvent,
  WebSocketExactActionEvent,
  WebSocketMonitorReductionEvent,
  HostActionTargetKind,
  HostAffectingActionType,
  ExecutableEnvelopeAuthorization,
} from '../../generated';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  ConversationId,
  AgentSessionId,
  MachineId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { ExternalAgentTriggerError } from '../../types/flow-internal.types';
import { TriggerEnvelopeSigner } from './trigger-envelope-signer.service';
import { TriggerRecipientResolver } from './trigger-recipient-resolver.service';
import { WebsocketGateway } from './websocket.gateway';
import { ExecutableFrameAuthorizationService } from './executable-frame-authorization.service';

/**
 * Orchestrates signed trigger-frame emission: detect the trigger, resolve the
 * recipient, sign the envelope, and hand it to the gateway.
 *
 * This is the single place that ties the three trigger collaborators —
 * `TriggerRecipientResolver`, `TriggerEnvelopeSigner`, `WebsocketGateway` —
 * together, so callers (the realtime bridge for conversation triggers, the
 * Platform Event Channel for platform-event triggers) stay thin.
 */
type AgentSessionControlParams = {
  agentSessionId: string;
  conversationId: ConversationId;
  actingUserId: UserId;
  organizationId: OrganizationId;
  projectId?: ProjectId;
  authorizationId?: string;
  envelopeAuthorization?: ExecutableEnvelopeAuthorization;
  actionPayloadHash?: string;
};

@Injectable()
export class TriggerEmitter {
  private readonly logger = new Logger(TriggerEmitter.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recipientResolver: TriggerRecipientResolver,
    private readonly signer: TriggerEnvelopeSigner,
    // The gateway depends on this emitter (re-fan on authenticate); use
    // forwardRef so the WebsocketGateway ↔ TriggerEmitter cycle resolves.
    @Inject(forwardRef(() => WebsocketGateway))
    private readonly gateway: WebsocketGateway,
    private readonly executableFrameAuthorization: ExecutableFrameAuthorizationService,
  ) {}

  /**
   * Given the message just persisted on a conversation, emit a
   * `trigger.conversation` frame iff that message carries a `triggersAgent`
   * body. Messages without one are silently ignored — the rule for which
   * messages count as triggers is owned by `data.triggersAgent` and is not
   * re-decided here.
   *
   * Best-effort for discovery: a missing message, a non-trigger message, or
   * an unresolvable recipient all result in a no-op (logged). The caller's
   * `conversation.updated` broadcast is independent of this.
   *
   * Strict for contract: a trigger that is present but malformed — missing
   * `triggerMessageId`, or carrying a `triggerMessageId` that does not match
   * the row it was loaded from — throws `ExternalAgentTriggerError`. The
   * persistence seam (`createSystemMessage` / `startExternalAgentNode`)
   * stamps the id at create time, so a violation means the producer pipeline
   * is broken and the bridge should fail loudly rather than ship a bogus
   * envelope. Mirrors the inbound `validateExternalAgentCompletion` symmetry.
   */
  async emitConversationTriggerForMessage(params: {
    conversationId: ConversationId;
    messageId: MessageId;
    organizationId: OrganizationId;
    projectId?: ProjectId;
    authorizationId?: string;
    actionPayloadHash?: string;
  }): Promise<void> {
    const { conversationId, messageId, organizationId, projectId } = params;

    this.logger.log(
      `[trigger-emit] enter conversationId=${conversationId} messageId=${messageId}`,
    );

    const message = await this.prisma.db.message.findUnique({
      where: { id: messageId },
      select: { data: true },
    });

    const trigger = this.extractTriggersAgent(message?.data);
    if (!trigger) {
      // Not a trigger message — the common case. Nothing to emit.
      this.logger.warn(
        `[trigger-emit] DROP no triggersAgent on message conversationId=${conversationId} messageId=${messageId} messageFound=${String(!!message)} dataPresent=${String(!!message?.data)}`,
      );
      return;
    }
    this.logger.debug('[trigger-emit] loaded persisted trigger', {
      event: 'trigger_emitter.persisted_trigger_loaded',
      conversationId,
      messageId,
      promptType: trigger.promptType,
      nodeId: trigger.nodeId,
      triggerMessageId: trigger.triggerMessageId,
      operationId: 'operationId' in trigger ? trigger.operationId : undefined,
      operationFingerprint:
        'operationFingerprint' in trigger
          ? trigger.operationFingerprint
          : undefined,
    });

    // Validate the persistence-time contract: the stamped `triggerMessageId`
    // must match the id of the row this body was loaded from. The producer
    // seam (createSystemMessage / startExternalAgentNode) pre-generates the
    // message id and stamps it before persistence; anything that breaks
    // that contract should fail loudly rather than ship an envelope with a
    // missing/wrong id to the CLI. Mirrors the symmetry of
    // `validateExternalAgentCompletion` on the inbound side.
    const stampedMessageId =
      typeof trigger.triggerMessageId === 'string'
        ? trigger.triggerMessageId
        : undefined;
    if (!stampedMessageId) {
      throw new ExternalAgentTriggerError({
        reason: 'missing_trigger_message_id',
        nodeId: typeof trigger.nodeId === 'string' ? trigger.nodeId : undefined,
        messageId,
        stampedMessageId: undefined,
      });
    }
    if (stampedMessageId !== messageId) {
      throw new ExternalAgentTriggerError({
        reason: 'trigger_message_id_mismatch',
        nodeId: typeof trigger.nodeId === 'string' ? trigger.nodeId : undefined,
        messageId,
        stampedMessageId,
      });
    }

    const recipient =
      await this.recipientResolver.resolveConversationRecipient(conversationId);
    if (!recipient) {
      // Resolver already logged why (no agent session / no paired machine).
      this.logger.warn(
        `[trigger-emit] DROP no recipient conversationId=${conversationId} messageId=${messageId}`,
      );
      return;
    }

    const authorization = await this.authorizeConversationTrigger({
      recipient,
      organizationId,
      projectId,
      conversationId,
      messageId,
      authorizationId: params.authorizationId,
      actionPayloadHash: params.actionPayloadHash,
    });
    if (!authorization) return;

    this.logger.log(
      `[trigger-emit] resolved recipient conversationId=${conversationId} messageId=${messageId} userId=${recipient.userId} machineId=${recipient.machineId}`,
    );

    const envelope = this.signer.signConversationTriggerAuthorized(
      trigger,
      recipient.machineId,
      recipient.userId,
      authorization,
    );

    const event: WebSocketConversationTriggerEvent = {
      type: WebSocketConversationTriggerEvent.TypeEnum.TriggerConversation,
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: recipient.userId,
      envelope,
    };

    this.logger.log('Emitting trigger.conversation frame', {
      conversationId,
      messageId,
      userId: recipient.userId,
      machineId: recipient.machineId,
      promptType: trigger.promptType,
      nodeId: trigger.nodeId,
      triggerMessageId: trigger.triggerMessageId,
    });
    this.gateway.emitConversationTrigger(event);
  }

  /**
   * Sign and emit a `trigger.conversation` frame to a specific machine,
   * awaiting a socket acknowledgement before returning. Used by the
   * start-run controller path to give the caller a hard liveness check
   * at the commit point.
   *
   * Mirrors `emitConversationTriggerForMessage` in all validation and
   * recipient-resolution steps; differs only in calling `emitWithAck`
   * instead of fire-and-forget `emitConversationTrigger`.
   *
   * Returns `{ acknowledged: false, reason: 'no_recipient' }` when the
   * recipient cannot be resolved (no paired machine / no agent session) —
   * the caller is responsible for surfacing the appropriate error.
   */
  async emitConversationTriggerWithAck(params: {
    conversationId: ConversationId;
    messageId: MessageId;
    organizationId: OrganizationId;
    projectId?: ProjectId;
    timeoutMs?: number;
    machineId?: MachineId;
    agentSessionId?: AgentSessionId;
    authorizationId?: string;
    grantId?: string;
    envelopeAuthorization?: ExecutableEnvelopeAuthorization;
    preferPersistedActivation?: boolean;
    actionPayloadHash?: string;
  }): Promise<
    | {
        acknowledged: true;
        machineId: MachineId;
        acknowledgement: AgentOperationDispatchAcceptedAcknowledgement;
      }
    | { acknowledged: false; reason?: string }
  > {
    const {
      conversationId,
      messageId,
      organizationId,
      projectId,
      timeoutMs,
      machineId,
      agentSessionId,
      authorizationId,
      grantId,
      envelopeAuthorization,
      preferPersistedActivation,
      actionPayloadHash,
    } = params;

    this.logger.debug(
      `[trigger-emit-ack] enter conversationId=${conversationId} messageId=${messageId}`,
    );

    const message = await this.prisma.db.message.findUnique({
      where: { id: messageId },
      select: { data: true },
    });

    const trigger = this.extractTriggersAgent(message?.data);
    if (!trigger) {
      const dataKeys =
        message?.data && typeof message.data === 'object'
          ? Object.keys(message.data).join(',')
          : '';
      this.logger.warn(
        `[trigger-emit-ack] DROP no triggersAgent on message conversationId=${conversationId} messageId=${messageId} messageFound=${String(message !== null)} dataType=${typeof message?.data} dataKeys=${dataKeys}`,
      );
      return { acknowledged: false, reason: 'no_trigger' };
    }
    const stampedMessageId =
      typeof trigger.triggerMessageId === 'string'
        ? trigger.triggerMessageId
        : undefined;
    if (!stampedMessageId) {
      throw new ExternalAgentTriggerError({
        reason: 'missing_trigger_message_id',
        nodeId: typeof trigger.nodeId === 'string' ? trigger.nodeId : undefined,
        messageId,
        stampedMessageId: undefined,
      });
    }
    if (stampedMessageId !== messageId) {
      throw new ExternalAgentTriggerError({
        reason: 'trigger_message_id_mismatch',
        nodeId: typeof trigger.nodeId === 'string' ? trigger.nodeId : undefined,
        messageId,
        stampedMessageId,
      });
    }

    const recipientResolution = machineId
      ? agentSessionId
        ? await this.recipientResolver.resolveExactConversationRecipient(
            conversationId,
            machineId,
            agentSessionId,
          )
        : await this.recipientResolver.resolveExactConversationRecipient(
            conversationId,
            machineId,
          )
      : null;
    const recipient = recipientResolution
      ? recipientResolution.resolved
        ? recipientResolution.recipient
        : null
      : await this.recipientResolver.resolveConversationRecipient(
          conversationId,
        );
    if (!recipient) {
      const reason =
        recipientResolution && !recipientResolution.resolved
          ? recipientResolution.reason
          : 'no_recipient';
      const message = `[trigger-emit-ack] DROP no recipient conversationId=${conversationId} messageId=${messageId} reason=${reason}`;
      if (
        reason === 'exact_machine_not_ready' ||
        reason === 'exact_machine_credential_unavailable'
      ) {
        this.logger.debug(message);
      } else {
        this.logger.warn(message);
      }
      return { acknowledged: false, reason };
    }
    if (machineId && machineId !== recipient.machineId) {
      this.logger.warn('[trigger-emit-ack] DROP caller machine mismatch', {
        conversationId,
        messageId,
      });
      return { acknowledged: false, reason: 'invalid_machine' };
    }

    const authorization = await this.authorizeConversationTrigger({
      recipient,
      organizationId,
      projectId,
      conversationId,
      messageId,
      authorizationId,
      grantId,
      envelopeAuthorization,
      preferPersistedActivation,
      actionPayloadHash,
    });
    if (!authorization) {
      return { acknowledged: false, reason: 'authorization_required' };
    }

    this.logger.debug(
      `[trigger-emit-ack] resolved recipient conversationId=${conversationId} messageId=${messageId} userId=${recipient.userId} machineId=${recipient.machineId}`,
    );

    const workflowKickoffPayload =
      trigger.promptType === 'start_run' &&
      trigger.payload?.payload?.promptType === 'workflow_kickoff'
        ? trigger.payload.payload
        : undefined;
    this.logger.debug('[trigger-emit-ack] signing persisted trigger', {
      event: 'trigger_emitter.signing',
      conversationId,
      messageId,
      promptType: trigger.promptType,
      focalScope: workflowKickoffPayload
        ? workflowKickoffPayload.entity
          ? 'entity'
          : 'unscoped'
        : undefined,
      entityType: workflowKickoffPayload?.entity?.entityType,
      entityId: workflowKickoffPayload?.entity?.entityId,
    });

    const envelope = this.signer.signConversationTriggerAuthorized(
      trigger,
      recipient.machineId,
      recipient.userId,
      authorization,
    );

    const event: WebSocketConversationTriggerEvent = {
      type: WebSocketConversationTriggerEvent.TypeEnum.TriggerConversation,
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: recipient.userId,
      envelope,
    };

    this.logger.debug(
      '[trigger-emit-ack] emitting trigger.conversation with ack',
      {
        conversationId,
        messageId,
        userId: recipient.userId,
        machineId: recipient.machineId,
        focalScope: workflowKickoffPayload
          ? workflowKickoffPayload.entity
            ? 'entity'
            : 'unscoped'
          : undefined,
      },
    );

    const ack = await this.gateway.emitConversationTriggerWithAck(
      event,
      timeoutMs ?? 4000,
    );

    this.logger.debug(
      `[trigger-emit-ack] exit conversationId=${conversationId} messageId=${messageId} machineId=${recipient.machineId} acknowledged=${String(ack.acknowledged)} reason=${'reason' in ack ? ack.reason : 'none'}`,
    );

    if (!ack.acknowledged) {
      return {
        acknowledged: false,
        reason:
          ack.reason === 'cli_rejected' && ack.acknowledgement
            ? `cli_rejected:${ack.acknowledgement.stage}:${ack.acknowledgement.reason}`
            : ack.reason,
      };
    }

    const operation =
      trigger.promptType === 'start_run' ||
      trigger.promptType === 'user_message'
        ? trigger
        : trigger.inputExecution;
    if (
      !operation ||
      ack.acknowledgement.operationId !== operation.operationId ||
      ack.acknowledgement.operationFingerprint !==
        operation.operationFingerprint
    ) {
      this.logger.warn(
        '[trigger-emit-ack] DROP acknowledgement identity mismatch',
        {
          conversationId,
          messageId,
          machineId: recipient.machineId,
        },
      );
      return {
        acknowledged: false,
        reason: 'acknowledgement_identity_mismatch',
      };
    }

    return {
      acknowledged: true,
      machineId: recipient.machineId,
      acknowledgement: ack.acknowledgement,
    };
  }

  async deliverMonitorCommand(
    commandId: string,
    timeoutMs = 4000,
  ): Promise<SubmitTaskMonitorCommandResponseDto> {
    const record = await this.prisma.db.monitorCommand.findUnique({
      where: { id: commandId },
    });
    if (!record) {
      throw new Error(`Monitor command ${commandId} was not found`);
    }

    const prior = this.readMonitorAcknowledgement(record.outcome);
    if (prior) return this.toMonitorCommandResponse(commandId, prior, true);

    if (record.expiresAt.getTime() <= Date.now()) {
      const expired: MonitorCommandRejectedAcknowledgement = {
        status: 'REJECTED',
        commandId,
        stage: 'VERIFICATION',
        reason: 'EXPIRED',
        message: 'The command expired before a verified machine admitted it.',
      };
      await this.persistMonitorAcknowledgement(commandId, expired);
      return this.toMonitorCommandResponse(commandId, expired, false);
    }

    const body = record.body as unknown as MonitorCommandBody;
    if (this.isAuthorityReduction(body.command)) {
      return this.deliverMonitorReduction(record, body, body.command);
    }
    if (this.isAuthorityNeutral(body.command)) {
      return this.deliverMonitorAuthorityNeutral(record, body, body.command);
    }
    const actionType = this.monitorActionType(body.command.cause);
    if (
      !actionType ||
      body.version !== MonitorCommandBody.VersionEnum.NUMBER_1 ||
      !record.authorizationId ||
      !record.authorization ||
      !this.executableFrameAuthorization
    ) {
      const rejected: MonitorCommandRejectedAcknowledgement = {
        status: 'REJECTED',
        commandId,
        stage: 'VERIFICATION',
        reason: 'ROUTE_REJECTED',
        message: 'No executable authorization is available for this command.',
      };
      await this.persistMonitorAcknowledgement(commandId, rejected);
      return this.toMonitorCommandResponse(commandId, rejected, false);
    }
    const persistedGrant = await this.prisma.db.executionGrant.findUnique({
      where: { authorizationId: record.authorizationId },
      select: {
        selectedWorkFingerprint: true,
        policyFingerprint: true,
        authorization: { select: { actionPayloadHash: true } },
      },
    });
    if (!persistedGrant) {
      const rejected: MonitorCommandRejectedAcknowledgement = {
        status: 'REJECTED',
        commandId,
        stage: 'VERIFICATION',
        reason: 'ROUTE_REJECTED',
        message: 'The execution grant is missing.',
      };
      await this.persistMonitorAcknowledgement(commandId, rejected);
      return this.toMonitorCommandResponse(commandId, rejected, false);
    }
    const protocol2Body: MonitorCommandBodyV2 = {
      ...body,
      version: MonitorCommandBodyV2.VersionEnum.NUMBER_2,
      command: body.command as MonitorCommandBodyV2['command'],
    };
    const authorization =
      await this.executableFrameAuthorization.resolveSelectedAuthorization({
        machineId: record.machineId as MachineId,
        userId: record.userId as UserId,
        organizationId: record.organizationId as OrganizationId,
        projectId: record.projectId as ProjectId,
        actionType,
        actionPayloadHash: persistedGrant.authorization.actionPayloadHash,
        target: {
          kind: HostActionTargetKind.TaskMonitor,
          id: record.monitorId,
          revision: null,
        },
        agentSessionId: null,
        taskMonitorId: record.monitorId as TaskId,
        selectedWorkFingerprint: persistedGrant.selectedWorkFingerprint,
        policyFingerprint: persistedGrant.policyFingerprint,
        authorizationId: record.authorizationId,
        envelopeAuthorization:
          record.authorization as unknown as ExecutableEnvelopeAuthorization,
      });
    if (!authorization) {
      const rejected: MonitorCommandRejectedAcknowledgement = {
        status: 'REJECTED',
        commandId,
        stage: 'VERIFICATION',
        reason: 'ROUTE_REJECTED',
        message: 'The execution grant no longer authorizes delivery.',
      };
      await this.persistMonitorAcknowledgement(commandId, rejected);
      return this.toMonitorCommandResponse(commandId, rejected, false);
    }
    const envelope = this.signer.signMonitorCommandAuthorized(
      protocol2Body,
      record.machineId as MachineId,
      record.userId as UserId,
      authorization,
    );
    const event: WebSocketMonitorCommandEvent = {
      type: WebSocketMonitorCommandEvent.TypeEnum.TriggerMonitorCommand,
      timestamp: new Date().toISOString(),
      organizationId: record.organizationId,
      projectId: record.projectId,
      userId: record.userId,
      envelope,
    };

    await this.prisma.db.monitorCommand.update({
      where: { id: commandId },
      data: {
        deliveryState: 'SENT',
        attemptCount: { increment: 1 },
        lastAttemptAt: new Date(),
      },
    });
    this.logger.log('[monitor-command] delivery attempted', {
      commandId,
      monitorId: record.monitorId,
      machineId: record.machineId,
      cause: body.command.cause,
    });

    const acknowledgement = await this.gateway.emitMonitorCommandWithAck(
      event,
      timeoutMs,
    );
    if (!acknowledgement) {
      await this.prisma.db.monitorCommand.update({
        where: { id: commandId },
        data: { deliveryState: 'QUEUED' },
      });
      return {
        commandId,
        status: SubmitTaskMonitorCommandResponseDto.StatusEnum.Queued,
      };
    }

    const correlated = { ...acknowledgement, commandId };
    await this.persistMonitorAcknowledgement(commandId, correlated);
    return this.toMonitorCommandResponse(commandId, correlated, false);
  }

  async emitApplicationEffect(params: {
    body: ApplicationEffectLaunchBody;
    recipientUserId: UserId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    authorizationId?: string;
    actionPayloadHash?: string;
  }): Promise<{ emitted: boolean; reason?: string }> {
    const recipient = await this.recipientResolver.resolveMachineForUser(
      params.recipientUserId,
    );
    if (!recipient || !this.executableFrameAuthorization) {
      return { emitted: false, reason: 'authorization_required' };
    }
    const authorization =
      await this.executableFrameAuthorization.resolveBoundedGrant({
        machineId: recipient.machineId,
        userId: recipient.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        actionType: HostAffectingActionType.ApplicationEffectLaunch,
        actionPayloadHash: params.actionPayloadHash,
        target: {
          kind: HostActionTargetKind.ApplicationEffect,
          id: params.body.effectId,
          revision: null,
        },
        agentSessionId: params.body.agentSessionId as AgentSessionId,
        taskMonitorId: null,
        authorizationId: params.authorizationId,
      });
    if (!authorization)
      return { emitted: false, reason: 'authorization_required' };
    const event: WebSocketApplicationEffectEvent = {
      type: WebSocketApplicationEffectEvent.TypeEnum.TriggerApplicationEffect,
      timestamp: new Date().toISOString(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: recipient.userId,
      envelope: this.signer.signApplicationEffectAuthorized(
        params.body,
        recipient.machineId,
        recipient.userId,
        authorization,
      ),
    };
    this.gateway.emitApplicationEffect(event);
    return { emitted: true };
  }

  async emitExactAction(params: {
    body: ExactActionDeliveryBody;
    recipientUserId: UserId;
    organizationId: OrganizationId;
    projectId: ProjectId;
    authorizationId?: string;
    actionPayloadHash?: string;
  }): Promise<{ emitted: boolean; reason?: string }> {
    const recipient = await this.recipientResolver.resolveMachineForUser(
      params.recipientUserId,
    );
    if (!recipient || !this.executableFrameAuthorization) {
      return { emitted: false, reason: 'authorization_required' };
    }
    const authorization =
      await this.executableFrameAuthorization.resolveBoundedGrant({
        machineId: recipient.machineId,
        userId: recipient.userId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        actionType: HostAffectingActionType.ExactActionDelivery,
        actionPayloadHash: params.actionPayloadHash,
        target: {
          kind: HostActionTargetKind.ExactAction,
          id: params.body.exactActionId,
          revision: params.body.requestRevision,
        },
        agentSessionId: null,
        taskMonitorId: null,
        authorizationId: params.authorizationId,
      });
    if (!authorization)
      return { emitted: false, reason: 'authorization_required' };
    this.gateway.emitExactAction({
      type: WebSocketExactActionEvent.TypeEnum.TriggerExactAction,
      timestamp: new Date().toISOString(),
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: recipient.userId,
      envelope: this.signer.signExactActionAuthorized(
        params.body,
        recipient.machineId,
        recipient.userId,
        authorization,
      ),
    });
    return { emitted: true };
  }

  private monitorActionType(
    cause: MonitorCommandBody['command']['cause'],
  ): HostAffectingActionType | null {
    switch (cause) {
      case 'START':
        return HostAffectingActionType.TaskMonitorStart;
      case 'RESUME':
        return HostAffectingActionType.TaskMonitorResume;
      case 'JUDGMENT_RESOLVED':
        return HostAffectingActionType.TaskMonitorJudgmentResolved;
      case 'CONTINUE':
        return HostAffectingActionType.TaskMonitorContinue;
      case 'COMPLETE':
        return HostAffectingActionType.TaskMonitorComplete;
      case 'PAUSE':
      case 'STOP':
      case 'HALT':
        return null;
      default:
        return null;
    }
  }

  private async deliverMonitorReduction(
    record: {
      id: string;
      organizationId: string;
      projectId: string;
      monitorId: string;
      userId: string;
      machineId: string;
      body: Prisma.JsonValue;
    },
    body: MonitorCommandBody,
    command: Extract<
      MonitorCommandBody['command'],
      { cause: 'PAUSE' | 'STOP' | 'HALT' }
    >,
  ): Promise<SubmitTaskMonitorCommandResponseDto> {
    if (
      body.version !== MonitorCommandBody.VersionEnum.NUMBER_1 ||
      body.kind !== MonitorCommandBody.KindEnum.TaskMonitorCommand
    ) {
      const rejected: MonitorCommandRejectedAcknowledgement = {
        status: 'REJECTED',
        commandId: record.id,
        stage: 'VERIFICATION',
        reason: 'SCHEMA_INVALID',
        message: 'The monitor reduction body is invalid.',
      };
      await this.persistMonitorAcknowledgement(record.id, rejected);
      return this.toMonitorCommandResponse(record.id, rejected, false);
    }

    const machine = await this.prisma.db.machine.findFirst({
      where: {
        id: record.machineId,
        userId: record.userId,
        organizationId: record.organizationId,
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
      },
      select: { id: true },
    });
    if (!machine) {
      const rejected: MonitorCommandRejectedAcknowledgement = {
        status: 'REJECTED',
        commandId: record.id,
        stage: 'VERIFICATION',
        reason: 'ROUTE_REJECTED',
        message: 'No verified protocol-2 machine is available.',
      };
      await this.persistMonitorAcknowledgement(record.id, rejected);
      return this.toMonitorCommandResponse(record.id, rejected, false);
    }

    const reductionBody: MonitorAuthorityReductionBodyV2 = {
      version: MonitorAuthorityReductionBodyV2.VersionEnum.NUMBER_2,
      kind: MonitorAuthorityReductionBodyV2.KindEnum
        .TaskMonitorAuthorityReduction,
      commandId: record.id,
      createdAt: body.createdAt,
      expiresAt: body.expiresAt,
      organizationId: record.organizationId,
      projectId: record.projectId,
      target: body.target,
      command,
    };
    const envelope = this.signer.signMonitorReduction(
      reductionBody,
      machine.id as MachineId,
      record.userId as UserId,
    );
    const event: WebSocketMonitorReductionEvent = {
      type: WebSocketMonitorReductionEvent.TypeEnum.TriggerMonitorReduction,
      timestamp: new Date().toISOString(),
      organizationId: record.organizationId,
      projectId: record.projectId,
      userId: record.userId,
      envelope,
    };
    const emitted = await this.gateway.emitMonitorReduction(event);
    if (!emitted) {
      await this.prisma.db.monitorCommand.update({
        where: { id: record.id },
        data: { deliveryState: 'QUEUED' },
      });
      return {
        commandId: record.id,
        status: SubmitTaskMonitorCommandResponseDto.StatusEnum.Queued,
      };
    }

    const acknowledgement: MonitorCommandAcknowledgement = {
      status: 'ADMITTED',
      commandId: record.id,
      replayed: false,
    };
    await this.persistMonitorAcknowledgement(record.id, acknowledgement);
    return this.toMonitorCommandResponse(record.id, acknowledgement, false);
  }

  private async deliverMonitorAuthorityNeutral(
    record: {
      id: string;
      organizationId: string;
      projectId: string;
      monitorId: string;
      userId: string;
      machineId: string;
      body: Prisma.JsonValue;
    },
    body: MonitorCommandBody,
    command: Extract<
      MonitorCommandBody['command'],
      { cause: 'GUIDANCE_CHANGED' | 'HUMAN_DECISION' }
    >,
  ): Promise<SubmitTaskMonitorCommandResponseDto> {
    const machine = await this.prisma.db.machine.findFirst({
      where: {
        id: record.machineId,
        userId: record.userId,
        organizationId: record.organizationId,
        revokedAt: null,
        authorizationProtocolVersion: 2,
        authorizationState: 'READY',
      },
      select: { id: true },
    });
    if (!machine) {
      const rejected: MonitorCommandRejectedAcknowledgement = {
        status: 'REJECTED',
        commandId: record.id,
        stage: 'VERIFICATION',
        reason: 'ROUTE_REJECTED',
        message: 'No verified protocol-2 machine is available.',
      };
      await this.persistMonitorAcknowledgement(record.id, rejected);
      return this.toMonitorCommandResponse(record.id, rejected, false);
    }

    const neutralBody: MonitorAuthorityNeutralBodyV2 = {
      version: MonitorAuthorityNeutralBodyV2.VersionEnum.NUMBER_2,
      kind: MonitorAuthorityNeutralBodyV2.KindEnum.TaskMonitorAuthorityNeutral,
      commandId: record.id,
      createdAt: body.createdAt,
      expiresAt: body.expiresAt,
      organizationId: record.organizationId,
      projectId: record.projectId,
      target: body.target,
      command,
    };
    const envelope = this.signer.signMonitorAuthorityNeutral(
      neutralBody,
      machine.id as MachineId,
      record.userId as UserId,
    );
    const event: WebSocketMonitorCommandEvent = {
      type: WebSocketMonitorCommandEvent.TypeEnum.TriggerMonitorCommand,
      timestamp: new Date().toISOString(),
      organizationId: record.organizationId,
      projectId: record.projectId,
      userId: record.userId,
      envelope,
    };
    const acknowledgement = await this.gateway.emitMonitorCommandWithAck(
      event,
      4000,
    );
    if (!acknowledgement) {
      await this.prisma.db.monitorCommand.update({
        where: { id: record.id },
        data: { deliveryState: 'QUEUED' },
      });
      return {
        commandId: record.id,
        status: SubmitTaskMonitorCommandResponseDto.StatusEnum.Queued,
      };
    }
    const correlated = { ...acknowledgement, commandId: record.id };
    await this.persistMonitorAcknowledgement(record.id, correlated);
    return this.toMonitorCommandResponse(record.id, correlated, false);
  }

  private isAuthorityReduction(
    command: MonitorCommandBody['command'],
  ): command is Extract<
    MonitorCommandBody['command'],
    { cause: 'PAUSE' | 'STOP' | 'HALT' }
  > {
    return (
      command.cause === 'PAUSE' ||
      command.cause === 'STOP' ||
      command.cause === 'HALT'
    );
  }

  private isAuthorityNeutral(
    command: MonitorCommandBody['command'],
  ): command is Extract<
    MonitorCommandBody['command'],
    { cause: 'GUIDANCE_CHANGED' | 'HUMAN_DECISION' }
  > {
    return (
      command.cause === 'GUIDANCE_CHANGED' || command.cause === 'HUMAN_DECISION'
    );
  }

  async refanPendingMonitorCommandsForMachine(
    machineId: MachineId,
  ): Promise<void> {
    const pending = await this.prisma.db.monitorCommand.findMany({
      where: {
        machineId,
        deliveryState: { in: ['QUEUED', 'SENT'] },
        outcome: { equals: Prisma.DbNull },
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    this.logger.log('[monitor-command] reconnect re-fan', {
      machineId,
      commandCount: pending.length,
    });
    for (const command of pending) {
      try {
        await this.deliverMonitorCommand(command.id);
      } catch (error) {
        this.logger.error('[monitor-command] reconnect delivery failed', {
          machineId,
          commandId: command.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private async persistMonitorAcknowledgement(
    commandId: string,
    acknowledgement: MonitorCommandAcknowledgement,
  ): Promise<void> {
    await this.prisma.db.monitorCommand.update({
      where: { id: commandId },
      data: {
        deliveryState: 'RECEIVED',
        outcome: acknowledgement as Prisma.InputJsonValue,
        acknowledgedAt: new Date(),
      },
    });
  }

  private readMonitorAcknowledgement(
    value: Prisma.JsonValue | null,
  ): MonitorCommandAcknowledgement | null {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    if (value.status === 'ADMITTED' && typeof value.commandId === 'string') {
      return value as unknown as MonitorCommandAcknowledgement;
    }
    if (value.status === 'REJECTED') {
      return value as unknown as MonitorCommandAcknowledgement;
    }
    return null;
  }

  private toMonitorCommandResponse(
    commandId: string,
    acknowledgement: MonitorCommandAcknowledgement,
    replayed: boolean,
  ): SubmitTaskMonitorCommandResponseDto {
    if (acknowledgement.status === 'ADMITTED') {
      return {
        commandId,
        status: SubmitTaskMonitorCommandResponseDto.StatusEnum.Admitted,
        replayed: replayed || acknowledgement.replayed,
      };
    }
    return {
      commandId,
      status: SubmitTaskMonitorCommandResponseDto.StatusEnum.Rejected,
      replayed,
      stage: acknowledgement.stage,
      reason: acknowledgement.reason,
      message: acknowledgement.message,
    };
  }

  /**
   * Sign and emit a `trigger.control` frame carrying a `stop_run` body for
   * the active CLI run that owns the given conversation.
   *
   * Recipient resolution walks conversation → `AgentSession.userId` → most
   * recently paired active machine — the same path
   * `emitConversationTriggerForMessage` uses. Cross-user attempts are
   * rejected here, before signing: the acting user must own the resolved
   * agent session. Returns `false` on any reason the frame is not emitted
   * (no recipient resolvable, owner mismatch); returns `true` on emit. This
   * is a side channel — callers must not couple their HTTP response to the
   * boolean for anything but observability.
   */
  async emitStopRunControl(params: {
    runId: string;
    conversationId: ConversationId;
    actingUserId: UserId;
    organizationId: OrganizationId;
    projectId?: ProjectId;
  }): Promise<{ emitted: boolean; reason?: string }> {
    const { runId, conversationId, actingUserId, organizationId, projectId } =
      params;

    const recipient =
      await this.recipientResolver.resolveConversationRecipient(conversationId);
    if (!recipient) {
      this.logger.warn(
        `[trigger-emit] DROP stop_run no recipient conversationId=${conversationId} runId=${runId}`,
      );
      return { emitted: false, reason: 'no_recipient' };
    }

    if (recipient.userId !== actingUserId) {
      // Cross-user attempt — the conversation is owned by a different user.
      // Refuse to sign or emit; the caller's HTTP layer should be returning
      // 403 to the acting user.
      this.logger.warn(
        `[trigger-emit] DROP stop_run owner mismatch conversationId=${conversationId} runId=${runId} actingUserId=${actingUserId} ownerUserId=${recipient.userId}`,
      );
      return { emitted: false, reason: 'owner_mismatch' };
    }

    const body: ConversationControlStopRun = {
      kind: ConversationControlStopRun.KindEnum.StopRun,
      conversationId,
      runId,
    };

    const envelope = this.signer.signConversationReduction(
      body,
      recipient.machineId,
      recipient.userId,
    );

    const event: WebSocketConversationReductionEvent = {
      type: WebSocketConversationReductionEvent.TypeEnum
        .TriggerControlReduction,
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: recipient.userId,
      envelope,
    };

    this.logger.log('Emitting trigger.control frame', {
      conversationId,
      runId,
      userId: recipient.userId,
      machineId: recipient.machineId,
      kind: body.kind,
    });
    this.gateway.emitConversationReduction(event);
    return { emitted: true };
  }

  /**
   * Sign and emit a `trigger.control` frame carrying a `compact_run` body for
   * the active CLI run that owns the given conversation.
   *
   * Recipient resolution walks conversation → `AgentSession.userId` → most
   * recently paired active machine — the same path
   * `emitConversationTriggerForMessage` uses. Cross-user attempts are
   * rejected here, before signing: the acting user must own the resolved
   * agent session. Returns `false` on any reason the frame is not emitted
   * (no recipient resolvable, owner mismatch); returns `true` on emit. This
   * is a side channel — callers must not couple their HTTP response to the
   * boolean for anything but observability.
   */
  async emitCompactRunControl(params: {
    agentSessionId: string;
    runId: string;
    conversationId: ConversationId;
    actingUserId: UserId;
    organizationId: OrganizationId;
    projectId?: ProjectId;
    authorizationId?: string;
    envelopeAuthorization?: ExecutableEnvelopeAuthorization;
    actionPayloadHash?: string;
  }): Promise<{ emitted: boolean; reason?: string }> {
    const { runId, conversationId, actingUserId, organizationId, projectId } =
      params;

    const recipient =
      await this.recipientResolver.resolveConversationRecipient(conversationId);
    if (!recipient) {
      this.logger.warn(
        `[trigger-emit] DROP compact_run no recipient conversationId=${conversationId} runId=${runId}`,
      );
      return { emitted: false, reason: 'no_recipient' };
    }

    if (recipient.userId !== actingUserId) {
      // Cross-user attempt — the conversation is owned by a different user.
      // Refuse to sign or emit; the caller's HTTP layer should be returning
      // 403 to the acting user.
      this.logger.warn(
        `[trigger-emit] DROP compact_run owner mismatch conversationId=${conversationId} runId=${runId} actingUserId=${actingUserId} ownerUserId=${recipient.userId}`,
      );
      return { emitted: false, reason: 'owner_mismatch' };
    }

    const authorization = await this.authorizeAgentSessionAction({
      recipient,
      organizationId,
      projectId,
      conversationId,
      actionType: HostAffectingActionType.ConversationControlCompactRun,
      authorizationId: params.authorizationId,
      envelopeAuthorization: params.envelopeAuthorization,
      actionPayloadHash: params.actionPayloadHash,
    });
    if (!authorization) {
      return { emitted: false, reason: 'authorization_required' };
    }

    const body: ConversationControlCompactRun = {
      kind: ConversationControlCompactRun.KindEnum.CompactRun,
      agentSessionId: params.agentSessionId,
      conversationId,
      runId,
    };

    const envelope = this.signer.signConversationControlAuthorized(
      body,
      recipient.machineId,
      recipient.userId,
      authorization,
    );

    const event: WebSocketConversationControlEvent = {
      type: WebSocketConversationControlEvent.TypeEnum.TriggerControl,
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: recipient.userId,
      envelope,
    };

    this.logger.log('Emitting trigger.control frame', {
      conversationId,
      runId,
      userId: recipient.userId,
      machineId: recipient.machineId,
      kind: body.kind,
    });
    this.gateway.emitConversationControl(event);
    return { emitted: true };
  }

  /**
   * Sign and emit a `trigger.control` frame carrying a `permission_decision`
   * body for the live CLI runner awaiting the matching permission gate on the
   * given conversation. This is the producer side of delivering permission
   * decisions over the authenticated channel, replacing the unauthenticated
   * local HTTP POST that delivery rode previously.
   *
   * Recipient resolution and the cross-user owner check mirror
   * `emitStopRunControl`/`emitCompactRunControl`: the acting user must own the
   * resolved agent session, rejected here before signing. Unlike stop/compact,
   * the body carries no `conversationId`/`runId` — the CLI dispatcher matches
   * the frame to the awaiting runner via `requestId`, `sessionId`, and
   * `agentType`; the conversation is used only to route to the owner's machine.
   * Returns `false` on any reason the frame is not emitted (no recipient,
   * owner mismatch); `true` on emit. Side channel — callers must not couple
   * their HTTP response to the boolean for anything but observability.
   */
  async emitPermissionDecisionControl(
    params: AgentSessionControlParams & {
      decision: ConversationControlPermissionDecision.DecisionEnum;
      requestId: string;
      sessionId: string;
      agentType: ConversationControlPermissionDecision.AgentTypeEnum;
      reason?: string | null;
      idempotencyToken: string;
    },
  ): Promise<{ emitted: boolean; reason?: string }> {
    return this.emitAgentSessionControl(
      params,
      HostAffectingActionType.ConversationControlPermissionDecision,
      {
        kind: ConversationControlPermissionDecision.KindEnum.PermissionDecision,
        agentSessionId: params.agentSessionId,
        decision: params.decision,
        requestId: params.requestId,
        sessionId: params.sessionId,
        agentType: params.agentType,
        reason: params.reason,
        idempotencyToken: params.idempotencyToken,
      },
    );
  }

  /**
   * Sign and emit a `trigger.control` frame carrying a `question_answer` body
   * for the live CLI runner whose question tool call is waiting. Same
   * recipient and owner rules as permission decisions; authorized as a
   * conversation trigger because an answer is the user replying.
   */
  async emitQuestionAnswerControl(
    params: AgentSessionControlParams & {
      requestId: string;
      sessionId: string;
      agentType: ConversationControlQuestionAnswer.AgentTypeEnum;
      answers: Record<string, string>;
      idempotencyToken: string;
    },
  ): Promise<{ emitted: boolean; reason?: string }> {
    return this.emitAgentSessionControl(
      params,
      HostAffectingActionType.ConversationTrigger,
      {
        kind: ConversationControlQuestionAnswer.KindEnum.QuestionAnswer,
        agentSessionId: params.agentSessionId,
        requestId: params.requestId,
        sessionId: params.sessionId,
        agentType: params.agentType,
        answers: params.answers,
        idempotencyToken: params.idempotencyToken,
      },
    );
  }

  private async emitAgentSessionControl(
    params: AgentSessionControlParams,
    actionType: HostAffectingActionType,
    body:
      | ConversationControlPermissionDecision
      | ConversationControlQuestionAnswer,
  ): Promise<{ emitted: boolean; reason?: string }> {
    const { conversationId, actingUserId, organizationId, projectId } = params;
    const { requestId } = body;

    const recipient =
      await this.recipientResolver.resolveConversationRecipient(conversationId);
    if (!recipient) {
      this.logger.warn(
        `[trigger-emit] DROP ${body.kind} no recipient conversationId=${conversationId} requestId=${requestId}`,
      );
      return { emitted: false, reason: 'no_recipient' };
    }

    if (recipient.userId !== actingUserId) {
      // Cross-user attempt — the conversation is owned by a different user.
      // Refuse to sign or emit; the caller's HTTP layer should be returning
      // 403 to the acting user.
      this.logger.warn(
        `[trigger-emit] DROP ${body.kind} owner mismatch conversationId=${conversationId} requestId=${requestId} actingUserId=${actingUserId} ownerUserId=${recipient.userId}`,
      );
      return { emitted: false, reason: 'owner_mismatch' };
    }

    const authorization = await this.authorizeAgentSessionAction({
      recipient,
      organizationId,
      projectId,
      conversationId,
      actionType,
      authorizationId: params.authorizationId,
      envelopeAuthorization: params.envelopeAuthorization,
      actionPayloadHash: params.actionPayloadHash,
    });
    if (!authorization) {
      return { emitted: false, reason: 'authorization_required' };
    }

    const envelope = this.signer.signConversationControlAuthorized(
      body,
      recipient.machineId,
      recipient.userId,
      authorization,
    );

    const event: WebSocketConversationControlEvent = {
      type: WebSocketConversationControlEvent.TypeEnum.TriggerControl,
      timestamp: new Date().toISOString(),
      organizationId,
      projectId,
      conversationId,
      userId: recipient.userId,
      envelope,
    };

    this.logger.log('Emitting trigger.control frame', {
      conversationId,
      requestId,
      sessionId: body.sessionId,
      agentType: body.agentType,
      ...('decision' in body ? { decision: body.decision } : {}),
      userId: recipient.userId,
      machineId: recipient.machineId,
      kind: body.kind,
    });
    this.gateway.emitConversationControl(event);
    return { emitted: true };
  }

  private async authorizeConversationTrigger(params: {
    recipient: {
      machineId: MachineId;
      userId: UserId;
      agentSessionId?: string;
      projectId?: ProjectId;
    };
    organizationId: OrganizationId;
    projectId?: ProjectId;
    conversationId: string;
    messageId: MessageId;
    authorizationId?: string;
    grantId?: string;
    envelopeAuthorization?: ExecutableEnvelopeAuthorization;
    preferPersistedActivation?: boolean;
    actionPayloadHash?: string;
  }) {
    if (!this.executableFrameAuthorization) {
      this.logger.warn(
        '[trigger-emit] DROP authorization service unavailable',
        {
          machineId: params.recipient.machineId,
          messageId: params.messageId,
        },
      );
      return null;
    }
    if (!params.recipient.agentSessionId) {
      this.logger.warn('[trigger-emit] DROP no agent-session binding', {
        machineId: params.recipient.machineId,
        messageId: params.messageId,
      });
      return null;
    }
    const resolvedProjectId = params.projectId ?? params.recipient.projectId;
    if (!resolvedProjectId) {
      this.logger.warn('[trigger-emit] DROP no project binding', {
        machineId: params.recipient.machineId,
        messageId: params.messageId,
      });
      return null;
    }
    return this.executableFrameAuthorization.resolveSelectedAuthorization({
      machineId: params.recipient.machineId,
      userId: params.recipient.userId,
      organizationId: params.organizationId,
      projectId: resolvedProjectId,
      actionType: HostAffectingActionType.ConversationTrigger,
      actionPayloadHash: params.actionPayloadHash,
      target: {
        kind: HostActionTargetKind.AgentSession,
        id: params.recipient.agentSessionId,
        revision: null,
      },
      agentSessionId: params.recipient.agentSessionId as AgentSessionId,
      conversationId: params.conversationId,
      authorizedTurnId: params.messageId,
      taskMonitorId: null,
      authorizationId: params.authorizationId,
      grantId: params.grantId,
      envelopeAuthorization: params.envelopeAuthorization,
      preferPersistedActivation: params.preferPersistedActivation,
    });
  }

  private async authorizeAgentSessionAction(params: {
    recipient: {
      machineId: MachineId;
      userId: UserId;
      agentSessionId?: string;
      projectId?: ProjectId;
    };
    organizationId: OrganizationId;
    projectId?: ProjectId;
    conversationId: string;
    actionType: HostAffectingActionType;
    authorizationId?: string;
    envelopeAuthorization?: ExecutableEnvelopeAuthorization;
    actionPayloadHash?: string;
  }) {
    if (
      !this.executableFrameAuthorization ||
      !params.recipient.agentSessionId
    ) {
      return null;
    }
    const resolvedProjectId = params.projectId ?? params.recipient.projectId;
    if (!resolvedProjectId) return null;
    return this.executableFrameAuthorization.resolveSelectedAuthorization({
      machineId: params.recipient.machineId,
      userId: params.recipient.userId,
      organizationId: params.organizationId,
      projectId: resolvedProjectId,
      actionType: params.actionType,
      actionPayloadHash: params.actionPayloadHash,
      target: {
        kind: HostActionTargetKind.AgentSession,
        id: params.recipient.agentSessionId,
        revision: null,
      },
      agentSessionId: params.recipient.agentSessionId as AgentSessionId,
      conversationId: params.conversationId,
      taskMonitorId: null,
      authorizationId: params.authorizationId,
      envelopeAuthorization: params.envelopeAuthorization,
    });
  }

  /**
   * Pull a well-formed `AgentTrigger` body off a persisted message's `data`
   * column. Returns `null` for any shape that is not a trigger — the
   * detection mirrors `PendingTriggerService`, which keys purely on the
   * presence of the `triggersAgent` object.
   */
  private extractTriggersAgent(data: unknown): AgentTrigger | null {
    if (!data || typeof data !== 'object') {
      return null;
    }
    // Both SYSTEM and USER message data declare `triggersAgent?: AgentTrigger`,
    // so reading it off the typed union yields a well-typed value with no
    // bag cast or redundant assertion.
    const messageData = data as SystemMessageData | UserMessageData;
    const triggersAgent = messageData.triggersAgent;
    if (!triggersAgent || typeof triggersAgent !== 'object') {
      return null;
    }
    return triggersAgent;
  }
}

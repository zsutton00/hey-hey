import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { validate as isUuid, v5 as uuidv5 } from 'uuid';
import {
  AgentSystemMessageData,
  ExtendedUIFieldType,
  MachineEffectHttpMethod,
  MessageStatus,
  SubmitExternalAgentCompletionRequestDto,
  SubmitExternalAgentCompletionResponseDto,
  SystemMessageData,
} from '../../generated';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AgentSessionId,
  MessageId,
  OrganizationId,
  ProjectId,
} from '../../types';
import { isExternalAgentNode } from '../../types/flow-internal.types';
import { MachineEffectAdmissionService } from '../machine-effect-admission/machine-effect-admission.service';
import type { AuthenticatedMachine } from '../machine-pairing/machine-pairing.service';
import { MessageService } from '../message.service';
import { FlowExecutionService } from '../workflows/flow-execution.service';
import { NodeExecutionService } from '../workflows/node-execution.service';
import { PendingTriggerService } from '../workflows/pending-trigger.service';

const OPERATION_ID = 'submitExternalAgentCompletion';
const COMPLETION_MESSAGE_NAMESPACE = '7ca9aac7-8e0c-47b2-b5a1-03588bb8b131';

@Injectable()
export class ExternalAgentCompletionService {
  private readonly logger = new Logger(ExternalAgentCompletionService.name);

  public constructor(
    private readonly prisma: PrismaService,
    private readonly machineEffectAdmission: MachineEffectAdmissionService,
    private readonly messageService: MessageService,
    private readonly flowExecutionService: FlowExecutionService,
    private readonly pendingTriggerService: PendingTriggerService,
    private readonly nodeExecutionService: NodeExecutionService,
  ) {}

  public async submit(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    agentSessionId: AgentSessionId;
    authenticatedMachine: AuthenticatedMachine;
    requestPath: string;
    input: SubmitExternalAgentCompletionRequestDto;
  }): Promise<SubmitExternalAgentCompletionResponseDto> {
    this.assertExactRequestShape(params.input);
    const { proof, ...semanticRequest } = params.input;
    this.logger.debug('Admitting EXTERNAL_AGENT completion effect', {
      organizationId: params.organizationId,
      projectId: params.projectId,
      agentSessionId: params.agentSessionId,
      conversationId: params.input.conversationId,
      workflowNodeId: params.input.workflowNodeId,
      pendingTriggerMessageId: params.input.pendingTriggerMessageId,
      action: params.input.action,
      effectId: proof.effectId,
    });
    const admitted = await this.machineEffectAdmission.admit({
      authenticatedMachine: params.authenticatedMachine,
      proof,
      operationId: OPERATION_ID,
      method: MachineEffectHttpMethod.Post,
      path: params.requestPath,
      payload: semanticRequest,
    });

    const session = await this.prisma.db.agentSession.findFirst({
      where: {
        id: params.agentSessionId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        conversationId: params.input.conversationId,
        machineId: admitted.machineId,
        userId: admitted.userId,
      },
      select: { id: true },
    });
    if (!session) this.bindingMismatch('agent_session');

    const completionMessageId = uuidv5(
      canonicalizeJcs({
        machineId: admitted.machineId,
        effectId: admitted.effectId,
        request: semanticRequest,
      }),
      COMPLETION_MESSAGE_NAMESPACE,
    ) as MessageId;
    const existing = await this.prisma.db.message.findUnique({
      where: { id: completionMessageId },
      select: { conversationId: true, projectId: true },
    });
    if (existing) {
      if (
        existing.conversationId !== params.input.conversationId ||
        existing.projectId !== params.projectId
      ) {
        this.bindingMismatch('recorded_completion');
      }
      this.logger.log('Returning recorded EXTERNAL_AGENT completion', {
        completionMessageId,
        effectId: admitted.effectId,
      });
      return { completionMessageId };
    }

    const active = await this.flowExecutionService.findActiveByConversation(
      params.input.conversationId,
      params.organizationId,
    );
    if (!active || active.currentNode !== params.input.workflowNodeId) {
      this.bindingMismatch('active_workflow_node');
    }
    const pending =
      await this.pendingTriggerService.resolvePendingTriggerForNode(
        params.input.conversationId,
        params.input.workflowNodeId,
      );
    if (pending.triggerMessageId !== params.input.pendingTriggerMessageId) {
      this.bindingMismatch('pending_trigger');
    }
    const nodeInfo = this.nodeExecutionService.getNode(
      active.flowId,
      params.input.workflowNodeId,
    );
    if (!nodeInfo || !isExternalAgentNode(nodeInfo.node)) {
      this.bindingMismatch('active_external_agent_node');
    }
    if (!Object.hasOwn(nodeInfo.node.actions, params.input.action)) {
      this.bindingMismatch('permitted_action');
    }

    const data = {
      type: SystemMessageData.TypeEnum.Agent,
      response: params.input.response ?? '',
      detectedIntent: 'agent_submission',
      intentConfidence: 1,
      flowId: active.flowId,
      nodeId: params.input.workflowNodeId,
      completesExternalAgentNode: {
        nodeId: params.input.workflowNodeId,
        action: params.input.action,
        ...(params.input.payload !== undefined
          ? { payload: params.input.payload }
          : {}),
        completesTriggerMessageId: params.input.pendingTriggerMessageId,
      },
      ...(params.input.hidden === true
        ? {
            uiElements: [
              {
                id: 'agent_hidden',
                type: ExtendedUIFieldType.AgentHidden,
                label: '',
              },
            ],
          }
        : {}),
      ...(params.input.providerSessionId !== undefined
        ? { providerSessionId: params.input.providerSessionId }
        : {}),
      ...(params.input.promptHandler !== undefined
        ? { promptHandler: params.input.promptHandler }
        : {}),
    } satisfies AgentSystemMessageData;
    await this.messageService.addMessage(
      {
        id: completionMessageId,
        type: 'SYSTEM',
        status: MessageStatus.Completed,
        projectId: params.projectId,
        conversationId: params.input.conversationId,
        data,
      },
      params.organizationId,
      'external-agent-completion',
    );
    this.logger.log('Persisted admitted EXTERNAL_AGENT completion', {
      completionMessageId,
      effectId: admitted.effectId,
      agentSessionId: params.agentSessionId,
      conversationId: params.input.conversationId,
      workflowNodeId: params.input.workflowNodeId,
      pendingTriggerMessageId: params.input.pendingTriggerMessageId,
      action: params.input.action,
    });
    return { completionMessageId };
  }

  private assertExactRequestShape(
    input: SubmitExternalAgentCompletionRequestDto,
  ): void {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Request does not match the OpenAPI shape');
    }
    const allowed = [
      'action',
      'conversationId',
      'hidden',
      'payload',
      'pendingTriggerMessageId',
      'promptHandler',
      'proof',
      'providerSessionId',
      'response',
      'workflowNodeId',
    ];
    const required = [
      'action',
      'conversationId',
      'pendingTriggerMessageId',
      'proof',
      'workflowNodeId',
    ];
    const actual = Object.keys(input);
    const payload = input.payload;
    if (
      actual.some((key) => !allowed.includes(key)) ||
      required.some((key) => !actual.includes(key)) ||
      typeof input.conversationId !== 'string' ||
      !isUuid(input.conversationId) ||
      typeof input.pendingTriggerMessageId !== 'string' ||
      !isUuid(input.pendingTriggerMessageId) ||
      typeof input.workflowNodeId !== 'string' ||
      input.workflowNodeId.length === 0 ||
      typeof input.action !== 'string' ||
      input.action.length === 0 ||
      !input.proof ||
      typeof input.proof !== 'object' ||
      Array.isArray(input.proof) ||
      (payload !== undefined &&
        (!payload || typeof payload !== 'object' || Array.isArray(payload))) ||
      (input.response !== undefined && typeof input.response !== 'string') ||
      (input.hidden !== undefined && typeof input.hidden !== 'boolean') ||
      (input.providerSessionId !== undefined &&
        typeof input.providerSessionId !== 'string') ||
      (input.promptHandler !== undefined && typeof input.promptHandler !== 'string')
    ) {
      throw new BadRequestException('Request does not match the OpenAPI shape');
    }
  }

  private bindingMismatch(binding: string): never {
    this.logger.warn('Rejected EXTERNAL_AGENT completion binding', { binding });
    throw new ConflictException({
      code: 'EXTERNAL_AGENT_COMPLETION_BINDING_MISMATCH',
      message: `EXTERNAL_AGENT completion does not match ${binding}.`,
    });
  }
}

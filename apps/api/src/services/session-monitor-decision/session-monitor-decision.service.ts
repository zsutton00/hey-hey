import * as crypto from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  AgentOperation,
  AgentOperationKind,
  AgentOperationState,
  AgentSessionType,
  EntityType,
  Prisma,
} from '@prisma/client';
import { validate as isUuid } from 'uuid';
import {
  AgentSessionConfigV2,
  AgentSystemMessageData,
  AgentTriggerUserMessage,
  ExternalAgentNodeCompletion,
  MachineEffectHttpMethod,
  MessageStatus,
  ReportType,
  SessionMonitorDecisionAction,
  SessionMonitorDecisionDeferral,
  SessionMonitorDecisionResponse,
  SessionMonitorMessageState,
  SessionMonitorOutcome,
  SessionMonitorSystemMessageData,
  SessionMonitorTerminalPolicy,
  SessionMonitorTerminalPolicyAction,
  SubmitSessionMonitorDecisionRequestDto,
  SubmitSessionMonitorDecisionResponseDto,
  SystemMessageData,
  UserMessageAgentInputProvenance,
  UserMessageData,
  UserMessageDataWorkflowDefined,
  UserMessagePromptPayload,
} from '../../generated';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import { PrismaService } from '../../prisma/prisma.service';
import {
  AgentSessionId,
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import { isExternalAgentNode } from '../../types/flow-internal.types';
import { AgentOperationRegistryService } from '../agent-operation/agent-operation-registry.service';
import {
  AdmittedMachineEffect,
  MachineEffectAdmissionService,
} from '../machine-effect-admission/machine-effect-admission.service';
import type { AuthenticatedMachine } from '../machine-pairing/machine-pairing.service';
import { MessageService } from '../message.service';
import { FlowExecutionService } from '../workflows/flow-execution.service';
import { NodeExecutionService } from '../workflows/node-execution.service';
import { PendingTriggerService } from '../workflows/pending-trigger.service';

const OPERATION_ID = 'submitSessionMonitorDecision';

type BoundSessionMonitorContext = {
  monitorSessionId: AgentSessionId;
  parentSessionId: AgentSessionId;
  conversationId: ConversationId;
  userId: UserId;
  parentConfig: unknown;
  reportType: ReportType;
};

@Injectable()
export class SessionMonitorDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly machineEffectAdmission: MachineEffectAdmissionService,
    private readonly operationRegistry: AgentOperationRegistryService,
    private readonly messageService: MessageService,
    private readonly flowExecutionService: FlowExecutionService,
    private readonly pendingTriggerService: PendingTriggerService,
    private readonly nodeExecutionService: NodeExecutionService,
  ) {}

  async submit(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorSessionId: AgentSessionId;
    authenticatedMachine: AuthenticatedMachine;
    requestPath: string;
    input: SubmitSessionMonitorDecisionRequestDto;
  }): Promise<SubmitSessionMonitorDecisionResponseDto> {
    this.assertExactRequestShape(params.input);
    const { proof, ...semanticRequest } = params.input;
    const admission = await this.machineEffectAdmission.admit({
      authenticatedMachine: params.authenticatedMachine,
      proof,
      operationId: OPERATION_ID,
      method: MachineEffectHttpMethod.Post,
      path: params.requestPath,
      payload: semanticRequest,
    });

    const bound = await this.resolveStaticBinding({
      organizationId: params.organizationId,
      projectId: params.projectId,
      monitorSessionId: params.monitorSessionId,
      admission,
      input: params.input,
    });
    const fingerprint = this.fingerprint({
      organizationId: params.organizationId,
      projectId: params.projectId,
      monitorSessionId: params.monitorSessionId,
      semanticRequest,
    });
    const begun = await this.operationRegistry.begin({
      operationId: params.input.decisionId,
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: bound.userId,
      agentSessionId: bound.parentSessionId,
      conversationId: bound.conversationId,
      kind: AgentOperationKind.SESSION_MONITOR_DECISION,
      fingerprint,
    });

    if (begun.disposition !== 'EXECUTE') {
      const recorded =
        begun.disposition === 'JOIN'
          ? await this.operationRegistry.waitForTerminal(
              params.input.decisionId,
            )
          : begun.operation;
      return this.recordedResponse(recorded, true);
    }

    try {
      const isDeferral =
        params.input.decision.kind ===
        SessionMonitorDecisionDeferral.KindEnum.Defer;
      const active = isDeferral
        ? null
        : await this.resolveRequiredActiveBoundary({
            organizationId: params.organizationId,
            conversationId: bound.conversationId,
            input: params.input,
          });
      if (active) {
        this.assertDecisionAllowed({
          input: params.input,
          flowId: active.flowId,
          parentConfig: bound.parentConfig,
          reportType: bound.reportType,
        });
      }

      const ids = this.operationRegistry.reservedMessageIds(begun.operation);
      const consequenceMessageId = isDeferral ? null : ids.triggerMessageId;
      const response = await this.prisma.db.$transaction(async (tx) => {
        if (consequenceMessageId) {
          await this.persistConsequence({
            tx,
            organizationId: params.organizationId,
            projectId: params.projectId,
            bound,
            input: params.input,
            flowId: active!.flowId,
            consequenceMessageId,
            fingerprint,
          });
        }
        await this.persistEvidence({
          tx,
          organizationId: params.organizationId,
          projectId: params.projectId,
          monitorSessionId: bound.monitorSessionId,
          input: params.input,
          evidenceMessageId: ids.messageId,
          consequenceMessageId,
          fingerprint,
        });
        const result = {
          decisionId: params.input.decisionId,
          decisionFingerprint: fingerprint,
          evidenceMessageId: ids.messageId,
          consequenceMessageId,
        } satisfies Omit<SubmitSessionMonitorDecisionResponseDto, 'replayed'>;
        await this.operationRegistry.succeedInTransaction(tx, {
          operationId: params.input.decisionId,
          executionOwner: begun.executionOwner,
          messageId: ids.messageId,
          triggerMessageId: consequenceMessageId ?? ids.messageId,
          result: result as unknown as Prisma.InputJsonValue,
        });
        return result;
      });
      return { ...response, replayed: false };
    } catch (error) {
      await this.operationRegistry.fail(
        params.input.decisionId,
        begun.executionOwner,
        error instanceof ConflictException
          ? 'SESSION_MONITOR_BINDING_MISMATCH'
          : 'SESSION_MONITOR_DECISION_FAILED',
        error instanceof Error ? error.message : 'Decision admission failed',
      );
      throw error;
    }
  }

  private async resolveStaticBinding(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorSessionId: AgentSessionId;
    admission: AdmittedMachineEffect;
    input: SubmitSessionMonitorDecisionRequestDto;
  }): Promise<BoundSessionMonitorContext> {
    const monitor = await this.prisma.db.agentSession.findFirst({
      where: {
        id: params.monitorSessionId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.admission.userId,
        machineId: params.admission.machineId,
        type: AgentSessionType.SESSION_MONITOR,
        entityType: EntityType.AGENT_SESSION,
        entityId: params.input.parentAgentSessionId,
      },
      select: { id: true, conversationId: true, userId: true },
    });
    if (!monitor) {
      throw this.bindingMismatch('monitor_session');
    }

    const parent = await this.prisma.db.agentSession.findFirst({
      where: {
        id: params.input.parentAgentSessionId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        userId: params.admission.userId,
        conversationId: params.input.conversationId,
      },
      select: { id: true, conversationId: true, userId: true, config: true },
    });
    if (!parent?.conversationId) {
      throw this.bindingMismatch('parent_session');
    }

    const report = await this.prisma.db.report.findFirst({
      where: {
        id: params.input.reportId,
        organizationId: params.organizationId,
        projectId: params.projectId,
        reportEntities: {
          some: {
            entityType: EntityType.AGENT_SESSION,
            entityId: parent.id,
          },
        },
      },
      select: { reportType: true },
    });
    if (!report) throw this.bindingMismatch('source_report');

    return {
      monitorSessionId: monitor.id as AgentSessionId,
      parentSessionId: parent.id as AgentSessionId,
      conversationId: parent.conversationId as ConversationId,
      userId: parent.userId as UserId,
      parentConfig: parent.config,
      reportType: report.reportType as ReportType,
    };
  }

  private async resolveActiveBoundary(params: {
    organizationId: OrganizationId;
    conversationId: ConversationId;
    workflowNodeId: string;
    pendingTriggerMessageId: MessageId;
  }): Promise<{ flowId: string }> {
    const active = await this.flowExecutionService.findActiveByConversation(
      params.conversationId,
      params.organizationId,
    );
    if (!active || active.currentNode !== params.workflowNodeId) {
      throw this.bindingMismatch('active_workflow_node');
    }
    const pending =
      await this.pendingTriggerService.resolvePendingTriggerForNode(
        params.conversationId,
        params.workflowNodeId,
      );
    if (pending.triggerMessageId !== params.pendingTriggerMessageId) {
      throw this.bindingMismatch('pending_trigger');
    }
    return { flowId: active.flowId };
  }

  private resolveRequiredActiveBoundary(params: {
    organizationId: OrganizationId;
    conversationId: ConversationId;
    input: SubmitSessionMonitorDecisionRequestDto;
  }): Promise<{ flowId: string }> {
    if (!params.input.workflowNodeId || !params.input.pendingTriggerMessageId) {
      throw new BadRequestException(
        'ACTION and RESPONSE decisions require workflowNodeId and pendingTriggerMessageId.',
      );
    }
    return this.resolveActiveBoundary({
      organizationId: params.organizationId,
      conversationId: params.conversationId,
      workflowNodeId: params.input.workflowNodeId,
      pendingTriggerMessageId: params.input.pendingTriggerMessageId,
    });
  }

  private assertDecisionAllowed(params: {
    input: SubmitSessionMonitorDecisionRequestDto;
    flowId: string;
    parentConfig: unknown;
    reportType: ReportType;
  }): void {
    const decision = params.input.decision;
    if (decision.kind !== SessionMonitorDecisionAction.KindEnum.Action) return;
    const workflowNodeId = params.input.workflowNodeId;
    if (!workflowNodeId) {
      throw new BadRequestException('ACTION decisions require workflowNodeId.');
    }
    const nodeInfo = this.nodeExecutionService.getNode(
      params.flowId,
      workflowNodeId,
    );
    if (!nodeInfo || !isExternalAgentNode(nodeInfo.node)) {
      throw this.bindingMismatch('active_external_agent_node');
    }
    if (!Object.hasOwn(nodeInfo.node.actions, decision.action)) {
      throw this.bindingMismatch('permitted_action');
    }
    const policy = this.extractTerminalPolicy(params.parentConfig);
    if (!policy) return;
    const terminalCompletion = this.getTerminalCompletion(
      policy,
      params.reportType,
    );
    if (!terminalCompletion) {
      if (
        params.reportType === ReportType.Implement &&
        policy.implementationDone?.requestReview === true
      ) {
        throw this.bindingMismatch('terminal_policy_review');
      }
      return;
    }
    if (terminalCompletion.action !== decision.action) {
      throw this.bindingMismatch('terminal_policy_action');
    }
  }

  private async persistConsequence(params: {
    tx: Parameters<PrismaService['db']['$transaction']>[0] extends (
      tx: infer T,
    ) => unknown
      ? T
      : never;
    organizationId: OrganizationId;
    projectId: ProjectId;
    bound: BoundSessionMonitorContext;
    input: SubmitSessionMonitorDecisionRequestDto;
    flowId: string;
    consequenceMessageId: MessageId;
    fingerprint: string;
  }): Promise<void> {
    const decision = params.input.decision;
    if (decision.kind === SessionMonitorDecisionAction.KindEnum.Action) {
      const workflowNodeId = params.input.workflowNodeId;
      const pendingTriggerMessageId = params.input.pendingTriggerMessageId;
      if (!workflowNodeId || !pendingTriggerMessageId) {
        throw new BadRequestException(
          'ACTION decisions require workflowNodeId and pendingTriggerMessageId.',
        );
      }
      const completion: ExternalAgentNodeCompletion = {
        nodeId: workflowNodeId,
        action: decision.action,
        completesTriggerMessageId: pendingTriggerMessageId,
        ...(decision.response !== undefined
          ? { payload: { response: decision.response } }
          : {}),
      };
      const data = {
        type: SystemMessageData.TypeEnum.Agent,
        response: decision.response ?? '',
        detectedIntent: 'session_monitor_continuation',
        intentConfidence: 1,
        flowId: params.flowId,
        nodeId: workflowNodeId,
        completesExternalAgentNode: completion,
      } satisfies AgentSystemMessageData;
      await this.messageService.addMessageInTransaction(
        params.tx,
        {
          id: params.consequenceMessageId,
          type: 'SYSTEM',
          status: MessageStatus.Completed,
          projectId: params.projectId,
          conversationId: params.bound.conversationId,
          data,
        },
        params.organizationId,
        'session-monitor-decision:action',
      );
      return;
    }
    if (decision.kind !== SessionMonitorDecisionResponse.KindEnum.Response) {
      throw new BadRequestException('A deferred decision has no consequence');
    }
    const agentInput = {
      promptType: UserMessageDataWorkflowDefined.PromptTypeEnum.WorkflowDefined,
      userMessage: decision.response,
      provenance: UserMessageAgentInputProvenance.SessionMonitor,
    } satisfies UserMessageDataWorkflowDefined;
    const payload = {
      handlerPromptType:
        UserMessageDataWorkflowDefined.PromptTypeEnum.WorkflowDefined,
      userMessage: decision.response,
      attachments: [],
    } satisfies UserMessagePromptPayload;
    const parentSession = await params.tx.agentSession.findUnique({
      where: { id: params.bound.parentSessionId },
      select: { id: true },
    });
    if (!parentSession) {
      throw new ConflictException('The parent Agent Session no longer exists.');
    }
    const trigger = {
      operationId: params.input.decisionId,
      operationFingerprint: params.fingerprint,
      promptType: AgentTriggerUserMessage.PromptTypeEnum.UserMessage,
      triggerMessageId: params.consequenceMessageId,
      sourceUserMessageId: params.consequenceMessageId,
      payload,
    } satisfies AgentTriggerUserMessage;
    const data = {
      agentInput,
      triggersAgent: trigger,
    } satisfies UserMessageData;
    await this.messageService.addMessageInTransaction(
      params.tx,
      {
        id: params.consequenceMessageId,
        type: 'USER',
        status: MessageStatus.Completed,
        projectId: params.projectId,
        conversationId: params.bound.conversationId,
        userId: params.bound.userId,
        data,
      },
      params.organizationId,
      'session-monitor-decision:response',
    );
  }

  private async persistEvidence(params: {
    tx: Parameters<PrismaService['db']['$transaction']>[0] extends (
      tx: infer T,
    ) => unknown
      ? T
      : never;
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorSessionId: AgentSessionId;
    input: SubmitSessionMonitorDecisionRequestDto;
    evidenceMessageId: MessageId;
    consequenceMessageId: MessageId | null;
    fingerprint: string;
  }): Promise<void> {
    const decision = params.input.decision;
    const outcome =
      decision.kind === SessionMonitorDecisionDeferral.KindEnum.Defer
        ? SessionMonitorOutcome.Deferred
        : SessionMonitorOutcome.Continued;
    const continuationCompletion =
      decision.kind === SessionMonitorDecisionAction.KindEnum.Action
        ? {
            action: decision.action,
            ...(decision.response !== undefined
              ? { response: decision.response }
              : {}),
          }
        : decision.kind === SessionMonitorDecisionResponse.KindEnum.Response
          ? { response: decision.response }
          : undefined;
    const data = {
      type: SystemMessageData.TypeEnum.SessionMonitor,
      response: params.input.content,
      agentIdentity: params.monitorSessionId,
      content: params.input.content,
      reportId: params.input.reportId,
      state: SessionMonitorMessageState.Decision,
      outcome,
      ...(continuationCompletion ? { continuationCompletion } : {}),
      decisionOperationId: params.input.decisionId,
      decisionFingerprint: params.fingerprint,
      consequenceMessageId: params.consequenceMessageId,
    } satisfies SessionMonitorSystemMessageData;
    await this.messageService.addMessageInTransaction(
      params.tx,
      {
        id: params.evidenceMessageId,
        type: 'SYSTEM',
        status: MessageStatus.Completed,
        projectId: params.projectId,
        conversationId: params.input.conversationId,
        parentMessageId: params.consequenceMessageId,
        data,
      },
      params.organizationId,
      'session-monitor-decision:evidence',
      { suppressExecutableDelivery: true },
    );
  }

  private fingerprint(value: unknown): string {
    return crypto
      .createHash('sha256')
      .update(canonicalizeJcs(value), 'utf8')
      .digest('hex');
  }

  private recordedResponse(
    operation: AgentOperation,
    replayed: boolean,
  ): SubmitSessionMonitorDecisionResponseDto {
    if (operation.state !== AgentOperationState.SUCCEEDED) {
      throw new ConflictException({
        code: operation.failureCode ?? 'SESSION_MONITOR_DECISION_TERMINAL',
        message:
          operation.failureMessage ??
          'The Session Monitor decision is terminal without a result.',
      });
    }
    const result = operation.result;
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new ConflictException('Session Monitor decision result is missing');
    }
    const consequenceMessageId = result['consequenceMessageId'];
    if (
      typeof result['decisionId'] !== 'string' ||
      typeof result['decisionFingerprint'] !== 'string' ||
      typeof result['evidenceMessageId'] !== 'string' ||
      !(
        consequenceMessageId === null ||
        typeof consequenceMessageId === 'string'
      )
    ) {
      throw new ConflictException('Session Monitor decision result is invalid');
    }
    return {
      decisionId: result['decisionId'],
      decisionFingerprint: result['decisionFingerprint'],
      evidenceMessageId: result['evidenceMessageId'] as MessageId,
      consequenceMessageId: consequenceMessageId as MessageId | null,
      replayed,
    };
  }

  private extractTerminalPolicy(
    config: unknown,
  ): SessionMonitorTerminalPolicy | null {
    if (!config || typeof config !== 'object' || Array.isArray(config))
      return null;
    const record = config as Record<string, unknown>;
    if (
      record.type !== undefined &&
      record.type !== AgentSessionConfigV2.TypeEnum.CodingSession
    ) {
      return null;
    }
    if (record.version !== AgentSessionConfigV2.VersionEnum.V2) return null;
    const policy = record.sessionMonitorTerminalPolicy;
    if (!policy || typeof policy !== 'object' || Array.isArray(policy))
      return null;
    return policy as SessionMonitorTerminalPolicy;
  }

  private getTerminalCompletion(
    policy: SessionMonitorTerminalPolicy,
    reportType: ReportType,
  ): SessionMonitorTerminalPolicyAction | null {
    switch (reportType) {
      case ReportType.Implement:
        return policy.implementationDone?.completion ?? null;
      case ReportType.Review:
        return policy.reviewDone?.completion ?? null;
      default:
        return null;
    }
  }

  private assertExactRequestShape(
    input: SubmitSessionMonitorDecisionRequestDto,
  ): void {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException('Request does not match the OpenAPI shape');
    }
    this.assertExactKeys(
      input,
      [
        'content',
        'conversationId',
        'decision',
        'decisionId',
        'parentAgentSessionId',
        'pendingTriggerMessageId',
        'proof',
        'reportId',
        'workflowNodeId',
      ],
      ['pendingTriggerMessageId', 'workflowNodeId'],
    );
    if (
      typeof input.decisionId !== 'string' ||
      !isUuid(input.decisionId) ||
      typeof input.parentAgentSessionId !== 'string' ||
      !isUuid(input.parentAgentSessionId) ||
      typeof input.reportId !== 'string' ||
      !isUuid(input.reportId) ||
      typeof input.conversationId !== 'string' ||
      !isUuid(input.conversationId) ||
      typeof input.content !== 'string' ||
      input.content.length === 0 ||
      (input.pendingTriggerMessageId !== undefined &&
        (typeof input.pendingTriggerMessageId !== 'string' ||
          !isUuid(input.pendingTriggerMessageId))) ||
      (input.workflowNodeId !== undefined &&
        (typeof input.workflowNodeId !== 'string' ||
          input.workflowNodeId.length === 0)) ||
      !input.proof ||
      typeof input.proof !== 'object' ||
      Array.isArray(input.proof) ||
      !input.decision ||
      typeof input.decision !== 'object' ||
      Array.isArray(input.decision)
    ) {
      throw new BadRequestException('Request does not match the OpenAPI shape');
    }
    switch (input.decision.kind) {
      case SessionMonitorDecisionAction.KindEnum.Action:
        this.assertExactKeys(
          input.decision,
          ['action', 'kind', 'response'],
          ['response'],
        );
        if (
          typeof input.decision.action !== 'string' ||
          input.decision.action.length === 0 ||
          (input.decision.response !== undefined &&
            typeof input.decision.response !== 'string') ||
          !input.workflowNodeId ||
          !input.pendingTriggerMessageId
        ) {
          throw new BadRequestException(
            'Request does not match the OpenAPI shape',
          );
        }
        break;
      case SessionMonitorDecisionResponse.KindEnum.Response:
        this.assertExactKeys(input.decision, ['kind', 'response']);
        if (
          typeof input.decision.response !== 'string' ||
          input.decision.response.length === 0 ||
          !input.workflowNodeId ||
          !input.pendingTriggerMessageId
        ) {
          throw new BadRequestException(
            'Request does not match the OpenAPI shape',
          );
        }
        break;
      case SessionMonitorDecisionDeferral.KindEnum.Defer:
        this.assertExactKeys(input.decision, ['kind']);
        if (
          input.workflowNodeId !== undefined ||
          input.pendingTriggerMessageId !== undefined
        ) {
          throw new BadRequestException(
            'Request does not match the OpenAPI shape',
          );
        }
        break;
      default:
        throw new BadRequestException('Invalid Session Monitor decision kind');
    }
  }

  private assertExactKeys(
    value: object,
    expected: string[],
    optional: string[] = [],
  ): void {
    const actual = Object.keys(value).sort();
    const allowed = [...expected].sort();
    const required = allowed.filter((key) => !optional.includes(key));
    if (
      actual.some((key) => !allowed.includes(key)) ||
      required.some((key) => !actual.includes(key))
    ) {
      throw new BadRequestException('Request does not match the OpenAPI shape');
    }
  }

  private bindingMismatch(binding: string): ConflictException {
    return new ConflictException({
      code: 'SESSION_MONITOR_DECISION_BINDING_MISMATCH',
      message: `Session Monitor decision does not match ${binding}.`,
    });
  }
}

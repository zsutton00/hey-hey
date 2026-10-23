import {
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentOperation,
  AgentOperationState,
  AgentOperationWorkflowInputState,
  Prisma,
} from '@prisma/client';
import * as crypto from 'node:crypto';
import {
  AgentOperationSnapshot,
  SubmitWorkflowAnswerRequestDto,
  SubmitWorkflowAnswerResponseDto,
  SystemMessageData,
  UserMessageData,
} from '../../generated';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import { AgentOperationDispatchService } from '../../core/websockets/agent-operation-dispatch.service';
import {
  AnyTransactionClient,
  PrismaService,
} from '../../prisma/prisma.service';
import {
  AgentSessionId,
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import {
  ExecutionGrantService,
  InteractiveGrantAdmission,
} from '../controller-authorization/execution-grant.service';
import { CreateMessageInput, MessageService } from '../message.service';
import { AgentOperationRegistryService } from './agent-operation-registry.service';

export interface WorkflowAnswerPrincipal {
  organizationId: OrganizationId;
  projectId: ProjectId;
  userId: UserId;
}

export interface AdmitWorkflowAnswerInput {
  request: SubmitWorkflowAnswerRequestDto;
  principal: WorkflowAnswerPrincipal;
  admission: InteractiveGrantAdmission;
  executionOwner: string;
}

const RESPONSE_STATE: Record<
  | 'ROUTING_PENDING'
  | 'AWAITING_WORKFLOW_RESOLUTION'
  | 'DISPATCH_PENDING'
  | 'SUCCEEDED'
  | 'DENIED'
  | 'FAILED'
  | 'CANCELLED',
  SubmitWorkflowAnswerResponseDto.OperationStateEnum
> = {
  ROUTING_PENDING:
    SubmitWorkflowAnswerResponseDto.OperationStateEnum.RoutingPending,
  AWAITING_WORKFLOW_RESOLUTION:
    SubmitWorkflowAnswerResponseDto.OperationStateEnum
      .AwaitingWorkflowResolution,
  DISPATCH_PENDING:
    SubmitWorkflowAnswerResponseDto.OperationStateEnum.DispatchPending,
  SUCCEEDED: SubmitWorkflowAnswerResponseDto.OperationStateEnum.Succeeded,
  DENIED: SubmitWorkflowAnswerResponseDto.OperationStateEnum.Denied,
  FAILED: SubmitWorkflowAnswerResponseDto.OperationStateEnum.Failed,
  CANCELLED: SubmitWorkflowAnswerResponseDto.OperationStateEnum.Cancelled,
};

function responseFromSnapshot(
  snapshot: AgentOperationSnapshot,
): SubmitWorkflowAnswerResponseDto {
  const state = snapshot.state;
  if (!(state in RESPONSE_STATE)) {
    throw new ConflictException({
      code: 'WORKFLOW_ANSWER_STATE_INVALID',
      message: `Workflow answer cannot be returned from state ${state}.`,
    });
  }
  return {
    operationId: snapshot.operationId,
    operationFingerprint: snapshot.fingerprint,
    operationState: RESPONSE_STATE[state as keyof typeof RESPONSE_STATE],
  };
}

const EXECUTABLE_USER_MESSAGE_FIELDS = new Set(['agentInput', 'triggersAgent']);
const WORKFLOW_DISPATCH_BOUND_STATES = new Set<AgentOperationState>([
  AgentOperationState.DISPATCH_PENDING,
  AgentOperationState.SUCCEEDED,
  AgentOperationState.DENIED,
  AgentOperationState.FAILED,
]);

function nonExecutableFields(
  fields: object | undefined,
): Record<string, unknown> {
  if (!fields) return {};
  return Object.fromEntries(
    Object.entries(fields).filter(
      ([key]) => !EXECUTABLE_USER_MESSAGE_FIELDS.has(key),
    ),
  );
}

function nonEmptyComment(comment: string | undefined): string | undefined {
  return typeof comment === 'string' && comment.trim().length > 0
    ? comment
    : undefined;
}

export function buildWorkflowAnswerEvidenceData(
  request: SubmitWorkflowAnswerRequestDto,
): UserMessageData {
  const comment = nonEmptyComment(request.input.evidence?.comment);
  return {
    ...nonExecutableFields(request.input.payload),
    ...nonExecutableFields(request.input.evidence?.fields),
    action: request.input.action,
    payload: request.input.payload,
    nodeId: request.input.nodeId,
    workflowAnswerOperationId: request.operationId,
    ...(comment !== undefined ? { comment } : {}),
  } satisfies UserMessageData;
}

@Injectable()
export class AgentOperationWorkflowAnswerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AgentOperationRegistryService,
    @Inject(forwardRef(() => MessageService))
    private readonly messageService: MessageService,
    private readonly executionGrantService: ExecutionGrantService,
    @Inject(forwardRef(() => AgentOperationDispatchService))
    private readonly dispatchService: AgentOperationDispatchService,
  ) {}

  fingerprint(
    request: Omit<
      SubmitWorkflowAnswerRequestDto,
      'operationFingerprint' | 'authorization'
    >,
    principal: Pick<WorkflowAnswerPrincipal, 'organizationId' | 'projectId'>,
  ): string {
    return crypto
      .createHash('sha256')
      .update(
        canonicalizeJcs({
          kind: 'WORKFLOW_ANSWER',
          organizationId: principal.organizationId,
          projectId: principal.projectId,
          operationId: request.operationId,
          agentSessionId: request.agentSessionId,
          conversationId: request.conversationId,
          input: request.input,
        }),
        'utf8',
      )
      .digest('hex');
  }

  async admit({
    request,
    principal,
    admission,
    executionOwner,
  }: AdmitWorkflowAnswerInput): Promise<SubmitWorkflowAnswerResponseDto> {
    const snapshot = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${request.operationId}, 0))`;
      const operation = await tx.agentOperation.findUnique({
        where: { operationId: request.operationId },
      });
      if (
        !operation ||
        operation.executionOwner !== executionOwner ||
        operation.state !== AgentOperationState.SUBMITTING
      ) {
        throw new ConflictException({
          code: 'AGENT_OPERATION_NOT_EXECUTION_OWNER',
          message:
            'The prepared workflow answer is no longer owned by its submitter.',
        });
      }

      const conversation = await tx.conversation.findFirst({
        where: {
          id: request.conversationId,
          organizationId: principal.organizationId,
          projectId: principal.projectId,
          workflowName: request.input.workflowName,
        },
        select: { id: true, workflowId: true },
      });
      if (!conversation?.workflowId) {
        throw new ConflictException({
          code: 'WORKFLOW_ANSWER_BINDING_MISMATCH',
          message: 'The answer does not match an active workflow conversation.',
        });
      }

      const parentMessage = await tx.message.findFirst({
        where: {
          id: request.input.parentMessageId,
          conversationId: request.conversationId,
          projectId: principal.projectId,
          type: 'SYSTEM',
        },
        select: { id: true },
      });
      if (!parentMessage) {
        throw new ConflictException({
          code: 'WORKFLOW_ANSWER_PARENT_MESSAGE_MISMATCH',
          message:
            'The workflow answer parent is not a SYSTEM message in the bound conversation.',
        });
      }

      const reserved = this.registry.reservedMessageIds(operation);
      const evidence = await this.messageService.addMessageInTransaction(
        tx,
        {
          id: reserved.messageId,
          type: 'USER',
          projectId: principal.projectId,
          conversationId: request.conversationId as ConversationId,
          parentMessageId: parentMessage.id as MessageId,
          userId: principal.userId,
          data: buildWorkflowAnswerEvidenceData(request),
        },
        principal.organizationId,
        'workflowAnswer:evidence',
      );
      const grant =
        await this.executionGrantService.deriveInteractiveGrantInTransaction(
          tx,
          { admission, authorizedTurnId: evidence.id as MessageId },
        );
      await this.registry.recordAuthorizationInTransaction(
        tx,
        request.operationId,
        executionOwner,
        admission.authorizationId,
        grant.grant.id,
        admission.envelopeAuthorization.kind,
      );
      await tx.agentOperationWorkflowInputDelivery.create({
        data: {
          operationId: request.operationId,
          kind: 'WORKFLOW_ANSWER',
          workflowId: conversation.workflowId,
          workflowName: request.input.workflowName,
          nodeId: request.input.nodeId,
          action: request.input.action,
          answer: JSON.parse(
            JSON.stringify(request.input),
          ) as Prisma.InputJsonValue,
        },
      });
      const admittedOperation =
        await this.registry.markRoutingPendingInTransaction(
          tx,
          request.operationId,
          executionOwner,
          evidence.id as MessageId,
        );
      await tx.agentOperation.update({
        where: { operationId: request.operationId },
        data: {
          result: {
            messageId: evidence.id,
          },
        },
      });
      return this.registry.toSnapshot(admittedOperation);
    });
    return responseFromSnapshot(snapshot);
  }

  responseForOperation(
    operation: AgentOperation,
  ): SubmitWorkflowAnswerResponseDto {
    return responseFromSnapshot(this.registry.toSnapshot(operation));
  }

  async waitForResponse(
    operationId: string,
    timeoutMs = 5_000,
  ): Promise<SubmitWorkflowAnswerResponseDto> {
    const deadline = Date.now() + timeoutMs;
    do {
      const operation = await this.prisma.db.agentOperation.findUnique({
        where: { operationId },
      });
      if (!operation) throw new NotFoundException('Agent operation not found');
      const snapshot = this.registry.toSnapshot(operation);
      if (snapshot.state in RESPONSE_STATE) {
        return responseFromSnapshot(snapshot);
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new ConflictException({
      code: 'AGENT_OPERATION_IN_PROGRESS',
      message: 'The workflow answer is still being admitted.',
    });
  }

  async succeedWithoutTrigger(
    operationId: string,
    result: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${operationId}, 0))`;
      const operation = await tx.agentOperation.findUnique({
        where: { operationId },
      });
      if (!operation || operation.state === AgentOperationState.SUCCEEDED)
        return;
      if (
        operation.kind !== 'WORKFLOW_ANSWER' ||
        (operation.state !== AgentOperationState.ROUTING_PENDING &&
          operation.state !== AgentOperationState.AWAITING_WORKFLOW_RESOLUTION)
      ) {
        throw new ConflictException({
          code: 'WORKFLOW_ANSWER_NOT_AWAITING_RESOLUTION',
          message: 'The workflow answer is not awaiting resolution.',
        });
      }
      await tx.agentOperation.update({
        where: { operationId },
        data: {
          state: AgentOperationState.SUCCEEDED,
          result,
          terminalAt: new Date(),
          version: { increment: 1 },
        },
      });
    });
  }

  async bindWorkflowTriggerAndDispatch(params: {
    operationId: string;
    triggerMessage: CreateMessageInput & { type: 'SYSTEM' };
  }): Promise<
    ReturnType<MessageService['addMessageInTransaction']> extends Promise<
      infer T
    >
      ? T
      : never
  > {
    const message = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${params.operationId}, 0))`;
      const operation = await tx.agentOperation.findUnique({
        where: { operationId: params.operationId },
        include: { dispatch: true },
      });
      if (!operation) throw new NotFoundException('Agent operation not found');
      if (operation.triggerMessageId) {
        if (
          operation.kind !== 'WORKFLOW_ANSWER' ||
          !WORKFLOW_DISPATCH_BOUND_STATES.has(operation.state) ||
          !operation.authorizationId ||
          !operation.authorizationKind ||
          !operation.grantId ||
          !operation.dispatch ||
          operation.dispatch.authorizationId !== operation.authorizationId ||
          operation.dispatch.authorizationKind !==
            operation.authorizationKind ||
          operation.dispatch.grantId !== operation.grantId ||
          operation.dispatch.triggerMessageId !== operation.triggerMessageId
        ) {
          throw new ConflictException({
            code: 'WORKFLOW_ANSWER_DISPATCH_BINDING_CONTRADICTION',
            message:
              'The workflow answer dispatch contradicts its admitted operation binding.',
          });
        }
        const existing = await this.messageService.getMessage(
          operation.triggerMessageId,
          operation.organizationId as OrganizationId,
        );
        if (!existing) throw new NotFoundException('Trigger message not found');
        return { ...existing, messageCreatedEventId: null };
      }
      if (!operation.authorizationKind) {
        throw new ConflictException({
          code: 'WORKFLOW_ANSWER_AUTHORIZATION_KIND_MISSING',
          message:
            'The workflow answer is missing its admitted authority kind.',
        });
      }
      if (
        operation.kind !== 'WORKFLOW_ANSWER' ||
        (operation.state !== AgentOperationState.ROUTING_PENDING &&
          operation.state !==
            AgentOperationState.AWAITING_WORKFLOW_RESOLUTION) ||
        !operation.authorizationId ||
        !operation.grantId ||
        !operation.messageId
      ) {
        throw new ConflictException({
          code: 'WORKFLOW_ANSWER_NOT_AWAITING_RESOLUTION',
          message: 'The workflow answer is not awaiting executable resolution.',
        });
      }
      const grant = await tx.executionGrant.findUnique({
        where: { id: operation.grantId },
        select: { machineId: true },
      });
      if (!grant) throw new NotFoundException('Execution grant not found');
      const triggerMessageId = params.triggerMessage.id;
      if (!triggerMessageId) {
        throw new ConflictException('Workflow trigger message id is required');
      }
      const trigger = params.triggerMessage.data.triggersAgent;
      if (!trigger) {
        throw new ConflictException('Workflow trigger is required');
      }
      if (trigger.triggerMessageId !== triggerMessageId) {
        throw new ConflictException(
          'Workflow trigger identity does not match its message',
        );
      }
      const stampedData: SystemMessageData = {
        ...params.triggerMessage.data,
        triggersAgent: {
          ...trigger,
          inputExecution: {
            operationId: operation.operationId,
            operationFingerprint: operation.fingerprint,
            messageId: triggerMessageId,
          },
        },
      };
      const written = await this.messageService.addMessageInTransaction(
        tx,
        { ...params.triggerMessage, data: stampedData },
        operation.organizationId as OrganizationId,
        'workflowAnswer:trigger',
        { executableOperationId: operation.operationId },
      );
      await tx.agentOperation.update({
        where: { operationId: operation.operationId },
        data: {
          triggerMessageId,
          state: AgentOperationState.DISPATCH_PENDING,
          result: {
            messageId: operation.messageId,
            triggerMessageId,
            resolution: 'DISPATCH',
          },
          version: { increment: 1 },
        },
      });
      await tx.agentOperationDispatch.create({
        data: {
          operationId: operation.operationId,
          authorizationId: operation.authorizationId,
          authorizationKind: operation.authorizationKind,
          grantId: operation.grantId,
          machineId: grant.machineId,
          triggerMessageId,
          state: 'PENDING',
        },
      });
      return written;
    });
    this.dispatchService.nudge();
    return message;
  }

  async markDelivered(operationId: string): Promise<void> {
    await this.prisma.db.$transaction(async (tx: AnyTransactionClient) => {
      await tx.agentOperationWorkflowInputDelivery.update({
        where: { operationId },
        data: {
          state: AgentOperationWorkflowInputState.DELIVERED,
          deliveredAt: new Date(),
          claimOwner: null,
          claimExpiresAt: null,
          lastFailureCode: null,
        },
      });
      await tx.agentOperation.updateMany({
        where: {
          operationId,
          state: AgentOperationState.ROUTING_PENDING,
        },
        data: {
          state: AgentOperationState.AWAITING_WORKFLOW_RESOLUTION,
          version: { increment: 1 },
        },
      });
    });
  }
}

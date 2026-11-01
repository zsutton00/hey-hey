import {
  DirectActionServiceScopeResolver,
  type PreparedServiceAdmission,
} from '../controller-authorization/direct-action-service-scope-resolver';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import {
  AgentOperationKind as PrismaAgentOperationKind,
  AgentOperationState as PrismaAgentOperationState,
  AgentOperationWorkflowInputKind,
} from '@prisma/client';
import {
  AgentOperationSnapshot,
  AgentTrigger,
  AgentTriggerStartRun,
  AgentTriggerUserMessage,
  SystemMessageData,
  UserMessageData,
  UserMessageAdmittedServiceScope,
} from '../../generated';
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
  MachineId,
} from '../../types';
import { extractMentions } from '../../utils/mentionFormatting';
import { MachinePresenceService } from '../../core/websockets/machine-presence.service';
import { MessageService, CreateMessageInput } from '../message.service';
import {
  ExecutionGrantService,
  InteractiveGrantAdmission,
} from '../controller-authorization/execution-grant.service';
import { AgentOperationDispatchService } from '../../core/websockets/agent-operation-dispatch.service';
import {
  AgentOperationRegistryService,
  BeginAgentOperationInput,
} from './agent-operation-registry.service';
import { ApiMetricsService } from '../../core/metrics/api-metrics.service';

export interface SubmitAgentOperationInput {
  operationId: string;
  operationFingerprint: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  userId: UserId;
  agentSessionId: AgentSessionId;
  conversationId: ConversationId;
  kind: PrismaAgentOperationKind;
  admission: InteractiveGrantAdmission;
  userMessage?: CreateMessageInput;
  workflowKickoffDelivery?: {
    workflowId: string;
    workflowName: string;
  };
  triggerMessage: CreateMessageInput;
  additionalMessages?: readonly CreateMessageInput[];
}

export interface SubmitPreparedAgentOperationInput
  extends SubmitAgentOperationInput {
  executionOwner: string;
  /** Caller-owned writes that must commit atomically with the operation. */
  onSubmittedInTx?: (tx: AnyTransactionClient) => Promise<void>;
}

type OperationTrigger = AgentTriggerStartRun | AgentTriggerUserMessage;

function isOperationTrigger(
  trigger: AgentTrigger,
): trigger is OperationTrigger {
  return (
    trigger.promptType === 'start_run' || trigger.promptType === 'user_message'
  );
}

// User-authored text admitted by an operation: the follow-up message, or the
// first message that starts a session. Its Service mentions are admitted here,
// so a typed mention never needs a separate approval.
function admittedUserText(
  trigger: AgentTrigger | undefined,
): string | undefined {
  if (trigger?.promptType === 'user_message')
    return trigger.payload.userMessage;
  if (trigger?.promptType === 'start_run') {
    const runPayload = trigger.payload.payload as
      | { userMessage?: unknown }
      | undefined;
    return typeof runPayload?.userMessage === 'string'
      ? runPayload.userMessage
      : undefined;
  }
  return undefined;
}

function stampOperationTrigger(
  data: SystemMessageData | UserMessageData,
  input: SubmitAgentOperationInput,
  triggerMessageId: MessageId,
  sourceUserMessageId?: MessageId,
): SystemMessageData | UserMessageData {
  const trigger = data.triggersAgent;
  if (!trigger || !isOperationTrigger(trigger)) {
    throw new ConflictException({
      code: 'AGENT_OPERATION_TRIGGER_MISSING',
      message:
        'The durable operation requires a start or user-message trigger.',
    });
  }
  const stampedTrigger: OperationTrigger = {
    ...trigger,
    operationId: input.operationId,
    operationFingerprint: input.operationFingerprint,
    triggerMessageId,
    ...(sourceUserMessageId ? { sourceUserMessageId } : {}),
  };
  return { ...data, triggersAgent: stampedTrigger };
}

@Injectable()
export class AgentOperationSubmissionService {
  private readonly logger = new Logger(AgentOperationSubmissionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: AgentOperationRegistryService,
    private readonly messageService: MessageService,
    private readonly executionGrantService: ExecutionGrantService,
    private readonly dispatchService: AgentOperationDispatchService,
    private readonly metrics: ApiMetricsService,
    private readonly machinePresenceService: MachinePresenceService,
  ) {}

  private async prepareServiceAdmission(
    input: SubmitAgentOperationInput,
  ): Promise<PreparedServiceAdmission | undefined> {
    const userText = admittedUserText(
      (input.triggerMessage.data as SystemMessageData | undefined)
        ?.triggersAgent,
    );
    if (!userText) return undefined;
    const mentionedServiceIds = Array.from(
      new Set(
        extractMentions(userText)
          .filter((mention) => mention.entityType === 'service')
          .map((mention) => mention.entityId),
      ),
    );
    if (mentionedServiceIds.length === 0) return undefined;

    const recordedOperation = await this.prisma.db.agentOperation.findUnique({
      where: { operationId: input.operationId },
      select: { state: true },
    });
    if (
      recordedOperation &&
      recordedOperation.state !== PrismaAgentOperationState.SUBMITTING
    )
      return undefined;

    return new DirectActionServiceScopeResolver(
      this.prisma,
      this.machinePresenceService,
    ).prepare({
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      agentSessionId: input.agentSessionId,
      conversationId: input.conversationId,
      machineId: input.admission.machineId as MachineId,
      userText,
    });
  }

  async submit(
    input: SubmitAgentOperationInput,
  ): Promise<AgentOperationSnapshot> {
    const serviceAdmission = await this.prepareServiceAdmission(input);
    const beginInput: BeginAgentOperationInput = {
      operationId: input.operationId,
      organizationId: input.organizationId,
      projectId: input.projectId,
      userId: input.userId,
      agentSessionId: input.agentSessionId,
      conversationId: input.conversationId,
      kind: input.kind,
      fingerprint: input.operationFingerprint,
    };

    const snapshot = await this.prisma.db.$transaction(async (tx) => {
      const begun = await this.registry.beginInTransaction(tx, beginInput);
      if (begun.disposition !== 'EXECUTE') {
        return this.registry.toSnapshot(begun.operation);
      }

      return this.commitSubmission(
        tx,
        input,
        begun.executionOwner,
        begun.operation,
        serviceAdmission,
      );
    });
    const wake = this.wakeCommittedOperation(input.operationId);
    // A follow-up's response carries the CLI's admission disposition, so it waits for this one
    // bounded delivery attempt; without a correlated acceptance it stays pending.
    if (input.kind === PrismaAgentOperationKind.DIRECT_TRIGGER) await wake;
    return snapshot;
  }

  async submitPrepared(
    input: SubmitPreparedAgentOperationInput,
  ): Promise<AgentOperationSnapshot> {
    const serviceAdmission = await this.prepareServiceAdmission(input);
    const snapshot = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`;
      const operation = await tx.agentOperation.findUnique({
        where: { operationId: input.operationId },
      });
      if (
        !operation ||
        operation.executionOwner !== input.executionOwner ||
        operation.state !== PrismaAgentOperationState.SUBMITTING
      ) {
        throw new ConflictException({
          code: 'AGENT_OPERATION_NOT_EXECUTION_OWNER',
          message:
            'The prepared operation is no longer owned by its submitter.',
        });
      }
      const committed = await this.commitSubmission(
        tx,
        input,
        input.executionOwner,
        operation,
        serviceAdmission,
      );
      await input.onSubmittedInTx?.(tx);
      return committed;
    });
    void this.wakeCommittedOperation(input.operationId);
    return snapshot;
  }

  /** Never rejects: a failed wake leaves the obligation pending for the dispatch sweep. */
  private wakeCommittedOperation(operationId: string): Promise<void> {
    return this.dispatchService
      .nudgeForOperation(operationId)
      .then((claimed) => {
        this.metrics.recordWake(
          'submission',
          claimed ? 'claimed' : 'no_eligible_work',
        );
      })
      .catch((error) => {
        this.metrics.recordWake('submission', 'failed');
        this.logger.warn(
          '[AgentOperationSubmissionService] committed operation wake-up failed',
          {
            operationId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
  }

  private async commitSubmission(
    tx: AnyTransactionClient,
    input: SubmitAgentOperationInput,
    executionOwner: string,
    operationRecord: Parameters<AgentOperationRegistryService['toSnapshot']>[0],
    serviceAdmission?: PreparedServiceAdmission,
  ): Promise<AgentOperationSnapshot> {
    const begun = { operation: operationRecord, executionOwner };

    const reserved = this.registry.reservedMessageIds(begun.operation);

    const trigger = input.triggerMessage.data?.triggersAgent;
    if (trigger && isOperationTrigger(trigger)) {
      this.executionGrantService.assertDeliveredInputs(
        input.admission,
        trigger.promptType === 'start_run'
          ? {
              kind: 'START_RUN',
              payload: trigger.payload,
              ...(serviceAdmission
                ? { admittedServiceScope: serviceAdmission.scope }
                : {}),
            }
          : {
              kind: 'USER_MESSAGE',
              payload: trigger.payload,
              ...(serviceAdmission
                ? { admittedServiceScope: serviceAdmission.scope }
                : {}),
            },
      );
    }
    if (serviceAdmission) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.agentSessionId}, 0))`;
      const session = await tx.agentSession.findUnique({
        where: { id: input.agentSessionId },
        include: {
          serviceRelations: {
            select: { serviceId: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      });
      const currentServiceIds: string[] | undefined =
        session?.serviceRelations.map(
          (relation: { serviceId: string }) => relation.serviceId,
        );
      if (
        !session ||
        session.serviceId !== serviceAdmission.baselineLaunchServiceId ||
        currentServiceIds?.length !==
          serviceAdmission.baselineServiceIds.length ||
        currentServiceIds.some(
          (id: string, index: number) =>
            id !== serviceAdmission.baselineServiceIds[index],
        )
      ) {
        throw new ConflictException(
          'The Agent Session Service scope changed during admission',
        );
      }
      if (!session.serviceId) {
        await tx.agentSession.update({
          where: { id: input.agentSessionId },
          data: { serviceId: serviceAdmission.scope.launchServiceId },
        });
      }
      await tx.serviceAgentSession.createMany({
        data: serviceAdmission.scope.serviceIds.map((serviceId) => ({
          agentSessionId: input.agentSessionId,
          serviceId,
        })),
        skipDuplicates: true,
      });
    }
    const userMessage = input.userMessage
      ? {
          ...input.userMessage,
          id: reserved.messageId,
        }
      : undefined;
    const triggerMessage = {
      ...input.triggerMessage,
      id: reserved.triggerMessageId,
      data: stampOperationTrigger(
        input.triggerMessage.data as SystemMessageData | UserMessageData,
        input,
        reserved.triggerMessageId,
        userMessage ? reserved.messageId : undefined,
      ),
    } as CreateMessageInput;
    if (serviceAdmission) {
      const data = triggerMessage.data as SystemMessageData;
      const trigger = data.triggersAgent as OperationTrigger;
      triggerMessage.data = {
        ...data,
        triggersAgent: {
          ...trigger,
          admittedServiceScope: serviceAdmission.scope,
        } satisfies OperationTrigger,
      } satisfies SystemMessageData;
    }

    // The executable row (the user message, or the SYSTEM trigger when there
    // is none) is inserted queued and undated in one write.
    const executableTrigger = input.triggerMessage.data.triggersAgent;
    const executable =
      (executableTrigger?.promptType === 'user_message' &&
        executableTrigger.payload.handlerPromptType !== 'task_monitor') ||
      (executableTrigger?.promptType === 'start_run' &&
        executableTrigger.payload.triggersAgent !== false &&
        !executableTrigger.payload.workflowName);
    const executableOptions = executable
      ? { executableOperationId: input.operationId }
      : {};

    for (const message of input.additionalMessages ?? []) {
      await this.messageService.addMessageInTransaction(
        tx,
        message,
        input.organizationId,
        'agentOperationSubmission:additionalMessage',
      );
    }
    if (userMessage) {
      await this.messageService.addMessageInTransaction(
        tx,
        userMessage,
        input.organizationId,
        'agentOperationSubmission:userMessage',
        executableOptions,
      );
    }
    if (input.workflowKickoffDelivery && !userMessage) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_KICKOFF_MESSAGE_MISSING',
        message:
          'A durable workflow kickoff delivery requires its canonical message.',
      });
    }
    if (
      input.workflowKickoffDelivery &&
      input.kind !== PrismaAgentOperationKind.START_RUN
    ) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_KICKOFF_KIND_INVALID',
        message: 'Workflow kickoff delivery is valid only for START_RUN.',
      });
    }
    await this.messageService.addMessageInTransaction(
      tx,
      triggerMessage,
      input.organizationId,
      'agentOperationSubmission:triggerMessage',
      userMessage ? {} : executableOptions,
    );

    // The interactive grant keeps the exact trigger message as its
    // authorized turn. Insert that message before creating the grant so the
    // messages FK is satisfied while all writes remain in this transaction.
    const grant =
      await this.executionGrantService.deriveInteractiveGrantInTransaction(tx, {
        admission: input.admission,
        authorizedTurnId: reserved.triggerMessageId,
      });

    const binding = await tx.agentSession.updateMany({
      where: {
        id: input.agentSessionId,
        conversationId: input.conversationId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        OR: [
          { machineId: input.admission.machineId },
          ...(input.kind === PrismaAgentOperationKind.START_RUN
            ? [{ machineId: null }]
            : []),
        ],
      },
      data: { machineId: input.admission.machineId },
    });
    if (binding.count !== 1) {
      this.logger.warn(
        'Durable operation rejected incompatible session binding',
        {
          operationId: input.operationId,
          agentSessionId: input.agentSessionId,
          machineId: input.admission.machineId,
        },
      );
      throw new ConflictException({
        code: 'AGENT_OPERATION_MACHINE_BINDING_CONFLICT',
        message: 'The Agent Session cannot be bound to the admitted machine.',
      });
    }
    this.logger.debug('Durable operation session machine binding persisted', {
      operationId: input.operationId,
      agentSessionId: input.agentSessionId,
      machineId: input.admission.machineId,
    });

    await this.registry.recordAuthorizationInTransaction(
      tx,
      input.operationId,
      begun.executionOwner,
      input.admission.authorizationId,
      grant.grant.id,
      input.admission.envelopeAuthorization.kind,
    );

    const result = {
      ...(begun.operation.result &&
      typeof begun.operation.result === 'object' &&
      !Array.isArray(begun.operation.result)
        ? begun.operation.result
        : {}),
      messageId: userMessage ? reserved.messageId : reserved.triggerMessageId,
      triggerMessageId: reserved.triggerMessageId,
    };
    const operation = await tx.agentOperation.update({
      where: { operationId: input.operationId },
      data: {
        authorizationId: input.admission.authorizationId,
        grantId: grant.grant.id,
        messageId: userMessage ? reserved.messageId : reserved.triggerMessageId,
        triggerMessageId: reserved.triggerMessageId,
        state: PrismaAgentOperationState.DISPATCH_PENDING,
        result,
        executionOwner: null,
        executionLeaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (!operation.authorizationKind) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_AUTHORIZATION_KIND_MISSING',
        message: 'The admitted operation is missing its authorization kind.',
      });
    }
    await tx.agentOperationDispatch.create({
      data: {
        operationId: input.operationId,
        authorizationId: input.admission.authorizationId,
        authorizationKind: operation.authorizationKind,
        grantId: grant.grant.id,
        machineId: grant.grant.machineId,
        triggerMessageId: reserved.triggerMessageId,
        state: 'PENDING',
        attemptCount: 0,
        nextAttemptAt: new Date(),
      },
    });
    if (input.workflowKickoffDelivery) {
      await tx.agentOperationWorkflowInputDelivery.create({
        data: {
          operationId: input.operationId,
          kind: AgentOperationWorkflowInputKind.START_RUN_KICKOFF,
          workflowId: input.workflowKickoffDelivery.workflowId,
          workflowName: input.workflowKickoffDelivery.workflowName,
        },
      });
    }
    this.logger.log(
      '[AgentOperationSubmissionService] committed durable operation',
      {
        operationId: input.operationId,
        agentSessionId: input.agentSessionId,
        authorizationId: input.admission.authorizationId,
        authorizationKind: input.admission.envelopeAuthorization.kind,
        grantId: grant.grant.id,
        triggerMessageId: reserved.triggerMessageId,
        messageCount:
          (input.additionalMessages?.length ?? 0) + (userMessage ? 1 : 0) + 1,
      },
    );
    return this.registry.toSnapshot(operation);
  }
}

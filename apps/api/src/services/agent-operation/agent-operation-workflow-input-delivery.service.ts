import type { MessageResponseDto } from '../../generated';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  AgentOperationKind,
  AgentOperationState,
  AgentOperationWorkflowInputKind,
  AgentOperationWorkflowInputState,
  Prisma,
} from '@prisma/client';
import { Client } from '@temporalio/client';
import * as crypto from 'node:crypto';
import { InjectTemporalClient } from '../../prisma/temporal.module';
import { PrismaService } from '../../prisma/prisma.service';
import {
  FlowUserMessage,
  StartRunKickoffSignalPayload,
  WorkflowAnswerSignalPayload,
} from '../../types/flow-internal.types';
import {
  ConversationId,
  OrganizationId,
  UserId,
  WorkflowId,
} from '../../types';
import { WorkflowSignals } from '../../utils/workflow-signals.util';
import {
  getWorkflowStatus,
  hasHandledStartRunKickoff,
  hasHandledWorkflowAnswer,
} from '../../workflows/conversation-flow.workflow';
import { MessageService } from '../message.service';
import { ConversationWorkflowService } from '../workflows/conversation-workflow.service';
import { FlowExecutionService } from '../workflows/flow-execution.service';
import { AgentOperationWorkflowAnswerService } from './agent-operation-workflow-answer.service';
import { isTimelineMessage } from 'src/mappers/message.mapper';

const CLAIM_LEASE_MS = 15_000;
const MAX_RETRY_DELAY_MS = 30_000;

type ClaimedWorkflowInput =
  Prisma.AgentOperationWorkflowInputDeliveryGetPayload<{
    include: { operation: true };
  }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Answers admitted through the durable rail are expected to contain the
 * selected field's payload directly. Keep accepting the pre-cutover
 * field-keyed form for messages that were already persisted before the UI
 * boundary was corrected.
 */
function normalizeWorkflowAnswerMessageData(
  data: FlowUserMessage['data'],
  action: string,
): FlowUserMessage['data'] {
  if (!isRecord(data) || data.action !== action || !isRecord(data.payload)) {
    return data;
  }

  const matchingFields = Object.values(data.payload).filter(
    (value): value is Record<string, unknown> =>
      isRecord(value) && value.action === action && isRecord(value.payload),
  );
  const [matchingField] = matchingFields;
  if (matchingFields.length !== 1 || !matchingField) return data;

  return {
    ...data,
    payload: matchingField.payload,
  } as FlowUserMessage['data'];
}

@Injectable()
export class AgentOperationWorkflowInputDeliveryService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(
    AgentOperationWorkflowInputDeliveryService.name,
  );
  private readonly workerId = crypto.randomUUID();
  private timer: ReturnType<typeof setInterval> | undefined;
  private running: Promise<void> | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService,
    private readonly workflowAnswerService: AgentOperationWorkflowAnswerService,
    private readonly flowExecutionService: FlowExecutionService,
    private readonly conversationWorkflowService: ConversationWorkflowService,
    @InjectTemporalClient() private readonly temporalClient: Client,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => this.nudge(), 1_000);
    this.nudge();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  nudge(): void {
    if (!this.running) {
      this.running = this.deliverOne()
        .catch((error: unknown) => {
          this.logger.error('Workflow answer delivery loop failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.running = undefined;
        });
    }
  }

  async deliverOne(): Promise<void> {
    const delivery = await this.claimNext();
    if (!delivery) return;
    try {
      if (
        delivery.kind === AgentOperationWorkflowInputKind.START_RUN_KICKOFF
      ) {
        await this.recoverUndatedKickoff(delivery);
      }
      const message = await this.messageService.getMessage(
        delivery.operation.messageId!,
        delivery.operation.organizationId as OrganizationId,
      );
      // Kickoff and workflow-answer messages are not executable inputs, so
      // they are written dated.
      if (!message || message.type !== 'USER' || !isTimelineMessage(message)) {
        throw new Error('WORKFLOW_INPUT_MESSAGE_MISSING');
      }
      if (
        delivery.kind === AgentOperationWorkflowInputKind.START_RUN_KICKOFF
      ) {
        await this.deliverStartRunKickoff(delivery, message);
        await this.markStartRunKickoffDelivered(delivery);
      } else {
        try {
          await this.deliverWorkflowAnswer(
            delivery,
            message,
            delivery.workflowId as WorkflowId,
          );
        } catch (error) {
          if (!this.isWorkflowGone(error)) throw error;
          const resumedWorkflowId = await this.resumePausedWorkflow(delivery);
          await this.deliverWorkflowAnswer(
            delivery,
            message,
            resumedWorkflowId,
          );
        }
        await this.workflowAnswerService.markDelivered(delivery.operationId);
      }
    } catch (error) {
      await this.releaseForRetry(
        delivery,
        error instanceof Error
          ? error.message
          : 'WORKFLOW_ANSWER_SIGNAL_FAILED',
      );
    }
  }

  // Kickoffs submitted while workflow launches were misclassified as
  // executable were written queued and undated. Dating the same row in place
  // lets delivery proceed under the original operation correlation, so no new
  // operation is created and Temporal's correlation dedupe still holds.
  private async recoverUndatedKickoff(
    delivery: ClaimedWorkflowInput,
  ): Promise<void> {
    const now = new Date();
    const recovered = await this.prisma.db.message.updateMany({
      where: {
        id: delivery.operation.messageId!,
        type: 'USER',
        createdAt: null,
        executionOperationId: delivery.operationId,
        executionStatus: 'queued',
      },
      data: {
        createdAt: now,
        contentUpdatedAt: now,
        executionStatus: null,
        executionOperationId: null,
        executionCancellationRequested: false,
      },
    });
    if (recovered.count > 0) {
      this.logger.warn('Recovered undated workflow kickoff message', {
        operationId: delivery.operationId,
        messageId: delivery.operation.messageId,
      });
    }
  }

  private async deliverWorkflowAnswer(
    delivery: ClaimedWorkflowInput,
    message: Extract<MessageResponseDto, { type: 'USER' }>,
    workflowId: WorkflowId,
  ): Promise<void> {
    if (!delivery.nodeId) {
      throw new Error('WORKFLOW_ANSWER_NODE_MISSING');
    }
    const handle = this.temporalClient.workflow.getHandle(workflowId);
    const status = await handle.query(getWorkflowStatus);
    if (status.currentNodeId !== delivery.nodeId) {
      throw new Error('WORKFLOW_ANSWER_NODE_MISMATCH');
    }
    const messageData = normalizeWorkflowAnswerMessageData(
      message.data,
      delivery.action ?? '',
    );
    const flowUserMessage: FlowUserMessage = {
      ...message,
      data: messageData,
      timestamp: message.createdAt,
      workflowId,
      nodeId: delivery.nodeId,
      workflowAnswerOperationId: delivery.operationId,
    };
    const payload: WorkflowAnswerSignalPayload = {
      operationId: delivery.operationId,
      nodeId: delivery.nodeId,
      message: flowUserMessage,
    };
    await handle.signal(
      WorkflowSignals.getWorkflowAnswerSignalName(workflowId),
      payload,
    );
    const handled = await handle.query(
      hasHandledWorkflowAnswer,
      delivery.operationId,
    );
    if (!handled) throw new Error('WORKFLOW_ANSWER_NOT_HANDLED');
  }

  private async deliverStartRunKickoff(
    delivery: ClaimedWorkflowInput,
    message: Extract<MessageResponseDto, { type: 'USER' }>,
  ): Promise<void> {
    if (
      delivery.operation.kind !== AgentOperationKind.START_RUN ||
      delivery.operation.state !== AgentOperationState.SUCCEEDED
    ) {
      throw new Error('START_RUN_KICKOFF_NOT_ACKNOWLEDGED');
    }
    const organizationId = delivery.operation.organizationId as OrganizationId;
    const conversationId = delivery.operation.conversationId as ConversationId;
    const conversation = await this.prisma.db.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true, workflowId: true },
    });
    if (!conversation) {
      throw new Error('START_RUN_KICKOFF_CONVERSATION_MISSING');
    }

    let workflowId = (conversation.workflowId ??
      delivery.workflowId) as WorkflowId;
    if (conversation.status === 'NOT_STARTED') {
      const started =
        await this.conversationWorkflowService.startConversationWorkflow(
          conversationId,
          organizationId,
          delivery.operation.userId as UserId,
          { startRunKickoffRequired: true },
        );
      workflowId = (started.workflowId ?? workflowId) as WorkflowId;
    }
    const handle = this.temporalClient.workflow.getHandle(workflowId);
    const status = await handle.query(getWorkflowStatus);
    if (!status.userMessageSignalReady) {
      throw new Error('START_RUN_KICKOFF_NOT_READY');
    }
    const flowUserMessage: FlowUserMessage = {
      ...message,
      timestamp: message.createdAt,
      workflowId,
    };
    const payload: StartRunKickoffSignalPayload = {
      operationId: delivery.operationId,
      message: flowUserMessage,
    };
    await handle.signal(
      WorkflowSignals.getStartRunKickoffSignalName(workflowId),
      payload,
    );
    const handled = await handle.query(
      hasHandledStartRunKickoff,
      delivery.operationId,
    );
    if (!handled) throw new Error('START_RUN_KICKOFF_NOT_HANDLED');
  }

  private async markStartRunKickoffDelivered(
    delivery: ClaimedWorkflowInput,
  ): Promise<void> {
    const updated =
      await this.prisma.db.agentOperationWorkflowInputDelivery.updateMany({
        where: {
          operationId: delivery.operationId,
          kind: AgentOperationWorkflowInputKind.START_RUN_KICKOFF,
          state: AgentOperationWorkflowInputState.CLAIMED,
          claimOwner: this.workerId,
        },
        data: {
          state: AgentOperationWorkflowInputState.DELIVERED,
          deliveredAt: new Date(),
          claimOwner: null,
          claimExpiresAt: null,
          lastFailureCode: null,
        },
      });
    if (updated.count !== 1) {
      throw new Error('START_RUN_KICKOFF_DELIVERY_LEASE_LOST');
    }
  }

  private isWorkflowGone(error: unknown): boolean {
    const errorName =
      error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : '';
    const errorMessage = error instanceof Error ? error.message : String(error);
    return (
      errorName === 'WorkflowNotFoundError' ||
      errorMessage.includes('workflow execution already completed') ||
      errorMessage.includes('workflow not found')
    );
  }

  private async resumePausedWorkflow(
    delivery: ClaimedWorkflowInput,
  ): Promise<WorkflowId> {
    const organizationId = delivery.operation.organizationId as OrganizationId;
    const conversationId = delivery.operation.conversationId as ConversationId;
    const pausedExecution =
      await this.flowExecutionService.findPausedByConversation(
        conversationId,
        organizationId,
      );
    if (
      !pausedExecution?.flowState ||
      pausedExecution.currentNode !== delivery.nodeId
    ) {
      throw new Error('WORKFLOW_ANSWER_RESUMABLE_EXECUTION_MISSING');
    }
    const claimed = await this.flowExecutionService.tryClaimPausedExecution(
      pausedExecution.id,
      organizationId,
    );
    if (!claimed) {
      throw new Error('WORKFLOW_ANSWER_RESUME_CLAIM_LOST');
    }

    let workflowId: WorkflowId;
    try {
      const result =
        await this.conversationWorkflowService.startWorkflowForExistingConversation(
          conversationId,
          delivery.workflowName,
          organizationId,
        );
      workflowId = result.workflowId as WorkflowId;
    } catch (error) {
      await this.flowExecutionService.markPaused(
        pausedExecution.id,
        organizationId,
      );
      throw error;
    }

    const updated =
      await this.prisma.db.agentOperationWorkflowInputDelivery.updateMany({
        where: {
          operationId: delivery.operationId,
          state: AgentOperationWorkflowInputState.CLAIMED,
          claimOwner: this.workerId,
        },
        data: { workflowId },
      });
    if (updated.count !== 1) {
      throw new Error('WORKFLOW_ANSWER_DELIVERY_LEASE_LOST');
    }
    return workflowId;
  }

  private async claimNext(): Promise<ClaimedWorkflowInput | null> {
    const now = new Date();
    const available = {
      OR: [
        {
          state: AgentOperationWorkflowInputState.PENDING,
          nextAttemptAt: { lte: now },
        },
        {
          state: AgentOperationWorkflowInputState.CLAIMED,
          claimExpiresAt: { lt: now },
        },
      ],
    } satisfies Prisma.AgentOperationWorkflowInputDeliveryWhereInput;
    const eligible = {
      OR: [
        { kind: AgentOperationWorkflowInputKind.WORKFLOW_ANSWER },
        {
          kind: AgentOperationWorkflowInputKind.START_RUN_KICKOFF,
          operation: {
            kind: AgentOperationKind.START_RUN,
            state: AgentOperationState.SUCCEEDED,
          },
        },
      ],
    } satisfies Prisma.AgentOperationWorkflowInputDeliveryWhereInput;
    const candidate =
      await this.prisma.db.agentOperationWorkflowInputDelivery.findFirst({
        where: { AND: [available, eligible] },
        orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
      });
    if (!candidate) return null;
    const claimed =
      await this.prisma.db.agentOperationWorkflowInputDelivery.updateMany({
        where: {
          operationId: candidate.operationId,
          AND: [available, eligible],
        },
        data: {
          state: AgentOperationWorkflowInputState.CLAIMED,
          claimOwner: this.workerId,
          claimExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
          attemptCount: { increment: 1 },
          lastAttemptAt: now,
        },
      });
    if (claimed.count !== 1) return null;
    return this.prisma.db.agentOperationWorkflowInputDelivery.findUnique({
      where: { operationId: candidate.operationId },
      include: { operation: true },
    });
  }

  private async releaseForRetry(
    delivery: ClaimedWorkflowInput,
    failureCode: string,
  ): Promise<void> {
    const delayMs = Math.min(
      MAX_RETRY_DELAY_MS,
      500 * 2 ** Math.min(delivery.attemptCount, 6),
    );
    await this.prisma.db.agentOperationWorkflowInputDelivery.updateMany({
      where: {
        operationId: delivery.operationId,
        state: AgentOperationWorkflowInputState.CLAIMED,
        claimOwner: this.workerId,
      },
      data: {
        state: AgentOperationWorkflowInputState.PENDING,
        claimOwner: null,
        claimExpiresAt: null,
        nextAttemptAt: new Date(Date.now() + delayMs),
        lastFailureCode: failureCode.slice(0, 255),
      },
    });
    this.logger.warn('Workflow answer remains pending', {
      operationId: delivery.operationId,
      failureCode,
    });
  }
}

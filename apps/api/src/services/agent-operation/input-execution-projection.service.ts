import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageService } from '../message.service';
import { TriggerEnvelopeSigner } from '../../core/websockets/trigger-envelope-signer.service';
import { WebsocketGateway } from '../../core/websockets/websocket.gateway';
import type { AuthenticatedMachine } from '../machine-pairing/machine-pairing.service';
import type {
  InputCancellationRequest,
  InputCancellationResponse,
  InputExecutionProjection,
  MessageRecordDto,
  WebSocketConversationReductionEvent,
  ConversationControlCancelInput,
} from '../../generated';
import type {
  OrganizationId,
  ProjectId,
  UserId,
  MachineId,
  ConversationId,
  MessageId,
} from '../../types';

@Injectable()
export class InputExecutionProjectionService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(InputExecutionProjectionService.name);
  private timer?: ReturnType<typeof setInterval>;
  private delivering = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessageService,
    private readonly signer: TriggerEnvelopeSigner,
    private readonly gateway: WebsocketGateway,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.deliverCancellations(), 2000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async cancel(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    operationId: string,
    request: InputCancellationRequest,
  ): Promise<InputCancellationResponse> {
    const result = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM messages WHERE id = ${request.messageId}::text FOR UPDATE`;
      const operation = await tx.agentOperation.findFirst({
        where: {
          operationId,
          organizationId,
          projectId,
          userId,
          agentSessionId: request.agentSessionId,
          OR: [
            { messageId: request.messageId },
            { triggerMessageId: request.messageId },
          ],
        },
      });
      const message = await tx.message.findUnique({
        where: { id: request.messageId },
      });
      if (
        !operation ||
        !message ||
        message.executionOperationId !== operationId ||
        !message.executionStatus
      )
        throw new NotFoundException('Executable input not found.');
      if (
        message.executionStatus === 'queued' &&
        !message.executionCancellationRequested
      ) {
        await tx.message.update({
          where: { id: message.id },
          data: { executionCancellationRequested: true },
        });
        await this.messages.publishMessageUpdatedEvent(tx, {
          messageId: message.id as MessageId,
          organizationId,
          projectId,
          conversationId: message.conversationId as ConversationId,
          update: {},
        });
      }
      return {
        executionStatus: message.executionStatus,
        cancellationRequested: message.executionStatus === 'queued',
      } satisfies InputCancellationResponse;
    });
    this.logger.log('Input cancellation requested', {
      operationId,
      messageId: request.messageId,
      agentSessionId: request.agentSessionId,
      executionStatus: result.executionStatus,
    });
    void this.deliverCancellations();
    return result;
  }

  async project(
    organizationId: OrganizationId,
    projectId: ProjectId,
    agentSessionId: string,
    machine: AuthenticatedMachine,
    input: InputExecutionProjection,
  ): Promise<{ accepted: boolean }> {
    const correlation = {
      operationId: input.operationId,
      messageId: input.messageId,
      agentSessionId,
      admissionId: input.admissionId,
      revision: input.revision,
      status: input.executionStatus,
    };
    const result = await this.prisma.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM messages WHERE id = ${input.messageId}::text FOR UPDATE`;
      const operation = await tx.agentOperation.findFirst({
        where: {
          operationId: input.operationId,
          fingerprint: input.operationFingerprint,
          organizationId,
          projectId,
          agentSessionId,
          userId: machine.userId,
          dispatch: { machineId: machine.machineId },
        },
      });
      const message = await tx.message.findUnique({
        where: { id: input.messageId },
      });
      if (
        !operation ||
        !message ||
        message.executionOperationId !== operation.operationId ||
        !message.executionStatus
      ) {
        this.logger.warn('Input execution projection rejected', {
          ...correlation,
          reason: 'ownership',
        });
        throw new NotFoundException(
          'The machine does not own this admitted input.',
        );
      }
      if (
        message.executionAdmissionId &&
        message.executionAdmissionId !== input.admissionId
      ) {
        this.logger.warn('Input execution projection rejected', {
          ...correlation,
          reason: 'admission_identity_changed',
        });
        throw new ConflictException('Input admission identity changed.');
      }
      if (input.executionStatus === 'started' && !input.turnId) {
        this.logger.warn('Input execution projection rejected', {
          ...correlation,
          reason: 'missing_turn',
        });
        throw new ConflictException(
          'Started input requires its selected execution identity.',
        );
      }
      if (message.executionTurnId && message.executionTurnId !== input.turnId) {
        this.logger.debug('Input execution projection rejected', {
          ...correlation,
          reason: 'turn_identity_changed',
        });
        return { accepted: false, projection: null };
      }
      if (
        message.executionStatus !== 'queued' &&
        message.executionStatus !== input.executionStatus
      ) {
        this.logger.debug('Input execution projection rejected', {
          ...correlation,
          reason: 'terminal_status_changed',
          currentStatus: message.executionStatus,
        });
        return { accepted: false, projection: null };
      }
      if (input.revision <= message.executionRevision) {
        const accepted = message.executionStatus === input.executionStatus;
        this.logger.debug('Input execution projection stale', {
          ...correlation,
          accepted,
          currentRevision: message.executionRevision,
        });
        return { accepted, projection: null };
      }
      if (
        input.executionStatus === 'cancelled' &&
        !message.executionCancellationRequested
      ) {
        this.logger.debug('Input execution projection rejected', {
          ...correlation,
          reason: 'cancellation_not_requested',
        });
        return { accepted: false, projection: null };
      }
      // The accepted start is the input's only entry into the timeline: it
      // dates the row once. Cancelled and failed inputs stay undated.
      const startedAt =
        input.executionStatus === 'started' &&
        message.executionStatus === 'queued'
          ? new Date()
          : undefined;
      await tx.message.update({
        where: { id: message.id },
        data: {
          executionStatus: input.executionStatus,
          executionAdmissionId: input.admissionId,
          executionRevision: input.revision,
          ...(input.turnId ? { executionTurnId: input.turnId } : {}),
          ...(input.executionStatus !== 'queued'
            ? { executionCancellationRequested: false }
            : {}),
          ...(startedAt
            ? { createdAt: startedAt, contentUpdatedAt: startedAt }
            : {}),
        },
      });
      await this.messages.publishMessageUpdatedEvent(tx, {
        messageId: message.id as MessageId,
        organizationId,
        projectId,
        conversationId: message.conversationId as ConversationId,
        update: {},
      });
      return {
        accepted: true,
        projection: {
          cancellationRequestedCleared: input.executionStatus !== 'queued',
          previousStatus: message.executionStatus,
        },
      };
    });
    // Acceptance is observable only once the owning transaction has committed.
    if (result.projection) {
      this.logger.debug('Input execution projected', {
        ...correlation,
        ...result.projection,
      });
    }
    return { accepted: result.accepted };
  }

  async queued(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: UserId,
    conversationId: string,
  ): Promise<MessageRecordDto[]> {
    const session = await this.prisma.db.agentSession.findFirst({
      where: { organizationId, projectId, userId, conversationId },
    });
    if (!session) return [];
    return this.messages.getQueuedInputs(conversationId as ConversationId);
  }

  async deliverCancellations(): Promise<void> {
    if (this.delivering) return;
    this.delivering = true;
    try {
      // Queued inputs are undated; send order is the owning operation's.
      const pending = await this.prisma.db.$queryRaw<
        { id: string; executionOperationId: string }[]
      >`
        SELECT m.id, m.execution_operation_id AS "executionOperationId"
        FROM messages m
        JOIN agent_operations o ON o.operation_id = m.execution_operation_id
        WHERE m.execution_status = 'queued'
          AND m.execution_cancellation_requested = true
        ORDER BY o.created_at ASC, m.id ASC
      `;
      for (const message of pending) {
        let agentSessionId: string | undefined;
        let stage: 'lookup' | 'sign' | 'send' = 'lookup';
        try {
          const operation = await this.prisma.db.agentOperation.findUnique({
            where: { operationId: message.executionOperationId },
            include: { dispatch: true },
          });
          agentSessionId = operation?.agentSessionId;
          if (!operation?.dispatch) {
            this.logger.debug('Input cancellation delivery unavailable', {
              operationId: message.executionOperationId,
              messageId: message.id,
              ...(operation
                ? { agentSessionId: operation.agentSessionId }
                : {}),
              reason: operation ? 'dispatch_absent' : 'operation_absent',
            });
            continue;
          }
          const body = {
            kind: 'cancel_input',
            conversationId: operation.conversationId as ConversationId,
            agentSessionId: operation.agentSessionId,
            operationId: operation.operationId,
            operationFingerprint: operation.fingerprint,
            messageId: message.id as MessageId,
          } satisfies ConversationControlCancelInput;
          stage = 'sign';
          const envelope = this.signer.signConversationReduction(
            body,
            operation.dispatch.machineId as MachineId,
            operation.userId as UserId,
          );
          stage = 'send';
          this.gateway.emitConversationReduction({
            type: 'trigger.control_reduction',
            timestamp: new Date().toISOString(),
            organizationId: operation.organizationId,
            projectId: operation.projectId,
            conversationId: operation.conversationId,
            userId: operation.userId,
            envelope,
          } satisfies WebSocketConversationReductionEvent);
          this.logger.debug('Input cancellation frame submitted', {
            operationId: operation.operationId,
            messageId: message.id,
            agentSessionId: operation.agentSessionId,
            outcome: 'awaiting_projection',
          });
        } catch (error) {
          // Durable pending input remains queued; independent items must still be delivered.
          this.logger.warn('Input cancellation item delivery deferred', {
            operationId: message.executionOperationId,
            messageId: message.id,
            ...(agentSessionId ? { agentSessionId } : {}),
            stage,
            errorType: error instanceof Error ? error.name : 'NonError',
          });
        }
      }
    } catch (error) {
      this.logger.warn('Input cancellation delivery deferred', {
        errorType: error instanceof Error ? error.name : 'NonError',
      });
    } finally {
      this.delivering = false;
    }
  }
}

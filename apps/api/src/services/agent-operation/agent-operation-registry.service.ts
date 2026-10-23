import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentOperation,
  AgentOperationKind as PrismaAgentOperationKind,
  AgentOperationState as PrismaAgentOperationState,
  Prisma,
} from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import {
  AgentOperationKind,
  AgentOperationSnapshot,
  AgentOperationState,
} from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import type { AnyTransactionClient } from '../../prisma/prisma.service';
import { failProjectReportStartRunInTransaction } from '../project-reports/project-report-attempt-transitions';
import {
  AgentSessionId,
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';
import {
  AdmittedAuthorizationKind,
  toPrismaAuthorizationKind,
} from './agent-operation-authorization-kind';

const EXECUTION_LEASE_MS = 30_000;
const TERMINAL_STATES = new Set<PrismaAgentOperationState>([
  PrismaAgentOperationState.SUCCEEDED,
  PrismaAgentOperationState.CANCELLED,
  PrismaAgentOperationState.DENIED,
  PrismaAgentOperationState.FAILED,
]);
const OPERATION_KIND: Record<PrismaAgentOperationKind, AgentOperationKind> = {
  START_RUN: AgentOperationKind.StartRun,
  DIRECT_TRIGGER: AgentOperationKind.DirectTrigger,
  WORKFLOW_ANSWER: AgentOperationKind.WorkflowAnswer,
  SESSION_MONITOR_DECISION: AgentOperationKind.SessionMonitorDecision,
};
const OPERATION_STATE: Record<PrismaAgentOperationState, AgentOperationState> =
  {
    CREATED: AgentOperationState.Created,
    RESOLVING_AUTHORIZATION: AgentOperationState.ResolvingAuthorization,
    AWAITING_APPROVAL: AgentOperationState.AwaitingApproval,
    SUBMITTING: AgentOperationState.Submitting,
    ROUTING_PENDING: AgentOperationState.RoutingPending,
    AWAITING_WORKFLOW_RESOLUTION:
      AgentOperationState.AwaitingWorkflowResolution,
    DISPATCH_PENDING: AgentOperationState.DispatchPending,
    RECONCILING: AgentOperationState.Reconciling,
    SUCCEEDED: AgentOperationState.Succeeded,
    CANCELLED: AgentOperationState.Cancelled,
    DENIED: AgentOperationState.Denied,
    FAILED: AgentOperationState.Failed,
  };

export interface BeginAgentOperationInput {
  operationId: string;
  organizationId: OrganizationId;
  projectId: ProjectId;
  userId: UserId;
  agentSessionId: AgentSessionId;
  conversationId: ConversationId;
  kind: PrismaAgentOperationKind;
  fingerprint: string;
}

export type AgentOperationDisposition = 'EXECUTE' | 'JOIN' | 'RETURN';

export interface BegunAgentOperation {
  disposition: AgentOperationDisposition;
  operation: AgentOperation;
  executionOwner: string;
}

export interface CompleteAgentOperationInput {
  operationId: string;
  executionOwner: string;
  messageId: MessageId;
  triggerMessageId: MessageId;
  result?: Prisma.InputJsonValue;
}

@Injectable()
export class AgentOperationRegistryService {
  constructor(private readonly prisma: PrismaService) {}

  async begin(input: BeginAgentOperationInput): Promise<BegunAgentOperation> {
    return this.prisma.db.$transaction((tx) =>
      this.beginInTransaction(tx, input),
    );
  }

  async beginInTransaction(
    tx: AnyTransactionClient,
    input: BeginAgentOperationInput,
  ): Promise<BegunAgentOperation> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.operationId}, 0))`;
    const session = await tx.agentSession.findFirst({
      where: {
        id: input.agentSessionId,
        organizationId: input.organizationId,
        projectId: input.projectId,
        userId: input.userId,
        conversationId: input.conversationId,
      },
      select: { id: true },
    });
    if (!session) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_SESSION_MISMATCH',
        message: 'The operation does not match the bound Agent Session.',
      });
    }
    const existing = await tx.agentOperation.findUnique({
      where: { operationId: input.operationId },
    });
    const executionOwner = uuidv4();
    const leaseExpiresAt = new Date(Date.now() + EXECUTION_LEASE_MS);
    if (!existing) {
      const messageId = uuidv4();
      const triggerMessageId = uuidv4();
      const operation = await tx.agentOperation.create({
        data: {
          operationId: input.operationId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          userId: input.userId,
          agentSessionId: input.agentSessionId,
          conversationId: input.conversationId,
          kind: input.kind,
          fingerprint: input.fingerprint,
          state: PrismaAgentOperationState.SUBMITTING,
          result: {
            reservedMessageId: messageId,
            reservedTriggerMessageId: triggerMessageId,
          },
          executionOwner,
          executionLeaseExpiresAt: leaseExpiresAt,
        },
      });
      return { disposition: 'EXECUTE', operation, executionOwner };
    }

    this.assertIdentity(existing, input);
    if (
      TERMINAL_STATES.has(existing.state) ||
      existing.state === PrismaAgentOperationState.DISPATCH_PENDING ||
      existing.state === PrismaAgentOperationState.ROUTING_PENDING ||
      existing.state === PrismaAgentOperationState.AWAITING_WORKFLOW_RESOLUTION
    ) {
      return { disposition: 'RETURN', operation: existing, executionOwner };
    }
    if (
      existing.executionOwner &&
      existing.executionLeaseExpiresAt &&
      existing.executionLeaseExpiresAt.getTime() > Date.now()
    ) {
      return { disposition: 'JOIN', operation: existing, executionOwner };
    }

    if (existing.state === PrismaAgentOperationState.RECONCILING) {
      const operation = await tx.agentOperation.update({
        where: { operationId: input.operationId },
        data: {
          state: PrismaAgentOperationState.SUBMITTING,
          executionOwner,
          executionLeaseExpiresAt: leaseExpiresAt,
          version: { increment: 1 },
        },
      });
      return { disposition: 'EXECUTE', operation, executionOwner };
    }

    const operation = await tx.agentOperation.update({
      where: { operationId: input.operationId },
      data: {
        state: PrismaAgentOperationState.FAILED,
        failureCode: 'AGENT_OPERATION_EXECUTION_OUTCOME_UNKNOWN',
        failureMessage:
          'The original executor did not record a terminal outcome before its lease expired.',
        terminalAt: new Date(),
        executionOwner: null,
        executionLeaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (operation.kind === PrismaAgentOperationKind.START_RUN) {
      await failProjectReportStartRunInTransaction(
        tx,
        operation.agentSessionId,
        'FAILED',
      );
    }
    return { disposition: 'RETURN', operation, executionOwner };
  }

  async waitForTerminal(
    operationId: string,
    timeoutMs = 5_000,
  ): Promise<AgentOperation> {
    const deadline = Date.now() + timeoutMs;
    do {
      const operation = await this.prisma.db.agentOperation.findUnique({
        where: { operationId },
      });
      if (!operation) throw new NotFoundException('Agent operation not found');
      if (TERMINAL_STATES.has(operation.state)) return operation;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new ConflictException({
      code: 'AGENT_OPERATION_IN_PROGRESS',
      message: 'The operation is still in progress; reconcile its status.',
    });
  }

  async recordAuthorization(
    operationId: string,
    executionOwner: string,
    authorizationId: string,
    authorizationKind: AdmittedAuthorizationKind,
  ): Promise<void> {
    await this.updateOwned(operationId, executionOwner, {
      authorizationId,
      authorizationKind: toPrismaAuthorizationKind(authorizationKind),
      state: PrismaAgentOperationState.SUBMITTING,
    });
  }

  async recordAuthorizationInTransaction(
    tx: AnyTransactionClient,
    operationId: string,
    executionOwner: string,
    authorizationId: string,
    grantId: string,
    authorizationKind: AdmittedAuthorizationKind,
  ): Promise<void> {
    const updated = await tx.agentOperation.updateMany({
      where: {
        operationId,
        executionOwner,
        state: PrismaAgentOperationState.SUBMITTING,
      },
      data: {
        authorizationId,
        authorizationKind: toPrismaAuthorizationKind(authorizationKind),
        grantId,
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_NOT_EXECUTION_OWNER',
        message: 'The operation is terminal or owned by another executor.',
      });
    }
  }

  reservedMessageIds(operation: AgentOperation): {
    messageId: MessageId;
    triggerMessageId: MessageId;
  } {
    const result = operation.result;
    if (
      !result ||
      typeof result !== 'object' ||
      Array.isArray(result) ||
      typeof result['reservedMessageId'] !== 'string' ||
      typeof result['reservedTriggerMessageId'] !== 'string'
    ) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_CORRELATION_MISSING',
        message: 'The operation is missing its reserved message identities.',
      });
    }
    return {
      messageId: result['reservedMessageId'] as MessageId,
      triggerMessageId: result['reservedTriggerMessageId'] as MessageId,
    };
  }

  async succeed(input: CompleteAgentOperationInput): Promise<AgentOperation> {
    const priorResult =
      input.result &&
      typeof input.result === 'object' &&
      !Array.isArray(input.result)
        ? input.result
        : {};
    return this.updateOwned(input.operationId, input.executionOwner, {
      state: PrismaAgentOperationState.SUCCEEDED,
      messageId: input.messageId,
      triggerMessageId: input.triggerMessageId,
      result: {
        ...priorResult,
        messageId: input.messageId,
        triggerMessageId: input.triggerMessageId,
      },
      terminalAt: new Date(),
      executionOwner: null,
      executionLeaseExpiresAt: null,
      version: { increment: 1 },
    });
  }

  async succeedInTransaction(
    tx: AnyTransactionClient,
    input: CompleteAgentOperationInput,
  ): Promise<AgentOperation> {
    const priorResult =
      input.result &&
      typeof input.result === 'object' &&
      !Array.isArray(input.result)
        ? input.result
        : {};
    const updated = await tx.agentOperation.updateMany({
      where: {
        operationId: input.operationId,
        executionOwner: input.executionOwner,
        state: PrismaAgentOperationState.SUBMITTING,
      },
      data: {
        state: PrismaAgentOperationState.SUCCEEDED,
        messageId: input.messageId,
        triggerMessageId: input.triggerMessageId,
        result: {
          ...priorResult,
          messageId: input.messageId,
          triggerMessageId: input.triggerMessageId,
        },
        terminalAt: new Date(),
        executionOwner: null,
        executionLeaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_NOT_EXECUTION_OWNER',
        message: 'The operation is terminal or owned by another executor.',
      });
    }
    return tx.agentOperation.findUniqueOrThrow({
      where: { operationId: input.operationId },
    });
  }

  async markReconciling(
    operationId: string,
    executionOwner: string,
  ): Promise<AgentOperation> {
    return this.updateOwned(operationId, executionOwner, {
      state: PrismaAgentOperationState.RECONCILING,
      executionOwner: null,
      executionLeaseExpiresAt: null,
      version: { increment: 1 },
    });
  }

  async markRoutingPendingInTransaction(
    tx: AnyTransactionClient,
    operationId: string,
    executionOwner: string,
    messageId: MessageId,
  ): Promise<AgentOperation> {
    const updated = await tx.agentOperation.updateMany({
      where: {
        operationId,
        executionOwner,
        state: PrismaAgentOperationState.SUBMITTING,
      },
      data: {
        messageId,
        state: PrismaAgentOperationState.ROUTING_PENDING,
        executionOwner: null,
        executionLeaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_NOT_EXECUTION_OWNER',
        message: 'The operation is terminal or owned by another executor.',
      });
    }
    const operation = await tx.agentOperation.findUnique({
      where: { operationId },
    });
    if (!operation) throw new NotFoundException('Agent operation not found');
    return operation;
  }

  async fail(
    operationId: string,
    executionOwner: string,
    code: string,
    message: string,
    state: 'DENIED' | 'FAILED' | 'CANCELLED' = 'FAILED',
  ): Promise<AgentOperation> {
    return this.updateOwned(operationId, executionOwner, {
      state: PrismaAgentOperationState[state],
      failureCode: code,
      failureMessage: message,
      terminalAt: new Date(),
      executionOwner: null,
      executionLeaseExpiresAt: null,
      version: { increment: 1 },
    });
  }

  async getSnapshot(params: {
    operationId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
  }): Promise<AgentOperationSnapshot> {
    const operation = await this.prisma.db.agentOperation.findFirst({
      where: params,
    });
    if (!operation) throw new NotFoundException('Agent operation not found');
    return this.toSnapshot(operation);
  }

  toSnapshot(operation: AgentOperation): AgentOperationSnapshot {
    const result =
      operation.result &&
      typeof operation.result === 'object' &&
      !Array.isArray(operation.result)
        ? operation.result
        : null;
    return {
      operationId: operation.operationId,
      kind: OPERATION_KIND[operation.kind],
      fingerprint: operation.fingerprint,
      state: OPERATION_STATE[operation.state],
      ...(result?.['messageId']
        ? { messageId: result['messageId'] as MessageId }
        : {}),
      ...(result?.['triggerMessageId']
        ? { triggerMessageId: result['triggerMessageId'] as MessageId }
        : {}),
      ...(operation.failureCode ? { code: operation.failureCode } : {}),
      ...(operation.failureMessage
        ? { message: operation.failureMessage }
        : {}),
    } satisfies AgentOperationSnapshot;
  }

  private assertIdentity(
    operation: AgentOperation,
    input: BeginAgentOperationInput,
  ): void {
    if (
      operation.organizationId !== input.organizationId ||
      operation.projectId !== input.projectId ||
      operation.userId !== input.userId ||
      operation.agentSessionId !== input.agentSessionId ||
      operation.conversationId !== input.conversationId ||
      operation.kind !== input.kind ||
      operation.fingerprint !== input.fingerprint
    ) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_FINGERPRINT_MISMATCH',
        message: 'The operation identity is already bound to different work.',
      });
    }
  }

  private async updateOwned(
    operationId: string,
    executionOwner: string,
    data: Prisma.AgentOperationUncheckedUpdateManyInput,
  ): Promise<AgentOperation> {
    const updated = await this.prisma.db.agentOperation.updateMany({
      where: {
        operationId,
        executionOwner,
        state: { notIn: [...TERMINAL_STATES] },
      },
      data,
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'AGENT_OPERATION_NOT_EXECUTION_OWNER',
        message: 'The operation is terminal or owned by another executor.',
      });
    }
    const operation = await this.prisma.db.agentOperation.findUnique({
      where: { operationId },
    });
    if (!operation) throw new NotFoundException('Agent operation not found');
    return operation;
  }
}

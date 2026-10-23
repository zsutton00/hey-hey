import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { v5 as uuidv5 } from 'uuid';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageService } from 'src/services/message.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { AgentOperationDispatchService } from 'src/core/websockets/agent-operation-dispatch.service';
import { canonicalizeJcs } from 'src/core/websockets/trigger-canonicalization';
import { FeatureSyncFlowContext } from 'src/types/flow-internal.types';
import { OrganizationId, ConversationId, MessageId } from 'src/types';
import {
  AgentTriggerStartRun,
  SystemMessageData,
  MessageStatus,
} from 'src/generated';

/** Owns replacement admission and readiness; workflow nodes only request the result. */
@Injectable()
export class ImplementRuntimeService {
  private readonly logger = new Logger(ImplementRuntimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly modules: ModuleRef,
  ) {}

  async prepare(context: FeatureSyncFlowContext): Promise<void> {
    const runtime = context.implementRuntime;
    if (!runtime) {
      this.logger.debug('Approval preserves the current runtime', {
        conversationId: context.core.conversationId,
      });
      return;
    }
    const operationId = context.implementApprovalOperationId;
    if (!operationId)
      throw new Error('Approval runtime requires its authorized operation.');
    const parent = await this.prisma.db.agentOperation.findUnique({
      where: { operationId },
    });
    if (
      !parent ||
      parent.kind !== 'WORKFLOW_ANSWER' ||
      parent.conversationId !== context.core.conversationId ||
      parent.organizationId !== context.core.organizationId ||
      parent.projectId !== context.core.projectId
    ) {
      throw new Error(
        'Approval runtime operation does not match the conversation.',
      );
    }
    if (['FAILED', 'DENIED', 'CANCELLED'].includes(parent.state)) {
      throw new Error(
        parent.failureMessage ?? 'Approval runtime could not be established.',
      );
    }
    const sessions = this.modules.get(AgentSessionService, { strict: false });
    const session = await sessions.findOne(
      context.core.organizationId,
      parent.agentSessionId,
    );
    const replacementId = uuidv5('implement-runtime-replacement', operationId);
    const replacement = await this.prisma.db.agentOperation.findUnique({
      where: { operationId: replacementId },
    });
    if (session.provider === runtime.provider && !replacement) {
      this.logger.debug(
        'Approval keeps the current provider with selected settings',
        {
          operationId,
          agentSessionId: parent.agentSessionId,
          provider: runtime.provider,
          model: runtime.model,
          reasoningEffort: runtime.reasoningEffort ?? null,
          fastMode: runtime.fastMode ?? null,
        },
      );
      return;
    }
    this.logger.debug('Preparing approval runtime replacement', {
      operationId,
      replacementId,
      agentSessionId: parent.agentSessionId,
      conversationId: parent.conversationId,
      provider: runtime.provider,
    });
    try {
      if (!replacement) {
        const launch = await this.prisma.db.agentOperation.findFirst({
          where: {
            agentSessionId: parent.agentSessionId,
            conversationId: parent.conversationId,
            kind: 'START_RUN',
            state: 'SUCCEEDED',
          },
          orderBy: { createdAt: 'asc' },
        });
        if (!launch?.triggerMessageId)
          throw new Error('The original launch configuration is unavailable.');
        const messages = this.modules.get(MessageService, { strict: false });
        const source = await messages.getMessage(
          launch.triggerMessageId,
          context.core.organizationId,
        );
        if (
          source?.type !== 'SYSTEM' ||
          source.data.triggersAgent?.promptType !== 'start_run'
        ) {
          throw new Error(
            'The original launch configuration is not a typed start request.',
          );
        }
        const original = source.data.triggersAgent.payload;
        if (!original.workflowName)
          throw new Error('Approval replacement requires a workflow launch.');
        const triggerMessageId = uuidv5('trigger', replacementId) as MessageId;
        const payload: AgentTriggerStartRun['payload'] = {
          ...original,
          runId: replacementId,
          provider: runtime.provider,
          model: runtime.model,
          reasoningEffort: runtime.reasoningEffort,
          fastMode: runtime.fastMode,
        };
        const fingerprint = createHash('sha256')
          .update(
            canonicalizeJcs({
              parentOperationId: operationId,
              agentSessionId: parent.agentSessionId,
              conversationId: parent.conversationId,
              payload,
            }),
          )
          .digest('hex');
        const data: SystemMessageData = {
          type: SystemMessageData.TypeEnum.Questions,
          response: '',
          triggersAgent: {
            promptType: 'start_run',
            payload,
            triggerMessageId,
            operationId: replacementId,
            operationFingerprint: fingerprint,
          },
        };
        await this.prisma.db.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${replacementId}, 0))`;
          if (
            await tx.agentOperation.findUnique({
              where: { operationId: replacementId },
            })
          )
            return;
          if (
            !parent.authorizationId ||
            !parent.authorizationKind ||
            !parent.grantId
          ) {
            throw new Error(
              'Approval replacement is missing its controller authority.',
            );
          }
          const grant = await tx.executionGrant.findUnique({
            where: { id: parent.grantId },
          });
          if (
            !grant ||
            grant.expiresAt <= new Date() ||
            grant.revokedAt !== null
          ) {
            throw new Error(
              'Approval replacement controller authority is no longer active.',
            );
          }
          // These rows have immediate foreign keys in both directions:
          // messages.execution_operation_id points to the operation, while
          // agent_operations.trigger_message_id points back to the message.
          // Create the operation with its optional trigger unset, then insert
          // the message and bind it before committing this transaction.
          await tx.agentOperation.create({
            data: {
              operationId: replacementId,
              fingerprint,
              kind: 'START_RUN',
              state: 'DISPATCH_PENDING',
              organizationId: parent.organizationId,
              projectId: parent.projectId,
              userId: parent.userId,
              agentSessionId: parent.agentSessionId,
              conversationId: parent.conversationId,
              authorizationId: parent.authorizationId,
              authorizationKind: parent.authorizationKind,
              grantId: parent.grantId,
              messageId: parent.messageId,
            },
          });
          await messages.addMessageInTransaction(
            tx,
            {
              id: triggerMessageId,
              type: 'SYSTEM',
              status: MessageStatus.Completed,
              projectId: context.core.projectId,
              conversationId: parent.conversationId as ConversationId,
              parentMessageId: parent.messageId as MessageId,
              data,
            },
            parent.organizationId as OrganizationId,
            'approvalRuntime:replacement',
            { executableOperationId: replacementId },
          );
          const triggerBinding = await tx.agentOperation.updateMany({
            where: { operationId: replacementId, triggerMessageId: null },
            data: { triggerMessageId },
          });
          if (triggerBinding.count !== 1)
            throw new Error(
              'Approval replacement trigger could not be bound to its operation.',
            );
          await tx.agentOperationDispatch.create({
            data: {
              operationId: replacementId,
              authorizationId: parent.authorizationId,
              authorizationKind: parent.authorizationKind,
              grantId: parent.grantId,
              machineId: grant.machineId,
              triggerMessageId,
              state: 'PENDING',
            },
          });
        });
      }
      const dispatch = this.modules.get(AgentOperationDispatchService, {
        strict: false,
      });
      await dispatch.nudgeForOperation(replacementId);
      await this.waitForAcceptance(replacementId);
      const config = session.config;
      if (!config || config.version !== 'v2')
        throw new Error(
          'Approval runtime requires the coding session runtime configuration.',
        );
      await sessions.update(
        context.core.organizationId,
        parent.agentSessionId,
        {
          provider: runtime.provider,
          config: {
            ...config,
            model: runtime.model,
            effort: runtime.reasoningEffort,
            fastMode: runtime.fastMode,
          },
        },
      );
      this.logger.debug('Approval runtime replacement accepted and stored', {
        operationId,
        replacementId,
        provider: runtime.provider,
      });
    } catch (error) {
      const failureMessage =
        error instanceof Error
          ? error.message
          : 'Approval runtime replacement failed.';
      await this.prisma.db.agentOperation.updateMany({
        where: {
          operationId,
          state: { in: ['ROUTING_PENDING', 'AWAITING_WORKFLOW_RESOLUTION'] },
        },
        data: {
          state: 'FAILED',
          failureCode: 'APPROVAL_RUNTIME_REPLACEMENT_FAILED',
          failureMessage,
          terminalAt: new Date(),
        },
      });
      this.logger.error('Approval runtime replacement stopped implementation', {
        operationId,
        replacementId,
        failureMessage,
      });
      throw error;
    }
  }

  private async waitForAcceptance(operationId: string): Promise<void> {
    const deadline = Date.now() + 5_000;
    do {
      const operation = await this.prisma.db.agentOperation.findUnique({
        where: { operationId },
      });
      if (operation?.state === 'SUCCEEDED') return;
      if (
        operation &&
        ['FAILED', 'DENIED', 'CANCELLED'].includes(operation.state)
      ) {
        throw new Error(
          operation.failureMessage ??
            'The selected provider rejected the replacement.',
        );
      }
      if (Date.now() >= deadline) break;
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    throw new Error(
      'The selected provider has not accepted the replacement. Please retry approval.',
    );
  }
}

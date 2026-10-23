import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FlowExecutionStatus, Prisma } from '@prisma/client';
import {
  ConversationStatus,
  MessageResponseDto,
  MessageStatus,
  SubmitRepositoryImportReplyRequestDto,
  SystemMessageData,
  WorkflowName,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../types';
import { FlowContext, NodeType } from '../types/flow-internal.types';
import {
  hasUiElements,
  isQuestionSystemMessageData,
} from '../utils/type-checks';
import {
  isSerializableWorkflowState,
  SerializableWorkflowState,
  WorkflowPhase,
  WorkflowStep,
} from '../workflows/conversation-workflow-state';
import { MessageService } from './message.service';
import { RepositoryImportReplyFormValidator } from './repository-import-reply-form-validator';
import { NodeExecutionService } from './workflows/node-execution.service';
import { REPOSITORY_IMPORT_NODES } from '../flows/constants/node-ids';
import {
  validateRepositoryGroundingFormAnswers,
  RepositoryGroundingInputError,
} from '../flows/nodes/onboarding/repository-grounding.contract';
import { resolveRepositoryImportFlowIdentity } from '../workflows/repository-import-legacy-compatibility';

@Injectable()
export class RepositoryImportReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService,
    private readonly nodeExecutionService: NodeExecutionService,
    private readonly formValidator: RepositoryImportReplyFormValidator,
  ) {}

  async admit(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId: ConversationId;
    userId: UserId;
    request: SubmitRepositoryImportReplyRequestDto;
  }): Promise<MessageResponseDto> {
    const admitAttempt = () =>
      this.prisma.$transaction(
        async (tx) => {
          const conversation = await tx.conversation.findFirst({
            where: {
              id: input.conversationId,
              organizationId: input.organizationId,
              projectId: input.projectId,
            },
            select: {
              id: true,
              version: true,
              workflowId: true,
              workflowName: true,
              workflowAboutId: true,
              workflowAboutType: true,
              status: true,
            },
          });
          if (!conversation)
            throw new NotFoundException('Conversation not found');
          if (
            ![WorkflowName.RepositoryImport, WorkflowName.Onboarding].includes(
              conversation.workflowName as WorkflowName,
            ) ||
            conversation.workflowAboutId !== input.projectId ||
            conversation.workflowAboutType !== 'project' ||
            [ConversationStatus.Failed, ConversationStatus.Deleted].includes(
              conversation.status as ConversationStatus,
            )
          ) {
            throw new ConflictException(
              'Conversation is not an active repository import workflow',
            );
          }

          const execution = await tx.flowExecution.findFirst({
            where: {
              conversationId: input.conversationId,
              organizationId: input.organizationId,
              projectId: input.projectId,
              flowId: {
                in: [WorkflowName.RepositoryImport, WorkflowName.Onboarding],
              },
              OR: [
                {
                  status: {
                    in: [
                      FlowExecutionStatus.STARTED,
                      FlowExecutionStatus.IN_PROGRESS,
                    ],
                  },
                },
                {
                  status: {
                    in: [
                      FlowExecutionStatus.PAUSED,
                      FlowExecutionStatus.COMPLETED,
                    ],
                  },
                  resumable: true,
                },
              ],
            },
            orderBy: { startedAt: 'desc' },
          });
          if (!execution?.currentNode) {
            throw new ConflictException(
              'Repository import workflow is not accepting input',
            );
          }
          const effectiveFlowId = resolveRepositoryImportFlowIdentity({
            conversationWorkflowName: conversation.workflowName,
            executionFlowId: execution.flowId,
            currentNode: execution.currentNode,
            flowState: execution.flowState,
          });
          if (!effectiveFlowId) {
            throw new ConflictException(
              'Conversation is not an active repository import workflow',
            );
          }
          const executionIsRunning =
            execution.status === FlowExecutionStatus.STARTED ||
            execution.status === FlowExecutionStatus.IN_PROGRESS;
          if (executionIsRunning && !conversation.workflowId) {
            throw new ConflictException(
              'Repository import workflow is not accepting input',
            );
          }

          const node = this.nodeExecutionService.getNode(
            effectiveFlowId,
            execution.currentNode,
          );
          if (
            !node ||
            ![
              NodeType.OPENER,
              NodeType.QUESTIONS,
              NodeType.LLM_QUESTIONS,
              NodeType.EXTERNAL_AGENT,
              NodeType.GENERATE,
            ].includes(node.node.type)
          ) {
            throw new ConflictException(
              'Repository import workflow is not accepting input',
            );
          }

          const parent = await tx.message.findFirst({
            where: {
              id: input.request.parentMessageId,
              conversationId: input.conversationId,
              projectId: input.projectId,
              type: 'SYSTEM',
              responses: { none: {} },
            },
          });
          const parentData = parent?.data as SystemMessageData | undefined;
          const uiElements =
            parentData && isQuestionSystemMessageData(parentData)
              ? parentData.uiElements
              : parentData &&
                  (node.node.type === NodeType.GENERATE ||
                    node.node.type === NodeType.EXTERNAL_AGENT) &&
                  hasUiElements(parentData)
                ? parentData.uiElements
                : undefined;
          if (
            !parent ||
            !parentData ||
            !uiElements ||
            parentData.nodeId !== execution.currentNode
          ) {
            throw new ConflictException(
              'Reply parent is not the current repository import form',
            );
          }

          this.formValidator.assertCompleteAnswers(
            uiElements,
            input.request.answers,
          );
          try {
            validateRepositoryGroundingFormAnswers(
              execution.currentNode,
              input.request.answers,
            );
          } catch (error) {
            if (error instanceof RepositoryGroundingInputError) {
              throw new BadRequestException(error.message);
            }
            throw error;
          }

          // Include the execution in the write set: its writers do not update the
          // conversation version. Serializable isolation rejects a changed snapshot,
          // and this row stays locked until the reply and delivery event commit.
          await tx.flowExecution.update({
            where: { id: execution.id, organizationId: input.organizationId },
            data: { version: { increment: 1 } },
          });

          if (!isSerializableWorkflowState(execution.flowState)) {
            const legacyContext = execution.flowState as
              | (Partial<FlowContext> & {
                  core?: Partial<FlowContext['core']>;
                })
              | null;
            const savedUser = legacyContext?.core?.user;
            const workflowId =
              conversation.workflowId ?? legacyContext?.core?.workflowId;
            const openerNextNode =
              node.node.type === NodeType.OPENER
                ? (node.routing.nextNode ?? REPOSITORY_IMPORT_NODES.RECOVERY)
                : undefined;
            if (
              !legacyContext ||
              !savedUser?.id ||
              !savedUser.role ||
              !workflowId ||
              (node.node.type === NodeType.OPENER && !openerNextNode)
            ) {
              throw new ConflictException(
                'Repository import workflow has no resumable saved state',
              );
            }

            const context: FlowContext = {
              ...legacyContext,
              core: {
                workflowId: workflowId as WorkflowId,
                projectId: input.projectId,
                organizationId: input.organizationId,
                conversationId: input.conversationId,
                workflowAboutId: input.projectId,
                workflowAboutType: 'project',
                user: savedUser as FlowContext['core']['user'],
                session: legacyContext.core?.session ?? {
                  startTime: execution.startedAt,
                  interactionCount: 0,
                },
              },
              flowId: conversation.workflowName as WorkflowName,
              lastSystemMessageId: parent.id as MessageId,
              flowPath: legacyContext.flowPath ?? {
                pathTaken: [execution.currentNode],
              },
              ...(openerNextNode
                ? {
                    pendingTransition: {
                      nextNodeId: openerNextNode,
                      reason: 'opener_complete',
                    },
                  }
                : {}),
            };
            const repairedState: SerializableWorkflowState = {
              step: WorkflowStep.WAITING_FOR_USER_INPUT,
              phase: WorkflowPhase.WAITING_FOR_USER,
              nodeConfig: {
                id: execution.currentNode,
                type: node.node.type,
                supportsPhases: node.node.twoPhase,
              },
              iterations: 0,
              context,
              currentNodeId: execution.currentNode,
              currentNodeExecutionId: parent.id as MessageId,
              lastSystemMessageId: parent.id as MessageId,
              lastUserMessageId: undefined,
              hasPendingLLMResponse: false,
              timestamp: new Date().toISOString(),
              version: 1,
            };
            await tx.flowExecution.update({
              where: {
                id: execution.id,
                organizationId: input.organizationId,
              },
              data: {
                flowState: repairedState as unknown as Prisma.InputJsonValue,
              },
            });
          }

          return this.messageService.addMessageInTransaction(
            tx,
            {
              type: 'USER',
              projectId: input.projectId,
              conversationId: input.conversationId,
              parentMessageId: input.request.parentMessageId,
              userId: input.userId,
              status: MessageStatus.Completed,
              data: input.request.answers,
            },
            input.organizationId,
            'repositoryImportReplyAdmission',
            {
              expectedConversationVersion: conversation.version,
              repositoryImportReplyDelivery: {
                ...(conversation.workflowId
                  ? { workflowId: conversation.workflowId as WorkflowId }
                  : {}),
                nodeId: execution.currentNode,
              },
              suppressExecutableDelivery: true,
            },
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    // Retry the whole transaction: failed attempts roll back the message and
    // delivery event, and the next attempt revalidates the form and workflow.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await admitAttempt();
      } catch (error) {
        const writeConflict =
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034') ||
          (error instanceof ConflictException &&
            error.message === 'Conversation version is stale');
        if (!writeConflict) throw error;
      }
    }
    throw new ConflictException(
      'Repository import changed while replying; refresh the current form and try again',
    );
  }
}

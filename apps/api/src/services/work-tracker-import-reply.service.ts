import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { FlowExecutionStatus, Prisma } from '@prisma/client';
import {
  ConversationStatus,
  MessageResponseDto,
  MessageStatus,
  SubmitWorkTrackerImportReplyRequestDto,
  SystemMessageData,
  WorkflowName,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
  WorkflowId,
} from '../types';
import { NodeType } from '../types/flow-internal.types';
import {
  hasUiElements,
  isQuestionSystemMessageData,
} from '../utils/type-checks';
import { isSerializableWorkflowState } from '../workflows/conversation-workflow-state';
import { MessageService } from './message.service';
import { RepositoryImportReplyFormValidator } from './repository-import-reply-form-validator';
import { NodeExecutionService } from './workflows/node-execution.service';

@Injectable()
export class WorkTrackerImportReplyService {
  private readonly logger = new Logger(WorkTrackerImportReplyService.name);

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
    request: SubmitWorkTrackerImportReplyRequestDto;
  }): Promise<MessageResponseDto> {
    this.logger.log('Admitting work-tracker import reply', {
      conversationId: input.conversationId,
      projectId: input.projectId,
      parentMessageId: input.request.parentMessageId,
    });
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
            conversation.workflowName !== WorkflowName.WorkTrackerImport ||
            conversation.workflowAboutId !== input.projectId ||
            conversation.workflowAboutType !== 'project' ||
            !conversation.workflowId ||
            [ConversationStatus.Failed, ConversationStatus.Deleted].includes(
              conversation.status as ConversationStatus,
            )
          ) {
            throw new ConflictException(
              'Conversation is not an active work-tracker import workflow',
            );
          }

          const execution = await tx.flowExecution.findFirst({
            where: {
              conversationId: input.conversationId,
              organizationId: input.organizationId,
              projectId: input.projectId,
              flowId: WorkflowName.WorkTrackerImport,
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
          if (
            !execution?.currentNode ||
            !isSerializableWorkflowState(execution.flowState)
          ) {
            throw new ConflictException(
              'Work-tracker import workflow is not accepting input',
            );
          }

          const node = this.nodeExecutionService.getNode(
            WorkflowName.WorkTrackerImport,
            execution.currentNode,
          );
          if (
            !node ||
            ![
              NodeType.QUESTIONS,
              NodeType.EXTERNAL_AGENT,
              NodeType.GENERATE,
            ].includes(node.node.type)
          ) {
            throw new ConflictException(
              'Work-tracker import workflow is not accepting input',
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
              : parentData && hasUiElements(parentData)
                ? parentData.uiElements
                : undefined;
          if (
            !parent ||
            !uiElements ||
            parentData?.nodeId !== execution.currentNode
          ) {
            throw new ConflictException(
              'Reply parent is not the current work-tracker import form',
            );
          }

          try {
            this.formValidator.assertCompleteAnswers(
              uiElements,
              input.request.answers,
            );
          } catch (error) {
            if (error instanceof BadRequestException) {
              this.logger.warn('Work-tracker import reply rejected', {
                conversationId: input.conversationId,
                nodeId: execution.currentNode,
                reason: error.message,
              });
            }
            throw error;
          }

          // Include the execution in the write set so a concurrent workflow
          // write invalidates this serializable snapshot.
          await tx.flowExecution.update({
            where: { id: execution.id, organizationId: input.organizationId },
            data: { version: { increment: 1 } },
          });

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
            'workTrackerImportReplyAdmission',
            {
              expectedConversationVersion: conversation.version,
              // The delivery obligation is workflow-agnostic: it signals the
              // bound Temporal workflow at the admitted node.
              repositoryImportReplyDelivery: {
                workflowId: conversation.workflowId as WorkflowId,
                nodeId: execution.currentNode,
              },
              suppressExecutableDelivery: true,
            },
          );
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const message = await admitAttempt();
        this.logger.log('Work-tracker import reply admitted', {
          conversationId: input.conversationId,
          messageId: message.id,
        });
        return message;
      } catch (error) {
        const writeConflict =
          (error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2034') ||
          (error instanceof ConflictException &&
            error.message === 'Conversation version is stale');
        if (!writeConflict) throw error;
        this.logger.debug(
          'Work-tracker import reply write conflict; retrying',
          {
            conversationId: input.conversationId,
            attempt,
          },
        );
      }
    }
    throw new ConflictException(
      'Work-tracker import changed while replying; refresh the current form and try again',
    );
  }
}

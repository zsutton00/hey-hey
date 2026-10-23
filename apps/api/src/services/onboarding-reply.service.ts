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
  SubmitOnboardingReplyRequestDto,
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
import { OnboardingReplyFormValidator } from './onboarding-reply-form-validator';
import { NodeExecutionService } from './workflows/node-execution.service';
import { ONBOARDING_NODES } from '../flows/constants/node-ids';
import { ProjectService } from './project.service';
import {
  validateRepositoryGroundingFormAnswers,
  parseProjectExistingWorkIntent,
  RepositoryGroundingInputError,
  REPOSITORY_GROUNDING_FIELDS,
} from '../flows/nodes/onboarding/repository-grounding.contract';
import { isQualifyingLegacyRepositoryImportExecution } from '../workflows/repository-import-legacy-compatibility';

@Injectable()
export class OnboardingReplyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService,
    private readonly nodeExecutionService: NodeExecutionService,
    private readonly formValidator: OnboardingReplyFormValidator,
    private readonly projectService: ProjectService,
  ) {}

  async admit(input: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    conversationId: ConversationId;
    userId: UserId;
    request: SubmitOnboardingReplyRequestDto;
  }): Promise<MessageResponseDto> {
    const admitted = await this.prisma.$transaction(async (tx) => {
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
      if (!conversation) throw new NotFoundException('Conversation not found');
      if (
        conversation.workflowName !== WorkflowName.Onboarding ||
        conversation.workflowAboutId !== input.projectId ||
        conversation.workflowAboutType !== 'project' ||
        [ConversationStatus.Failed, ConversationStatus.Deleted].includes(
          conversation.status as ConversationStatus,
        )
      ) {
        throw new ConflictException(
          'Conversation is not an active onboarding workflow',
        );
      }
      if (conversation.version !== input.request.expectedConversationVersion) {
        throw new ConflictException('Conversation version is stale');
      }

      const execution = await tx.flowExecution.findFirst({
        where: {
          conversationId: input.conversationId,
          organizationId: input.organizationId,
          projectId: input.projectId,
          flowId: WorkflowName.Onboarding,
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
                in: [FlowExecutionStatus.PAUSED, FlowExecutionStatus.COMPLETED],
              },
              resumable: true,
            },
          ],
        },
        orderBy: { startedAt: 'desc' },
      });
      if (!execution?.currentNode) {
        throw new ConflictException(
          'Onboarding workflow is not accepting input',
        );
      }
      if (
        isQualifyingLegacyRepositoryImportExecution({
          conversationWorkflowName: conversation.workflowName,
          executionFlowId: execution.flowId,
          currentNode: execution.currentNode,
          flowState: execution.flowState,
        })
      ) {
        throw new ConflictException(
          'Repository imports must use repository import reply admission',
        );
      }
      const executionIsRunning =
        execution.status === FlowExecutionStatus.STARTED ||
        execution.status === FlowExecutionStatus.IN_PROGRESS;
      if (executionIsRunning && !conversation.workflowId) {
        throw new ConflictException(
          'Onboarding workflow is not accepting input',
        );
      }

      const node = this.nodeExecutionService.getNode(
        WorkflowName.Onboarding,
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
          'Onboarding workflow is not accepting input',
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
          'Reply parent is not the current onboarding form',
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
            ? (node.routing.nextNode ?? ONBOARDING_NODES.CLARIFY_CONCEPT)
            : undefined;
        if (
          !legacyContext ||
          !savedUser?.id ||
          !savedUser.role ||
          !workflowId ||
          (node.node.type === NodeType.OPENER && !openerNextNode)
        ) {
          throw new ConflictException(
            'Onboarding workflow has no resumable saved state',
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
          flowId: WorkflowName.Onboarding,
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

      if (
        execution.currentNode === ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT
      ) {
        const existingWorkIntent = parseProjectExistingWorkIntent(
          input.request.answers[REPOSITORY_GROUNDING_FIELDS.intent],
        );
        await this.projectService.recordOnboardingExistingWorkIntent(tx, {
          projectId: input.projectId,
          organizationId: input.organizationId,
          existingWorkIntent,
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
        'onboardingReplyAdmission',
        {
          expectedConversationVersion:
            input.request.expectedConversationVersion,
          onboardingReplyDelivery: {
            ...(conversation.workflowId
              ? { workflowId: conversation.workflowId as WorkflowId }
              : {}),
            nodeId: execution.currentNode,
          },
          suppressExecutableDelivery: true,
        },
      );
    });

    return admitted;
  }
}

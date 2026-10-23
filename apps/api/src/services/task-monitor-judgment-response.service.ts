import { BadRequestException, Injectable } from '@nestjs/common';
import {
  SystemMessageData,
  TaskMonitorJudgmentRequestedSystemMessageData,
  TaskMonitorJudgmentResolvedCommand,
  UserMessageData,
} from '../generated';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../types';
import { MessageService } from './message.service';

type JudgmentResponseContext = {
  command: TaskMonitorJudgmentResolvedCommand;
  conversationId: ConversationId;
  existingResponse:
    | {
        id: string;
        type: string;
        userId: string;
        data: unknown;
      }
    | undefined;
};

@Injectable()
export class TaskMonitorJudgmentResponseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messageService: MessageService,
  ) {}

  async validateRequest(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorId: TaskId;
    userId: UserId;
    command: TaskMonitorJudgmentResolvedCommand;
  }): Promise<JudgmentResponseContext> {
    const requestMessage = await this.prisma.db.message.findFirst({
      where: {
        id: params.command.judgment.requestMessageId,
        projectId: params.projectId,
        type: 'SYSTEM',
        conversation: { organizationId: params.organizationId },
      },
      select: {
        conversationId: true,
        data: true,
        responses: {
          select: { id: true, type: true, userId: true, data: true },
        },
      },
    });

    if (
      !requestMessage ||
      !isJudgmentRequestData(requestMessage.data)
    ) {
      throw new BadRequestException(
        'requestMessageId must identify a JUDGMENT_REQUESTED Message in this project',
      );
    }

    const association =
      await this.prisma.db.agentSessionWorkItemAssociation.findFirst({
        where: {
          organizationId: params.organizationId,
          projectId: params.projectId,
          coordinatorType: 'TASK_MONITOR',
          workItemType: 'TASK_MONITOR',
          workItemId: params.monitorId,
        },
        select: { agentSession: { select: { conversationId: true } } },
      });

    if (
      !association?.agentSession.conversationId ||
      association.agentSession.conversationId !== requestMessage.conversationId
    ) {
      throw new BadRequestException(
        'requestMessageId does not belong to the addressed Task Monitor conversation',
      );
    }

    if (requestMessage.responses.length > 1) {
      throw new BadRequestException(
        'The judgment request has more than one canonical response',
      );
    }

    const existingResponse = requestMessage.responses[0];
    if (
      existingResponse &&
      (existingResponse.type !== 'USER' ||
        existingResponse.userId !== params.userId ||
        !isMatchingJudgmentResponseData(
          existingResponse.data,
          params.command.judgment.conclusion,
        ))
    ) {
      throw new BadRequestException(
        'The judgment request has already been answered with different content',
      );
    }

    return {
      command: params.command,
      conversationId: requestMessage.conversationId as ConversationId,
      existingResponse,
    };
  }

  async prepareAndEnsureResponse(params: {
    commandId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    monitorId: TaskId;
    userId: UserId;
    command: TaskMonitorJudgmentResolvedCommand;
  }): Promise<void> {
    const context = await this.validateRequest(params);
    await this.ensureResponse({ ...params, context });
  }

  async ensureResponse(params: {
    commandId: string;
    organizationId: OrganizationId;
    projectId: ProjectId;
    userId: UserId;
    context: JudgmentResponseContext;
  }): Promise<void> {
    if (params.context.existingResponse) {
      if (params.context.existingResponse.id !== params.commandId) {
        throw new BadRequestException(
          'The judgment request is bound to a different durable response identity',
        );
      }
      return;
    }

    const existing = await this.prisma.db.message.findUnique({
      where: { id: params.commandId },
      select: {
        conversationId: true,
        projectId: true,
        type: true,
        userId: true,
        parentMessageId: true,
        data: true,
      },
    });
    if (existing) {
      assertResponseMatches(existing, params, params.context);
      return;
    }

    try {
      await this.messageService.addMessage(
        {
          id: params.commandId as MessageId,
          projectId: params.projectId,
          type: 'USER',
          userId: params.userId,
          data: { comment: params.context.command.judgment.conclusion },
          conversationId: params.context.conversationId,
          parentMessageId:
            params.context.command.judgment.requestMessageId,
        },
        params.organizationId,
        'task-monitor-command',
      );
    } catch (error) {
      const raced = await this.prisma.db.message.findUnique({
        where: { id: params.commandId },
        select: {
          conversationId: true,
          projectId: true,
          type: true,
          userId: true,
          parentMessageId: true,
          data: true,
        },
      });
      if (!raced) {
        throw error;
      }
      assertResponseMatches(raced, params, params.context);
    }
  }
}

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isJudgmentRequestData = (
  data: SystemMessageData | UserMessageData,
): data is TaskMonitorJudgmentRequestedSystemMessageData =>
  data.type === SystemMessageData.TypeEnum.TaskMonitorSupervision &&
  'outcome' in data &&
  data.outcome ===
    TaskMonitorJudgmentRequestedSystemMessageData.OutcomeEnum.JudgmentRequested;

const isMatchingJudgmentResponseData = (
  data: SystemMessageData | UserMessageData,
  conclusion: string,
): boolean => 'comment' in data && data.comment === conclusion;

const assertResponseMatches = (
  response: {
    conversationId: string;
    projectId: string;
    type: string;
    userId: string;
    parentMessageId: string | null;
    data: unknown;
  },
  params: {
    projectId: ProjectId;
    userId: UserId;
  },
  context: JudgmentResponseContext,
): void => {
  if (
    response.conversationId !== context.conversationId ||
    response.projectId !== params.projectId ||
    response.type !== 'USER' ||
    response.userId !== params.userId ||
    response.parentMessageId !== context.command.judgment.requestMessageId ||
    !isJsonObject(response.data) ||
    response.data.comment !== context.command.judgment.conclusion
  ) {
    throw new BadRequestException(
      'The durable command is bound to a different canonical judgment response',
    );
  }
};

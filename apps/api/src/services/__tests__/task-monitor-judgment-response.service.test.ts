import { BadRequestException } from '@nestjs/common';
import type { TaskMonitorJudgmentResolvedCommand } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
  TaskId,
  UserId,
} from '../../types';
import { MessageService } from '../message.service';
import { TaskMonitorJudgmentResponseService } from '../task-monitor-judgment-response.service';

const ids = {
  organizationId: '10000000-0000-4000-8000-000000000001' as OrganizationId,
  projectId: '20000000-0000-4000-8000-000000000002' as ProjectId,
  monitorId: '30000000-0000-4000-8000-000000000003' as TaskId,
  userId: '40000000-0000-4000-8000-000000000004' as UserId,
  commandId: '50000000-0000-4000-8000-000000000005',
  requestMessageId:
    '60000000-0000-4000-8000-000000000006' as MessageId,
  conversationId:
    '70000000-0000-4000-8000-000000000007' as ConversationId,
};

const command = (): TaskMonitorJudgmentResolvedCommand => ({
  cause: 'JUDGMENT_RESOLVED',
  judgment: {
    requestMessageId: ids.requestMessageId,
    label: 'Your judgment',
    conclusion: 'Proceed with the safer behavior.',
  },
});

const requestMessage = (
  responses: Array<{
    id: string;
    type: string;
    userId: string;
    data: unknown;
  }> = [],
) => ({
  conversationId: ids.conversationId,
  data: {
    type: 'TASK_MONITOR_SUPERVISION',
    outcome: 'JUDGMENT_REQUESTED',
  },
  responses,
});

const validationParams = () => ({
  organizationId: ids.organizationId,
  projectId: ids.projectId,
  monitorId: ids.monitorId,
  userId: ids.userId,
  command: command(),
});

const createHarness = () => {
  const db = {
    message: { findFirst: jest.fn(), findUnique: jest.fn() },
    agentSessionWorkItemAssociation: { findFirst: jest.fn() },
  };
  const messageService = { addMessage: jest.fn() };
  const service = new TaskMonitorJudgmentResponseService(
    { db } as unknown as PrismaService,
    messageService as unknown as MessageService,
  );
  return { service, db, messageService };
};

const arrangeValidRequest = (harness: ReturnType<typeof createHarness>) => {
  harness.db.message.findFirst.mockResolvedValue(requestMessage());
  harness.db.agentSessionWorkItemAssociation.findFirst.mockResolvedValue({
    agentSession: { conversationId: ids.conversationId },
  });
};

describe('TaskMonitorJudgmentResponseService', () => {
  it.each([
    ['missing', null],
    [
      'wrongly typed',
      {
        ...requestMessage(),
        data: {
          type: 'TASK_MONITOR_SUPERVISION',
          outcome: 'ACCEPTED',
        },
      },
    ],
  ])('rejects a %s request Message', async (_label, value) => {
    const harness = createHarness();
    harness.db.message.findFirst.mockResolvedValue(value);

    await expect(
      harness.service.validateRequest(validationParams()),
    ).rejects.toThrow(
      'requestMessageId must identify a JUDGMENT_REQUESTED Message in this project',
    );
    expect(
      harness.db.agentSessionWorkItemAssociation.findFirst,
    ).not.toHaveBeenCalled();
  });

  it('resolves the request through the generated MessageId field', async () => {
    const harness = createHarness();
    arrangeValidRequest(harness);

    await harness.service.validateRequest(validationParams());

    expect(harness.db.message.findFirst).toHaveBeenCalledWith({
      where: {
        id: ids.requestMessageId,
        projectId: ids.projectId,
        type: 'SYSTEM',
        conversation: { organizationId: ids.organizationId },
      },
      select: {
        conversationId: true,
        data: true,
        responses: {
          select: { id: true, type: true, userId: true, data: true },
        },
      },
    });
  });

  it('rejects a request from another Task Monitor conversation', async () => {
    const harness = createHarness();
    harness.db.message.findFirst.mockResolvedValue(requestMessage());
    harness.db.agentSessionWorkItemAssociation.findFirst.mockResolvedValue({
      agentSession: {
        conversationId: '80000000-0000-4000-8000-000000000008',
      },
    });

    await expect(
      harness.service.validateRequest(validationParams()),
    ).rejects.toThrow(
      'requestMessageId does not belong to the addressed Task Monitor conversation',
    );
  });

  it('rejects more than one canonical response', async () => {
    const harness = createHarness();
    harness.db.message.findFirst.mockResolvedValue(
      requestMessage([
        {
          id: ids.commandId,
          type: 'USER',
          userId: ids.userId,
          data: { comment: command().judgment.conclusion },
        },
        {
          id: '80000000-0000-4000-8000-000000000008',
          type: 'USER',
          userId: ids.userId,
          data: { comment: command().judgment.conclusion },
        },
      ]),
    );
    harness.db.agentSessionWorkItemAssociation.findFirst.mockResolvedValue({
      agentSession: { conversationId: ids.conversationId },
    });

    await expect(
      harness.service.validateRequest(validationParams()),
    ).rejects.toThrow('The judgment request has more than one canonical response');
  });

  it('rejects a mismatched canonical response', async () => {
    const harness = createHarness();
    harness.db.message.findFirst.mockResolvedValue(
      requestMessage([
        {
          id: ids.commandId,
          type: 'USER',
          userId: ids.userId,
          data: { comment: 'A different judgment.' },
        },
      ]),
    );
    harness.db.agentSessionWorkItemAssociation.findFirst.mockResolvedValue({
      agentSession: { conversationId: ids.conversationId },
    });

    await expect(
      harness.service.validateRequest(validationParams()),
    ).rejects.toThrow(
      'The judgment request has already been answered with different content',
    );
  });

  it('persists one canonical parented USER reply', async () => {
    const harness = createHarness();
    arrangeValidRequest(harness);
    harness.db.message.findUnique.mockResolvedValue(null);
    harness.messageService.addMessage.mockResolvedValue({ id: ids.commandId });

    await harness.service.prepareAndEnsureResponse({
      commandId: ids.commandId,
      ...validationParams(),
    });

    expect(harness.messageService.addMessage).toHaveBeenCalledWith(
      {
        id: ids.commandId,
        projectId: ids.projectId,
        type: 'USER',
        userId: ids.userId,
        data: { comment: command().judgment.conclusion },
        conversationId: ids.conversationId,
        parentMessageId: ids.requestMessageId,
      },
      ids.organizationId,
      'task-monitor-command',
    );
  });

  it('repairs a partial retry by accepting an already persisted matching reply', async () => {
    const harness = createHarness();
    arrangeValidRequest(harness);
    harness.db.message.findUnique.mockResolvedValue({
      conversationId: ids.conversationId,
      projectId: ids.projectId,
      type: 'USER',
      userId: ids.userId,
      parentMessageId: ids.requestMessageId,
      data: { comment: command().judgment.conclusion },
    });

    await harness.service.prepareAndEnsureResponse({
      commandId: ids.commandId,
      ...validationParams(),
    });

    expect(harness.messageService.addMessage).not.toHaveBeenCalled();
  });

  it('accepts a matching reply created by a uniqueness race', async () => {
    const harness = createHarness();
    arrangeValidRequest(harness);
    harness.db.message.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        conversationId: ids.conversationId,
        projectId: ids.projectId,
        type: 'USER',
        userId: ids.userId,
        parentMessageId: ids.requestMessageId,
        data: { comment: command().judgment.conclusion },
      });
    harness.messageService.addMessage.mockRejectedValue(
      new Error('unique constraint'),
    );

    await harness.service.prepareAndEnsureResponse({
      commandId: ids.commandId,
      ...validationParams(),
    });

    expect(harness.db.message.findUnique).toHaveBeenCalledTimes(2);
  });

  it('rejects a replay bound to another durable response identity', async () => {
    const harness = createHarness();
    harness.db.message.findFirst.mockResolvedValue(
      requestMessage([
        {
          id: '80000000-0000-4000-8000-000000000008',
          type: 'USER',
          userId: ids.userId,
          data: { comment: command().judgment.conclusion },
        },
      ]),
    );
    harness.db.agentSessionWorkItemAssociation.findFirst.mockResolvedValue({
      agentSession: { conversationId: ids.conversationId },
    });

    await expect(
      harness.service.prepareAndEnsureResponse({
        commandId: ids.commandId,
        ...validationParams(),
      }),
    ).rejects.toThrow(BadRequestException);
    expect(harness.messageService.addMessage).not.toHaveBeenCalled();
  });

  it('replays a matching canonical response without adding another Message', async () => {
    const harness = createHarness();
    harness.db.message.findFirst.mockResolvedValue(
      requestMessage([
        {
          id: ids.commandId,
          type: 'USER',
          userId: ids.userId,
          data: { comment: command().judgment.conclusion },
        },
      ]),
    );
    harness.db.agentSessionWorkItemAssociation.findFirst.mockResolvedValue({
      agentSession: { conversationId: ids.conversationId },
    });

    await harness.service.prepareAndEnsureResponse({
      commandId: ids.commandId,
      ...validationParams(),
    });

    expect(harness.db.message.findUnique).not.toHaveBeenCalled();
    expect(harness.messageService.addMessage).not.toHaveBeenCalled();
  });
});

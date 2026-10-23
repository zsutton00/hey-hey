import { BadRequestException, ConflictException } from '@nestjs/common';
import { FlowExecutionStatus, Prisma } from '@prisma/client';
import {
  ConversationStatus,
  SystemMessageResponseType,
  WorkflowName,
} from '../../generated';
import { NodeType } from '../../types/flow-internal.types';
import { RepositoryImportReplyFormValidator } from '../repository-import-reply-form-validator';
import { RepositoryImportReplyService } from '../repository-import-reply.service';

describe('RepositoryImportReplyService', () => {
  const request = {
    parentMessageId: '11111111-1111-4111-8111-111111111111',
    expectedConversationVersion: 4,
    answers: { repository_action: { action: 'start' as const } },
  };

  const build = (workflowName: WorkflowName) => {
    const tx = {
      conversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'conversation-id',
          version: 4,
          workflowId: 'workflow-id',
          workflowName,
          workflowAboutId: 'project-id',
          workflowAboutType: 'project',
          status: ConversationStatus.InProgress,
        }),
      },
      flowExecution: { findFirst: jest.fn(), update: jest.fn() },
      message: { findFirst: jest.fn() },
    };
    const prisma = { $transaction: jest.fn((callback) => callback(tx)) };
    const messageService = { addMessageInTransaction: jest.fn() };
    const nodes = {
      getNode: jest
        .fn()
        .mockReturnValue({ node: { type: NodeType.QUESTIONS }, routing: {} }),
    };
    const service = new RepositoryImportReplyService(
      prisma as never,
      messageService as never,
      nodes as never,
      new RepositoryImportReplyFormValidator(),
    );
    return { service, tx, messageService, prisma };
  };

  const buildValid = () => {
    const fixture = build(WorkflowName.RepositoryImport);
    fixture.tx.flowExecution.findFirst.mockResolvedValue({
      id: 'execution-id',
      currentNode: 'import-form',
      flowId: WorkflowName.RepositoryImport,
      status: FlowExecutionStatus.IN_PROGRESS,
      flowState: {
        step: 'waiting_for_user_input',
        phase: 'waiting_for_user',
        nodeConfig: {},
        version: 1,
        context: {},
      },
    });
    fixture.tx.message.findFirst.mockResolvedValue({
      id: request.parentMessageId,
      data: {
        type: SystemMessageResponseType.Questions,
        nodeId: 'import-form',
        uiElements: [{ id: 'answer', type: 'text', required: true }],
      },
    });
    fixture.messageService.addMessageInTransaction.mockResolvedValue({
      id: 'reply',
    });
    const input = {
      organizationId: 'organization-id',
      projectId: 'project-id',
      conversationId: 'conversation-id',
      userId: 'user-id',
      request: { ...request, answers: { answer: 'yes' } },
    } as never;
    return { ...fixture, input };
  };

  it('admits a current unanswered form using the server version despite a stale client snapshot', async () => {
    const { service, tx, prisma, messageService, input } = buildValid();
    tx.conversation.findFirst.mockResolvedValueOnce({
      ...(await tx.conversation.findFirst()),
      version: 9,
    });
    await expect(service.admit(input)).resolves.toEqual({ id: 'reply' });
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(tx.flowExecution.update).toHaveBeenCalledWith({
      where: { id: 'execution-id', organizationId: 'organization-id' },
      data: { version: { increment: 1 } },
    });
    expect(messageService.addMessageInTransaction).toHaveBeenCalledWith(
      tx,
      expect.anything(),
      'organization-id',
      'repositoryImportReplyAdmission',
      expect.objectContaining({
        expectedConversationVersion: 9,
        suppressExecutableDelivery: true,
      }),
    );
  });

  it.each(['serialization', 'compare-and-swap'])(
    're-reads and revalidates after a %s conflict',
    async (kind) => {
      const { service, tx, messageService, input } = buildValid();
      const conflict =
        kind === 'serialization'
          ? new Prisma.PrismaClientKnownRequestError('write conflict', {
              code: 'P2034',
              clientVersion: 'test',
            })
          : new ConflictException('Conversation version is stale');
      messageService.addMessageInTransaction.mockRejectedValueOnce(conflict);
      await expect(service.admit(input)).resolves.toEqual({ id: 'reply' });
      expect(tx.flowExecution.findFirst).toHaveBeenCalledTimes(2);
      expect(tx.message.findFirst).toHaveBeenCalledTimes(2);
    },
  );

  it.each(['answered', 'advanced'])(
    'does not retry delivery when the form has %s',
    async (change) => {
      const { service, tx, messageService, input } = buildValid();
      messageService.addMessageInTransaction.mockImplementationOnce(
        async () => {
          if (change === 'answered')
            tx.message.findFirst.mockResolvedValue(null);
          else
            tx.flowExecution.findFirst.mockResolvedValue({
              currentNode: 'next-node',
              flowId: WorkflowName.RepositoryImport,
              status: FlowExecutionStatus.IN_PROGRESS,
            });
          throw new Prisma.PrismaClientKnownRequestError('write conflict', {
            code: 'P2034',
            clientVersion: 'test',
          });
        },
      );
      await expect(service.admit(input)).rejects.toThrow(
        'Reply parent is not the current repository import form',
      );
      expect(messageService.addMessageInTransaction).toHaveBeenCalledTimes(1);
      expect(tx.message.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ responses: { none: {} } }),
        }),
      );
    },
  );

  it('bounds contention retries and asks for a form refresh', async () => {
    const { service, prisma, messageService, input } = buildValid();
    messageService.addMessageInTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('write conflict', {
        code: 'P2034',
        clientVersion: 'test',
      }),
    );
    await expect(service.admit(input)).rejects.toThrow(
      'refresh the current form',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('preserves answer validation without retrying invalid input', async () => {
    const { service, tx, prisma, messageService, input } = buildValid();
    tx.message.findFirst.mockResolvedValue({
      id: request.parentMessageId,
      data: {
        type: SystemMessageResponseType.Questions,
        nodeId: 'import-form',
        uiElements: [{ id: 'required-field', type: 'text', required: true }],
      },
    });
    await expect(service.admit(input)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });

  it('rejects onboarding before persisting a reply', async () => {
    const { service, tx, messageService } = build(WorkflowName.Onboarding);
    tx.flowExecution.findFirst.mockResolvedValue({
      currentNode: 'onboarding-clarify-concept',
      flowId: WorkflowName.Onboarding,
      status: FlowExecutionStatus.IN_PROGRESS,
      flowState: { context: {} },
    });
    await expect(
      service.admit({
        organizationId: 'organization-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        userId: 'user-id',
        request,
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.message.findFirst).not.toHaveBeenCalled();
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });

  it('rejects a legacy onboarding execution without both import node and saved import state', async () => {
    const { service, tx, messageService } = build(WorkflowName.Onboarding);
    tx.flowExecution.findFirst.mockResolvedValue({
      currentNode: 'onboarding-repository-grounding-analysis',
      flowId: WorkflowName.Onboarding,
      status: FlowExecutionStatus.IN_PROGRESS,
      flowState: { context: {} },
    });
    await expect(
      service.admit({
        organizationId: 'organization-id',
        projectId: 'project-id',
        conversationId: 'conversation-id',
        userId: 'user-id',
        request,
      } as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(messageService.addMessageInTransaction).not.toHaveBeenCalled();
  });
});

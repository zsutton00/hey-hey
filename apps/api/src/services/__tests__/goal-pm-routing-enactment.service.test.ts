import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { GoalPmRoutingEnactmentService } from '../goal-pm-routing-enactment.service';
import { PrismaService } from '../../prisma/prisma.service';
import { MessageService } from '../message.service';
import { ConversationService } from '../conversation.service';
import { AgentSessionService } from '../agent-session.service';
import { GoalTracksService } from '../tasks/goal-tracks.service';
import { ProposalService } from '../proposal/proposal.service';
import type {
  GoalPmRoutingAnswer,
  GoalPmRoutingEnactmentRequest,
  GoalPmRoutingOption,
} from '../../generated';
import { testIds } from '../../utils/testUtils';

const option = {
  optionId: 'new',
  kind: 'startNewConversation' as const,
  title: 'Launch discussion',
  rationale: 'New topic',
  requiresConfirmation: true as const,
};
const input: GoalPmRoutingEnactmentRequest = {
  selection: {
    sourceMessageId: testIds.message,
    uiElementId: 'route',
    selectedOptionId: 'new',
  },
  pendingRequest: 'Discuss the launch',
  creation: {
    machineId: randomUUID(),
    provider: 'claude',
    config: {
      type: 'ENTITY_CONVERSATION',
      version: 'v1',
      model: 'selected-model',
    },
  },
};
describe('GoalPmRoutingEnactmentService', () => {
  let service: GoalPmRoutingEnactmentService;
  let stored: { id: string; data: Record<string, GoalPmRoutingAnswer> }[];
  const createConversation = jest.fn();
  const createSession = jest.fn();
  const addMessage = jest.fn();
  const updateAnswer = jest.fn();
  const createProposal = jest.fn();
  const source = {
    id: testIds.message,
    projectId: testIds.project,
    createdAt: new Date(),
    conversation: { workflowAboutId: testIds.task },
    data: {
      uiElements: [
        {
          id: 'route',
          type: 'goal_pm_action',
          payload: {
            goalId: testIds.task,
            options: [
              option,
              { ...option, optionId: 'other' },
            ] as GoalPmRoutingOption[],
          },
        },
      ],
    },
  };
  const tx = {
    $queryRaw: jest.fn(),
    message: { findFirst: jest.fn(), findMany: jest.fn() },
    task: { findFirst: jest.fn() },
    machine: { findFirst: jest.fn() },
    suggestionDecision: { findUnique: jest.fn() },
    agentOperation: { findFirst: jest.fn() },
    agentSession: { findFirst: jest.fn() },
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    stored = [];
    source.data.uiElements[0]!.payload.options = [
      option,
      { ...option, optionId: 'other' },
    ];
    tx.message.findFirst.mockResolvedValue(source);
    tx.message.findMany.mockImplementation(async () => stored);
    tx.task.findFirst.mockResolvedValue({ id: testIds.task });
    tx.machine.findFirst.mockResolvedValue({ id: input.creation!.machineId });
    createConversation.mockResolvedValue({ id: testIds.conversation });
    createSession.mockResolvedValue({ id: randomUUID() });
    addMessage.mockImplementation(async (_tx, message) => {
      const row = { id: randomUUID(), data: message.data };
      stored.push(row);
      return row;
    });
    const module = await Test.createTestingModule({
      providers: [
        GoalPmRoutingEnactmentService,
        {
          provide: PrismaService,
          useValue: {
            $transaction: (fn: (value: typeof tx) => Promise<unknown>) =>
              fn(tx),
          },
        },
        {
          provide: MessageService,
          useValue: {
            addMessageInTransaction: addMessage,
            updateFormAnswerInTransaction: updateAnswer,
          },
        },
        {
          provide: ConversationService,
          useValue: { createConversationInTransaction: createConversation },
        },
        {
          provide: AgentSessionService,
          useValue: { createInTransaction: createSession },
        },
        { provide: GoalTracksService, useValue: {} },
        {
          provide: ProposalService,
          useValue: { createWithReservedId: createProposal },
        },
      ],
    }).compile();
    service = module.get(GoalPmRoutingEnactmentService);
  });
  const enact = (request = input) =>
    service.enact(
      testIds.organization,
      testIds.conversation,
      testIds.user,
      request,
    );
  it('uses the existing destination and its stored machine settings without creating another session', async () => {
    source.data.uiElements[0]!.payload.options = [
      {
        kind: 'existingConversation',
        optionId: 'new',
        conversationId: testIds.conversation,
        title: 'Existing',
        rationale: 'Relevant',
        evidence: [
          {
            messageId: testIds.message,
            excerpt: 'Evidence',
            rationale: 'Same topic',
          },
        ],
      },
    ];
    tx.agentSession.findFirst.mockResolvedValue({
      id: randomUUID(),
      machineId: input.creation!.machineId,
      config: input.creation!.config,
      provider: 'claude',
      conversation: { title: 'Actual existing title' },
    });
    const result = await enact({
      selection: input.selection,
      pendingRequest: input.pendingRequest,
    });
    expect(result.answer.creation).toEqual(input.creation);
    expect(result.answer.outcome).toMatchObject({
      entityId: testIds.conversation,
      title: 'Actual existing title',
    });
    expect(createSession).not.toHaveBeenCalled();
  });
  it('recovers the original request after a refinement using its admitted operation identity', async () => {
    const prior = await enact();
    const refinement: GoalPmRoutingAnswer = {
      ...prior.answer,
      selectedOption: {
        kind: 'refineSearch',
        optionId: 'refine',
        title: 'Refine',
        rationale: 'Narrow results',
        prompt: 'Find customer threads',
      },
    };
    stored = [];
    tx.message.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([
      {
        id: 'refinement-input',
        data: {
          agentInput: {
            promptType: 'goal_pm',
            userMessage: 'Find customer threads',
          },
        },
      },
      { id: 'prior-answer', data: { route: refinement } },
    ]);
    tx.agentOperation.findFirst.mockResolvedValue({
      operationId: refinement.operationId,
    });
    const recovered = await enact({
      selection: input.selection,
      creation: input.creation,
    });
    expect(recovered.answer.pendingRequest).toBe('Discuss the launch');
  });
  it('recovers a first-message request stored as a plain comment', async () => {
    stored = [];
    tx.message.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 'first-input', data: { comment: 'Plan the launch' } },
      ]);
    const result = await enact({
      selection: input.selection,
      creation: input.creation,
    });
    expect(result.answer.pendingRequest).toBe('Plan the launch');
  });
  it('reserves one proposal identity across a committed proposal and interrupted answer update', async () => {
    source.data.uiElements[0]!.payload.options = [
      {
        kind: 'createMissingWork',
        optionId: 'new',
        title: 'Proposed task',
        rationale: 'Missing work',
        parentFeatureId: testIds.task,
        description: 'Deliver it',
        acceptanceCriteria: 'It works',
        workItemType: 'TASK',
        authoringMode: 'PROPOSAL',
        requiresSelection: true,
      },
    ];
    const pending = await enact();
    createProposal.mockResolvedValue({ id: pending.answer.operationId });
    updateAnswer.mockRejectedValueOnce(new Error('Answer update lost'));
    const context: Parameters<GoalPmRoutingEnactmentService['enactWork']>[5] = {
      userId: testIds.user,
      organizationId: testIds.organization,
      toolName: 'routing-test',
      timestamp: new Date().toISOString(),
      source: 'user',
    };
    const completeWork = () =>
      service.enactWork(
        testIds.organization,
        testIds.conversation,
        testIds.user,
        input.selection,
        null,
        context,
      );
    await expect(completeWork()).rejects.toThrow('Answer update lost');
    const recovered = await completeWork();
    expect(recovered.answer).toMatchObject({
      state: 'COMPLETED',
      outcome: { entityType: 'PROPOSAL', entityId: pending.answer.operationId },
    });
    expect(createProposal.mock.calls.map((call) => call[4])).toEqual([
      pending.answer.operationId,
      pending.answer.operationId,
    ]);
    expect(createConversation).not.toHaveBeenCalled();
  });
  it('persists the actual destination in a linked non-executable answer using the same transaction', async () => {
    const result = await enact();
    expect(result.answer.outcome).toEqual({
      entityType: 'CONVERSATION',
      entityId: testIds.conversation,
      agentSessionId: expect.any(String),
      title: option.title,
    });
    expect(result.answer.state).toBe('PENDING');
    expect(addMessage).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        type: 'USER',
        parentMessageId: testIds.message,
        conversationId: testIds.conversation,
        data: { route: result.answer },
      }),
      testIds.organization,
      'goal-pm-routing-answer',
      { suppressExecutableDelivery: true },
    );
    expect(createSession.mock.calls[0][0]).toBe(tx);
    expect(createConversation.mock.calls[0][0]).toBe(tx);
    expect(result.answer.pendingRequest).toBe('Discuss the launch');
  });
  it('recovers the same destination and operation after response loss without creation settings', async () => {
    const first = await enact();
    const recovered = await enact({ selection: input.selection });
    expect(recovered).toEqual(first);
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(addMessage).toHaveBeenCalledTimes(1);
  });
  it('rejects a conflicting selection and never replays a legacy record', async () => {
    await enact();
    await expect(
      enact({ selection: { ...input.selection, selectedOptionId: 'other' } }),
    ).rejects.toBeInstanceOf(ConflictException);
    stored = [];
    tx.suggestionDecision.findUnique.mockResolvedValue({ accepted: true });
    await expect(enact()).rejects.toThrow('historical choice');
    expect(createSession).toHaveBeenCalledTimes(1);
  });
  it('rejects unavailable source ownership before creating anything', async () => {
    tx.message.findFirst.mockResolvedValue(null);
    await expect(enact()).rejects.toBeInstanceOf(NotFoundException);
    expect(createConversation).not.toHaveBeenCalled();
  });
  it('never claims completion until the destination operation has succeeded', async () => {
    const result = await enact();
    await expect(
      service.complete(
        testIds.organization,
        testIds.conversation,
        testIds.user,
        input.selection,
      ),
    ).rejects.toThrow('authorized handoff');
    expect(updateAnswer).not.toHaveBeenCalled();
    tx.agentOperation.findFirst.mockResolvedValue({
      operationId: result.answer.operationId,
    });
    const completed = await service.complete(
      testIds.organization,
      testIds.conversation,
      testIds.user,
      input.selection,
    );
    expect(completed.answer.state).toBe('COMPLETED');
    expect(tx.agentOperation.findFirst).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        operationId: result.answer.operationId,
        conversationId: result.answer.outcome!.entityId,
        agentSessionId: result.answer.outcome!.agentSessionId,
        state: 'SUCCEEDED',
      }),
    });
  });
});

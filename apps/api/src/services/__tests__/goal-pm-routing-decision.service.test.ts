import { Test } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, SuggestionDecision } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GoalPmRoutingDecisionService,
  GOAL_PM_ROUTING_DECISION_TYPE,
} from '../goal-pm-routing-decision.service';
import { GoalPmRoutingDecisionController } from '../../controllers/goal-pm-routing-decision.controller';
import { testIds } from '../../utils/testUtils';

const option = {
  optionId: 'new',
  kind: 'startNewConversation',
  title: 'New thread',
  rationale: 'Distinct topic',
  requiresConfirmation: true,
};
const input = {
  sourceMessageId: testIds.message,
  uiElementId: 'routing',
  selectedOptionId: 'new',
};
type Insert = Prisma.SuggestionDecisionCreateManyInput;
describe('GoalPmRoutingDecisionService', () => {
  let service: GoalPmRoutingDecisionService;
  let stored: SuggestionDecision | null;
  const findFirst = jest.fn();
  const createMany = jest.fn();
  const findUniqueOrThrow = jest.fn();
  const tx = {
    message: { findFirst },
    suggestionDecision: { createMany, findUniqueOrThrow },
  };
  beforeEach(async () => {
    jest.resetAllMocks();
    stored = null;
    findFirst.mockResolvedValue({
      id: testIds.message,
      data: {
        uiElements: [
          {
            id: 'routing',
            type: 'goal_pm_action',
            payload: {
              goalId: testIds.task,
              options: [option, { ...option, optionId: 'another' }],
            },
          },
        ],
      },
    });
    createMany.mockImplementation(async ({ data }: { data: Insert[] }) => {
      const row = data[0];
      if (!row) throw new Error('Missing insert');
      if (!stored)
        stored = {
          organizationId: row.organizationId,
          type: row.type,
          suggestionId: row.suggestionId,
          accepted: row.accepted,
          decidedBy: testIds.user,
          sourceConversationId: testIds.conversation,
          sourceMessageId: testIds.message,
          createdAt: new Date(),
          metadata: JSON.parse(JSON.stringify(row.metadata)),
        };
      return { count: 1 };
    });
    findUniqueOrThrow.mockImplementation(async () => stored);
    const module = await Test.createTestingModule({
      providers: [
        GoalPmRoutingDecisionService,
        {
          provide: PrismaService,
          useValue: {
            db: {
              $transaction: async (
                callback: (client: typeof tx) => Promise<unknown>,
              ) => callback(tx),
            },
          },
        },
      ],
    }).compile();
    service = module.get(GoalPmRoutingDecisionService);
  });
  const record = () =>
    service.record(
      testIds.organization,
      testIds.conversation,
      testIds.user,
      input,
    );
  it('authorizes the canonical message and atomically inserts the resolved option without execution dependencies', async () => {
    const result = await record();
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        id: testIds.message,
        conversationId: testIds.conversation,
        type: 'SYSTEM',
        conversation: { organizationId: testIds.organization },
      },
    });
    expect(result.selectedOption).toEqual(option);
    expect(result.uiElementId).toBe('routing');
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [
          expect.objectContaining({
            type: GOAL_PM_ROUTING_DECISION_TYPE,
            suggestionId: testIds.message + ':routing',
            accepted: true,
          }),
        ],
      }),
    );
    expect(Object.keys(tx)).toEqual(['message', 'suggestionDecision']);
  });
  it('returns the original decision for repeated and overlapping identical requests', async () => {
    const first = await record();
    expect(await Promise.all([record(), record()])).toEqual([first, first]);
  });
  it('conflicts without replacing the original choice', async () => {
    const first = await record();
    await expect(
      service.record(testIds.organization, testIds.conversation, testIds.user, {
        ...input,
        selectedOptionId: 'another',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await record()).toEqual(first);
  });
  it.each(['promptType', 'workflowName', 'triggersAgent'])(
    'rejects the extra execution field %s before persistence',
    async (key) => {
      await expect(
        service.record(
          testIds.organization,
          testIds.conversation,
          testIds.user,
          { ...input, [key]: 'forbidden' },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMany).not.toHaveBeenCalled();
    },
  );
  it('rejects an inaccessible or non-canonical message', async () => {
    findFirst.mockResolvedValue(null);
    await expect(record()).rejects.toBeInstanceOf(NotFoundException);
    expect(createMany).not.toHaveBeenCalled();
  });
  it.each([{ uiElementId: 'missing' }, { selectedOptionId: 'missing' }])(
    'rejects identities not offered by the canonical message',
    async (change) => {
      await expect(
        service.record(
          testIds.organization,
          testIds.conversation,
          testIds.user,
          { ...input, ...change },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(createMany).not.toHaveBeenCalled();
    },
  );
  it('propagates persistence failure without returning a resolved outcome', async () => {
    createMany.mockRejectedValue(new Error('storage unavailable'));
    await expect(record()).rejects.toThrow('storage unavailable');
    expect(findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('requires a user before the controller invokes recording', () => {
    const controller = new GoalPmRoutingDecisionController(service);
    expect(() =>
      controller.recordGoalPmRoutingDecision(
        testIds.organization,
        undefined,
        testIds.conversation,
        input,
      ),
    ).toThrow();
    expect(findFirst).not.toHaveBeenCalled();
  });
});

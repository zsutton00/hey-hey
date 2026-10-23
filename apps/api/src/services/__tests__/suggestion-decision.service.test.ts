import { Test, TestingModule } from '@nestjs/testing';
import { SuggestionDecisionService } from '../suggestion-decision.service';
import { PrismaService } from '../../prisma/prisma.service';
import { testIds } from '../../utils/testUtils';

describe('SuggestionDecisionService', () => {
  let service: SuggestionDecisionService;
  let prisma: jest.Mocked<PrismaService>;

  beforeEach(async () => {
    const prismaMock = {
      db: {
        suggestionDecision: {
          findUnique: jest.fn(),
          findMany: jest.fn(),
          upsert: jest.fn(),
        },
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SuggestionDecisionService,
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    service = module.get(SuggestionDecisionService);
    prisma = module.get(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns none when no decision exists', async () => {
    (prisma.db.suggestionDecision.findUnique as jest.Mock).mockResolvedValue(
      null,
    );

    const result = await service.getDecision(
      testIds.organization,
      'task_generation_generate',
      'msg-123',
    );

    expect(result.accepted).toBeNull();
  });

  it('returns stored decision when found', async () => {
    const now = new Date();
    (prisma.db.suggestionDecision.findUnique as jest.Mock).mockResolvedValue({
      organizationId: testIds.organization,
      suggestionId: 'msg-456',
      type: 'task_generation_generate',
      accepted: true,
      decidedBy: testIds.user,
      sourceConversationId: testIds.conversation,
      sourceMessageId: testIds.message,
      metadata: { kind: 'CREATE_SUGGESTED_TASK', workflowId: 'wf-123' },
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.getDecision(
      testIds.organization,
      'task_generation_generate',
      'msg-456',
    );

    expect(result.accepted).toBe(true);
    expect(result.decidedBy).toBe(testIds.user);
    expect(result.sourceConversationId).toBe(testIds.conversation);
    expect(result.sourceMessageId).toBe(testIds.message);
    expect(result.metadata).toEqual({
      kind: 'CREATE_SUGGESTED_TASK',
      workflowId: 'wf-123',
    });
  });

  it('upserts a new decision', async () => {
    const now = new Date();
    (prisma.db.suggestionDecision.upsert as jest.Mock).mockResolvedValue({
      organizationId: testIds.organization,
      suggestionId: 'msg-789',
      type: 'task_generation_generate',
      accepted: false,
      decidedBy: null,
      sourceConversationId: testIds.conversation,
      sourceMessageId: testIds.message,
      metadata: {
        kind: 'PROPOSED_INITIATIVE',
        initiativeId: testIds.initiative,
      },
      createdAt: now,
      updatedAt: now,
    });

    const result = await service.recordDecision({
      organizationId: testIds.organization,
      // @ts-expect-error for test
      type: ' task_generation_generate ', // ensure trimming occurs
      suggestionId: ' msg-789 ',
      accepted: false,
      sourceConversationId: testIds.conversation,
      sourceMessageId: testIds.message,
      metadata: {
        kind: 'PROPOSED_INITIATIVE',
        initiativeId: testIds.initiative,
      },
    });

    expect(prisma.db.suggestionDecision.upsert).toHaveBeenCalledWith({
      where: {
        organizationId_type_suggestionId: {
          organizationId: testIds.organization,
          type: 'task_generation_generate',
          suggestionId: 'msg-789',
        },
      },
      create: {
        organizationId: testIds.organization,
        type: 'task_generation_generate',
        suggestionId: 'msg-789',
        accepted: false,
        decidedBy: null,
        sourceConversationId: testIds.conversation,
        sourceMessageId: testIds.message,
        metadata: {
          kind: 'PROPOSED_INITIATIVE',
          initiativeId: testIds.initiative,
        },
      },
      update: {
        accepted: false,
        decidedBy: null,
        sourceConversationId: testIds.conversation,
        sourceMessageId: testIds.message,
        metadata: {
          kind: 'PROPOSED_INITIATIVE',
          initiativeId: testIds.initiative,
        },
      },
    });

    expect(result.accepted).toBe(false);
    expect(result.metadata).toEqual({
      kind: 'PROPOSED_INITIATIVE',
      initiativeId: testIds.initiative,
    });
  });

  it('lists decisions by source conversation and message', async () => {
    const now = new Date();
    (prisma.db.suggestionDecision.findMany as jest.Mock).mockResolvedValue([
      {
        organizationId: testIds.organization,
        suggestionId: 'msg-111',
        type: 'task_stub_generation_generate',
        accepted: true,
        decidedBy: testIds.user,
        sourceConversationId: testIds.conversation,
        sourceMessageId: testIds.message,
        metadata: { kind: 'CREATE_SUGGESTED_TASK', workflowId: 'wf-1' },
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const result = await service.listDecisions({
      organizationId: testIds.organization,
      sourceConversationId: testIds.conversation,
      sourceMessageId: testIds.message,
    });

    expect(prisma.db.suggestionDecision.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: testIds.organization,
        type: { not: 'goal_pm_routing_decision' },
        sourceConversationId: testIds.conversation,
        sourceMessageId: testIds.message,
      },
      orderBy: [{ createdAt: 'desc' }, { suggestionId: 'asc' }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 'msg-111',
      type: 'task_stub_generation_generate',
      accepted: true,
      sourceConversationId: testIds.conversation,
      sourceMessageId: testIds.message,
    });
  });
});

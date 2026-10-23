import { randomUUID } from 'node:crypto';
import { AgentSessionType, Prisma } from '@prisma/client';
import { AgentSessionListSort } from '../../generated';
import { PrismaService } from '../../prisma/prisma.service';
import { EVENT_TYPES } from '../../core/events/types/event.types';
import type { MessageUpdatedEvent } from '../../generated';
import type {
  ConversationId,
  MessageId,
  OrganizationId,
  ProjectId,
} from '../../types';
import { AgentSessionService } from '../agent-session.service';
import { MessageService } from '../message.service';

const describeDatabase =
  process.env.RUN_AGENT_SESSION_ACTIVITY_ORDERING_DB_TESTS === '1' &&
  process.env.PROJECT_DATABASE_URL
    ? describe
    : describe.skip;

describeDatabase('Agent session message activity ordering PostgreSQL', () => {
  let prisma: PrismaService;
  let agentSessionService: AgentSessionService;
  let messageService: MessageService;
  let publishInTransaction: jest.Mock;
  const fixtures: Array<{
    userId: string;
    organizationId: string;
    projectId: string;
    conversationIds: string[];
    sessionIds: string[];
  }> = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.$connect();

    publishInTransaction = jest.fn().mockResolvedValue(null);
    const eventPublisher = { publishInTransaction };
    agentSessionService = new AgentSessionService(
      prisma,
      eventPublisher as any,
      {} as any,
      {} as any,
      {
        loadReportsForMessageIds: jest.fn().mockResolvedValue(new Map()),
      } as any,
    );
    messageService = new MessageService(
      prisma,
      eventPublisher as any,
      {} as any,
      { extractMentionTokens: jest.fn().mockReturnValue([]) } as any,
      {} as any,
    );
  });

  afterEach(async () => {
    for (const fixture of fixtures.splice(0)) {
      await prisma.db.message.deleteMany({
        where: { conversationId: { in: fixture.conversationIds } },
      });
      await prisma.db.agentSession.deleteMany({
        where: { id: { in: fixture.sessionIds } },
      });
      await prisma.db.conversation.deleteMany({
        where: { id: { in: fixture.conversationIds } },
      });
      await prisma.db.project.deleteMany({ where: { id: fixture.projectId } });
      await prisma.db.organizationMember.deleteMany({
        where: { organizationId: fixture.organizationId },
      });
      await prisma.db.organization.deleteMany({
        where: { id: fixture.organizationId },
      });
      await prisma.db.user.deleteMany({ where: { id: fixture.userId } });
    }
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // Mirrors MessageProcessor.advanceContentUpdatedAtOnContentChange for the
  // message.updated events published since the last call.
  const processPublishedMessageUpdates = async (
    organizationId: string,
  ): Promise<void> => {
    const events = publishInTransaction.mock.calls
      .map(([, event]) => event as MessageUpdatedEvent)
      .filter((event) => event.type === EVENT_TYPES.MESSAGE.UPDATED);
    publishInTransaction.mockClear();
    for (const event of events) {
      if (event.payload.update.contentChanged) {
        await messageService.advanceContentUpdatedAt(
          event.aggregateId as MessageId,
          organizationId as OrganizationId,
        );
      }
    }
  };

  const createSessionFixture = async (sessionCount: number) => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const conversationIds = Array.from({ length: sessionCount }, () =>
      randomUUID(),
    );
    const sessionIds = Array.from({ length: sessionCount }, () => randomUUID());
    fixtures.push({
      userId,
      organizationId,
      projectId,
      conversationIds,
      sessionIds,
    });

    await prisma.db.user.create({
      data: {
        id: userId,
        email: `agent-session-activity-${randomUUID()}@example.com`,
        name: 'Agent Session Activity Integration User',
        passwordHash: 'integration-test-password-hash',
      },
    });
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: `Agent Session Activity ${randomUUID()}`,
        slug: `agent-session-activity-${randomUUID()}`,
      },
    });
    await prisma.db.organizationMember.create({
      data: { userId, organizationId },
    });
    await prisma.db.project.create({
      data: {
        id: projectId,
        name: 'Agent Session Activity Integration Project',
        organizationId,
        status: 'ACTIVE',
      },
    });
    await prisma.db.conversation.createMany({
      data: conversationIds.map((id) => ({
        id,
        organizationId,
        projectId,
        title: 'Entity Conversation activity ordering',
        initiatedBy: 'USER' as const,
        status: 'STARTED' as const,
        version: 1,
      })),
    });
    await prisma.db.agentSession.createMany({
      data: sessionIds.map((id, index) => ({
        id,
        organizationId,
        userId,
        projectId,
        sessionDate: new Date(),
        title: 'Entity Conversation activity ordering',
        type: AgentSessionType.ENTITY_CONVERSATION,
        status: 'IN_PROGRESS' as const,
        conversationId: conversationIds[index],
      })),
    });

    return { userId, organizationId, projectId, conversationIds, sessionIds };
  };

  const listFirstPage = (
    organizationId: string,
    projectId: string,
    limit = 1,
  ) =>
    agentSessionService.findPaginated(
      organizationId as OrganizationId,
      projectId as ProjectId,
      {
        type: AgentSessionType.ENTITY_CONVERSATION,
        statuses: [],
        sort: AgentSessionListSort.LastMessage,
        limit,
      },
    );

  it('orders an updated interstitial first and continues from that activity position', async () => {
    const userId = randomUUID();
    const organizationId = randomUUID();
    const projectId = randomUUID();
    const olderConversationId = randomUUID();
    const newerConversationId = randomUUID();
    const olderSessionId = randomUUID();
    const newerSessionId = randomUUID();
    const fixture = {
      userId,
      organizationId,
      projectId,
      conversationIds: [olderConversationId, newerConversationId],
      sessionIds: [olderSessionId, newerSessionId],
    };
    fixtures.push(fixture);

    await prisma.db.user.create({
      data: {
        id: userId,
        email: `agent-session-activity-${randomUUID()}@example.com`,
        name: 'Agent Session Activity Integration User',
        passwordHash: 'integration-test-password-hash',
      },
    });
    await prisma.db.organization.create({
      data: {
        id: organizationId,
        name: `Agent Session Activity ${randomUUID()}`,
        slug: `agent-session-activity-${randomUUID()}`,
      },
    });
    await prisma.db.organizationMember.create({
      data: { userId, organizationId },
    });
    await prisma.db.project.create({
      data: {
        id: projectId,
        name: 'Agent Session Activity Integration Project',
        organizationId,
        status: 'ACTIVE',
      },
    });

    await prisma.db.conversation.createMany({
      data: [olderConversationId, newerConversationId].map((id) => ({
        id,
        organizationId,
        projectId,
        title: 'Entity Conversation activity ordering',
        initiatedBy: 'USER' as const,
        status: 'STARTED' as const,
        version: 1,
      })),
    });
    await prisma.db.agentSession.createMany({
      data: [
        { id: olderSessionId, conversationId: olderConversationId },
        { id: newerSessionId, conversationId: newerConversationId },
      ].map(({ id, conversationId }) => ({
        id,
        organizationId,
        userId,
        projectId,
        sessionDate: new Date(),
        title: 'Entity Conversation activity ordering',
        type: AgentSessionType.ENTITY_CONVERSATION,
        status: 'IN_PROGRESS' as const,
        conversationId,
      })),
    });

    const now = Date.now();
    const olderActivityCreatedAt = new Date(now - 120_000);
    const newerMessageCreatedAt = new Date(now - 60_000);
    const olderUserMessageId = randomUUID();
    const olderInterstitialMessageId = randomUUID();
    const newerUserMessageId = randomUUID();
    const newerSystemMessageId = randomUUID();
    const messages = [
      {
        id: olderUserMessageId,
        conversationId: olderConversationId,
        type: 'USER' as const,
        userId,
        createdAt: new Date(olderActivityCreatedAt.getTime() - 1_000),
        data: { text: 'Discuss the feature' },
      },
      {
        id: olderInterstitialMessageId,
        conversationId: olderConversationId,
        type: 'SYSTEM' as const,
        userId: 'system',
        createdAt: olderActivityCreatedAt,
        data: { type: 'ANALYSIS', response: 'Initial narration' },
      },
      {
        id: newerUserMessageId,
        conversationId: newerConversationId,
        type: 'USER' as const,
        userId,
        createdAt: new Date(newerMessageCreatedAt.getTime() - 1_000),
        data: { text: 'Discuss another feature' },
      },
      {
        id: newerSystemMessageId,
        conversationId: newerConversationId,
        type: 'SYSTEM' as const,
        userId: 'system',
        createdAt: newerMessageCreatedAt,
        data: { type: 'ANALYSIS', response: 'Newer conversation' },
      },
    ];
    await prisma.db.message.createMany({
      data: messages.map((message) => ({
        ...message,
        contentUpdatedAt: message.createdAt,
        projectId,
        status: 'open',
        data: message.data as Prisma.InputJsonValue,
      })),
    });

    const beforeUpdate = await agentSessionService.findPaginated(
      organizationId as OrganizationId,
      projectId as ProjectId,
      {
        type: AgentSessionType.ENTITY_CONVERSATION,
        statuses: [],
        sort: AgentSessionListSort.LastMessage,
        limit: 1,
      },
    );
    expect(beforeUpdate.items[0]?.agentSession.id).toBe(newerSessionId);

    await messageService.updateMessage(
      olderInterstitialMessageId,
      organizationId as OrganizationId,
      { data: { type: 'ANALYSIS', response: 'Updated narration' } },
      {
        source: 'activity-ordering-integration-test',
        suppressConversationEvent: true,
      },
    );
    await processPublishedMessageUpdates(organizationId);

    const firstPage = await agentSessionService.findPaginated(
      organizationId as OrganizationId,
      projectId as ProjectId,
      {
        type: AgentSessionType.ENTITY_CONVERSATION,
        statuses: [],
        sort: AgentSessionListSort.LastMessage,
        limit: 1,
      },
    );

    expect(firstPage.items[0]?.agentSession.id).toBe(olderSessionId);
    expect(firstPage.items[0]?.lastMessage).toEqual(
      expect.objectContaining({
        id: olderInterstitialMessageId,
        createdAt: olderActivityCreatedAt.toISOString(),
      }),
    );
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await agentSessionService.findPaginated(
      organizationId as OrganizationId,
      projectId as ProjectId,
      {
        type: AgentSessionType.ENTITY_CONVERSATION,
        statuses: [],
        sort: AgentSessionListSort.LastMessage,
        limit: 1,
        cursor: firstPage.nextCursor!,
      },
    );

    expect(secondPage.items.map((item) => item.agentSession.id)).toEqual([
      newerSessionId,
    ]);
    expect(secondPage.items[0]?.lastMessage?.id).toBe(newerSystemMessageId);
  });

  it('ignores an execution-status projection on an older USER message that lands after a newer agent reply', async () => {
    const { userId, organizationId, projectId, conversationIds, sessionIds } =
      await createSessionFixture(2);
    const [bookkeepingConversationId, middleConversationId] =
      conversationIds as [string, string];
    const [bookkeepingSessionId, middleSessionId] = sessionIds as [
      string,
      string,
    ];

    const now = Date.now();
    const userInputCreatedAt = new Date(now - 180_000);
    const middleCreatedAt = new Date(now - 120_000);
    const agentReplyCreatedAt = new Date(now - 60_000);
    const olderUserMessageId = randomUUID();
    const agentReplyMessageId = randomUUID();
    const middleMessageId = randomUUID();
    await prisma.db.message.createMany({
      data: [
        {
          id: olderUserMessageId,
          conversationId: bookkeepingConversationId,
          type: 'USER' as const,
          userId,
          createdAt: userInputCreatedAt,
          data: { text: 'Review this change' },
        },
        {
          id: middleMessageId,
          conversationId: middleConversationId,
          type: 'USER' as const,
          userId,
          createdAt: middleCreatedAt,
          data: { text: 'Another conversation' },
        },
        {
          id: agentReplyMessageId,
          conversationId: bookkeepingConversationId,
          type: 'SYSTEM' as const,
          userId: 'system',
          createdAt: agentReplyCreatedAt,
          data: { type: 'ANALYSIS', response: 'Review complete' },
        },
      ].map((message) => ({
        ...message,
        contentUpdatedAt: message.createdAt,
        projectId,
        status: 'open',
        data: message.data as Prisma.InputJsonValue,
      })),
    });

    const before = await listFirstPage(organizationId, projectId, 2);
    expect(before.items.map((item) => item.agentSession.id)).toEqual([
      bookkeepingSessionId,
      middleSessionId,
    ]);
    expect(before.items[0]?.lastMessage?.id).toBe(agentReplyMessageId);

    // Same write shape as InputExecutionProjectionService.project.
    await prisma.db.$transaction(async (tx) => {
      await tx.message.update({
        where: { id: olderUserMessageId },
        data: { executionStatus: 'started', executionRevision: 2 },
      });
      await messageService.publishMessageUpdatedEvent(tx, {
        messageId: olderUserMessageId as MessageId,
        organizationId: organizationId as OrganizationId,
        projectId: projectId as ProjectId,
        conversationId: bookkeepingConversationId as ConversationId,
        update: {},
      });
    });
    await processPublishedMessageUpdates(organizationId);

    const after = await listFirstPage(organizationId, projectId, 2);
    expect(after.items.map((item) => item.agentSession.id)).toEqual([
      bookkeepingSessionId,
      middleSessionId,
    ]);
    expect(after.items[0]?.lastMessage).toEqual(
      expect.objectContaining({
        id: agentReplyMessageId,
        createdAt: agentReplyCreatedAt.toISOString(),
      }),
    );
    const projected = await prisma.db.message.findUniqueOrThrow({
      where: { id: olderUserMessageId },
      select: { contentUpdatedAt: true },
    });
    expect(projected.contentUpdatedAt).toEqual(userInputCreatedAt);
  });
});

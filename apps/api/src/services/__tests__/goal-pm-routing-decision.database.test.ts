import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  GoalPmRoutingDecisionService,
  mapGoalPmRoutingDecision,
} from '../goal-pm-routing-decision.service';
import { testIds } from '../../utils/testUtils';

// Uses isolated fixture rows only. Opt in against a local test database with the current schema.
const database = process.env.PROJECT_DATABASE_URL;
const enabled =
  process.env.RUN_GOAL_PM_DECISION_DB_TESTS === '1' &&
  database &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname);
const describeDatabase = enabled ? describe : describe.skip;

describeDatabase('routing decision database guarantees', () => {
  const prisma = new PrismaService();
  const service = new GoalPmRoutingDecisionService(prisma);
  let organization: Awaited<ReturnType<typeof prisma.db.organization.create>>;
  let project: Awaited<ReturnType<typeof prisma.db.project.create>>;
  let conversation: Awaited<ReturnType<typeof prisma.db.conversation.create>>;
  let message: Awaited<ReturnType<typeof prisma.db.message.create>>;
  const option = {
    optionId: 'first',
    kind: 'startNewConversation',
    title: 'New thread',
    rationale: 'New topic',
    requiresConfirmation: true,
  };
  beforeAll(async () => {
    organization = await prisma.db.organization.create({
      data: {
        name: 'Routing decision test',
        slug: `routing-decision-test-${randomUUID()}`,
      },
    });
    project = await prisma.db.project.create({
      data: { organizationId: organization.id, name: 'Routing decision test' },
    });
    conversation = await prisma.db.conversation.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        initiatedBy: 'USER',
      },
    });
    message = await prisma.db.message.create({
      data: {
        conversationId: conversation.id,
        projectId: project.id,
        userId: 'system',
        type: 'SYSTEM',
        data: {
          uiElements: [
            {
              id: 'routing',
              type: 'goal_pm_action',
              payload: {
                goalId: testIds.task,
                options: [option, { ...option, optionId: 'second' }],
              },
            },
          ],
        },
      },
    });
  });
  afterAll(async () => {
    if (organization) {
      await prisma.db.suggestionDecision.deleteMany({
        where: { organizationId: organization.id },
      });
      if (conversation)
        await prisma.db.message.deleteMany({
          where: { conversationId: conversation.id },
        });
      await prisma.db.conversation.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.project.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.organization.delete({ where: { id: organization.id } });
    }
    await prisma.$disconnect();
  });
  const record = (selectedOptionId = 'first') =>
    service.record(organization.id, conversation.id, testIds.user, {
      sourceMessageId: message.id,
      uiElementId: 'routing',
      selectedOptionId,
    });
  beforeEach(async () => {
    await prisma.db.suggestionDecision.deleteMany({
      where: { organizationId: organization.id },
    });
  });
  it('persists exactly one outcome under concurrent identical retries', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => record()),
    );
    expect(
      outcomes.every(
        (value) => JSON.stringify(value) === JSON.stringify(outcomes[0]),
      ),
    ).toBe(true);
    expect(
      await prisma.db.suggestionDecision.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(1);
    expect(
      await prisma.db.message.count({
        where: { conversationId: conversation.id },
      }),
    ).toBe(1);
  });
  it('rejects replacement and reloads the original canonical option', async () => {
    await record();
    await expect(record('second')).rejects.toThrow('already resolved');
    const reloaded = await prisma.db.conversation.findUniqueOrThrow({
      where: { id: conversation.id },
      include: { suggestionDecisions: true },
    });
    expect(reloaded.suggestionDecisions).toHaveLength(1);
    const stored = reloaded.suggestionDecisions[0];
    if (!stored) throw new Error('Missing persisted decision');
    expect(mapGoalPmRoutingDecision(stored).selectedOption).toEqual(option);
    expect(await record()).toEqual(mapGoalPmRoutingDecision(stored));
  });
  it('does not allow another organization to resolve the source', async () => {
    await expect(
      service.record(testIds.organization, conversation.id, testIds.user, {
        sourceMessageId: message.id,
        uiElementId: 'routing',
        selectedOptionId: 'first',
      }),
    ).rejects.toThrow('not found');
  });
  it('arbitrates different concurrent choices without overwriting either outcome', async () => {
    const results = await Promise.allSettled([
      record('first'),
      record('second'),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await prisma.db.suggestionDecision.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(1);
  });
});

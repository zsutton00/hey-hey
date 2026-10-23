import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { GoalPmRoutingEnactmentService } from '../goal-pm-routing-enactment.service';
import { MessageService } from '../message.service';
import { ConversationService } from '../conversation.service';
import { AgentSessionService } from '../agent-session.service';
import { GoalTracksService } from '../tasks/goal-tracks.service';
import { ProposalService } from '../proposal/proposal.service';
import type { GoalPmRoutingEnactmentRequest } from '../../generated';

// Explicit opt-in and local host only; every write belongs to isolated fixtures.
const database = process.env.PROJECT_DATABASE_URL;
const enabled =
  process.env.RUN_GOAL_PM_ENACTMENT_DB_TESTS === '1' &&
  database &&
  ['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname);
const describeDatabase = enabled ? describe : describe.skip;
type Tx = Prisma.TransactionClient;

describeDatabase('Goal PM enactment database guarantees', () => {
  const prisma = new PrismaService();
  let service: GoalPmRoutingEnactmentService;
  let organization: Awaited<ReturnType<typeof prisma.db.organization.create>>;
  let project: Awaited<ReturnType<typeof prisma.db.project.create>>;
  let user: Awaited<ReturnType<typeof prisma.db.user.create>>;
  let source: Awaited<ReturnType<typeof prisma.db.conversation.create>>;
  let input: GoalPmRoutingEnactmentRequest;
  let failAnswer = false;
  const option = {
    optionId: 'new',
    kind: 'startNewConversation' as const,
    title: 'New discussion',
    rationale: 'A new topic',
    requiresConfirmation: true as const,
  };
  beforeAll(async () => {
    organization = await prisma.db.organization.create({
      data: {
        name: 'Routing transaction test',
        slug: `routing-${randomUUID()}`,
      },
    });
    project = await prisma.db.project.create({
      data: { organizationId: organization.id, name: 'Routing test' },
    });
    user = await prisma.db.user.create({
      data: {
        name: 'Routing test',
        email: `${randomUUID()}@example.invalid`,
        passwordHash: 'not-a-login',
      },
    });
    const goal = await prisma.db.task.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        name: 'Goal',
        type: 'GOAL',
      },
    });
    const machine = await prisma.db.machine.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        name: 'Fixture machine',
        publicKey: 'fixture',
        tokenHash: randomUUID(),
      },
    });
    source = await prisma.db.conversation.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        initiatedBy: 'USER',
        workflowName: 'goal-pm',
        workflowAboutType: 'task',
        workflowAboutId: goal.id,
      },
    });
    await prisma.db.agentSession.create({
      data: {
        organizationId: organization.id,
        projectId: project.id,
        userId: user.id,
        conversationId: source.id,
        title: 'Goal PM',
        sessionDate: new Date(),
        type: 'ENTITY_CONVERSATION',
        machineId: machine.id,
      },
    });
    const message = await prisma.db.message.create({
      data: {
        conversationId: source.id,
        projectId: project.id,
        userId: 'system',
        type: 'SYSTEM',
        data: {
          uiElements: [
            {
              id: 'route',
              type: 'goal_pm_action',
              payload: {
                goalId: goal.id,
                options: [option, { ...option, optionId: 'other' }],
              },
            },
          ],
        },
      },
    });
    input = {
      selection: {
        sourceMessageId: message.id,
        uiElementId: 'route',
        selectedOptionId: 'new',
      },
      pendingRequest: 'Discuss this goal',
      creation: {
        machineId: machine.id,
        provider: 'claude',
        config: {
          type: 'ENTITY_CONVERSATION',
          version: 'v1',
          model: 'test-model',
        },
      },
    };
    // Exercise the actual orchestration and PostgreSQL lock/rollback. The helper
    // adapters retain their production transaction signatures but omit outbox effects.
    const module = await Test.createTestingModule({
      providers: [
        GoalPmRoutingEnactmentService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConversationService,
          useValue: {
            createConversationInTransaction: (
              tx: Tx,
              {
                context: _context,
                ...data
              }: Prisma.ConversationUncheckedCreateInput & {
                context?: unknown;
              },
            ) => tx.conversation.create({ data }),
          },
        },
        {
          provide: AgentSessionService,
          useValue: {
            createInTransaction: (
              tx: Tx,
              data: Prisma.AgentSessionCreateInput,
            ) => tx.agentSession.create({ data }),
          },
        },
        {
          provide: MessageService,
          useValue: {
            addMessageInTransaction: async (
              tx: Tx,
              data: Prisma.MessageUncheckedCreateInput,
            ) => {
              if (failAnswer)
                throw new Error('Injected answer persistence failure');
              return tx.message.create({ data });
            },
            updateFormAnswerInTransaction: (
              tx: Tx,
              id: string,
              _org: string,
              _project: string,
              _conversation: string,
              data: Prisma.InputJsonValue,
            ) => tx.message.update({ where: { id }, data: { data } }),
          },
        },
        { provide: GoalTracksService, useValue: {} },
        { provide: ProposalService, useValue: {} },
      ],
    }).compile();
    service = module.get(GoalPmRoutingEnactmentService);
  });
  beforeEach(async () => {
    failAnswer = false;
    await prisma.db.agentOperation.deleteMany({
      where: { organizationId: organization.id },
    });
    await prisma.db.message.deleteMany({
      where: { projectId: project.id, type: 'USER' },
    });
    await prisma.db.agentSession.deleteMany({
      where: {
        organizationId: organization.id,
        conversationId: { not: source.id },
      },
    });
    await prisma.db.conversation.deleteMany({
      where: { organizationId: organization.id, id: { not: source.id } },
    });
  });
  afterAll(async () => {
    if (organization) {
      await prisma.db.agentOperation.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.agentSession.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.message.deleteMany({ where: { projectId: project.id } });
      await prisma.db.conversation.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.task.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.machine.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.project.deleteMany({
        where: { organizationId: organization.id },
      });
      await prisma.db.organization.delete({ where: { id: organization.id } });
    }
    if (user) await prisma.db.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  const enact = (request = input) =>
    service.enact(organization.id, source.id, user.id, request);
  const expectSingleCreation = async () => {
    expect(
      await prisma.db.conversation.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(2);
    expect(
      await prisma.db.agentSession.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(2);
    expect(
      await prisma.db.message.count({
        where: {
          parentMessageId: input.selection.sourceMessageId,
          type: 'USER',
        },
      }),
    ).toBe(1);
  };
  it('serializes concurrent retries into one destination, session and linked answer', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => enact()));
    for (const result of results) expect(result).toEqual(results[0]);
    await expectSingleCreation();
  });
  it('rejects conflicting simultaneous choices without making a second destination', async () => {
    const results = await Promise.allSettled([
      enact(),
      enact({
        ...input,
        selection: { ...input.selection, selectedOptionId: 'other' },
      }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    await expectSingleCreation();
  });
  it('rolls back destination and session when the linked answer cannot be saved', async () => {
    failAnswer = true;
    await expect(enact()).rejects.toThrow(
      'Injected answer persistence failure',
    );
    expect(
      await prisma.db.conversation.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(1);
    expect(
      await prisma.db.agentSession.count({
        where: { organizationId: organization.id },
      }),
    ).toBe(1);
    failAnswer = false;
    await enact();
    await expectSingleCreation();
  });
  it('recovers a committed result after response loss and verifies handoff before completing history', async () => {
    const first = await enact(); // Pretend this response never reached the browser.
    expect(await enact({ selection: input.selection })).toEqual(first);
    await expect(
      service.complete(organization.id, source.id, user.id, input.selection),
    ).rejects.toThrow('authorized handoff');
    const outcome = first.answer.outcome!;
    const request = await prisma.db.message.create({
      data: {
        projectId: project.id,
        conversationId: outcome.entityId,
        userId: user.id,
        type: 'USER',
        data: {
          agentInput: {
            promptType: 'entity_conversation',
            userMessage: first.answer.pendingRequest,
          },
        },
      },
    });
    await prisma.db.agentOperation.create({
      data: {
        operationId: first.answer.operationId,
        organizationId: organization.id,
        projectId: project.id,
        userId: user.id,
        agentSessionId: outcome.agentSessionId!,
        conversationId: outcome.entityId,
        fingerprint: 'a'.repeat(64),
        kind: 'START_RUN',
        state: 'SUCCEEDED',
        messageId: request.id,
      },
    });
    const completed = await service.complete(
      organization.id,
      source.id,
      user.id,
      input.selection,
    );
    expect(completed.answer.state).toBe('COMPLETED');
    expect(await enact({ selection: input.selection })).toEqual(completed);
    expect(
      await service.complete(
        organization.id,
        source.id,
        user.id,
        input.selection,
      ),
    ).toEqual(completed);
    expect(
      await prisma.db.message.count({
        where: { conversationId: outcome.entityId },
      }),
    ).toBe(1);
    await expectSingleCreation();
  });
});

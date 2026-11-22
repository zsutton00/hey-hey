import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { GraphQLModule } from '@nestjs/graphql';
import { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import * as request from 'supertest';
import { ConversationResolver } from '../../graphql/conversations/conversation.resolver';
import type { GraphQLRequestContext } from '../../graphql/graphql-request-context';
import type { Client } from '@temporalio/client';
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { MessageReadMode } from '@hey-hey/contracts/api/models';
import { MessageController } from '../message.controller';
import { MessageService } from '../../services/message.service';
import { ConversationService } from '../../services/conversation.service';
import { FlowExecutionService } from '../../services/workflows/flow-execution.service';
import { WorkflowTypeRegistryService } from '../../services/workflows/workflow-type-registry.service';
import { ExecutionGrantService } from '../../services/controller-authorization/execution-grant.service';
import { ProposalReconciliationService } from '../../services/proposal/proposal-reconciliation.service';
import { ProjectApprovalPolicyService } from '../../services/proposal/project-approval-policy.service';
import { EntityRegistryService } from '../../services/entity-registry/entity-registry.service';
import { MentionProcessingService } from '../../services/mentions/mention-processing.service';
import { ReportService } from '../../services/reports/report.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../core/redis/redis.service';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from '../../core/events/tokens';
import * as TestUtils from '../../utils/testUtils';
import type {
  ConversationId,
  OrganizationId,
  ProjectId,
  UserId,
} from '../../types';

const { testIds } = TestUtils;
const creator = testIds.user as UserId;
const otherUser = '99999999-aaaa-4aaa-8aaa-999999999999' as UserId;

/**
 * Message endpoint boundary: the real controller and the real MessageService
 * access rule over a mocked database.
 */
describe('MessageController restricted conversation reads', () => {
  let graphqlApp: INestApplication;
  let controller: MessageController;
  let prisma: ReturnType<typeof TestUtils.createMockPrismaService>;

  const conversationRow = (restricted: boolean, createdBy: string | null) => ({
    restricted,
    createdBy,
  });
  const readMessages = (
    userId: UserId,
    query: Parameters<MessageController['getMessages']>[3],
  ) =>
    controller.getMessages(
      testIds.organization as OrganizationId,
      testIds.project as ProjectId,
      userId,
      query,
    );
  const fullThread = {
    projectId: testIds.project,
    conversationId: testIds.conversation as ConversationId,
  };
  const delta = { ...fullThread, since: testIds.message };

  beforeEach(async () => {
    prisma = TestUtils.createMockPrismaService();
    prisma.db.message.findMany.mockResolvedValue([]);
    prisma.db.message.findFirst.mockResolvedValue({
      id: testIds.message,
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
    });

    const module = await Test.createTestingModule({
      imports: [
        GraphQLModule.forRoot<ApolloDriverConfig>({
          driver: ApolloDriver,
          path: 'o/:organizationId/p/:projectId/graphql',
          autoSchemaFile: true,
          fieldResolverEnhancers: ['filters'],
          context: ({ req, res }: GraphQLRequestContext) => ({ req, res }),
        }),
      ],
      providers: [
        ConversationResolver,
        {
          provide: ConversationService,
          useValue: {
            getConversationFromAdapter: jest.fn().mockResolvedValue({
              id: testIds.conversation,
              organizationId: testIds.organization,
              projectId: testIds.project,
              title: 'Shared session',
            }),
          },
        },
        MessageService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ProposalReconciliationService,
          useValue: {
            decisionsForProposals: jest.fn().mockResolvedValue(new Map()),
          },
        },
        {
          provide: ProjectApprovalPolicyService,
          useValue: TestUtils.createTestProjectApprovalPolicyService(
            TestUtils.createMockPrismaService(),
          ),
        },
        {
          provide: DOMAIN_EVENT_PUBLISHER_TOKEN,
          useValue: { publish: jest.fn(), publishInTransaction: jest.fn() },
        },
        {
          provide: RedisService,
          useValue: { getClient: jest.fn(), onModuleDestroy: jest.fn() },
        },
        {
          provide: EntityRegistryService,
          useValue: { lookupEntityTypes: jest.fn() },
        },
        MentionProcessingService,
        {
          provide: ReportService,
          useValue: {
            loadReportsForMessageIds: jest.fn().mockResolvedValue(new Map()),
          },
        },
      ],
    }).compile();

    graphqlApp = module.createNestApplication();
    graphqlApp.use((req: Request, _res: Response, next: NextFunction) => {
      req.user = { userId: req.header('x-viewer') };
      next();
    });
    controller = new MessageController(
      module.get(MessageService),
      {} as ConversationService,
      {} as FlowExecutionService,
      {} as WorkflowTypeRegistryService,
      {} as Client,
      {} as ExecutionGrantService,
    );
  });

  afterEach(async () => {
    await graphqlApp.close();
  });

  it.each([
    [true, otherUser, false],
    [true, creator, true],
    [false, otherUser, true],
  ] as const)(
    'applies privacy to GraphQL history and previews (restricted=%s, viewer=%s)',
    async (restricted, viewer, readable) => {
      prisma.db.conversation.findFirst.mockResolvedValue(
        conversationRow(restricted, creator),
      );
      prisma.db.message.findFirst.mockResolvedValue(null);
      await graphqlApp.init();
      const read = async (fields: string) =>
        (
          await request(graphqlApp.getHttpServer())
            .post(`/o/${testIds.organization}/p/${testIds.project}/graphql`)
            .set('x-viewer', viewer)
            .send({ query: `{ ${fields} }` })
        ).body;
      const id = JSON.stringify(testIds.conversation);
      expect(
        (await read(`conversation(id: ${id}) { title }`)).data.conversation
          .title,
      ).toBe('Shared session');
      for (const fields of [
        `conversation(id: ${id}) { messages(last: 8) { nodes { id } } }`,
        `latestMessage(conversationId: ${id}) { id }`,
      ]) {
        const result = await read(fields);
        if (readable) {
          expect(result.errors).toBeUndefined();
        } else {
          expect(result.errors[0].extensions.code).toBe('FORBIDDEN');
        }
      }
    },
  );

  describe.each([
    ['full-thread', fullThread],
    ['since-cursor delta', delta],
  ])('%s read', (_name, query) => {
    it('refuses a non-creator of a restricted conversation with 403', async () => {
      prisma.db.conversation.findFirst.mockResolvedValue(
        conversationRow(true, creator),
      );

      await expect(readMessages(otherUser, query)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.db.message.findMany).not.toHaveBeenCalled();
    });

    it('lets the creator read their restricted conversation', async () => {
      prisma.db.conversation.findFirst.mockResolvedValue(
        conversationRow(true, creator),
      );

      await expect(readMessages(creator, query)).resolves.toEqual([]);
      expect(prisma.db.message.findMany).toHaveBeenCalled();
    });

    it('lets anyone read an unrestricted conversation', async () => {
      prisma.db.conversation.findFirst.mockResolvedValue(
        conversationRow(false, creator),
      );

      await expect(readMessages(otherUser, query)).resolves.toEqual([]);
    });
  });

  it('refuses every user on a restricted conversation with no recorded creator', async () => {
    prisma.db.conversation.findFirst.mockResolvedValue(
      conversationRow(true, null),
    );

    await expect(readMessages(otherUser, fullThread)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses reverse-history reads of a restricted conversation to a non-creator', async () => {
    prisma.db.conversation.findFirst.mockResolvedValue(
      conversationRow(true, creator),
    );

    await expect(
      readMessages(otherUser, {
        ...fullThread,
        mode: MessageReadMode.ReverseHistory,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scopes a read without a conversation id to conversations the reader may see', async () => {
    await readMessages(otherUser, { projectId: testIds.project });

    expect(
      prisma.db.message.findMany.mock.calls[0][0].where.conversation,
    ).toEqual(
      expect.objectContaining({
        OR: [{ restricted: false }, { createdBy: otherUser }],
      }),
    );
  });
});

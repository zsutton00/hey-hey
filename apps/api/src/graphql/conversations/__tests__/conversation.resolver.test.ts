import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { ConversationService } from '../../../services/conversation.service';
import { MessageService } from '../../../services/message.service';
import type { GraphQLRequestContext } from '../../graphql-request-context';
import { ConversationResolver } from '../conversation.resolver';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const CONVERSATION = '33333333-3333-4333-8333-333333333333';

const conversation = {
  id: CONVERSATION,
  organizationId: ORG,
  projectId: PROJECT,
  title: 'Thread',
  status: 'ACTIVE',
  workflowName: 'PROJECT_CONVERSATION',
  initiatedBy: 'USER',
  createdBy: 'user-1',
  restricted: false,
  version: 1,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
};

const message = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  conversationId: CONVERSATION,
  projectId: PROJECT,
  type: 'USER',
  status: 'COMPLETED',
  createdAt: '2026-11-01T00:00:00.000Z',
  data: { content: id },
  ...extra,
});

describe('ConversationResolver', () => {
  let app: INestApplication;

  const conversationService = {
    getConversationFromAdapter: jest.fn(),
    getAllConversationsFromAdapter: jest.fn(),
  };
  const messageService = { getMessagesForAdapter: jest.fn() };

  const query = async (body: string) => {
    const response = await request(app.getHttpServer())
      .post(`/o/${ORG}/p/${PROJECT}/graphql`)
      .send({ query: body });

    return response.body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
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
        { provide: ConversationService, useValue: conversationService },
        { provide: MessageService, useValue: messageService },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    conversationService.getConversationFromAdapter.mockResolvedValue(
      conversation,
    );
  });

  it('returns the thread in the order the REST read returns it', async () => {
    messageService.getMessagesForAdapter.mockResolvedValue([
      message('m1'),
      message('m2'),
      message('m3'),
    ]);

    const body = await query(
      `{ conversation(id: "${CONVERSATION}") { id title messages { nodes { id data } endCursor } } }`,
    );

    expect(body.data.conversation.messages).toEqual({
      nodes: [
        { id: 'm1', data: { content: 'm1' } },
        { id: 'm2', data: { content: 'm2' } },
        { id: 'm3', data: { content: 'm3' } },
      ],
      endCursor: 'm3',
    });
    expect(conversationService.getConversationFromAdapter).toHaveBeenCalledWith(
      PROJECT,
      CONVERSATION,
      ORG,
    );
    expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
      { conversationId: CONVERSATION, projectId: PROJECT, since: undefined },
      ORG,
      PROJECT,
      false,
      false,
      false,
    );
  });

  it('reads only newer messages after a cursor and keeps the cursor when none arrived', async () => {
    messageService.getMessagesForAdapter.mockResolvedValue([]);

    const body = await query(
      `{ conversation(id: "${CONVERSATION}") { messages(after: "m3") { nodes { id } endCursor } } }`,
    );

    expect(body.data.conversation.messages).toEqual({
      nodes: [],
      endCursor: 'm3',
    });
    expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
      expect.objectContaining({ conversationId: CONVERSATION, since: 'm3' }),
      ORG,
      PROJECT,
      false,
      false,
      false,
    );
  });

  it('rejects an unknown or other-conversation cursor as not found with the stable code', async () => {
    messageService.getMessagesForAdapter.mockRejectedValue(
      new NotFoundException({
        code: 'MESSAGE_CURSOR_NOT_FOUND',
        message: 'Cursor message x not found in conversation y',
      }),
    );

    const body = await query(
      `{ conversation(id: "${CONVERSATION}") { messages(after: "x") { nodes { id } } } }`,
    );

    expect(body.errors[0].extensions.code).toBe('MESSAGE_CURSOR_NOT_FOUND');
    expect(body.errors[0].path).toEqual(['conversation', 'messages']);
  });

  it('loads proposals and reports only when the query selects them', async () => {
    messageService.getMessagesForAdapter.mockResolvedValue([
      message('m1', { proposals: [{ id: 'p1' }], reports: [{ id: 'r1' }] }),
    ]);

    const body = await query(
      `{ conversation(id: "${CONVERSATION}") { messages { ...withAssociations } } }
       fragment withAssociations on MessageConnection { nodes { id proposals reports } }`,
    );

    expect(body.data.conversation.messages.nodes).toEqual([
      { id: 'm1', proposals: [{ id: 'p1' }], reports: [{ id: 'r1' }] },
    ]);
    expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
      PROJECT,
      false,
      true,
      true,
    );
  });

  it('lists the project conversations through the REST read', async () => {
    conversationService.getAllConversationsFromAdapter.mockResolvedValue({
      data: [conversation],
      pagination: { page: 2, limit: 1, total: 3, totalPages: 3 },
    });

    const body = await query(
      '{ conversations(page: 2, limit: 1) { nodes { id } pageInfo { page total } } }',
    );

    expect(body.data.conversations).toEqual({
      nodes: [{ id: CONVERSATION }],
      pageInfo: { page: 2, total: 3 },
    });
    expect(
      conversationService.getAllConversationsFromAdapter,
    ).toHaveBeenCalledWith(PROJECT, ORG, { page: 2, limit: 1 });
  });
});

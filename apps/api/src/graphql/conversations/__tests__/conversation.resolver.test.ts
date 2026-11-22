import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { GraphQLModule } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { MessageReadMode } from '@hey-hey/contracts/api/models';
import { ConversationMessageHistoryCursorError } from '../../../services/conversation-message-history-cursor';
import { ConversationService } from '../../../services/conversation.service';
import { MessageService } from '../../../services/message.service';
import type { GraphQLRequestContext } from '../../graphql-request-context';
import { EventContextManager } from '../../../core/events/observable-event.context';
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
    getActiveConversationsFromAdapter: jest.fn(),
    getConversationsByWorkflowEntityFromAdapter: jest.fn(),
  };
  const messageService = {
    getMessagesForAdapter: jest.fn(),
    getMessageForAdapter: jest.fn(),
    assertConversationMessagesReadable: jest.fn(),
    getLatestMessage: jest.fn(),
  };

  const query = async (body: string, viewer = 'reader') => {
    const response = await request(app.getHttpServer())
      .post(`/o/${ORG}/p/${PROJECT}/graphql`)
      .set(viewer ? { 'x-viewer': viewer } : {})
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
    // Stands in for the auth guard: the signed-in viewer comes from the header.
    app.use((req: any, _res: unknown, next: () => void) => {
      const viewer = req.headers['x-viewer'];
      req.user = viewer ? { userId: viewer } : undefined;
      next();
    });
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
      { includeSuggestionDecisions: false },
    );
    expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
      { conversationId: CONVERSATION, projectId: PROJECT, since: undefined },
      ORG,
      PROJECT,
      'reader',
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
      'reader',
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

  describe('newest-first page', () => {
    const HISTORY_CURSOR = 'opaque-history-cursor';

    it('reads the same page as the REST reverse-history query and exposes its continuation', async () => {
      messageService.getMessagesForAdapter.mockResolvedValue({
        messages: [message('m2'), message('m3')],
        nextCursor: HISTORY_CURSOR,
      });

      const body = await query(
        `{ conversation(id: "${CONVERSATION}") { messages(last: 2) { nodes { id } endCursor startCursor hasOlder } } }`,
      );

      expect(body.data.conversation.messages).toEqual({
        nodes: [{ id: 'm2' }, { id: 'm3' }],
        endCursor: 'm3',
        startCursor: HISTORY_CURSOR,
        hasOlder: true,
      });
      expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
        {
          conversationId: CONVERSATION,
          projectId: PROJECT,
          mode: MessageReadMode.ReverseHistory,
          limit: 2,
          historyCursor: undefined,
        },
        ORG,
        PROJECT,
        'reader',
        false,
        false,
        false,
      );
    });

    it('offers no continuation once the oldest message is reached', async () => {
      messageService.getMessagesForAdapter.mockResolvedValue({
        messages: [message('m1')],
      });

      const body = await query(
        `{ conversation(id: "${CONVERSATION}") { messages(last: 2, before: "${HISTORY_CURSOR}") { nodes { id } startCursor hasOlder } } }`,
      );

      expect(body.data.conversation.messages).toEqual({
        nodes: [{ id: 'm1' }],
        startCursor: null,
        hasOlder: false,
      });
      expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          mode: MessageReadMode.ReverseHistory,
          historyCursor: HISTORY_CURSOR,
        }),
        ORG,
        PROJECT,
        'reader',
        false,
        false,
        false,
      );
    });

    it('loads proposals and reports only when the query selects them', async () => {
      messageService.getMessagesForAdapter.mockResolvedValue({ messages: [] });

      await query(
        `{ conversation(id: "${CONVERSATION}") { messages(last: 2) { nodes { id proposals reports } } } }`,
      );

      expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
        expect.anything(),
        ORG,
        PROJECT,
        'reader',
        false,
        true,
        true,
      );
    });

    it('rejects an invalid or other-conversation history cursor as not found with the stable code', async () => {
      messageService.getMessagesForAdapter.mockRejectedValue(
        new ConversationMessageHistoryCursorError(),
      );

      const body = await query(
        `{ conversation(id: "${CONVERSATION}") { messages(last: 2, before: "bogus") { nodes { id } } } }`,
      );

      expect(body.errors[0].extensions.code).toBe('MESSAGE_CURSOR_NOT_FOUND');
    });

    it('reads forward when the newest-first arguments are explicitly null', async () => {
      messageService.getMessagesForAdapter.mockResolvedValue([message('m4')]);

      const body = await query(
        `{ conversation(id: "${CONVERSATION}") { messages(after: "m3", last: null, before: null) { nodes { id } endCursor hasOlder } } }`,
      );

      expect(body.errors).toBeUndefined();
      expect(body.data.conversation.messages).toEqual({
        nodes: [{ id: 'm4' }],
        endCursor: 'm4',
        hasOlder: null,
      });
      expect(messageService.getMessagesForAdapter).toHaveBeenCalledWith(
        { conversationId: CONVERSATION, projectId: PROJECT, since: 'm3' },
        ORG,
        PROJECT,
        'reader',
        false,
        false,
        false,
      );
    });

    it('rejects the forward cursor combined with newest-first paging', async () => {
      const body = await query(
        `{ conversation(id: "${CONVERSATION}") { messages(after: "m3", last: 2) { nodes { id } } } }`,
      );

      expect(body.errors).toHaveLength(1);
      expect(messageService.getMessagesForAdapter).not.toHaveBeenCalled();
    });
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
      'reader',
      false,
      true,
      true,
    );
  });

  it('reads proposals as the signed-in viewer so eligibility follows who has voted', async () => {
    const REVIEWER = 'reviewer-1';
    const voters = new Set<string>();
    // The proposal mapper decides eligibility from the event-context viewer.
    messageService.getMessagesForAdapter.mockImplementation(async () => {
      const viewer =
        EventContextManager.getInstance().getCurrentContext()?.userId;

      return [
        message('m1', {
          proposals: [
            {
              id: 'p1',
              status: voters.size ? 'APPROVED' : 'PENDING',
              approvalExplanation: {
                viewerEligibility: {
                  eligibleToApprove: !!viewer && !voters.has(viewer),
                },
              },
            },
          ],
        }),
      ];
    });
    const read = async () =>
      (
        await query(
          `{ conversation(id: "${CONVERSATION}") { messages { nodes { proposals } } } }`,
          REVIEWER,
        )
      ).data.conversation.messages.nodes[0].proposals[0].approvalExplanation
        .viewerEligibility.eligibleToApprove;

    expect(await read()).toBe(true);

    voters.add(REVIEWER);

    expect(await read()).toBe(false);
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
    ).toHaveBeenCalledWith(
      PROJECT,
      ORG,
      expect.objectContaining({
        page: 2,
        limit: 1,
        includeSuggestionDecisions: false,
      }),
    );
  });

  it('filters the conversation lists and asks for suggestion decisions only when selected', async () => {
    conversationService.getAllConversationsFromAdapter.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
    });
    conversationService.getActiveConversationsFromAdapter.mockResolvedValue({
      data: [],
      pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
    });

    await query(
      '{ conversations(statuses: ["ACTIVE"], workflowNames: ["A", "B"], search: "x") { nodes { id suggestionDecisions } } }',
    );
    await query('{ activeConversations(limit: 100) { nodes { id } } }');

    expect(
      conversationService.getAllConversationsFromAdapter,
    ).toHaveBeenCalledWith(
      PROJECT,
      ORG,
      expect.objectContaining({
        status: ['ACTIVE'],
        workflowName: ['A', 'B'],
        search: 'x',
        includeSuggestionDecisions: true,
      }),
    );
    expect(
      conversationService.getActiveConversationsFromAdapter,
    ).toHaveBeenCalledWith(
      PROJECT,
      ORG,
      expect.objectContaining({ includeSuggestionDecisions: false }),
    );
  });

  it('reads workflow conversations through the REST read', async () => {
    conversationService.getConversationsByWorkflowEntityFromAdapter.mockResolvedValue(
      {
        data: [conversation],
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
    );

    const body = await query(
      '{ workflowConversations(workflowName: "W", workflowAboutId: "a1", statuses: ["ACTIVE"]) { nodes { id } } }',
    );

    expect(body.data.workflowConversations.nodes).toEqual([
      { id: CONVERSATION },
    ]);
    expect(
      conversationService.getConversationsByWorkflowEntityFromAdapter,
    ).toHaveBeenCalledWith(
      ORG,
      PROJECT,
      'a1',
      'W',
      expect.objectContaining({ status: ['ACTIVE'] }),
    );
  });

  it('reads one message with its execution fields and hides other projects', async () => {
    messageService.getMessageForAdapter.mockResolvedValueOnce(
      message('m1', { executionStatus: 'queued', createdAt: null }),
    );
    const found = await query(
      '{ message(id: "m1") { id createdAt executionStatus } }',
    );
    expect(found.data.message).toEqual({
      id: 'm1',
      createdAt: null,
      executionStatus: 'queued',
    });

    messageService.getMessageForAdapter.mockResolvedValueOnce(
      message('m2', { projectId: 'other-project' }),
    );
    const hidden = await query('{ message(id: "m2") { id } }');
    expect(hidden.errors).toHaveLength(1);
  });

  it('returns a message with its parent and replies as REST does', async () => {
    messageService.getMessageForAdapter.mockResolvedValueOnce(
      message('m2', {
        parentMessageId: 'm1',
        parentMessage: message('m1', { data: { content: 'question' } }),
        responses: [message('m3', { parentMessageId: 'm2' })],
      }),
    );

    const found = await query(
      `{ message(id: "m2") {
        id
        parentMessage { id data }
        responses { id parentMessageId }
      } }`,
    );

    expect(messageService.getMessageForAdapter).toHaveBeenLastCalledWith(
      'm2',
      expect.anything(),
      true,
      PROJECT,
    );
    expect(found.data.message).toEqual({
      id: 'm2',
      parentMessage: { id: 'm1', data: { content: 'question' } },
      responses: [{ id: 'm3', parentMessageId: 'm2' }],
    });
  });

  it('reads the latest message, or null for an empty conversation', async () => {
    messageService.getLatestMessage.mockResolvedValueOnce(message('m9'));
    const latest = await query(
      `{ latestMessage(conversationId: "${CONVERSATION}") { id } }`,
    );
    expect(latest.data.latestMessage).toEqual({ id: 'm9' });

    messageService.getLatestMessage.mockResolvedValueOnce(null);
    const empty = await query(
      `{ latestMessage(conversationId: "${CONVERSATION}") { id } }`,
    );
    expect(empty.data.latestMessage).toBeNull();
  });
});

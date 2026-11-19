import type { Request } from 'express';
import { EntityContextController } from '../../../controllers/entity-context.controller';
import { GetContextToolsProvider } from '../../../mcp/tools/get-context-tools.provider';
import { createTestProjectApprovalPolicyService } from '../../../utils/testUtils';
import { EntityContextService } from '../entity-context.service';
import { MESSAGE_EXCERPT_CHARACTERS } from '../conversation-seed-context';

/**
 * Message Context excerpt privacy, exercised through both entry points
 * (REST controller and MCP tool) over the real Context service, seed loader
 * and access rule. Only storage and the graph backend are faked.
 */

const ORG = 'org-1';
const PROJECT = 'project-1';
const CREATOR = 'user-creator';
const TEAMMATE = 'user-teammate';
const CONVERSATION = '123e4567-e89b-42d3-a456-426614174301';
const MESSAGE = '123e4567-e89b-42d3-a456-426614174302';
const TOKEN = 'bearer-token';
const SHORT_TEXT = 'Restricted launch plan: ship on Friday.';
const LONG_TEXT = 'L'.repeat(MESSAGE_EXCERPT_CHARACTERS + 25);

type Access = { restricted: boolean; createdBy: string | null };

function buildHarness(access: Access, messageText: string) {
  const messageHeader = {
    id: MESSAGE,
    conversationId: CONVERSATION,
    type: 'SYSTEM',
    createdAt: new Date('2026-10-03T00:00:00Z'),
  };
  const db = {
    message: {
      findFirst: jest.fn(async (args: { select: { data?: boolean } }) =>
        args.select.data ? { data: { response: messageText } } : messageHeader,
      ),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue({
        id: CONVERSATION,
        title: 'Launch planning',
        createdAt: new Date('2026-10-01T00:00:00Z'),
        workflowAboutType: null,
        workflowAboutId: null,
        ...access,
      }),
    },
    agentSession: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Planning session',
          status: 'IN_PROGRESS',
          type: 'CODING',
          entityType: null,
          entityId: null,
        },
      ]),
    },
    proposal: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    report: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'report-1',
          reportType: 'SESSION_SUMMARY',
          createdAt: new Date('2026-10-02T00:00:00Z'),
        },
      ]),
    },
    task: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    taskSection: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const graphs = {
    readIncidentEdges: jest.fn().mockResolvedValue({ groups: [] }),
    getEntityNeighborhood: jest
      .fn()
      .mockResolvedValue({ relatedEntities: [], agentSessions: [] }),
  };
  const service = new EntityContextService(
    { outgoing: jest.fn().mockResolvedValue([]) } as never,
    { db } as never,
    graphs as never,
    { getHierarchyNodeTypes: () => ['FEATURE'] } as never,
    {} as never,
    createTestProjectApprovalPolicyService(),
  );

  return { service, db };
}

type Harness = ReturnType<typeof buildHarness>;
type ConversationContext = {
  agentSessions: unknown[];
  reports: unknown[];
  conversationTitle?: string | null;
  message?: Record<string, unknown>;
};

const viaRest = async (
  { service }: Harness,
  readerUserId: string,
): Promise<ConversationContext> => {
  const controller = new EntityContextController(service);
  const result = await controller.getEntityContext(
    ORG as never,
    PROJECT,
    'MESSAGE',
    MESSAGE,
    TOKEN,
    readerUserId,
    'false',
    '1',
    'false',
    'false',
    'false',
  );

  return result.conversationContext as ConversationContext;
};

const viaMcp = async (
  { service }: Harness,
  readerUserId: string,
): Promise<ConversationContext> => {
  const provider = new GetContextToolsProvider(
    service,
    {} as never,
    {} as never,
    {
      getRulesForProject: () => undefined,
      getDefinitions: () => [],
    } as never,
    { assertProject: jest.fn().mockResolvedValue(undefined) } as never,
    {
      resolveScope: jest.fn().mockReturnValue({
        agentSessionId: '123e4567-e89b-42d3-a456-426614174098',
        projectId: PROJECT,
      }),
      issue: jest
        .fn()
        .mockResolvedValue('123e4567-e89b-42d3-a456-426614174097'),
    } as never,
  );
  const request = {
    user: {
      id: readerUserId,
      userId: readerUserId,
      currentOrgId: ORG,
      orgId: ORG,
    },
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-project-id': PROJECT,
      'x-agent-session-id': '123e4567-e89b-42d3-a456-426614174098',
    },
  } as unknown as Request;
  const result = (await provider.getContext(
    { entityId: MESSAGE, entityType: 'MESSAGE', projectId: PROJECT },
    {} as never,
    request,
  )) as { conversationContext: ConversationContext };

  return result.conversationContext;
};

describe.each([
  ['REST controller', viaRest],
  ['MCP get_context', viaMcp],
])('Message Context excerpt privacy via %s', (_surface, read) => {
  it('gives a restricted conversation’s creator the full short excerpt', async () => {
    const harness = buildHarness(
      { restricted: true, createdBy: CREATOR },
      SHORT_TEXT,
    );

    const context = await read(harness, CREATOR);

    expect(context.message).toMatchObject({
      excerpt: SHORT_TEXT,
      truncated: false,
      length: SHORT_TEXT.length,
    });
  });

  it('caps a long excerpt for the creator and marks it truncated', async () => {
    const harness = buildHarness(
      { restricted: true, createdBy: CREATOR },
      LONG_TEXT,
    );

    const context = await read(harness, CREATOR);

    expect(context.message).toMatchObject({
      excerpt: 'L'.repeat(MESSAGE_EXCERPT_CHARACTERS),
      truncated: true,
      length: LONG_TEXT.length,
    });
  });

  it('gives a teammate the excerpt when the conversation is unrestricted', async () => {
    const harness = buildHarness(
      { restricted: false, createdBy: CREATOR },
      SHORT_TEXT,
    );

    const context = await read(harness, TEAMMATE);

    expect(context.message).toMatchObject({
      excerpt: SHORT_TEXT,
      truncated: false,
    });
  });

  it.each([
    ['a teammate who is not the creator', CREATOR, TEAMMATE],
    ['a conversation with no recorded creator', null, TEAMMATE],
  ])(
    'withholds the message text from %s but keeps the conversation orientation',
    async (_label, createdBy, reader) => {
      const harness = buildHarness({ restricted: true, createdBy }, SHORT_TEXT);

      const context = await read(harness, reader);

      expect(context.message).toBeUndefined();
      expect(JSON.stringify(context)).not.toContain(SHORT_TEXT);
      expect(context.conversationTitle).toBe('Launch planning');
      expect(context.agentSessions).toHaveLength(1);
      expect(context.reports).toHaveLength(1);
      const bodyReads = harness.db.message.findFirst.mock.calls.filter(
        ([args]) => args.select.data,
      );
      expect(bodyReads).toHaveLength(0);
    },
  );
});

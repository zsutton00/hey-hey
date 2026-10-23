import type { Request } from 'express';
import type { Context } from '@rekog/mcp-nest';
import { AgentSessionToolsProvider } from './agent-session-tools.provider';
import { PrismaService } from '../../prisma/prisma.service';
import * as TestUtils from '../../utils/testUtils';
import { AgentSessionService } from '../../services/agent-session.service';
import {
  AgentSessionHistoryCursorError,
  MessageService,
} from '../../services/message.service';
import { NotFoundException } from '@nestjs/common';

const EMPTY_CONTEXT = {} as unknown as Context;

const { testIds } = TestUtils;

const TEST_TOKEN = 'test-bearer-token';
const taskId = '123e4567-e89b-42d3-a456-426614174090';
const serviceId = '123e4567-e89b-42d3-a456-426614174091';
const conversationId = '123e4567-e89b-42d3-a456-426614174092';
const agentSessionId = '123e4567-e89b-42d3-a456-426614174093';

function makeRequest(overrides?: {
  token?: string | null;
  projectIdHeader?: string;
}): Request {
  const token = overrides?.token === undefined ? TEST_TOKEN : overrides.token;
  const user = {
    userId: testIds.user,
    currentOrgId: testIds.organization,
  };
  const headers: Record<string, string> = {
    'x-project-id': overrides?.projectIdHeader ?? testIds.project,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return { user, headers } as unknown as Request;
}

function makeParams(overrides?: Record<string, unknown>) {
  return {
    limit: 10,
    offset: 0,
    taskId,
    ...overrides,
  } as {
    taskId?: string;
    serviceId?: string;
    limit: number;
    offset: number;
  };
}

function makeSessionRow(overrides?: Record<string, unknown>) {
  return {
    id: agentSessionId,
    title: 'Coding session',
    status: 'COMPLETED',
    provider: 'claude',
    taskId,
    serviceId: null,
    sessionDate: new Date('2026-04-15T09:00:00.000Z'),
    conversationId,
    service: null,
    ...overrides,
  };
}

type MessageData = {
  response?: string;
  actionHint?: string;
  comment?: string;
};

function makeMessageRow(
  offsetSeconds: number,
  type: 'SYSTEM' | 'USER',
  data: MessageData,
  overrides?: Record<string, unknown>,
) {
  return {
    id: `msg-${offsetSeconds}`,
    conversationId,
    type,
    data,
    createdAt: new Date(
      new Date('2026-04-15T09:00:00.000Z').getTime() + offsetSeconds * 1000,
    ),
    ...overrides,
  };
}

describe('AgentSessionToolsProvider', () => {
  let provider: AgentSessionToolsProvider;
  let prisma: {
    db: {
      agentSession: { findMany: jest.Mock };
      message: { findMany: jest.Mock };
    };
  };
  let agentSessionService: { findOne: jest.Mock };
  let messageService: { getAgentSessionHistoryPage: jest.Mock };

  beforeEach(() => {
    prisma = {
      db: {
        agentSession: { findMany: jest.fn() },
        message: { findMany: jest.fn() },
      },
    };
    agentSessionService = { findOne: jest.fn() };
    messageService = { getAgentSessionHistoryPage: jest.fn() };

    provider = new AgentSessionToolsProvider(
      prisma as unknown as PrismaService,
      agentSessionService as unknown as AgentSessionService,
      messageService as unknown as MessageService,
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('get_agent_session', () => {
    it('composes the canonical project-scoped session with reverse message paging', async () => {
      const canonicalSession = {
        id: agentSessionId,
        projectId: testIds.project,
        conversationId,
        title: 'Canonical session',
        currentState: { state: 'IDLE', revision: 4 },
      };
      agentSessionService.findOne.mockResolvedValue(canonicalSession);
      messageService.getAgentSessionHistoryPage.mockResolvedValue({
        messages: [{ id: 'message-2' }],
        nextCursor: 'older-cursor',
      });

      const result = await provider.getAgentSession(
        { agentSessionId, limit: 25 },
        EMPTY_CONTEXT,
        makeRequest(),
      );

      expect(agentSessionService.findOne).toHaveBeenCalledWith(
        testIds.organization,
        agentSessionId,
        { includeService: true, projectId: testIds.project },
      );
      expect(messageService.getAgentSessionHistoryPage).toHaveBeenCalledWith({
        organizationId: testIds.organization,
        projectId: testIds.project,
        agentSessionId,
        conversationId,
        cursor: undefined,
        limit: 25,
        maxMessageCharacters: 32_000 - JSON.stringify(canonicalSession).length,
      });
      expect(result).toEqual({
        agentSession: canonicalSession,
        messages: [{ id: 'message-2' }],
        nextCursor: 'older-cursor',
      });
    });

    it('returns an empty history without querying messages when no Conversation is linked', async () => {
      agentSessionService.findOne.mockResolvedValue({
        id: agentSessionId,
        projectId: testIds.project,
        conversationId: null,
      });

      const result = await provider.getAgentSession(
        { agentSessionId },
        EMPTY_CONTEXT,
        makeRequest(),
      );

      expect(result).toEqual({
        agentSession: expect.objectContaining({ id: agentSessionId }),
        messages: [],
      });
      expect(messageService.getAgentSessionHistoryPage).not.toHaveBeenCalled();
    });

    it('uses the non-disclosing contract error for missing or unauthorized sessions', async () => {
      agentSessionService.findOne.mockRejectedValue(
        new NotFoundException('Agent session not found'),
      );

      const result = (await provider.getAgentSession(
        { agentSessionId },
        EMPTY_CONTEXT,
        makeRequest(),
      )) as unknown as {
        isError: boolean;
        structuredContent: { code: string };
      };

      expect(result.isError).toBe(true);
      expect(result.structuredContent.code).toBe('agent_session_not_found');
    });

    it('returns the contract invalid_cursor error for cursor binding failures', async () => {
      agentSessionService.findOne.mockResolvedValue({
        id: agentSessionId,
        projectId: testIds.project,
        conversationId,
      });
      messageService.getAgentSessionHistoryPage.mockRejectedValue(
        new AgentSessionHistoryCursorError(),
      );

      const result = (await provider.getAgentSession(
        { agentSessionId, cursor: 'wrong-binding' },
        EMPTY_CONTEXT,
        makeRequest(),
      )) as unknown as {
        isError: boolean;
        structuredContent: { code: string };
      };

      expect(result.isError).toBe(true);
      expect(result.structuredContent.code).toBe('invalid_cursor');
    });
  });

  it('returns only SYSTEM messages marked with actionHint="task_complete" in chronological order', async () => {
    prisma.db.agentSession.findMany.mockResolvedValue([makeSessionRow()]);
    // Production query is createdAt: 'desc' — newest first; the provider
    // reverses each per-conversation list back to chronological order.
    prisma.db.message.findMany.mockResolvedValue([
      makeMessageRow(120, 'SYSTEM', {
        response: 'Turn 2 done. Files changed: src/bar.ts',
        actionHint: 'task_complete',
      }),
      makeMessageRow(90, 'SYSTEM', {
        response: 'Permission requested',
        actionHint: 'permission_requested',
      }),
      makeMessageRow(60, 'SYSTEM', {
        response: 'Turn 1 done. Files changed: src/foo.ts',
        actionHint: 'task_complete',
      }),
      makeMessageRow(0, 'SYSTEM', { response: 'Starting work…' }),
    ]);

    const result = (await provider.getAgentSessions(
      makeParams(),
      EMPTY_CONTEXT,
      makeRequest(),
    )) as { sessions: Array<{ messages: Array<{ content: string }> }> };

    expect(result.sessions).toHaveLength(1);
    const [session] = result.sessions;
    expect(session!.messages).toEqual([
      {
        role: 'system',
        content: 'Turn 1 done. Files changed: src/foo.ts',
        createdAt: '2026-04-15T09:01:00.000Z',
      },
      {
        role: 'system',
        content: 'Turn 2 done. Files changed: src/bar.ts',
        createdAt: '2026-04-15T09:02:00.000Z',
      },
    ]);
    expect(prisma.db.message.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: 'SYSTEM' }),
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('condenses a 30-row session with 4 turn completions down to 4 messages', async () => {
    prisma.db.agentSession.findMany.mockResolvedValue([makeSessionRow()]);

    const rows: ReturnType<typeof makeMessageRow>[] = [];
    for (let i = 0; i < 30; i++) {
      const isCompletion =
        i % 7 === 0 &&
        rows.filter(
          (r) => (r.data as MessageData).actionHint === 'task_complete',
        ).length < 4;
      rows.push(
        makeMessageRow(
          i * 10,
          'SYSTEM',
          isCompletion
            ? { response: `Completion #${i}`, actionHint: 'task_complete' }
            : { response: `Progress #${i}` },
        ),
      );
    }
    prisma.db.message.findMany.mockResolvedValue(rows);

    const result = (await provider.getAgentSessions(
      makeParams(),
      EMPTY_CONTEXT,
      makeRequest(),
    )) as { sessions: Array<{ messages: Array<{ content: string }> }> };

    const [session] = result.sessions;
    expect(session!.messages).toHaveLength(4);
    expect(
      session!.messages.every((m) => m.content.startsWith('Completion')),
    ).toBe(true);
  });

  it('returns an mcpError when neither taskId nor serviceId is provided', async () => {
    const result = (await provider.getAgentSessions(
      makeParams({ taskId: undefined }),
      EMPTY_CONTEXT,
      makeRequest(),
    )) as { isError: boolean };

    expect(result.isError).toBe(true);
    expect(prisma.db.agentSession.findMany).not.toHaveBeenCalled();
  });

  it('returns an mcpError when both taskId and serviceId are provided', async () => {
    const result = (await provider.getAgentSessions(
      makeParams({ taskId, serviceId }),
      EMPTY_CONTEXT,
      makeRequest(),
    )) as { isError: boolean };

    expect(result.isError).toBe(true);
    expect(prisma.db.agentSession.findMany).not.toHaveBeenCalled();
  });

  it('sets hasMore=true when loadSessions returns more than the requested limit', async () => {
    const extraSession = makeSessionRow({
      id: 'session-2',
      conversationId: 'conv-2',
    });
    prisma.db.agentSession.findMany.mockResolvedValue([
      makeSessionRow(),
      extraSession,
    ]);
    prisma.db.message.findMany.mockResolvedValue([]);

    const result = (await provider.getAgentSessions(
      makeParams({ limit: 1 }),
      EMPTY_CONTEXT,
      makeRequest(),
    )) as { sessions: unknown[]; hasMore: boolean };

    expect(result.hasMore).toBe(true);
    expect(result.sessions).toHaveLength(1);
  });

  it('returns an empty list when no sessions match', async () => {
    prisma.db.agentSession.findMany.mockResolvedValue([]);

    const result = (await provider.getAgentSessions(
      makeParams(),
      EMPTY_CONTEXT,
      makeRequest(),
    )) as { sessions: unknown[]; hasMore: boolean };

    expect(result).toEqual({ sessions: [], hasMore: false });
    expect(prisma.db.message.findMany).not.toHaveBeenCalled();
  });

  it('returns an mcpError when the underlying Prisma call throws', async () => {
    prisma.db.agentSession.findMany.mockRejectedValue(
      new Error('connection lost'),
    );

    const result = (await provider.getAgentSessions(
      makeParams(),
      EMPTY_CONTEXT,
      makeRequest(),
    )) as { isError: boolean; content: Array<{ text: string }> };

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('connection lost');
  });
});

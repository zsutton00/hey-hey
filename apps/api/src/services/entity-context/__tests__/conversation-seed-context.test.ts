import { NotFoundException } from '@nestjs/common';
import type { ExtendedPrismaClient } from '../../../prisma/prisma.service';
import type { OrganizationId, ProjectId } from '../../../types';
import {
  CONVERSATION_CONTEXT_LIST_LIMIT,
  MESSAGE_EXCERPT_CHARACTERS,
  loadAuthorizedConversationSeed,
} from '../conversation-seed-context';

const organizationId = 'org-1' as OrganizationId;
const projectId = 'project-1' as ProjectId;
const conversationId = 'conversation-1';
const messageId = 'message-1';
const creatorId = 'user-creator';
const teammateId = 'user-teammate';
const conversationCreatedAt = new Date('2026-10-01T00:00:00Z');

function makeDb(overrides: {
  message?: Record<string, unknown> | null;
  conversation?: Record<string, unknown> | null;
}) {
  const { data, ...messageHeader } = overrides.message ?? {};
  return {
    message: {
      // The header read never selects body data; only the gated read does.
      findFirst: jest.fn(async (args: { select: { data?: boolean } }) => {
        if (!overrides.message) {
          return null;
        }
        return args.select.data ? { data } : messageHeader;
      }),
    },
    conversation: {
      findFirst: jest.fn().mockResolvedValue(
        overrides.conversation === undefined
          ? {
              id: conversationId,
              title: 'Fix get_context',
              createdAt: conversationCreatedAt,
              restricted: true,
              createdBy: creatorId,
              workflowAboutType: null,
              workflowAboutId: null,
            }
          : overrides.conversation,
      ),
    },
    agentSession: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'session-1',
          title: 'Coding session',
          status: 'IN_PROGRESS',
          type: 'CODING',
          entityType: 'TASK',
          entityId: 'task-1',
        },
      ]),
    },
    proposal: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'proposal-1',
          title: 'Edit task',
          status: 'PENDING',
          action: 'UPDATE',
          targetEntityType: 'TASK',
          targetEntityId: 'task-1',
        },
      ]),
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
  };
}

const load = (
  db: ReturnType<typeof makeDb>,
  kind: 'CONVERSATION' | 'MESSAGE',
  id: string,
  readerUserId: string | null = creatorId,
) =>
  loadAuthorizedConversationSeed(
    db as unknown as ExtendedPrismaClient,
    organizationId,
    projectId,
    kind,
    id,
    readerUserId,
  );

describe('loadAuthorizedConversationSeed', () => {
  it('orients a MESSAGE seed on its owning conversation with a capped excerpt', async () => {
    const longText = 'x'.repeat(MESSAGE_EXCERPT_CHARACTERS + 50);
    const db = makeDb({
      message: {
        id: messageId,
        conversationId,
        type: 'SYSTEM',
        data: { response: longText },
        createdAt: new Date('2026-10-03T00:00:00Z'),
      },
    });

    const seed = await load(db, 'MESSAGE', messageId);

    expect(db.message.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: messageId,
          projectId,
          conversation: { organizationId, projectId },
        },
      }),
    );
    expect(db.conversation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: conversationId, organizationId, projectId },
      }),
    );
    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          messageId,
          organizationId,
          projectId,
        }),
        take: CONVERSATION_CONTEXT_LIST_LIMIT,
      }),
    );
    const ctx = seed.conversationContext;
    expect(ctx.conversationId).toBe(conversationId);
    expect(ctx.about).toEqual({ entityType: 'TASK', entityId: 'task-1' });
    expect(ctx.agentSessions.map((s) => s.id)).toEqual(['session-1']);
    expect(ctx.proposals.map((p) => p.id)).toEqual(['proposal-1']);
    expect(ctx.reports.map((r) => r.id)).toEqual(['report-1']);
    expect(ctx.message).toEqual({
      messageId,
      type: 'SYSTEM',
      createdAt: '2026-10-03T00:00:00.000Z',
      excerpt: 'x'.repeat(MESSAGE_EXCERPT_CHARACTERS),
      truncated: true,
      length: MESSAGE_EXCERPT_CHARACTERS + 50,
    });
  });

  it('orients a CONVERSATION seed without treating it as a message', async () => {
    const db = makeDb({});

    const seed = await load(db, 'CONVERSATION', conversationId);

    expect(db.message.findFirst).not.toHaveBeenCalled();
    expect(seed.conversationContext.message).toBeUndefined();
    expect(seed.meta).toEqual({
      createdAt: conversationCreatedAt,
      displayName: 'Fix get_context',
    });
    expect(db.proposal.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ conversationId }),
      }),
    );
  });

  it('rejects a message outside the caller scope without reading further', async () => {
    const db = makeDb({ message: null });

    await expect(load(db, 'MESSAGE', messageId)).rejects.toThrow(
      new NotFoundException(`MESSAGE with id ${messageId} not found`),
    );
    expect(db.conversation.findFirst).not.toHaveBeenCalled();
    expect(db.agentSession.findMany).not.toHaveBeenCalled();
  });

  it('rejects a conversation outside the caller scope without disclosure', async () => {
    const db = makeDb({ conversation: null });

    await expect(load(db, 'CONVERSATION', conversationId)).rejects.toThrow(
      `CONVERSATION with id ${conversationId} not found`,
    );
    expect(db.proposal.findMany).not.toHaveBeenCalled();
    expect(db.report.findMany).not.toHaveBeenCalled();
  });

  describe('transcript privacy', () => {
    const shortMessage = {
      id: messageId,
      conversationId,
      type: 'SYSTEM',
      data: { response: 'private plan details' },
      createdAt: new Date('2026-10-03T00:00:00Z'),
    };
    const conversationRow = (access: {
      restricted: boolean;
      createdBy: string | null;
    }) => ({
      id: conversationId,
      title: 'Fix get_context',
      createdAt: conversationCreatedAt,
      workflowAboutType: null,
      workflowAboutId: null,
      ...access,
    });

    it('gives the recorded creator the full short excerpt', async () => {
      const db = makeDb({ message: shortMessage });

      const seed = await load(db, 'MESSAGE', messageId, creatorId);

      expect(seed.conversationContext.message).toMatchObject({
        excerpt: 'private plan details',
        truncated: false,
        length: 'private plan details'.length,
      });
    });

    it('gives readers of an unrestricted conversation the excerpt', async () => {
      const db = makeDb({
        message: shortMessage,
        conversation: conversationRow({
          restricted: false,
          createdBy: creatorId,
        }),
      });

      const seed = await load(db, 'MESSAGE', messageId, teammateId);

      expect(seed.conversationContext.message?.excerpt).toBe(
        'private plan details',
      );
    });

    it.each([
      ['a non-creator', { restricted: true, createdBy: creatorId }, teammateId],
      [
        'a conversation with no recorded creator',
        { restricted: true, createdBy: null },
        teammateId,
      ],
      [
        'an unidentified reader',
        { restricted: true, createdBy: creatorId },
        null,
      ],
    ])(
      'withholds the message block from %s but keeps orientation',
      async (_label, access, reader) => {
        const db = makeDb({
          message: shortMessage,
          conversation: conversationRow(access),
        });

        const seed = await load(db, 'MESSAGE', messageId, reader);

        expect(seed.conversationContext.message).toBeUndefined();
        expect(JSON.stringify(seed)).not.toContain('private plan details');
        expect(seed.conversationContext.conversationTitle).toBe(
          'Fix get_context',
        );
        expect(seed.conversationContext.agentSessions).toHaveLength(1);
        expect(seed.conversationContext.proposals).toHaveLength(1);
        expect(seed.conversationContext.reports).toHaveLength(1);
        // Body data is never read for a denied reader.
        expect(
          db.message.findFirst.mock.calls.some(([args]) => args.select.data),
        ).toBe(false);
      },
    );
  });
});

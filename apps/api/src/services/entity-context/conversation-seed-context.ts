import { NotFoundException } from '@nestjs/common';
import type { ExtendedPrismaClient } from 'src/prisma/prisma.service';
import type { OrganizationId, ProjectId } from 'src/types';
import type { ConversationContextDto } from 'src/generated/model/conversationContextDto';
import { ORDINARY_PROPOSAL_VISIBILITY_WHERE } from 'src/services/proposal/proposal-visibility';
import {
  getContentFromMessageData,
  type MessageDataForContent,
} from 'src/utils/message-content.util';

/** Characters of message text returned; the full thread stays with get_agent_session. */
export const MESSAGE_EXCERPT_CHARACTERS = 1_000;
export const CONVERSATION_CONTEXT_LIST_LIMIT = 10;
const CONVERSATION_CONTEXT_SESSION_LIMIT = 5;

export type ConversationSeedKind = 'CONVERSATION' | 'MESSAGE';

export type AuthorizedConversationSeed = {
  meta: { createdAt: Date; displayName: string };
  conversationContext: ConversationContextDto;
};

function excerpt(text: string): { excerpt: string; truncated: boolean } {
  const chars = Array.from(text);
  return chars.length <= MESSAGE_EXCERPT_CHARACTERS
    ? { excerpt: text, truncated: false }
    : {
        excerpt: chars.slice(0, MESSAGE_EXCERPT_CHARACTERS).join(''),
        truncated: true,
      };
}

/**
 * Authorizes a CONVERSATION or MESSAGE seed against the owning
 * conversation's organization and project, then builds its bounded
 * orientation. A seed that is missing or outside the caller's scope is
 * rejected with the same not-found error so nothing is disclosed.
 */
export async function loadAuthorizedConversationSeed(
  db: ExtendedPrismaClient,
  organizationId: OrganizationId,
  projectId: ProjectId,
  kind: ConversationSeedKind,
  entityId: string,
): Promise<AuthorizedConversationSeed> {
  const notFound = () =>
    new NotFoundException(`${kind} with id ${entityId} not found`);
  const conversationScope = { organizationId, projectId };

  const message =
    kind === 'MESSAGE'
      ? await db.message.findFirst({
          where: {
            id: entityId,
            projectId,
            conversation: conversationScope,
          },
          select: {
            id: true,
            conversationId: true,
            type: true,
            data: true,
            createdAt: true,
          },
        })
      : null;
  if (kind === 'MESSAGE' && !message) throw notFound();

  const conversationId = message?.conversationId ?? entityId;
  const conversation = await db.conversation.findFirst({
    where: { id: conversationId, ...conversationScope },
    select: {
      id: true,
      title: true,
      createdAt: true,
      workflowAboutType: true,
      workflowAboutId: true,
    },
  });
  if (!conversation) throw notFound();

  const sessions = await db.agentSession.findMany({
    where: { conversationId, ...conversationScope },
    orderBy: { createdAt: 'desc' },
    take: CONVERSATION_CONTEXT_SESSION_LIMIT,
    select: {
      id: true,
      title: true,
      status: true,
      type: true,
      entityType: true,
      entityId: true,
    },
  });

  const reportEntityIds = [conversationId, ...sessions.map((s) => s.id)];
  if (message) reportEntityIds.push(message.id);

  const [proposals, reports] = await Promise.all([
    db.proposal.findMany({
      where: {
        ...conversationScope,
        ...(message ? { messageId: message.id } : { conversationId }),
        ...ORDINARY_PROPOSAL_VISIBILITY_WHERE,
      },
      orderBy: { createdAt: 'desc' },
      take: CONVERSATION_CONTEXT_LIST_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        action: true,
        targetEntityType: true,
        targetEntityId: true,
      },
    }),
    db.report.findMany({
      where: {
        ragEnabled: true,
        ...conversationScope,
        reportEntities: { some: { entityId: { in: reportEntityIds } } },
      },
      orderBy: { createdAt: 'desc' },
      take: CONVERSATION_CONTEXT_LIST_LIMIT,
      select: { id: true, reportType: true, createdAt: true },
    }),
  ]);

  const sessionAbout = sessions.find((s) => s.entityType && s.entityId);
  const about =
    conversation.workflowAboutType && conversation.workflowAboutId
      ? {
          entityType: conversation.workflowAboutType,
          entityId: conversation.workflowAboutId,
        }
      : sessionAbout?.entityType && sessionAbout.entityId
        ? {
            entityType: sessionAbout.entityType,
            entityId: sessionAbout.entityId,
          }
        : undefined;

  const text = message
    ? (getContentFromMessageData(
        message.type,
        (message.data as MessageDataForContent | null) ?? undefined,
      ) ?? '')
    : '';
  const conversationContext: ConversationContextDto = {
    conversationId,
    conversationTitle: conversation.title,
    ...(about ? { about } : {}),
    agentSessions: sessions.map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status,
      type: s.type,
    })),
    proposals: proposals.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      action: p.action,
      targetEntityType: p.targetEntityType,
      targetEntityId: p.targetEntityId,
    })),
    reports: reports.map((r) => ({
      id: r.id,
      reportType: r.reportType,
      createdAt: r.createdAt.toISOString(),
    })),
    ...(message
      ? {
          message: {
            messageId: message.id,
            type: message.type,
            createdAt: message.createdAt?.toISOString() ?? null,
            ...excerpt(text),
            length: Array.from(text).length,
          },
        }
      : {}),
  };

  return {
    meta: message
      ? {
          // A queued input has no timeline position yet; the excerpt's
          // createdAt stays null and the seed falls back to its conversation.
          createdAt: message.createdAt ?? conversation.createdAt,
          displayName: `${message.type} message in ${conversation.title ?? 'conversation'}`,
        }
      : {
          createdAt: conversation.createdAt,
          displayName: conversation.title ?? '(unnamed)',
        },
    conversationContext,
  };
}

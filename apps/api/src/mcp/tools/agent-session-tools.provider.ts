import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Tool, Context } from '@rekog/mcp-nest';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversationId, OrganizationId } from '../../types';
import type {
  GetAgentSessionError,
  GetAgentSessionRequest,
  GetAgentSessionResponse,
} from '../../generated';
import { GetAgentSessionErrorCode } from '../../generated';
import { AgentSessionService } from '../../services/agent-session.service';
import {
  AgentSessionHistoryCursorError,
  MessageService,
} from '../../services/message.service';
import {
  extractAuthContext,
  isAuthContext,
  mcpError,
  paginationFields,
  resolveProjectId,
  isProjectId,
} from './mcp-tool.utils';
import {
  TIMELINE_MESSAGE_WHERE,
  timelineCreatedAt,
} from 'src/utils/message-timeline.util';
import { RESPONSE_CHARACTER_BUDGET } from './response-budget';

/**
 * Compact turn-completion message representation. Default output is
 * limited to SYSTEM messages the agent flagged as turn-complete
 * (`data.actionHint === 'task_complete'`), so `role` is always 'system'.
 */
const mcpMessageSchema = z.object({
  role: z.literal('system').describe('Message author role'),
  content: z.string().describe('Primary textual content of the message'),
  createdAt: z.string().describe('ISO-8601 creation timestamp'),
});

const mcpAgentSessionDtoSchema = z.object({
  agentSessionId: z.string().describe('Agent session ID'),
  title: z.string().describe('Agent session title'),
  status: z.string().describe('Agent session status'),
  provider: z.string().optional().describe('Agent provider (claude, codex)'),
  taskId: z.string().optional().describe('Associated task ID'),
  serviceId: z.string().optional().describe('Associated service ID'),
  serviceName: z.string().optional().describe('Associated service name'),
  sessionDate: z.string().describe('ISO-8601 session date'),
  conversationId: z.string().nullable().describe('Conversation ID'),
  messages: z.array(mcpMessageSchema).describe('Chronological messages'),
});

const getAgentSessionsOutput = z.object({
  sessions: z
    .array(mcpAgentSessionDtoSchema)
    .describe('Matching agent sessions with conversation messages'),
  hasMore: z.boolean().describe('Whether more sessions exist beyond this page'),
});

type GetAgentSessionsOutput = z.infer<typeof getAgentSessionsOutput>;

const getAgentSessionParameters = z
  .object({
    agentSessionId: z.string().uuid().describe('Agent Session identity'),
    cursor: z
      .string()
      .min(1)
      .optional()
      .describe('Opaque cursor for messages older than the previous page'),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .describe('Maximum number of newest-first messages to return'),
  })
  .strict() satisfies z.ZodType<GetAgentSessionRequest>;

const getAgentSessionSuccessOutput = z
  .object({
    agentSession: z.custom<GetAgentSessionResponse['agentSession']>(),
    messages: z.array(z.custom<GetAgentSessionResponse['messages'][number]>()),
    nextCursor: z.string().optional(),
  })
  .strict() satisfies z.ZodType<GetAgentSessionResponse>;

const getAgentSessionErrorOutput = z
  .object({
    code: z.enum(
      Object.values(GetAgentSessionErrorCode) as [
        GetAgentSessionError['code'],
        ...GetAgentSessionError['code'][],
      ],
    ),
    message: z.string(),
  })
  .strict() satisfies z.ZodType<GetAgentSessionError>;

const getAgentSessionOutput = z.union([
  getAgentSessionSuccessOutput,
  getAgentSessionErrorOutput,
]) satisfies z.ZodType<GetAgentSessionResponse | GetAgentSessionError>;

/**
 * Safety cap on turn-completion messages returned per conversation.
 * With `data.actionHint === 'task_complete'` filtering applied first,
 * typical sessions return 3–4 completions, so this rarely matters.
 */
const MAX_MESSAGES_PER_CONVERSATION = 200;

/** Marker on SystemMessageData indicating the agent reported turn-complete. */
const TURN_COMPLETE_ACTION_HINT = 'task_complete';

const getAgentSessionsParameters = z.object({
  taskId: z
    .string()
    .uuid()
    .optional()
    .describe('Filter agent sessions by task ID'),
  serviceId: z
    .string()
    .uuid()
    .optional()
    .describe('Filter agent sessions by service ID'),
  ...paginationFields,
});

type MessageRow = {
  id: string;
  type: string;
  data: unknown;
  createdAt: Date;
};

type AgentSessionRow = {
  id: string;
  title: string;
  status: string;
  provider: string | null;
  entityType: string | null;
  entityId: string | null;
  serviceId: string | null;
  sessionDate: Date;
  conversationId: string | null;
  service: { name: string } | null;
};

@Injectable()
export class AgentSessionToolsProvider {
  private readonly logger = new Logger(AgentSessionToolsProvider.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentSessionService: AgentSessionService,
    private readonly messageService: MessageService,
  ) {}

  @Tool({
    name: 'get_agent_session',
    description:
      'Retrieve one project-authorized canonical Agent Session together ' +
      'with a bounded newest-first page of its Conversation messages. The ' +
      'page holds whole messages within an 8,000-token estimated budget, so ' +
      'it can be shorter than limit (the newest message is always returned ' +
      'whole). Use nextCursor to continue toward older history until it is ' +
      'absent. This does not change the ' +
      'plural get_agent_sessions accomplishment-summary lookup or the ' +
      'Conversations forward since cursor.',
    parameters: getAgentSessionParameters,
    outputSchema: getAgentSessionOutput,
  })
  async getAgentSession(
    params: GetAgentSessionRequest,
    _context: Context,
    request: Request,
  ): Promise<GetAgentSessionResponse | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) {
      return this.getAgentSessionError(
        GetAgentSessionErrorCode.AuthenticationRequired,
        'Authentication required.',
      );
    }

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) {
      return this.getAgentSessionError(
        GetAgentSessionErrorCode.ProjectScopeRequired,
        'A valid project scope is required.',
      );
    }

    try {
      const agentSession = await this.agentSessionService.findOne(
        auth.organizationId,
        params.agentSessionId,
        { includeService: true, projectId },
      );
      if (!agentSession.conversationId) {
        if (params.cursor) {
          return this.getAgentSessionError(
            GetAgentSessionErrorCode.InvalidCursor,
            'The cursor is not valid for this Agent Session Conversation.',
          );
        }
        return { agentSession, messages: [] } satisfies GetAgentSessionResponse;
      }

      const page = await this.messageService.getAgentSessionHistoryPage({
        organizationId: auth.organizationId,
        projectId,
        agentSessionId: params.agentSessionId,
        conversationId: agentSession.conversationId as ConversationId,
        cursor: params.cursor,
        limit: params.limit ?? 20,
        maxMessageCharacters:
          RESPONSE_CHARACTER_BUDGET - JSON.stringify(agentSession).length,
      });
      return { agentSession, ...page } satisfies GetAgentSessionResponse;
    } catch (error: unknown) {
      if (error instanceof NotFoundException) {
        return this.getAgentSessionError(
          GetAgentSessionErrorCode.AgentSessionNotFound,
          'Agent Session not found in the authorized project scope.',
        );
      }
      if (error instanceof AgentSessionHistoryCursorError) {
        return this.getAgentSessionError(
          GetAgentSessionErrorCode.InvalidCursor,
          'The cursor is not valid for this Agent Session Conversation.',
        );
      }

      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`get_agent_session failed: ${message}`, stack);
      return this.getAgentSessionError(
        GetAgentSessionErrorCode.InternalError,
        'Failed to retrieve the Agent Session.',
      );
    }
  }

  private getAgentSessionError(
    code: GetAgentSessionError['code'],
    message: string,
  ): CallToolResult {
    const error = { code, message } satisfies GetAgentSessionError;
    return {
      content: [{ type: 'text', text: message }],
      structuredContent: { ...error },
      isError: true,
    };
  }

  @Tool({
    name: 'get_agent_sessions',
    description:
      "Retrieve what was actually accomplished in a task's coding " +
      'sessions. Use this to check real progress on a task — including ' +
      'cross-task lookups: when working on task B, call this on task A to ' +
      'see what was done, what files changed, and what was tried. Task ' +
      'status fields are user-maintained and unreliable; session history ' +
      'is the ground truth for what an agent actually did. By default the ' +
      'response is filtered to turn-completion messages (one summary per ' +
      'agent turn, typically 3–4 per session), which almost always report ' +
      'the files changed and outcomes. Exactly one of taskId or serviceId ' +
      'must be provided.',
    parameters: getAgentSessionsParameters,
    outputSchema: getAgentSessionsOutput,
  })
  async getAgentSessions(
    params: z.infer<typeof getAgentSessionsParameters>,
    _context: Context,
    request: Request,
  ): Promise<GetAgentSessionsOutput | CallToolResult> {
    const auth = extractAuthContext({}, request);
    if (!isAuthContext(auth)) return auth;

    const projectId = resolveProjectId({}, request);
    if (!isProjectId(projectId)) return projectId;

    const { taskId, serviceId, limit, offset } = params;

    if ((!taskId && !serviceId) || (taskId && serviceId)) {
      return mcpError('Exactly one of taskId or serviceId must be provided.');
    }

    const organizationId = auth.organizationId;

    try {
      const sessions = await this.loadSessions(organizationId, projectId, {
        taskId,
        serviceId,
        limit,
        offset,
      });

      if (sessions.length === 0) {
        return { sessions: [], hasMore: false };
      }

      const hasMore = sessions.length > limit;
      const paged = hasMore ? sessions.slice(0, limit) : sessions;

      const conversationIds = paged
        .map((s) => s.conversationId)
        .filter((id): id is string => id !== null);
      const { messagesByConversation, rawRowCount } =
        await this.loadMessages(conversationIds);

      const mapped: GetAgentSessionsOutput['sessions'] = paged.map(
        (session) => {
          const turnCompletions = session.conversationId
            ? (messagesByConversation.get(session.conversationId) ?? [])
            : [];

          const sessionTaskId =
            session.entityType === 'TASK' ? session.entityId : null;
          return {
            agentSessionId: session.id,
            title: session.title,
            status: session.status,
            provider: session.provider ?? undefined,
            taskId: sessionTaskId ?? undefined,
            serviceId: session.serviceId ?? undefined,
            serviceName: session.service?.name ?? undefined,
            sessionDate: session.sessionDate.toISOString(),
            conversationId: session.conversationId,
            messages: turnCompletions.map((msg) => this.mapMessage(msg)),
          };
        },
      );

      const turnCompletionCount = mapped.reduce(
        (sum, s) => sum + s.messages.length,
        0,
      );

      const sessionsWithConversation = conversationIds.length;
      const sessionsWithoutConversation =
        mapped.length - sessionsWithConversation;
      this.logger.log(
        `get_agent_sessions returned ${mapped.length} session(s) ` +
          `(${sessionsWithConversation} with conversation, ${sessionsWithoutConversation} without) ` +
          `with ${turnCompletionCount} turn-completion(s) ` +
          `(filtered from ${rawRowCount} SYSTEM row(s))`,
        {
          organizationId,
          filter: taskId ? { taskId } : { serviceId },
        },
      );

      return { sessions: mapped, hasMore };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.warn(`get_agent_sessions failed: ${message}`, stack);
      return mcpError(`Failed to retrieve agent sessions: ${message}`);
    }
  }

  /**
   * Load agent sessions scoped to organization + project, filtered
   * by taskId or serviceId. Over-fetches by 1 to detect hasMore.
   * Joins service name when available.
   */
  private async loadSessions(
    organizationId: OrganizationId,
    projectId: string,
    opts: {
      taskId?: string;
      serviceId?: string;
      limit: number;
      offset: number;
    },
  ): Promise<AgentSessionRow[]> {
    const rows = await this.prisma.db.agentSession.findMany({
      where: {
        organizationId,
        projectId,
        ...(opts.taskId ? { entityType: 'TASK', entityId: opts.taskId } : {}),
        ...(opts.serviceId ? { serviceId: opts.serviceId } : {}),
      },
      select: {
        id: true,
        title: true,
        status: true,
        provider: true,
        entityType: true,
        entityId: true,
        serviceId: true,
        sessionDate: true,
        conversationId: true,
        service: { select: { name: true } },
      },
      orderBy: { sessionDate: 'desc' },
      take: opts.limit + 1,
      skip: opts.offset,
    });

    return rows;
  }

  /**
   * Batch-load turn-completion messages for a set of conversations,
   * grouped by conversationId. A turn-completion is a SYSTEM message
   * whose JSON payload has `data.actionHint === 'task_complete'` — the
   * field the agent CLI sets when it reports what was accomplished in a
   * turn (which almost always includes files changed and outcomes).
   * Filtering runs in-memory because Prisma's JSON path filter isn't
   * available on SQLite (used by the functional test runner).
   *
   * Query runs `createdAt: 'desc'` so that if a conversation ever
   * exceeds MAX_MESSAGES_PER_CONVERSATION we keep the newest
   * completions (the ones agents almost always care about) rather than
   * silently dropping them. The per-conversation list is then reversed
   * back into chronological order for the caller.
   */
  private async loadMessages(conversationIds: string[]): Promise<{
    messagesByConversation: Map<string, MessageRow[]>;
    rawRowCount: number;
  }> {
    const messages = await this.prisma.db.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        type: 'SYSTEM',
        ...TIMELINE_MESSAGE_WHERE,
      },
      select: {
        id: true,
        conversationId: true,
        type: true,
        data: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const grouped = new Map<string, MessageRow[]>();
    for (const msg of messages) {
      const row = { ...msg, createdAt: timelineCreatedAt(msg) };
      if (!this.isTurnCompletion(row)) continue;
      const list = grouped.get(msg.conversationId) ?? [];
      if (list.length < MAX_MESSAGES_PER_CONVERSATION) {
        list.push(row);
        grouped.set(msg.conversationId, list);
      } else {
        this.logger.warn(
          `Conversation ${msg.conversationId} exceeded ` +
            `${MAX_MESSAGES_PER_CONVERSATION} turn-completion(s); ` +
            'older completions were truncated.',
        );
      }
    }

    for (const [conversationId, list] of grouped) {
      grouped.set(conversationId, list.reverse());
    }

    return { messagesByConversation: grouped, rawRowCount: messages.length };
  }

  /**
   * Turn-completion predicate: SYSTEM message whose JSON `data.actionHint`
   * equals 'task_complete'.
   */
  private isTurnCompletion(msg: MessageRow): boolean {
    if (msg.type !== 'SYSTEM') return false;
    const data = (msg.data ?? {}) as Record<string, unknown>;
    return data.actionHint === TURN_COMPLETE_ACTION_HINT;
  }

  /**
   * Map a turn-completion row to the compact agent-facing shape. The
   * content lives in `data.response`; other SystemMessageData fields
   * (uiElements, actions, etc.) are intentionally dropped.
   */
  private mapMessage(msg: MessageRow): z.infer<typeof mcpMessageSchema> {
    const data = (msg.data ?? {}) as Record<string, unknown>;
    return {
      role: 'system',
      content: typeof data.response === 'string' ? data.response : '',
      createdAt: msg.createdAt.toISOString(),
    };
  }
}

/**
 * `search_session` pass-through submission tool.
 *
 * Lets the entity-conversation agent recall across every conversation that
 * hangs off the same workflow-about entity (e.g. a goal): it searches the
 * platform's goal-scoped message index and returns the matching rows verbatim
 * in a single MCP `text` block.
 *
 * The active Run carries `conversationId` and `projectId` but NOT the
 * workflow-about, so the tool first resolves the active conversation's
 * `workflowAboutId` / `workflowAboutType` through the injected reader. A
 * conversation not attached to a workflow-about entity has nothing to recall
 * across — the tool refuses to run there rather than silently searching an
 * empty scope.
 */

import { SearchMessagesProxy, type WorkflowAboutReader } from './search-messages-proxy';
import type { SubmissionToolAuth } from './submission-tool-auth';
import type { PassThroughSubmissionToolDeclaration, SubmissionToolExecuteContext } from './types';

const SEARCH_SESSION_TOOL_NAME = 'search_session';

const QUERY_MIN = 2;
const LIMIT_MAX = 50;
const LIMIT_DEFAULT = 20;

const SEARCH_SESSION_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    query: { type: 'string', minLength: QUERY_MIN },
    limit: { type: 'number', maximum: LIMIT_MAX, default: LIMIT_DEFAULT },
  },
  required: ['query'],
} as const;

export interface SearchSessionToolDependencies {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
}

class SearchSessionToolError extends Error {
  readonly code: 'MISSING_RUN' | 'INVALID_QUERY' | 'NOT_AN_ENTITY_CONVERSATION';
  constructor(code: SearchSessionToolError['code'], message: string) {
    super(message);
    this.name = 'SearchSessionToolError';
    this.code = code;
  }
}

export class SearchSessionTool implements PassThroughSubmissionToolDeclaration {
  public readonly kind = 'pass_through' as const;
  public readonly name = SEARCH_SESSION_TOOL_NAME;
  public readonly description =
    'Search across every conversation attached to this goal and return the matching messages (conversation, snippet, timestamp). Use it to recall earlier decisions, commitments, or discussions before answering. `query` must be at least 2 characters; `limit` defaults to 20 (max 50).';
  public readonly inputSchema = SEARCH_SESSION_INPUT_SCHEMA as unknown as Record<string, unknown>;
  private readonly searchMessagesProxy: SearchMessagesProxy;

  public constructor(
    dependencies: SearchSessionToolDependencies,
    private readonly workflowAboutReader: WorkflowAboutReader,
  ) {
    this.searchMessagesProxy = new SearchMessagesProxy({
      auth: dependencies.auth,
      apiBaseUrl: dependencies.apiBaseUrl,
    });
  }

  public readonly execute = async (ctx: SubmissionToolExecuteContext) => {
    const run = ctx.run;
    if (!run) {
      throw new SearchSessionToolError(
        'MISSING_RUN',
        'search_session wrapper: ctx.run is required for pass-through tools',
      );
    }

    const queryRaw = ctx.args['query'];
    if (typeof queryRaw !== 'string' || queryRaw.trim().length < QUERY_MIN) {
      throw new SearchSessionToolError(
        'INVALID_QUERY',
        `search_session wrapper: query must be a string of at least ${QUERY_MIN} characters`,
      );
    }
    const query = queryRaw.trim();

    const limitRaw = ctx.args['limit'];
    const limit = typeof limitRaw === 'number' ? Math.min(limitRaw, LIMIT_MAX) : LIMIT_DEFAULT;

    const { workflowAboutId, workflowAboutType } = await this.workflowAboutReader.read({
      projectId: run.projectId,
      conversationId: run.conversationId,
    });
    if (!workflowAboutId || !workflowAboutType) {
      throw new SearchSessionToolError(
        'NOT_AN_ENTITY_CONVERSATION',
        'search_session can only run inside an entity conversation — the active conversation is not attached to a workflow-about entity',
      );
    }

    const rows = await this.searchMessagesProxy.search({
      projectId: run.projectId,
      workflowAboutId,
      workflowAboutType,
      query,
      limit,
    });

    const projected = rows.map((row) => ({
      conversationId: row.conversationId,
      conversationTitle: row.conversationTitle,
      messageId: row.messageId,
      snippet: row.snippet,
      createdAt: row.createdAt,
    }));

    return { content: [{ type: 'text', text: JSON.stringify(projected) }] };
  };
}

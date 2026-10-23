/**
 * Thin proxy client that runs the platform's goal-scoped message search on
 * behalf of the `search_session` pass-through submission tool.
 *
 * Unlike the sibling update-conversation REST proxy, this proxy does NOT
 * hand-build the URL: the
 * search endpoint has a regenerated typed client surface
 * (`DefaultApi.searchConversationMessages`), so we drive that directly and let
 * the generated client own the path, query-string, and auth wiring. The proxy
 * resolves the organization id from the access token (the search path is
 * org-scoped) and validates the returned rows before handing them back.
 *
 * Error taxonomy (TOOL_ERROR / INVALID_RESPONSE / MISSING_ORGANIZATION_ID) is
 * intentionally aligned with the sibling proxies so failures surface the same
 * way regardless of which transport a proxy uses.
 */

import { z } from 'zod';
import {
  AgentSessionsApi,
  ConversationsApi,
  SearchApi,
  DesignDocsApi,
  EntityContextApi,
  ProjectsApi,
  TasksApi,
  type SearchConversationMessagesResponseDto,
} from '../../shared/api/generated/api';
import { Configuration } from '../../shared/api/generated/configuration';
import { extractOrganizationIdFromToken } from '../../auth/index';
import type { SubmissionToolAuth } from './submission-tool-auth';

/**
 * The slices of the generated client these helpers actually call. Narrowing to
 * a `Pick` keeps the test seam tiny — a fake only has to implement the one
 * method — and avoids coupling to the whole `DefaultApi` surface.
 */
export type SearchMessagesApiClient = Pick<SearchApi, 'searchConversationMessages'>;
export type GetConversationApiClient = Pick<ConversationsApi, 'getConversation'>;
type GetAgentSessionApiClient = {
  getAgentSession: AgentSessionsApi['getAgentSession'];
};
type GetDesignDocApiClient = {
  organizationsOrganizationIdDesignDocsDesignDocIdGet: DesignDocsApi['getDesignDoc'];
};
type GetWorkItemApiClient = Pick<
  TasksApi,
  'organizationsOrganizationIdProjectsProjectIdTasksTaskIdGet'
>;
type GetCanonicalEntityContextApiClient = Pick<EntityContextApi, 'getEntityContext'>;
type GetProjectApiClient = Pick<ProjectsApi, 'findOneProject'>;
export type EntityContextApiClient = GetConversationApiClient &
  Pick<ConversationsApi, 'getMessages'> &
  GetAgentSessionApiClient &
  GetProjectApiClient &
  GetDesignDocApiClient &
  GetWorkItemApiClient &
  GetCanonicalEntityContextApiClient;

export interface SearchMessagesProxyOptions {
  /**
   * Resolve a fresh platform OAuth bearer token. Called per request so
   * proxied calls inherit refreshed tokens. Matches the sibling proxies.
   */
  auth: SubmissionToolAuth;
  /**
   * Normalized REST base URL — must already include the `/api/v1` segment, the
   * prefix the generated client paths are written against. The CLI bootstrap
   * derives this once via the same `normalizedApiBaseUrl` other server-side
   * adapters use.
   */
  apiBaseUrl: string;
  /**
   * Construct the generated client for a given access token. Defaulted to a
   * freshly-configured `DefaultApi` per call in production wiring; tests inject
   * a fake so no network (or axios) is exercised.
   */
  createClient?: (accessToken: string) => SearchMessagesApiClient;
}

export interface SearchMessagesProxyInput {
  /** Active project id — the search is scoped to it. */
  projectId: string;
  /** Entity the active conversation hangs off — the goal the search recalls across. */
  workflowAboutId: string;
  /** Entity type for `workflowAboutId` (e.g. `goal`, `task`). */
  workflowAboutType: string;
  /** Raw query string forwarded verbatim. */
  query: string;
  /** Maximum rows to return. Forwarded verbatim; omitted lets the server default. */
  limit?: number;
}

export class SearchMessagesProxyError extends Error {
  readonly code: 'TOOL_ERROR' | 'INVALID_RESPONSE' | 'MISSING_ORGANIZATION_ID';
  readonly details: unknown;
  constructor(
    code: SearchMessagesProxyError['code'],
    message: string,
    details: unknown = undefined,
  ) {
    super(message);
    this.name = 'SearchMessagesProxyError';
    this.code = code;
    this.details = details;
  }
}

const rowSchema = z
  .object({
    conversationId: z.string(),
    conversationTitle: z.string().nullable(),
    messageId: z.string(),
    snippet: z.string(),
    createdAt: z.string(),
    type: z.string(),
  })
  .passthrough();

export class SearchMessagesProxy {
  private readonly auth: SubmissionToolAuth;
  private readonly createClient: (accessToken: string) => SearchMessagesApiClient;

  public constructor(options: SearchMessagesProxyOptions) {
    this.auth = options.auth;
    this.createClient =
      options.createClient ??
      ((accessToken: string): SearchMessagesApiClient =>
        new SearchApi(new Configuration({ accessToken, basePath: options.apiBaseUrl })));
  }

  public async search(
    input: SearchMessagesProxyInput,
  ): Promise<SearchConversationMessagesResponseDto[]> {
    const token = await this.auth.getAccessToken();
    const organizationId = extractOrganizationIdFromToken(token);
    if (!organizationId) {
      // The search path is org-scoped — without an org id from the token we
      // cannot even build the request. Refuse loudly instead of producing a 4xx.
      throw new SearchMessagesProxyError(
        'MISSING_ORGANIZATION_ID',
        'Platform search_messages could not resolve an organization id from the access token',
      );
    }

    let rows: unknown;
    try {
      const response = await this.createClient(token).searchConversationMessages({
        organizationId,
        projectId: input.projectId,
        workflowAboutId: input.workflowAboutId,
        workflowAboutType: input.workflowAboutType,
        query: input.query,
        ...(input.limit !== undefined ? { limit: input.limit } : {}),
      });
      rows = response.data?.data ?? [];
    } catch (error) {
      throw new SearchMessagesProxyError(
        'TOOL_ERROR',
        'Platform search_messages request failed',
        error,
      );
    }

    const parsed = z.array(rowSchema).safeParse(rows);
    if (!parsed.success) {
      throw new SearchMessagesProxyError(
        'INVALID_RESPONSE',
        'Platform search_messages response rows did not match the expected shape',
        parsed.error.issues,
      );
    }

    return parsed.data as SearchConversationMessagesResponseDto[];
  }
}

export interface WorkflowAboutReaderOptions {
  auth: SubmissionToolAuth;
  apiBaseUrl: string;
  createClient?: (accessToken: string) => GetConversationApiClient;
}

export interface WorkflowAbout {
  workflowAboutId: string | null;
  workflowAboutType: string | null;
}

/**
 * Reads a conversation's `workflowAboutId` / `workflowAboutType` off the
 * generated `getConversation` client. The active Run does not carry the
 * workflow-about, so `search_session` resolves it through here before scoping
 * its search. Returns the raw (possibly null) fields — the caller decides
 * whether a missing attachment is an error.
 */
export class WorkflowAboutReader {
  private readonly auth: SubmissionToolAuth;
  private readonly createClient: (accessToken: string) => GetConversationApiClient;

  public constructor(options: WorkflowAboutReaderOptions) {
    this.auth = options.auth;
    this.createClient =
      options.createClient ??
      ((accessToken: string): GetConversationApiClient =>
        new ConversationsApi(new Configuration({ accessToken, basePath: options.apiBaseUrl })));
  }

  public async read(input: { projectId: string; conversationId: string }): Promise<WorkflowAbout> {
    const token = await this.auth.getAccessToken();
    const organizationId = extractOrganizationIdFromToken(token);
    if (!organizationId) {
      throw new SearchMessagesProxyError(
        'MISSING_ORGANIZATION_ID',
        'Platform get_conversation could not resolve an organization id from the access token',
      );
    }
    const response = await this.createClient(token).getConversation({
      organizationId,
      projectId: input.projectId,
      conversationId: input.conversationId,
    });
    const conversation = response.data?.data;
    return {
      workflowAboutId: conversation?.workflowAboutId ?? null,
      workflowAboutType: conversation?.workflowAboutType ?? null,
    };
  }
}

/**
 * Thin proxy client that PATCHes the platform's conversation-update REST
 * endpoint on behalf of a local pass-through submission tool.
 *
 * The entity-conversation handler exposes a single pass-through submission
 * tool (`submit_session_name`) that renames the active conversation by
 * updating its `title`. The platform's PATCH /conversations/{id} endpoint
 * lives at the REST root (NOT under /mcp), and requires an `expectedVersion`
 * for optimistic locking — so the proxy GETs the current version, sends the
 * PATCH, and on a 409 (version mismatch) refetches once and retries. Any
 * other non-2xx, or a second mismatch, surfaces as a typed error.
 *
 * Its error taxonomy (TOOL_ERROR / INVALID_RESPONSE / MISSING_*), context
 * headers, and "always-derivable-result-or-throw" contract stay aligned with
 * the other submission-tool REST proxies.
 */

import { z } from 'zod';
import { extractOrganizationIdFromToken } from '../../auth/index';
import type { SubmissionToolAuth } from './submission-tool-auth';
import type { SubmissionToolMcpContent } from './types';

const conversationVersionSchema = z.object({ version: z.number() }).passthrough();
const conversationUpdateSchema = z
  .object({ id: z.string().min(1), title: z.string().optional() })
  .passthrough();

export interface UpdateConversationProxyOptions {
  /**
   * Resolve a fresh platform OAuth bearer token. Called per request so
   * proxied calls inherit refreshed tokens.
   */
  auth: SubmissionToolAuth;
  /**
   * Normalized REST base URL — must already include the `/api/v1` segment.
   * The CLI bootstrap derives this once via the same `normalizedApiBaseUrl`
   * other server-side adapters use.
   */
  apiBaseUrl: string;
  /**
   * fetch implementation. Defaulted to global `fetch` in production wiring;
   * tests inject a fake so no network is exercised.
   */
  fetchImpl?: typeof fetch;
}

export interface UpdateConversationProxyInput {
  /** New title to set on the conversation. */
  title: string;
  /** Active Run id — propagated as `X-Agent-Session-ID`. */
  runId: string;
  /** Conversation id to update — both the URL parameter and `X-Conversation-ID`. */
  conversationId: string;
  /** Active project id — propagated as `X-Project-ID` and into the URL. */
  projectId: string;
}

export interface UpdateConversationProxyResult {
  /**
   * MCP content blocks built from the persisted DTO so a pass-through tool
   * can forward them to the agent verbatim. Single text block holding the
   * stringified DTO — mirrors how platform MCP tools serialize their
   * `outputSchema`-typed return values.
   */
  content: ReadonlyArray<SubmissionToolMcpContent>;
  /** The conversation id that was updated. */
  conversationId: string;
  /** The title the platform returned after the PATCH succeeded. */
  title: string;
}

export class UpdateConversationProxyError extends Error {
  readonly code:
    | 'TOOL_ERROR'
    | 'INVALID_RESPONSE'
    | 'MISSING_VERSION'
    | 'MISSING_TITLE'
    | 'MISSING_ORGANIZATION_ID'
    | 'VERSION_CONFLICT';
  readonly details: unknown;
  constructor(
    code: UpdateConversationProxyError['code'],
    message: string,
    details: unknown = undefined,
  ) {
    super(message);
    this.name = 'UpdateConversationProxyError';
    this.code = code;
    this.details = details;
  }
}

const buildConversationUrl = (
  apiBaseUrl: string,
  organizationId: string,
  projectId: string,
  conversationId: string,
): string => {
  const trimmed = apiBaseUrl.replace(/\/$/u, '');
  return `${trimmed}/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(
    projectId,
  )}/conversations/${encodeURIComponent(conversationId)}`;
};

const unwrapEnvelope = (parsed: unknown): unknown => {
  if (
    parsed &&
    typeof parsed === 'object' &&
    'data' in (parsed as Record<string, unknown>) &&
    (parsed as Record<string, unknown>)['data'] !== null &&
    typeof (parsed as Record<string, unknown>)['data'] === 'object'
  ) {
    return (parsed as Record<string, unknown>)['data'];
  }
  return parsed;
};

export class UpdateConversationProxy {
  private readonly auth: SubmissionToolAuth;
  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;

  public constructor(options: UpdateConversationProxyOptions) {
    this.auth = options.auth;
    this.apiBaseUrl = options.apiBaseUrl;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public async update(input: UpdateConversationProxyInput): Promise<UpdateConversationProxyResult> {
    const token = await this.auth.getAccessToken();
    const organizationId = extractOrganizationIdFromToken(token);
    if (!organizationId) {
      throw new UpdateConversationProxyError(
        'MISSING_ORGANIZATION_ID',
        'Platform update_conversation could not resolve an organization id from the access token',
      );
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Organization-ID': organizationId,
      'X-Project-ID': input.projectId,
      'X-Agent-Session-ID': input.runId,
      'X-Conversation-ID': input.conversationId,
    };

    const url = buildConversationUrl(
      this.apiBaseUrl,
      organizationId,
      input.projectId,
      input.conversationId,
    );

    const fetchCurrentVersion = async (): Promise<number> => {
      const response = await this.fetchImpl(url, { method: 'GET', headers });
      const rawText = await response.text();
      if (!response.ok) {
        throw new UpdateConversationProxyError(
          'TOOL_ERROR',
          `Platform get_conversation returned HTTP ${response.status}`,
          { status: response.status, body: rawText },
        );
      }
      let parsedJson: unknown;
      try {
        parsedJson = rawText.length === 0 ? null : JSON.parse(rawText);
      } catch (error) {
        throw new UpdateConversationProxyError(
          'INVALID_RESPONSE',
          'Platform get_conversation response body is not valid JSON',
          error,
        );
      }
      const parsed = conversationVersionSchema.safeParse(unwrapEnvelope(parsedJson));
      if (!parsed.success) {
        throw new UpdateConversationProxyError(
          'MISSING_VERSION',
          'Platform get_conversation response did not include a version',
          parsed.error.issues,
        );
      }
      return parsed.data.version;
    };

    const attemptPatch = async (
      expectedVersion: number,
    ): Promise<{ status: number; rawText: string }> => {
      const response = await this.fetchImpl(url, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ expectedVersion, title: input.title }),
      });
      const rawText = await response.text();
      return { status: response.status, rawText };
    };

    let currentVersion = await fetchCurrentVersion();
    let { status, rawText } = await attemptPatch(currentVersion);

    if (status === 409) {
      // One refetch+retry on optimistic-lock collision. A second collision
      // means something else is racing this update — surface it as
      // VERSION_CONFLICT rather than silently looping.
      currentVersion = await fetchCurrentVersion();
      ({ status, rawText } = await attemptPatch(currentVersion));
      if (status === 409) {
        throw new UpdateConversationProxyError(
          'VERSION_CONFLICT',
          'Platform update_conversation reported a version conflict on retry',
          { status, body: rawText },
        );
      }
    }

    if (status < 200 || status >= 300) {
      throw new UpdateConversationProxyError(
        'TOOL_ERROR',
        `Platform update_conversation returned HTTP ${status}`,
        { status, body: rawText },
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = rawText.length === 0 ? null : JSON.parse(rawText);
    } catch (error) {
      throw new UpdateConversationProxyError(
        'INVALID_RESPONSE',
        'Platform update_conversation response body is not valid JSON',
        error,
      );
    }

    const parsed = conversationUpdateSchema.safeParse(unwrapEnvelope(parsedJson));
    if (!parsed.success) {
      throw new UpdateConversationProxyError(
        'INVALID_RESPONSE',
        'Platform update_conversation response did not include a conversation id',
        parsed.error.issues,
      );
    }

    const title = typeof parsed.data.title === 'string' ? parsed.data.title : null;
    if (title === null) {
      throw new UpdateConversationProxyError(
        'MISSING_TITLE',
        'Platform update_conversation response did not include a title',
        parsed.data,
      );
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(parsed.data) }],
      conversationId: parsed.data.id,
      title,
    };
  }
}

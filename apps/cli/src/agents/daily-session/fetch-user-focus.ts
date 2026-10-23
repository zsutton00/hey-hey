import type { ServerLogger } from '../../server/logger';

export interface FetchUserFocusDeps {
  organizationId: string;
  projectId: string;
  conversationId: string;
  fetchImpl: typeof fetch;
  accessToken: string;
  apiBaseUrl: string;
  logger?: ServerLogger;
}

interface MessageRecord {
  type?: string;
  data?: { comment?: string; text?: string; [key: string]: unknown };
  createdAt?: string;
}

/**
 * Fetches the most recent user message from the daily session conversation.
 * Returns the message text, or null if no user message exists.
 */
export async function fetchUserFocusMessage(deps: FetchUserFocusDeps): Promise<string | null> {
  const { organizationId, projectId, conversationId, fetchImpl, accessToken, apiBaseUrl } = deps;

  const params = new URLSearchParams({
    conversationId,
    type: 'USER',
    limit: '1',
  });

  const url =
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/messages?${params.toString()}`;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      deps.logger?.warn('daily_session.fetch_user_focus.http_error', {
        status: response.status,
        conversationId,
      });
      return null;
    }

    const body = (await response.json()) as {
      data?: MessageRecord[];
      [key: string]: unknown;
    };

    const messages = Array.isArray(body.data) ? body.data : [];
    const latest = messages[0];
    if (!latest) return null;

    const text =
      (typeof latest.data?.comment === 'string' ? latest.data.comment.trim() : null) ??
      (typeof latest.data?.text === 'string' ? latest.data.text.trim() : null);

    if (!text) return null;

    deps.logger?.info('daily_session.fetch_user_focus.found', {
      conversationId,
      messageLength: text.length,
    });

    return text;
  } catch (error) {
    deps.logger?.warn('daily_session.fetch_user_focus.failed', {
      conversationId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

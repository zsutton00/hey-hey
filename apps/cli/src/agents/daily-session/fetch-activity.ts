import type { ActivityRecord } from './types';
import type { ServerLogger } from '../../server/logger';

const ACTIVITY_FETCH_LIMIT = 20;

export interface FetchActivityDeps {
  organizationId: string;
  projectId: string;
  fetchImpl: typeof fetch;
  accessToken: string;
  apiBaseUrl: string;
  logger?: ServerLogger;
  limit?: number;
}

/**
 * Fetches recent correlated activity from the platform API.
 * Returns an empty array on failure (non-fatal).
 */
export async function fetchRecentActivity(deps: FetchActivityDeps): Promise<ActivityRecord[]> {
  const { organizationId, projectId, fetchImpl, accessToken, apiBaseUrl } = deps;
  const limit = deps.limit ?? ACTIVITY_FETCH_LIMIT;

  const params = new URLSearchParams({
    projectId,
    mode: 'TASK',
    sort: 'LAST_MESSAGE',
    limit: String(limit),
    offset: '0',
  });

  const url =
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}` +
    `/activity-correlations?${params.toString()}`;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      deps.logger?.warn('daily_session.fetch_activity.http_error', {
        status: response.status,
        organizationId,
        projectId,
      });
      return [];
    }

    const body = (await response.json()) as { data?: ActivityRecord[]; records?: ActivityRecord[] };
    const records = body.records ?? body.data ?? (Array.isArray(body) ? body : []);
    deps.logger?.info('daily_session.fetch_activity.success', {
      organizationId,
      projectId,
      recordCount: records.length,
    });
    return records;
  } catch (error) {
    deps.logger?.warn('daily_session.fetch_activity.failed', {
      organizationId,
      projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}

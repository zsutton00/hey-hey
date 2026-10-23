import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { reportErrorSchemas } from '../../shared/api/generated/report-error-schemas';
import type { ServerLogger } from '../../server/logger';
import type { ActiveGoalDto } from '../../shared/api/generated/api';

export interface FetchActiveGoalsDeps {
  organizationId: string;
  projectId: string;
  userId: string;
  fetchImpl: typeof fetch;
  accessToken: string;
  apiBaseUrl: string;
  logger?: ServerLogger;
  windowDays?: number;
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const isActiveGoalDto = ajv.compile<ActiveGoalDto>(reportErrorSchemas.ActiveGoalDto);

/**
 * Fetches GOAL-typed tasks in the project that are active for the user within
 * a look-ahead window. Returns an empty array when the user has no active
 * goals, on transport failure, or when the response body is malformed.
 */
export async function fetchActiveGoals(deps: FetchActiveGoalsDeps): Promise<ActiveGoalDto[]> {
  const { organizationId, projectId, userId, fetchImpl, accessToken, apiBaseUrl } = deps;

  const params = new URLSearchParams({ userId });
  if (typeof deps.windowDays === 'number') {
    params.set('windowDays', String(deps.windowDays));
  }

  const url =
    `${apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/goals/active?${params.toString()}`;

  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      deps.logger?.warn('daily_session.fetch_active_goals.http_error', {
        status: response.status,
        organizationId,
        projectId,
        userId,
      });
      return [];
    }

    const body = (await response.json()) as {
      data?: { items?: unknown };
      [key: string]: unknown;
    };

    const rawItems = body?.data?.items;
    if (!Array.isArray(rawItems)) {
      deps.logger?.warn('daily_session.fetch_active_goals.malformed_body', {
        organizationId,
        projectId,
        userId,
      });
      return [];
    }

    const items: ActiveGoalDto[] = [];
    for (const item of rawItems) {
      if (isActiveGoalDto(item)) {
        items.push(item);
      } else {
        deps.logger?.warn('daily_session.fetch_active_goals.invalid_item', {
          organizationId,
          projectId,
          userId,
        });
      }
    }

    deps.logger?.info('daily_session.fetch_active_goals.success', {
      organizationId,
      projectId,
      userId,
      goalCount: items.length,
    });

    return items;
  } catch (error) {
    deps.logger?.warn('daily_session.fetch_active_goals.failed', {
      organizationId,
      projectId,
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
}

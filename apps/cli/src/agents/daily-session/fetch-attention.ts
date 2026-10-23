import { z } from 'zod';
import { EntityType } from '../../shared/api/generated/api';
import type { ServerLogger } from '../../server/logger';
import type { ActivityRecord, DailySessionAttentionEvidence } from './types';

const ATTENTION_FETCH_LIMIT = 50;

const attentionEventSchema = z.object({
  id: z.string().min(1),
  entityType: z.nativeEnum(EntityType),
  entityId: z.string().min(1),
  entityName: z.string().min(1),
  tab: z.string().nullable().optional(),
  focusStart: z.string().min(1),
  focusEnd: z.string().min(1),
  durationMs: z.number().finite(),
});

const attentionResponseSchema = z.object({
  data: z
    .object({
      events: z.array(attentionEventSchema),
    })
    .optional(),
});

export interface FetchAttentionDeps {
  organizationId: string;
  projectId: string;
  activitySnapshot: readonly ActivityRecord[];
  fetchImpl: typeof fetch;
  accessToken: string;
  apiBaseUrl: string;
  logger?: ServerLogger;
  limit?: number;
}

const boundedLimit = (limit: number | undefined): number => {
  const requested = Math.trunc(limit ?? ATTENTION_FETCH_LIMIT);
  if (!Number.isFinite(requested)) return ATTENTION_FETCH_LIMIT;
  return Math.min(Math.max(requested, 1), ATTENTION_FETCH_LIMIT);
};

/**
 * Uses the oldest valid activity-feed timestamp as the lower bound for the
 * attention query. This makes both evidence sets describe the same visible
 * recent window; when the feed has no usable timestamps, the API's default
 * recent window remains authoritative.
 */
export const deriveAttentionSince = (
  activitySnapshot: readonly ActivityRecord[],
): string | undefined => {
  let earliestTimestamp = Number.POSITIVE_INFINITY;

  for (const record of activitySnapshot) {
    const timestamp = Date.parse(record.timestamp);
    if (Number.isFinite(timestamp) && timestamp < earliestTimestamp) {
      earliestTimestamp = timestamp;
    }
  }

  return Number.isFinite(earliestTimestamp) ? new Date(earliestTimestamp).toISOString() : undefined;
};

/**
 * Reads project-scoped Recently Viewed evidence without making coaching
 * dependent on analytics availability. The response is validated before any
 * fields enter the prompt.
 */
export const fetchRecentAttention = async (
  deps: FetchAttentionDeps,
): Promise<DailySessionAttentionEvidence[]> => {
  const params = new URLSearchParams({
    limit: String(boundedLimit(deps.limit)),
    offset: '0',
    sort: 'mostRecent',
    projectId: deps.projectId,
  });
  const since = deriveAttentionSince(deps.activitySnapshot);
  if (since) params.set('since', since);

  const url = `${deps.apiBaseUrl}/analytics/attention?${params.toString()}`;

  try {
    deps.logger?.debug('daily_session.fetch_attention.started', {
      organizationId: deps.organizationId,
      projectId: deps.projectId,
      limit: boundedLimit(deps.limit),
      since: since ?? null,
    });

    const response = await deps.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${deps.accessToken}` },
    });

    if (!response.ok) {
      deps.logger?.warn('daily_session.fetch_attention.http_error', {
        organizationId: deps.organizationId,
        projectId: deps.projectId,
        status: response.status,
      });
      return [];
    }

    const parsed = attentionResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      deps.logger?.warn('daily_session.fetch_attention.malformed_body', {
        organizationId: deps.organizationId,
        projectId: deps.projectId,
        issueCount: parsed.error.issues.length,
      });
      return [];
    }

    const events = parsed.data.data?.events ?? [];
    const evidence = events.map((event) => {
      const mapped = {
        entityType: event.entityType,
        entityId: event.entityId,
        entityName: event.entityName,
        focusStart: event.focusStart,
        focusEnd: event.focusEnd,
        durationMs: event.durationMs,
        ...(event.tab !== undefined ? { tab: event.tab } : {}),
      } satisfies DailySessionAttentionEvidence;
      return mapped;
    });

    deps.logger?.info('daily_session.fetch_attention.success', {
      organizationId: deps.organizationId,
      projectId: deps.projectId,
      eventCount: evidence.length,
    });
    return evidence;
  } catch (error) {
    deps.logger?.warn('daily_session.fetch_attention.failed', {
      organizationId: deps.organizationId,
      projectId: deps.projectId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return [];
  }
};

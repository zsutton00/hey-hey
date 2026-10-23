import { describe, expect, it, vi } from 'vitest';
import { deriveAttentionSince, fetchRecentAttention } from '../fetch-attention';
import type { ActivityRecord } from '../types';

const baseDeps = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  accessToken: 'test-token',
  apiBaseUrl: 'https://api.example.com/api/v1',
};

const makeResponse = (body: unknown, ok = true): Response =>
  new Response(JSON.stringify(body), { status: ok ? 200 : 500 });

const activity = (timestamp: string): ActivityRecord =>
  ({
    entityId: `task-${timestamp}`,
    entityType: 'TASK',
    title: 'Task',
    timestamp,
    linkedEntities: [],
    reports: [],
  }) as ActivityRecord;

const attentionEvent = {
  id: 'attention-1',
  entityType: 'TASK',
  entityId: 'task-1',
  entityName: 'Ship the dashboard',
  tab: 'overview',
  focusStart: '2026-01-02T10:00:00.000Z',
  focusEnd: '2026-01-02T10:05:00.000Z',
  durationMs: 300000,
};

describe('fetchRecentAttention', () => {
  it('requests project-scoped, bounded recent attention using the activity window', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ data: { events: [attentionEvent], pagination: { total: 1 } } }),
      );

    const result = await fetchRecentAttention({
      ...baseDeps,
      fetchImpl,
      activitySnapshot: [
        activity('2026-01-02T12:00:00.000Z'),
        activity('2026-01-01T12:00:00.000Z'),
      ],
      limit: 100,
    });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.pathname).toBe('/api/v1/analytics/attention');
    expect(parsedUrl.searchParams.get('projectId')).toBe('proj-1');
    expect(parsedUrl.searchParams.get('limit')).toBe('50');
    expect(parsedUrl.searchParams.get('offset')).toBe('0');
    expect(parsedUrl.searchParams.get('sort')).toBe('mostRecent');
    expect(parsedUrl.searchParams.get('since')).toBe('2026-01-01T12:00:00.000Z');
    expect(options?.headers).toEqual({ Authorization: 'Bearer test-token' });
    expect(result).toEqual([
      {
        entityType: 'TASK',
        entityId: 'task-1',
        entityName: 'Ship the dashboard',
        tab: 'overview',
        focusStart: '2026-01-02T10:00:00.000Z',
        focusEnd: '2026-01-02T10:05:00.000Z',
        durationMs: 300000,
      },
    ]);
  });

  it('omits since when the activity feed has no valid timestamps', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ data: { events: [], pagination: { total: 0 } } }));

    await fetchRecentAttention({
      ...baseDeps,
      fetchImpl,
      activitySnapshot: [activity('not-a-date')],
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(new URL(String(url)).searchParams.has('since')).toBe(false);
  });

  it('returns only validated evidence and drops the optional full entity payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        data: {
          events: [{ ...attentionEvent, entity: { secret: 'not needed by the coach' } }],
          pagination: { total: 1 },
        },
      }),
    );

    const result = await fetchRecentAttention({ ...baseDeps, fetchImpl, activitySnapshot: [] });

    expect(result[0]).not.toHaveProperty('id');
    expect(result[0]).not.toHaveProperty('entity');
    expect(result[0]?.entityName).toBe('Ship the dashboard');
  });

  it('returns an empty array for malformed, HTTP-error, and network responses', async () => {
    const malformed = vi
      .fn()
      .mockResolvedValue(makeResponse({ data: { events: [{ entityType: 'task' }] } }));
    await expect(
      fetchRecentAttention({ ...baseDeps, fetchImpl: malformed, activitySnapshot: [] }),
    ).resolves.toEqual([]);

    const httpError = vi.fn().mockResolvedValue(makeResponse({}, false));
    await expect(
      fetchRecentAttention({ ...baseDeps, fetchImpl: httpError, activitySnapshot: [] }),
    ).resolves.toEqual([]);

    const networkError = vi.fn().mockRejectedValue(new Error('Network error'));
    await expect(
      fetchRecentAttention({ ...baseDeps, fetchImpl: networkError, activitySnapshot: [] }),
    ).resolves.toEqual([]);
  });
});

describe('deriveAttentionSince', () => {
  it('returns the earliest valid activity timestamp in canonical ISO form', () => {
    expect(
      deriveAttentionSince([
        activity('2026-01-02T12:00:00.000Z'),
        activity('2026-01-01T12:00:00.000Z'),
      ]),
    ).toBe('2026-01-01T12:00:00.000Z');
  });
});

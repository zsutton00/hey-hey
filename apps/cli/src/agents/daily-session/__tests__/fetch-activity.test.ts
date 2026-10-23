import { describe, expect, it, vi } from 'vitest';
import { fetchRecentActivity } from '../fetch-activity';

const baseDeps = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  accessToken: 'test-token',
  apiBaseUrl: 'https://api.example.com/api/v1',
};

const makeResponse = (data: unknown[], ok = true): Response =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => ({ success: true, data }),
  }) as unknown as Response;

describe('fetchRecentActivity', () => {
  it('calls the correct URL with auth header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse([]));

    await fetchRecentActivity({ ...baseDeps, fetchImpl });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('/api/v1/organizations/org-1/activity-correlations');
    expect(url).toContain('projectId=proj-1');
    expect(url).toContain('mode=TASK');
    expect(url).toContain('sort=LAST_MESSAGE');
    expect(url).toContain('limit=20');
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });

  it('returns activity records from API response', async () => {
    const records = [
      {
        entityId: 'a',
        entityType: 'TASK',
        title: 'Task A',
        timestamp: '2026-01-01',
        linkedEntities: [],
        reports: [],
      },
    ];
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse(records));

    const result = await fetchRecentActivity({ ...baseDeps, fetchImpl });

    expect(result).toHaveLength(1);
    expect(result[0]!.entityId).toBe('a');
  });

  it('returns empty array on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse([], false));

    const result = await fetchRecentActivity({ ...baseDeps, fetchImpl });

    expect(result).toEqual([]);
  });

  it('returns empty array on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchRecentActivity({ ...baseDeps, fetchImpl });

    expect(result).toEqual([]);
  });

  it('respects custom limit parameter', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse([]));

    await fetchRecentActivity({ ...baseDeps, fetchImpl, limit: 25 });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('limit=25');
  });

  it('URL-encodes the organization ID', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse([]));

    await fetchRecentActivity({
      ...baseDeps,
      fetchImpl,
      organizationId: 'org with spaces',
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('org%20with%20spaces');
  });
});

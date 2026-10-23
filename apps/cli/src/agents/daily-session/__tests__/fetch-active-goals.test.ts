import { describe, expect, it, vi } from 'vitest';
import { fetchActiveGoals } from '../fetch-active-goals';

const baseDeps = {
  organizationId: 'org-1',
  projectId: 'proj-1',
  userId: 'user-1',
  accessToken: 'test-token',
  apiBaseUrl: 'https://api.example.com/api/v1',
};

const makeResponse = (body: unknown, ok = true): Response =>
  ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }) as unknown as Response;

const sampleGoal = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Ship the dashboard',
  dueDate: '2026-05-20T00:00:00.000Z',
  audience: 'PROJECT',
};

describe('fetchActiveGoals', () => {
  it('calls the correct URL with auth header and query params', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ data: { items: [sampleGoal], userId: 'user-1', windowDays: 30 } }),
      );

    await fetchActiveGoals({ ...baseDeps, fetchImpl, windowDays: 14 });

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, options] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('/api/v1/organizations/org-1/projects/proj-1/goals/active');
    expect(url).toContain('userId=user-1');
    expect(url).toContain('windowDays=14');
    expect(options.headers.Authorization).toBe('Bearer test-token');
  });

  it('returns parsed active goals on happy path', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        makeResponse({ data: { items: [sampleGoal], userId: 'user-1', windowDays: 30 } }),
      );

    const result = await fetchActiveGoals({ ...baseDeps, fetchImpl });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('00000000-0000-4000-8000-000000000001');
    expect(result[0]!.audience).toBe('PROJECT');
  });

  it('returns empty array when the user has no active goals', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ data: { items: [], userId: 'user-1', windowDays: 30 } }));

    const result = await fetchActiveGoals({ ...baseDeps, fetchImpl });

    expect(result).toEqual([]);
  });

  it('returns empty array on HTTP error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({}, false));

    const result = await fetchActiveGoals({ ...baseDeps, fetchImpl });

    expect(result).toEqual([]);
  });

  it('returns empty array when the body is malformed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({ data: { items: 'not-an-array' } }));

    const result = await fetchActiveGoals({ ...baseDeps, fetchImpl });

    expect(result).toEqual([]);
  });

  it('filters out items that fail shape validation', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        data: {
          items: [sampleGoal, { id: 'bad', name: 'missing fields' }],
          userId: 'user-1',
          windowDays: 30,
        },
      }),
    );

    const result = await fetchActiveGoals({ ...baseDeps, fetchImpl });

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('returns empty array on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await fetchActiveGoals({ ...baseDeps, fetchImpl });

    expect(result).toEqual([]);
  });

  it('URL-encodes organization and project IDs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(makeResponse({ data: { items: [], userId: 'user-1', windowDays: 30 } }));

    await fetchActiveGoals({
      ...baseDeps,
      fetchImpl,
      organizationId: 'org with spaces',
      projectId: 'proj/slash',
    });

    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toContain('org%20with%20spaces');
    expect(url).toContain('proj%2Fslash');
  });
  it('preserves undated Goals alongside dated Goals while rejecting only invalid items', async () => {
    const undated = { ...sampleGoal, id: '00000000-0000-4000-8000-000000000002', dueDate: null };
    const fetchImpl = vi.fn().mockResolvedValue(
      makeResponse({
        data: { items: [sampleGoal, { ...sampleGoal, audience: 'INVALID' }, undated] },
      }),
    );
    expect(await fetchActiveGoals({ ...baseDeps, fetchImpl })).toEqual([sampleGoal, undated]);
  });
});

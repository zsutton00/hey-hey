import { describe, expect, it, vi } from 'vitest';
import { NOOP_LOGGER } from '../../../server/logger';
import { calculateDelta, type DeltaCalculatorDeps } from '../delta-calculator';

const makeDeps = (fetchImpl?: typeof fetch): DeltaCalculatorDeps => ({
  organizationId: 'org-1',
  projectId: 'proj-1',
  fetchImpl: fetchImpl ?? (vi.fn() as unknown as typeof fetch),
  accessToken: 'test-token',
  apiBaseUrl: 'https://api.test',
  logger: NOOP_LOGGER,
});

describe('calculateDelta', () => {
  it('returns an empty snapshot without fetching when the batch is empty', async () => {
    const mockFetch = vi.fn();
    const result = await calculateDelta(0, makeDeps(mockFetch as unknown as typeof fetch));

    expect(result.signalCount).toBe(0);
    expect(result.activity).toHaveLength(0);
    expect(result.computedAt).toEqual(expect.any(String));
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('fetches one activity snapshot and records the firing signal count', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        records: [
          {
            entityId: 'a',
            entityType: 'TASK',
            title: 'Task A',
            timestamp: '2026-01-01T00:00:00Z',
            linkedEntities: [],
            reports: [],
          },
        ],
      }),
    });

    const result = await calculateDelta(21, makeDeps(mockFetch as unknown as typeof fetch));

    expect(result.signalCount).toBe(21);
    expect(result.activity).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it('returns an empty activity snapshot when the fetch fails', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });

    const result = await calculateDelta(5, makeDeps(mockFetch as unknown as typeof fetch));

    expect(result.signalCount).toBe(5);
    expect(result.activity).toHaveLength(0);
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

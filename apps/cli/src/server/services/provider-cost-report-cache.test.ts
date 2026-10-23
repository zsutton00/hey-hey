import { describe, expect, it, vi } from 'vitest';
import { ProviderCostReportCache } from './provider-cost-report-cache';

describe('ProviderCostReportCache', () => {
  it('releases failed in-flight ownership and shares the next successful refresh', async () => {
    const cache = new ProviderCostReportCache<string[]>();
    const failure = vi.fn(async (): Promise<string[]> => {
      throw new Error('failed');
    });
    const first = cache.read('source', failure);
    const second = cache.read('source', failure);
    expect(first).toBe(second);
    await expect(first).rejects.toThrow('failed');
    expect(failure).toHaveBeenCalledTimes(1);
    const success = vi.fn(async () => ['validated']);
    expect(await cache.read('source', success)).toEqual(['validated']);
    await cache.read('source', success);
    expect(success).toHaveBeenCalledTimes(1);
  });
});

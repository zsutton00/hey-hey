import { SearchCacheService } from '../tools/search-cache.service';

interface FakeResult {
  results: { id: string }[];
  total: number;
}

const FP_UNIFIED = 'unified-fp';
const FP_TASK = 'task-fp';

describe('SearchCacheService', () => {
  let cache: SearchCacheService;

  beforeEach(() => {
    cache = new SearchCacheService();
  });

  describe('generateKey', () => {
    it('produces deterministic keys regardless of insertion order', () => {
      const key1 = cache.generateKey({ b: 2, a: 1 });
      const key2 = cache.generateKey({ a: 1, b: 2 });
      expect(key1).toBe(key2);
    });

    it('excludes undefined and null values', () => {
      const key1 = cache.generateKey({ query: 'test', status: undefined });
      const key2 = cache.generateKey({ query: 'test' });
      expect(key1).toBe(key2);
    });

    it('differentiates by filter values', () => {
      const key1 = cache.generateKey({ query: 'q', status: 'DONE' });
      const key2 = cache.generateKey({ query: 'q', status: 'ACTIVE' });
      expect(key1).not.toBe(key2);
    });

    it('normalizes query text to lowercase', () => {
      const key1 = cache.generateKey({ query: 'Auth Flow' });
      const key2 = cache.generateKey({ query: 'auth flow' });
      expect(key1).toBe(key2);
    });

    it('isolates authorized Service scope in the cache key', () => {
      const key1 = cache.generateKey({
        tool: 'search_implementation_hints',
        serviceIds: ['service-a', 'service-b'],
      });
      const key2 = cache.generateKey({
        tool: 'search_implementation_hints',
        serviceIds: ['service-a', 'service-b'],
      });
      const key3 = cache.generateKey({
        tool: 'search_implementation_hints',
        serviceIds: ['service-a'],
      });

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });

  describe('buildScopeKey', () => {
    it('combines org and project IDs', () => {
      expect(cache.buildScopeKey('org-1', 'proj-1')).toBe('org-1:proj-1');
    });
  });

  describe('buildFilterFingerprint', () => {
    it('excludes query from the fingerprint', () => {
      const fp1 = cache.buildFilterFingerprint({
        tool: 'unified_search',
        query: 'auth flow',
        limit: 10,
      });
      const fp2 = cache.buildFilterFingerprint({
        tool: 'unified_search',
        query: 'different query',
        limit: 10,
      });
      expect(fp1).toBe(fp2);
    });

    it('differentiates by tool name', () => {
      const fp1 = cache.buildFilterFingerprint({ tool: 'task_search' });
      const fp2 = cache.buildFilterFingerprint({ tool: 'plan_search' });
      expect(fp1).not.toBe(fp2);
    });

    it('differentiates by filter values', () => {
      const fp1 = cache.buildFilterFingerprint({
        tool: 'task_search',
        status: 'IN_PROGRESS',
      });
      const fp2 = cache.buildFilterFingerprint({
        tool: 'task_search',
        status: 'DONE',
      });
      expect(fp1).not.toBe(fp2);
    });
  });

  describe('get / set', () => {
    it('returns stored result on exact-match', () => {
      const result: FakeResult = { results: [{ id: 'r1' }], total: 1 };
      cache.set('key-1', 'auth flow', 'scope-1', FP_UNIFIED, result);

      expect(cache.get<FakeResult>('key-1')).toEqual(result);
    });

    it('returns undefined on cache miss', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('overwrites existing entries for the same key', () => {
      cache.set('key-1', 'q', 'scope', FP_UNIFIED, { v: 1 });
      cache.set('key-1', 'q', 'scope', FP_UNIFIED, { v: 2 });

      expect(cache.get('key-1')).toEqual({ v: 2 });
    });

    it('evicts expired entries on get', () => {
      cache.set('key-1', 'q', 'scope', FP_UNIFIED, { v: 1 });

      jest.spyOn(Date, 'now').mockReturnValueOnce(Date.now() + 61_000);

      expect(cache.get('key-1')).toBeUndefined();
    });

    it('evicts oldest entry when max size is reached', () => {
      // Fill cache to capacity (500)
      for (let i = 0; i < 500; i++) {
        cache.set(`key-${i}`, `q-${i}`, 'scope', FP_UNIFIED, { v: i });
      }

      // Adding one more should evict the oldest (key-0)
      cache.set('key-new', 'new', 'scope', FP_UNIFIED, { v: 'new' });

      expect(cache.get('key-0')).toBeUndefined();
      expect(cache.get('key-new')).toEqual({ v: 'new' });
      expect(cache.get('key-1')).toEqual({ v: 1 });
    });
  });

  describe('findSimilar', () => {
    it('returns cached result when query similarity exceeds threshold', () => {
      const result: FakeResult = { results: [{ id: 'r1' }], total: 1 };
      cache.set(
        'key-1',
        'authentication flow issues',
        'scope-1',
        FP_UNIFIED,
        result,
      );

      const found = cache.findSimilar<FakeResult>(
        'authentication flow problems',
        'scope-1',
        FP_UNIFIED,
      );
      expect(found).toEqual(result);
    });

    it('returns undefined when similarity is below threshold', () => {
      cache.set('key-1', 'authentication flow', 'scope-1', FP_UNIFIED, {
        v: 1,
      });

      const found = cache.findSimilar(
        'database migration strategy',
        'scope-1',
        FP_UNIFIED,
      );
      expect(found).toBeUndefined();
    });

    it('ignores entries with different scope', () => {
      cache.set('key-1', 'authentication flow', 'scope-A', FP_UNIFIED, {
        v: 1,
      });

      const found = cache.findSimilar(
        'authentication flow',
        'scope-B',
        FP_UNIFIED,
      );
      expect(found).toBeUndefined();
    });

    it('ignores entries with different filter fingerprint', () => {
      cache.set('key-1', 'authentication flow', 'scope-1', FP_TASK, {
        v: 'task',
      });

      const found = cache.findSimilar(
        'authentication flow',
        'scope-1',
        FP_UNIFIED,
      );
      expect(found).toBeUndefined();
    });

    it('returns the best-scoring match', () => {
      cache.set('key-1', 'auth flow', 'scope-1', FP_UNIFIED, { v: 'partial' });
      cache.set('key-2', 'authentication flow issues', 'scope-1', FP_UNIFIED, {
        v: 'better',
      });

      const found = cache.findSimilar<{ v: string }>(
        'authentication flow problems',
        'scope-1',
        FP_UNIFIED,
      );
      expect(found?.v).toBe('better');
    });

    it('evicts expired entries during similarity search', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      cache.set('old-key', 'auth flow', 'scope-1', FP_UNIFIED, { v: 'old' });

      jest.spyOn(Date, 'now').mockReturnValue(now + 61_000);

      cache.set('new-key', 'different topic', 'scope-1', FP_UNIFIED, {
        v: 'new',
      });

      const found = cache.findSimilar('auth flow', 'scope-1', FP_UNIFIED);
      expect(found).toBeUndefined();
    });

    it('is case-insensitive', () => {
      cache.set('key-1', 'Authentication Flow', 'scope-1', FP_UNIFIED, {
        v: 1,
      });

      const found = cache.findSimilar(
        'authentication flow',
        'scope-1',
        FP_UNIFIED,
      );
      expect(found).toEqual({ v: 1 });
    });

    it('respects custom threshold', () => {
      cache.set('key-1', 'auth flow', 'scope-1', FP_UNIFIED, { v: 1 });

      const found = cache.findSimilar(
        'auth flow issues',
        'scope-1',
        FP_UNIFIED,
        0.95,
      );
      expect(found).toBeUndefined();
    });
  });
});

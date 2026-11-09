import { ReadRestriction } from '@hey-hey/contracts/api/models';
import {
  ReadPolicyContext,
  readPolicyFor,
} from '../../read-restriction/read-policy';
import { SearchCacheService } from '../tools/search-cache.service';

const params = {
  tool: 'unified_search',
  query: 'retry failed eval attempts',
  limit: 10,
};

describe('search cache under a read restriction', () => {
  const lookup = (
    cache: SearchCacheService,
    restriction: ReadRestriction | undefined,
  ) =>
    ReadPolicyContext.run(readPolicyFor(restriction), () => {
      const key = cache.generateKey(params);
      const scope = cache.buildScopeKey('org', 'project');

      return {
        exact: cache.get(key),
        similar: cache.findSimilar(
          'retry failed eval attempt',
          scope,
          cache.buildFilterFingerprint(params),
        ),
      };
    });

  const store = (
    cache: SearchCacheService,
    restriction: ReadRestriction | undefined,
    result: string,
  ) =>
    ReadPolicyContext.run(readPolicyFor(restriction), () =>
      cache.set(
        cache.generateKey(params),
        params.query,
        cache.buildScopeKey('org', 'project'),
        cache.buildFilterFingerprint(params),
        result,
      ),
    );

  it('never answers an evaluated attempt from a result an ordinary session cached', () => {
    const cache = new SearchCacheService();
    store(cache, undefined, 'includes the Eval Case with its grading answers');

    expect(lookup(cache, ReadRestriction.EvalTarget)).toEqual({
      exact: undefined,
      similar: undefined,
    });
    expect(lookup(cache, ReadRestriction.EvalJudge)).toEqual({
      exact: undefined,
      similar: undefined,
    });
    expect(lookup(cache, undefined).exact).toBe(
      'includes the Eval Case with its grading answers',
    );
  });

  it('reuses a result between callers under the same restriction', () => {
    const cache = new SearchCacheService();
    store(cache, ReadRestriction.EvalTarget, 'permitted results only');

    expect(lookup(cache, ReadRestriction.EvalTarget)).toEqual({
      exact: 'permitted results only',
      similar: 'permitted results only',
    });
    expect(lookup(cache, undefined)).toEqual({
      exact: undefined,
      similar: undefined,
    });
  });
});

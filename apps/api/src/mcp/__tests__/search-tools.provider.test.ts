import { z } from 'zod';
import {
  SearchToolsProvider,
  unifiedSearchParameters,
  taskSearchParameters,
  planSearchParameters,
  designDocSearchParameters,
  getHelpNodeOutput,
  helpSearchOutput,
  searchResultOutput,
  unifiedSearchResultOutput,
} from '../tools/search-tools.provider';
import { UnifiedSearchService } from '../../services/unified-search/unified-search.service';
import { HelpService } from '../../services/help.service';
import { SearchCacheService } from '../tools/search-cache.service';
import { UnifiedSearchResult } from '../../generated';

type SearchResult = z.infer<typeof searchResultOutput>;

const mockSearchService = {
  search: jest.fn(),
} as unknown as jest.Mocked<UnifiedSearchService>;

const mockCacheService = {
  generateKey: jest.fn().mockReturnValue('mock-cache-key'),
  buildScopeKey: jest.fn().mockReturnValue('mock-scope'),
  buildFilterFingerprint: jest.fn().mockReturnValue('mock-filter-fp'),
  get: jest.fn().mockReturnValue(undefined),
  findSimilar: jest.fn().mockReturnValue(undefined),
  set: jest.fn(),
} as unknown as jest.Mocked<SearchCacheService>;

const mockHelpService = {
  searchHelpNodes: jest.fn(),
  findByIdOrSlugPath: jest.fn(),
} as unknown as jest.Mocked<HelpService>;

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const PROJECT_ID = '00000000-0000-4000-8000-000000000002';
const ENTITY_ID = '00000000-0000-4000-8000-000000000003';
const OWNER_ID = '00000000-0000-4000-8000-000000000004';

function makeRequest(
  opts: { orgId?: string; token?: string; projectId?: string } = {},
) {
  return {
    headers: {
      authorization: opts.token ? `Bearer ${opts.token}` : undefined,
      'x-project-id': opts.projectId ?? PROJECT_ID,
    },
    cookies: {},
    user: opts.orgId
      ? {
          currentOrgId: opts.orgId,
          userId: 'u1',
          email: 't@t.com',
          name: 'T',
          orgMemberships: [],
          isDevAdmin: false,
          devAdminMode: false,
        }
      : undefined,
  };
}

const dummyContext = {
  reportProgress: jest.fn(),
  log: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
  mcpServer: {} as any,
  mcpRequest: {} as any,
};

function makeResult(
  overrides: Partial<UnifiedSearchResult> = {},
): UnifiedSearchResult {
  return {
    entityId: ENTITY_ID,
    entityType: 'TASK',
    score: 0.85,
    graphScore: 0.7,
    semanticScore: 0.9,
    title: 'Fix auth flow',
    content: 'The authentication flow needs to handle token refresh.',
    topologySummary: 'Task under Auth initiative',
    status: 'IN_PROGRESS',
    sources: ['graph', 'embeddings'],
    ...overrides,
  };
}

function makeSearchResponse(
  results: UnifiedSearchResult[],
  overrides: Record<string, any> = {},
) {
  return {
    intent: 'hybrid',
    query: 'q',
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    results,
    execution: { totalMs: 10 },
    ...overrides,
  };
}

describe('SearchToolsProvider', () => {
  let provider: SearchToolsProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new SearchToolsProvider(
      mockSearchService as unknown as UnifiedSearchService,
      mockCacheService as unknown as SearchCacheService,
      mockHelpService as unknown as HelpService,
    );
  });

  describe('global Help handlers', () => {
    it('trims and bounds global Help searches while preserving stable result fields', async () => {
      (mockHelpService.searchHelpNodes as jest.Mock).mockResolvedValue({
        results: [
          {
            id: ENTITY_ID,
            slug: 'projects/features',
            title: 'Features',
            snippet: 'Shape a project with features.',
            rank: 0.875,
            unrelated: 'must not leak',
          },
        ],
      });

      const result = await provider.searchHelp({
        query: '  features  ',
        limit: 500,
      } as any);

      expect(mockHelpService.searchHelpNodes).toHaveBeenCalledWith(
        'features',
        50,
      );
      expect(result).toEqual({
        results: [
          {
            id: ENTITY_ID,
            slug: 'projects/features',
            title: 'Features',
            snippet: 'Shape a project with features.',
            rank: 0.875,
          },
        ],
      });
      expect(helpSearchOutput.safeParse(result).success).toBe(true);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only Help searches without calling a provider', async () => {
      const result = await provider.searchHelp({ query: ' \n\t ', limit: 10 });

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toBe(
        'Help search query must not be blank.',
      );
      expect(mockHelpService.searchHelpNodes).not.toHaveBeenCalled();
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('returns deterministic MCP errors when Help search fails', async () => {
      (mockHelpService.searchHelpNodes as jest.Mock).mockRejectedValue(
        new Error('database unavailable'),
      );

      const result = await provider.searchHelp({
        query: 'features',
        limit: 10,
      });

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toBe(
        'Help search failed: database unavailable',
      );
    });

    it('returns canonical full nodes with provider-ordered preset and DSL demos', async () => {
      const node = {
        id: ENTITY_ID,
        parentId: null,
        slug: 'projects/features',
        title: 'Features',
        ordering: 4,
        body: '# Features\n\nShape the work.',
        demos: [
          {
            id: '00000000-0000-4000-8000-000000000010',
            ordering: 1,
            caption: 'Open features',
            kind: 'preset' as const,
            presetKey: 'open-features',
          },
          {
            id: '00000000-0000-4000-8000-000000000011',
            ordering: 2,
            caption: 'Create a feature',
            kind: 'dsl' as const,
            definition: { scenes: [{ action: 'create-feature' }] },
          },
        ],
      };
      (mockHelpService.findByIdOrSlugPath as jest.Mock).mockResolvedValue(node);

      const result = await provider.getHelpNode({
        idOrSlugPath: '  projects/features  ',
      });

      expect(mockHelpService.findByIdOrSlugPath).toHaveBeenCalledWith(
        'projects/features',
      );
      expect(result).toEqual(node);
      expect((result as typeof node).demos.map((demo) => demo.kind)).toEqual([
        'preset',
        'dsl',
      ]);
      expect(getHelpNodeOutput.safeParse(result).success).toBe(true);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('rejects whitespace-only Help node identifiers', async () => {
      const result = await provider.getHelpNode({ idOrSlugPath: '   ' });

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toBe(
        'Help node identifier must not be blank.',
      );
      expect(mockHelpService.findByIdOrSlugPath).not.toHaveBeenCalled();
    });

    it('maps unresolved Help nodes to a not-found MCP error', async () => {
      (mockHelpService.findByIdOrSlugPath as jest.Mock).mockResolvedValue(null);

      const result = await provider.getHelpNode({
        idOrSlugPath: 'missing/article',
      });

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toBe('Help node not found.');
    });

    it('returns deterministic MCP errors when Help node retrieval fails', async () => {
      (mockHelpService.findByIdOrSlugPath as jest.Mock).mockRejectedValue(
        new Error('database unavailable'),
      );

      const result = await provider.getHelpNode({
        idOrSlugPath: ENTITY_ID,
      });

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toBe(
        'Help node retrieval failed: database unavailable',
      );
    });
  });

  describe('unifiedSearch handler', () => {
    it('maps results from UnifiedSearchService to output schema', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([makeResult()], { query: 'auth' }),
      );

      const result = (await provider.unifiedSearch(
        {
          query: 'auth',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok123' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        id: ENTITY_ID,
        type: 'TASK',
        title: 'Fix auth flow',
        snippet: 'The authentication flow needs to handle token refresh.',
        score: 0.85,
        metadata: {
          status: 'IN_PROGRESS',
          sources: ['graph', 'embeddings'],
          graphScore: 0.7,
          semanticScore: 0.9,
        },
      });
      expect(result.hasMore).toBe(false);
      expect(result.total).toBe(1);

      const validation = searchResultOutput.safeParse(result);
      expect(validation.success).toBe(true);
    });

    it('omits status for FEATURE-typed results while retaining it for others', async () => {
      const featureHit = makeResult({
        entityId: 'feature-1',
        entityType: 'TASK',
        status: 'ACTIVE',
        embeddings: { metadata: { taskType: 'FEATURE' } as any },
      });
      const taskHit = makeResult({
        entityId: 'task-1',
        status: 'IN_PROGRESS',
        embeddings: { metadata: { taskType: 'STANDARD' } as any },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([featureHit, taskHit]),
      );

      const result = (await provider.unifiedSearch(
        {
          query: 'features and tasks',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      const feature = result.results.find((r) => r.id === 'feature-1')!;
      const task = result.results.find((r) => r.id === 'task-1')!;

      // Feature metadata carries no status key at all; the other fields remain.
      expect(feature.metadata).not.toHaveProperty('status');
      expect(feature.metadata).toMatchObject({
        sources: ['graph', 'embeddings'],
        graphScore: 0.7,
        semanticScore: 0.9,
      });
      // Non-feature results are unchanged.
      expect(task.metadata!.status).toBe('IN_PROGRESS');
    });

    it('surfaces taskType from embeddings metadata and omits it when absent', async () => {
      const subtypedHit = makeResult({
        entityId: 'feature-1',
        entityType: 'TASK',
        embeddings: { metadata: { taskType: 'FEATURE' } as any },
      });
      const noMetaHit = makeResult({
        entityId: 'task-1',
        embeddings: undefined,
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([subtypedHit, noMetaHit]),
      );

      const result = (await provider.unifiedSearch(
        {
          query: 'features and tasks',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      const subtyped = result.results.find((r) => r.id === 'feature-1')!;
      const noMeta = result.results.find((r) => r.id === 'task-1')!;

      // Subtype is surfaced straight from the search metadata...
      expect(subtyped.taskType).toBe('FEATURE');
      // ...and omitted entirely (no placeholder) when the data carries none.
      expect(noMeta).not.toHaveProperty('taskType');

      const validation = searchResultOutput.safeParse(result);
      expect(validation.success).toBe(true);
    });

    it('derives organizationId from auth context when omitted', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([], { query: 'test' }),
      );

      await provider.unifiedSearch(
        {
          query: 'test',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockSearchService.search).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        expect.objectContaining({ intent: 'hybrid', query: 'test' }),
        'tok',
        'COMPACT_RANKED',
      );
    });

    it('returns error when no user is authenticated', async () => {
      const result = await provider.unifiedSearch(
        {
          query: 'test',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest() as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('computes hasMore=true when results exceed the limit', async () => {
      const items = Array.from({ length: 6 }, (_, i) =>
        makeResult({ entityId: `id-${i}`, score: 0.9 - i * 0.1 }),
      );

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse(items),
      );

      const result = (await provider.unifiedSearch(
        {
          query: 'q',

          limit: 5,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.hasMore).toBe(true);
      expect(result.total).toBe(5);
    });

    it('truncates long content to snippet', async () => {
      const longContent = 'A'.repeat(500);
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([makeResult({ content: longContent })]),
      );

      const result = (await provider.unifiedSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results[0]!.snippet.length).toBeLessThanOrEqual(300);
      expect(result.results[0]!.snippet.endsWith('…')).toBe(true);
    });

    it('falls back to topologySummary when content is absent', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([makeResult({ content: undefined })]),
      );

      const result = (await provider.unifiedSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results[0]!.snippet).toBe('Task under Auth initiative');
    });

    it('returns MCP error on service failure', async () => {
      (mockSearchService.search as jest.Mock).mockRejectedValue(
        new Error('Service unavailable'),
      );

      const result = await provider.unifiedSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain('Service unavailable');
    });

    it.each([
      { offset: 0, expectedPage: 0 },
      { offset: 25, expectedPage: 1 },
      { offset: 37, expectedPage: 1 },
    ])(
      'uses zero-based Graph page $expectedPage for offset $offset',
      async ({ offset, expectedPage }) => {
        const rankedPages = [
          [
            makeResult({ entityId: 'rank-1', title: 'First page top hit' }),
            makeResult({ entityId: 'rank-2', title: 'First page next hit' }),
          ],
          [
            makeResult({ entityId: 'rank-26', title: 'Second page top hit' }),
            makeResult({ entityId: 'rank-27', title: 'Second page next hit' }),
          ],
        ];
        (mockSearchService.search as jest.Mock).mockImplementation(
          async (_organizationId, _projectId, request) =>
            makeSearchResponse(rankedPages[request.graph.page] ?? []),
        );

        const result = (await provider.unifiedSearch(
          { query: 'q', limit: 25, offset },
          dummyContext as any,
          makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
        )) as SearchResult;

        const searchRequest = (mockSearchService.search as jest.Mock).mock
          .calls[0][2];
        expect(searchRequest.graph.page).toBe(expectedPage);
        expect(searchRequest.embeddings.offset).toBe(offset);
        expect(result.results.map((item) => item.id)).toEqual(
          rankedPages[expectedPage]?.map((item) => item.entityId),
        );
      },
    );

    it('applies default search parameters', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.excludeContentless).toBe(true);
      expect(searchRequest.common.types).toEqual([
        'TASK',
        'DESIGN_DOC',
        'MESSAGE',
      ]);
      expect(searchRequest.embeddings.queryMode).toBe('default');
    });

    it.each([true, false])(
      'returns exact match text independently of snippet (spans: %s)',
      async (withSpans) => {
        const matchText = 'A 😀 matching passage';
        const matchSpans = [{ start: 2, end: 4, strength: 0.9 }];
        (mockSearchService.search as jest.Mock).mockResolvedValue(
          makeSearchResponse([
            makeResult({
              content: 'Different display text '.repeat(30),
              embeddings: withSpans ? { text: matchText, matchSpans } : {},
            }),
          ]),
        );
        const result = (await provider.unifiedSearch(
          { query: 'passage', limit: 10, offset: 0 },
          dummyContext as any,
          makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
        )) as SearchResult;
        const hit = searchResultOutput.parse(result).results[0]!;
        if (withSpans) {
          expect(hit.matchSpans).toEqual(matchSpans);
          expect(hit.matchText).toBe(matchText);
          expect(hit.matchText!.slice(2, 4)).toBe('😀');
          expect(hit.snippet).not.toBe(matchText);
        } else {
          expect(hit).not.toHaveProperty('matchSpans');
          expect(hit).not.toHaveProperty('matchText');
        }
      },
    );

    it('passes MESSAGE results through mapResult unchanged', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          makeResult({
            entityId: 'msg-1',
            entityType: 'MESSAGE',
            title: 'Standup update',
            content: 'Shipped the migration this morning.',
            status: undefined,
            sources: ['embeddings'],
            graphScore: undefined,
            semanticScore: 0.82,
            score: 0.82,
          }),
        ]),
      );

      const result = (await provider.unifiedSearch(
        {
          query: 'standup',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toEqual({
        id: 'msg-1',
        type: 'MESSAGE',
        title: 'Standup update',
        snippet: 'Shipped the migration this morning.',
        score: 0.82,
        metadata: {
          status: null,
          sources: ['embeddings'],
          graphScore: null,
          semanticScore: 0.82,
        },
      });
    });

    it('forwards explicit entityTypes filter to common.types', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'chat',
          entityTypes: ['MESSAGE'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.common.types).toEqual(['MESSAGE']);
    });

    it('falls back to the default type set including MESSAGE when entityTypes is omitted', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'fallback',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.common.types).toEqual([
        'TASK',
        'DESIGN_DOC',
        'MESSAGE',
      ]);
    });

    it('includes entityTypes in the cache key params', async () => {
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'scoped',
          entityTypes: ['MESSAGE', 'TASK'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockCacheService.generateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'unified_search',
          entityTypes: ['MESSAGE', 'TASK'],
        }),
      );
    });

    it('always uses hybrid intent internally', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.intent).toBe('hybrid');
    });

    it('extracts token from Authorization header', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'my-jwt-token' }) as any,
      );

      expect(mockSearchService.search).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        expect.anything(),
        'my-jwt-token',
        'COMPACT_RANKED',
      );
    });
  });

  describe('unifiedSearch multi-query', () => {
    it.each([
      { offset: 0, expectedPage: 0 },
      { offset: 25, expectedPage: 1 },
      { offset: 37, expectedPage: 1 },
    ])(
      'uses Graph page $expectedPage for each query at offset $offset and preserves group order',
      async ({ offset, expectedPage }) => {
        const rankedPages = new Map([
          [
            'auth',
            [
              [makeResult({ entityId: 'auth-first-page' })],
              [makeResult({ entityId: 'auth-second-page' })],
            ],
          ],
          [
            'billing',
            [
              [makeResult({ entityId: 'billing-first-page' })],
              [makeResult({ entityId: 'billing-second-page' })],
            ],
          ],
        ]);
        (mockSearchService.search as jest.Mock).mockImplementation(
          async (_organizationId, _projectId, request) =>
            makeSearchResponse(
              rankedPages.get(request.query)?.[request.graph.page] ?? [],
              { query: request.query },
            ),
        );

        const result = (await provider.unifiedSearch(
          {
            queries: ['auth', 'billing'],
            limit: 25,
            offset,
          },
          dummyContext as any,
          makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
        )) as { groups: Array<{ query: string } & SearchResult> };

        expect(mockSearchService.search).toHaveBeenCalledTimes(2);
        expect(result.groups).toHaveLength(2);
        expect(
          (mockSearchService.search as jest.Mock).mock.calls.map(
            ([, , searchRequest]) => searchRequest.graph.page,
          ),
        ).toEqual([expectedPage, expectedPage]);
        expect(result.groups[0]?.query).toBe('auth');
        expect(result.groups[0]?.results.map((item) => item.id)).toEqual([
          expectedPage === 0 ? 'auth-first-page' : 'auth-second-page',
        ]);
        expect(result.groups[1]?.query).toBe('billing');
        expect(result.groups[1]?.results.map((item) => item.id)).toEqual([
          expectedPage === 0 ? 'billing-first-page' : 'billing-second-page',
        ]);
        const validation = unifiedSearchResultOutput.safeParse(result);
        expect(validation.success).toBe(true);
      },
    );

    it('forwards shared filters and limit to every query in the batch', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          queries: ['one', 'two'],
          entityTypes: ['MESSAGE'],
          createdAfter: '2026-05-01T00:00:00Z',
          updatedAfter: '2026-06-01T00:00:00Z',
          limit: 5,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const calls = (mockSearchService.search as jest.Mock).mock.calls;
      expect(calls).toHaveLength(2);
      for (const call of calls) {
        const searchRequest = call[2];
        expect(searchRequest.common.types).toEqual(['MESSAGE']);
        expect(searchRequest.common.dateRange).toEqual({
          from: '2026-05-01T00:00:00Z',
          to: undefined,
        });
        expect(searchRequest.common.updatedAtRange).toEqual({
          from: '2026-06-01T00:00:00Z',
          to: undefined,
        });
        expect(searchRequest.embeddings.maxResults).toBe(5);
      }
    });

    describe('response size budget', () => {
      const bigResults = (count: number, prefix: string) =>
        Array.from({ length: count }, (_, i) =>
          makeResult({
            entityId: `${prefix}-${i}`,
            title: 't'.repeat(300),
            content: 'x'.repeat(1000),
          }),
        );

      async function run(params: Record<string, unknown>) {
        const result = (await provider.unifiedSearch(
          { limit: 50, offset: 0, ...params } as any,
          dummyContext as any,
          makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
        )) as any;
        return { result, length: JSON.stringify(result).length };
      }

      it('cuts ranked results from the end, says how many, and marks the page as having more', async () => {
        (mockSearchService.search as jest.Mock).mockResolvedValue(
          makeSearchResponse(bigResults(50, 'hit')),
        );

        const { result, length } = await run({ query: 'wide' });

        expect(length).toBeLessThanOrEqual(32_000);
        expect(result.results.length).toBeLessThan(50);
        expect(result.total).toBe(result.results.length);
        expect(result.hasMore).toBe(true);
        expect(result.omittedForSize).toBe(50 - result.results.length);
        expect(result.results.map((hit: any) => hit.id)).toEqual(
          bigResults(result.results.length, 'hit').map((hit) => hit.entityId),
        );
        expect(unifiedSearchResultOutput.safeParse(result).success).toBe(true);
      });

      it('leaves an under-budget response untouched', async () => {
        (mockSearchService.search as jest.Mock).mockResolvedValue(
          makeSearchResponse(bigResults(3, 'hit')),
        );

        const { result } = await run({ query: 'narrow', limit: 10 });

        expect(result.results).toHaveLength(3);
        expect(result).not.toHaveProperty('omittedForSize');
      });

      it('shares the budget across batched queries and keeps each group non-empty', async () => {
        (mockSearchService.search as jest.Mock).mockImplementation(
          async (_organizationId, _projectId, request) =>
            makeSearchResponse(bigResults(50, request.query)),
        );

        const { result, length } = await run({
          queries: ['a', 'b', 'c', 'd', 'e'],
        });

        expect(length).toBeLessThanOrEqual(32_000);
        expect(result.groups.map((group: any) => group.query)).toEqual([
          'a',
          'b',
          'c',
          'd',
          'e',
        ]);
        for (const group of result.groups) {
          expect(group.results.length).toBeGreaterThan(0);
          expect(group.total).toBe(group.results.length);
          expect(group.hasMore).toBe(true);
          expect(group.omittedForSize).toBe(50 - group.results.length);
        }
        expect(unifiedSearchResultOutput.safeParse(result).success).toBe(true);
      });
    });

    it('rejects when neither query nor queries is provided', async () => {
      const result = await provider.unifiedSearch(
        { limit: 10, offset: 0 } as any,
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toMatch(/exactly one/i);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('rejects when both query and queries are provided', async () => {
      const result = await provider.unifiedSearch(
        {
          query: 'solo',
          queries: ['batch'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toMatch(/exactly one/i);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('rejects a batch exceeding the 5-query cap with a clear error', async () => {
      const result = await provider.unifiedSearch(
        {
          queries: ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toMatch(/at most 5/i);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('allows a batch exactly at the 5-query cap', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      const result = (await provider.unifiedSearch(
        {
          queries: ['q1', 'q2', 'q3', 'q4', 'q5'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as { groups: unknown[] };

      expect(result.groups).toHaveLength(5);
      expect(mockSearchService.search).toHaveBeenCalledTimes(5);
    });
  });

  describe('unifiedSearch created-date filtering', () => {
    it('forwards createdAfter/createdBefore as common.dateRange to the search service', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'recent work',
          createdAfter: '2026-05-01T00:00:00Z',
          createdBefore: '2026-05-20T00:00:00Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.common.dateRange).toEqual({
        from: '2026-05-01T00:00:00Z',
        to: '2026-05-20T00:00:00Z',
      });
    });

    it('forwards a single date bound as a partial common.dateRange', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'recent work',
          createdAfter: '2026-05-01T00:00:00Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.common.dateRange).toEqual({
        from: '2026-05-01T00:00:00Z',
        to: undefined,
      });
    });

    it('omits common.dateRange entirely when no date bounds are supplied', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'anything',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.common).not.toHaveProperty('dateRange');
    });

    it('includes createdAfter/createdBefore in the cache key params', async () => {
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'scoped',
          createdAfter: '2026-05-01T00:00:00Z',
          createdBefore: '2026-05-20T00:00:00Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockCacheService.generateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'unified_search',
          createdAfter: '2026-05-01T00:00:00Z',
          createdBefore: '2026-05-20T00:00:00Z',
        }),
      );
    });

    it('does not serve an unfiltered cached result to a date-filtered query', async () => {
      // Use a real cache so the key/fingerprint are genuinely computed.
      const realCache = new SearchCacheService();
      const realProvider = new SearchToolsProvider(
        mockSearchService as unknown as UnifiedSearchService,
        realCache,
        mockHelpService as unknown as HelpService,
      );

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([makeResult()]),
      );

      // Unfiltered call populates the cache.
      await realProvider.unifiedSearch(
        { query: 'auth', limit: 10, offset: 0 },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );
      expect(mockSearchService.search).toHaveBeenCalledTimes(1);

      // Same query, now date-bounded: distinct cache key AND filter
      // fingerprint, so neither the exact nor the fuzzy lookup matches.
      await realProvider.unifiedSearch(
        {
          query: 'auth',
          createdAfter: '2026-05-01T00:00:00Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );
      expect(mockSearchService.search).toHaveBeenCalledTimes(2);

      // The unfiltered query still hits its own cache entry — the
      // date-filtered call did not displace or get served from it.
      await realProvider.unifiedSearch(
        { query: 'auth', limit: 10, offset: 0 },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );
      expect(mockSearchService.search).toHaveBeenCalledTimes(2);
    });
  });

  describe('unifiedSearch updated-date filtering', () => {
    it('forwards update bounds separately from creation bounds', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'recent changes',
          createdAfter: '2026-05-01T00:00:00Z',
          createdBefore: '2026-05-31T23:59:59Z',
          updatedAfter: '2026-06-01T00:00:00Z',
          updatedBefore: '2026-06-15T23:59:59Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.common.dateRange).toEqual({
        from: '2026-05-01T00:00:00Z',
        to: '2026-05-31T23:59:59Z',
      });
      expect(searchRequest.common.updatedAtRange).toEqual({
        from: '2026-06-01T00:00:00Z',
        to: '2026-06-15T23:59:59Z',
      });
    });

    it('forwards one update bound and omits the range when no update bounds are supplied', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.unifiedSearch(
        {
          query: 'recent changes',
          updatedBefore: '2026-06-15T23:59:59Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const filteredRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(filteredRequest.common.updatedAtRange).toEqual({
        from: undefined,
        to: '2026-06-15T23:59:59Z',
      });

      await provider.unifiedSearch(
        { query: 'all changes', limit: 10, offset: 0 },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );
      const unfilteredRequest = (mockSearchService.search as jest.Mock).mock
        .calls[1][2];
      expect(unfilteredRequest.common).not.toHaveProperty('updatedAtRange');
    });

    it('separates update-date cache entries from creation-date entries', async () => {
      const realCache = new SearchCacheService();
      const realProvider = new SearchToolsProvider(
        mockSearchService as unknown as UnifiedSearchService,
        realCache,
        mockHelpService as unknown as HelpService,
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([makeResult()]),
      );

      await realProvider.unifiedSearch(
        {
          query: 'recent work',
          createdAfter: '2026-06-01T00:00:00Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );
      await realProvider.unifiedSearch(
        {
          query: 'recent work',
          updatedAfter: '2026-06-01T00:00:00Z',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockSearchService.search).toHaveBeenCalledTimes(2);
    });
  });

  describe('taskSearch handler', () => {
    it('returns search results for tasks', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          makeResult({
            entityType: 'TASK',
            graph: { node: { priority: 'HIGH', initiativeId: null } },
          }),
        ]),
      );

      const result = (await provider.taskSearch(
        {
          query: 'auth bug',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.type).toBe('TASK');
      expect(result.total).toBe(1);
    });

    it('returns error when no user is authenticated', async () => {
      const result = await provider.taskSearch(
        {
          query: 'test',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest() as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('over-fetches with 3x multiplier when filters are active', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.taskSearch(
        {
          query: 'bug',

          status: 'IN_PROGRESS',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.embeddings.maxResults).toBe(30);
    });

    it('caps over-fetch at 50', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.taskSearch(
        {
          query: 'bug',

          status: 'IN_PROGRESS',
          limit: 50,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      // 50 * 3 = 150, capped at 50
      expect(searchRequest.embeddings.maxResults).toBe(50);
    });

    it('does not over-fetch when no filters are active', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.taskSearch(
        {
          query: 'bug',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.embeddings.maxResults).toBe(10);
    });

    it('filters by status post-fetch', async () => {
      const activeTask = makeResult({
        entityId: 'active-1',
        status: 'ACTIVE',
        graph: { node: {} },
      });
      const completedTask = makeResult({
        entityId: 'completed-1',
        status: 'COMPLETED',
        graph: { node: {} },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([activeTask, completedTask]),
      );

      const result = (await provider.taskSearch(
        {
          query: 'tasks',

          status: 'IN_PROGRESS',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      // Only ACTIVE status maps to IN_PROGRESS
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.id).toBe('active-1');
    });

    it('filters by priority via embeddings metadata', async () => {
      const highPriTask = makeResult({
        entityId: 'high-1',
        embeddings: { metadata: { priority: 'HIGH' } as any },
      });
      const lowPriTask = makeResult({
        entityId: 'low-1',
        embeddings: { metadata: { priority: 'LOW' } as any },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([highPriTask, lowPriTask]),
      );

      const result = (await provider.taskSearch(
        {
          query: 'tasks',

          priority: 'HIGH',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.id).toBe('high-1');
    });

    it('filters by initiativeId via embeddings metadata', async () => {
      const initId = '00000000-0000-4000-8000-000000000099';
      const matchTask = makeResult({
        entityId: 'match-1',
        embeddings: { metadata: { initiativeId: initId } as any },
      });
      const otherTask = makeResult({
        entityId: 'other-1',
        embeddings: { metadata: { initiativeId: 'different-id' } as any },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([matchTask, otherTask]),
      );

      const result = (await provider.taskSearch(
        {
          query: 'tasks',

          initiativeId: initId,
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.id).toBe('match-1');
    });

    it('hasMore is true when filtered results exceed limit', async () => {
      // 5 matching items, limit of 2 => items.length (5) > limit (2)
      const items = Array.from({ length: 5 }, (_, i) =>
        makeResult({
          entityId: `task-${i}`,
          status: 'ACTIVE',
          graph: { node: {} },
        }),
      );

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse(items),
      );

      const result = (await provider.taskSearch(
        {
          query: 'tasks',

          status: 'IN_PROGRESS',
          limit: 2,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });

    it('hasMore is true when raw results fill the fetch buffer', async () => {
      // With status filter and limit=10, fetchLimit = 30
      // Return exactly 30 items (all matching) => rawCount >= fetchLimit
      const items = Array.from({ length: 30 }, (_, i) =>
        makeResult({
          entityId: `task-${i}`,
          status: 'ACTIVE',
          graph: { node: {} },
        }),
      );

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse(items),
      );

      const result = (await provider.taskSearch(
        {
          query: 'tasks',

          status: 'IN_PROGRESS',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(10);
      expect(result.hasMore).toBe(true);
    });

    it('uses hybrid intent internally', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.taskSearch(
        {
          query: 'bug',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.intent).toBe('semantic');
    });

    it('returns MCP error on service failure', async () => {
      (mockSearchService.search as jest.Mock).mockRejectedValue(
        new Error('Service unavailable'),
      );

      const result = await provider.taskSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain('Service unavailable');
    });

    it('passes the GOAL subtype filter to unified search', async () => {
      const goalHit = makeResult({
        entityId: 'goal-1',
        embeddings: { metadata: { taskType: 'GOAL' } as any },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([goalHit]),
      );

      const result = (await provider.taskSearch(
        {
          query: 'goals',
          taskType: 'GOAL',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results.map((r) => r.id)).toEqual(['goal-1']);
      expect(
        (mockSearchService.search as jest.Mock).mock.calls[0][2].common
          .taskTypes,
      ).toEqual(['GOAL']);
    });

    it('pushes project-defined task types down and pages matching results at the API', async () => {
      const makeModePage = (start: number) =>
        Array.from({ length: 11 }, (_, index) =>
          makeResult({
            entityId: `mode-${start + index}`,
            embeddings: { metadata: { taskType: 'MODE' } as any },
          }),
        );

      (mockSearchService.search as jest.Mock)
        .mockResolvedValueOnce(makeSearchResponse(makeModePage(0)))
        .mockResolvedValueOnce(makeSearchResponse(makeModePage(10)));

      const firstPage = (await provider.taskSearch(
        {
          query: 'modes',
          taskType: 'MODE',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(firstPage.results.map((result) => result.id)).toEqual(
        Array.from({ length: 10 }, (_, index) => `mode-${index}`),
      );
      expect(firstPage.hasMore).toBe(true);

      const secondPage = (await provider.taskSearch(
        {
          query: 'modes',
          taskType: 'MODE',
          limit: 10,
          offset: 10,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(secondPage.results.map((result) => result.id)).toEqual(
        Array.from({ length: 10 }, (_, index) => `mode-${index + 10}`),
      );
      expect(secondPage.hasMore).toBe(true);

      const firstRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      const secondRequest = (mockSearchService.search as jest.Mock).mock
        .calls[1][2];
      expect(firstRequest.common.taskTypes).toEqual(['MODE']);
      expect(firstRequest.embeddings).toMatchObject({
        maxResults: 11,
        offset: 0,
      });
      expect(secondRequest.common.taskTypes).toEqual(['MODE']);
      expect(secondRequest.embeddings).toMatchObject({
        maxResults: 11,
        offset: 10,
      });
    });

    it('does not report more results for an empty server-filtered task type page', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      const result = (await provider.taskSearch(
        {
          query: 'modes',
          taskType: 'MODE',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toEqual([]);
      expect(result.hasMore).toBe(false);
    });
  });

  describe('searchFeatures handler', () => {
    it('passes the FEATURE subtype filter to unified search', async () => {
      const featureHit = makeResult({
        entityId: 'feature-1',
        embeddings: { metadata: { taskType: 'FEATURE' } as any },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([featureHit]),
      );

      const result = (await provider.searchFeatures(
        {
          query: 'features',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results.map((r) => r.id)).toEqual(['feature-1']);
      expect(
        (mockSearchService.search as jest.Mock).mock.calls[0][2].common
          .taskTypes,
      ).toEqual(['FEATURE']);
    });

    it('still narrows features by status even though status is omitted from output', async () => {
      const activeFeature = makeResult({
        entityId: 'feature-active',
        status: 'ACTIVE',
        graph: { node: {} },
        embeddings: { metadata: { taskType: 'FEATURE' } as any },
      });
      const completedFeature = makeResult({
        entityId: 'feature-completed',
        status: 'COMPLETED',
        graph: { node: {} },
        embeddings: { metadata: { taskType: 'FEATURE' } as any },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([activeFeature, completedFeature]),
      );

      const result = (await provider.searchFeatures(
        {
          query: 'features',
          status: 'IN_PROGRESS',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      // Only ACTIVE maps to IN_PROGRESS, so the filter still narrows on the
      // raw status even though the rendered metadata drops it.
      expect(result.results.map((r) => r.id)).toEqual(['feature-active']);
      expect(result.results[0]!.metadata).not.toHaveProperty('status');
    });
  });

  describe('searchGoals handler', () => {
    it('passes the GOAL subtype filter to unified search', async () => {
      const goalHit = makeResult({
        entityId: 'goal-1',
        embeddings: { metadata: { taskType: 'GOAL' } as any },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([goalHit]),
      );

      const result = (await provider.searchGoals(
        {
          query: 'goals',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results.map((r) => r.id)).toEqual(['goal-1']);
      expect(
        (mockSearchService.search as jest.Mock).mock.calls[0][2].common
          .taskTypes,
      ).toEqual(['GOAL']);
    });
  });

  describe('planSearch handler', () => {
    it('searches canonical Task records scoped to the PLAN work-item type', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          makeResult({
            entityId: 'plan-task',
            entityType: 'TASK',
            embeddings: { metadata: { taskType: 'PLAN' } as any },
          }),
        ]),
      );
      const result = (await provider.planSearch(
        { query: 'migration plan', limit: 10, offset: 0 },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;
      expect(result.results.map((row) => row.id)).toEqual(['plan-task']);
      expect(
        (mockSearchService.search as jest.Mock).mock.calls[0][2].common
          .taskTypes,
      ).toEqual(['PLAN']);
    });
  });

  describe('designDocSearch handler', () => {
    it('returns search results for design docs', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          makeResult({
            entityType: 'DESIGN_DOC',
            status: 'READY',
            title: 'Auth Architecture ADR',
            graph: { node: { template: 'ADR', tags: ['auth'] } },
          }),
        ]),
      );

      const result = (await provider.designDocSearch(
        {
          query: 'auth architecture',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.type).toBe('DESIGN_DOC');
      expect(result.results[0]!.metadata).toEqual(
        expect.objectContaining({
          template: 'ADR',
          tags: ['auth'],
        }),
      );
      expect(result.total).toBe(1);
    });

    it('returns error when no user is authenticated', async () => {
      const result = await provider.designDocSearch(
        {
          query: 'test',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest() as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('uses hybrid intent', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.designDocSearch(
        {
          query: 'design',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.intent).toBe('hybrid');
      expect(searchRequest.common.types).toEqual(['DESIGN_DOC']);
    });

    it.each([
      { offset: 0, expectedPage: 0 },
      { offset: 25, expectedPage: 1 },
      { offset: 37, expectedPage: 1 },
    ])(
      'uses zero-based Graph page $expectedPage for offset $offset',
      async ({ offset, expectedPage }) => {
        const rankedPages = [
          [
            makeResult({
              entityId: 'design-rank-1',
              entityType: 'DESIGN_DOC',
              title: 'First page top document',
            }),
          ],
          [
            makeResult({
              entityId: 'design-rank-26',
              entityType: 'DESIGN_DOC',
              title: 'Second page top document',
            }),
          ],
        ];
        (mockSearchService.search as jest.Mock).mockImplementation(
          async (_organizationId, _projectId, request) =>
            makeSearchResponse(rankedPages[request.graph.page] ?? []),
        );

        const result = (await provider.designDocSearch(
          { query: 'docs', limit: 25, offset },
          dummyContext as any,
          makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
        )) as SearchResult;

        const searchRequest = (mockSearchService.search as jest.Mock).mock
          .calls[0][2];
        expect(searchRequest.graph.page).toBe(expectedPage);
        expect(searchRequest.embeddings.offset).toBe(offset);
        expect(result.results.map((item) => item.id)).toEqual(
          rankedPages[expectedPage]?.map((item) => item.entityId),
        );
      },
    );

    it('passes template as docTypes filter to embeddings', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.designDocSearch(
        {
          query: 'adr',

          template: 'ADR',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.embeddings.filters.docTypes).toEqual(['ADR']);
    });

    it('passes tags filter to embeddings', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.designDocSearch(
        {
          query: 'security',

          tags: ['security', 'auth'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.embeddings.filters.tags).toEqual([
        'security',
        'auth',
      ]);
    });

    it('filters by status post-fetch using mapped statuses', async () => {
      const readyDoc = makeResult({
        entityId: 'doc-ready',
        entityType: 'DESIGN_DOC',
        status: 'READY',
        graph: { node: { template: 'ADR' } },
      });
      const draftingDoc = makeResult({
        entityId: 'doc-drafting',
        entityType: 'DESIGN_DOC',
        status: 'ADR_CONTEXT',
        graph: { node: { template: 'ADR' } },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([readyDoc, draftingDoc]),
      );

      const result = (await provider.designDocSearch(
        {
          query: 'docs',

          status: 'READY',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.id).toBe('doc-ready');
    });

    it('DRAFTING status matches all ADR drafting statuses', async () => {
      const adrContextDoc = makeResult({
        entityId: 'doc-1',
        entityType: 'DESIGN_DOC',
        status: 'ADR_CONTEXT',
        graph: { node: {} },
      });
      const adrDecisionDoc = makeResult({
        entityId: 'doc-2',
        entityType: 'DESIGN_DOC',
        status: 'ADR_DECISION',
        graph: { node: {} },
      });
      const refiningDoc = makeResult({
        entityId: 'doc-3',
        entityType: 'DESIGN_DOC',
        status: 'REFINING_CONTENT',
        graph: { node: {} },
      });
      const readyDoc = makeResult({
        entityId: 'doc-4',
        entityType: 'DESIGN_DOC',
        status: 'READY',
        graph: { node: {} },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          adrContextDoc,
          adrDecisionDoc,
          refiningDoc,
          readyDoc,
        ]),
      );

      const result = (await provider.designDocSearch(
        {
          query: 'docs',

          status: 'DRAFTING',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(3);
      const ids = result.results.map((r) => r.id);
      expect(ids).toContain('doc-1');
      expect(ids).toContain('doc-2');
      expect(ids).toContain('doc-3');
      expect(ids).not.toContain('doc-4');
    });

    it('over-fetches with 3x multiplier when status filter is active', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.designDocSearch(
        {
          query: 'docs',

          status: 'DRAFTING',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.embeddings.maxResults).toBe(30);
      expect(searchRequest.graph.size).toBe(30);
    });

    it('does not over-fetch when only server-side filters are active', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.designDocSearch(
        {
          query: 'docs',

          template: 'ADR',
          tags: ['auth'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.embeddings.maxResults).toBe(10);
      expect(searchRequest.graph.size).toBe(10);
    });

    it('returns empty results without error', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      const result = (await provider.designDocSearch(
        {
          query: 'nonexistent topic',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      expect(result.results).toHaveLength(0);
      expect(result.total).toBe(0);
      expect(result.hasMore).toBe(false);
    });

    it('returns MCP error on service failure', async () => {
      (mockSearchService.search as jest.Mock).mockRejectedValue(
        new Error('Service unavailable'),
      );

      const result = await provider.designDocSearch(
        {
          query: 'q',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Design doc search failed',
      );
    });

    it('applies combined template + status + tags filters correctly', async () => {
      const matchDoc = makeResult({
        entityId: 'doc-match',
        entityType: 'DESIGN_DOC',
        status: 'ADR_CONTEXT',
        graph: { node: { template: 'ADR', tags: ['auth'] } },
      });
      const wrongStatusDoc = makeResult({
        entityId: 'doc-wrong-status',
        entityType: 'DESIGN_DOC',
        status: 'READY',
        graph: { node: { template: 'ADR', tags: ['auth'] } },
      });

      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([matchDoc, wrongStatusDoc]),
      );

      const result = (await provider.designDocSearch(
        {
          query: 'auth adr',

          template: 'ADR',
          status: 'DRAFTING',
          tags: ['auth'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      )) as SearchResult;

      // template and tags are server-side, status is client-side
      const searchRequest = (mockSearchService.search as jest.Mock).mock
        .calls[0][2];
      expect(searchRequest.embeddings.filters.docTypes).toEqual(['ADR']);
      expect(searchRequest.embeddings.filters.tags).toEqual(['auth']);
      // Over-fetch should be active due to status filter
      expect(searchRequest.embeddings.maxResults).toBe(30);

      // Client-side status filter removes the READY doc
      expect(result.results).toHaveLength(1);
      expect(result.results[0]!.id).toBe('doc-match');
    });

    it('includes tool-specific filters in cache key', async () => {
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          makeResult({
            entityType: 'DESIGN_DOC',
            graph: { node: {} },
          }),
        ]),
      );

      await provider.designDocSearch(
        {
          query: 'design',

          template: 'ADR',
          status: 'READY',
          tags: ['auth'],
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockCacheService.generateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'search_design_docs',
          template: 'ADR',
          status: 'READY',
          tags: ['auth'],
        }),
      );
    });
  });

  describe('parameter schemas', () => {
    it('validates unified_search parameters', () => {
      const valid = unifiedSearchParameters.safeParse({
        query: 'search term',
      });
      expect(valid.success).toBe(true);

      const invalid = unifiedSearchParameters.safeParse({
        query: '',
      });
      expect(invalid.success).toBe(false);
    });

    it('unified_search has no intent parameter', () => {
      const result = unifiedSearchParameters.parse({
        query: 'test',
      });
      expect(result).not.toHaveProperty('intent');
    });

    it('task_search has no intent parameter', () => {
      const result = taskSearchParameters.parse({
        query: 'test',
      });
      expect(result).not.toHaveProperty('intent');
    });

    it('plan_search has no intent parameter', () => {
      const result = planSearchParameters.parse({
        query: 'test',
      });
      expect(result).not.toHaveProperty('intent');
    });

    it('task_search status enum does not include TODO', () => {
      const withTodo = taskSearchParameters.safeParse({
        query: 'test',
        status: 'TODO',
      });
      expect(withTodo.success).toBe(false);
    });

    it('validates task_search parameters with filters', () => {
      const valid = taskSearchParameters.safeParse({
        query: 'auth bug',
        status: 'IN_PROGRESS',
        priority: 'HIGH',
      });
      expect(valid.success).toBe(true);

      const invalidStatus = taskSearchParameters.safeParse({
        query: 'test',
        status: 'INVALID_STATUS',
      });
      expect(invalidStatus.success).toBe(false);
    });

    it('accepts GOAL as a valid task_search taskType filter', () => {
      const result = taskSearchParameters.safeParse({
        query: 'objectives',
        taskType: 'GOAL',
      });
      expect(result.success).toBe(true);
    });

    it('validates plan_search parameters with filters', () => {
      const valid = planSearchParameters.safeParse({
        query: 'migration plan',
        status: 'IN_PROGRESS',
      });
      expect(valid.success).toBe(true);

      const invalidStatus = planSearchParameters.safeParse({
        query: 'test',
        status: 'NONEXISTENT',
      });
      expect(invalidStatus.success).toBe(false);
    });

    it('validates design_doc_search parameters with filters', () => {
      const valid = designDocSearchParameters.safeParse({
        query: 'auth adr',
        template: 'ADR',
        status: 'DRAFTING',
        tags: ['auth'],
      });
      expect(valid.success).toBe(true);

      const invalidTemplate = designDocSearchParameters.safeParse({
        query: 'test',
        template: 'INVALID',
      });
      expect(invalidTemplate.success).toBe(false);

      const invalidStatus = designDocSearchParameters.safeParse({
        query: 'test',
        status: 'DONE',
      });
      expect(invalidStatus.success).toBe(false);

      // ARCHIVED is not a valid status filter — archiving uses archivedAt, not status
      const archivedStatus = designDocSearchParameters.safeParse({
        query: 'test',
        status: 'ARCHIVED',
      });
      expect(archivedStatus.success).toBe(false);
    });

    it('design_doc_search has no intent parameter', () => {
      const result = designDocSearchParameters.parse({
        query: 'test',
      });
      expect(result).not.toHaveProperty('intent');
    });

    it('applies default values for limit and offset', () => {
      const result = unifiedSearchParameters.parse({
        query: 'test',
      });
      expect(result.limit).toBe(10);
      expect(result.offset).toBe(0);
    });

    it('rejects limit outside valid range', () => {
      const tooHigh = unifiedSearchParameters.safeParse({
        query: 'test',
        limit: 200,
      });
      expect(tooHigh.success).toBe(false);

      const tooLow = unifiedSearchParameters.safeParse({
        query: 'test',
        limit: 0,
      });
      expect(tooLow.success).toBe(false);
    });

    it('rejects malformed createdAfter / createdBefore date-time values', () => {
      const badAfter = unifiedSearchParameters.safeParse({
        query: 'test',
        createdAfter: 'not-a-date',
      });
      expect(badAfter.success).toBe(false);

      const badBefore = unifiedSearchParameters.safeParse({
        query: 'test',
        createdBefore: '2026-05-20',
      });
      expect(badBefore.success).toBe(false);
    });

    it('accepts valid ISO-8601 createdAfter / createdBefore values', () => {
      const valid = unifiedSearchParameters.safeParse({
        query: 'test',
        createdAfter: '2026-05-01T00:00:00Z',
        createdBefore: '2026-05-20T12:30:00Z',
      });
      expect(valid.success).toBe(true);
    });

    it('validates updatedAfter / updatedBefore as ISO-8601 date-time values', () => {
      expect(
        unifiedSearchParameters.safeParse({
          query: 'test',
          updatedAfter: '2026-06-01T00:00:00Z',
          updatedBefore: '2026-06-20T12:30:00Z',
        }).success,
      ).toBe(true);

      expect(
        unifiedSearchParameters.safeParse({
          query: 'test',
          updatedAfter: '2026-06-01',
        }).success,
      ).toBe(false);
    });
  });

  describe('output schema', () => {
    it('validates well-formed search results', () => {
      const result = searchResultOutput.safeParse({
        results: [
          {
            id: '123',
            type: 'task',
            title: 'Fix auth',
            snippet: 'Authentication token...',
            score: 0.95,
            metadata: { status: 'active' },
          },
        ],
        total: 1,
        hasMore: false,
      });
      expect(result.success).toBe(true);
    });

    it('rejects results missing required fields', () => {
      const result = searchResultOutput.safeParse({
        results: [{ id: '123' }],
        total: 1,
        hasMore: false,
      });
      expect(result.success).toBe(false);
    });
  });

  describe('search caching', () => {
    it('returns cached result on exact-match hit', async () => {
      const cachedResult: SearchResult = {
        results: [
          {
            id: 'cached-1',
            type: 'TASK',
            title: 'Cached',
            snippet: 'From cache',
            score: 0.9,
          },
        ],
        total: 1,
        hasMore: false,
      };
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(cachedResult);

      const result = await provider.unifiedSearch(
        {
          query: 'auth',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(result).toBe(cachedResult);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('returns cached result on similar-query hit', async () => {
      const similarResult: SearchResult = {
        results: [
          {
            id: 'similar-1',
            type: 'TASK',
            title: 'Similar',
            snippet: 'From similar cache',
            score: 0.8,
          },
        ],
        total: 1,
        hasMore: false,
      };
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        similarResult,
      );

      const result = await provider.unifiedSearch(
        {
          query: 'authentication issues',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(result).toBe(similarResult);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('stores result in cache on miss', async () => {
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([makeResult()]),
      );

      await provider.unifiedSearch(
        {
          query: 'auth',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockCacheService.set).toHaveBeenCalledWith(
        'mock-cache-key',
        'auth',
        'mock-scope',
        'mock-filter-fp',
        expect.objectContaining({ results: expect.any(Array) }),
      );
    });

    it('does not cache errors', async () => {
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      (mockSearchService.search as jest.Mock).mockRejectedValue(
        new Error('fail'),
      );

      await provider.unifiedSearch(
        {
          query: 'auth',

          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockCacheService.set).not.toHaveBeenCalled();
    });

    it('includes tool-specific filters in cache key for taskSearch', async () => {
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          makeResult({ status: 'ACTIVE', graph: { node: {} } }),
        ]),
      );

      await provider.taskSearch(
        {
          query: 'bug',

          status: 'IN_PROGRESS',
          priority: 'HIGH',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockCacheService.generateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'task_search',
          status: 'IN_PROGRESS',
          priority: 'HIGH',
        }),
      );
    });

    it('includes tool-specific filters in cache key for planSearch', async () => {
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(undefined);
      (mockCacheService.findSimilar as jest.Mock).mockReturnValueOnce(
        undefined,
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([makeResult({ status: 'IN_PROGRESS' })]),
      );

      await provider.planSearch(
        {
          query: 'plan',

          status: 'IN_PROGRESS',
          limit: 10,
          offset: 0,
        },
        dummyContext as any,
        makeRequest({ orgId: ORG_ID, token: 'tok' }) as any,
      );

      expect(mockCacheService.generateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          tool: 'plan_search',
          status: 'IN_PROGRESS',
        }),
      );
    });
  });
});

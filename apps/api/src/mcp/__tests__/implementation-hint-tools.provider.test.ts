import {
  IMPLEMENTATION_HINT_SEARCH_TIMEOUT_MS,
  ImplementationHintToolsProvider,
} from '../tools/implementation-hint-tools.provider';
import { UnifiedSearchService } from '../../services/unified-search/unified-search.service';
import { SearchCacheService } from '../tools/search-cache.service';
import { ImplementationHintService } from '../../services/service/implementation-hint.service';
import { AgentSessionService } from '../../services/agent-session.service';
import { EntityType, UnifiedSearchResult } from '../../generated';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const SERVICE_ID = '00000000-0000-4000-8000-000000000002';
const SERVICE_ID_2 = '00000000-0000-4000-8000-000000000004';
const UNAUTHORIZED_SERVICE_ID = '00000000-0000-4000-8000-000000000005';
const PROJECT_ID = '00000000-0000-4000-8000-000000000003';
const ENTITY_ID = '00000000-0000-4000-8000-000000000010';
const HINT_ID = '00000000-0000-4000-8000-000000000020';
const SESSION_ID = '00000000-0000-4000-8000-000000000030';

function makeUser() {
  return {
    userId: 'u1',
    email: 'test@example.com',
    name: 'Test',
    currentOrgId: ORG_ID,
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
  };
}

function makeRequest(
  opts: {
    serviceId?: string;
    projectId?: string;
    token?: string;
    sessionId?: string | null;
  } = {},
) {
  const sessionId =
    opts.sessionId === null ? undefined : (opts.sessionId ?? SESSION_ID);
  return {
    headers: {
      authorization: opts.token ? `Bearer ${opts.token}` : 'Bearer tok',
      ...(opts.serviceId ? { 'x-service-id': opts.serviceId } : {}),
      ...(opts.projectId ? { 'x-project-id': opts.projectId } : {}),
      ...(sessionId ? { 'x-agent-session-id': sessionId } : {}),
    },
    cookies: {},
    user: makeUser(),
    ip: '127.0.0.1',
  } as any;
}

function makeResult(
  overrides: Partial<UnifiedSearchResult> = {},
): UnifiedSearchResult {
  return {
    entityId: ENTITY_ID,
    entityType: EntityType.ImplementationHint,
    score: 0.85,
    semanticScore: 0.85,
    title: 'Auth flow',
    content: 'Use middleware pattern for JWT refresh token handling',
    sources: ['embeddings'],
    ...overrides,
  };
}

function makeSearchResponse(
  results: UnifiedSearchResult[],
  overrides: Record<string, any> = {},
) {
  return {
    intent: 'semantic',
    query: 'auth',
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    results,
    execution: { totalMs: 10 },
    ...overrides,
  };
}

function makeHintRecord(overrides: Record<string, any> = {}) {
  return {
    id: HINT_ID,
    serviceId: SERVICE_ID,
    agentSessionId: SESSION_ID,
    featureName: 'auth',
    description: 'Use JWT middleware',
    sourceType: 'SYSTEM',
    hint: 'Attach verifyToken middleware before route handlers',
    confidence: 0.9,
    version: 1,
    fileReferences: [],
    versions: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

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

const mockHintService = {
  create: jest.fn(),
  update: jest.fn(),
  remove: jest.fn(),
} as unknown as jest.Mocked<ImplementationHintService>;

const mockAgentSessionService = {
  findOne: jest.fn(),
} as unknown as jest.Mocked<AgentSessionService>;

function createProvider() {
  return new ImplementationHintToolsProvider(
    mockSearchService as unknown as UnifiedSearchService,
    mockCacheService as unknown as SearchCacheService,
    mockHintService as unknown as ImplementationHintService,
    mockAgentSessionService as unknown as AgentSessionService,
  );
}

describe('ImplementationHintToolsProvider', () => {
  let provider: ImplementationHintToolsProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    (mockAgentSessionService.findOne as jest.Mock).mockResolvedValue({
      serviceIds: [SERVICE_ID],
    });
    provider = createProvider();
  });

  describe('search_implementation_hints', () => {
    it('returns the diagnosable missing-context result for a graph-only session', async () => {
      (mockAgentSessionService.findOne as jest.Mock).mockResolvedValue({
        serviceIds: [],
      });

      const result = await provider.searchImplementationHints(
        { query: 'auth', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ projectId: PROJECT_ID }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Missing authorized Service context',
      );
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('returns error when projectId is missing', async () => {
      const result = await provider.searchImplementationHints(
        { query: 'auth', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain('Missing projectId');
    });

    it('returns error when user is not authenticated', async () => {
      const req = makeRequest({
        serviceId: SERVICE_ID,
        projectId: PROJECT_ID,
      });
      req.user = undefined;

      const result = await provider.searchImplementationHints(
        { query: 'auth', limit: 10, offset: 0 },
        {} as any,
        req,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
    });

    it('calls UnifiedSearchService with semantic intent and authorized serviceIds filter', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.searchImplementationHints(
        { query: 'auth patterns', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
      );

      expect(mockSearchService.search).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        expect.objectContaining({
          intent: 'semantic',
          query: 'auth patterns',
          common: { types: [EntityType.ImplementationHint] },
          embeddings: expect.objectContaining({
            queryMode: 'default',
            maxResults: 10,
            offset: 0,
            filters: { serviceIds: [SERVICE_ID] },
          }),
        }),
        'tok',
      );
    });

    it('searches across the normalized authorized Service union and excludes an unauthorized header value', async () => {
      (mockAgentSessionService.findOne as jest.Mock).mockResolvedValue({
        serviceIds: [SERVICE_ID_2, SERVICE_ID],
      });
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.searchImplementationHints(
        { query: 'auth patterns', limit: 10, offset: 0 },
        {} as any,
        makeRequest({
          serviceId: UNAUTHORIZED_SERVICE_ID,
          projectId: PROJECT_ID,
        }),
      );

      expect(mockAgentSessionService.findOne).toHaveBeenCalledWith(
        ORG_ID,
        SESSION_ID,
        { projectId: PROJECT_ID },
      );
      expect(mockSearchService.search).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        expect.objectContaining({
          embeddings: expect.objectContaining({
            filters: { serviceIds: [SERVICE_ID, SERVICE_ID_2] },
          }),
        }),
        'tok',
      );
      expect(mockCacheService.generateKey).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceIds: [SERVICE_ID, SERVICE_ID_2],
        }),
      );
      expect(mockCacheService.buildFilterFingerprint).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceIds: [SERVICE_ID, SERVICE_ID_2],
        }),
      );
    });

    it('maps search results to output schema with relevance scores', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([
          makeResult({
            entityId: 'h1',
            title: 'Auth flow',
            content: 'Use middleware pattern for JWT refresh',
            score: 0.92,
            semanticScore: 0.92,
          }),
        ]),
      );

      const result = await provider.searchImplementationHints(
        { query: 'auth', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
      );

      expect((result as any).results).toHaveLength(1);
      expect((result as any).results[0]).toEqual({
        id: 'h1',
        type: EntityType.ImplementationHint,
        title: 'Auth flow',
        snippet: 'Use middleware pattern for JWT refresh',
        score: 0.92,
        metadata: {
          sources: ['embeddings'],
          semanticScore: 0.92,
          serviceId: SERVICE_ID,
        },
      });
      expect((result as any).total).toBe(1);
      expect((result as any).hasMore).toBe(false);
    });

    it('returns empty results without error', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      const result = await provider.searchImplementationHints(
        { query: 'nonexistent', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
      );

      expect((result as any).results).toHaveLength(0);
      expect((result as any).total).toBe(0);
      expect((result as any).hasMore).toBe(false);
    });

    it('sets hasMore when results exceed limit', async () => {
      const results = Array.from({ length: 11 }, (_, i) =>
        makeResult({ entityId: `h${i}`, score: 0.9 - i * 0.01 }),
      );
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse(results),
      );

      const result = await provider.searchImplementationHints(
        { query: 'feature', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
      );

      expect((result as any).results).toHaveLength(10);
      expect((result as any).hasMore).toBe(true);
    });

    it('returns cached results on cache hit', async () => {
      const cachedResult = {
        results: [
          {
            id: 'cached-h1',
            type: EntityType.ImplementationHint,
            title: 'Cached hint',
            snippet: 'From cache',
            score: 0.88,
          },
        ],
        total: 1,
        hasMore: false,
      };
      (mockCacheService.get as jest.Mock).mockReturnValueOnce(cachedResult);

      const result = await provider.searchImplementationHints(
        { query: 'auth', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
      );

      expect(result).toBe(cachedResult);
      expect(mockSearchService.search).not.toHaveBeenCalled();
    });

    it('returns descriptive error on search failure', async () => {
      (mockSearchService.search as jest.Mock).mockRejectedValue(
        new Error('Vespa connection timeout'),
      );

      const result = await provider.searchImplementationHints(
        { query: 'auth', limit: 10, offset: 0 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Implementation hint search failed: Vespa connection timeout',
      );
    });

    it('returns descriptive error when search does not complete before timeout', async () => {
      jest.useFakeTimers();
      try {
        (mockSearchService.search as jest.Mock).mockReturnValue(
          new Promise(() => undefined),
        );

        const resultPromise = provider.searchImplementationHints(
          { query: 'auth', limit: 10, offset: 0 },
          {} as any,
          makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
        );
        await jest.advanceTimersByTimeAsync(
          IMPLEMENTATION_HINT_SEARCH_TIMEOUT_MS,
        );

        const result = await resultPromise;

        expect((result as any).isError).toBe(true);
        expect((result as any).content[0].text).toContain(
          `Implementation hint search failed: Implementation hint search timed out after ${IMPLEMENTATION_HINT_SEARCH_TIMEOUT_MS}ms`,
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('passes pagination offset to search service', async () => {
      (mockSearchService.search as jest.Mock).mockResolvedValue(
        makeSearchResponse([]),
      );

      await provider.searchImplementationHints(
        { query: 'auth', limit: 5, offset: 10 },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, projectId: PROJECT_ID }),
      );

      expect(mockSearchService.search).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        expect.objectContaining({
          embeddings: expect.objectContaining({
            maxResults: 5,
            offset: 10,
          }),
        }),
        'tok',
      );
    });
  });

  describe('create_implementation_hint', () => {
    const validParams = {
      featureName: 'auth',
      description: 'Use JWT middleware',
      hint: 'Attach verifyToken middleware before route handlers',
      confidence: 0.9,
    };

    it('returns error when not authenticated', async () => {
      const req = makeRequest({ serviceId: SERVICE_ID });
      req.user = undefined;

      const result = await provider.createImplementationHint(
        validParams,
        {} as any,
        req,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
    });

    it('returns error when serviceId header is missing', async () => {
      const result = await provider.createImplementationHint(
        validParams,
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain('Missing serviceId');
    });

    it('calls hint service with correct DTO and hard-coded SYSTEM sourceType', async () => {
      (mockHintService.create as jest.Mock).mockResolvedValue(makeHintRecord());

      await provider.createImplementationHint(
        validParams,
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect(mockHintService.create).toHaveBeenCalledWith(
        ORG_ID,
        expect.objectContaining({
          serviceId: SERVICE_ID,
          agentSessionId: SESSION_ID,
          featureName: 'auth',
          description: 'Use JWT middleware',
          sourceType: 'SYSTEM',
          hint: 'Attach verifyToken middleware before route handlers',
          confidence: 0.9,
        }),
      );
    });

    it('returns created hint fields', async () => {
      (mockHintService.create as jest.Mock).mockResolvedValue(makeHintRecord());

      const result = await provider.createImplementationHint(
        validParams,
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect(result).toEqual({
        id: HINT_ID,
        featureName: 'auth',
        description: 'Use JWT middleware',
        hint: 'Attach verifyToken middleware before route handlers',
        confidence: 0.9,
      });
    });

    it('omits hint and confidence from DTO when not provided', async () => {
      (mockHintService.create as jest.Mock).mockResolvedValue(
        makeHintRecord({ hint: undefined, confidence: undefined }),
      );

      await provider.createImplementationHint(
        { featureName: 'auth', description: 'desc' },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      const dto = (mockHintService.create as jest.Mock).mock.calls[0][1];
      expect(dto).not.toHaveProperty('hint');
      expect(dto).not.toHaveProperty('confidence');
    });

    it('propagates service error when agentSessionId does not exist', async () => {
      (mockHintService.create as jest.Mock).mockRejectedValue(
        new Error('Agent session not found'),
      );

      const result = await provider.createImplementationHint(
        validParams,
        {} as any,
        makeRequest({
          serviceId: SERVICE_ID,
          sessionId: '00000000-0000-4000-8000-000000000099',
        }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Implementation hint creation failed: Agent session not found',
      );
    });

    it('returns error when X-Agent-Session-ID header is missing', async () => {
      const result = await provider.createImplementationHint(
        validParams,
        {} as any,
        makeRequest({ serviceId: SERVICE_ID, sessionId: null }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Missing agent session',
      );
    });

    it('returns descriptive error on service failure', async () => {
      (mockHintService.create as jest.Mock).mockRejectedValue(
        new Error('Agent session not found'),
      );

      const result = await provider.createImplementationHint(
        validParams,
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Implementation hint creation failed: Agent session not found',
      );
    });
  });

  describe('edit_implementation_hint', () => {
    const validParams = {
      hintId: HINT_ID,
      featureName: 'auth-v2',
      hint: 'Updated guidance',
      confidence: 0.95,
    };

    it('returns error when not authenticated', async () => {
      const req = makeRequest({ serviceId: SERVICE_ID });
      req.user = undefined;

      const result = await provider.editImplementationHint(
        validParams,
        {} as any,
        req,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
    });

    it('returns error when serviceId header is missing', async () => {
      const result = await provider.editImplementationHint(
        validParams,
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain('Missing serviceId');
    });

    it('calls hint service with hintId, serviceId, and provided fields only', async () => {
      (mockHintService.update as jest.Mock).mockResolvedValue(
        makeHintRecord({
          featureName: 'auth-v2',
          hint: 'Updated guidance',
          confidence: 0.95,
        }),
      );

      await provider.editImplementationHint(
        validParams,
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect(mockHintService.update).toHaveBeenCalledWith(
        ORG_ID,
        HINT_ID,
        expect.objectContaining({
          serviceId: SERVICE_ID,
          featureName: 'auth-v2',
          hint: 'Updated guidance',
          confidence: 0.95,
        }),
      );
    });

    it('omits undefined optional fields from DTO when only one field is provided', async () => {
      (mockHintService.update as jest.Mock).mockResolvedValue(makeHintRecord());

      await provider.editImplementationHint(
        { hintId: HINT_ID, featureName: 'auth-v2' },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      const dto = (mockHintService.update as jest.Mock).mock.calls[0][2];
      expect(dto).toHaveProperty('featureName', 'auth-v2');
      expect(dto).not.toHaveProperty('description');
      expect(dto).not.toHaveProperty('hint');
      expect(dto).not.toHaveProperty('confidence');
    });

    it('returns updated hint fields', async () => {
      (mockHintService.update as jest.Mock).mockResolvedValue(
        makeHintRecord({
          featureName: 'auth-v2',
          hint: 'Updated guidance',
          confidence: 0.95,
        }),
      );

      const result = await provider.editImplementationHint(
        validParams,
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect(result).toEqual({
        id: HINT_ID,
        featureName: 'auth-v2',
        description: 'Use JWT middleware',
        hint: 'Updated guidance',
        confidence: 0.95,
      });
    });

    it('returns error when no update fields are provided', async () => {
      const result = await provider.editImplementationHint(
        { hintId: HINT_ID },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'No fields provided to update',
      );
      expect(mockHintService.update).not.toHaveBeenCalled();
    });

    it('returns descriptive error on service failure', async () => {
      (mockHintService.update as jest.Mock).mockRejectedValue(
        new Error('Hint not found'),
      );

      const result = await provider.editImplementationHint(
        validParams,
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Implementation hint update failed: Hint not found',
      );
    });
  });

  describe('delete_implementation_hint', () => {
    it('returns error when not authenticated', async () => {
      const req = makeRequest({ serviceId: SERVICE_ID });
      req.user = undefined;

      const result = await provider.deleteImplementationHint(
        { hintId: HINT_ID },
        {} as any,
        req,
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Authentication required',
      );
    });

    it('calls hint service with organizationId and hintId', async () => {
      (mockHintService.remove as jest.Mock).mockResolvedValue(undefined);

      await provider.deleteImplementationHint(
        { hintId: HINT_ID },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect(mockHintService.remove).toHaveBeenCalledWith(ORG_ID, HINT_ID);
    });

    it('returns deleted confirmation with hintId', async () => {
      (mockHintService.remove as jest.Mock).mockResolvedValue(undefined);

      const result = await provider.deleteImplementationHint(
        { hintId: HINT_ID },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect(result).toEqual({ deleted: true, hintId: HINT_ID });
    });

    it('does not require serviceId header', async () => {
      (mockHintService.remove as jest.Mock).mockResolvedValue(undefined);

      const result = await provider.deleteImplementationHint(
        { hintId: HINT_ID },
        {} as any,
        makeRequest(),
      );

      expect((result as any).isError).toBeUndefined();
      expect((result as any).deleted).toBe(true);
    });

    it('returns descriptive error on service failure', async () => {
      (mockHintService.remove as jest.Mock).mockRejectedValue(
        new Error('Hint not found'),
      );

      const result = await provider.deleteImplementationHint(
        { hintId: HINT_ID },
        {} as any,
        makeRequest({ serviceId: SERVICE_ID }),
      );

      expect((result as any).isError).toBe(true);
      expect((result as any).content[0].text).toContain(
        'Implementation hint deletion failed: Hint not found',
      );
    });
  });
});

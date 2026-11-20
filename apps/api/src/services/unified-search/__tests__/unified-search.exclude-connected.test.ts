import type { UnifiedSearchRequest } from '@hey-hey/contracts/api/models';
import type { SearchRequest as GraphSearchRequest } from 'src/generated/graphs';
import type { SearchRequest as EmbeddingsSearchRequest } from 'src/generated/embeddings';
import { OrganizationId, ProjectId } from 'src/types';
import { createMockPrismaService } from '../../../utils/testUtils';
import { UnifiedSearchService } from '../unified-search.service';

const organizationId = 'org-1' as OrganizationId;
const projectId = 'proj-1' as ProjectId;

const CASE = '11111111-1111-4111-8111-111111111111';
const EVAL = '22222222-2222-4222-8222-222222222222';
const LEAK = '33333333-3333-4333-8333-333333333333';
const KEPT = '44444444-4444-4444-8444-444444444444';
const EXCLUSION = { entityIds: [CASE, EVAL], depth: 1 };

const hits = [
  { id: LEAK, type: 'message', similarity: 0.99 },
  { id: KEPT, type: 'design_doc', similarity: 0.9 },
];

const buildService = (
  resolve: jest.Mock = jest
    .fn()
    .mockResolvedValue({ entityIds: [CASE, EVAL, LEAK] }),
) => {
  const embeddings = {
    // As the real service behaves: excluded ids never come back.
    searchEmbeddingsWithUserTokenPost: jest.fn(
      (_org: unknown, _project: unknown, request: EmbeddingsSearchRequest) => {
        const excluded = request.filters?.excludeEntityIds ?? [];
        const kept = hits.filter((hit) => !excluded.includes(hit.id));

        return Promise.resolve({
          success: true,
          results: kept.length,
          data: kept.map((hit) => ({
            id: `${hit.id}_chunk_0`,
            text: hit.id,
            similarity: hit.similarity,
            metadata: { id: hit.id, type: hit.type },
          })),
        } as never);
      },
    ),
  };
  const graphs = {
    searchGraph: jest.fn((_o: unknown, _p: unknown, _r: GraphSearchRequest) =>
      Promise.resolve({
        results: [],
        relationships: [],
        totalElements: 0,
        totalPages: 0,
        page: 0,
        size: 50,
      } as never),
    ),
    resolveSearchExclusion: resolve,
  };
  const service = new UnifiedSearchService(
    embeddings as never,
    graphs as never,
    { findManyByIds: jest.fn().mockResolvedValue(new Map()) } as never,
    { findManyByIds: jest.fn().mockResolvedValue(new Map()) } as never,
    {
      findManyByIdsWithSections: jest.fn().mockResolvedValue(new Map()),
    } as never,
    {
      getCurrentSummariesForEntities: jest.fn().mockResolvedValue([]),
    } as never,
    createMockPrismaService() as never,
    {
      resolveForWorkflowAbout: jest
        .fn()
        .mockResolvedValue({ resolvedContext: {}, additionalHeaders: {} }),
    } as never,
    { resolveBoostDeltas: jest.fn().mockResolvedValue(new Map()) } as never,
  );

  return { service, embeddings, graphs, resolve };
};

const ids = (result: { results?: { entityId?: string }[] }) =>
  (result.results ?? []).flatMap((hit) => hit.entityId ?? []);

describe('unified search excludeConnected', () => {
  it('hides what is connected from both lanes, working the set out once', async () => {
    const { service, embeddings, graphs, resolve } = buildService();
    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      query: 'retry failed attempts',
      graph: { seedEntityIds: ['seed'] },
      excludeConnected: EXCLUSION,
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      'token',
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith(
      organizationId,
      projectId,
      { entityIds: EXCLUSION.entityIds, depth: 1 },
      'token',
    );
    expect(
      graphs.searchGraph.mock.calls[0]?.[2].filters?.excludeEntityIds,
    ).toEqual([CASE, EVAL, LEAK]);
    expect(
      embeddings.searchEmbeddingsWithUserTokenPost.mock.calls[0]?.[2].filters
        ?.excludeEntityIds,
    ).toEqual([CASE, EVAL, LEAK]);
    expect(ids(result)).toEqual([KEPT]);
  });

  it('resolves a batch once per distinct exclusion', async () => {
    const { service, embeddings, resolve } = buildService();

    await service.batchSearch(
      organizationId,
      projectId,
      {
        queries: [
          { intent: 'semantic', query: 'one', excludeConnected: EXCLUSION },
          { intent: 'semantic', query: 'two', excludeConnected: EXCLUSION },
        ],
      },
      'token',
    );

    expect(resolve).toHaveBeenCalledTimes(1);
    for (const call of embeddings.searchEmbeddingsWithUserTokenPost.mock
      .calls) {
      expect(call[2].filters?.excludeEntityIds).toEqual([CASE, EVAL, LEAK]);
    }
  });

  it('fails the search when the exclusion cannot be worked out, never searching without it', async () => {
    const { service, embeddings, graphs } = buildService(
      jest.fn().mockRejectedValue(new Error('graph unavailable')),
    );

    await expect(
      service.search(
        organizationId,
        projectId,
        { intent: 'semantic', query: 'retry', excludeConnected: EXCLUSION },
        'token',
      ),
    ).rejects.toThrow('graph unavailable');
    expect(embeddings.searchEmbeddingsWithUserTokenPost).not.toHaveBeenCalled();
    expect(graphs.searchGraph).not.toHaveBeenCalled();
  });

  it('costs an ordinary search nothing: no exclusion call and no new request fields', async () => {
    const { service, embeddings, graphs, resolve } = buildService();

    await service.search(
      organizationId,
      projectId,
      {
        intent: 'hybrid',
        query: 'retry',
        graph: { seedEntityIds: ['seed'] },
      },
      'token',
    );

    expect(resolve).not.toHaveBeenCalled();
    expect(graphs.searchGraph.mock.calls[0]?.[2].filters).toBeUndefined();
    expect(
      embeddings.searchEmbeddingsWithUserTokenPost.mock.calls[0]?.[2].filters,
    ).toBeUndefined();
  });
});

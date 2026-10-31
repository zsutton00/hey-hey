import { ReadRestriction, type UnifiedSearchRequest } from 'src/generated';
import type {
  SearchRequest as GraphSearchRequest,
  SearchResponse as GraphSearchResponse,
} from 'src/generated/graphs';
import type { SearchRequest as EmbeddingsSearchRequest } from 'src/generated/embeddings';
import { OrganizationId, ProjectId } from 'src/types';
import {
  ReadPolicyContext,
  readPolicyFor,
} from '../../../read-restriction/read-policy';
import { createMockPrismaService } from '../../../utils/testUtils';
import { UnifiedSearchService } from '../unified-search.service';

const organizationId = 'org-1' as OrganizationId;
const projectId = 'proj-1' as ProjectId;

/**
 * A project whose best matches are the Eval Case that holds the grading answers and its attempt
 * report; the permitted work item ranks below them.
 */
const taskHits = [
  { id: 'eval-case-answers', taskType: 'EVAL_CASE', similarity: 0.99 },
  { id: 'eval-case-two', taskType: 'EVAL_CASE', similarity: 0.97 },
  { id: 'eval-definition', taskType: 'EVAL', similarity: 0.96 },
  { id: 'standard-task-retry', taskType: 'STANDARD', similarity: 0.7 },
  { id: 'feature-evaluations', taskType: 'FEATURE', similarity: 0.6 },
  { id: 'bug-timeout', taskType: 'BUG', similarity: 0.5 },
];

/** Embeddings as the real service behaves: exclusions are applied before offset and limit. */
const embeddingsOverProject = (
  _org: unknown,
  _project: unknown,
  request: EmbeddingsSearchRequest,
) => {
  const excluded = request.filters?.excludeTaskTypes ?? [];
  const requested = request.filters?.taskTypes;
  const matching = taskHits.filter(
    (hit) =>
      !excluded.includes(hit.taskType) &&
      (!requested || requested.includes(hit.taskType)),
  );
  const page = matching.slice(
    request.offset ?? 0,
    (request.offset ?? 0) + (request.max_results ?? 10),
  );

  return Promise.resolve({
    success: true,
    results: matching.length,
    data: page.map((hit) => ({
      id: `${hit.id}_chunk_0`,
      text: hit.id,
      similarity: hit.similarity,
      metadata: { id: hit.id, type: 'task', taskType: hit.taskType },
    })),
  } as never);
};

/** Graph as the real service behaves: totals and pages count only permitted content. */
const graphOverProject = (
  _org: unknown,
  _project: unknown,
  request: GraphSearchRequest,
): Promise<GraphSearchResponse> => {
  const excluded = request.filters?.excludeTaskTypes ?? [];
  const requested = request.filters?.taskTypes;
  const matching = taskHits.filter(
    (hit) =>
      !excluded.includes(hit.taskType) &&
      (!requested || requested.includes(hit.taskType)),
  );
  const size = request.size ?? 50;
  const page = request.page ?? 0;

  return Promise.resolve({
    results: matching.slice(page * size, (page + 1) * size).map((hit) => ({
      entityId: hit.id,
      entityType: 'TASK',
      score: hit.similarity,
      node: {
        id: hit.id,
        type: 'TASK',
        properties: { name: hit.id, type: hit.taskType },
      },
    })),
    relationships: [],
    totalElements: matching.length,
    totalPages: Math.ceil(matching.length / size),
    page,
    size,
  } as never);
};

const buildService = () => {
  const embeddings = {
    searchEmbeddingsWithUserTokenPost: jest.fn(embeddingsOverProject),
  };
  const graphs = { searchGraph: jest.fn(graphOverProject) };
  const taskService = { findManyByIds: jest.fn().mockResolvedValue(new Map()) };
  const service = new UnifiedSearchService(
    embeddings as never,
    graphs as never,
    taskService as never,
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

  return { service, embeddings, graphs };
};

const asEvaluatedAttempt = <T>(read: () => T): T =>
  ReadPolicyContext.run(readPolicyFor(ReadRestriction.EvalTarget), read);

const ids = (result: { results?: { entityId?: string }[] }) =>
  (result.results ?? []).flatMap((hit) => hit.entityId ?? []);

const PROTECTED = ['eval-case-answers', 'eval-case-two', 'eval-definition'];

describe('unified search for an evaluated attempt', () => {
  it('fills a semantic page with permitted results although protected records rank first', async () => {
    const { service } = buildService();
    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'retrying failed eval attempts',
      embeddings: { maxResults: 2 },
    };

    const evaluated = await asEvaluatedAttempt(() =>
      service.search(organizationId, projectId, request, 'token'),
    );
    const ordinary = await service.search(
      organizationId,
      projectId,
      request,
      'token',
    );

    expect(ids(evaluated)).toEqual([
      'standard-task-retry',
      'feature-evaluations',
    ]);
    expect(ids(ordinary)).toEqual(['eval-case-answers', 'eval-case-two']);
    expect(JSON.stringify(evaluated)).not.toMatch(/eval-case|eval-definition/);
  });

  it('keeps a semantic offset over permitted results only', async () => {
    const { service, embeddings } = buildService();

    const secondPage = await asEvaluatedAttempt(() =>
      service.search(
        organizationId,
        projectId,
        {
          intent: 'semantic',
          query: 'retry',
          embeddings: { maxResults: 2, offset: 2 },
        },
        'token',
      ),
    );

    expect(ids(secondPage)).toEqual(['bug-timeout']);
    expect(
      embeddings.searchEmbeddingsWithUserTokenPost.mock.calls[0]?.[2].filters,
    ).toMatchObject({
      excludeTaskTypes: ['EVAL', 'EVAL_CASE'],
    });
  });

  it('pages and counts relationship results over permitted content in the graph query', async () => {
    const { service, graphs } = buildService();

    const firstPage = await asEvaluatedAttempt(() =>
      service.search(
        organizationId,
        projectId,
        {
          intent: 'relationship',
          graph: { seedEntityIds: ['seed'], size: 2, page: 0 },
        },
        'token',
      ),
    );

    expect(ids(firstPage)).toEqual([
      'standard-task-retry',
      'feature-evaluations',
    ]);
    expect(firstPage.graph?.totalElements).toBe(3);
    expect(firstPage.graph?.totalPages).toBe(2);
    expect(graphs.searchGraph.mock.calls[0]?.[2].filters).toMatchObject({
      excludeTaskTypes: ['EVAL', 'EVAL_CASE'],
      excludeReportTypes: ['EVAL_RUN', 'EVAL_ATTEMPT', 'EVAL_HUMAN_REVIEW'],
    });
  });

  it('applies the exclusions to both lanes of a hybrid search', async () => {
    const { service, graphs, embeddings } = buildService();

    const hybrid = await asEvaluatedAttempt(() =>
      service.search(
        organizationId,
        projectId,
        {
          intent: 'hybrid',
          query: 'retry failed attempts',
          graph: { seedEntityIds: ['seed'] },
        },
        'token',
      ),
    );

    expect(ids(hybrid)).not.toEqual(expect.arrayContaining(PROTECTED));
    expect(
      graphs.searchGraph.mock.calls[0]?.[2].filters?.excludeTaskTypes,
    ).toEqual(['EVAL', 'EVAL_CASE']);
    expect(
      embeddings.searchEmbeddingsWithUserTokenPost.mock.calls[0]?.[2].filters
        ?.excludeTaskTypes,
    ).toEqual(['EVAL', 'EVAL_CASE']);
  });

  it('cannot be lifted by asking for a protected type, which narrows to nothing', async () => {
    const { service, embeddings } = buildService();

    const result = await asEvaluatedAttempt(() =>
      service.search(
        organizationId,
        projectId,
        {
          intent: 'semantic',
          query: 'retry',
          common: { taskTypes: ['EVAL_CASE', 'BUG'] },
        },
        'token',
      ),
    );

    expect(ids(result)).toEqual(['bug-timeout']);
    expect(
      embeddings.searchEmbeddingsWithUserTokenPost.mock.calls[0]?.[2].filters,
    ).toMatchObject({
      taskTypes: ['EVAL_CASE', 'BUG'],
      excludeTaskTypes: ['EVAL', 'EVAL_CASE'],
    });
  });

  it('keeps a caller’s own exclusions beside the execution’s', async () => {
    const { service, embeddings } = buildService();

    await asEvaluatedAttempt(() =>
      service.search(
        organizationId,
        projectId,
        {
          intent: 'semantic',
          query: 'retry',
          common: { excludeTaskTypes: ['BUG'] },
        },
        'token',
      ),
    );

    expect(
      embeddings.searchEmbeddingsWithUserTokenPost.mock.calls[0]?.[2].filters
        ?.excludeTaskTypes,
    ).toEqual(['EVAL', 'EVAL_CASE', 'BUG']);
  });

  it('applies the exclusions to every query of a batch', async () => {
    const { service, embeddings, graphs } = buildService();

    const batch = await asEvaluatedAttempt(() =>
      service.batchSearch(
        organizationId,
        projectId,
        {
          queries: [
            { intent: 'semantic', query: 'retry failed attempts' },
            { intent: 'semantic', query: 'grading expectations' },
            { intent: 'relationship', graph: { seedEntityIds: ['seed'] } },
          ],
        },
        'token',
      ),
    );

    expect(JSON.stringify(batch)).not.toMatch(/eval-case|eval-definition/);
    for (const [, , request] of embeddings.searchEmbeddingsWithUserTokenPost
      .mock.calls) {
      expect(request.filters?.excludeTaskTypes).toEqual(['EVAL', 'EVAL_CASE']);
    }
    for (const [, , request] of graphs.searchGraph.mock.calls) {
      expect(request.filters?.excludeTaskTypes).toEqual(['EVAL', 'EVAL_CASE']);
    }
  });

  it('changes nothing for an ordinary session, eval authoring or the judge’s task reads', async () => {
    const { service, embeddings } = buildService();

    await service.search(
      organizationId,
      projectId,
      { intent: 'semantic', query: 'retry' },
      'token',
    );
    await ReadPolicyContext.run(readPolicyFor(ReadRestriction.EvalJudge), () =>
      service.search(
        organizationId,
        projectId,
        { intent: 'semantic', query: 'retry' },
        'token',
      ),
    );

    for (const [, , request] of embeddings.searchEmbeddingsWithUserTokenPost
      .mock.calls) {
      expect(request.filters?.excludeTaskTypes).toBeUndefined();
    }
  });
});

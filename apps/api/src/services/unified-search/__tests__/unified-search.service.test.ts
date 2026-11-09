import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import { HttpStatus } from '@nestjs/common';
import {
  EntityType as ApiEntityType,
  UnifiedBatchSearchRequest,
  UnifiedMatchParagraph,
  UnifiedSearchPlanLineageMode,
  UnifiedSearchRequest,
} from '@hey-hey/contracts/api/models';
import {
  EntityType as GraphEntityType,
  SearchProjection,
  SearchResponse as GraphSearchResponse,
} from 'src/generated/graphs';
import { OrganizationId, ProjectId } from 'src/types';
import { DesignDocService } from '../../design-doc/design-doc.service';
import { EmbeddingsClientService } from '../../embeddings-client.service';
import { GraphsClientService } from '../../graphs-client.service';
import { InitiativeService } from '../../initiatives/initiative.service';
import { TaskService } from '../../tasks/task.service';
import { EntitySummaryService } from '../../entity-summary/entity-summary.service';
import { EntityRelationshipResolverService } from '../../relationships/entity-relationship-resolver.service';
import { PlanLineageBoostService } from '../plan-lineage-boost.service';
import { UnifiedSearchService } from '../unified-search.service';
import { MAX_MATCH_PARAGRAPH_LENGTH } from '../match-paragraphs';
import { createMockPrismaService } from '../../../utils/testUtils';
import { PrismaService } from '../../../prisma/prisma.service';

describe('UnifiedSearchService', () => {
  const organizationId = 'org-1' as OrganizationId;
  const projectId = 'proj-1' as ProjectId;
  const userToken = 'token';

  let service: UnifiedSearchService;
  let embeddingsClient: jest.Mocked<EmbeddingsClientService>;
  let graphsClient: jest.Mocked<GraphsClientService>;
  let taskService: jest.Mocked<TaskService>;
  let initiativeService: jest.Mocked<InitiativeService>;
  let designDocService: jest.Mocked<DesignDocService>;
  let entitySummaryService: jest.Mocked<EntitySummaryService>;
  let prismaService: jest.Mocked<PrismaService>;
  let entityRelationshipResolverService: jest.Mocked<EntityRelationshipResolverService>;
  let planLineageBoostService: jest.Mocked<PlanLineageBoostService>;

  beforeEach(() => {
    embeddingsClient = {
      searchEmbeddingsWithUserTokenPost: jest.fn(),
    } as unknown as jest.Mocked<EmbeddingsClientService>;
    graphsClient = {
      searchGraph: jest.fn(),
    } as unknown as jest.Mocked<GraphsClientService>;
    taskService = {
      findManyByIds: jest.fn(),
    } as unknown as jest.Mocked<TaskService>;
    initiativeService = {
      findManyByIds: jest.fn(),
    } as unknown as jest.Mocked<InitiativeService>;
    designDocService = {
      findManyByIdsWithSections: jest.fn(),
    } as unknown as jest.Mocked<DesignDocService>;
    entitySummaryService = {
      getCurrentSummariesForEntities: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<EntitySummaryService>;
    prismaService =
      createMockPrismaService() as unknown as jest.Mocked<PrismaService>;
    if (!prismaService.conversation) {
      (
        prismaService as unknown as { conversation: { findFirst: jest.Mock } }
      ).conversation = {
        findFirst: jest.fn(),
      };
    }
    entityRelationshipResolverService = {
      resolveForWorkflowAbout: jest.fn().mockResolvedValue({
        resolvedContext: {},
        additionalHeaders: {},
      }),
    } as unknown as jest.Mocked<EntityRelationshipResolverService>;
    planLineageBoostService = {
      resolveBoostDeltas: jest
        .fn()
        .mockResolvedValue(new Map<string, number>()),
    } as unknown as jest.Mocked<PlanLineageBoostService>;
    service = new UnifiedSearchService(
      embeddingsClient,
      graphsClient,
      taskService,
      initiativeService,
      designDocService,
      entitySummaryService,
      prismaService,
      entityRelationshipResolverService,
      planLineageBoostService,
    );
  });

  it('rejects missing auth token', async () => {
    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'test',
    };

    await expect(
      service.search(organizationId, projectId, request, null),
    ).rejects.toThrow('Authentication token not found');
  });

  it('rejects boosts with missing entityId weight', async () => {
    const request = {
      intent: 'semantic',
      query: 'test',
      boosts: {
        entityIds: [{ id: 'entity-1' }],
      },
    } as unknown as UnifiedSearchRequest;

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow('boosts.entityIds[0].weight is required');
  });

  it('rejects boosts with missing entityType weight', async () => {
    const request = {
      intent: 'semantic',
      query: 'test',
      boosts: {
        entityTypes: [{ type: ApiEntityType.Task }],
      },
    } as unknown as UnifiedSearchRequest;

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow('boosts.entityTypes[0].weight is required');
  });

  it('rejects planLineage boosts when both taskId and designDocId are missing', async () => {
    const request = {
      intent: 'semantic',
      query: 'test',
      boosts: {
        planLineage: {
          mode: UnifiedSearchPlanLineageMode.WorkItemDependencies,
          planId: 'plan-1',
        },
      },
    } as unknown as UnifiedSearchRequest;

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow(
      'Exactly one of boosts.planLineage.taskId or boosts.planLineage.designDocId is required',
    );
  });

  it('rejects unsupported planLineage mode', async () => {
    const request = {
      intent: 'semantic',
      query: 'test',
      boosts: {
        planLineage: {
          mode: 'other',
          planId: 'plan-1',
          taskId: 'task-1',
        },
      },
    } as unknown as UnifiedSearchRequest;

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow('Unsupported boosts.planLineage.mode: other');
  });

  it('routes relationship intent to graph search', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      common: {
        types: [ApiEntityType.Task, ApiEntityType.Artifact],
        statuses: ['active'],
        dateRange: {
          from: '2026-05-01T00:00:00Z',
          to: '2026-05-31T23:59:59Z',
        },
        updatedAtRange: {
          from: '2026-06-01T00:00:00Z',
          to: '2026-06-15T23:59:59Z',
        },
      },
      boosts: {
        entityIds: [{ id: 'entity-1', weight: 1.2 }],
        entityTypes: [
          { type: ApiEntityType.Task, weight: 1.05 },
          { type: ApiEntityType.Artifact, weight: 1.2 },
        ],
      },
      graph: {
        includeRelationships: true,
        seedEntityIds: ['entity-1'],
        filters: {
          entityTypes: [ApiEntityType.Project],
          statuses: ['COMPLETED'],
        },
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(graphsClient.searchGraph).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        seedEntityIds: ['entity-1'],
        includeRelationships: true,
        filters: expect.objectContaining({
          entityTypes: [GraphEntityType.Task],
          statuses: ['ACTIVE'],
          dateRange: {
            from: '2026-05-01T00:00:00Z',
            to: '2026-05-31T23:59:59Z',
          },
          updatedAtRange: {
            from: '2026-06-01T00:00:00Z',
            to: '2026-06-15T23:59:59Z',
          },
        }),
        boosts: {
          entityIds: [
            expect.objectContaining({
              id: 'entity-1',
              weight: expect.closeTo(0.2, 6),
            }),
          ],
          entityTypes: [
            expect.objectContaining({
              type: GraphEntityType.Task,
              weight: expect.closeTo(0.05, 6),
            }),
          ],
        },
      }),
      userToken,
    );
    expect(result.graph).toBeDefined();
    expect(result.embeddings).toBeUndefined();
    expect(result.results).toBeDefined();
  });

  it.each(['relationship', 'hybrid'] as const)(
    'preserves %s fusion results with compact graph payloads',
    async (intent) => {
      const entityId = 'a1349862-4931-4b4e-a5ea-d2a90020bcd2';
      const graph: GraphSearchResponse = {
        results: [
          {
            entityId,
            entityType: GraphEntityType.Task,
            score: 0.8,
            node: {
              id: entityId,
              type: 'TASK',
              organizationId: '51c20fbf-a4f1-4147-a7e2-133431dc16fb',
              projectId: 'c8956bba-c81b-4513-9a99-f2843cdd66a1',
              createdAt: '2026-10-14T00:00:00Z',
              updatedAt: '2026-10-14T00:00:00Z',
              labels: ['Task'],
              properties: {
                name: 'Search capability',
                type: 'FEATURE',
                status: 'ACTIVE',
              },
            },
            path: { depth: 1 },
            pathCount: 3,
          },
        ],
        relationships: [],
        totalElements: 1,
        totalPages: 1,
        page: 0,
        size: 20,
      };
      graphsClient.searchGraph.mockResolvedValue(graph);
      embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
        success: true,
        data: [],
        results: 0,
      });
      const request: UnifiedSearchRequest = {
        intent,
        query: intent === 'hybrid' ? 'Search' : undefined,
        graph: {
          seedEntityIds: [entityId],
          includeRelationships: true,
          trackPathCount: true,
        },
      };
      const rich = await service.search(
        organizationId,
        projectId,
        request,
        userToken,
      );
      const compact = await service.search(
        organizationId,
        projectId,
        request,
        userToken,
        SearchProjection.CompactRanked,
      );
      expect(compact.results).toEqual(
        rich.results?.map((item) => ({
          ...item,
          graph: item.graph
            ? { ...item.graph, path: undefined, pathCount: undefined }
            : undefined,
        })),
      );
      expect(compact.graph?.results?.[0]?.node).toEqual(
        rich.graph?.results?.[0]?.node,
      );
      expect(compact.graph?.results?.[0]?.path).toBeUndefined();
      expect(compact.graph?.relationships).toBeUndefined();
      expect(rich.graph?.results?.[0]?.path).toEqual({ depth: 1 });
      expect(
        graphsClient.searchGraph.mock.calls[0]?.[2]?.projection,
      ).toBeUndefined();
      expect(graphsClient.searchGraph.mock.calls[1]?.[2]?.projection).toBe(
        SearchProjection.CompactRanked,
      );
    },
  );

  const searchWithSpans = async (text: string, matchSpans: unknown) => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue(
      JSON.parse(
        JSON.stringify({
          success: true,
          results: 1,
          data: [
            {
              id: 'task-1_chunk_0',
              text,
              matchSpans,
              similarity: 0.8,
              metadata: { id: 'task-1', type: 'task' },
            },
          ],
        }),
      ),
    );
    taskService.findManyByIds.mockResolvedValue(new Map());
    const result = await service.search(
      organizationId,
      projectId,
      { intent: 'semantic', query: 'passage' },
      userToken,
    );
    const hit = result.results?.find((item) => item.entityId === 'task-1');
    expect(hit).toBeDefined();
    return hit!.embeddings!;
  };

  const matchedWords = (paragraphs: UnifiedMatchParagraph[] | undefined) =>
    paragraphs?.map((paragraph) =>
      paragraph.matchSpans.map((span) =>
        paragraph.text.slice(span.start, span.end),
      ),
    );

  it('returns the matching paragraphs with paragraph-relative spans instead of the whole text', async () => {
    const text = 'Intro alpha.\n\nMiddle 😀 beta.\n\nOutro gamma.';
    const embeddings = await searchWithSpans(text, [
      { start: 6, end: 11, strength: 0.7 },
      { start: text.indexOf('😀'), end: text.indexOf('😀') + 2, strength: 0.9 },
    ]);

    expect(embeddings).not.toHaveProperty('text');
    expect(embeddings).not.toHaveProperty('matchSpans');
    expect(embeddings.matchParagraphs?.map((p) => p.text)).toEqual([
      'Intro alpha.',
      'Middle 😀 beta.',
    ]);
    expect(matchedWords(embeddings.matchParagraphs)).toEqual([
      ['alpha'],
      ['😀'],
    ]);
  });

  it('keeps the 3 paragraphs with the strongest spans, in document order', async () => {
    const paragraphs = ['p0 hit', 'p1 hit', 'p2 hit', 'p3 hit', 'p4 hit'];
    const text = paragraphs.join('\n\n');
    const strengths = [0.2, 0.9, 0.5, 0.95, 0.8];
    const embeddings = await searchWithSpans(
      text,
      strengths.map((strength, index) => {
        const start = text.indexOf(paragraphs[index]!) + 3;
        return { start, end: start + 3, strength };
      }),
    );

    expect(embeddings.matchParagraphs?.map((p) => p.text)).toEqual([
      'p1 hit',
      'p3 hit',
      'p4 hit',
    ]);
  });

  it('joins a standalone heading to its paragraph and clips spans that cross paragraphs', async () => {
    const text =
      '# Heading\n\nBody one ends.\n\nNext starts here.\n\nUnrelated.';
    const start = text.indexOf('ends');
    const end = text.indexOf('starts') + 'starts'.length;
    const embeddings = await searchWithSpans(text, [
      { start, end, strength: 0.6 },
    ]);

    expect(embeddings.matchParagraphs).toEqual([
      {
        text: '# Heading\n\nBody one ends.',
        matchSpans: [{ start: 20, end: 25, strength: 0.6 }],
      },
      {
        text: 'Next starts here.',
        matchSpans: [{ start: 0, end: 11, strength: 0.6 }],
      },
    ]);
    expect(matchedWords(embeddings.matchParagraphs)).toEqual([
      ['ends.'],
      ['Next starts'],
    ]);
  });

  it.each([
    ['no spans', undefined],
    ['non-numeric offsets', [{ start: 'bad', end: 4, strength: 0.8 }]],
    ['negative start', [{ start: -1, end: 4, strength: 0.8 }]],
    ['fractional offsets', [{ start: 0.5, end: 4, strength: 0.8 }]],
    ['reversed offsets', [{ start: 4, end: 2, strength: 0.8 }]],
    ['out-of-range end', [{ start: 0, end: 999, strength: 0.8 }]],
    ['strength above 1', [{ start: 0, end: 4, strength: 1.5 }]],
    ['strength below -1', [{ start: 0, end: 4, strength: -2 }]],
  ])('returns no paragraphs for %s', async (_label, matchSpans) => {
    const embeddings = await searchWithSpans('some passage text', matchSpans);

    expect(embeddings).not.toHaveProperty('matchParagraphs');
    expect(embeddings).not.toHaveProperty('text');
  });

  describe('long paragraphs', () => {
    const cap = MAX_MATCH_PARAGRAPH_LENGTH;
    const filler = (length: number, seed: string) =>
      seed.repeat(Math.ceil(length / seed.length)).slice(0, length);
    const longText = (before: number, word: string, after: number) =>
      `${filler(before, 'lorem ipsum ')}${word}${filler(after, ' dolor sit')}`;

    it.each([
      ['beginning', 0],
      ['middle', 2_500],
      ['end', 5_000],
    ])(
      'bounds a 6,000-character paragraph to a window containing a match at the %s',
      async (_label, position) => {
        const text = longText(position, 'NEEDLE', 5_994 - position);
        const embeddings = await searchWithSpans(text, [
          { start: position, end: position + 6, strength: 0.9 },
        ]);

        const [paragraph] = embeddings.matchParagraphs!;
        expect(paragraph!.text.length).toBe(cap);
        expect(text).toContain(paragraph!.text);
        expect(matchedWords(embeddings.matchParagraphs)).toEqual([['NEEDLE']]);
        expect(paragraph!.matchSpans).toEqual([
          expect.objectContaining({ strength: 0.9 }),
        ]);
      },
    );

    it('centers on the strongest span, breaking ties by earliest position, and clips the weaker span', async () => {
      const text = longText(1_000, 'FIRST', 1_000) + 'SECOND' + filler(50, 'x');
      const first = 1_000;
      const second = text.indexOf('SECOND');
      const embeddings = await searchWithSpans(text, [
        { start: second, end: second + 6, strength: 0.8 },
        { start: first, end: first + 5, strength: 0.8 },
      ]);

      expect(matchedWords(embeddings.matchParagraphs)).toEqual([['FIRST']]);
    });

    it('keeps every span inside the window and rebases them', async () => {
      const text = longText(1_000, 'ALPHA', 40) + 'BETA' + filler(1_000, 'y ');
      const alpha = 1_000;
      const beta = text.indexOf('BETA');
      const far = text.length - 10;
      const embeddings = await searchWithSpans(text, [
        { start: alpha, end: alpha + 5, strength: 0.9 },
        { start: beta, end: beta + 4, strength: 0.5 },
        { start: far, end: far + 5, strength: 0.4 },
      ]);

      expect(matchedWords(embeddings.matchParagraphs)).toEqual([
        ['ALPHA', 'BETA'],
      ]);
    });

    it('clips a strongest span longer than the cap to the window', async () => {
      const text = filler(2_000, 'wide ');
      const embeddings = await searchWithSpans(text, [
        { start: 100, end: 1_900, strength: 0.9 },
      ]);

      const [paragraph] = embeddings.matchParagraphs!;
      expect(paragraph!.text).toBe(text.slice(100, 100 + cap));
      expect(paragraph!.matchSpans).toEqual([
        { start: 0, end: cap, strength: 0.9 },
      ]);
    });

    it.each([1_000, 1_002])(
      'never splits an emoji at the window boundaries (match at %i)',
      async (position) => {
        const text = '😀'.repeat(1_000);
        const embeddings = await searchWithSpans(text, [
          { start: position, end: position + 2, strength: 0.9 },
        ]);

        const [paragraph] = embeddings.matchParagraphs!;
        expect(paragraph!.text.length).toBeLessThanOrEqual(cap);
        expect(paragraph!.text).toMatch(/^(?:😀)+$/u);
        expect(text).toContain(paragraph!.text);
        expect(matchedWords(embeddings.matchParagraphs)).toEqual([['😀']]);
      },
    );

    it('leaves a paragraph at the cap intact', async () => {
      const text = filler(cap, 'abc ');
      const embeddings = await searchWithSpans(text, [
        { start: 10, end: 14, strength: 0.5 },
      ]);

      expect(embeddings.matchParagraphs?.[0]?.text).toBe(text);
    });
  });

  it('routes semantic intent to embeddings search', async () => {
    const infoLog = jest.spyOn((service as any).logger, 'log');
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'context',
      results: 1,
      data: [],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'context',
      requestId: 'request-1',
      common: {
        types: [ApiEntityType.Initiative, ApiEntityType.Artifact],
        statuses: ['active'],
        dateRange: {
          from: '2024-01-01T00:00:00Z',
          to: '2024-02-01T00:00:00Z',
        },
        updatedAtRange: {
          from: '2024-03-01T00:00:00Z',
          to: '2024-04-01T00:00:00Z',
        },
      },
      boosts: {
        entityTypes: [
          { type: ApiEntityType.Initiative, weight: 1.1 },
          { type: ApiEntityType.Artifact, weight: 1.2 },
        ],
      },
      embeddings: {
        maxResults: 5,
        similarityThreshold: 0.2,
        queryMode: 'title_fuzzy',
        filters: {
          type: 'task',
          status: 'COMPLETED',
          statuses: ['PARKED'],
          created_after: '2023-01-01T00:00:00Z',
        },
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(
      embeddingsClient.searchEmbeddingsWithUserTokenPost,
    ).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        query: 'context',
        max_results: 5,
        similarity_threshold: 0.2,
        query_mode: 'title_fuzzy',
        filters: expect.objectContaining({
          types: ['initiative'],
          created_after: '2024-01-01T00:00:00Z',
          created_before: '2024-02-01T00:00:00Z',
          updated_after: '2024-03-01T00:00:00Z',
          updated_before: '2024-04-01T00:00:00Z',
          statuses: ['ACTIVE'],
          status: undefined,
          type: undefined,
        }),
        boosts: {
          entityTypes: [
            expect.objectContaining({
              type: 'initiative',
              weight: expect.closeTo(0.1, 6),
            }),
          ],
        },
      }),
      userToken,
    );
    expect(result.embeddings).toBeDefined();
    expect(result.graph).toBeUndefined();
    expect(result.results).toBeDefined();
    expect(infoLog).toHaveBeenCalledWith('Unified search started', {
      organizationId,
      projectId,
      requestId: 'request-1',
      intent: 'semantic',
      hasQuery: true,
      graphSeedEntityCount: 0,
      graphSeedNodeCount: 0,
    });
    expect(infoLog).toHaveBeenCalledWith(
      'Unified search completed',
      expect.objectContaining({
        organizationId,
        projectId,
        requestId: 'request-1',
        intent: 'semantic',
        graphResultCount: 0,
        embeddingsResultCount: 0,
        unifiedResultCount: 0,
        embeddingsMs: expect.any(Number),
        totalMs: expect.any(Number),
      }),
    );
  });

  it('forwards exact query mode without a similarity cutoff and skips graph', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'buildTurnInputs',
      results: 0,
      data: [],
    } as any);

    const result = await service.search(
      organizationId,
      projectId,
      {
        intent: 'semantic',
        query: 'buildTurnInputs',
        embeddings: { queryMode: 'exact', similarityThreshold: 0 },
      },
      userToken,
    );

    expect(
      embeddingsClient.searchEmbeddingsWithUserTokenPost,
    ).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        query: 'buildTurnInputs',
        query_mode: 'exact',
        similarity_threshold: 0,
      }),
      userToken,
    );
    expect(result.graph).toBeUndefined();
  });

  it('keeps the embeddings order of exact hits, so title matches stay first', async () => {
    const hit = (id: string, similarity: number) => ({
      id,
      text: 'needle',
      similarity,
      matchSpans: [{ start: 0, end: 6, strength: 1 }],
      metadata: { id, type: 'task', name: id },
    });
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'needle',
      results: 2,
      data: [hit('title-hit', 12), hit('body-hit', 11)],
    } as any);

    const result = await service.search(
      organizationId,
      projectId,
      {
        intent: 'semantic',
        query: 'needle',
        embeddings: { queryMode: 'exact', similarityThreshold: 0 },
      },
      userToken,
    );

    expect(result.results?.map((item) => item.entityId)).toEqual([
      'title-hit',
      'body-hit',
    ]);
    expect(result.results?.[0]?.embeddings?.matchParagraphs).toEqual([
      { text: 'needle', matchSpans: [{ start: 0, end: 6, strength: 1 }] },
    ]);
  });

  it('routes hybrid intent to both services', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'hybrid',
      results: 1,
      data: [
        {
          id: 'vec-1',
          text: 'match',
          similarity: 0.9,
          metadata: { id: 'entity-1', type: 'task' },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      query: 'hybrid',
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(graphsClient.searchGraph).toHaveBeenCalled();
    expect(
      embeddingsClient.searchEmbeddingsWithUserTokenPost,
    ).toHaveBeenCalled();
    expect(result.graph).toBeDefined();
    expect(result.embeddings).toBeDefined();
    expect(result.results).toBeDefined();
  });

  it('routes title_fuzzy FEATURE task hybrid search through embeddings subtype filters', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'open wid',
      results: 1,
      data: [
        {
          id: 'vec-feature-1',
          text: 'Open Widget Deletion to Everyone',
          similarity: 0.92,
          metadata: {
            id: 'feature-task-1',
            organizationId,
            projectId,
            type: 'task',
            taskType: 'FEATURE',
            name: 'Open Widget Deletion to Everyone',
            status: 'ACTIVE',
          },
          matchType: 'hybrid',
        },
      ],
    } as any);
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'standard-task-1',
          entityType: 'TASK',
          score: 2,
          node: {
            id: 'node-standard-task-1',
            properties: { name: 'Standard task graph-only result' },
          },
        },
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      query: 'open wid',
      common: {
        types: [ApiEntityType.Task],
        taskTypes: [WORK_ITEM_TYPE_KEYS.Feature],
      },
      embeddings: {
        maxResults: 20,
        queryMode: 'title_fuzzy',
        hybridResultStrategy: 'embeddingsRequired',
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(
      embeddingsClient.searchEmbeddingsWithUserTokenPost,
    ).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        query: 'open wid',
        max_results: 20,
        query_mode: 'title_fuzzy',
        filters: expect.objectContaining({
          types: ['task'],
          taskTypes: [WORK_ITEM_TYPE_KEYS.Feature],
        }),
      }),
      userToken,
    );
    expect(graphsClient.searchGraph).toHaveBeenCalled();
    expect(result.results).toEqual([
      expect.objectContaining({
        entityId: 'feature-task-1',
        entityType: ApiEntityType.Task,
        title: 'Open Widget Deletion to Everyone',
        embeddings: expect.objectContaining({
          metadata: expect.objectContaining({
            taskType: WORK_ITEM_TYPE_KEYS.Feature,
          }),
        }),
      }),
    ]);
  });

  it('rejects relationship intent without graph seeds', async () => {
    const request: UnifiedSearchRequest = {
      intent: 'relationship',
    };

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow(
      'graph.seedEntityIds or graph.seedNodeIds is required for relationship search',
    );
  });

  it('expands graph.seedEntityIds from conversation relationships', async () => {
    (prismaService.conversation.findFirst as jest.Mock).mockResolvedValueOnce({
      workflowAboutType: 'task',
      workflowAboutId: 'task-1',
    });
    entityRelationshipResolverService.resolveForWorkflowAbout.mockResolvedValueOnce(
      {
        resolvedContext: {
          taskId: 'task-1' as any,
          initiativeId: 'init-1' as any,
          planId: 'plan-1' as any,
        },
        additionalHeaders: {},
      },
    );
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      conversationId: 'conv-1',
      graph: {
        seedEntityIdsStrategy: 'conversationRelated',
      },
    };

    await service.search(organizationId, projectId, request, userToken);

    expect(graphsClient.searchGraph).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        seedEntityIds: expect.arrayContaining(['task-1', 'init-1', 'plan-1']),
      }),
      userToken,
    );
  });

  it('requires conversationId when expanding graph.seedEntityIds from conversation', async () => {
    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      graph: {
        seedEntityIdsStrategy: 'conversationRelated',
      },
    };

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow(
      'conversationId is required when graph.seedEntityIdsStrategy is conversationRelated',
    );
  });

  it('rejects explicit graph seeds when strategy is conversationRelated', async () => {
    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      conversationId: 'conv-1',
      graph: {
        seedEntityIdsStrategy: 'conversationRelated',
        seedEntityIds: ['task-1'],
      },
    };

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow(
      'graph.seedEntityIds and graph.seedNodeIds are not allowed when graph.seedEntityIdsStrategy is conversationRelated',
    );
  });

  it('rejects embeddings filters with mismatched organizationId', async () => {
    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'test',
      embeddings: {
        filters: { organizationId: 'other-org' },
      },
    };

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow(
      'filters.organizationId must match the path organizationId',
    );
  });

  it('maps 429 from upstream to HttpException', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockRejectedValue({
      response: { status: 429 },
    });

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'test',
    };

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it.each(['embeddings', 'graph'] as const)(
    'reports a 422 from %s as a request error and logs the response body',
    async (upstream) => {
      const detail = { detail: [{ msg: 'unsupported filter' }] };
      const rejection = { response: { status: 422, data: detail } };
      embeddingsClient.searchEmbeddingsWithUserTokenPost.mockRejectedValue(
        rejection,
      );
      graphsClient.searchGraph.mockRejectedValue(rejection);
      const errorLog = jest.spyOn(
        (service as unknown as { logger: { error: jest.Mock } }).logger,
        'error',
      );

      await expect(
        service.search(
          organizationId,
          projectId,
          { intent: 'semantic', query: 'test' },
          userToken,
        ),
      ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      if (upstream === 'graph') {
        await expect(
          service.search(
            organizationId,
            projectId,
            {
              intent: 'relationship',
              query: 'test',
              graph: { seedEntityIds: ['e1'] },
            },
            userToken,
          ),
        ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
      }
      expect(errorLog).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ responseStatus: 422, responseData: detail }),
      );
    },
  );

  it('fuses graph and embeddings results by entity id', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'entity-1',
          entityType: 'TASK',
          score: 2,
          node: { id: 'node-1' },
        },
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'hybrid',
      results: 1,
      data: [
        {
          id: 'vec-1',
          text: 'match',
          similarity: 0.8,
          metadata: { id: 'entity-1', type: 'task' },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      query: 'hybrid',
      graph: {
        seedEntityIds: ['entity-1'],
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]).toMatchObject({
      entityId: 'entity-1',
      entityType: 'TASK',
      graphScore: 2,
      semanticScore: 0.8,
    });
    expect(result.results?.[0]?.score ?? 0).toBeCloseTo(1, 6);
  });

  it('applies planLineage score deltas to unified results', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'priority',
      results: 2,
      data: [
        {
          id: 'vec-1',
          text: 'Task 1',
          similarity: 0.9,
          metadata: { id: 'task-1', type: 'task', status: 'ACTIVE' },
        },
        {
          id: 'vec-2',
          text: 'Task 2',
          similarity: 0.8,
          metadata: { id: 'task-2', type: 'task', status: 'ACTIVE' },
        },
      ],
    } as any);
    planLineageBoostService.resolveBoostDeltas.mockResolvedValueOnce(
      new Map([['task-2', 0.15]]),
    );

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'priority',
      boosts: {
        planLineage: {
          mode: UnifiedSearchPlanLineageMode.WorkItemDependencies,
          planId: 'plan-1',
          taskId: 'task-1',
        },
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(planLineageBoostService.resolveBoostDeltas).toHaveBeenCalledWith({
      organizationId,
      projectId,
      planLineage: request.boosts?.planLineage,
    });
    expect(result.results?.[0]?.entityId).toBe('task-2');
  });

  it('excludes artifact entities from unified graph and embeddings results', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'artifact-1',
          entityType: 'ARTIFACT',
          score: 1.9,
          node: { id: 'node-a' },
        },
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 1.7,
          node: { id: 'node-t' },
        },
      ],
      totalElements: 2,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'hybrid',
      results: 2,
      data: [
        {
          id: 'vec-a',
          text: 'artifact match',
          similarity: 0.95,
          metadata: { id: 'artifact-1', type: 'artifact' },
        },
        {
          id: 'vec-t',
          text: 'task match',
          similarity: 0.9,
          metadata: { id: 'task-1', type: 'task' },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      query: 'hybrid',
      graph: {
        seedEntityIds: ['task-1'],
      },
      common: {
        types: [ApiEntityType.Task, ApiEntityType.Artifact],
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.graph?.results?.map((item) => item.entityId)).toEqual([
      'task-1',
    ]);
    expect(result.embeddings?.data?.map((item) => item.id)).toEqual(['vec-t']);
    expect(result.results?.map((item) => item.entityId)).toEqual(['task-1']);
  });

  it('returns no unified results when only artifact is requested as entity type', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 1.7,
          node: { id: 'node-t' },
        },
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      common: {
        types: [ApiEntityType.Artifact],
      },
      graph: {
        seedEntityIds: ['task-1'],
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results).toEqual([]);
  });

  it('requires query when embeddings.hybridResultStrategy is embeddingsRequired', async () => {
    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      graph: {
        seedEntityIds: ['task-1'],
      },
      embeddings: {
        hybridResultStrategy: 'embeddingsRequired',
      },
    };

    await expect(
      service.search(organizationId, projectId, request, userToken),
    ).rejects.toThrow(
      'query is required when embeddings.hybridResultStrategy is embeddingsRequired',
    );
  });

  it('filters graph-only hybrid results by default when query is provided', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 2,
          node: { id: 'node-1', properties: { name: 'Graph Task 1' } },
        },
        {
          entityId: 'task-2',
          entityType: 'TASK',
          score: 1.2,
          node: { id: 'node-2', properties: { name: 'Graph Task 2' } },
        },
      ],
      totalElements: 2,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'hybrid',
      results: 1,
      data: [
        {
          id: 'vec-1',
          text: 'match',
          similarity: 0.8,
          metadata: { id: 'task-1', type: 'task' },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      query: 'hybrid',
      graph: {
        seedEntityIds: ['task-1'],
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]?.entityId).toBe('task-1');
    expect(result.results?.[0]?.sources).toEqual(
      expect.arrayContaining(['graph', 'embeddings']),
    );
  });

  it('keeps graph-only hybrid results when excludeContentless is false', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 2,
          node: { id: 'node-1', properties: { name: 'Graph Task 1' } },
        },
        {
          entityId: 'task-2',
          entityType: 'TASK',
          score: 1.2,
          node: { id: 'node-2', properties: { name: 'Graph Task 2' } },
        },
      ],
      totalElements: 2,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'hybrid',
      results: 1,
      data: [
        {
          id: 'vec-1',
          text: 'match',
          similarity: 0.8,
          metadata: { id: 'task-1', type: 'task' },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'hybrid',
      query: 'hybrid',
      excludeContentless: false,
      graph: {
        seedEntityIds: ['task-1'],
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results).toHaveLength(2);
    expect(result.results?.map((item) => item.entityId)).toEqual(
      expect.arrayContaining(['task-1', 'task-2']),
    );
  });

  it('hydrates content for graph-only task results', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 2,
          node: { id: 'node-1', properties: { name: 'Graph Task' } },
        },
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);
    taskService.findManyByIds.mockResolvedValue(
      new Map([
        [
          'task-1',
          {
            sections: [
              {
                id: 'section-1',
                key: 'description',
                order: 0,
                materializedMarkdown: 'Task description',
              },
            ],
          },
        ],
      ]) as any,
    );

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      graph: { seedEntityIds: ['task-1'] },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(taskService.findManyByIds).toHaveBeenCalledWith(
      organizationId,
      ['task-1'],
      ['description', 'details', 'acceptanceCriteria', 'requirements'],
    );
    expect(result.results?.[0]?.content).toBe('Task description');
    expect(result.results?.[0]?.title).toBe('Graph Task');
  });

  describe('content from embeddings hits', () => {
    const opening = 'Opening paragraph. '.repeat(20);
    const unmatchedTail = 'UNMATCHED-TAIL-SENTINEL';
    const longText = `${opening}\n\n${'Filler. '.repeat(200)}${unmatchedTail}`;

    beforeEach(() => {
      embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
        success: true,
        query: 'semantic',
        results: 1,
        data: [
          {
            id: 'vec-1',
            text: longText,
            similarity: 0.8,
            metadata: { id: 'entity-1', type: 'task' },
          },
        ],
      } as any);
    });

    function expectOpeningSnippetOnly(content: string | undefined): void {
      expect(content?.startsWith(longText.slice(0, 200))).toBe(true);
      expect(content?.length).toBeLessThanOrEqual(300);
      expect(content).not.toContain(unmatchedTail);
    }

    it('returns only an opening snippet in single search', async () => {
      const result = await service.search(
        organizationId,
        projectId,
        { intent: 'semantic', query: 'semantic' },
        userToken,
      );

      expectOpeningSnippetOnly(result.results?.[0]?.content);
      expect(JSON.stringify(result)).not.toContain(unmatchedTail);
    });

    it('returns only an opening snippet in batch search', async () => {
      const result = await service.batchSearch(
        organizationId,
        projectId,
        { queries: [{ intent: 'semantic', query: 'semantic' }] },
        userToken,
      );

      expectOpeningSnippetOnly(result.results?.[0]?.content);
      expect(JSON.stringify(result)).not.toContain(unmatchedTail);
    });
  });

  it('uses embeddings name as title and strips metadata title', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'semantic',
      results: 1,
      data: [
        {
          id: 'vec-1',
          text: 'Embeddings content',
          similarity: 0.8,
          metadata: {
            id: 'entity-1',
            type: 'task',
            name: 'Embeddings Name',
            title: 'Embeddings Title',
          },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'semantic',
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results?.[0]?.title).toBe('Embeddings Name');
    expect(
      (result.embeddings?.data?.[0]?.metadata as { title?: string } | undefined)
        ?.title,
    ).toBeUndefined();
  });

  it('derives titles for message hits and leaves other titles unchanged', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'semantic',
      results: 3,
      data: [
        {
          id: 'vec-1',
          text: 'ASSISTANT:  Shipped the\n search fix',
          similarity: 0.9,
          metadata: { id: 'message-1', type: 'message' },
        },
        {
          id: 'vec-2',
          text: 'ASSISTANT:   ',
          similarity: 0.8,
          metadata: { id: 'message-2', type: 'message' },
        },
        {
          id: 'vec-3',
          text: 'ASSISTANT: task body',
          similarity: 0.7,
          metadata: { id: 'task-1', type: 'task', name: 'Task Name' },
        },
      ],
    } as any);

    const result = await service.search(
      organizationId,
      projectId,
      { intent: 'semantic', query: 'semantic' },
      userToken,
    );

    const titles = new Map(
      result.results?.map((item) => [item.entityId, item.title]),
    );
    expect(titles.get('message-1')).toBe('Shipped the search fix');
    expect(titles.get('message-2') ?? '').toBe('');
    expect(titles.get('task-1')).toBe('Task Name');
  });

  it('uses embeddings topology summary when present', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'semantic',
      results: 1,
      data: [
        {
          id: 'vec-1',
          text: 'Embeddings content',
          similarity: 0.8,
          metadata: {
            id: 'entity-1',
            type: 'task',
            topologySummary: 'Embeddings topology summary',
          },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'semantic',
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results?.[0]?.topologySummary).toBe(
      'Embeddings topology summary',
    );
    expect(
      entitySummaryService.getCurrentSummariesForEntities,
    ).not.toHaveBeenCalled();
  });

  it('collects unique embeddings subfacet matches without adding subfacet-only results', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'subfacet-query',
      results: 2,
      data: [
        {
          id: 'vec-1',
          text: 'Task result',
          similarity: 0.8,
          metadata: {
            id: 'task-1',
            type: 'task',
            topologySubfacets: ['API', 'Runtime'],
          },
        },
        {
          id: 'vec-2',
          text: 'Subfacet-only result',
          similarity: 0.75,
          metadata: {
            id: 'subfacet-1',
            type: 'subfacet',
            subfacets: ['Runtime', 'Security'],
          },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'subfacet-query',
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.subfacets).toEqual(['API', 'Runtime', 'Security']);
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]?.entityId).toBe('task-1');
  });

  it('hydrates topology summary from the database when missing', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 2,
          node: { id: 'node-1' },
        },
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);
    entitySummaryService.getCurrentSummariesForEntities.mockResolvedValue([
      {
        entityId: 'task-1',
        entityType: 'TASK',
        summary: 'Database topology summary',
        updatedAt: new Date('2024-01-01T00:00:00Z'),
      },
    ] as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      graph: { seedEntityIds: ['task-1'] },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results?.[0]?.topologySummary).toBe(
      'Database topology summary',
    );
  });

  it('downranks refining work items and exposes status', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'priority',
      results: 2,
      data: [
        {
          id: 'emb-1',
          similarity: 0.9,
          text: 'Refining task',
          metadata: {
            id: 'task-1',
            type: 'task',
            status: 'REFINING_DESCRIPTION',
            name: 'Task 1',
          },
        },
        {
          id: 'emb-2',
          similarity: 0.6,
          text: 'Active task',
          metadata: {
            id: 'task-2',
            type: 'task',
            status: 'ACTIVE',
            name: 'Task 2',
          },
        },
      ],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'priority',
      downrankUnreviewed: true,
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results?.[0]?.entityId).toBe('task-2');
    expect(result.results?.[0]?.status).toBe('ACTIVE');
    expect(result.results?.[1]?.entityId).toBe('task-1');
    expect(result.results?.[1]?.status).toBe('REFINING_DESCRIPTION');
  });

  it('filters unified results by common statuses and excludes entity types without canonical status', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: 'TASK',
          score: 2,
          node: { id: 'node-1', properties: { status: 'ACTIVE' } },
        },
        {
          entityId: 'project-1',
          entityType: 'PROJECT',
          score: 1.8,
          node: { id: 'node-2', properties: { status: 'ACTIVE' } },
        },
      ],
      totalElements: 2,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      common: {
        statuses: ['active'],
      },
      graph: {
        seedEntityIds: ['task-1'],
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]?.entityId).toBe('task-1');
  });

  it('returns applied filter diagnostics in debug mode', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      debug: true,
      common: {
        types: [ApiEntityType.Task],
        statuses: ['active'],
      },
      graph: {
        seedEntityIds: ['task-1'],
      },
    };

    const result = await service.search(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.execution.diagnostics?.filters?.common).toEqual(
      expect.objectContaining({
        statuses: ['active'],
      }),
    );
    expect(result.execution.diagnostics?.filters?.graph).toEqual(
      expect.objectContaining({
        statuses: ['ACTIVE'],
      }),
    );
    expect(result.execution.diagnostics?.statusSemantics).toEqual(
      expect.objectContaining({
        requestedStatuses: ['ACTIVE'],
        entitiesWithoutStatusBehavior: 'exclude',
      }),
    );
  });

  it('dedupes identical graph searches across batch queries', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: GraphEntityType.Task,
          score: 1.5,
          node: { id: 'node-1' },
        },
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedBatchSearchRequest = {
      queries: [
        {
          intent: 'relationship',
          graph: { seedEntityIds: ['task-1'] },
        },
        {
          intent: 'relationship',
          graph: { seedEntityIds: ['task-1'] },
        },
      ],
      globalOptions: {
        graph: { filters: { entityTypes: [ApiEntityType.Task] } },
      },
    };

    const result = await service.batchSearch(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(graphsClient.searchGraph).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    expect(result.queryCount).toBe(2);
  });

  it('uses global planLineage boosts only when query boosts are absent in batch', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [
        {
          entityId: 'task-1',
          entityType: GraphEntityType.Task,
          score: 1.5,
          node: { id: 'node-1' },
        },
      ],
      totalElements: 1,
      totalPages: 1,
      page: 0,
      size: 20,
    } as any);
    planLineageBoostService.resolveBoostDeltas.mockResolvedValue(
      new Map([['task-1', 0.1]]),
    );

    const request: UnifiedBatchSearchRequest = {
      queries: [
        {
          intent: 'relationship',
          graph: { seedEntityIds: ['task-1'] },
        },
        {
          intent: 'relationship',
          graph: { seedEntityIds: ['task-1'] },
          boosts: {
            entityTypes: [{ type: ApiEntityType.Task, weight: 1.05 }],
          },
        },
      ],
      globalOptions: {
        boosts: {
          planLineage: {
            mode: UnifiedSearchPlanLineageMode.WorkItemDependencies,
            planId: 'plan-1',
            taskId: 'task-1',
          },
        },
      },
    };

    await service.batchSearch(organizationId, projectId, request, userToken);

    expect(planLineageBoostService.resolveBoostDeltas).toHaveBeenCalledTimes(1);
    expect(planLineageBoostService.resolveBoostDeltas).toHaveBeenCalledWith({
      organizationId,
      projectId,
      planLineage: {
        mode: UnifiedSearchPlanLineageMode.WorkItemDependencies,
        planId: 'plan-1',
        taskId: 'task-1',
      },
    });
  });

  it('preserves planLineage boosts through batch normalization', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'Exact API error handling doc',
      results: 2,
      data: [
        {
          id: 'vec-1',
          text: 'Exact API error handling doc',
          similarity: 0.9,
          metadata: {
            id: 'doc-other-plan',
            type: 'design_doc',
            status: 'ACTIVE',
          },
        },
        {
          id: 'vec-2',
          text: 'Exact API error handling doc',
          similarity: 0.82,
          metadata: {
            id: 'doc-target-plan',
            type: 'design_doc',
            status: 'ACTIVE',
          },
        },
      ],
    } as any);
    planLineageBoostService.resolveBoostDeltas.mockResolvedValue(
      new Map([['doc-target-plan', 0.15]]),
    );

    const request: UnifiedBatchSearchRequest = {
      queries: [
        {
          intent: 'semantic',
          query: 'Exact API error handling doc',
          boosts: {
            planLineage: {
              mode: UnifiedSearchPlanLineageMode.WorkItemDependencies,
              planId: 'plan-1',
              designDocId: 'doc-target-plan',
            },
          },
        },
      ],
    };

    const result = await service.batchSearch(
      organizationId,
      projectId,
      request,
      userToken,
    );

    expect(result.results[0]?.entityId).toBe('doc-target-plan');
  });

  it('logs per-query and final combined batch responses with shared requestId correlation', async () => {
    const infoLog = jest.spyOn((service as any).logger, 'log');
    const previousFlag = process.env.UNIFIED_SEARCH_LOGS_ENABLED;
    try {
      process.env.UNIFIED_SEARCH_LOGS_ENABLED = 'true';
      graphsClient.searchGraph.mockResolvedValue({
        results: [],
        totalElements: 0,
        totalPages: 0,
        page: 0,
        size: 20,
      } as any);
      (prismaService.db.unifiedSearchLog.create as jest.Mock).mockResolvedValue(
        {},
      );

      const request: UnifiedBatchSearchRequest = {
        queries: [
          {
            intent: 'relationship',
            graph: { seedEntityIds: ['task-1'] },
          },
          {
            intent: 'relationship',
            graph: { seedEntityIds: ['task-2'] },
          },
        ],
      };

      await service.batchSearch(organizationId, projectId, request, userToken);
      await Promise.resolve();
      await Promise.resolve();

      const createCalls = (
        prismaService.db.unifiedSearchLog.create as jest.Mock
      ).mock.calls;
      expect(createCalls).toHaveLength(3);

      const logEntries = createCalls.map(([call]) => call.data);
      const correlationIds = new Set(
        logEntries.map((entry) => entry.requestId),
      );
      expect(correlationIds.size).toBe(1);

      const [correlationId] = [...correlationIds];
      expect(correlationId).toEqual(expect.stringMatching(/^batch_/));

      const finalBatchLog = logEntries.find(
        (entry) => entry.intent === 'batch',
      );
      expect(finalBatchLog).toEqual(
        expect.objectContaining({
          requestId: correlationId,
          query: null,
        }),
      );
      expect(finalBatchLog.unifiedResponse).toEqual(
        expect.objectContaining({
          queryCount: 2,
          logStage: 'batch_final',
        }),
      );
      expect(infoLog).toHaveBeenCalledWith(
        'Unified batch search started',
        expect.objectContaining({
          organizationId,
          projectId,
          requestId: correlationId,
          queryCount: 2,
        }),
      );
      expect(infoLog).toHaveBeenCalledWith(
        'Unified batch search completed',
        expect.objectContaining({
          organizationId,
          projectId,
          requestId: correlationId,
          queryCount: 2,
          returnedResultCount: 0,
          totalResultCount: 0,
          totalMs: expect.any(Number),
        }),
      );
    } finally {
      process.env.UNIFIED_SEARCH_LOGS_ENABLED = previousFlag;
    }
  });

  it('logs with null foreign keys when conversationId and messageId are blank', async () => {
    const previousFlag = process.env.UNIFIED_SEARCH_LOGS_ENABLED;
    try {
      process.env.UNIFIED_SEARCH_LOGS_ENABLED = 'true';

      const request: UnifiedSearchRequest = {
        intent: 'semantic',
        query: 'test',
        conversationId: '   ',
        messageId: '\n',
        requestId: '  req-1  ',
      };
      const response = {
        intent: 'semantic',
        query: 'test',
        organizationId,
        projectId,
        execution: { totalMs: 1 },
      } as any;

      await (service as any).logSearchResult(
        organizationId,
        projectId,
        request,
        response,
      );

      expect(prismaService.db.conversation.findFirst).not.toHaveBeenCalled();
      expect(prismaService.db.message.findFirst).not.toHaveBeenCalled();
      expect(prismaService.db.unifiedSearchLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: null,
            messageId: null,
            requestId: 'req-1',
          }),
        }),
      );
    } finally {
      process.env.UNIFIED_SEARCH_LOGS_ENABLED = previousFlag;
    }
  });

  it('logs with null conversationId when request conversationId is not found', async () => {
    const previousFlag = process.env.UNIFIED_SEARCH_LOGS_ENABLED;
    try {
      process.env.UNIFIED_SEARCH_LOGS_ENABLED = 'true';
      (prismaService.db.conversation.findFirst as jest.Mock).mockResolvedValue(
        null,
      );

      const request: UnifiedSearchRequest = {
        intent: 'semantic',
        query: 'test',
        conversationId: 'missing-conversation',
        requestId: 'req-2',
      };
      const response = {
        intent: 'semantic',
        query: 'test',
        organizationId,
        projectId,
        execution: { totalMs: 1 },
      } as any;

      await (service as any).logSearchResult(
        organizationId,
        projectId,
        request,
        response,
      );

      expect(prismaService.db.conversation.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'missing-conversation',
          organizationId,
          projectId,
        },
        select: { id: true },
      });
      expect(prismaService.db.unifiedSearchLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            conversationId: null,
          }),
        }),
      );
    } finally {
      process.env.UNIFIED_SEARCH_LOGS_ENABLED = previousFlag;
    }
  });

  it('passes CONTRACT common.taskTypes to graph search filters', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      common: {
        types: [ApiEntityType.Task],
        taskTypes: [WORK_ITEM_TYPE_KEYS.Contract],
      },
      graph: {
        seedEntityIds: ['entity-1'],
      },
    };

    await service.search(organizationId, projectId, request, userToken);

    expect(graphsClient.searchGraph).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        filters: expect.objectContaining({
          taskTypes: [WORK_ITEM_TYPE_KEYS.Contract],
        }),
      }),
      userToken,
    );
  });

  it('passes CONTRACT common.taskTypes to embeddings search filters', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'test',
      results: 0,
      data: [],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'test',
      common: {
        types: [ApiEntityType.Task],
        taskTypes: [WORK_ITEM_TYPE_KEYS.Contract],
      },
    };

    await service.search(organizationId, projectId, request, userToken);

    expect(
      embeddingsClient.searchEmbeddingsWithUserTokenPost,
    ).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        filters: expect.objectContaining({
          taskTypes: [WORK_ITEM_TYPE_KEYS.Contract],
        }),
      }),
      userToken,
    );
  });

  it('normalizes historical Diagram task filters for graph and embeddings search', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'diagram',
      results: 0,
      data: [],
    } as any);

    await service.search(
      organizationId,
      projectId,
      {
        intent: 'hybrid',
        query: 'diagram',
        common: {
          types: [ApiEntityType.Task],
          taskTypes: ['WORKFLOW', 'workflow_step'],
        },
        graph: { seedEntityIds: ['entity-1'] },
      },
      userToken,
    );

    expect(graphsClient.searchGraph).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        filters: expect.objectContaining({
          taskTypes: [
            WORK_ITEM_TYPE_KEYS.Diagram,
            WORK_ITEM_TYPE_KEYS.DiagramElement,
          ],
        }),
      }),
      userToken,
    );
    expect(
      embeddingsClient.searchEmbeddingsWithUserTokenPost,
    ).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        filters: expect.objectContaining({
          taskTypes: [
            WORK_ITEM_TYPE_KEYS.Diagram,
            WORK_ITEM_TYPE_KEYS.DiagramElement,
          ],
        }),
      }),
      userToken,
    );
  });

  it('does not include taskTypes in graph filters when omitted', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      common: {
        types: [ApiEntityType.Task],
      },
      graph: {
        seedEntityIds: ['entity-1'],
      },
    };

    await service.search(organizationId, projectId, request, userToken);

    const graphCall = graphsClient.searchGraph.mock.calls[0]!;
    const graphRequest = graphCall[2];
    expect(graphRequest.filters?.taskTypes).toBeUndefined();
  });

  it('common.taskTypes overrides graph.filters.taskTypes', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      common: {
        types: [ApiEntityType.Task],
        taskTypes: [WORK_ITEM_TYPE_KEYS.Standard],
      },
      graph: {
        seedEntityIds: ['entity-1'],
        filters: {
          taskTypes: [WORK_ITEM_TYPE_KEYS.Feature],
        },
      },
    };

    await service.search(organizationId, projectId, request, userToken);

    expect(graphsClient.searchGraph).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        filters: expect.objectContaining({
          taskTypes: [WORK_ITEM_TYPE_KEYS.Standard],
        }),
      }),
      userToken,
    );
  });

  it('treats empty taskTypes array the same as omitted', async () => {
    graphsClient.searchGraph.mockResolvedValue({
      results: [],
      totalElements: 0,
      totalPages: 0,
      page: 0,
      size: 20,
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'relationship',
      common: {
        types: [ApiEntityType.Task],
        taskTypes: [],
      },
      graph: {
        seedEntityIds: ['entity-1'],
      },
    };

    await service.search(organizationId, projectId, request, userToken);

    const graphCall = graphsClient.searchGraph.mock.calls[0]!;
    const graphRequest = graphCall[2];
    expect(graphRequest.filters?.taskTypes).toBeUndefined();
  });

  it('falls back to embeddings.filters.taskTypes when common.taskTypes is absent', async () => {
    embeddingsClient.searchEmbeddingsWithUserTokenPost.mockResolvedValue({
      success: true,
      query: 'test',
      results: 0,
      data: [],
    } as any);

    const request: UnifiedSearchRequest = {
      intent: 'semantic',
      query: 'test',
      embeddings: {
        filters: {
          taskTypes: [WORK_ITEM_TYPE_KEYS.Bug],
        },
      },
    };

    await service.search(organizationId, projectId, request, userToken);

    expect(
      embeddingsClient.searchEmbeddingsWithUserTokenPost,
    ).toHaveBeenCalledWith(
      organizationId,
      projectId,
      expect.objectContaining({
        filters: expect.objectContaining({
          taskTypes: [WORK_ITEM_TYPE_KEYS.Bug],
        }),
      }),
      userToken,
    );
  });

  describe('buildWorkItemContent', () => {
    const buildContent = (
      sections:
        | Array<{
            id: string;
            key: string;
            order: number;
            materializedMarkdown: string;
          }>
        | undefined,
      taskType?: string,
    ): string | undefined =>
      (
        service as unknown as {
          buildWorkItemContent: (
            sections?: Array<{
              id: string;
              key: string;
              order: number;
              materializedMarkdown: string;
            }>,
            taskType?: string,
          ) => string | undefined;
        }
      ).buildWorkItemContent(sections, taskType);

    it('includes the requirements section content in the search corpus for FEATURE tasks', () => {
      const featureRequirements = JSON.stringify({
        records: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            statement: 'must handle empty input',
            designedBy: [],
            fulfilledBy: [],
            contracts: [],
          },
        ],
      });
      const content = buildContent(
        [
          {
            id: 's-desc',
            key: 'description',
            order: 0,
            materializedMarkdown: 'the description',
          },
          {
            id: 's-req',
            key: 'requirements',
            order: 1,
            materializedMarkdown: featureRequirements,
          },
        ],
        WORK_ITEM_TYPE_KEYS.Feature,
      );

      expect(content).toContain('the description');
      expect(content).toContain('Statement: must handle empty input');
      expect(content).not.toContain(featureRequirements);
      expect(content).not.toContain('"records"');
    });

    it('removes an empty FEATURE requirements collection from discovery text', () => {
      const content = buildContent(
        [
          {
            id: 's-req',
            key: 'requirements',
            order: 0,
            materializedMarkdown: '{"records":[]}',
          },
        ],
        WORK_ITEM_TYPE_KEYS.Feature,
      );

      expect(content).toBeUndefined();
    });

    it('still returns description/acceptanceCriteria when requirements is absent', () => {
      const content = buildContent([
        {
          id: 's-desc',
          key: 'description',
          order: 0,
          materializedMarkdown: 'desc',
        },
        {
          id: 's-ac',
          key: 'acceptanceCriteria',
          order: 1,
          materializedMarkdown: 'ac',
        },
      ]);

      expect(content).toContain('desc');
      expect(content).toContain('ac');
    });

    it('returns only the description payload for GOAL tasks (no acceptanceCriteria or requirements)', () => {
      const content = buildContent([
        {
          id: 's-desc',
          key: 'description',
          order: 0,
          materializedMarkdown: 'reach outcome X',
        },
      ]);

      expect(content).toBe('reach outcome X');
    });
  });
});

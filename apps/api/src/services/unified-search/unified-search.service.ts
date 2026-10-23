import {
  WORK_ITEM_TYPE_KEYS,
  type WorkItemTypeKey,
} from 'src/services/tasks/work-item-type-keys';
import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AxiosError } from 'axios';
import {
  EmbeddingMetadata,
  DesignDocResponseDto,
  EntityType as ApiEntityType,
  InitiativeResponseDto,
  MaterializedDesignDocSection,
  MaterializedWorkItemSection,
  TaskResponseDto,
  UnifiedBatchGraphSearchOptions,
  UnifiedBatchSearchGlobalOptions,
  UnifiedBatchSearchRequest,
  UnifiedBatchSearchResponse,
  UnifiedEmbeddingsSearchResponse,
  UnifiedEmbeddingsSearchResult,
  UnifiedGraphSearchFilters,
  UnifiedGraphSearchResponse,
  UnifiedGraphSearchResult,
  UnifiedEmbeddingsSearchFilters,
  UnifiedSearchDiagnostics,
  UnifiedSearchPlanLineageMode,
  UnifiedSearchRequest,
  UnifiedSearchResponse,
  UnifiedSearchResult,
  WorkStatus,
} from 'src/generated';
import {
  SearchRequest as EmbeddingsSearchRequest,
  SearchResponse as EmbeddingsSearchResponse,
  SearchFilters as EmbeddingsSearchFiltersContract,
} from 'src/generated/embeddings';
import {
  SearchRequest as GraphSearchRequest,
  SearchResponse as GraphSearchResponse,
  EntityType as GraphEntityType,
  RelationshipType,
  SearchDirection,
  SearchProjection,
} from 'src/generated/graphs';
import { errorToLoggable } from 'src/utils/logging.util';
import {
  WORK_ITEM_SECTION_KEYS,
  materializedSectionsToContentMap,
} from 'src/utils/work-item-section.util';
import {
  getCurrentSectionFromStatus as getWorkItemSectionFromStatus,
  isRefining as isWorkItemRefining,
} from 'src/utils/work-item.util';
import { EmbeddingsClientService } from '../embeddings-client.service';
import { GraphsClientService } from '../graphs-client.service';
import { DesignDocService } from '../design-doc/design-doc.service';
import { InitiativeService } from '../initiatives/initiative.service';
import { TaskService } from '../tasks/task.service';
import { EntitySummaryService } from '../entity-summary/entity-summary.service';
import { EntityRelationshipResolverService } from '../relationships/entity-relationship-resolver.service';
import {
  DesignDocId,
  InitiativeId,
  OrganizationId,
  ProjectId,
  TaskId,
  WorkflowAboutType,
} from 'src/types';
import { EntityType as PrismaEntityType, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { deriveMessageTitle } from './message-title';
import { PlanLineageBoostService } from './plan-lineage-boost.service';
import {
  FeatureRequirementsReadError,
  formatFeatureRequirementsForDiscovery,
} from '../tasks/feature-requirements-reader';

type SearchExecutionTimes = {
  totalMs: number;
  graphMs?: number;
  embeddingsMs?: number;
  diagnostics?: UnifiedSearchDiagnostics;
};

type FusionWeights = {
  graph: number;
  embeddings: number;
};

type EmbeddingsOutcome = {
  response: UnifiedEmbeddingsSearchResponse;
  contentByEntityId: Map<string, string>;
  topologyByEntityId: Map<string, string>;
  titleByEntityId: Map<string, string>;
  subfacets: string[];
};

type SearchLogStage = 'single' | 'batch_query' | 'batch_final';

type SearchLogContext = {
  persistedRequestId?: string | null;
  requestPayload?: unknown;
  logStage?: SearchLogStage;
};

type GraphBoostEntityId = NonNullable<
  NonNullable<GraphSearchRequest['boosts']>['entityIds']
>[number];
type GraphBoostEntityType = NonNullable<
  NonNullable<GraphSearchRequest['boosts']>['entityTypes']
>[number];
type EmbeddingsBoostEntityType = NonNullable<
  NonNullable<EmbeddingsSearchRequest['boosts']>['entityTypes']
>[number];
const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  graph: 0.5,
  embeddings: 0.5,
};

const DEFAULT_BATCH_PAGE_SIZE = 50;
const DEFAULT_CROSS_QUERY_BOOST = 0.1;
const MAX_CROSS_QUERY_BOOST = 0.3;
const GENERATED_BATCH_REQUEST_ID_PREFIX = 'batch';
const ENTITY_TYPES_WITH_CANONICAL_STATUS: ApiEntityType[] = [
  ApiEntityType.Task,
  ApiEntityType.Initiative,
  ApiEntityType.DesignDoc,
];

@Injectable()
export class UnifiedSearchService {
  private readonly logger = new Logger(UnifiedSearchService.name);

  constructor(
    private readonly embeddingsClientService: EmbeddingsClientService,
    private readonly graphsClientService: GraphsClientService,
    private readonly taskService: TaskService,
    private readonly initiativeService: InitiativeService,
    private readonly designDocService: DesignDocService,
    private readonly entitySummaryService: EntitySummaryService,
    private readonly prisma: PrismaService,
    private readonly entityRelationshipResolverService: EntityRelationshipResolverService,
    private readonly planLineageBoostService: PlanLineageBoostService,
  ) {}

  async search(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
    userToken: string | null,
    graphProjection?: SearchProjection,
  ): Promise<UnifiedSearchResponse> {
    request = await this.expandGraphSeedEntityIdsFromConversation(
      organizationId,
      request,
    );

    if (!userToken) {
      throw new UnauthorizedException('Authentication token not found');
    }

    if (!request.intent) {
      throw new BadRequestException('intent is required');
    }
    if (!this.isSupportedIntent(request.intent)) {
      throw new BadRequestException(`Unsupported intent: ${request.intent}`);
    }
    this.validateIntentRequirements(request);
    this.validateEmbeddingsFilters(organizationId, projectId, request);
    this.validateBoosts(request);
    this.logSearchStarted(organizationId, projectId, request);
    const planLineageBoostDeltas = await this.resolvePlanLineageBoostDeltas(
      organizationId,
      projectId,
      request,
    );
    if (
      request.intent === 'semantic' &&
      request.boosts?.entityIds &&
      request.boosts.entityIds.length > 0
    ) {
      this.logger.warn(
        'Ignoring boosts.entityIds for semantic-only unified search',
      );
    }

    const startTime = Date.now();
    const execution: SearchExecutionTimes = { totalMs: 0 };
    if (request.debug) {
      execution.diagnostics = this.buildSearchDiagnostics(request);
    }

    const response: UnifiedSearchResponse = {
      intent: request.intent,
      query: request.query ?? '',
      organizationId,
      projectId,
      execution,
    };
    let embeddingsOutcome: EmbeddingsOutcome | undefined;

    switch (request.intent) {
      case 'relationship': {
        const graphStart = Date.now();
        response.graph = await this.runGraphSearch(
          organizationId,
          projectId,
          request,
          userToken,
          graphProjection,
        );
        execution.graphMs = Date.now() - graphStart;
        response.results = this.buildUnifiedResults(
          request,
          response.graph,
          undefined,
        );
        break;
      }
      case 'semantic': {
        const embeddingsStart = Date.now();
        embeddingsOutcome = await this.runEmbeddingsSearch(
          organizationId,
          projectId,
          request,
          userToken,
        );
        response.embeddings = embeddingsOutcome.response;
        execution.embeddingsMs = Date.now() - embeddingsStart;
        response.results = this.buildUnifiedResults(
          request,
          undefined,
          embeddingsOutcome.response,
        );
        break;
      }
      case 'hybrid': {
        const hasGraphSeeds = this.hasGraphSeeds(request);
        const hasQuery = !!request.query?.trim();

        if (hasGraphSeeds && hasQuery) {
          const graphStart = Date.now();
          const graphPromise = this.runGraphSearch(
            organizationId,
            projectId,
            request,
            userToken,
            graphProjection,
          ).then((result) => {
            execution.graphMs = Date.now() - graphStart;
            return result;
          });

          const embeddingsStart = Date.now();
          const embeddingsPromise = this.runEmbeddingsSearch(
            organizationId,
            projectId,
            request,
            userToken,
          ).then((result) => {
            execution.embeddingsMs = Date.now() - embeddingsStart;
            return result;
          });

          const [graphResult, embeddingsResult] = await Promise.allSettled([
            graphPromise,
            embeddingsPromise,
          ]);

          if (graphResult.status === 'rejected') {
            throw graphResult.reason;
          }
          if (embeddingsResult.status === 'rejected') {
            throw embeddingsResult.reason;
          }

          response.graph = graphResult.value;
          embeddingsOutcome = embeddingsResult.value;
          response.embeddings = embeddingsOutcome.response;
          response.results = this.buildUnifiedResults(
            request,
            response.graph,
            embeddingsOutcome.response,
          );
          break;
        }

        if (hasQuery) {
          const embeddingsStart = Date.now();
          embeddingsOutcome = await this.runEmbeddingsSearch(
            organizationId,
            projectId,
            request,
            userToken,
          );
          response.embeddings = embeddingsOutcome.response;
          execution.embeddingsMs = Date.now() - embeddingsStart;

          // TODO: Revisit hybrid behavior when no graph seeds are provided (e.g., semantic-only vs semanticA->semanticB).
          const seedEntityIds = this.extractEmbeddingSeedIds(
            embeddingsOutcome.response,
          );
          if (seedEntityIds.length) {
            const graphStart = Date.now();
            response.graph = await this.runGraphSearch(
              organizationId,
              projectId,
              {
                ...request,
                graph: {
                  ...request.graph,
                  seedEntityIds,
                },
              },
              userToken,
              graphProjection,
            );
            execution.graphMs = Date.now() - graphStart;
          } else if (
            request.boosts?.entityIds &&
            request.boosts.entityIds.length > 0
          ) {
            this.logger.warn(
              'Ignoring boosts.entityIds for hybrid search without graph traversal',
            );
          }

          response.results = this.buildUnifiedResults(
            request,
            response.graph,
            embeddingsOutcome.response,
          );
          break;
        }

        const graphStart = Date.now();
        response.graph = await this.runGraphSearch(
          organizationId,
          projectId,
          request,
          userToken,
          graphProjection,
        );
        execution.graphMs = Date.now() - graphStart;
        response.results = this.buildUnifiedResults(
          request,
          response.graph,
          undefined,
        );
        break;
      }
      default: {
        throw new BadRequestException(
          `Unsupported intent: ${request.intent as string}`,
        );
      }
    }

    if (embeddingsOutcome) {
      response.subfacets = embeddingsOutcome.subfacets;
    }

    response.results = this.applyPlanLineageBoost(
      response.results,
      planLineageBoostDeltas,
    );
    this.attachEmbeddingsContentAndTopology(
      response.results,
      embeddingsOutcome,
    );
    await this.attachContentForGraphOnlyResults(
      organizationId,
      response.results,
    );
    this.attachMessageTitles(response.results);
    await this.attachTopologySummaryFromDatabase(
      organizationId,
      projectId,
      response.results,
    );
    if (response.results) {
      if (request.downrankUnreviewed) {
        response.results = this.applyStatusDownrank(response.results);
      }
      response.results.sort(
        (left, right) => (right.score ?? 0) - (left.score ?? 0),
      );
    }

    execution.totalMs = Date.now() - startTime;
    this.logSearchCompleted(organizationId, projectId, request, response);
    void this.logSearchResult(organizationId, projectId, request, response);
    return response;
  }

  async batchSearch(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedBatchSearchRequest,
    userToken: string | null,
    graphProjection?: SearchProjection,
  ): Promise<UnifiedBatchSearchResponse> {
    if (!userToken) {
      throw new UnauthorizedException('Authentication token not found');
    }

    if (!request.queries || request.queries.length === 0) {
      throw new BadRequestException('queries is required');
    }

    const page = request.globalOptions?.page ?? 0;
    const size = request.globalOptions?.size ?? DEFAULT_BATCH_PAGE_SIZE;
    if (page < 0) {
      throw new BadRequestException('globalOptions.page must be >= 0');
    }
    if (size <= 0) {
      throw new BadRequestException('globalOptions.size must be >= 1');
    }

    const startTime = Date.now();
    const execution: SearchExecutionTimes = { totalMs: 0 };
    const aggregatedResults = new Map<string, UnifiedSearchResult>();
    const entityIndex = new Map<string, UnifiedSearchResult>();
    const hitCounts = new Map<string, number>();
    const contentByEntityId = new Map<string, string>();
    const topologyByEntityId = new Map<string, string>();
    const titleByEntityId = new Map<string, string>();
    const batchPlanLineageBoostDeltas = new Map<string, number>();
    const graphCache = new Map<string, Promise<UnifiedGraphSearchResponse>>();
    const batchRequestId = this.resolveBatchRequestId(request);
    this.logger.log('Unified batch search started', {
      organizationId,
      projectId,
      requestId: batchRequestId,
      queryCount: request.queries.length,
      page,
      size,
    });

    const runGraphSearchCached = async (
      requestForGraph: UnifiedSearchRequest,
    ): Promise<UnifiedGraphSearchResponse> => {
      const graphRequest = this.buildGraphRequest(
        requestForGraph,
        graphProjection,
      );
      const cacheKey = this.buildGraphRequestKey(graphRequest);
      const cached = graphCache.get(cacheKey);
      if (cached) {
        return cached;
      }
      const graphStart = Date.now();
      const promise = this.runGraphSearch(
        organizationId,
        projectId,
        requestForGraph,
        userToken,
        graphProjection,
      ).finally(() => {
        execution.graphMs =
          (execution.graphMs ?? 0) + (Date.now() - graphStart);
      });
      graphCache.set(cacheKey, promise);
      return promise;
    };

    for (const [queryIndex, query] of request.queries.entries()) {
      const queryStart = Date.now();
      const queryExecution: SearchExecutionTimes = { totalMs: 0 };
      const mergedRequest = this.mergeBatchRequestWithGlobalOptions(
        query,
        request.globalOptions,
      );
      const expandedRequest =
        await this.expandGraphSeedEntityIdsFromConversation(
          organizationId,
          mergedRequest,
        );

      if (!expandedRequest.intent) {
        throw new BadRequestException('intent is required');
      }
      if (!this.isSupportedIntent(expandedRequest.intent)) {
        throw new BadRequestException(
          `Unsupported intent: ${expandedRequest.intent}`,
        );
      }
      if (expandedRequest.debug) {
        queryExecution.diagnostics =
          this.buildSearchDiagnostics(expandedRequest);
      }

      this.validateIntentRequirements(expandedRequest);
      this.validateEmbeddingsFilters(
        organizationId,
        projectId,
        expandedRequest,
      );
      this.validateBoosts(expandedRequest);
      const planLineageBoostDeltas = await this.resolvePlanLineageBoostDeltas(
        organizationId,
        projectId,
        expandedRequest,
      );
      this.mergeScoreDeltas(
        batchPlanLineageBoostDeltas,
        planLineageBoostDeltas,
      );

      if (
        expandedRequest.intent === 'semantic' &&
        expandedRequest.boosts?.entityIds &&
        expandedRequest.boosts.entityIds.length > 0
      ) {
        this.logger.warn(
          'Ignoring boosts.entityIds for semantic-only unified search',
        );
      }

      let embeddingsOutcome: EmbeddingsOutcome | undefined;
      let graphResponse: UnifiedGraphSearchResponse | undefined;

      switch (expandedRequest.intent) {
        case 'relationship': {
          const graphStart = Date.now();
          graphResponse = await runGraphSearchCached(expandedRequest);
          queryExecution.graphMs =
            (queryExecution.graphMs ?? 0) + (Date.now() - graphStart);
          break;
        }
        case 'semantic': {
          const embeddingsStart = Date.now();
          embeddingsOutcome = await this.runEmbeddingsSearch(
            organizationId,
            projectId,
            expandedRequest,
            userToken,
          );
          const embeddingsElapsed = Date.now() - embeddingsStart;
          execution.embeddingsMs =
            (execution.embeddingsMs ?? 0) + embeddingsElapsed;
          queryExecution.embeddingsMs =
            (queryExecution.embeddingsMs ?? 0) + embeddingsElapsed;
          break;
        }
        case 'hybrid': {
          const hasGraphSeeds = this.hasGraphSeeds(expandedRequest);
          const hasQuery = !!expandedRequest.query?.trim();

          if (hasQuery) {
            if (hasGraphSeeds) {
              const graphStart = Date.now();
              const graphPromise = runGraphSearchCached(expandedRequest).then(
                (result) => {
                  queryExecution.graphMs =
                    (queryExecution.graphMs ?? 0) + (Date.now() - graphStart);
                  return result;
                },
              );
              const embeddingsStart = Date.now();
              const embeddingsPromise = this.runEmbeddingsSearch(
                organizationId,
                projectId,
                expandedRequest,
                userToken,
              ).then((result) => {
                const embeddingsElapsed = Date.now() - embeddingsStart;
                execution.embeddingsMs =
                  (execution.embeddingsMs ?? 0) + embeddingsElapsed;
                queryExecution.embeddingsMs =
                  (queryExecution.embeddingsMs ?? 0) + embeddingsElapsed;
                return result;
              });

              const [graphResult, embeddingsResult] = await Promise.allSettled([
                graphPromise,
                embeddingsPromise,
              ]);

              if (graphResult.status === 'rejected') {
                throw graphResult.reason;
              }
              if (embeddingsResult.status === 'rejected') {
                throw embeddingsResult.reason;
              }

              graphResponse = graphResult.value;
              embeddingsOutcome = embeddingsResult.value;
            } else {
              const embeddingsStart = Date.now();
              embeddingsOutcome = await this.runEmbeddingsSearch(
                organizationId,
                projectId,
                expandedRequest,
                userToken,
              );
              const embeddingsElapsed = Date.now() - embeddingsStart;
              execution.embeddingsMs =
                (execution.embeddingsMs ?? 0) + embeddingsElapsed;
              queryExecution.embeddingsMs =
                (queryExecution.embeddingsMs ?? 0) + embeddingsElapsed;

              const seedEntityIds = this.extractEmbeddingSeedIds(
                embeddingsOutcome.response,
              );
              if (seedEntityIds.length) {
                const graphStart = Date.now();
                graphResponse = await runGraphSearchCached({
                  ...expandedRequest,
                  graph: {
                    ...expandedRequest.graph,
                    seedEntityIds,
                  },
                });
                queryExecution.graphMs =
                  (queryExecution.graphMs ?? 0) + (Date.now() - graphStart);
              } else if (
                expandedRequest.boosts?.entityIds &&
                expandedRequest.boosts.entityIds.length > 0
              ) {
                this.logger.warn(
                  'Ignoring boosts.entityIds for hybrid search without graph traversal',
                );
              }
            }
          } else {
            const graphStart = Date.now();
            graphResponse = await runGraphSearchCached(expandedRequest);
            queryExecution.graphMs =
              (queryExecution.graphMs ?? 0) + (Date.now() - graphStart);
          }
          break;
        }
        default: {
          throw new BadRequestException(
            `Unsupported intent: ${expandedRequest.intent as string}`,
          );
        }
      }

      if (embeddingsOutcome) {
        this.mergeEmbeddingsOutcomeMaps(
          embeddingsOutcome,
          contentByEntityId,
          topologyByEntityId,
          titleByEntityId,
        );
      }

      const queryResults = this.buildUnifiedResults(
        expandedRequest,
        graphResponse,
        embeddingsOutcome?.response,
      );
      const boostedQueryResults =
        this.applyPlanLineageBoost(queryResults, planLineageBoostDeltas) ??
        queryResults;
      this.accumulateBatchResults(
        boostedQueryResults,
        aggregatedResults,
        entityIndex,
        hitCounts,
      );

      queryExecution.totalMs = Date.now() - queryStart;
      const queryResponse: UnifiedSearchResponse = {
        intent: expandedRequest.intent,
        query: expandedRequest.query ?? '',
        organizationId,
        projectId,
        graph: graphResponse,
        embeddings: embeddingsOutcome?.response,
        results: boostedQueryResults,
        subfacets: embeddingsOutcome?.subfacets,
        execution: queryExecution,
      };
      void this.logSearchResult(
        organizationId,
        projectId,
        expandedRequest,
        queryResponse,
        {
          persistedRequestId: batchRequestId,
          requestPayload: {
            batch: {
              requestId: batchRequestId,
              queryIndex,
              queryCount: request.queries.length,
              logStage: 'batch_query',
            },
            request: expandedRequest,
          },
          logStage: 'batch_query',
        },
      );
    }

    const normalized = this.normalizeScores(
      Array.from(aggregatedResults.values()),
    );
    const normalizedWithPlanLineage =
      this.applyPlanLineageBoost(normalized, batchPlanLineageBoostDeltas) ??
      normalized;
    const boosted = this.applyCrossQueryBoost(
      normalizedWithPlanLineage,
      hitCounts,
    );
    const downranked = request.globalOptions?.downrankUnreviewed
      ? this.applyStatusDownrank(boosted)
      : boosted;
    downranked.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));

    const totalElements = downranked.length;
    const totalPages = size > 0 ? Math.ceil(totalElements / size) : 0;
    const offset = page * size;
    const pagedResults = downranked.slice(offset, offset + size);

    this.attachEmbeddingsContentAndTopologyFromMaps(
      pagedResults,
      contentByEntityId,
      topologyByEntityId,
      titleByEntityId,
    );
    await this.attachContentForGraphOnlyResults(organizationId, pagedResults);
    this.attachMessageTitles(pagedResults);
    await this.attachTopologySummaryFromDatabase(
      organizationId,
      projectId,
      pagedResults,
    );

    execution.totalMs = Date.now() - startTime;

    const response: UnifiedBatchSearchResponse = {
      organizationId,
      projectId,
      results: pagedResults,
      totalElements,
      totalPages,
      page,
      size,
      queryCount: request.queries.length,
      execution,
    };

    this.logger.log('Unified batch search completed', {
      organizationId,
      projectId,
      requestId: batchRequestId,
      queryCount: request.queries.length,
      returnedResultCount: pagedResults.length,
      totalResultCount: totalElements,
      graphMs: execution.graphMs,
      embeddingsMs: execution.embeddingsMs,
      totalMs: execution.totalMs,
    });

    void this.logBatchSearchResult(
      organizationId,
      projectId,
      request,
      response,
      batchRequestId,
    );

    return response;
  }

  private logSearchStarted(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
  ): void {
    this.logger.log('Unified search started', {
      organizationId,
      projectId,
      requestId: this.normalizeOptionalId(request.requestId),
      intent: request.intent,
      hasQuery: !!request.query?.trim(),
      graphSeedEntityCount: request.graph?.seedEntityIds?.length ?? 0,
      graphSeedNodeCount: request.graph?.seedNodeIds?.length ?? 0,
    });
  }

  private logSearchCompleted(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
    response: UnifiedSearchResponse,
  ): void {
    this.logger.log('Unified search completed', {
      organizationId,
      projectId,
      requestId: this.normalizeOptionalId(request.requestId),
      intent: response.intent,
      graphResultCount: response.graph?.results?.length ?? 0,
      embeddingsResultCount: response.embeddings?.data?.length ?? 0,
      unifiedResultCount: response.results?.length ?? 0,
      graphMs: response.execution.graphMs,
      embeddingsMs: response.execution.embeddingsMs,
      totalMs: response.execution.totalMs,
    });
  }

  private validateIntentRequirements(request: UnifiedSearchRequest): void {
    const query = request.query?.trim();
    const hasQuery = !!query;
    const hasGraphSeeds =
      !!request.graph?.seedEntityIds?.length ||
      !!request.graph?.seedNodeIds?.length;

    switch (request.intent) {
      case 'relationship': {
        if (!hasGraphSeeds) {
          throw new BadRequestException(
            'graph.seedEntityIds or graph.seedNodeIds is required for relationship search',
          );
        }
        break;
      }
      case 'semantic': {
        if (!hasQuery) {
          throw new BadRequestException(
            'query is required for semantic search',
          );
        }
        break;
      }
      case 'hybrid': {
        if (!hasQuery && !hasGraphSeeds) {
          throw new BadRequestException(
            'query or graph.seedEntityIds/graph.seedNodeIds is required for hybrid search',
          );
        }
        if (
          this.getHybridResultStrategy(request) === 'embeddingsRequired' &&
          !hasQuery
        ) {
          throw new BadRequestException(
            'query is required when embeddings.hybridResultStrategy is embeddingsRequired',
          );
        }
        break;
      }
      default:
        break;
    }
  }

  private async expandGraphSeedEntityIdsFromConversation(
    organizationId: OrganizationId,
    request: UnifiedSearchRequest,
  ): Promise<UnifiedSearchRequest> {
    const graphOptions = request.graph ?? undefined;
    const strategy = graphOptions?.seedEntityIdsStrategy ?? 'explicit';
    if (strategy === 'explicit') {
      return request;
    }

    if (strategy !== 'conversationRelated') {
      throw new BadRequestException(
        `Unsupported graph.seedEntityIdsStrategy: ${strategy}`,
      );
    }

    const conversationId = request.conversationId?.trim();
    if (!conversationId) {
      throw new BadRequestException(
        'conversationId is required when graph.seedEntityIdsStrategy is conversationRelated',
      );
    }
    if (
      graphOptions?.seedEntityIds?.length ||
      graphOptions?.seedNodeIds?.length
    ) {
      throw new BadRequestException(
        'graph.seedEntityIds and graph.seedNodeIds are not allowed when graph.seedEntityIdsStrategy is conversationRelated',
      );
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: conversationId, organizationId },
      select: {
        workflowAboutType: true,
        workflowAboutId: true,
      },
    });

    if (!conversation) {
      throw new BadRequestException(
        `conversationId ${conversationId} was not found in organization ${organizationId}`,
      );
    }

    const resolution =
      await this.entityRelationshipResolverService.resolveForWorkflowAbout({
        organizationId,
        conversationId,
        workflowAboutType: conversation.workflowAboutType as
          | WorkflowAboutType
          | undefined,
        workflowAboutId: conversation.workflowAboutId ?? undefined,
      });

    const expandedIds = new Set<string>(graphOptions?.seedEntityIds ?? []);
    if (conversation.workflowAboutId) {
      expandedIds.add(conversation.workflowAboutId);
    }
    if (resolution.resolvedContext.planId) {
      expandedIds.add(resolution.resolvedContext.planId);
    }
    if (resolution.resolvedContext.initiativeId) {
      expandedIds.add(resolution.resolvedContext.initiativeId);
    }
    if (resolution.resolvedContext.taskId) {
      expandedIds.add(resolution.resolvedContext.taskId);
    }
    if (resolution.resolvedContext.designDocId) {
      expandedIds.add(resolution.resolvedContext.designDocId);
    }

    if (expandedIds.size === 0) {
      throw new BadRequestException(
        `No related entity IDs were resolved from conversationId ${conversationId}`,
      );
    }

    return {
      ...request,
      graph: {
        ...(graphOptions ?? {}),
        seedEntityIds: Array.from(expandedIds),
      },
    };
  }

  private validateEmbeddingsFilters(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
  ): void {
    const filters = request.embeddings?.filters;
    if (!filters) {
      return;
    }

    if (filters.organizationId && filters.organizationId !== organizationId) {
      throw new BadRequestException(
        'filters.organizationId must match the path organizationId',
      );
    }

    if (filters.projectId && filters.projectId !== projectId) {
      throw new BadRequestException(
        'filters.projectId must match the path projectId',
      );
    }
  }

  private validateBoosts(request: UnifiedSearchRequest): void {
    const boosts = request.boosts;
    if (!boosts) {
      return;
    }

    boosts.entityIds?.forEach((boost, index) => {
      if (boost.weight === undefined || boost.weight === null) {
        throw new BadRequestException(
          `boosts.entityIds[${index}].weight is required`,
        );
      }
    });

    boosts.entityTypes?.forEach((boost, index) => {
      if (boost.weight === undefined || boost.weight === null) {
        throw new BadRequestException(
          `boosts.entityTypes[${index}].weight is required`,
        );
      }
    });

    const planLineage = boosts.planLineage;
    if (!planLineage) {
      return;
    }

    if (!planLineage.planId?.trim()) {
      throw new BadRequestException('boosts.planLineage.planId is required');
    }

    if (
      planLineage.mode !== UnifiedSearchPlanLineageMode.WorkItemDependencies
    ) {
      throw new BadRequestException(
        `Unsupported boosts.planLineage.mode: ${String(planLineage.mode)}`,
      );
    }

    const hasTaskId = this.hasNonEmptyString(planLineage.taskId);
    const hasDesignDocId = this.hasNonEmptyString(planLineage.designDocId);
    if (hasTaskId === hasDesignDocId) {
      throw new BadRequestException(
        'Exactly one of boosts.planLineage.taskId or boosts.planLineage.designDocId is required',
      );
    }
  }

  private async runGraphSearch(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
    userToken: string,
    graphProjection?: SearchProjection,
  ): Promise<UnifiedGraphSearchResponse> {
    const graphRequest = this.buildGraphRequest(request, graphProjection);
    this.logger.debug('Graph search request', {
      graphRequest,
    });
    try {
      const response = await this.graphsClientService.searchGraph(
        organizationId,
        projectId,
        graphRequest,
        userToken,
      );
      const results = response.results?.map((item) => ({
        entityId: item.entityId,
        name:
          (item.node?.properties as { name?: string; title?: string } | null)
            ?.name ??
          (item.node?.properties as { name?: string; title?: string } | null)
            ?.title,
        score: item.score,
        scoreBreakdown: item.scoreBreakdown,
      }));
      this.logger.debug('Graph search response (pre-processing)', { results });
      return this.mapGraphResponse(response, graphProjection);
    } catch (error) {
      this.logger.error('Graph search failed', {
        error: errorToLoggable(error),
        query: request.query,
        organizationId,
        projectId,
      });
      throw this.mapServiceError(error, 'graph');
    }
  }

  private async runEmbeddingsSearch(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
    userToken: string,
  ): Promise<EmbeddingsOutcome> {
    const embeddingsFilters = this.buildEmbeddingsRequestFilters(request);
    const embeddingsBoosts = this.buildEmbeddingsBoosts(request);
    const embeddingsRequest: EmbeddingsSearchRequest = {
      query: request.query,
      max_results: request.embeddings?.maxResults ?? 10,
      offset: request.embeddings?.offset ?? 0,
      similarity_threshold: request.embeddings?.similarityThreshold ?? 0.15,
      query_mode: request.embeddings?.queryMode,
      filters: embeddingsFilters,
      boosts: embeddingsBoosts,
    };
    this.logger.debug('Embeddings search request', {
      query: embeddingsRequest.query,
      filters: embeddingsFilters,
      boosts: embeddingsBoosts,
      queryMode: embeddingsRequest.query_mode,
      maxResults: embeddingsRequest.max_results,
      hasToken: !!userToken,
      tokenLength: userToken?.length,
      organizationId,
      projectId,
    });
    try {
      const response =
        await this.embeddingsClientService.searchEmbeddingsWithUserTokenPost(
          organizationId,
          projectId,
          embeddingsRequest,
          userToken,
        );
      const results = response.data?.map((item) => {
        const metadata = (item.metadata ?? null) as EmbeddingMetadata | null;
        const metadataName =
          metadata && 'name' in metadata ? metadata.name : undefined;
        const metadataTitle =
          metadata && 'title' in metadata ? metadata.title : undefined;
        return {
          entityId: metadata?.id ?? item.id,
          name: metadataName ?? metadataTitle ?? item.text,
          score: item.similarity,
        };
      });
      this.logger.debug('Embeddings search response (pre-processing)', {
        results,
      });
      const mappedResponse = this.mapEmbeddingsResponse(response);
      const titleByEntityId = this.buildEmbeddingsTitleMap(response);

      return {
        response: mappedResponse,
        contentByEntityId: this.buildEmbeddingsContentMap(response),
        topologyByEntityId: this.buildEmbeddingsTopologyMap(response),
        titleByEntityId,
        subfacets: this.buildEmbeddingsSubfacets(response),
      };
    } catch (error) {
      const axiosResponse = (error as any)?.response;
      this.logger.error('Embeddings search failed', {
        error: errorToLoggable(error),
        query: request.query,
        organizationId,
        projectId,
        responseStatus: axiosResponse?.status,
        responseData: axiosResponse?.data,
        requestFilters: embeddingsFilters,
      });
      throw this.mapServiceError(error, 'embeddings');
    }
  }

  private hasGraphSeeds(request: UnifiedSearchRequest): boolean {
    return (
      !!request.graph?.seedEntityIds?.length ||
      !!request.graph?.seedNodeIds?.length
    );
  }

  private extractEmbeddingSeedIds(
    embeddings: UnifiedEmbeddingsSearchResponse | undefined,
  ): string[] {
    if (!embeddings?.data) {
      return [];
    }

    const seeds = new Set<string>();
    embeddings.data.forEach((item) => {
      const metadata = (item.metadata ?? null) as EmbeddingMetadata | null;
      if (metadata?.id) {
        seeds.add(metadata.id);
      }
    });

    return Array.from(seeds);
  }

  private buildUnifiedResults(
    request: UnifiedSearchRequest,
    graph: UnifiedGraphSearchResponse | undefined,
    embeddings: UnifiedEmbeddingsSearchResponse | undefined,
  ): UnifiedSearchResult[] {
    const results = new Map<string, UnifiedSearchResult>();
    const entityIndex = new Map<string, UnifiedSearchResult>();

    if (graph?.results) {
      graph.results.forEach((item) => {
        if (!item.entityId) {
          return;
        }
        if (
          item.entityType &&
          !this.isSupportedUnifiedEntityType(item.entityType)
        ) {
          return;
        }
        const entry = this.ensureUnifiedEntry(
          results,
          entityIndex,
          item.entityId,
          item.entityType,
        );
        entry.graph = item;
        entry.graphScore = item.score ?? 0;
        if (!entry.title) {
          const properties = item.node?.properties as
            | { name?: string; title?: string }
            | undefined;
          entry.title = properties?.name ?? properties?.title;
        }
        if (!entry.status) {
          const properties = item.node?.properties as
            | { status?: string }
            | undefined;
          if (properties?.status) {
            entry.status = properties.status;
          }
        }
        entry.sources = this.addSource(entry.sources, 'graph');
      });
    }

    if (embeddings?.data) {
      embeddings.data.forEach((item) => {
        const metadata = (item.metadata ?? null) as EmbeddingMetadata | null;
        const entityId = metadata?.id;
        if (!entityId) {
          return;
        }

        const entityType = this.toApiEntityType(metadata?.type);
        if (metadata?.type && !entityType) {
          return;
        }
        const entry = this.ensureUnifiedEntry(
          results,
          entityIndex,
          entityId,
          entityType,
        );
        entry.embeddings = item;
        entry.semanticScore = item.similarity ?? 0;
        if (!entry.status && metadata && 'status' in metadata) {
          const status = metadata.status;
          if (typeof status === 'string') {
            entry.status = status;
          }
        }
        entry.sources = this.addSource(entry.sources, 'embeddings');
      });
    }

    let mergedResults = Array.from(results.values());
    mergedResults = this.applyRequestedEntityTypeFilters(
      request,
      mergedResults,
    );
    if (request.intent === 'hybrid') {
      mergedResults = this.applyHybridResultStrategy(request, mergedResults);
    }
    mergedResults = this.applyCommonStatusFilters(request, mergedResults);

    const normalized = this.normalizeScores(mergedResults);
    return normalized.sort((left, right) => {
      return (right.score ?? 0) - (left.score ?? 0);
    });
  }

  private applyRequestedEntityTypeFilters(
    request: UnifiedSearchRequest,
    results: UnifiedSearchResult[],
  ): UnifiedSearchResult[] {
    const hasRequestedEntityTypes =
      !!request.common?.types?.length ||
      !!request.graph?.filters?.entityTypes?.length;
    if (!hasRequestedEntityTypes) {
      return results;
    }

    const requestedEntityTypes = this.resolveGraphEntityTypes(request);
    if (!requestedEntityTypes?.length) {
      return [];
    }

    return results.filter(
      (result) =>
        !!result.entityType && requestedEntityTypes.includes(result.entityType),
    );
  }

  private getHybridResultStrategy(
    request: UnifiedSearchRequest,
  ): 'merge' | 'embeddingsRequired' | undefined {
    const strategy = request.embeddings?.hybridResultStrategy;
    if (!strategy) {
      return undefined;
    }
    if (strategy === 'merge' || strategy === 'embeddingsRequired') {
      return strategy;
    }
    throw new BadRequestException(
      `Unsupported embeddings.hybridResultStrategy: ${strategy}`,
    );
  }

  private shouldExcludeContentless(request: UnifiedSearchRequest): boolean {
    if (typeof request.excludeContentless === 'boolean') {
      return request.excludeContentless;
    }

    const strategy = this.getHybridResultStrategy(request);
    if (strategy === 'merge') {
      return false;
    }
    if (strategy === 'embeddingsRequired') {
      return true;
    }
    return true;
  }

  private shouldFilterContentlessHybridResults(
    request: UnifiedSearchRequest,
  ): boolean {
    if (request.intent !== 'hybrid') {
      return false;
    }
    if (!request.query?.trim()) {
      return false;
    }
    return this.shouldExcludeContentless(request);
  }

  private applyHybridResultStrategy(
    request: UnifiedSearchRequest,
    results: UnifiedSearchResult[],
  ): UnifiedSearchResult[] {
    if (!this.shouldFilterContentlessHybridResults(request)) {
      return results;
    }
    return results.filter((result) => !!result.embeddings);
  }

  private applyCommonStatusFilters(
    request: UnifiedSearchRequest,
    results: UnifiedSearchResult[],
  ): UnifiedSearchResult[] {
    const requestedStatuses = this.resolveCommonStatuses(request);
    if (!requestedStatuses?.length) {
      return results;
    }

    return results.filter((result) =>
      this.matchesRequestedStatuses(result, requestedStatuses),
    );
  }

  private matchesRequestedStatuses(
    result: UnifiedSearchResult,
    requestedStatuses: string[],
  ): boolean {
    const canonicalStatuses = this.resolveCanonicalResultStatuses(result);
    if (!canonicalStatuses?.size) {
      return false;
    }

    return requestedStatuses.some((status) => canonicalStatuses.has(status));
  }

  private resolveCanonicalResultStatuses(
    result: UnifiedSearchResult,
  ): Set<string> | undefined {
    const entityType = result.entityType;
    if (!entityType || !this.entityTypeSupportsCanonicalStatus(entityType)) {
      return undefined;
    }

    const statuses = this.extractResultStatuses(result);
    if (statuses.length === 0) {
      return undefined;
    }

    const canonical = statuses
      .map((status) => this.toCanonicalStatus(entityType, status))
      .filter((status): status is string => !!status);
    if (canonical.length === 0) {
      return undefined;
    }
    return new Set(canonical);
  }

  private extractResultStatuses(result: UnifiedSearchResult): string[] {
    const graphProperties = result.graph?.node?.properties as
      | { status?: unknown; statuses?: unknown }
      | undefined;
    const embeddingsMetadata = result.embeddings?.metadata as
      | { status?: unknown; statuses?: unknown }
      | undefined;
    const values = [
      ...this.statusValuesFromUnknown(result.status),
      ...this.statusValuesFromUnknown(graphProperties?.status),
      ...this.statusValuesFromUnknown(graphProperties?.statuses),
      ...this.statusValuesFromUnknown(embeddingsMetadata?.status),
      ...this.statusValuesFromUnknown(embeddingsMetadata?.statuses),
    ];
    return this.normalizeStatusValues(values) ?? [];
  }

  private statusValuesFromUnknown(value: unknown): string[] {
    if (!value) {
      return [];
    }

    if (typeof value === 'string') {
      return [value];
    }

    if (Array.isArray(value)) {
      return value.filter(
        (entry): entry is string => typeof entry === 'string',
      );
    }

    return [];
  }

  private entityTypeSupportsCanonicalStatus(
    entityType: ApiEntityType,
  ): boolean {
    return ENTITY_TYPES_WITH_CANONICAL_STATUS.includes(entityType);
  }

  private toCanonicalStatus(
    entityType: ApiEntityType,
    status: string,
  ): string | undefined {
    const normalized = status.trim().toUpperCase();
    if (normalized.length === 0) {
      return undefined;
    }

    switch (entityType) {
      case ApiEntityType.Task:
      case ApiEntityType.Initiative:
        return this.canonicalizeWorkItemStatus(normalized);
      case ApiEntityType.DesignDoc:
        return normalized;
      default:
        return undefined;
    }
  }

  private canonicalizeWorkItemStatus(status: string): string {
    if (this.isWorkStatus(status)) {
      return status;
    }
    return status;
  }

  private ensureUnifiedEntry(
    results: Map<string, UnifiedSearchResult>,
    entityIndex: Map<string, UnifiedSearchResult>,
    entityId: string,
    entityType?: ApiEntityType,
  ): UnifiedSearchResult {
    const key = this.fusionKey(entityId, entityType);
    const existing = results.get(key);
    if (existing) {
      return existing;
    }

    const fallback = entityIndex.get(entityId);
    if (fallback && entityType && fallback.entityType !== entityType) {
      fallback.entityType = entityType;
      results.delete(this.fusionKey(entityId, undefined));
      results.set(key, fallback);
      return fallback;
    }

    if (fallback && !entityType) {
      return fallback;
    }

    const entry: UnifiedSearchResult = {
      entityId,
      entityType,
      sources: [],
    };
    results.set(key, entry);
    if (!entityIndex.has(entityId)) {
      entityIndex.set(entityId, entry);
    }
    return entry;
  }

  private fusionKey(entityId: string, entityType?: ApiEntityType): string {
    return `${entityType ?? 'UNKNOWN'}:${entityId}`;
  }

  private addSource(
    sources: Array<UnifiedSearchResult.SourcesEnum> | undefined,
    source: UnifiedSearchResult.SourcesEnum,
  ): Array<UnifiedSearchResult.SourcesEnum> {
    const next = sources ? [...sources] : [];
    if (!next.includes(source)) {
      next.push(source);
    }
    return next;
  }

  private normalizeScores(
    entries: UnifiedSearchResult[],
    weights: FusionWeights = DEFAULT_FUSION_WEIGHTS,
  ): UnifiedSearchResult[] {
    const maxGraph = entries.reduce(
      (max, item) => Math.max(max, item.graphScore ?? 0),
      0,
    );
    const maxSemantic = entries.reduce(
      (max, item) => Math.max(max, item.semanticScore ?? 0),
      0,
    );

    return entries.map((item) => {
      const graphScore = maxGraph > 0 ? (item.graphScore ?? 0) / maxGraph : 0;
      const semanticScore =
        maxSemantic > 0 ? (item.semanticScore ?? 0) / maxSemantic : 0;
      const hasGraph = !!item.graph;
      const hasEmbeddings = !!item.embeddings;
      const graphWeight = hasGraph && !hasEmbeddings ? 1 : weights.graph;
      const embeddingsWeight =
        hasEmbeddings && !hasGraph ? 1 : weights.embeddings;
      const totalWeight = graphWeight + embeddingsWeight;
      const normalizedGraphWeight =
        totalWeight > 0 ? graphWeight / totalWeight : 0;
      const normalizedEmbeddingsWeight =
        totalWeight > 0 ? embeddingsWeight / totalWeight : 0;
      const combined =
        graphScore * normalizedGraphWeight +
        semanticScore * normalizedEmbeddingsWeight;

      return {
        ...item,
        score: combined,
      };
    });
  }

  private mergeBatchRequestWithGlobalOptions(
    query: UnifiedSearchRequest,
    globalOptions: UnifiedBatchSearchGlobalOptions | undefined,
  ): UnifiedSearchRequest {
    if (!globalOptions) {
      return query;
    }

    return {
      ...query,
      common: this.mergeCommonFilters(globalOptions.common, query.common),
      graph: this.mergeGraphOptions(globalOptions.graph, query.graph),
      embeddings: this.mergeEmbeddingsOptions(
        globalOptions.embeddings,
        query.embeddings,
      ),
      boosts: query.boosts ?? globalOptions.boosts,
    };
  }

  private mergeCommonFilters(
    globalCommon: UnifiedBatchSearchGlobalOptions['common'] | undefined,
    queryCommon: UnifiedSearchRequest['common'] | undefined,
  ): UnifiedSearchRequest['common'] | undefined {
    if (!globalCommon && !queryCommon) {
      return undefined;
    }
    if (!globalCommon) {
      return queryCommon;
    }
    if (!queryCommon) {
      return globalCommon;
    }

    return {
      ...globalCommon,
      ...queryCommon,
      types: queryCommon.types ?? globalCommon.types,
      statuses: queryCommon.statuses ?? globalCommon.statuses,
      dateRange: {
        ...(globalCommon.dateRange ?? {}),
        ...(queryCommon.dateRange ?? {}),
      },
      updatedAtRange: {
        ...(globalCommon.updatedAtRange ?? {}),
        ...(queryCommon.updatedAtRange ?? {}),
      },
    };
  }

  private mergeGraphOptions(
    globalGraph: UnifiedBatchGraphSearchOptions | undefined,
    queryGraph: UnifiedSearchRequest['graph'] | undefined,
  ): UnifiedSearchRequest['graph'] | undefined {
    if (!globalGraph && !queryGraph) {
      return undefined;
    }
    if (!globalGraph) {
      return queryGraph;
    }
    if (!queryGraph) {
      return globalGraph as UnifiedSearchRequest['graph'];
    }

    return {
      ...globalGraph,
      ...queryGraph,
      traversal: {
        ...(globalGraph.traversal ?? {}),
        ...(queryGraph.traversal ?? {}),
      },
      filters: {
        ...(globalGraph.filters ?? {}),
        ...(queryGraph.filters ?? {}),
      },
      scoring: {
        ...(globalGraph.scoring ?? {}),
        ...(queryGraph.scoring ?? {}),
      },
    } as UnifiedSearchRequest['graph'];
  }

  private mergeEmbeddingsOptions(
    globalEmbeddings: UnifiedBatchSearchGlobalOptions['embeddings'] | undefined,
    queryEmbeddings: UnifiedSearchRequest['embeddings'] | undefined,
  ): UnifiedSearchRequest['embeddings'] | undefined {
    if (!globalEmbeddings && !queryEmbeddings) {
      return undefined;
    }
    if (!globalEmbeddings) {
      return queryEmbeddings;
    }
    if (!queryEmbeddings) {
      return globalEmbeddings;
    }

    return {
      ...globalEmbeddings,
      ...queryEmbeddings,
      filters: {
        ...(globalEmbeddings.filters ?? {}),
        ...(queryEmbeddings.filters ?? {}),
      },
    };
  }

  private mergeEmbeddingsOutcomeMaps(
    outcome: EmbeddingsOutcome,
    contentByEntityId: Map<string, string>,
    topologyByEntityId: Map<string, string>,
    titleByEntityId: Map<string, string>,
  ): void {
    outcome.contentByEntityId.forEach((content, entityId) => {
      if (!contentByEntityId.has(entityId)) {
        contentByEntityId.set(entityId, content);
      }
    });
    outcome.topologyByEntityId.forEach((summary, entityId) => {
      if (!topologyByEntityId.has(entityId)) {
        topologyByEntityId.set(entityId, summary);
      }
    });
    outcome.titleByEntityId.forEach((title, entityId) => {
      if (!titleByEntityId.has(entityId)) {
        titleByEntityId.set(entityId, title);
      }
    });
  }

  private accumulateBatchResults(
    queryResults: UnifiedSearchResult[],
    aggregatedResults: Map<string, UnifiedSearchResult>,
    entityIndex: Map<string, UnifiedSearchResult>,
    hitCounts: Map<string, number>,
  ): void {
    queryResults.forEach((result) => {
      if (!result.entityId) {
        return;
      }

      const entry = this.ensureUnifiedEntry(
        aggregatedResults,
        entityIndex,
        result.entityId,
        result.entityType,
      );

      entry.sources = this.mergeSources(entry.sources, result.sources);

      if (result.graph) {
        const nextScore = result.graphScore ?? 0;
        if ((entry.graphScore ?? 0) <= nextScore) {
          entry.graph = result.graph;
          entry.graphScore = nextScore;
        }
      }

      if (result.embeddings) {
        const nextScore = result.semanticScore ?? 0;
        if ((entry.semanticScore ?? 0) <= nextScore) {
          entry.embeddings = result.embeddings;
          entry.semanticScore = nextScore;
        }
      }

      if (result.title && !entry.title) {
        entry.title = result.title;
      }
      if (result.content && !entry.content) {
        entry.content = result.content;
      }
      if (result.topologySummary && !entry.topologySummary) {
        entry.topologySummary = result.topologySummary;
      }
      if (result.status && !entry.status) {
        entry.status = result.status;
      }

      if (result.graphScore !== undefined) {
        entry.graphScore = Math.max(entry.graphScore ?? 0, result.graphScore);
      }
      if (result.semanticScore !== undefined) {
        entry.semanticScore = Math.max(
          entry.semanticScore ?? 0,
          result.semanticScore,
        );
      }

      hitCounts.set(result.entityId, (hitCounts.get(result.entityId) ?? 0) + 1);
    });
  }

  private applyCrossQueryBoost(
    results: UnifiedSearchResult[],
    hitCounts: Map<string, number>,
  ): UnifiedSearchResult[] {
    return results.map((result) => {
      if (!result.entityId) {
        return result;
      }
      const hits = hitCounts.get(result.entityId) ?? 1;
      const boost =
        hits > 1
          ? Math.min(
              MAX_CROSS_QUERY_BOOST,
              (hits - 1) * DEFAULT_CROSS_QUERY_BOOST,
            )
          : 0;
      if (boost <= 0) {
        return result;
      }
      this.logger.debug('Applied cross-query boost', {
        entityId: result.entityId,
        hits,
        boost,
        previousScore: result.score ?? 0,
        boostedScore: (result.score ?? 0) + boost,
      });
      return {
        ...result,
        score: (result.score ?? 0) + boost,
      };
    });
  }

  private applyPlanLineageBoost(
    results: UnifiedSearchResult[] | undefined,
    deltasByEntityId: Map<string, number> | undefined,
  ): UnifiedSearchResult[] | undefined {
    if (!results || !deltasByEntityId || deltasByEntityId.size === 0) {
      return results;
    }

    return results.map((result) => {
      if (!result.entityId) {
        return result;
      }
      const delta = deltasByEntityId.get(result.entityId);
      if (!delta || delta <= 0) {
        return result;
      }
      this.logger.debug('Applied plan-lineage result boost', {
        entityId: result.entityId,
        delta,
        previousScore: result.score ?? 0,
        boostedScore: (result.score ?? 0) + delta,
      });
      return {
        ...result,
        score: (result.score ?? 0) + delta,
      };
    });
  }

  private mergeScoreDeltas(
    targetDeltasByEntityId: Map<string, number>,
    sourceDeltasByEntityId: Map<string, number> | undefined,
  ): void {
    if (!sourceDeltasByEntityId || sourceDeltasByEntityId.size === 0) {
      return;
    }

    sourceDeltasByEntityId.forEach((delta, entityId) => {
      if (delta <= 0) {
        return;
      }
      const current = targetDeltasByEntityId.get(entityId) ?? 0;
      if (delta > current) {
        targetDeltasByEntityId.set(entityId, delta);
      }
    });
  }

  private async resolvePlanLineageBoostDeltas(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
  ): Promise<Map<string, number> | undefined> {
    const planLineage = request.boosts?.planLineage;
    if (!planLineage) {
      return undefined;
    }

    return this.planLineageBoostService.resolveBoostDeltas({
      organizationId,
      projectId,
      planLineage,
    });
  }

  private hasNonEmptyString(value: string | undefined): boolean {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private applyStatusDownrank(
    results: UnifiedSearchResult[],
  ): UnifiedSearchResult[] {
    if (results.length === 0) {
      return results;
    }

    return results.map((result) => {
      const factor = this.getStatusDownrankFactor(result);
      if (factor >= 1) {
        return result;
      }
      return {
        ...result,
        score: (result.score ?? 0) * factor,
      };
    });
  }

  private getStatusDownrankFactor(result: UnifiedSearchResult): number {
    const status = result.status;
    if (!status || !result.entityType) {
      return 1;
    }

    switch (result.entityType) {
      case ApiEntityType.Task:
      case ApiEntityType.Initiative:
        return this.getWorkItemDownrankFactor(status);
      case ApiEntityType.DesignDoc:
        return this.isDesignDocRefiningStatus(status) ? 0.7 : 1;
      default:
        return 1;
    }
  }

  private getWorkItemDownrankFactor(status: string): number {
    if (!this.isWorkStatus(status) || !isWorkItemRefining(status)) {
      return 1;
    }

    const section = getWorkItemSectionFromStatus(status);
    switch (section) {
      case 'description':
        return 0.5;
      case 'details':
        return 0.75;
      case 'acceptanceCriteria':
        return 0.9;
      default:
        return 1;
    }
  }

  private isWorkStatus(status: string): status is WorkStatus {
    return Object.values(WorkStatus).includes(status as WorkStatus);
  }

  private isDesignDocRefiningStatus(status: string): boolean {
    return status.includes('REFINING_') || status.includes('GENERATING_');
  }

  private mergeSources(
    existing: Array<UnifiedSearchResult.SourcesEnum> | undefined,
    incoming: Array<UnifiedSearchResult.SourcesEnum> | undefined,
  ): Array<UnifiedSearchResult.SourcesEnum> | undefined {
    const merged = existing ? [...existing] : [];
    incoming?.forEach((source) => {
      if (!merged.includes(source)) {
        merged.push(source);
      }
    });
    return merged.length > 0 ? merged : undefined;
  }

  private isSupportedUnifiedEntityType(entityType: ApiEntityType): boolean {
    return entityType !== ApiEntityType.Artifact;
  }

  private normalizeUnifiedEntityTypes(
    entityTypes?: ApiEntityType[],
  ): ApiEntityType[] | undefined {
    if (!entityTypes?.length) {
      return undefined;
    }

    const supported = entityTypes.filter((entityType) =>
      this.isSupportedUnifiedEntityType(entityType),
    );
    return supported.length > 0 ? supported : undefined;
  }

  private toApiEntityType(value?: string): ApiEntityType | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.toUpperCase();
    const candidates = Object.values(ApiEntityType);
    if (candidates.includes(normalized as ApiEntityType)) {
      const entityType = normalized as ApiEntityType;
      if (this.isSupportedUnifiedEntityType(entityType)) {
        return entityType;
      }
    }

    return undefined;
  }

  private toGraphTaskType(type: WorkItemTypeKey): string | undefined {
    const canonicalType = this.toCanonicalSearchTaskType(type);
    const mapping: Record<string, string> = {
      [WORK_ITEM_TYPE_KEYS.Standard]: WORK_ITEM_TYPE_KEYS.Standard,
      [WORK_ITEM_TYPE_KEYS.Bug]: WORK_ITEM_TYPE_KEYS.Bug,
      [WORK_ITEM_TYPE_KEYS.Feature]: WORK_ITEM_TYPE_KEYS.Feature,
      [WORK_ITEM_TYPE_KEYS.Goal]: WORK_ITEM_TYPE_KEYS.Goal,
      [WORK_ITEM_TYPE_KEYS.Contract]: WORK_ITEM_TYPE_KEYS.Contract,
      [WORK_ITEM_TYPE_KEYS.Diagram]: WORK_ITEM_TYPE_KEYS.Diagram,
      [WORK_ITEM_TYPE_KEYS.DiagramElement]: WORK_ITEM_TYPE_KEYS.DiagramElement,
      [WORK_ITEM_TYPE_KEYS.TaskMonitor]: WORK_ITEM_TYPE_KEYS.TaskMonitor,
    };
    return mapping[canonicalType];
  }

  private toCanonicalSearchTaskType(type: WorkItemTypeKey): WorkItemTypeKey {
    switch (type) {
      case 'workflow':
      case 'WORKFLOW':
        return WORK_ITEM_TYPE_KEYS.Diagram;
      case 'workflow_step':
      case 'WORKFLOW_STEP':
        return WORK_ITEM_TYPE_KEYS.DiagramElement;
      default:
        return type;
    }
  }

  private buildGraphRequest(
    request: UnifiedSearchRequest,
    projection?: SearchProjection,
  ): GraphSearchRequest {
    const graphEntityTypes = this.resolveGraphEntityTypes(request);
    const graphDateRange = this.resolveGraphDateRange(request);
    const graphUpdatedAtRange = this.resolveGraphUpdatedAtRange(request);
    const graphStatuses = this.resolveGraphStatuses(request);
    const taskTypes = this.resolveGraphTaskTypes(request);
    const graphFilters = request.graph?.filters;
    const resolvedEntityTypes = graphEntityTypes
      ?.map((type) => this.toGraphEntityType(type))
      .filter((type): type is GraphEntityType => !!type);
    const resolvedTaskTypes = taskTypes
      ?.map((t) => this.toGraphTaskType(t))
      .filter((t): t is string => !!t);
    const hasGraphFilters =
      !!graphFilters ||
      !!resolvedEntityTypes?.length ||
      !!graphStatuses?.length ||
      !!resolvedTaskTypes?.length ||
      !!graphDateRange?.from ||
      !!graphDateRange?.to ||
      !!graphUpdatedAtRange?.from ||
      !!graphUpdatedAtRange?.to;

    return {
      projection,
      seedEntityIds: request.graph?.seedEntityIds,
      seedNodeIds: request.graph?.seedNodeIds,
      traversal: this.mapTraversalOptions(request.graph?.traversal),
      filters: hasGraphFilters
        ? {
            entityTypes: resolvedEntityTypes,
            labels: graphFilters?.labels,
            statuses: graphStatuses,
            taskTypes: resolvedTaskTypes,
            dateRange: graphDateRange,
            updatedAtRange: graphUpdatedAtRange,
          }
        : undefined,
      scoring: this.mapTraversalScoring(request.graph?.scoring),
      boosts: this.mapGraphBoosts(request.boosts),
      includeRelationships: request.graph?.includeRelationships ?? false,
      trackPathCount: request.graph?.trackPathCount ?? false,
      page: request.graph?.page ?? 0,
      size: request.graph?.size ?? 50,
    };
  }

  private buildGraphRequestKey(request: GraphSearchRequest): string {
    const sortByString = <T extends string>(values?: T[]) =>
      values
        ? [...values].sort((left, right) => left.localeCompare(right))
        : undefined;
    const sortByKey = <T>(
      values: T[] | undefined,
      selector: (item: T) => string,
    ) =>
      values
        ? [...values].sort((left, right) =>
            selector(left).localeCompare(selector(right)),
          )
        : undefined;

    const normalized: GraphSearchRequest = {
      ...request,
      seedEntityIds: sortByString(request.seedEntityIds),
      seedNodeIds: sortByString(request.seedNodeIds),
      traversal: request.traversal
        ? {
            ...request.traversal,
            relationshipTypes: sortByString(
              request.traversal.relationshipTypes,
            ),
          }
        : undefined,
      filters: request.filters
        ? {
            ...request.filters,
            entityTypes: sortByString(request.filters.entityTypes),
            labels: sortByString(request.filters.labels),
            statuses: sortByString(request.filters.statuses),
            taskTypes: sortByString(request.filters.taskTypes),
          }
        : undefined,
      scoring: request.scoring
        ? {
            ...request.scoring,
            relationshipWeights: sortByKey(
              request.scoring.relationshipWeights,
              (item) => item.type,
            ),
          }
        : undefined,
      boosts: request.boosts
        ? {
            entityIds: sortByKey(request.boosts.entityIds, (item) => item.id),
            entityTypes: sortByKey(
              request.boosts.entityTypes,
              (item) => item.type,
            ),
          }
        : undefined,
    };

    return JSON.stringify(normalized);
  }

  private mapTraversalOptions(
    options: UnifiedSearchRequest['graph'] extends infer T
      ? T extends { traversal?: infer U }
        ? U
        : undefined
      : undefined,
  ): GraphSearchRequest['traversal'] {
    if (!options) {
      return undefined;
    }

    return {
      direction: this.toSearchDirection(options.direction),
      depth: options.depth,
      relationshipTypes: this.toGraphRelationshipTypes(
        options.relationshipTypes,
      ),
    };
  }

  private mapGraphBoosts(
    boosts: UnifiedSearchRequest['boosts'] | undefined,
  ): GraphSearchRequest['boosts'] | undefined {
    if (!boosts) {
      return undefined;
    }

    const entityIds = boosts.entityIds?.map(
      (boost): GraphBoostEntityId => ({
        id: boost.id,
        weight: this.toBoostDelta(boost.weight),
      }),
    );

    const entityTypes = boosts.entityTypes?.reduce<GraphBoostEntityType[]>(
      (acc, boost) => {
        const type = this.toGraphEntityType(boost.type);
        if (!type) {
          return acc;
        }
        acc.push({
          type,
          weight: this.toBoostDelta(boost.weight),
        });
        return acc;
      },
      [],
    );

    const hasEntityIds = !!entityIds?.length;
    const hasEntityTypes = !!entityTypes?.length;
    if (!hasEntityIds && !hasEntityTypes) {
      return undefined;
    }

    return {
      entityIds: hasEntityIds ? entityIds : undefined,
      entityTypes: hasEntityTypes ? entityTypes : undefined,
    };
  }

  private toBoostDelta(weight: number): number {
    return weight - 1;
  }

  private mapTraversalScoring(
    scoring: UnifiedSearchRequest['graph'] extends infer T
      ? T extends { scoring?: infer U }
        ? U
        : undefined
      : undefined,
  ): GraphSearchRequest['scoring'] {
    if (!scoring) {
      return undefined;
    }

    return {
      depthPenalty: scoring.depthPenalty,
      relationshipWeights: scoring.relationshipWeights
        ?.map((weight) => {
          const type = this.toGraphRelationshipType(weight.type);
          if (!type) {
            return undefined;
          }
          return {
            type,
            weight: weight.weight,
          };
        })
        .filter(Boolean) as { type: RelationshipType; weight: number }[],
    };
  }

  private toSearchDirection(direction?: string): SearchDirection | undefined {
    if (!direction) {
      return undefined;
    }

    const normalized = direction.toUpperCase();
    const values = Object.values(SearchDirection);
    if (values.includes(normalized as SearchDirection)) {
      return normalized as SearchDirection;
    }

    return undefined;
  }

  private toGraphRelationshipTypes(
    relationshipTypes?: string[],
  ): RelationshipType[] | undefined {
    if (!relationshipTypes?.length) {
      return undefined;
    }

    return relationshipTypes
      .map((type) => this.toGraphRelationshipType(type))
      .filter((type): type is RelationshipType => !!type);
  }

  private toGraphRelationshipType(type?: string): RelationshipType | undefined {
    if (!type) {
      return undefined;
    }

    const normalized = type.toUpperCase();
    const values = Object.values(RelationshipType);
    if (values.includes(normalized as RelationshipType)) {
      return normalized as RelationshipType;
    }

    return undefined;
  }

  private toGraphEntityType(
    value?: ApiEntityType,
  ): GraphEntityType | undefined {
    if (!value) {
      return undefined;
    }
    if (!this.isSupportedUnifiedEntityType(value)) {
      return undefined;
    }

    const normalized = value.toString().toUpperCase();
    const values = Object.values(GraphEntityType);
    if (values.includes(normalized as GraphEntityType)) {
      return normalized as GraphEntityType;
    }

    return undefined;
  }

  private toPrismaEntityType(
    value?: ApiEntityType,
  ): PrismaEntityType | undefined {
    if (!value) {
      return undefined;
    }

    const normalized = value.toString().toUpperCase();
    const values = Object.values(PrismaEntityType);
    if (values.includes(normalized as PrismaEntityType)) {
      return normalized as PrismaEntityType;
    }

    return undefined;
  }

  private resolveGraphTaskTypes(
    request: UnifiedSearchRequest,
  ): WorkItemTypeKey[] | undefined {
    const commonTaskTypes = request.common?.taskTypes;
    const graphTaskTypes = request.graph?.filters?.taskTypes;
    if (commonTaskTypes?.length && graphTaskTypes?.length) {
      this.logger.warn(
        'common.taskTypes overrides graph.filters.taskTypes for unified search',
      );
    }

    if (commonTaskTypes?.length) {
      return commonTaskTypes;
    }

    return graphTaskTypes?.length ? graphTaskTypes : undefined;
  }

  private resolveEmbeddingsTaskTypes(
    request: UnifiedSearchRequest,
  ): string[] | undefined {
    const commonTaskTypes = request.common?.taskTypes;
    const embeddingsTaskTypes = request.embeddings?.filters?.taskTypes;
    if (commonTaskTypes?.length && embeddingsTaskTypes?.length) {
      this.logger.warn(
        'common.taskTypes overrides embeddings.filters.taskTypes for unified search',
      );
    }

    if (commonTaskTypes?.length) {
      return this.toEmbeddingsTaskTypes(commonTaskTypes);
    }

    return embeddingsTaskTypes?.length
      ? this.toEmbeddingsTaskTypes(embeddingsTaskTypes)
      : undefined;
  }

  private toEmbeddingsTaskTypes(
    taskTypes: readonly WorkItemTypeKey[],
  ): string[] {
    return [
      ...new Set(taskTypes.map((type) => this.toCanonicalSearchTaskType(type))),
    ];
  }

  private resolveGraphEntityTypes(
    request: UnifiedSearchRequest,
  ): ApiEntityType[] | undefined {
    const commonTypes = request.common?.types;
    const graphTypes = request.graph?.filters?.entityTypes;
    if (commonTypes?.length && graphTypes?.length) {
      this.logger.warn(
        'common.types overrides graph.filters.entityTypes for unified search',
      );
    }

    if (commonTypes?.length) {
      return this.normalizeUnifiedEntityTypes(commonTypes);
    }

    return this.normalizeUnifiedEntityTypes(graphTypes);
  }

  private resolveGraphDateRange(
    request: UnifiedSearchRequest,
  ): UnifiedSearchRequest['graph'] extends infer T
    ? T extends { filters?: infer U }
      ? U extends { dateRange?: infer V }
        ? V
        : undefined
      : undefined
    : undefined {
    const commonDateRange = request.common?.dateRange;
    if (commonDateRange?.from || commonDateRange?.to) {
      return commonDateRange;
    }

    return request.graph?.filters?.dateRange;
  }

  private resolveGraphUpdatedAtRange(
    request: UnifiedSearchRequest,
  ): UnifiedGraphSearchFilters['updatedAtRange'] | undefined {
    const commonUpdatedAtRange = request.common?.updatedAtRange;
    if (commonUpdatedAtRange?.from || commonUpdatedAtRange?.to) {
      return commonUpdatedAtRange;
    }

    return request.graph?.filters?.updatedAtRange;
  }

  private resolveGraphStatuses(
    request: UnifiedSearchRequest,
  ): string[] | undefined {
    const commonStatuses = this.resolveCommonStatuses(request);
    const graphStatuses = this.normalizeStatusValues(
      request.graph?.filters?.statuses,
    );
    if (commonStatuses?.length && graphStatuses?.length) {
      this.logger.warn(
        'common.statuses overrides graph.filters.statuses for unified search',
      );
    }

    if (commonStatuses?.length) {
      return commonStatuses;
    }

    return graphStatuses;
  }

  private resolveEmbeddingsStatuses(
    request: UnifiedSearchRequest,
  ): string[] | undefined {
    const commonStatuses = this.resolveCommonStatuses(request);
    const baseFilters = request.embeddings?.filters;
    const embeddingStatuses = this.normalizeStatusValues([
      ...(baseFilters?.statuses ?? []),
      ...(baseFilters?.status ? [baseFilters.status] : []),
    ]);
    if (commonStatuses?.length && embeddingStatuses?.length) {
      this.logger.warn(
        'common.statuses overrides embeddings.filters status/statuses for unified search',
      );
    }

    if (commonStatuses?.length) {
      return commonStatuses;
    }

    return embeddingStatuses;
  }

  private resolveCommonStatuses(
    request: UnifiedSearchRequest,
  ): string[] | undefined {
    return this.normalizeStatusValues(request.common?.statuses);
  }

  private normalizeStatusValues(
    statuses: string[] | undefined,
  ): string[] | undefined {
    if (!statuses?.length) {
      return undefined;
    }

    const normalized = statuses
      .map((status) => status.trim().toUpperCase())
      .filter((status) => status.length > 0);
    return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined;
  }

  private buildSearchDiagnostics(
    request: UnifiedSearchRequest,
  ): UnifiedSearchDiagnostics {
    const graphFilters: UnifiedGraphSearchFilters = {
      entityTypes: this.resolveGraphEntityTypes(request),
      labels: request.graph?.filters?.labels,
      statuses: this.resolveGraphStatuses(request),
      dateRange: this.resolveGraphDateRange(request),
      updatedAtRange: this.resolveGraphUpdatedAtRange(request),
    };
    const hasGraphFilters =
      !!graphFilters.entityTypes?.length ||
      !!graphFilters.labels?.length ||
      !!graphFilters.statuses?.length ||
      !!graphFilters.dateRange?.from ||
      !!graphFilters.dateRange?.to ||
      !!graphFilters.updatedAtRange?.from ||
      !!graphFilters.updatedAtRange?.to;
    const requestedStatuses = this.resolveCommonStatuses(request);

    return {
      filters: {
        common: request.common,
        graph: hasGraphFilters ? graphFilters : undefined,
        embeddings: this.buildEmbeddingsFilters(request),
      },
      statusSemantics: requestedStatuses?.length
        ? {
            requestedStatuses,
            entityTypesWithCanonicalStatus: ENTITY_TYPES_WITH_CANONICAL_STATUS,
            entitiesWithoutStatusBehavior: 'exclude',
          }
        : undefined,
    };
  }

  private buildEmbeddingsFilters(
    request: UnifiedSearchRequest,
  ): UnifiedEmbeddingsSearchFilters | undefined {
    const baseFilters = request.embeddings?.filters;
    const commonTypes = this.normalizeUnifiedEntityTypes(request.common?.types);
    const commonDateRange = request.common?.dateRange;
    const commonUpdatedAtRange = request.common?.updatedAtRange;
    const statuses = this.resolveEmbeddingsStatuses(request);
    const taskTypes = this.resolveUnifiedEmbeddingsTaskTypes(request);

    if (
      !baseFilters &&
      !commonTypes?.length &&
      !commonDateRange &&
      !commonUpdatedAtRange &&
      !statuses?.length &&
      !taskTypes?.length
    ) {
      return undefined;
    }

    const mergedFilters: UnifiedEmbeddingsSearchFilters = {
      ...(baseFilters ?? {}),
    };

    if (commonTypes?.length) {
      mergedFilters.types = commonTypes.map((type) =>
        type.toString().toLowerCase(),
      );
      mergedFilters.type = undefined;
      mergedFilters.docTypes = undefined;
    }

    if (commonDateRange?.from || commonDateRange?.to) {
      mergedFilters.created_after = commonDateRange?.from;
      mergedFilters.created_before = commonDateRange?.to;
    }

    if (commonUpdatedAtRange?.from || commonUpdatedAtRange?.to) {
      mergedFilters.updated_after = commonUpdatedAtRange?.from;
      mergedFilters.updated_before = commonUpdatedAtRange?.to;
    }

    if (statuses?.length) {
      mergedFilters.statuses = statuses;
      mergedFilters.status = undefined;
    }

    if (taskTypes?.length) {
      mergedFilters.taskTypes = taskTypes;
    }

    return mergedFilters;
  }

  private buildEmbeddingsRequestFilters(
    request: UnifiedSearchRequest,
  ): EmbeddingsSearchFiltersContract | undefined {
    const baseFilters = request.embeddings?.filters;
    const commonTypes = this.normalizeUnifiedEntityTypes(request.common?.types);
    const commonDateRange = request.common?.dateRange;
    const commonUpdatedAtRange = request.common?.updatedAtRange;
    const statuses = this.resolveEmbeddingsStatuses(request);
    const taskTypes = this.resolveEmbeddingsTaskTypes(request);

    if (
      !baseFilters &&
      !commonTypes?.length &&
      !commonDateRange &&
      !commonUpdatedAtRange &&
      !statuses?.length &&
      !taskTypes?.length
    ) {
      return undefined;
    }

    const { taskTypes: _baseTaskTypes, ...baseFiltersWithoutTaskTypes } =
      baseFilters ?? {};
    void _baseTaskTypes;

    const mergedFilters: EmbeddingsSearchFiltersContract = {
      ...baseFiltersWithoutTaskTypes,
    };

    if (commonTypes?.length) {
      if (
        baseFilters?.type ||
        baseFilters?.types?.length ||
        baseFilters?.docTypes?.length
      ) {
        this.logger.warn(
          'common.types overrides embeddings.filters type/types/docTypes for unified search',
        );
      }
      mergedFilters.types = commonTypes.map((type) =>
        type.toString().toLowerCase(),
      );
      mergedFilters.type = undefined;
      mergedFilters.docTypes = undefined;
    }

    if (commonDateRange?.from || commonDateRange?.to) {
      mergedFilters.created_after = commonDateRange?.from;
      mergedFilters.created_before = commonDateRange?.to;
    }

    if (commonUpdatedAtRange?.from || commonUpdatedAtRange?.to) {
      mergedFilters.updated_after = commonUpdatedAtRange?.from;
      mergedFilters.updated_before = commonUpdatedAtRange?.to;
    }

    if (statuses?.length) {
      mergedFilters.statuses = statuses;
      mergedFilters.status = undefined;
    }

    if (taskTypes?.length) {
      mergedFilters.taskTypes = taskTypes;
    }

    return mergedFilters;
  }

  private resolveUnifiedEmbeddingsTaskTypes(
    request: UnifiedSearchRequest,
  ): WorkItemTypeKey[] | undefined {
    const commonTaskTypes = request.common?.taskTypes;
    const embeddingsTaskTypes = request.embeddings?.filters?.taskTypes;

    if (commonTaskTypes?.length) {
      return commonTaskTypes;
    }

    return embeddingsTaskTypes?.length ? embeddingsTaskTypes : undefined;
  }

  private buildEmbeddingsBoosts(
    request: UnifiedSearchRequest,
  ): EmbeddingsSearchRequest['boosts'] | undefined {
    const boosts = request.boosts;
    if (!boosts?.entityTypes?.length) {
      return undefined;
    }

    const entityTypes = boosts.entityTypes
      .filter((boost) => this.isSupportedUnifiedEntityType(boost.type))
      .map(
        (boost): EmbeddingsBoostEntityType => ({
          type: boost.type.toString().toLowerCase(),
          weight: this.toBoostDelta(boost.weight),
        }),
      )
      .filter((boost) => boost.type.length > 0);

    if (entityTypes.length === 0) {
      return undefined;
    }

    return {
      entityTypes,
    };
  }

  private mapGraphResponse(
    response: GraphSearchResponse,
    projection?: SearchProjection,
  ): UnifiedGraphSearchResponse {
    return {
      results: response.results
        ?.filter((item) => {
          if (!item.entityType) {
            return true;
          }
          const entityType = item.entityType as unknown as ApiEntityType;
          return this.isSupportedUnifiedEntityType(entityType);
        })
        .map((item) => ({
          node: item.node as Record<string, unknown> | undefined,
          entityId: item.entityId,
          entityType: item.entityType
            ? (item.entityType as unknown as ApiEntityType)
            : undefined,
          score: item.score,
          scoreBreakdown:
            item.scoreBreakdown as UnifiedGraphSearchResult['scoreBreakdown'],
          path:
            projection === SearchProjection.CompactRanked
              ? undefined
              : (item.path as UnifiedGraphSearchResult['path']),
          pathCount:
            projection === SearchProjection.CompactRanked
              ? undefined
              : item.pathCount,
        })),
      totalElements: response.totalElements,
      totalPages: response.totalPages,
      page: response.page,
      size: response.size,
      relationships:
        projection === SearchProjection.CompactRanked
          ? undefined
          : (response.relationships as UnifiedGraphSearchResponse['relationships']),
    };
  }

  private mapEmbeddingsResponse(
    response: EmbeddingsSearchResponse,
  ): UnifiedEmbeddingsSearchResponse {
    return {
      success: response.success,
      query: response.query,
      results: response.results,
      data: response.data
        ?.filter((item) => {
          const metadata = (item.metadata ?? null) as EmbeddingMetadata | null;
          if (!metadata?.type) {
            return true;
          }
          return !!this.toApiEntityType(metadata.type);
        })
        .map((item) => ({
          id: item.id,
          similarity: item.similarity,
          metadata: this.stripEmbeddingsMetadata(
            item.metadata as UnifiedEmbeddingsSearchResult['metadata'],
          ),
          chunkIndex: item.chunkIndex,
          matchType: item.matchType,
        })),
    };
  }

  private buildEmbeddingsContentMap(
    response: EmbeddingsSearchResponse,
  ): Map<string, string> {
    const contentByEntityId = new Map<string, string>();
    response.data?.forEach((item) => {
      const metadata = (item.metadata ?? null) as EmbeddingMetadata | null;
      if (!metadata?.id || !item.text) {
        return;
      }
      if (!contentByEntityId.has(metadata.id)) {
        contentByEntityId.set(metadata.id, item.text);
      }
    });
    return contentByEntityId;
  }

  private buildEmbeddingsTopologyMap(
    response: EmbeddingsSearchResponse,
  ): Map<string, string> {
    const topologyByEntityId = new Map<string, string>();
    response.data?.forEach((item) => {
      const metadata = (item.metadata ?? null) as EmbeddingMetadata | null;
      if (!metadata?.id) {
        return;
      }
      const topologySummary =
        metadata &&
        typeof metadata === 'object' &&
        'topologySummary' in metadata
          ? (metadata.topologySummary as string | undefined)
          : undefined;
      if (!topologySummary || topologySummary.trim().length === 0) {
        return;
      }
      if (!topologyByEntityId.has(metadata.id)) {
        topologyByEntityId.set(metadata.id, topologySummary);
      }
    });
    return topologyByEntityId;
  }

  private buildEmbeddingsTitleMap(
    response: EmbeddingsSearchResponse,
  ): Map<string, string> {
    const titleByEntityId = new Map<string, string>();
    response.data?.forEach((item) => {
      const metadata = (item.metadata ?? null) as EmbeddingMetadata | null;
      if (!metadata?.id) {
        return;
      }
      const name =
        metadata && typeof metadata === 'object' && 'name' in metadata
          ? (metadata.name as string | undefined)
          : undefined;
      const title =
        metadata && typeof metadata === 'object' && 'title' in metadata
          ? (metadata.title as string | undefined)
          : undefined;
      const resolved = name ?? title;
      if (!resolved || resolved.trim().length === 0) {
        return;
      }
      if (!titleByEntityId.has(metadata.id)) {
        titleByEntityId.set(metadata.id, resolved);
      }
    });
    return titleByEntityId;
  }

  private buildEmbeddingsSubfacets(
    response: EmbeddingsSearchResponse,
  ): string[] {
    const subfacets = new Set<string>();
    response.data?.forEach((item) => {
      const metadata = item.metadata as Record<string, unknown> | null;
      if (!metadata || typeof metadata !== 'object') {
        return;
      }
      this.addMetadataSubfacetValues(metadata.topologySubfacets, subfacets);
      this.addMetadataSubfacetValues(metadata.subfacets, subfacets);
    });
    return Array.from(subfacets);
  }

  private addMetadataSubfacetValues(value: unknown, target: Set<string>): void {
    if (typeof value === 'string') {
      const normalized = value.trim();
      if (normalized.length > 0) {
        target.add(normalized);
      }
      return;
    }
    if (!Array.isArray(value)) {
      return;
    }
    value.forEach((entry) => {
      if (typeof entry !== 'string') {
        return;
      }
      const normalized = entry.trim();
      if (normalized.length > 0) {
        target.add(normalized);
      }
    });
  }

  private stripEmbeddingsMetadata(
    metadata: UnifiedEmbeddingsSearchResult['metadata'] | undefined,
  ): UnifiedEmbeddingsSearchResult['metadata'] | undefined {
    if (!metadata || typeof metadata !== 'object') {
      return metadata;
    }
    const copy = { ...(metadata as Record<string, unknown>) };
    if ('topologySummary' in copy) {
      delete copy.topologySummary;
    }
    if ('title' in copy) {
      delete copy.title;
    }
    return copy as UnifiedEmbeddingsSearchResult['metadata'];
  }

  private attachEmbeddingsContentAndTopology(
    results: UnifiedSearchResult[] | undefined,
    embeddingsOutcome: EmbeddingsOutcome | undefined,
  ): void {
    if (!results || results.length === 0 || !embeddingsOutcome) {
      return;
    }

    for (const result of results) {
      if (!result.entityId) {
        continue;
      }
      if (!result.content) {
        const content = embeddingsOutcome.contentByEntityId.get(
          result.entityId,
        );
        if (content) {
          result.content = content;
        }
      }
      if (!result.topologySummary) {
        const topologySummary = embeddingsOutcome.topologyByEntityId.get(
          result.entityId,
        );
        if (topologySummary) {
          result.topologySummary = topologySummary;
        }
      }
      if (!result.title) {
        const title = embeddingsOutcome.titleByEntityId.get(result.entityId);
        if (title) {
          result.title = title;
        }
      }
    }
  }

  private attachEmbeddingsContentAndTopologyFromMaps(
    results: UnifiedSearchResult[] | undefined,
    contentByEntityId: Map<string, string>,
    topologyByEntityId: Map<string, string>,
    titleByEntityId: Map<string, string>,
  ): void {
    if (!results || results.length === 0) {
      return;
    }

    for (const result of results) {
      if (!result.entityId) {
        continue;
      }
      if (!result.content) {
        const content = contentByEntityId.get(result.entityId);
        if (content) {
          result.content = content;
        }
      }
      if (!result.topologySummary) {
        const topologySummary = topologyByEntityId.get(result.entityId);
        if (topologySummary) {
          result.topologySummary = topologySummary;
        }
      }
      if (!result.title) {
        const title = titleByEntityId.get(result.entityId);
        if (title) {
          result.title = title;
        }
      }
    }
  }

  private async attachContentForGraphOnlyResults(
    organizationId: OrganizationId,
    results?: UnifiedSearchResult[],
  ): Promise<void> {
    if (!results || results.length === 0) {
      return;
    }

    const graphOnly = results.filter((result) => {
      const sources = result.sources ?? [];
      return sources.includes('graph') && !sources.includes('embeddings');
    });

    if (graphOnly.length === 0) {
      return;
    }

    const taskIds = new Set<TaskId>();
    const initiativeIds = new Set<InitiativeId>();
    const designDocIds = new Set<DesignDocId>();

    for (const result of graphOnly) {
      if (!result.entityId || !result.entityType) {
        continue;
      }
      switch (result.entityType) {
        case ApiEntityType.Task:
          taskIds.add(result.entityId as TaskId);
          break;
        case ApiEntityType.Initiative:
          initiativeIds.add(result.entityId as InitiativeId);
          break;
        case ApiEntityType.DesignDoc:
          designDocIds.add(result.entityId as DesignDocId);
          break;
        default:
          break;
      }
    }

    const tasksById =
      taskIds.size > 0
        ? ((await this.taskService.findManyByIds(
            organizationId,
            Array.from(taskIds),
            WORK_ITEM_SECTION_KEYS,
          )) ?? new Map<TaskId, TaskResponseDto>())
        : new Map<TaskId, TaskResponseDto>();
    const initiativesById =
      initiativeIds.size > 0
        ? ((await this.initiativeService.findManyByIds(
            organizationId,
            Array.from(initiativeIds),
            WORK_ITEM_SECTION_KEYS,
          )) ?? new Map<InitiativeId, InitiativeResponseDto>())
        : new Map<InitiativeId, InitiativeResponseDto>();
    const designDocsById =
      designDocIds.size > 0
        ? ((await this.designDocService.findManyByIdsWithSections(
            organizationId,
            Array.from(designDocIds),
          )) ?? new Map<DesignDocId, DesignDocResponseDto>())
        : new Map<DesignDocId, DesignDocResponseDto>();

    for (const result of graphOnly) {
      if (!result.entityId || !result.entityType) {
        continue;
      }
      if (result.entityType === ApiEntityType.Task) {
        const task = tasksById.get(result.entityId as TaskId);
        if (!result.status && task?.status) {
          result.status = task.status;
        }
        if (!result.title && task?.name) {
          result.title = task.name;
        }
        const content = this.buildWorkItemContent(task?.sections, task?.type);
        if (content) {
          result.content = content;
        } else if (task) {
          delete result.content;
        }
        continue;
      }
      if (result.entityType === ApiEntityType.Initiative) {
        const initiative = initiativesById.get(result.entityId as InitiativeId);
        if (!result.status && initiative?.status) {
          result.status = initiative.status;
        }
        if (!result.title && initiative?.name) {
          result.title = initiative.name;
        }
        const content = this.buildWorkItemContent(initiative?.sections);
        if (content) {
          result.content = content;
        }
        continue;
      }
      if (result.entityType === ApiEntityType.DesignDoc) {
        const doc = designDocsById.get(result.entityId as DesignDocId);
        if (!result.status && doc?.status) {
          result.status = doc.status;
        }
        if (!result.title && doc?.name) {
          result.title = doc.name;
        }
        const content = this.buildDesignDocContent(doc?.sections);
        if (content) {
          result.content = content;
        }
      }
    }
  }

  private attachMessageTitles(results?: UnifiedSearchResult[]): void {
    for (const result of results ?? []) {
      if (result.entityType === ApiEntityType.Message && !result.title) {
        result.title = deriveMessageTitle(result.content);
      }
    }
  }

  private async attachTopologySummaryFromDatabase(
    organizationId: OrganizationId,
    projectId: ProjectId,
    results?: UnifiedSearchResult[],
  ): Promise<void> {
    if (!results || results.length === 0) {
      return;
    }

    const entities = results
      .filter(
        (result) =>
          result.entityId && result.entityType && !result.topologySummary,
      )
      .map((result) => ({
        entityId: result.entityId as string,
        entityType: this.toPrismaEntityType(result.entityType),
      }))
      .filter(
        (
          entity,
        ): entity is { entityId: string; entityType: PrismaEntityType } =>
          !!entity.entityType,
      );

    if (entities.length === 0) {
      return;
    }

    const summaries =
      await this.entitySummaryService.getCurrentSummariesForEntities({
        organizationId,
        projectId,
        entities,
      });
    const summaryByKey = new Map<
      string,
      { summary: string; updatedAt: Date }
    >();
    summaries.forEach((summary) => {
      const key = `${summary.entityType}:${summary.entityId}`;
      const existing = summaryByKey.get(key);
      if (!existing || summary.updatedAt > existing.updatedAt) {
        summaryByKey.set(key, {
          summary: summary.summary,
          updatedAt: summary.updatedAt,
        });
      }
    });

    results.forEach((result) => {
      if (!result.entityId || !result.entityType || result.topologySummary) {
        return;
      }
      const entityType = this.toPrismaEntityType(result.entityType);
      if (!entityType) {
        return;
      }
      const summary = summaryByKey.get(
        `${entityType}:${result.entityId as string}`,
      );
      if (summary) {
        result.topologySummary = summary.summary;
      }
    });
  }

  private buildWorkItemContent(
    sections?: MaterializedWorkItemSection[],
    taskType?: string,
  ): string | undefined {
    if (!sections || sections.length === 0) {
      return undefined;
    }

    const contentMap = materializedSectionsToContentMap(sections);
    let requirements = contentMap.requirements;
    if (taskType === WORK_ITEM_TYPE_KEYS.Feature) {
      try {
        requirements =
          formatFeatureRequirementsForDiscovery(
            sections.find((section) => section.key === 'requirements')
              ?.materializedMarkdown,
          ) ?? '';
      } catch (error) {
        this.logger.error(
          'buildWorkItemContent: invalid feature requirements',
          {
            taskType,
            code:
              error instanceof FeatureRequirementsReadError
                ? error.code
                : 'unknown',
            diagnostic: error instanceof Error ? error.message : String(error),
          },
        );
        throw error;
      }
    }
    const parts = [
      contentMap.description,
      contentMap.details,
      contentMap.acceptanceCriteria,
      requirements,
    ].filter((value) => value.trim().length > 0);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join('\n\n');
  }

  private buildDesignDocContent(
    sections?: MaterializedDesignDocSection[],
  ): string | undefined {
    if (!sections || sections.length === 0) {
      return undefined;
    }

    const parts = sections
      .map((section) => section.materializedMarkdown.trim())
      .filter((value) => value.length > 0);
    if (parts.length === 0) {
      return undefined;
    }
    return parts.join('\n\n');
  }

  private mapServiceError(error: unknown, service: 'graph' | 'embeddings') {
    const axiosError = error as AxiosError;
    const status = axiosError?.response?.status;
    const code = axiosError?.code;

    if (code === 'ECONNABORTED') {
      return new GatewayTimeoutException(
        `${service} service timed out processing the request`,
      );
    }

    switch (status) {
      case 400:
        return new BadRequestException(`${service} service rejected the query`);
      case 401:
        return new UnauthorizedException(
          `${service} service rejected authentication`,
        );
      case 403:
        return new ForbiddenException(
          `${service} service rejected authorization`,
        );
      case 404:
        return new NotFoundException(`${service} service endpoint not found`);
      case 429:
        return new HttpException(
          `${service} service rate limit exceeded`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      case 504:
        return new GatewayTimeoutException(
          `${service} service timed out processing the request`,
        );
      case 502:
      case 503:
      case 500:
        return new BadGatewayException(
          `${service} service failed to process the request`,
        );
      default:
        break;
    }

    return new ServiceUnavailableException(`${service} service is unavailable`);
  }

  private isSupportedIntent(intent: string): boolean {
    return (
      intent === 'relationship' || intent === 'semantic' || intent === 'hybrid'
    );
  }

  private async logSearchResult(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
    response: UnifiedSearchResponse,
    context?: SearchLogContext,
  ): Promise<void> {
    if (!this.isSearchLoggingEnabled()) {
      return;
    }

    try {
      const conversationId = await this.resolveLogConversationId(
        organizationId,
        projectId,
        request,
      );
      const messageId = await this.resolveLogMessageId(
        projectId,
        conversationId,
        request,
      );

      await this.prisma.db.unifiedSearchLog.create({
        data: {
          organizationId,
          projectId,
          conversationId,
          messageId,
          requestId:
            this.normalizeOptionalId(context?.persistedRequestId) ??
            this.normalizeOptionalId(request.requestId),
          intent: response.intent,
          query: response.query,
          requestPayload: this.toJsonValue(context?.requestPayload ?? request),
          graphResponse: this.toNullableJsonValue(response.graph),
          embeddingsResponse: this.toNullableJsonValue(response.embeddings),
          unifiedResponse: this.toJsonValue({
            ...response,
            logStage: context?.logStage ?? 'single',
          }),
        },
      });
    } catch (error) {
      this.logger.error('Failed to log unified search result', {
        error: errorToLoggable(error),
        organizationId,
        projectId,
        requestId: request.requestId,
      });
    }
  }

  private async logBatchSearchResult(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedBatchSearchRequest,
    response: UnifiedBatchSearchResponse,
    batchRequestId: string,
  ): Promise<void> {
    if (!this.isSearchLoggingEnabled()) {
      return;
    }

    try {
      await this.prisma.db.unifiedSearchLog.create({
        data: {
          organizationId,
          projectId,
          conversationId: null,
          messageId: null,
          requestId: batchRequestId,
          intent: 'batch',
          query: null,
          requestPayload: this.toJsonValue({
            batch: {
              requestId: batchRequestId,
              queryCount: request.queries.length,
              logStage: 'batch_final',
            },
            request,
          }),
          graphResponse: Prisma.JsonNull,
          embeddingsResponse: Prisma.JsonNull,
          unifiedResponse: this.toJsonValue({
            ...response,
            logStage: 'batch_final',
          }),
        },
      });
    } catch (error) {
      this.logger.error('Failed to log unified batch search result', {
        error: errorToLoggable(error),
        organizationId,
        projectId,
        requestId: batchRequestId,
      });
    }
  }

  private normalizeOptionalId(value?: string | null): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
  }

  private resolveBatchRequestId(request: UnifiedBatchSearchRequest): string {
    const normalizedRequestIds = request.queries
      .map((query) => this.normalizeOptionalId(query.requestId))
      .filter((requestId): requestId is string => requestId !== null);
    if (normalizedRequestIds.length === 0) {
      return this.buildBatchRequestId();
    }

    const uniqueRequestIds = new Set(normalizedRequestIds);
    if (uniqueRequestIds.size === 1) {
      const onlyRequestId = uniqueRequestIds.values().next().value;
      if (onlyRequestId) {
        return onlyRequestId;
      }
    }

    const generatedBatchRequestId = this.buildBatchRequestId();
    this.logger.warn(
      `Batch search request contained ${uniqueRequestIds.size} distinct requestId values; using generated batch requestId ${generatedBatchRequestId} for logging correlation`,
    );
    return generatedBatchRequestId;
  }

  private buildBatchRequestId(): string {
    return `${GENERATED_BATCH_REQUEST_ID_PREFIX}_${Date.now()}_${randomUUID().slice(0, 8)}`;
  }

  private async resolveLogConversationId(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: UnifiedSearchRequest,
  ): Promise<string | null> {
    const conversationId = this.normalizeOptionalId(request.conversationId);
    if (!conversationId) {
      return null;
    }

    const conversation = await this.prisma.db.conversation.findFirst({
      where: {
        id: conversationId,
        organizationId,
        projectId,
      },
      select: { id: true },
    });

    if (conversation) {
      return conversationId;
    }

    this.logger.warn(
      `Skipping unified search log conversationId ${conversationId} because it was not found in organization/project scope`,
    );
    return null;
  }

  private async resolveLogMessageId(
    projectId: ProjectId,
    conversationId: string | null,
    request: UnifiedSearchRequest,
  ): Promise<string | null> {
    const messageId = this.normalizeOptionalId(request.messageId);
    if (!messageId) {
      return null;
    }

    const message = await this.prisma.db.message.findFirst({
      where: {
        id: messageId,
        projectId,
        ...(conversationId ? { conversationId } : {}),
      },
      select: { id: true },
    });

    if (message) {
      return messageId;
    }

    this.logger.warn(
      `Skipping unified search log messageId ${messageId} because it was not found in project scope`,
    );
    return null;
  }

  private isSearchLoggingEnabled(): boolean {
    return process.env.UNIFIED_SEARCH_LOGS_ENABLED === 'true';
  }

  private toJsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private toNullableJsonValue(
    value: unknown,
  ): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput {
    if (value === undefined || value === null) {
      return Prisma.JsonNull;
    }
    return this.toJsonValue(value);
  }
}

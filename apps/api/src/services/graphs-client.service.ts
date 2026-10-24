import { Injectable, Logger } from '@nestjs/common';
import type { AxiosResponse } from 'axios';
import { firstValueFrom } from 'rxjs';
import {
  CreateHintDto,
  EntityNeighborhoodRequest,
  GraphQueryRequest,
  GraphQueryResponse,
  FindHintsByConnectedItemsRequest,
  FindHintsByConnectedItemsResponse,
  Hint,
  HintConnectionInput,
  EntityNeighborhoodResponse,
  IncidentEdgesRequest,
  IncidentEdgesResponse,
  ProjectionDeletionCommand,
  ProjectionDeletionResult,
  SearchRequest,
  SearchResponse,
  StructuredGraphReadRequest,
  StructuredGraphReadResponse,
  SearchProjection,
  SeedSearchResult,
  TopologyGraphResponse,
} from 'src/generated/graphs';
import { HintsService } from 'src/generated/graphs/api/hints.service';
import { LifecycleService } from 'src/generated/graphs/api/lifecycle.service';
import { QueriesService } from 'src/generated/graphs/api/queries.service';
import { OrganizationId, ProjectId } from 'src/types';
import { errorToLoggable } from 'src/utils/logging.util';

@Injectable()
export class GraphsClientService {
  private readonly logger = new Logger(GraphsClientService.name);
  private static readonly ENTITY_GRAPH_PAGE_SIZE = 500;

  constructor(
    private readonly queriesService: QueriesService,
    private readonly lifecycleService: LifecycleService,
    private readonly hintsService: HintsService,
  ) {}

  private userAuthConfig(userToken: string) {
    return {
      config: {
        headers: {
          Authorization: `Bearer ${userToken}`,
          'X-API-Auth': `Bearer ${userToken}`,
          'Content-Type': 'application/json',
        },
      },
    };
  }

  async listProjectHints(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userToken: string,
  ) {
    const response = await firstValueFrom(
      this.hintsService.listProjectHints(
        organizationId,
        projectId,
        this.userAuthConfig(userToken),
      ),
    );
    return response.data;
  }

  async createHint(
    organizationId: OrganizationId,
    projectId: ProjectId,
    dto: CreateHintDto,
    userToken: string,
  ): Promise<Hint> {
    const response = await firstValueFrom<AxiosResponse<Hint>>(
      this.hintsService.createHint(
        organizationId,
        projectId,
        dto,
        this.userAuthConfig(userToken),
      ),
    );
    return response.data;
  }

  async addHintConnection(
    organizationId: OrganizationId,
    projectId: ProjectId,
    hintId: string,
    connection: HintConnectionInput,
    userToken: string,
  ): Promise<Hint> {
    const response = await firstValueFrom<AxiosResponse<Hint>>(
      this.hintsService.addHintConnection(
        organizationId,
        projectId,
        hintId,
        connection,
        this.userAuthConfig(userToken),
      ),
    );
    return response.data;
  }

  async getHint(
    organizationId: OrganizationId,
    projectId: ProjectId,
    hintId: string,
    userToken: string,
  ): Promise<Hint> {
    const response = await firstValueFrom<AxiosResponse<Hint>>(
      this.hintsService.getHint(
        organizationId,
        projectId,
        hintId,
        this.userAuthConfig(userToken),
      ),
    );
    return response.data;
  }

  async findHintsByConnectedItems(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: FindHintsByConnectedItemsRequest,
    userToken: string,
  ): Promise<FindHintsByConnectedItemsResponse> {
    const response = await firstValueFrom<
      AxiosResponse<FindHintsByConnectedItemsResponse>
    >(
      this.hintsService.findHintsByConnectedItems(
        organizationId,
        projectId,
        request,
        this.userAuthConfig(userToken),
      ),
    );
    return response.data;
  }

  async deleteOrganizationProjection(
    command: ProjectionDeletionCommand,
    systemToken: string,
  ): Promise<ProjectionDeletionResult> {
    if (!systemToken) {
      throw new Error('Graph projection deletion requires a system token');
    }

    try {
      const response = await firstValueFrom<
        AxiosResponse<ProjectionDeletionResult>
      >(
        this.lifecycleService.deleteOrganizationProjection(
          command.organizationId,
          command,
          {
            config: {
              headers: {
                Authorization: `Bearer ${systemToken}`,
                'Content-Type': 'application/json',
              },
            },
          },
        ),
      );
      return response.data;
    } catch (error) {
      this.logger.error('Failed to delete organization graph projection', {
        error: errorToLoggable(error),
        organizationId: command.organizationId,
        markerId: command.markerId,
      });
      throw error;
    }
  }

  async readStructuredGraph(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: StructuredGraphReadRequest,
    userToken: string,
  ): Promise<StructuredGraphReadResponse> {
    const response = await this.searchGraph(
      organizationId,
      projectId,
      {
        projection: SearchProjection.StructuredRead,
        structuredRead: request,
      },
      userToken,
    );
    if (!response.structuredRead) {
      throw new Error('Graph returned no structured read response');
    }
    return response.structuredRead;
  }

  async searchGraph(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: SearchRequest,
    userToken: string,
  ): Promise<SearchResponse> {
    if (!userToken) {
      throw new Error('Graph search requires a user token');
    }

    try {
      const response = await firstValueFrom<AxiosResponse<SearchResponse>>(
        this.queriesService.traverseGraph(organizationId, projectId, request, {
          config: {
            headers: {
              Authorization: `Bearer ${userToken}`,
              'X-API-Auth': `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to search graph', {
        error: errorToLoggable(error),
        seedEntityIds: request.seedEntityIds?.length ?? 0,
        seedNodeIds: request.seedNodeIds?.length ?? 0,
      });
      throw error;
    }
  }

  async executeQuery(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: GraphQueryRequest,
    systemToken: string,
  ): Promise<GraphQueryResponse> {
    const response = await firstValueFrom<AxiosResponse<GraphQueryResponse>>(
      this.queriesService.executeQuery(organizationId, projectId, request, {
        config: {
          headers: {
            Authorization: `Bearer ${systemToken}`,
            'X-API-Auth': `Bearer ${systemToken}`,
            'Content-Type': 'application/json',
          },
        },
      }),
    );
    return response.data;
  }

  async readIncidentEdges(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: IncidentEdgesRequest,
    userToken: string,
  ): Promise<IncidentEdgesResponse> {
    if (!userToken) {
      throw new Error('Graph incident reads require a user token');
    }
    const response = await firstValueFrom<AxiosResponse<IncidentEdgesResponse>>(
      this.queriesService.readIncidentEdges(
        organizationId,
        projectId,
        request,
        {
          config: {
            headers: {
              Authorization: `Bearer ${userToken}`,
              'X-API-Auth': `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
          },
        },
      ),
    );
    return response.data;
  }

  async getTopologyGraph(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userToken: string | null,
  ): Promise<TopologyGraphResponse> {
    if (!userToken) {
      throw new Error('Graph topology requires a user token');
    }

    try {
      const response = await firstValueFrom<
        AxiosResponse<TopologyGraphResponse>
      >(
        this.queriesService.getTopologyGraph(organizationId, projectId, {
          config: {
            headers: {
              Authorization: `Bearer ${userToken}`,
              'X-API-Auth': `Bearer ${userToken}`,
              'Content-Type': 'application/json',
            },
          },
        }),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch topology graph', {
        error: errorToLoggable(error),
        organizationId,
        projectId,
      });
      throw error;
    }
  }

  async getEntityNeighborhood(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: EntityNeighborhoodRequest,
    userToken: string | null,
  ): Promise<EntityNeighborhoodResponse> {
    if (!userToken) {
      throw new Error('Entity neighborhood requires a user token');
    }

    try {
      const response = await firstValueFrom<
        AxiosResponse<EntityNeighborhoodResponse>
      >(
        this.queriesService.getEntityNeighborhood(
          organizationId,
          projectId,
          request,
          {
            config: {
              headers: {
                Authorization: `Bearer ${userToken}`,
                'X-API-Auth': `Bearer ${userToken}`,
                'Content-Type': 'application/json',
              },
            },
          },
        ),
      );

      return response.data;
    } catch (error) {
      this.logger.error('Failed to fetch entity neighborhood', {
        error: errorToLoggable(error),
        seedEntityId: request.seedEntityId,
        seedEntityType: request.seedEntityType,
      });
      throw error;
    }
  }

  async getEntityGraph(
    organizationId: OrganizationId,
    projectId: ProjectId,
    entityId: string,
    depth: number,
    userToken: string | null,
  ): Promise<SearchResponse> {
    if (!userToken) {
      throw new Error('Graph traversal requires a user token');
    }

    const trimmedEntityId = entityId.trim();
    if (!trimmedEntityId) {
      throw new Error('entityId is required');
    }

    const requestBase: SearchRequest = {
      seedEntityIds: [trimmedEntityId],
      traversal: { depth },
      includeRelationships: true,
      includeSeedEntities: true,
      trackPathCount: true,
      size: GraphsClientService.ENTITY_GRAPH_PAGE_SIZE,
    };

    return this.searchGraphAllPages(
      organizationId,
      projectId,
      {
        ...requestBase,
        page: 0,
      },
      userToken,
    );
  }

  async searchGraphAllPages(
    organizationId: OrganizationId,
    projectId: ProjectId,
    request: SearchRequest,
    userToken: string,
  ): Promise<SearchResponse> {
    const requestBase: SearchRequest = {
      ...request,
      page: 0,
      size: request.size ?? GraphsClientService.ENTITY_GRAPH_PAGE_SIZE,
    };

    const firstPage = await this.searchGraph(
      organizationId,
      projectId,
      requestBase,
      userToken,
    );
    const aggregateResults = [...(firstPage.results ?? [])];
    const relationshipByKey = new Map<
      string,
      NonNullable<SearchResponse['relationships']>[number]
    >();
    const seedResultBySeedNodeId = new Map<
      string,
      {
        results: NonNullable<SeedSearchResult['results']>;
        relationshipByKey: Map<
          string,
          NonNullable<SeedSearchResult['relationships']>[number]
        >;
      }
    >();

    const mergeSeedResults = (seedResults?: SearchResponse['seedResults']) => {
      for (const seedResult of seedResults ?? []) {
        const seedNodeId = seedResult.seedNodeId;
        if (!seedNodeId) {
          continue;
        }

        const current = seedResultBySeedNodeId.get(seedNodeId) ?? {
          results: [],
          relationshipByKey: new Map<
            string,
            NonNullable<SeedSearchResult['relationships']>[number]
          >(),
        };
        current.results.push(...(seedResult.results ?? []));
        for (const relationship of seedResult.relationships ?? []) {
          current.relationshipByKey.set(
            JSON.stringify(relationship),
            relationship,
          );
        }
        seedResultBySeedNodeId.set(seedNodeId, current);
      }
    };

    for (const relationship of firstPage.relationships ?? []) {
      relationshipByKey.set(JSON.stringify(relationship), relationship);
    }
    mergeSeedResults(firstPage.seedResults);

    const totalPages = Math.max(firstPage.totalPages ?? 1, 1);
    for (let page = 1; page < totalPages; page += 1) {
      const pageResponse = await this.searchGraph(
        organizationId,
        projectId,
        {
          ...request,
          page,
          size: requestBase.size,
        },
        userToken,
      );

      aggregateResults.push(...(pageResponse.results ?? []));
      for (const relationship of pageResponse.relationships ?? []) {
        relationshipByKey.set(JSON.stringify(relationship), relationship);
      }
      mergeSeedResults(pageResponse.seedResults);
    }

    return {
      results: aggregateResults,
      seedResults: Array.from(seedResultBySeedNodeId.entries()).map(
        ([seedNodeId, value]) => ({
          seedNodeId,
          results: value.results,
          relationships: Array.from(value.relationshipByKey.values()),
          totalElements: value.results.length,
          totalPages: 1,
          page: 0,
          size: value.results.length,
        }),
      ),
      relationships: Array.from(relationshipByKey.values()),
      totalElements: firstPage.totalElements ?? aggregateResults.length,
      totalPages: 1,
      page: 0,
      size: aggregateResults.length,
    };
  }
}

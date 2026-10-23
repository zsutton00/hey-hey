import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { EntityType } from 'src/generated';
import { SearchRequest, SearchResponse } from 'src/generated/graphs';
import { GraphsClientService } from 'src/services/graphs-client.service';
import { OrganizationId, ProjectId } from 'src/types';
import { errorToLoggable } from 'src/utils/logging.util';
import {
  buildGraphStatusHints,
  buildGraphTitleHints,
  buildGraphUpdatedAtHints,
  indexSeedResultsByKey,
} from './activity-correlation.graph-mappers';
import { RecentSeedPage } from './activity-correlation.types';

type TraversalContext = {
  response: SearchResponse;
  seedResultsByKey: Map<
    string,
    NonNullable<SearchResponse['seedResults']>[number]
  >;
  titleHints: Map<string, string>;
  statusHints: Map<string, string>;
  updatedAtHints: Map<string, string>;
};

@Injectable()
export class ActivityCorrelationTraversalService {
  private readonly logger = new Logger(
    ActivityCorrelationTraversalService.name,
  );
  private static readonly GRAPH_TRAVERSAL_DEPTH = 1;
  private static readonly GRAPH_PAGE_SIZE = 200;

  constructor(private readonly graphsClientService: GraphsClientService) {}

  async fetchSeedNeighborhoods(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    seedPage: RecentSeedPage;
    userToken: string | null;
  }): Promise<TraversalContext> {
    if (!params.userToken) {
      throw new BadRequestException('Graph traversal requires an auth token');
    }

    const request = this.buildRecentGraphRequest(params.seedPage);

    let response: SearchResponse;
    try {
      response = await this.graphsClientService.searchGraphAllPages(
        params.organizationId,
        params.projectId,
        request,
        params.userToken,
      );
    } catch (error) {
      this.logger.error('Recent activity graph traversal failed', {
        error: errorToLoggable(error),
        organizationId: params.organizationId,
        projectId: params.projectId,
        seedCount: params.seedPage.seeds.length,
      });
      throw new BadGatewayException(
        'Failed to load related graph context for recent activity',
      );
    }

    return {
      response,
      seedResultsByKey: indexSeedResultsByKey(params.seedPage, response),
      titleHints: buildGraphTitleHints(response),
      statusHints: buildGraphStatusHints(response),
      updatedAtHints: buildGraphUpdatedAtHints(response),
    };
  }

  private buildRecentGraphRequest(seedPage: RecentSeedPage): SearchRequest {
    const hasTaskSeed = seedPage.seeds.some(
      (seed) => seed.entityType === EntityType.Task,
    );

    return {
      seedEntityIds: seedPage.seeds.map((seed) => seed.entityId),
      traversal: {
        direction: 'BOTH',
        depth: ActivityCorrelationTraversalService.GRAPH_TRAVERSAL_DEPTH,
        ...(hasTaskSeed
          ? {
              pathExpansions: [
                {
                  seedEntityTypes: ['TASK'],
                  relationshipChain: [
                    { type: 'HAS_AGENT_SESSION', direction: 'OUTGOING' },
                    { type: 'ABOUT', direction: 'INCOMING' },
                  ],
                },
              ],
            }
          : {}),
      },
      includeRelationships: true,
      includeSeedEntities: true,
      trackPathCount: true,
      groupResultsBySeed: true,
      page: 0,
      size: ActivityCorrelationTraversalService.GRAPH_PAGE_SIZE,
    } satisfies SearchRequest;
  }
}

export type { TraversalContext };

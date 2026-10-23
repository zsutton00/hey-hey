import { Injectable, Logger } from '@nestjs/common';
import { AgentSessionType, EntityType } from 'src/generated';
import { SearchResult } from 'src/generated/graphs';
import {
  buildConversationIdsByEntityId,
  buildGraphLinkedEntitiesBySeed,
} from 'src/services/activity-correlation-graph-links.mapper';
import {
  dedupeReportIds,
  RecentActivityCorrelationRecordDraft,
  RecentSeedPage,
  toEntityKey,
} from './activity-correlation.types';
import {
  buildAgentSessionTypeMap,
  isRecentAllowedEntityType,
} from './activity-correlation.graph-mappers';
import { TraversalContext } from './activity-correlation-traversal.service';

@Injectable()
export class ActivityCorrelationRecordAssemblerService {
  private readonly logger = new Logger(
    ActivityCorrelationRecordAssemblerService.name,
  );

  assembleRecentRecords(
    seedPage: RecentSeedPage,
    traversal: TraversalContext,
  ): RecentActivityCorrelationRecordDraft[] {
    const linkedEntitiesBySeed = buildGraphLinkedEntitiesBySeed(
      seedPage.seeds,
      traversal.response,
    );
    const conversationsByEntityId = buildConversationIdsByEntityId(
      traversal.response,
    );
    const agentSessionTypeMap = buildAgentSessionTypeMap(traversal.response);

    return seedPage.seeds.map((seed) => {
      const seedKey = toEntityKey(seed);
      const ranking = seedPage.rankingMetadataBySeed.get(seedKey);
      const seedGroup = traversal.seedResultsByKey.get(seedKey);
      const linkedEntities = linkedEntitiesBySeed.get(seedKey) ?? [];
      const conversationId =
        ranking?.conversationId ??
        conversationsByEntityId.get(seed.entityId) ??
        null;
      const sessionType =
        seed.entityType === EntityType.AgentSession
          ? (agentSessionTypeMap.get(seed.entityId) as
              | AgentSessionType
              | undefined)
          : undefined;

      return {
        entityId: seed.entityId,
        entityType: seed.entityType,
        timestamp: ranking?.timestamp ?? new Date(0).toISOString(),
        title: traversal.titleHints.get(seedKey),
        updatedAt: traversal.updatedAtHints.get(seedKey),
        status: traversal.statusHints.get(seedKey),
        conversationId,
        ...(sessionType ? { sessionType } : {}),
        linkedEntities: linkedEntities
          .filter((linkedEntity) =>
            isRecentAllowedEntityType(linkedEntity.entityType),
          )
          .filter(
            (linkedEntity) =>
              linkedEntity.entityType !== EntityType.Conversation,
          )
          .map((linkedEntity) => ({
            entityId: linkedEntity.entityId,
            entityType: linkedEntity.entityType,
            linkType: linkedEntity.linkType,
            status: linkedEntity.status,
            updatedAt: linkedEntity.updatedAt,
            ...(linkedEntity.entityType === EntityType.AgentSession
              ? {
                  conversationId:
                    conversationsByEntityId.get(linkedEntity.entityId) ?? null,
                }
              : {}),
          })),
        reportIds: dedupeReportIds(
          (seedGroup?.results ?? [])
            .filter(
              (result: SearchResult) =>
                result.entityType?.toString().toUpperCase() ===
                EntityType.Report,
            )
            .map((result: SearchResult) => result.entityId?.trim())
            .filter(
              (entityId: string | undefined): entityId is string => !!entityId,
            ),
        ),
        reports: [],
      };
    });
  }
}

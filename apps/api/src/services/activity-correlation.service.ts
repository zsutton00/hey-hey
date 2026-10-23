import { hydrateActivityHistoryMetadata } from './activity-correlation/activity-history-metadata';
import {
  BadRequestException,
  BadGatewayException,
  forwardRef,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentSessionStatus as PrismaAgentSessionStatus,
  EntityType as PrismaEntityType,
  Prisma,
  ReportAudience as PrismaReportAudience,
  WorkStatus,
} from '@prisma/client';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationLinkedEntityDto,
  ActivityCorrelationLinkType,
  ActivityCorrelationMode,
  ActivityCorrelationRecordDto,
  ActivityCorrelationSource,
  AgentSessionType,
  EntityType,
  MessageResponseDto,
  PayloadType,
  RecentActivityCorrelationRecordDto,
  ReportDto,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  SystemEventPayload,
} from 'src/generated';
import { DomainEventPublisher } from 'src/core/events/domain-event-publisher';
import { SystemLifecycleEvent } from 'src/core/events/types/domain-events';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { DOMAIN_EVENT_PUBLISHER_TOKEN } from 'src/core/events/tokens';
import {
  GraphRelationship,
  RelationshipType as GraphRelationshipType,
  SearchRequest,
  SearchResult,
  SearchResponse,
} from 'src/generated/graphs';
import { prismaMessageResultToResponseDto } from 'src/mappers/message.mapper';
import { PrismaService } from 'src/prisma/prisma.service';
import { buildGraphLinkedEntitiesBySeed } from 'src/services/activity-correlation-graph-links.mapper';
import { ActivityCorrelationAugmentationService } from 'src/services/activity-correlation/activity-correlation-augmentation.service';
import { ActivityCorrelationRecordAssemblerService } from 'src/services/activity-correlation/activity-correlation-record-assembler.service';
import { ActivityCorrelationSeedSelectorService } from 'src/services/activity-correlation/activity-correlation-seed-selector.service';
import { ActivityCorrelationTraversalService } from 'src/services/activity-correlation/activity-correlation-traversal.service';
import {
  CorrelatedActivityResult,
  EntityRef,
  RecentActivityQuery,
  RecentCorrelatedActivityResult,
  ActivityCorrelationLinkedEntityDraft,
  ActivityCorrelationRecordDraft,
} from 'src/services/activity-correlation/activity-correlation.types';
import { GraphsClientService } from 'src/services/graphs-client.service';
import { ReportService } from 'src/services/reports/report.service';
import { USER_VISIBLE_PERSISTED_REPORT_AUDIENCES } from 'src/services/reports/report-audience';
import { WorkflowId, OrganizationId, ProjectId, UserId } from 'src/types';
import { MessageQueryResult } from 'src/services/types';
import { errorToLoggable } from 'src/utils/logging.util';
import { DEFAULT_AGENT_SESSION_TITLE } from 'src/services/agent-session-title';
import { TIMELINE_MESSAGE_WHERE } from 'src/utils/message-timeline.util';

type LinkedEntityRef = EntityRef & {
  linkType: ActivityCorrelationLinkType;
  status?: string;
  updatedAt?: string;
};

type CorrelatedActivityQuery = {
  entityId: string;
  entityType: EntityType;
  userId: UserId;
  activityMode?: ActivityCorrelationMode;
  activityTypes?: ActivityCorrelationActivityType[];
  sources?: ActivityCorrelationSource[];
  since?: Date;
  until?: Date;
  limit: number;
  offset: number;
};

type AgentSessionCorrelationResult = {
  records: ActivityCorrelationRecordDraft[];
  completedTaskIds: Set<string>;
};

@Injectable()
export class ActivityCorrelationService {
  private readonly logger = new Logger(ActivityCorrelationService.name);
  private readonly publishedCorrelationFingerprints = new Map<string, number>();

  private static readonly MAX_FETCH_MULTIPLIER = 5;
  private static readonly MAX_RAW_FETCH = 1000;
  private static readonly GRAPH_TRAVERSAL_DEPTH = 1;
  private static readonly GRAPH_PAGE_SIZE = 200;
  private static readonly CORRELATION_VISIBLE_REPORT_AUDIENCES: PrismaReportAudience[] =
    USER_VISIBLE_PERSISTED_REPORT_AUDIENCES;
  private static readonly PUBLISHED_FINGERPRINT_TTL_MS = 30 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(DOMAIN_EVENT_PUBLISHER_TOKEN)
    private readonly eventPublisher: DomainEventPublisher,
    @Inject(forwardRef(() => ReportService))
    private readonly reportService: ReportService,
    private readonly graphsClientService: GraphsClientService,
    private readonly recentSeedSelector: ActivityCorrelationSeedSelectorService,
    private readonly recentTraversalService: ActivityCorrelationTraversalService,
    private readonly recentRecordAssembler: ActivityCorrelationRecordAssemblerService,
    private readonly recentAugmentationService: ActivityCorrelationAugmentationService,
  ) {}

  /**
   * Hydrate records produced by another Activity evidence selector through the
   * same canonical title and status paths used by the seeded Activity endpoint.
   * History metadata never requires loading conversation messages.
   */
  async hydrateCanonicalActivityRecords(
    organizationId: OrganizationId,
    records: ActivityCorrelationRecordDraft[],
  ): Promise<ActivityCorrelationRecordDto[]> {
    const titled = await this.hydrateRecordTitles(organizationId, records);
    const withStatuses = await this.attachEntityStatuses(
      organizationId,
      titled,
    );
    return hydrateActivityHistoryMetadata(
      this.prisma,
      organizationId,
      withStatuses,
    );
  }

  /**
   * Assemble the canonical Activity streams for an authorized organization /
   * project scope. Cross-project readers use this instead of attempting to
   * reconstruct attention, report, dependency, and completed-session records
   * from metric evidence.
   */
  async assembleOrganizationActivityRecords(
    organizationId: OrganizationId,
    scope: {
      projectIds: readonly ProjectId[];
      windowStart: Date;
      windowEnd: Date;
      attentionUserId?: UserId;
      selectedUserId?: UserId;
      includeAttention?: boolean;
    },
  ): Promise<ActivityCorrelationRecordDraft[]> {
    if (scope.projectIds.length === 0) {
      return [];
    }

    const projectIds = [...scope.projectIds];
    const activityWindow = {
      gte: scope.windowStart,
      lt: scope.windowEnd,
    };
    const [attentionEvents, agentSessions, reports] = await Promise.all([
      scope.includeAttention && scope.attentionUserId
        ? this.prisma.db.attentionEvent.findMany({
            where: {
              organizationId,
              userId: scope.attentionUserId,
              projectId: { in: projectIds },
              focusEnd: activityWindow,
            },
            orderBy: [{ focusEnd: 'desc' }, { id: 'desc' }],
            take: ActivityCorrelationService.MAX_RAW_FETCH,
            select: {
              entityId: true,
              entityType: true,
              projectId: true,
              focusEnd: true,
            },
          })
        : [],
      this.prisma.db.agentSession.findMany({
        where: {
          organizationId,
          projectId: { in: projectIds },
          ...(scope.selectedUserId ? { userId: scope.selectedUserId } : {}),
          status: PrismaAgentSessionStatus.COMPLETED,
          updatedAt: activityWindow,
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: ActivityCorrelationService.MAX_RAW_FETCH,
        select: {
          id: true,
          type: true,
          updatedAt: true,
          projectId: true,
          userId: true,
          entityType: true,
          entityId: true,
          serviceRelations: { select: { serviceId: true } },
          conversationId: true,
        },
      }),
      this.prisma.db.report.findMany({
        where: {
          organizationId,
          projectId: { in: projectIds },
          expiresAt: { gt: new Date() },
          audience: {
            in: ActivityCorrelationService.CORRELATION_VISIBLE_REPORT_AUDIENCES,
          },
          createdAt: activityWindow,
        },
        include: {
          reportEntities: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: ActivityCorrelationService.MAX_RAW_FETCH,
      }),
    ]);

    const attentionRecords = attentionEvents.flatMap((event) => {
      if (!event.projectId) {
        return [];
      }
      const entityType = this.fromStringEntityType(event.entityType);
      return [
        {
          eventActorUserId: scope.attentionUserId,
          entityId: event.entityId,
          entityType,
          projectId: event.projectId as ProjectId,
          type: ActivityCorrelationActivityType.Viewed,
          source: ActivityCorrelationSource.AttentionEvent,
          timestamp: event.focusEnd.toISOString(),
          linkedEntities: [
            {
              entityId: event.entityId,
              entityType,
              linkType: ActivityCorrelationLinkType.Self,
            },
          ],
          reports: [],
        } satisfies ActivityCorrelationRecordDraft,
      ];
    });

    const completedTaskIds = new Set(
      agentSessions.flatMap((session) =>
        session.entityType === EntityType.Task && session.entityId
          ? [session.entityId]
          : [],
      ),
    );
    const dependencies = await this.prisma.db.taskDependency.findMany({
      where: {
        dependencyTask: { projectId: { in: projectIds } },
        dependentTask: { projectId: { in: projectIds } },
      },
      include: {
        dependencyTask: {
          select: { id: true, status: true, updatedAt: true, projectId: true },
        },
        dependentTask: {
          select: { id: true, status: true, updatedAt: true, projectId: true },
        },
      },
      orderBy: [
        { dependentTask: { updatedAt: 'desc' } },
        { dependencyTaskId: 'desc' },
        { dependentTaskId: 'desc' },
      ],
      take: ActivityCorrelationService.MAX_RAW_FETCH,
    });

    const agentSessionRecords = agentSessions.map((session) => {
      const linkedEntities: ActivityCorrelationLinkedEntityDraft[] = [
        {
          entityId: session.id,
          entityType: EntityType.AgentSession,
          linkType: ActivityCorrelationLinkType.Self,
          conversationId: session.conversationId,
        },
      ];
      if (session.entityId && session.entityType) {
        const linkedEntityType = this.fromStringEntityType(session.entityType);
        linkedEntities.push({
          entityId: session.entityId,
          entityType: linkedEntityType,
          linkType: ActivityCorrelationLinkType.Related,
        });
      }
      (session.serviceRelations ?? []).forEach(({ serviceId }) => {
        linkedEntities.push({
          entityId: serviceId,
          entityType: EntityType.Service,
          linkType: ActivityCorrelationLinkType.Related,
        });
      });

      return {
        eventActorUserId: session.userId as UserId,
        entityId: session.id,
        entityType: EntityType.AgentSession,
        projectId: session.projectId as ProjectId,
        type: ActivityCorrelationActivityType.AgentSessionCompleted,
        source: ActivityCorrelationSource.AgentSession,
        timestamp: session.updatedAt.toISOString(),
        linkedEntities: this.mergeLinkedEntities([], linkedEntities),
        reports: [],
        conversationId: session.conversationId,
        sessionType: session.type as AgentSessionType,
      } satisfies ActivityCorrelationRecordDraft;
    });

    const unblockedRecords = dependencies.flatMap((dependency) => {
      if (
        !this.isDependencyUnblocked(
          dependency.dependencyTask.status,
          completedTaskIds.has(dependency.dependencyTaskId),
        ) ||
        this.isTaskClosedStatus(dependency.dependentTask.status)
      ) {
        return [];
      }
      const timestamp = this.maxTimestamp(
        dependency.dependencyTask.updatedAt,
        dependency.dependentTask.updatedAt,
      );
      if (
        Date.parse(timestamp) < scope.windowStart.getTime() ||
        Date.parse(timestamp) >= scope.windowEnd.getTime()
      ) {
        return [];
      }

      return [
        {
          entityId: dependency.dependentTaskId,
          entityType: EntityType.Task,
          projectId: dependency.dependentTask.projectId as ProjectId,
          type: ActivityCorrelationActivityType.Unblocked,
          source: ActivityCorrelationSource.TaskRelationship,
          timestamp,
          linkedEntities: [
            {
              entityId: dependency.dependentTaskId,
              entityType: EntityType.Task,
              linkType: ActivityCorrelationLinkType.Self,
            },
            {
              entityId: dependency.dependencyTaskId,
              entityType: EntityType.Task,
              linkType: ActivityCorrelationLinkType.DependsOn,
            },
          ],
          reports: [],
        } satisfies ActivityCorrelationRecordDraft,
      ];
    });

    const reportRecords: ActivityCorrelationRecordDraft[] = [];
    reports.forEach((report) => {
      if (!report.projectId) {
        return;
      }
      const reportDto = this.reportService.toDto(report);

      // CONTEXT entities are report plumbing (carrier message, conversation,
      // agent session), not subjects; they stay reachable via reports[].
      reportDto.entities.forEach((entity) => {
        if (entity.relation !== ReportEntityRelation.Primary) {
          return;
        }
        reportRecords.push({
          entityId: entity.entityId,
          entityType: entity.entityType as unknown as EntityType,
          projectId: report.projectId as ProjectId,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.Report,
          timestamp: reportDto.createdAt,
          linkedEntities: [
            {
              entityId: entity.entityId,
              entityType: entity.entityType as unknown as EntityType,
              linkType: ActivityCorrelationLinkType.Self,
            },
          ],
          reports: [reportDto],
        });
      });
    });

    return this.sortByTimestampDesc(
      this.dedupeRecords([
        ...attentionRecords,
        ...agentSessionRecords,
        ...unblockedRecords,
        ...reportRecords,
      ]),
    );
  }

  async getCorrelatedActivity(
    organizationId: OrganizationId,
    query: CorrelatedActivityQuery,
    options?: {
      publishDetectionEvent?: boolean;
      userToken?: string | null;
    },
  ): Promise<CorrelatedActivityResult> {
    this.logger.debug('Starting correlated activity lookup', {
      organizationId,
      seedEntityId: query.entityId,
      seedEntityType: query.entityType,
      userId: query.userId,
      activityMode: query.activityMode ?? ActivityCorrelationMode.All,
      limit: query.limit,
      offset: query.offset,
      activityTypes: query.activityTypes,
      sources: query.sources,
      since: this.toIsoString(query.since),
      until: this.toIsoString(query.until),
    });

    this.assertValidWindow(query.since, query.until);

    const seedRef: EntityRef = {
      entityId: query.entityId,
      entityType: query.entityType,
    };

    await this.assertSeedEntityExists(organizationId, seedRef);
    const seedProjectId = await this.resolveSeedProjectId(
      organizationId,
      seedRef,
    );
    if (!seedProjectId) {
      throw new BadRequestException(
        `Correlated activity seed missing project context: ${this.toEntityKey(seedRef)}`,
      );
    }
    this.logger.debug('Resolved correlated activity seed', {
      organizationId,
      seedEntityKey: this.toEntityKey(seedRef),
      seedProjectId,
    });

    const {
      linkedEntities,
      titleHints: graphTitleHints,
      statusHints: graphStatusHints,
      updatedAtHints: graphUpdatedAtHints,
    } = await this.resolveSeedGraphContext({
      organizationId,
      projectId: seedProjectId,
      seed: seedRef,
      userToken: options?.userToken ?? null,
    });
    const scopeEntities = this.buildScopeEntities(seedRef, linkedEntities);
    this.logger.debug('Resolved correlation scope entities', {
      organizationId,
      seedEntityKey: this.toEntityKey(seedRef),
      linkedEntityCount: linkedEntities.length,
      scopeEntityCount: scopeEntities.length,
      scopeEntitySample: this.sampleEntityKeys(scopeEntities),
    });
    const streamMode = this.resolveStreamMode(query.activityMode);

    const attentionRecords = streamMode.includeAttention
      ? await this.collectAttentionRecords(
          organizationId,
          query,
          seedRef,
          linkedEntities,
          scopeEntities,
        )
      : [];

    const agentSessionResult = await this.collectAgentSessionRecords(
      organizationId,
      query,
      seedRef,
      linkedEntities,
      scopeEntities,
    );

    const unblockedRecords = await this.collectUnblockedRecords(
      organizationId,
      seedRef,
      linkedEntities,
      scopeEntities,
      agentSessionResult.completedTaskIds,
    );

    const reportScope = this.buildReportScope(
      scopeEntities,
      agentSessionResult.records,
      unblockedRecords,
    );
    const reports = await this.fetchReports(organizationId, reportScope, query);
    const reportsByEntity = this.indexReportsByEntity(reports);

    const reportRecords = this.buildReportNotificationRecords(
      reports,
      seedRef,
      linkedEntities,
      reportScope,
    );

    const hydratedRecords = this.attachReportsToRecords(
      [
        ...attentionRecords,
        ...agentSessionResult.records,
        ...unblockedRecords,
        ...reportRecords,
      ],
      reportsByEntity,
    );

    const deduped = this.dedupeRecords(hydratedRecords);
    const collapsed = this.collapseParentChildRecords(deduped);
    const filtered = this.filterRecords(
      collapsed,
      query.activityTypes,
      query.sources,
    );
    const sortedDraft = this.sortByTimestampDesc(filtered);
    const sortedWithTitles = await this.hydrateRecordTitles(
      organizationId,
      sortedDraft,
      graphTitleHints,
    );
    const sortedWithUpdatedAt = this.attachEntityUpdatedAts(
      sortedWithTitles,
      graphUpdatedAtHints,
    );
    const sortedWithStatuses = await this.attachEntityStatuses(
      organizationId,
      sortedWithUpdatedAt,
      graphStatusHints,
    );
    const sortedWithMessages = await this.attachAgentSessionLastMessages(
      organizationId,
      sortedWithStatuses,
    );
    const sorted = await hydrateActivityHistoryMetadata(
      this.prisma,
      organizationId,
      sortedWithMessages,
    );
    this.logger.debug('Assembled correlated activity records', {
      organizationId,
      seedEntityKey: this.toEntityKey(seedRef),
      attentionRecordCount: attentionRecords.length,
      agentSessionRecordCount: agentSessionResult.records.length,
      unblockedRecordCount: unblockedRecords.length,
      reportNotificationRecordCount: reportRecords.length,
      hydratedRecordCount: hydratedRecords.length,
      dedupedRecordCount: deduped.length,
      collapsedRecordCount: collapsed.length,
      filteredRecordCount: filtered.length,
      sortedRecordCount: sorted.length,
      recordTypeSourceSummary: this.summarizeRecordTypeSourceCounts(sorted),
    });

    if (sorted.length === 0) {
      this.logger.warn('Correlated activity lookup returned zero records', {
        organizationId,
        seedEntityKey: this.toEntityKey(seedRef),
        userId: query.userId,
        activityTypes: query.activityTypes,
        sources: query.sources,
        since: this.toIsoString(query.since),
        until: this.toIsoString(query.until),
      });
    }

    if (options?.publishDetectionEvent !== false) {
      await this.publishCorrelationDetectionEvent({
        organizationId,
        projectId: seedProjectId,
        userId: query.userId,
        aggregateId: query.entityId,
        subject: `${query.entityType}:${query.entityId}`,
        records: sorted,
      });
    }

    const total = sorted.length;
    const records = sorted.slice(query.offset, query.offset + query.limit);
    const nextOffset =
      query.offset + query.limit < total
        ? query.offset + query.limit
        : undefined;

    this.logger.debug('Paginated correlated activity response', {
      organizationId,
      seedEntityKey: this.toEntityKey(seedRef),
      total,
      returnedCount: records.length,
      offset: query.offset,
      limit: query.limit,
      nextOffset,
    });

    return {
      records,
      total,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
    };
  }

  async listCorrelatedActivity(
    organizationId: OrganizationId,
    query: RecentActivityQuery,
    userToken: string | null,
  ): Promise<RecentCorrelatedActivityResult> {
    this.logger.debug('Starting recent correlated activity listing', {
      organizationId,
      userId: query.userId,
      projectId: query.projectId,
      limit: query.limit,
      offset: query.offset,
      mode: query.mode,
      sort: query.sort,
      hasUserToken: !!userToken,
    });

    const seedPage = await this.recentSeedSelector.selectSeeds(
      organizationId,
      query,
    );

    this.logger.debug('Resolved recent correlated activity seeds', {
      organizationId,
      userId: query.userId,
      projectId: query.projectId,
      seedCount: seedPage.seeds.length,
      total: seedPage.total,
      seedSample: this.sampleEntityKeys(seedPage.seeds),
    });

    if (seedPage.seeds.length === 0) {
      this.logger.warn('Recent correlated activity listing has no seeds', {
        organizationId,
        userId: query.userId,
        projectId: query.projectId,
        limit: query.limit,
      });

      return {
        records: [],
        total: 0,
      };
    }

    const traversal = await this.recentTraversalService.fetchSeedNeighborhoods({
      organizationId,
      projectId: query.projectId,
      seedPage,
      userToken,
    });
    const recordsDraft = this.recentRecordAssembler.assembleRecentRecords(
      seedPage,
      traversal,
    );
    const augmentedRecords =
      await this.recentAugmentationService.augmentRecentRecords(
        organizationId,
        recordsDraft,
        traversal.titleHints,
        traversal.statusHints,
        traversal.updatedAtHints,
      );

    const records = await hydrateActivityHistoryMetadata(
      this.prisma,
      organizationId,
      augmentedRecords,
      query.projectId,
    );

    await this.publishRecentCorrelationDetectionEvent({
      organizationId,
      projectId: query.projectId,
      userId: query.userId,
      aggregateId: organizationId,
      subject: 'recent activity feed',
      records,
    });

    this.logger.debug('Assembled recent correlated activity listing', {
      organizationId,
      userId: query.userId,
      projectId: query.projectId,
      seedCount: seedPage.seeds.length,
      recordCount: records.length,
    });

    if (records.length === 0) {
      this.logger.warn(
        'Recent correlated activity listing returned zero records',
        {
          organizationId,
          userId: query.userId,
          projectId: query.projectId,
          seedCount: seedPage.seeds.length,
        },
      );
    }

    this.logger.debug('Paginated recent correlated activity response', {
      organizationId,
      userId: query.userId,
      total: seedPage.total,
      returnedCount: records.length,
      offset: query.offset,
      limit: query.limit,
      nextOffset: seedPage.nextOffset,
    });

    return {
      records,
      total: seedPage.total,
      ...(seedPage.nextOffset !== undefined
        ? { nextOffset: seedPage.nextOffset }
        : {}),
    };
  }

  private resolveStreamMode(activityMode?: ActivityCorrelationMode): {
    includeAttention: boolean;
  } {
    const resolvedMode = activityMode ?? ActivityCorrelationMode.All;

    switch (resolvedMode) {
      case ActivityCorrelationMode.WithoutAttention:
        return {
          includeAttention: false,
        };
      case ActivityCorrelationMode.All:
        return {
          includeAttention: true,
        };
      default:
        throw new BadRequestException(
          `Unsupported activity mode: ${resolvedMode}`,
        );
    }
  }

  private assertValidWindow(since?: Date, until?: Date): void {
    if (since && Number.isNaN(since.getTime())) {
      throw new BadRequestException('since must be a valid ISO-8601 timestamp');
    }

    if (until && Number.isNaN(until.getTime())) {
      throw new BadRequestException('until must be a valid ISO-8601 timestamp');
    }

    if (since && until && since > until) {
      throw new BadRequestException('since must be before or equal to until');
    }
  }

  private async assertSeedEntityExists(
    organizationId: OrganizationId,
    seed: EntityRef,
  ): Promise<void> {
    const entity = await this.prisma.db.entityRegistry.findFirst({
      where: {
        organizationId,
        entityId: seed.entityId,
        entityType: this.toPrismaEntityType(seed.entityType),
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!entity) {
      throw new NotFoundException('Entity not found');
    }
  }

  private async resolveSeedGraphContext(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    seed: EntityRef;
    userToken: string | null;
  }): Promise<{
    linkedEntities: LinkedEntityRef[];
    titleHints: Map<string, string>;
    statusHints: Map<string, string>;
    updatedAtHints: Map<string, string>;
  }> {
    if (!params.userToken) {
      throw new BadRequestException('Graph traversal requires an auth token');
    }

    const graphResponse = await this.fetchSeedGraphExpansion({
      organizationId: params.organizationId,
      projectId: params.projectId,
      seed: params.seed,
      userToken: params.userToken,
    });
    const linkedEntities =
      buildGraphLinkedEntitiesBySeed([params.seed], graphResponse).get(
        this.toEntityKey(params.seed),
      ) ?? [];

    return {
      linkedEntities,
      titleHints: this.buildGraphTitleHints(graphResponse),
      statusHints: this.buildGraphStatusHints(graphResponse),
      updatedAtHints: this.buildGraphUpdatedAtHints(graphResponse),
    };
  }

  private async fetchSeedGraphExpansion(params: {
    organizationId: OrganizationId;
    projectId: ProjectId;
    seed: EntityRef;
    userToken: string;
  }): Promise<SearchResponse> {
    const graphRequest = this.buildSeedGraphRequest(params.seed);

    try {
      return await this.graphsClientService.searchGraphAllPages(
        params.organizationId,
        params.projectId,
        graphRequest,
        params.userToken,
      );
    } catch (error) {
      this.logger.error('Correlated activity graph traversal failed', {
        error: errorToLoggable(error),
        organizationId: params.organizationId,
        projectId: params.projectId,
        seedEntityKey: this.toEntityKey(params.seed),
      });
      throw new BadGatewayException(
        'Failed to load related graph context for correlations',
      );
    }
  }

  private buildSeedGraphRequest(seed: EntityRef): SearchRequest {
    const request: SearchRequest = {
      seedEntityIds: [seed.entityId],
      traversal: {
        direction: 'BOTH',
        depth: ActivityCorrelationService.GRAPH_TRAVERSAL_DEPTH,
      },
      includeRelationships: true,
      includeSeedEntities: true,
      trackPathCount: true,
      groupResultsBySeed: true,
      page: 0,
      size: ActivityCorrelationService.GRAPH_PAGE_SIZE,
    };

    if (seed.entityType === EntityType.Task) {
      request.traversal = {
        ...request.traversal,
        pathExpansions: [
          {
            seedEntityTypes: ['TASK'],
            relationshipChain: [
              { type: 'HAS_AGENT_SESSION', direction: 'OUTGOING' },
              { type: 'ABOUT', direction: 'INCOMING' },
            ],
          },
        ],
      };
    }

    return request satisfies SearchRequest;
  }

  private buildScopeEntities(
    seed: EntityRef,
    linkedEntities: LinkedEntityRef[],
  ): EntityRef[] {
    const scope: EntityRef[] = [seed];

    linkedEntities.forEach((linkedEntity) => {
      this.pushEntityRef(scope, {
        entityId: linkedEntity.entityId,
        entityType: linkedEntity.entityType,
      });
    });

    return scope;
  }

  private async collectAttentionRecords(
    organizationId: OrganizationId,
    query: CorrelatedActivityQuery,
    seed: EntityRef,
    linkedEntities: LinkedEntityRef[],
    scopeEntities: EntityRef[],
  ): Promise<ActivityCorrelationRecordDraft[]> {
    if (scopeEntities.length === 0) {
      this.logger.debug(
        'Skipping attention record collection due to empty scope',
        {
          organizationId,
          seedEntityKey: this.toEntityKey(seed),
          userId: query.userId,
        },
      );
      return [];
    }

    const whereEntityFilters = scopeEntities.map((entity) => ({
      entityId: entity.entityId,
      entityType: entity.entityType,
    }));

    const timeWindow = this.buildTimeWindow(query.since, query.until);
    const take = this.resolveRawFetchLimit(query.limit);

    const events = await this.prisma.db.attentionEvent.findMany({
      where: {
        organizationId,
        userId: query.userId,
        OR: whereEntityFilters,
        ...(timeWindow ? { focusEnd: timeWindow } : {}),
      },
      orderBy: { focusEnd: 'desc' },
      take,
    });

    this.logger.debug('Collected attention events for correlation', {
      organizationId,
      seedEntityKey: this.toEntityKey(seed),
      userId: query.userId,
      scopeEntityCount: scopeEntities.length,
      fetchedEventCount: events.length,
      take,
      since: this.toIsoString(query.since),
      until: this.toIsoString(query.until),
    });

    return events.flatMap((event) => {
      if (!event.projectId) {
        this.logger.warn('Skipping attention event without project context', {
          organizationId,
          entityId: event.entityId,
          entityType: event.entityType,
        });
        return [];
      }

      const entityType = this.fromStringEntityType(event.entityType);
      const origin = {
        entityId: event.entityId,
        entityType,
      };

      return {
        entityId: origin.entityId,
        entityType: origin.entityType,
        projectId: event.projectId as ProjectId,
        type: ActivityCorrelationActivityType.Viewed,
        source: ActivityCorrelationSource.AttentionEvent,
        timestamp: event.focusEnd.toISOString(),
        linkedEntities: this.buildLinkedEntitiesForOrigin(
          origin,
          seed,
          linkedEntities,
        ),
        reports: [],
      } satisfies ActivityCorrelationRecordDraft;
    });
  }

  private async collectAgentSessionRecords(
    organizationId: OrganizationId,
    query: CorrelatedActivityQuery,
    seed: EntityRef,
    linkedEntities: LinkedEntityRef[],
    scopeEntities: EntityRef[],
  ): Promise<AgentSessionCorrelationResult> {
    const queryFilter = this.buildAgentSessionScopeFilter(scopeEntities);
    if (queryFilter.length === 0) {
      this.logger.debug(
        'Skipping agent session collection because scope produced no agent session filters',
        {
          organizationId,
          seedEntityKey: this.toEntityKey(seed),
          userId: query.userId,
          scopeEntityCount: scopeEntities.length,
        },
      );

      return {
        records: [],
        completedTaskIds: new Set<string>(),
      };
    }

    const timeWindow = this.buildTimeWindow(query.since, query.until);
    const take = this.resolveRawFetchLimit(query.limit);

    const agentSessions = await this.prisma.db.agentSession.findMany({
      where: {
        organizationId,
        userId: query.userId,
        status: PrismaAgentSessionStatus.COMPLETED,
        OR: queryFilter,
        ...(timeWindow ? { updatedAt: timeWindow } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take,
      select: {
        id: true,
        type: true,
        status: true,
        updatedAt: true,
        title: true,
        provider: true,
        sessionDate: true,
        entityType: true,
        entityId: true,
        serviceId: true,
        conversationId: true,
        projectId: true,
      },
    });

    const correlationTaskIds = agentSessions
      .filter((s) => s.entityType === 'TASK' && s.entityId)
      .map((s) => s.entityId as string);
    const correlationParentTaskByTaskId =
      correlationTaskIds.length > 0
        ? await this.prisma.db.task
            .findMany({
              where: { id: { in: correlationTaskIds }, organizationId },
              select: { id: true, parentTaskId: true },
            })
            .then(
              (tasks) =>
                new Map(tasks.map((t) => [t.id, t.parentTaskId ?? null])),
            )
        : new Map<string, string | null>();

    this.logger.debug('Collected agent sessions for correlation', {
      organizationId,
      seedEntityKey: this.toEntityKey(seed),
      userId: query.userId,
      scopeEntityCount: scopeEntities.length,
      queryFilterCount: queryFilter.length,
      fetchedAgentSessionCount: agentSessions.length,
      take,
      since: this.toIsoString(query.since),
      until: this.toIsoString(query.until),
    });

    const scopeKeySet = this.toEntityKeySet(scopeEntities);
    const records: ActivityCorrelationRecordDraft[] = [];
    const completedTaskIds = new Set<string>();

    agentSessions.forEach((agentSession) => {
      const sessionTaskId =
        agentSession.entityType === 'TASK' ? agentSession.entityId : null;
      const sessionInitiativeId =
        agentSession.entityType === 'INITIATIVE' ? agentSession.entityId : null;
      const sessionDesignDocId =
        agentSession.entityType === 'DESIGN_DOC' ? agentSession.entityId : null;

      const agentSessionContext = {
        id: agentSession.id,
        type: agentSession.type,
        taskId: sessionTaskId,
        parentTaskId: sessionTaskId
          ? (correlationParentTaskByTaskId.get(sessionTaskId) ?? null)
          : null,
        initiativeId: sessionInitiativeId,
        designDocId: sessionDesignDocId,
        serviceId: agentSession.serviceId,
        conversationId: agentSession.conversationId,
      };

      if (sessionTaskId) {
        completedTaskIds.add(sessionTaskId);
      }

      const origins = this.resolveAgentSessionOrigins(
        agentSessionContext,
        scopeKeySet,
        seed,
      );

      origins.forEach((origin) => {
        const record: ActivityCorrelationRecordDraft = {
          entityId: origin.entityId,
          entityType: origin.entityType,
          projectId: agentSession.projectId as ProjectId,
          type: ActivityCorrelationActivityType.AgentSessionCompleted,
          source: ActivityCorrelationSource.AgentSession,
          timestamp: agentSession.updatedAt.toISOString(),
          linkedEntities: this.buildAgentSessionLinkedEntities(
            origin,
            seed,
            linkedEntities,
            agentSessionContext,
          ),
          reports: [],
          ...(origin.entityType === EntityType.AgentSession
            ? {
                conversationId: agentSession.conversationId ?? null,
                sessionType: agentSessionContext.type as AgentSessionType,
              }
            : {}),
        };

        records.push(record);
      });
    });

    this.logger.debug('Built agent session correlation records', {
      organizationId,
      seedEntityKey: this.toEntityKey(seed),
      fetchedAgentSessionCount: agentSessions.length,
      recordCount: records.length,
      completedTaskCount: completedTaskIds.size,
    });

    return {
      records,
      completedTaskIds,
    };
  }

  private async collectUnblockedRecords(
    organizationId: OrganizationId,
    seed: EntityRef,
    linkedEntities: LinkedEntityRef[],
    scopeEntities: EntityRef[],
    completedTaskIds: Set<string>,
  ): Promise<ActivityCorrelationRecordDraft[]> {
    const scopeTaskIds = scopeEntities
      .filter((entity) => entity.entityType === EntityType.Task)
      .map((entity) => entity.entityId);

    const allDependencySourceTaskIds = new Set<string>([
      ...scopeTaskIds,
      ...completedTaskIds,
    ]);

    if (allDependencySourceTaskIds.size === 0) {
      this.logger.debug(
        'Skipping unblocked record collection because no task dependencies are in scope',
        {
          organizationId,
          seedEntityKey: this.toEntityKey(seed),
          scopeEntityCount: scopeEntities.length,
          completedTaskCount: completedTaskIds.size,
        },
      );

      return [];
    }

    const dependencies = await this.prisma.db.taskDependency.findMany({
      where: {
        dependencyTaskId: {
          in: [...allDependencySourceTaskIds],
        },
      },
      include: {
        dependencyTask: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            projectId: true,
          },
        },
        dependentTask: {
          select: {
            id: true,
            status: true,
            updatedAt: true,
            projectId: true,
          },
        },
      },
    });

    const unblockedDependencies = dependencies.filter((dependency) =>
      this.isDependencyUnblocked(
        dependency.dependencyTask.status,
        completedTaskIds.has(dependency.dependencyTaskId),
      ),
    );
    const openDependentDependencies = unblockedDependencies.filter(
      (dependency) => !this.isTaskClosedStatus(dependency.dependentTask.status),
    );
    const records = openDependentDependencies.map((dependency) => {
      const origin: EntityRef = {
        entityId: dependency.dependentTaskId,
        entityType: EntityType.Task,
      };

      const timestamp = this.maxTimestamp(
        dependency.dependencyTask.updatedAt,
        dependency.dependentTask.updatedAt,
      );

      return {
        entityId: origin.entityId,
        entityType: origin.entityType,
        projectId: dependency.dependentTask.projectId as ProjectId,
        type: ActivityCorrelationActivityType.Unblocked,
        source: ActivityCorrelationSource.TaskRelationship,
        timestamp,
        linkedEntities: this.mergeLinkedEntities(
          this.buildLinkedEntitiesForOrigin(origin, seed, linkedEntities),
          [
            {
              entityId: dependency.dependencyTaskId,
              entityType: EntityType.Task,
              linkType: ActivityCorrelationLinkType.DependsOn,
            },
          ],
        ),
        reports: [],
      } satisfies ActivityCorrelationRecordDraft;
    });

    this.logger.debug(
      'Collected unblocked dependency records for correlation',
      {
        organizationId,
        seedEntityKey: this.toEntityKey(seed),
        scopeTaskCount: scopeTaskIds.length,
        completedTaskCount: completedTaskIds.size,
        dependencySourceTaskCount: allDependencySourceTaskIds.size,
        fetchedDependencyCount: dependencies.length,
        unblockedDependencyCount: unblockedDependencies.length,
        openDependentCount: openDependentDependencies.length,
        recordCount: records.length,
      },
    );

    return records;
  }

  private buildReportScope(
    scopeEntities: EntityRef[],
    agentSessionRecords: ActivityCorrelationRecordDraft[],
    unblockedRecords: ActivityCorrelationRecordDraft[],
  ): EntityRef[] {
    const reportScope = [...scopeEntities];

    [...agentSessionRecords, ...unblockedRecords].forEach((record) => {
      this.pushEntityRef(reportScope, {
        entityId: record.entityId,
        entityType: record.entityType,
      });

      record.linkedEntities.forEach((linkedEntity) => {
        this.pushEntityRef(reportScope, {
          entityId: linkedEntity.entityId,
          entityType: linkedEntity.entityType,
        });
      });
    });

    return reportScope;
  }

  private async fetchReports(
    organizationId: OrganizationId,
    scopeEntities: EntityRef[],
    query: CorrelatedActivityQuery,
  ): Promise<ReportDto[]> {
    if (scopeEntities.length === 0) {
      this.logger.debug('Skipping report fetch because scope is empty', {
        organizationId,
        userId: query.userId,
      });
      return [];
    }

    const timeWindow = this.buildTimeWindow(query.since, query.until);
    const now = new Date();

    const reportEntitiesFilter = scopeEntities
      .filter((entity) => this.isReportRelatedEntityType(entity.entityType))
      .map((entity) => ({
        entityType: this.toPrismaEntityType(entity.entityType),
        entityId: entity.entityId,
      }));

    if (reportEntitiesFilter.length === 0) {
      this.logger.debug(
        'Skipping report fetch because scope has no report-related entity types',
        {
          organizationId,
          userId: query.userId,
          scopeEntityCount: scopeEntities.length,
        },
      );
      return [];
    }

    const reports = await this.prisma.db.report.findMany({
      where: {
        organizationId,
        expiresAt: { gt: now },
        audience: {
          in: ActivityCorrelationService.CORRELATION_VISIBLE_REPORT_AUDIENCES,
        },
        ...(timeWindow ? { createdAt: timeWindow } : {}),
        reportEntities: {
          some: {
            OR: reportEntitiesFilter,
          },
        },
      },
      include: {
        reportEntities: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: ActivityCorrelationService.MAX_RAW_FETCH,
    });

    this.logger.debug('Fetched reports for activity correlation', {
      organizationId,
      userId: query.userId,
      scopeEntityCount: scopeEntities.length,
      reportEntityFilterCount: reportEntitiesFilter.length,
      fetchedReportCount: reports.length,
      since: this.toIsoString(query.since),
      until: this.toIsoString(query.until),
    });

    return reports.map((report) => this.reportService.toDto(report));
  }

  private indexReportsByEntity(reports: ReportDto[]): Map<string, ReportDto[]> {
    const index = new Map<string, ReportDto[]>();

    reports.forEach((report) => {
      report.entities.forEach((entity) => {
        const key = this.toEntityKey({
          entityId: entity.entityId,
          entityType: entity.entityType as unknown as EntityType,
        });
        const current = index.get(key) ?? [];
        current.push(report);
        index.set(key, current);
      });
    });

    return index;
  }

  private buildReportNotificationRecords(
    reports: ReportDto[],
    seed: EntityRef,
    linkedEntities: LinkedEntityRef[],
    reportScope: EntityRef[],
  ): ActivityCorrelationRecordDraft[] {
    const reportScopeSet = this.toEntityKeySet(reportScope);
    const records: ActivityCorrelationRecordDraft[] = [];

    reports.forEach((report) => {
      if (!report.projectId) {
        this.logger.warn(
          'Skipping report correlation without project context',
          {
            reportId: report.id,
            reportType: report.reportType,
          },
        );
        return;
      }

      report.entities.forEach((entity) => {
        const origin: EntityRef = {
          entityId: entity.entityId,
          entityType: entity.entityType as unknown as EntityType,
        };

        if (!reportScopeSet.has(this.toEntityKey(origin))) {
          return;
        }

        records.push({
          entityId: origin.entityId,
          entityType: origin.entityType,
          projectId: report.projectId as ProjectId,
          type: ActivityCorrelationActivityType.Notification,
          source: ActivityCorrelationSource.Report,
          timestamp: report.createdAt,
          linkedEntities: this.buildLinkedEntitiesForOrigin(
            origin,
            seed,
            linkedEntities,
          ),
          reports: [report],
        } satisfies ActivityCorrelationRecordDraft);
      });
    });

    return records;
  }

  private attachReportsToRecords(
    records: ActivityCorrelationRecordDraft[],
    reportsByEntity: Map<string, ReportDto[]>,
  ): ActivityCorrelationRecordDraft[] {
    return records.map((record) => {
      const key = this.toEntityKey({
        entityId: record.entityId,
        entityType: record.entityType,
      });

      const reports = reportsByEntity.get(key) ?? record.reports;

      return {
        ...record,
        reports,
      };
    });
  }

  private filterRecords(
    records: ActivityCorrelationRecordDraft[],
    activityTypes?: ActivityCorrelationActivityType[],
    sources?: ActivityCorrelationSource[],
  ): ActivityCorrelationRecordDraft[] {
    const filtered = records.filter((record) => {
      const matchesActivityType =
        !activityTypes || activityTypes.includes(record.type);
      const matchesSource = !sources || sources.includes(record.source);
      return matchesActivityType && matchesSource;
    });

    this.logger.debug('Filtered activity correlation records', {
      inputCount: records.length,
      outputCount: filtered.length,
      activityTypes,
      sources,
    });

    return filtered;
  }

  private sortByTimestampDesc(
    records: ActivityCorrelationRecordDraft[],
  ): ActivityCorrelationRecordDraft[] {
    return [...records].sort((a, b) => {
      return Date.parse(b.timestamp) - Date.parse(a.timestamp);
    });
  }

  private dedupeRecords(
    records: ActivityCorrelationRecordDraft[],
  ): ActivityCorrelationRecordDraft[] {
    const seen = new Set<string>();
    const deduped: ActivityCorrelationRecordDraft[] = [];

    records.forEach((record) => {
      const fingerprint = this.buildRecordFingerprint(record);
      if (seen.has(fingerprint)) {
        return;
      }

      seen.add(fingerprint);
      deduped.push(record);
    });

    return deduped;
  }

  /**
   * When an AGENT_SESSION record and its parent TASK record both appear,
   * drop the AGENT_SESSION in favor of the TASK (which carries richer context).
   */
  private collapseParentChildRecords(
    records: ActivityCorrelationRecordDraft[],
  ): ActivityCorrelationRecordDraft[] {
    const taskRecordIds = new Set<string>();
    records.forEach((record) => {
      if (record.entityType === EntityType.Task) {
        taskRecordIds.add(record.entityId);
      }
    });

    if (taskRecordIds.size === 0) {
      return records;
    }

    return records.filter((record) => {
      if (record.entityType !== EntityType.AgentSession) {
        return true;
      }

      const hasParentTaskRecord = record.linkedEntities.some(
        (linked) =>
          linked.entityType === EntityType.Task &&
          taskRecordIds.has(linked.entityId),
      );

      return !hasParentTaskRecord;
    });
  }

  private buildRecordFingerprint(
    record: Pick<
      ActivityCorrelationRecordDraft,
      | 'type'
      | 'source'
      | 'entityType'
      | 'entityId'
      | 'timestamp'
      | 'linkedEntities'
      | 'reports'
    >,
  ): string {
    const linkedEntityFingerprint = record.linkedEntities
      .map((linkedEntity) => this.toEntityKey(linkedEntity))
      .sort()
      .join(',');
    const reportFingerprint = record.reports
      .map((report) => report.id)
      .sort()
      .join(',');

    return [
      record.type,
      record.source,
      record.entityType,
      record.entityId,
      record.timestamp,
      linkedEntityFingerprint,
      reportFingerprint,
    ].join('|');
  }

  private async hydrateRecordTitles(
    organizationId: OrganizationId,
    records: ActivityCorrelationRecordDraft[],
    titleHints?: Map<string, string>,
  ): Promise<ActivityCorrelationRecordDto[]> {
    if (records.length === 0) {
      return [];
    }

    const referencedEntities: EntityRef[] = [];
    records.forEach((record) => {
      this.pushEntityRef(referencedEntities, {
        entityId: record.entityId,
        entityType: record.entityType,
      });
      record.linkedEntities.forEach((linkedEntity) => {
        this.pushEntityRef(referencedEntities, {
          entityId: linkedEntity.entityId,
          entityType: linkedEntity.entityType,
        });
      });
    });

    const entityTitles = await this.resolveEntityTitles(
      organizationId,
      referencedEntities,
      titleHints,
    );

    return records.map(({ eventActorUserId: _eventActorUserId, ...record }) => {
      const linkedEntities = record.linkedEntities;

      return {
        ...record,
        title: this.requireEntityTitle(entityTitles, {
          entityId: record.entityId,
          entityType: record.entityType,
        }),
        linkedEntities: linkedEntities.map((linkedEntity) => ({
          ...linkedEntity,
          title: this.requireEntityTitle(entityTitles, {
            entityId: linkedEntity.entityId,
            entityType: linkedEntity.entityType,
          }),
        })),
      };
    });
  }

  private async attachEntityStatuses(
    organizationId: OrganizationId,
    records: ActivityCorrelationRecordDto[],
    statusHints?: Map<string, string>,
  ): Promise<ActivityCorrelationRecordDto[]> {
    if (records.length === 0) {
      return records;
    }

    const unresolvedTaskIds = new Set<string>();
    const unresolvedAgentSessionIds = new Set<string>();

    records.forEach((record) => {
      this.collectUnresolvedStatusEntityId(
        { entityId: record.entityId, entityType: record.entityType },
        record.status,
        statusHints,
        unresolvedTaskIds,
        unresolvedAgentSessionIds,
      );
      record.linkedEntities.forEach((linkedEntity) => {
        this.collectUnresolvedStatusEntityId(
          {
            entityId: linkedEntity.entityId,
            entityType: linkedEntity.entityType,
          },
          linkedEntity.status,
          statusHints,
          unresolvedTaskIds,
          unresolvedAgentSessionIds,
        );
      });
    });

    const [taskStatuses, agentSessionStatuses] = await Promise.all([
      this.fetchTaskStatuses(organizationId, [...unresolvedTaskIds]),
      this.fetchAgentSessionStatuses(organizationId, [
        ...unresolvedAgentSessionIds,
      ]),
    ]);

    return records.map((record) => {
      const recordStatus = this.resolveActivityCorrelationEntityStatus(
        { entityId: record.entityId, entityType: record.entityType },
        record.status,
        statusHints,
        taskStatuses,
        agentSessionStatuses,
      );

      return {
        ...record,
        ...(recordStatus ? { status: recordStatus } : {}),
        linkedEntities: record.linkedEntities.map((linkedEntity) => {
          const linkedStatus = this.resolveActivityCorrelationEntityStatus(
            {
              entityId: linkedEntity.entityId,
              entityType: linkedEntity.entityType,
            },
            linkedEntity.status,
            statusHints,
            taskStatuses,
            agentSessionStatuses,
          );

          return {
            ...linkedEntity,
            ...(linkedStatus ? { status: linkedStatus } : {}),
          };
        }),
      };
    });
  }

  private attachEntityUpdatedAts(
    records: ActivityCorrelationRecordDto[],
    updatedAtHints?: Map<string, string>,
  ): ActivityCorrelationRecordDto[] {
    if (records.length === 0 || !updatedAtHints || updatedAtHints.size === 0) {
      return records;
    }

    return records.map((record) => {
      const recordUpdatedAt =
        record.updatedAt ??
        updatedAtHints.get(
          this.toEntityKey({
            entityId: record.entityId,
            entityType: record.entityType,
          }),
        );

      return {
        ...record,
        ...(recordUpdatedAt ? { updatedAt: recordUpdatedAt } : {}),
        linkedEntities: record.linkedEntities.map((linkedEntity) => {
          const linkedUpdatedAt =
            linkedEntity.updatedAt ??
            updatedAtHints.get(
              this.toEntityKey({
                entityId: linkedEntity.entityId,
                entityType: linkedEntity.entityType,
              }),
            );

          return {
            ...linkedEntity,
            ...(linkedUpdatedAt ? { updatedAt: linkedUpdatedAt } : {}),
          };
        }),
      };
    });
  }

  private async attachAgentSessionLastMessages(
    organizationId: OrganizationId,
    records: ActivityCorrelationRecordDto[],
  ): Promise<ActivityCorrelationRecordDto[]> {
    if (records.length === 0) {
      return records;
    }

    const conversationIdsByAgentSessionId =
      await this.resolveAgentSessionConversationIds(organizationId, records);
    const conversationIds = this.collectAgentSessionConversationIds(
      records,
      conversationIdsByAgentSessionId,
    );
    const latestMessagesByConversationId =
      await this.fetchLatestMessagesByConversationId(
        organizationId,
        conversationIds,
      );

    return records.map((record) => ({
      ...record,
      ...(record.entityType === EntityType.AgentSession
        ? {
            conversationId: this.resolveAgentSessionConversationId(
              record.entityId,
              record.conversationId,
              conversationIdsByAgentSessionId,
            ),
            lastMessage: this.resolveAgentSessionLastMessage(
              this.resolveAgentSessionConversationId(
                record.entityId,
                record.conversationId,
                conversationIdsByAgentSessionId,
              ),
              latestMessagesByConversationId,
            ),
          }
        : {}),
      linkedEntities: record.linkedEntities.map((linkedEntity) =>
        this.attachLinkedEntityLastMessage(
          linkedEntity,
          conversationIdsByAgentSessionId,
          latestMessagesByConversationId,
        ),
      ),
    }));
  }

  private collectAgentSessionConversationIds(
    records: ActivityCorrelationRecordDto[],
    conversationIdsByAgentSessionId: Map<string, string>,
  ): string[] {
    const conversationIds = new Set<string>();

    records.forEach((record) => {
      if (record.entityType === EntityType.AgentSession) {
        const conversationId = this.resolveAgentSessionConversationId(
          record.entityId,
          record.conversationId,
          conversationIdsByAgentSessionId,
        );
        if (conversationId) {
          conversationIds.add(conversationId);
        }
      }

      record.linkedEntities.forEach((linkedEntity) => {
        if (linkedEntity.entityType === EntityType.AgentSession) {
          const conversationId = this.resolveAgentSessionConversationId(
            linkedEntity.entityId,
            linkedEntity.conversationId,
            conversationIdsByAgentSessionId,
          );
          if (conversationId) {
            conversationIds.add(conversationId);
          }
        }
      });
    });

    return [...conversationIds];
  }

  private async resolveAgentSessionConversationIds(
    organizationId: OrganizationId,
    records: ActivityCorrelationRecordDto[],
  ): Promise<Map<string, string>> {
    const agentSessionIds = new Set<string>();

    records.forEach((record) => {
      if (
        record.entityType === EntityType.AgentSession &&
        !record.conversationId
      ) {
        agentSessionIds.add(record.entityId);
      }

      record.linkedEntities.forEach((linkedEntity) => {
        if (
          linkedEntity.entityType === EntityType.AgentSession &&
          !linkedEntity.conversationId
        ) {
          agentSessionIds.add(linkedEntity.entityId);
        }
      });
    });

    if (agentSessionIds.size === 0) {
      return new Map();
    }

    const agentSessions = await this.prisma.db.agentSession.findMany({
      where: {
        organizationId,
        id: { in: [...agentSessionIds] },
      },
      select: {
        id: true,
        conversationId: true,
      },
    });

    const conversationIdsByAgentSessionId = new Map<string, string>();
    agentSessions.forEach((agentSession) => {
      if (agentSession.conversationId) {
        conversationIdsByAgentSessionId.set(
          agentSession.id,
          agentSession.conversationId,
        );
      }
    });

    return conversationIdsByAgentSessionId;
  }

  private async fetchLatestMessagesByConversationId(
    organizationId: OrganizationId,
    conversationIds: string[],
  ): Promise<Map<string, MessageResponseDto>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const latestMessages = await this.prisma.db.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        status: { in: ['completed', 'open'] },
        ...TIMELINE_MESSAGE_WHERE,
        conversation: {
          organizationId,
        },
      },
      distinct: ['conversationId'],
      orderBy: [
        { conversationId: 'asc' },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      include: {
        responses: false,
        parentMessage: true,
        conversation: {
          select: {
            workflowId: true,
          },
        },
      },
    });

    const latestMessagesByConversationId = new Map<
      string,
      MessageResponseDto
    >();
    latestMessages.forEach((message) => {
      latestMessagesByConversationId.set(
        message.conversationId,
        prismaMessageResultToResponseDto(
          message as MessageQueryResult,
          (message.conversation?.workflowId ?? undefined) as WorkflowId,
        ),
      );
    });

    return latestMessagesByConversationId;
  }

  private attachLinkedEntityLastMessage(
    linkedEntity: ActivityCorrelationLinkedEntityDto,
    conversationIdsByAgentSessionId: Map<string, string>,
    latestMessagesByConversationId: Map<string, MessageResponseDto>,
  ): ActivityCorrelationLinkedEntityDto {
    if (linkedEntity.entityType !== EntityType.AgentSession) {
      return linkedEntity;
    }

    const conversationId = this.resolveAgentSessionConversationId(
      linkedEntity.entityId,
      linkedEntity.conversationId,
      conversationIdsByAgentSessionId,
    );

    return {
      ...linkedEntity,
      conversationId,
      lastMessage: this.resolveAgentSessionLastMessage(
        conversationId,
        latestMessagesByConversationId,
      ),
    };
  }

  private resolveAgentSessionConversationId(
    entityId: string,
    conversationId: string | null | undefined,
    conversationIdsByAgentSessionId: Map<string, string>,
  ): string | null {
    return (
      conversationId ?? conversationIdsByAgentSessionId.get(entityId) ?? null
    );
  }

  private collectUnresolvedStatusEntityId(
    entity: EntityRef,
    currentStatus: string | null | undefined,
    statusHints: Map<string, string> | undefined,
    unresolvedTaskIds: Set<string>,
    unresolvedAgentSessionIds: Set<string>,
  ): void {
    if (
      currentStatus ||
      statusHints?.has(this.toEntityKey(entity)) ||
      !this.isStatusAwareEntityType(entity.entityType)
    ) {
      return;
    }

    if (entity.entityType === EntityType.Task) {
      unresolvedTaskIds.add(entity.entityId);
      return;
    }

    unresolvedAgentSessionIds.add(entity.entityId);
  }

  private async fetchTaskStatuses(
    organizationId: OrganizationId,
    taskIds: string[],
  ): Promise<Map<string, string>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const tasks = await this.prisma.db.task.findMany({
      where: {
        organizationId,
        id: { in: taskIds },
      },
      select: {
        id: true,
        status: true,
      },
    });

    return new Map(tasks.map((task) => [task.id, task.status]));
  }

  private async fetchAgentSessionStatuses(
    organizationId: OrganizationId,
    agentSessionIds: string[],
  ): Promise<Map<string, string>> {
    if (agentSessionIds.length === 0) {
      return new Map();
    }

    const agentSessions = await this.prisma.db.agentSession.findMany({
      where: {
        organizationId,
        id: { in: agentSessionIds },
      },
      select: {
        id: true,
        status: true,
      },
    });

    return new Map(
      agentSessions.map((agentSession) => [
        agentSession.id,
        agentSession.status,
      ]),
    );
  }

  private resolveActivityCorrelationEntityStatus(
    entity: EntityRef,
    currentStatus: string | null | undefined,
    statusHints: Map<string, string> | undefined,
    taskStatuses: Map<string, string>,
    agentSessionStatuses: Map<string, string>,
  ): string | undefined {
    if (!this.isStatusAwareEntityType(entity.entityType)) {
      return undefined;
    }

    return (
      currentStatus ??
      statusHints?.get(this.toEntityKey(entity)) ??
      (entity.entityType === EntityType.Task
        ? taskStatuses.get(entity.entityId)
        : agentSessionStatuses.get(entity.entityId))
    );
  }

  private resolveAgentSessionLastMessage(
    conversationId: string | null | undefined,
    latestMessagesByConversationId: Map<string, MessageResponseDto>,
  ): MessageResponseDto | null {
    if (!conversationId) {
      return null;
    }

    return latestMessagesByConversationId.get(conversationId) ?? null;
  }

  private async resolveEntityTitles(
    organizationId: OrganizationId,
    entities: EntityRef[],
    titleHints?: Map<string, string>,
  ): Promise<Map<string, string>> {
    const titles = new Map<string, string>(titleHints ?? []);
    if (entities.length === 0) {
      return titles;
    }

    const registryEntityFilters = entities
      .filter((entity) => this.isEntityRegistryEntityType(entity.entityType))
      .map((entity) => ({
        entityId: entity.entityId,
        entityType: this.toPrismaEntityType(entity.entityType),
      }));

    const registryEntities =
      registryEntityFilters.length > 0
        ? await this.prisma.db.entityRegistry.findMany({
            where: {
              organizationId,
              deletedAt: null,
              OR: registryEntityFilters,
            },
            select: {
              entityId: true,
              entityType: true,
              entityName: true,
            },
          })
        : [];

    registryEntities.forEach((entity) => {
      this.putEntityTitle(
        titles,
        {
          entityId: entity.entityId,
          entityType: this.fromPrismaEntityType(entity.entityType),
        },
        entity.entityName,
      );
    });

    const unresolvedEntities = entities.filter(
      (entity) => !titles.has(this.toEntityKey(entity)),
    );
    const byType = this.groupEntityIdsByType(unresolvedEntities);

    const taskIds = byType.get(EntityType.Task);
    if (taskIds && taskIds.length > 0) {
      const tasks = await this.prisma.db.task.findMany({
        where: {
          organizationId,
          id: { in: taskIds },
        },
        select: {
          id: true,
          name: true,
        },
      });

      tasks.forEach((task) => {
        this.putEntityTitle(
          titles,
          { entityId: task.id, entityType: EntityType.Task },
          task.name,
        );
      });
    }

    const initiativeIds = byType.get(EntityType.Initiative);
    if (initiativeIds && initiativeIds.length > 0) {
      const initiatives = await this.prisma.db.initiative.findMany({
        where: {
          organizationId,
          id: { in: initiativeIds },
        },
        select: {
          id: true,
          name: true,
        },
      });

      initiatives.forEach((initiative) => {
        this.putEntityTitle(
          titles,
          { entityId: initiative.id, entityType: EntityType.Initiative },
          initiative.name,
        );
      });
    }

    const projectIds = byType.get(EntityType.Project);
    if (projectIds && projectIds.length > 0) {
      const projects = await this.prisma.db.project.findMany({
        where: {
          organizationId,
          id: { in: projectIds },
        },
        select: {
          id: true,
          name: true,
        },
      });

      projects.forEach((project) => {
        this.putEntityTitle(
          titles,
          { entityId: project.id, entityType: EntityType.Project },
          project.name,
        );
      });
    }

    const designDocIds = byType.get(EntityType.DesignDoc);
    if (designDocIds && designDocIds.length > 0) {
      const designDocs = await this.prisma.db.designDoc.findMany({
        where: {
          organizationId,
          id: { in: designDocIds },
        },
        select: {
          id: true,
          name: true,
        },
      });

      designDocs.forEach((designDoc) => {
        this.putEntityTitle(
          titles,
          { entityId: designDoc.id, entityType: EntityType.DesignDoc },
          designDoc.name,
        );
      });
    }

    const serviceIds = byType.get(EntityType.Service);
    if (serviceIds && serviceIds.length > 0) {
      const services = await this.prisma.db.service.findMany({
        where: {
          organizationId,
          id: { in: serviceIds },
        },
        select: {
          id: true,
          name: true,
        },
      });

      services.forEach((service) => {
        this.putEntityTitle(
          titles,
          { entityId: service.id, entityType: EntityType.Service },
          service.name,
        );
      });
    }

    const agentSessionIds = byType.get(EntityType.AgentSession);
    if (agentSessionIds && agentSessionIds.length > 0) {
      const agentSessions = await this.prisma.db.agentSession.findMany({
        where: {
          organizationId,
          id: { in: agentSessionIds },
        },
        select: {
          id: true,
          title: true,
        },
      });

      agentSessions.forEach((agentSession) => {
        this.putEntityTitle(
          titles,
          { entityId: agentSession.id, entityType: EntityType.AgentSession },
          agentSession.title,
        );
      });
    }

    const conversationIds = byType.get(EntityType.Conversation);
    if (conversationIds && conversationIds.length > 0) {
      const conversations = await this.prisma.db.conversation.findMany({
        where: {
          organizationId,
          id: { in: conversationIds },
        },
        select: {
          id: true,
          title: true,
          workflowName: true,
        },
      });

      conversations.forEach((conversation) => {
        this.putEntityTitle(
          titles,
          { entityId: conversation.id, entityType: EntityType.Conversation },
          conversation.title ?? conversation.workflowName,
        );
      });
    }

    const proposalIds = byType.get(EntityType.Proposal);
    if (proposalIds && proposalIds.length > 0) {
      const proposals = await this.prisma.db.proposal.findMany({
        where: {
          organizationId,
          id: { in: proposalIds },
        },
        select: {
          id: true,
          title: true,
        },
      });

      proposals.forEach((proposal) => {
        this.putEntityTitle(
          titles,
          { entityId: proposal.id, entityType: EntityType.Proposal },
          proposal.title,
        );
      });
    }

    const reportIds = byType.get(EntityType.Report);
    if (reportIds && reportIds.length > 0) {
      const reports = await this.prisma.db.report.findMany({
        where: {
          organizationId,
          id: { in: reportIds },
        },
        select: {
          id: true,
          reportType: true,
        },
      });

      reports.forEach((report) => {
        this.putEntityTitle(
          titles,
          { entityId: report.id, entityType: EntityType.Report },
          this.reportService.getReportTitle(
            this.toReportType(report.reportType),
          ),
        );
      });
    }

    const artifactIds = byType.get(EntityType.Artifact);
    if (artifactIds && artifactIds.length > 0) {
      const artifacts = await this.prisma.db.artifact.findMany({
        where: {
          organizationId,
          id: { in: artifactIds },
        },
        select: {
          id: true,
          title: true,
          data: true,
        },
      });

      artifacts.forEach((artifact) => {
        this.putEntityTitle(
          titles,
          { entityId: artifact.id, entityType: EntityType.Artifact },
          this.normalizeTitle(artifact.title) ??
            this.extractObjectTitle(artifact.data),
        );
      });
    }

    const messageIds = byType.get(EntityType.Message);
    if (messageIds && messageIds.length > 0) {
      const messages = await this.prisma.db.message.findMany({
        where: {
          id: { in: messageIds },
          conversation: { organizationId },
        },
        select: {
          id: true,
          data: true,
        },
      });

      messages.forEach((message) => {
        this.putEntityTitle(
          titles,
          { entityId: message.id, entityType: EntityType.Message },
          this.extractObjectTitle(message.data),
        );
      });
    }

    return titles;
  }

  private buildGraphTitleHints(response: SearchResponse): Map<string, string> {
    const titles = new Map<string, string>();
    const entitiesByNodeId = new Map<string, EntityRef>();

    const graphResults = this.collectGraphSearchResults(response);
    graphResults.forEach((result) => {
      const entity = this.toEntityRefFromGraphResult(result);
      if (!entity) {
        return;
      }

      const nodeId = result.node?.id;
      if (nodeId) {
        entitiesByNodeId.set(nodeId, entity);
      }

      this.putEntityTitle(
        titles,
        entity,
        this.extractGraphSearchResultTitle(result),
      );
    });

    const relationships = this.collectGraphRelationships(response);
    relationships.forEach((relationship) => {});

    return titles;
  }

  private buildGraphStatusHints(response: SearchResponse): Map<string, string> {
    const statuses = new Map<string, string>();

    this.collectGraphSearchResults(response).forEach((result) => {
      const entity = this.toEntityRefFromGraphResult(result);
      if (!entity || !this.isStatusAwareEntityType(entity.entityType)) {
        return;
      }

      const status = this.extractGraphSearchResultStatus(result);
      if (!status) {
        return;
      }

      statuses.set(this.toEntityKey(entity), status);
    });

    return statuses;
  }

  private buildGraphUpdatedAtHints(
    response: SearchResponse,
  ): Map<string, string> {
    const updatedAts = new Map<string, string>();

    this.collectGraphSearchResults(response).forEach((result) => {
      const entity = this.toEntityRefFromGraphResult(result);
      if (!entity) {
        return;
      }

      const updatedAt = this.extractGraphSearchResultUpdatedAt(result);
      if (!updatedAt) {
        return;
      }

      updatedAts.set(this.toEntityKey(entity), updatedAt);
    });

    return updatedAts;
  }

  private collectGraphSearchResults(response: SearchResponse): SearchResult[] {
    const results = [...(response.results ?? [])];
    (response.seedResults ?? []).forEach((seedGroup) => {
      results.push(...(seedGroup.results ?? []));
    });
    return results;
  }

  private collectGraphRelationships(
    response: SearchResponse,
  ): GraphRelationship[] {
    const relationships = [...(response.relationships ?? [])];
    (response.seedResults ?? []).forEach((seedGroup) => {
      relationships.push(...(seedGroup.relationships ?? []));
    });
    return relationships;
  }

  private toEntityRefFromGraphResult(
    result: SearchResult,
  ): EntityRef | undefined {
    const entityId = result.entityId?.trim();
    if (!entityId || !result.entityType) {
      return undefined;
    }

    try {
      return {
        entityId,
        entityType: this.fromStringEntityType(result.entityType.toString()),
      };
    } catch {
      return undefined;
    }
  }

  private extractGraphSearchResultTitle(
    result: SearchResult,
  ): string | undefined {
    const properties = result.node?.properties;
    if (!properties || typeof properties !== 'object') {
      return undefined;
    }

    const asRecord = properties as Record<string, unknown>;
    const directCandidates = [
      asRecord['title'],
      asRecord['name'],
      asRecord['entityName'],
      asRecord['entity_name'],
      asRecord['displayName'],
      asRecord['display_name'],
    ];

    for (const candidate of directCandidates) {
      if (typeof candidate === 'string') {
        const normalized = this.normalizeTitle(candidate);
        if (normalized) {
          return normalized;
        }
      }
    }

    return this.extractObjectTitle(asRecord);
  }

  private extractGraphSearchResultStatus(
    result: SearchResult,
  ): string | undefined {
    const properties = result.node?.properties;
    if (!properties || typeof properties !== 'object') {
      return undefined;
    }

    const status = (properties as Record<string, unknown>)['status'];
    if (typeof status !== 'string') {
      return undefined;
    }

    const normalizedStatus = status.trim();
    return normalizedStatus.length > 0 ? normalizedStatus : undefined;
  }

  private extractGraphSearchResultUpdatedAt(
    result: SearchResult,
  ): string | undefined {
    const updatedAt = result.node?.updatedAt;
    if (typeof updatedAt !== 'string') {
      return undefined;
    }

    const normalizedUpdatedAt = updatedAt.trim();
    return normalizedUpdatedAt.length > 0 ? normalizedUpdatedAt : undefined;
  }

  private putEntityTitle(
    titleMap: Map<string, string>,
    entity: EntityRef,
    rawTitle: string | undefined | null,
  ): void {
    const normalized = this.normalizeTitle(rawTitle);
    if (!normalized) {
      return;
    }

    const key = this.toEntityKey(entity);
    if (!titleMap.has(key)) {
      titleMap.set(key, normalized);
    }
  }

  private requireEntityTitle(
    titleMap: Map<string, string>,
    entity: EntityRef,
  ): string {
    const key = this.toEntityKey(entity);
    const title = titleMap.get(key);
    if (!title && entity.entityType === EntityType.AgentSession) {
      return DEFAULT_AGENT_SESSION_TITLE;
    }
    if (!title) {
      throw new Error(`Missing required activity correlation title for ${key}`);
    }

    return title;
  }

  private normalizeTitle(value?: string | null): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private extractObjectTitle(value: unknown): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const asRecord = value as Record<string, unknown>;
    const directTitle =
      typeof asRecord['title'] === 'string'
        ? this.normalizeTitle(asRecord['title'])
        : undefined;
    if (directTitle) {
      return directTitle;
    }

    const nestedData = asRecord['data'];
    if (!nestedData || typeof nestedData !== 'object') {
      return undefined;
    }

    const nestedTitle =
      typeof (nestedData as Record<string, unknown>)['title'] === 'string'
        ? this.normalizeTitle(
            (nestedData as Record<string, unknown>)['title'] as string,
          )
        : undefined;

    return nestedTitle;
  }

  private async publishCorrelationDetectionEvent(params: {
    organizationId: OrganizationId;
    projectId: ProjectId | null;
    userId: UserId;
    aggregateId: string;
    subject: string;
    records: ActivityCorrelationRecordDto[];
  }): Promise<void> {
    if (!params.projectId) {
      this.logger.debug(
        'Skipping activity correlation detection event publish due to missing projectId',
        {
          organizationId: params.organizationId,
          aggregateId: params.aggregateId,
          subject: params.subject,
          recordCount: params.records.length,
        },
      );
      return;
    }

    if (params.records.length === 0) {
      this.logger.debug(
        'Skipping activity correlation detection event publish due to empty records',
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          aggregateId: params.aggregateId,
          subject: params.subject,
        },
      );
      return;
    }

    const nowMs = Date.now();
    this.expirePublishedFingerprints(nowMs);

    const newFingerprints = params.records
      .map((record) => this.buildRecordFingerprint(record))
      .filter(
        (fingerprint) =>
          !this.publishedCorrelationFingerprints.has(fingerprint),
      );

    if (newFingerprints.length === 0) {
      this.logger.debug(
        'Skipping activity correlation detection event publish because all records were already published',
        {
          organizationId: params.organizationId,
          projectId: params.projectId,
          aggregateId: params.aggregateId,
          subject: params.subject,
          recordCount: params.records.length,
        },
      );
      return;
    }

    newFingerprints.forEach((fingerprint) => {
      this.publishedCorrelationFingerprints.set(fingerprint, nowMs);
    });

    const payload: SystemEventPayload = {
      payloadType: PayloadType.System,
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      timestamp: new Date(nowMs).toISOString(),
      systemMessage: `Detected ${newFingerprints.length} new activity correlations for ${params.subject}`,
      severity: 'info',
    };

    const event: Omit<SystemLifecycleEvent, 'id'> = {
      type: EVENT_TYPES.SYSTEM.ALERT,
      aggregateId: params.aggregateId,
      payload,
    };

    await this.eventPublisher.publish(event);

    this.logger.debug('Published activity correlation detection event', {
      organizationId: params.organizationId,
      projectId: params.projectId,
      aggregateId: params.aggregateId,
      subject: params.subject,
      correlationCount: newFingerprints.length,
    });
  }

  private async publishRecentCorrelationDetectionEvent(params: {
    organizationId: OrganizationId;
    projectId: ProjectId | null;
    userId: UserId;
    aggregateId: string;
    subject: string;
    records: RecentActivityCorrelationRecordDto[];
  }): Promise<void> {
    if (!params.projectId || params.records.length === 0) {
      return;
    }

    const nowMs = Date.now();
    this.expirePublishedFingerprints(nowMs);

    const newFingerprints = params.records
      .map((record) => this.buildRecentRecordFingerprint(record))
      .filter(
        (fingerprint) =>
          !this.publishedCorrelationFingerprints.has(fingerprint),
      );

    if (newFingerprints.length === 0) {
      return;
    }

    newFingerprints.forEach((fingerprint) => {
      this.publishedCorrelationFingerprints.set(fingerprint, nowMs);
    });

    const payload: SystemEventPayload = {
      payloadType: PayloadType.System,
      organizationId: params.organizationId,
      projectId: params.projectId,
      userId: params.userId,
      timestamp: new Date(nowMs).toISOString(),
      systemMessage: `Detected ${newFingerprints.length} new activity correlations for ${params.subject}`,
      severity: 'info',
    };

    const event: Omit<SystemLifecycleEvent, 'id'> = {
      type: EVENT_TYPES.SYSTEM.ALERT,
      aggregateId: params.aggregateId,
      payload,
    };

    await this.eventPublisher.publish(event);
  }

  private expirePublishedFingerprints(nowMs: number): void {
    this.publishedCorrelationFingerprints.forEach(
      (publishedAt, fingerprint) => {
        if (
          nowMs - publishedAt >
          ActivityCorrelationService.PUBLISHED_FINGERPRINT_TTL_MS
        ) {
          this.publishedCorrelationFingerprints.delete(fingerprint);
        }
      },
    );
  }

  private resolveRawFetchLimit(limit: number): number {
    return Math.min(
      ActivityCorrelationService.MAX_RAW_FETCH,
      Math.max(limit * ActivityCorrelationService.MAX_FETCH_MULTIPLIER, limit),
    );
  }

  private buildRecentRecordFingerprint(
    record: Pick<
      RecentActivityCorrelationRecordDto,
      'entityType' | 'entityId' | 'timestamp' | 'linkedEntities' | 'reports'
    >,
  ): string {
    const linkedEntityFingerprint = record.linkedEntities
      .map((linkedEntity) => this.toEntityKey(linkedEntity))
      .sort()
      .join(',');
    const reportFingerprint = record.reports
      .map((report) => report.id)
      .sort()
      .join(',');

    return [
      record.entityType,
      record.entityId,
      record.timestamp,
      linkedEntityFingerprint,
      reportFingerprint,
    ].join('|');
  }

  private buildTimeWindow(
    since?: Date,
    until?: Date,
  ): { gte?: Date; lte?: Date } | undefined {
    if (!since && !until) {
      return undefined;
    }

    return {
      ...(since ? { gte: since } : {}),
      ...(until ? { lte: until } : {}),
    };
  }

  private buildAgentSessionScopeFilter(
    scopeEntities: EntityRef[],
  ): Prisma.AgentSessionWhereInput[] {
    const byType = this.groupEntityIdsByType(scopeEntities);

    const filters: Prisma.AgentSessionWhereInput[] = [];

    const agentSessionIds = byType.get(EntityType.AgentSession);
    if (agentSessionIds && agentSessionIds.length > 0) {
      filters.push({ id: { in: agentSessionIds } });
    }

    const taskIds = byType.get(EntityType.Task);
    if (taskIds && taskIds.length > 0) {
      filters.push({ entityType: 'TASK', entityId: { in: taskIds } });
    }

    const initiativeIds = byType.get(EntityType.Initiative);
    if (initiativeIds && initiativeIds.length > 0) {
      filters.push({
        entityType: 'INITIATIVE',
        entityId: { in: initiativeIds },
      });
    }

    const designDocIds = byType.get(EntityType.DesignDoc);
    if (designDocIds && designDocIds.length > 0) {
      filters.push({
        entityType: 'DESIGN_DOC',
        entityId: { in: designDocIds },
      });
    }

    const serviceIds = byType.get(EntityType.Service);
    if (serviceIds && serviceIds.length > 0) {
      filters.push({ serviceId: { in: serviceIds } });
    }

    const conversationIds = byType.get(EntityType.Conversation);
    if (conversationIds && conversationIds.length > 0) {
      filters.push({ conversationId: { in: conversationIds } });
    }

    return filters;
  }

  private resolveAgentSessionOrigins(
    agentSession: {
      id: string;
      taskId: string | null;
      parentTaskId: string | null;
      initiativeId: string | null;
      designDocId: string | null;
      serviceId: string | null;
      conversationId: string | null;
    },
    scopeKeys: Set<string>,
    seed: EntityRef,
  ): EntityRef[] {
    const origins: EntityRef[] = [];

    const candidates: EntityRef[] = [
      {
        entityId: agentSession.id,
        entityType: EntityType.AgentSession,
      },
      ...(agentSession.taskId
        ? [
            {
              entityId: agentSession.taskId,
              entityType: EntityType.Task,
            } satisfies EntityRef,
          ]
        : []),
      ...(agentSession.initiativeId
        ? [
            {
              entityId: agentSession.initiativeId,
              entityType: EntityType.Initiative,
            } satisfies EntityRef,
          ]
        : []),
      ...(agentSession.designDocId
        ? [
            {
              entityId: agentSession.designDocId,
              entityType: EntityType.DesignDoc,
            } satisfies EntityRef,
          ]
        : []),
      ...(agentSession.serviceId
        ? [
            {
              entityId: agentSession.serviceId,
              entityType: EntityType.Service,
            } satisfies EntityRef,
          ]
        : []),
      ...(agentSession.conversationId
        ? [
            {
              entityId: agentSession.conversationId,
              entityType: EntityType.Conversation,
            } satisfies EntityRef,
          ]
        : []),
    ];

    candidates.forEach((candidate) => {
      if (scopeKeys.has(this.toEntityKey(candidate))) {
        this.pushEntityRef(origins, candidate);
      }
    });

    if (origins.length === 0) {
      this.pushEntityRef(origins, seed);
    }

    return origins;
  }

  private buildAgentSessionLinkedEntities(
    origin: EntityRef,
    seed: EntityRef,
    seedLinkedEntities: LinkedEntityRef[],
    agentSession: {
      id: string;
      taskId: string | null;
      parentTaskId: string | null;
      initiativeId: string | null;
      designDocId: string | null;
      serviceId: string | null;
      conversationId: string | null;
    },
  ): ActivityCorrelationLinkedEntityDraft[] {
    const baseLinked = this.buildLinkedEntitiesForOrigin(
      origin,
      seed,
      seedLinkedEntities,
    );

    const agentSessionLinked: ActivityCorrelationLinkedEntityDraft[] = [
      {
        entityId: agentSession.id,
        entityType: EntityType.AgentSession,
        linkType: ActivityCorrelationLinkType.Related,
        conversationId: agentSession.conversationId,
      },
      ...(agentSession.taskId
        ? [
            {
              entityId: agentSession.taskId,
              entityType: EntityType.Task,
              linkType: ActivityCorrelationLinkType.Related,
            } satisfies LinkedEntityRef,
          ]
        : []),
      ...(agentSession.parentTaskId
        ? [
            {
              entityId: agentSession.parentTaskId,
              entityType: EntityType.Task,
              linkType: ActivityCorrelationLinkType.Parent,
            } satisfies LinkedEntityRef,
          ]
        : []),
      ...(agentSession.initiativeId
        ? [
            {
              entityId: agentSession.initiativeId,
              entityType: EntityType.Initiative,
              linkType: ActivityCorrelationLinkType.Related,
            } satisfies LinkedEntityRef,
          ]
        : []),
      ...(agentSession.designDocId
        ? [
            {
              entityId: agentSession.designDocId,
              entityType: EntityType.DesignDoc,
              linkType: ActivityCorrelationLinkType.Related,
            } satisfies LinkedEntityRef,
          ]
        : []),
      ...(agentSession.serviceId
        ? [
            {
              entityId: agentSession.serviceId,
              entityType: EntityType.Service,
              linkType: ActivityCorrelationLinkType.Related,
            } satisfies LinkedEntityRef,
          ]
        : []),
      ...(agentSession.conversationId
        ? [
            {
              entityId: agentSession.conversationId,
              entityType: EntityType.Conversation,
              linkType: ActivityCorrelationLinkType.Related,
            } satisfies LinkedEntityRef,
          ]
        : []),
    ];

    return this.mergeLinkedEntities(baseLinked, agentSessionLinked);
  }

  private buildLinkedEntitiesForOrigin(
    origin: EntityRef,
    seed: EntityRef,
    seedLinkedEntities: LinkedEntityRef[],
  ): ActivityCorrelationLinkedEntityDraft[] {
    const linkedEntities: ActivityCorrelationLinkedEntityDraft[] = [
      {
        entityId: origin.entityId,
        entityType: origin.entityType,
        linkType: ActivityCorrelationLinkType.Self,
      },
    ];

    const isOriginSeed = this.toEntityKey(origin) === this.toEntityKey(seed);

    if (isOriginSeed) {
      return this.mergeLinkedEntities(linkedEntities, seedLinkedEntities);
    }

    const originLinkFromSeed = seedLinkedEntities.find(
      (linkedEntity) =>
        linkedEntity.entityId === origin.entityId &&
        linkedEntity.entityType === origin.entityType,
    );

    linkedEntities.push({
      entityId: seed.entityId,
      entityType: seed.entityType,
      linkType: originLinkFromSeed
        ? this.invertLinkType(originLinkFromSeed.linkType)
        : ActivityCorrelationLinkType.Related,
    });

    return this.mergeLinkedEntities(linkedEntities, []);
  }

  private invertLinkType(
    linkType: ActivityCorrelationLinkType,
  ): ActivityCorrelationLinkType {
    switch (linkType) {
      case ActivityCorrelationLinkType.Parent:
        return ActivityCorrelationLinkType.Child;
      case ActivityCorrelationLinkType.Child:
        return ActivityCorrelationLinkType.Parent;
      case ActivityCorrelationLinkType.DependsOn:
        return ActivityCorrelationLinkType.Blocks;
      case ActivityCorrelationLinkType.Blocks:
        return ActivityCorrelationLinkType.DependsOn;
      default:
        return linkType;
    }
  }

  private mergeLinkedEntities(
    existing: ActivityCorrelationLinkedEntityDraft[],
    incoming: LinkedEntityRef[],
  ): ActivityCorrelationLinkedEntityDraft[] {
    const merged = [...existing];

    incoming.forEach((linkedEntity) => {
      const key = this.toEntityKey(linkedEntity);
      const duplicate = merged.find((entry) => this.toEntityKey(entry) === key);

      if (duplicate) {
        if (!duplicate.status && linkedEntity.status) {
          duplicate.status = linkedEntity.status;
        }
        if (!duplicate.updatedAt && linkedEntity.updatedAt) {
          duplicate.updatedAt = linkedEntity.updatedAt;
        }
        return;
      }

      merged.push({
        entityId: linkedEntity.entityId,
        entityType: linkedEntity.entityType,
        linkType: linkedEntity.linkType,
        ...(linkedEntity.status ? { status: linkedEntity.status } : {}),
        ...(linkedEntity.updatedAt
          ? { updatedAt: linkedEntity.updatedAt }
          : {}),
      });
    });

    return merged;
  }

  private pushEntityRef(target: EntityRef[], entity: EntityRef): void {
    const alreadyPresent = target.some(
      (entry) =>
        entry.entityId === entity.entityId &&
        entry.entityType === entity.entityType,
    );

    if (!alreadyPresent) {
      target.push(entity);
    }
  }

  private toEntityKey(entity: EntityRef): string {
    return `${entity.entityType}:${entity.entityId}`;
  }

  private sampleEntityKeys(entities: EntityRef[], sampleSize = 5): string[] {
    return entities
      .slice(0, sampleSize)
      .map((entity) => this.toEntityKey(entity));
  }

  private summarizeRecordTypeSourceCounts(
    records: Array<{
      type: ActivityCorrelationActivityType;
      source: ActivityCorrelationSource;
    }>,
  ): Record<string, number> {
    const summary: Record<string, number> = {};

    records.forEach((record) => {
      const key = `${record.type}:${record.source}`;
      summary[key] = (summary[key] ?? 0) + 1;
    });

    return summary;
  }

  private toIsoString(value?: Date): string | undefined {
    return value ? value.toISOString() : undefined;
  }

  private toEntityKeySet(entities: EntityRef[]): Set<string> {
    return new Set(entities.map((entity) => this.toEntityKey(entity)));
  }

  private groupEntityIdsByType(
    entities: EntityRef[],
  ): Map<EntityType, string[]> {
    const grouped = new Map<EntityType, string[]>();

    entities.forEach((entity) => {
      const current = grouped.get(entity.entityType) ?? [];
      if (!current.includes(entity.entityId)) {
        current.push(entity.entityId);
      }
      grouped.set(entity.entityType, current);
    });

    return grouped;
  }

  private isDependencyUnblocked(
    dependencyStatus: WorkStatus,
    completedByAgentSession: boolean,
  ): boolean {
    return dependencyStatus === WorkStatus.COMPLETED || completedByAgentSession;
  }

  private isTaskClosedStatus(status: WorkStatus): boolean {
    return status === WorkStatus.COMPLETED || status === WorkStatus.CANCELLED;
  }

  private isStatusAwareEntityType(entityType: EntityType): boolean {
    return (
      entityType === EntityType.Task || entityType === EntityType.AgentSession
    );
  }

  private maxTimestamp(first: Date, second: Date): string {
    return (first > second ? first : second).toISOString();
  }

  private fromStringEntityType(entityType: string): EntityType {
    const normalized = entityType.trim().toUpperCase().replace(/-/g, '_');
    if (!this.isEntityType(normalized)) {
      throw new Error(
        `Unsupported entity type in attention event: ${entityType}`,
      );
    }

    return normalized;
  }

  private toPrismaEntityType(entityType: EntityType): PrismaEntityType {
    return entityType as PrismaEntityType;
  }

  private fromPrismaEntityType(entityType: PrismaEntityType): EntityType {
    return entityType as EntityType;
  }

  private isEntityType(value: string): value is EntityType {
    return (Object.values(EntityType) as string[]).includes(value);
  }

  private isEntityRegistryEntityType(entityType: EntityType): boolean {
    return (Object.values(PrismaEntityType) as string[]).includes(entityType);
  }

  private isReportRelatedEntityType(entityType: EntityType): boolean {
    return (Object.values(ReportRelatedEntityType) as string[]).includes(
      entityType,
    );
  }

  private toReportType(value: string): ReportType {
    if ((Object.values(ReportType) as string[]).includes(value)) {
      return value as ReportType;
    }

    throw new Error(`Unsupported report type: ${value}`);
  }

  private async resolveSeedProjectId(
    organizationId: OrganizationId,
    seed: EntityRef,
  ): Promise<ProjectId | null> {
    switch (seed.entityType) {
      case EntityType.Project:
        return seed.entityId as ProjectId;
      case EntityType.Initiative: {
        const initiative = await this.prisma.db.initiative.findFirst({
          where: { id: seed.entityId, organizationId },
          select: { originatingProjectId: true },
        });
        return (
          (initiative?.originatingProjectId as ProjectId | undefined) ?? null
        );
      }
      case EntityType.Task: {
        const task = await this.prisma.db.task.findFirst({
          where: { id: seed.entityId, organizationId },
          select: { projectId: true },
        });
        return (task?.projectId as ProjectId | undefined) ?? null;
      }
      case EntityType.DesignDoc: {
        const designDoc = await this.prisma.db.designDoc.findFirst({
          where: { id: seed.entityId, organizationId },
          select: { projectId: true },
        });
        return (designDoc?.projectId as ProjectId | undefined) ?? null;
      }
      case EntityType.Service: {
        const service = await this.prisma.db.service.findFirst({
          where: { id: seed.entityId, organizationId },
          select: { projectId: true },
        });
        return (service?.projectId as ProjectId | undefined) ?? null;
      }
      case EntityType.Conversation: {
        const conversation = await this.prisma.db.conversation.findFirst({
          where: { id: seed.entityId, organizationId },
          select: { projectId: true },
        });
        return (conversation?.projectId as ProjectId | undefined) ?? null;
      }
      case EntityType.AgentSession: {
        const agentSession = await this.prisma.db.agentSession.findFirst({
          where: { id: seed.entityId, organizationId },
          select: {
            projectId: true,
            entityType: true,
            entityId: true,
            service: {
              select: { projectId: true },
            },
            conversation: {
              select: { projectId: true },
            },
          },
        });

        if (!agentSession) {
          return null;
        }

        if (agentSession.projectId) {
          return agentSession.projectId as ProjectId;
        }

        if (agentSession.entityType && agentSession.entityId) {
          const aboutProjectId = await this.resolveAboutTargetProjectId(
            organizationId,
            agentSession.entityType,
            agentSession.entityId,
          );
          if (aboutProjectId) {
            return aboutProjectId;
          }
        }

        return (
          (agentSession.service?.projectId as ProjectId | undefined) ??
          (agentSession.conversation?.projectId as ProjectId | undefined) ??
          null
        );
      }
      default:
        return null;
    }
  }

  private async resolveAboutTargetProjectId(
    organizationId: OrganizationId,
    entityType: string,
    entityId: string,
  ): Promise<ProjectId | null> {
    switch (entityType) {
      case 'TASK': {
        const task = await this.prisma.db.task.findFirst({
          where: { id: entityId, organizationId },
          select: { projectId: true },
        });
        return (task?.projectId as ProjectId | undefined) ?? null;
      }
      case 'INITIATIVE': {
        const initiative = await this.prisma.db.initiative.findFirst({
          where: { id: entityId, organizationId },
          select: { originatingProjectId: true },
        });
        return (
          (initiative?.originatingProjectId as ProjectId | undefined) ?? null
        );
      }
      case 'DESIGN_DOC': {
        const designDoc = await this.prisma.db.designDoc.findFirst({
          where: { id: entityId, organizationId },
          select: { projectId: true },
        });
        return (designDoc?.projectId as ProjectId | undefined) ?? null;
      }
      default:
        return null;
    }
  }
}

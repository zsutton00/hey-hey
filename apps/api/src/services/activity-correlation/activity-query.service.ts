import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ActivityCorrelationActivityType,
  ActivityCorrelationMode,
  ActivityCorrelationSource,
  ActivityCorrelationRecordDto,
  ActivityMetricContinuationDto,
  AgentSessionType,
  EntityType,
  ProjectMetricIdentity,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { ActivityCorrelationService } from '../activity-correlation.service';
import {
  AcceptedEvidenceRecord,
  AcceptedEvidenceSelectionOptions,
  ProjectMetricsRequest,
  WorkItemLifecycleRecord,
} from '../project-metrics/project-metrics.types';
import { AcceptedEvidenceSelectorService } from '../project-metrics/accepted-evidence-selector.service';
import { ActivityCorrelationRecordDraft } from './activity-correlation.types';
import {
  ActivityQueryRequest,
  ActivitySelectionRequest,
  ActivityQueryResult,
} from './activity-query.types';
import { OrganizationId, ProjectId, UserId } from 'src/types';

type ActivityEntityMetadata = {
  readonly userIds: ReadonlySet<string>;
  readonly serviceIds: ReadonlySet<string>;
};

type ActivityMetadataByKey = ReadonlyMap<string, ActivityEntityMetadata>;

const EMPTY_METADATA: ActivityEntityMetadata = {
  userIds: new Set(),
  serviceIds: new Set(),
};

/**
 * Owns the cross-project Activity read. Metric mode deliberately enters the
 * accepted-evidence selector with the continuation's complete boundary; the
 * ordinary path uses the accepted-evidence selector only to establish the
 * authorized project/window boundary, then reads the canonical Activity
 * streams owned by ActivityCorrelationService plus the selector's work-item
 * lifecycle evidence (any work-item type).
 */
@Injectable()
export class ActivityQueryService {
  private readonly logger = new Logger(ActivityQueryService.name);

  constructor(
    private readonly acceptedEvidenceSelector: AcceptedEvidenceSelectorService,
    private readonly prisma: PrismaService,
    private readonly activityCorrelationService: ActivityCorrelationService,
  ) {}

  async queryActivity(
    request: ActivityQueryRequest,
  ): Promise<ActivityQueryResult> {
    const hydrated = await this.selectActivity(request);
    const total = hydrated.length;
    const records = hydrated.slice(
      request.offset,
      request.offset + request.limit,
    );
    const nextOffset =
      request.offset + request.limit < total
        ? request.offset + request.limit
        : undefined;
    return {
      records,
      total,
      ...(nextOffset === undefined ? {} : { nextOffset }),
    };
  }

  /** Internal canonical selection before page slicing; callers must bound returned HTTP pages. */
  async selectActivity(
    request: ActivitySelectionRequest,
  ): Promise<ActivityCorrelationRecordDto[]> {
    this.logger.debug('[activity-query] starting query', {
      organizationId: request.organizationId,
      actorUserId: request.actorUserId,
      requestedProjectId: request.projectId ?? null,
      selectedUserId:
        request.historyFilter?.userId ?? request.selectedUserId ?? null,
      queryMode: request.historyFilter
        ? 'history'
        : request.metricContinuation
          ? 'exact'
          : 'ordinary',
      entityTypes: request.entityTypes ?? null,
      activityMode: request.activityMode ?? ActivityCorrelationMode.All,
      activityTypes: request.activityTypes ?? null,
      sources: request.sources ?? null,
      serviceId: request.serviceId ?? null,
      since: this.toIsoString(request.since),
      until: this.toIsoString(request.until),
      affectsMe: request.affectsMe ?? null,
      sinceLastVisit: request.sinceLastVisit ?? null,
      metric:
        request.historyFilter?.metric ??
        request.metricContinuation?.metric ??
        null,
    });

    this.assertValidWindow(request.since, request.until);
    const continuation = this.normalizeContinuation(
      request.metricContinuation,
      request,
    );
    this.assertContinuationFilters(request, continuation);

    const history = request.historyFilter;
    const metricBoundary = history ?? continuation;
    const projectMetricsRequest: ProjectMetricsRequest = {
      organizationId: request.organizationId,
      userId: request.actorUserId,
      actorScope: continuation?.actorScope ?? { mode: 'ORGANIZATION' },
      ...(request.projectId === undefined
        ? {}
        : { projectId: request.projectId }),
    };
    const evidence = metricBoundary
      ? await this.acceptedEvidenceSelector.select(projectMetricsRequest, {
          ...this.buildMetricSelectionOptions(metricBoundary),
          ...(history?.userId ? { eventActorUserId: history.userId } : {}),
        })
      : undefined;
    const effectiveProjectIds = evidence
      ? evidence.effectiveProjectIds
      : await this.acceptedEvidenceSelector.resolveAuthorizedProjectIds(
          projectMetricsRequest,
        );
    const ordinaryWindowEnd = request.until ?? new Date();
    const windowStart = evidence?.windowStart ?? request.since ?? new Date(0);
    const windowEnd = evidence?.windowEnd ?? ordinaryWindowEnd;

    this.logger.debug('[activity-query] normalized authorization scope', {
      organizationId: request.organizationId,
      accessibleProjectCount: effectiveProjectIds.length,
      effectiveProjectIds,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      metric: metricBoundary?.metric ?? null,
    });

    const metricEvidence = metricBoundary
      ? (evidence?.records ?? []).filter(
          (record) => record.metric === metricBoundary.metric,
        )
      : [];
    const acceptedRecords = this.dedupeAcceptedEvidence(
      metricEvidence,
      metricBoundary?.metric,
    );
    const [assembledDrafts, lifecycleDrafts] = metricBoundary
      ? [[], []]
      : await Promise.all([
          this.activityCorrelationService.assembleOrganizationActivityRecords(
            request.organizationId,
            {
              projectIds: effectiveProjectIds,
              windowStart,
              windowEnd,
              includeAttention: this.shouldIncludeAttention(request),
              attentionUserId: this.resolveAttentionUserId(request),
              ...(request.selectedUserId
                ? { selectedUserId: request.selectedUserId }
                : {}),
            },
          ),
          this.acceptedEvidenceSelector
            .selectWorkItemLifecycle(request.organizationId, {
              projectIds: effectiveProjectIds,
              windowStart,
              windowEnd,
              ...(request.selectedUserId
                ? { eventActorUserId: request.selectedUserId }
                : {}),
            })
            .then((records) =>
              records.map((record) => this.toLifecycleDraft(record)),
            ),
        ]);
    const canonicalDrafts = [...assembledDrafts, ...lifecycleDrafts];
    const metadata = this.requiresEntityMetadata(request)
      ? await this.loadActivityMetadata(
          request.organizationId,
          effectiveProjectIds,
          acceptedRecords,
          canonicalDrafts,
        )
      : new Map<string, ActivityEntityMetadata>();
    const lastVisitByEntity = request.sinceLastVisit
      ? await this.loadLastVisits(
          request.organizationId,
          request.actorUserId,
          effectiveProjectIds,
          acceptedRecords,
          canonicalDrafts,
        )
      : new Map<string, Date>();
    const acceptedDrafts = acceptedRecords
      .filter((record) =>
        this.matchesEvidenceFilters(
          request,
          record,
          metadata,
          lastVisitByEntity,
        ),
      )
      .map((record) => this.toActivityDraft(record))
      .filter((draft) => this.matchesPublishedRecordFilters(request, draft));
    const filteredCanonicalDrafts = canonicalDrafts.filter((draft) =>
      this.matchesCanonicalFilters(request, draft, metadata, lastVisitByEntity),
    );
    const drafts = this.sortDrafts(
      this.dedupeDrafts([...acceptedDrafts, ...filteredCanonicalDrafts]),
    );

    this.logger.debug('[activity-query] selected and mapped evidence', {
      organizationId: request.organizationId,
      metric: metricBoundary?.metric ?? null,
      acceptedEvidenceCount: evidence?.records.length ?? 0,
      metricEvidenceCount: metricEvidence.length,
      deduplicatedEvidenceCount: acceptedRecords.length,
      acceptedDraftCount: acceptedDrafts.length,
      attentionDraftCount: filteredCanonicalDrafts.filter(
        ({ source }) => source === ActivityCorrelationSource.AttentionEvent,
      ).length,
      lifecycleDraftCount: lifecycleDrafts.length,
      canonicalDraftCount: filteredCanonicalDrafts.length,
      mappedDraftCount: drafts.length,
    });

    return this.activityCorrelationService.hydrateCanonicalActivityRecords(
      request.organizationId,
      drafts,
    );
  }

  private normalizeContinuation(
    continuation?: ActivityMetricContinuationDto,
    request?: ActivitySelectionRequest,
  ): ActivityMetricContinuationDto | undefined {
    if (!continuation) {
      return undefined;
    }

    const projectIds = this.readContinuationProjectIds(continuation);
    const metric = continuation.metric;
    if (
      !Object.values(ProjectMetricIdentity).includes(
        metric as ProjectMetricIdentity,
      )
    ) {
      throw new BadRequestException(
        `Unsupported Activity metric continuation: ${String(metric)}`,
      );
    }

    const windowStart = this.parseDate(
      continuation.windowStart,
      'metricContinuation.windowStart',
    );
    const windowEnd = this.parseDate(
      continuation.windowEnd,
      'metricContinuation.windowEnd',
    );
    if (windowStart >= windowEnd) {
      throw new BadRequestException(
        'metricContinuation.windowStart must be before windowEnd',
      );
    }

    const actorScope = this.normalizeActorScope(
      continuation.actorScope,
      request as ActivitySelectionRequest,
    );
    if (
      actorScope.mode === 'PERSONAL' &&
      String(metric).startsWith('PROJECT_INFO_')
    ) {
      throw new BadRequestException(
        'Personal metric continuations cannot request Project Info evidence',
      );
    }

    return {
      metric,
      projectIds,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      actorScope,
    } satisfies ActivityMetricContinuationDto;
  }

  private normalizeActorScope(
    actorScope: ActivityMetricContinuationDto['actorScope'],
    request: ActivitySelectionRequest,
  ): ActivityMetricContinuationDto['actorScope'] {
    if (actorScope?.mode === 'ORGANIZATION') {
      return { mode: 'ORGANIZATION' };
    }
    if (actorScope?.mode === 'PERSONAL') {
      if (!actorScope.userId || actorScope.userId !== request.actorUserId) {
        throw new BadRequestException(
          'Personal metric continuation must identify the signed-in user',
        );
      }
      return { mode: 'PERSONAL', userId: actorScope.userId };
    }
    throw new BadRequestException(
      'metricContinuation.actorScope is incomplete or invalid',
    );
  }

  private readContinuationProjectIds(
    continuation: ActivityMetricContinuationDto,
  ): string[] {
    const rawProjectIds = continuation.projectIds;
    if (!Array.isArray(rawProjectIds)) {
      throw new BadRequestException(
        'metricContinuation.projectIds must be an array',
      );
    }

    const projectIds = [...rawProjectIds].map((projectId) => {
      if (typeof projectId !== 'string' || projectId.trim().length === 0) {
        throw new BadRequestException(
          'metricContinuation.projectIds must contain non-empty strings',
        );
      }
      return projectId.trim();
    });
    if (new Set(projectIds).size !== projectIds.length) {
      this.logger.debug(
        '[activity-query] normalized duplicate continuation project ids',
        {
          duplicateCount: projectIds.length - new Set(projectIds).size,
        },
      );
    }
    return [...new Set(projectIds)];
  }

  private buildMetricSelectionOptions(
    continuation: Pick<
      ActivityMetricContinuationDto,
      'projectIds' | 'windowStart' | 'windowEnd' | 'metric'
    >,
  ): AcceptedEvidenceSelectionOptions {
    return {
      projectIds: [...continuation.projectIds] as ProjectId[],
      windowStart: new Date(continuation.windowStart),
      windowEnd: new Date(continuation.windowEnd),
      metric: continuation.metric,
    };
  }

  private assertContinuationFilters(
    request: ActivitySelectionRequest,
    continuation?: ActivityMetricContinuationDto,
  ): void {
    if (!continuation) {
      return;
    }

    if (
      continuation.actorScope.mode === 'PERSONAL' &&
      request.selectedUserId !== undefined &&
      request.selectedUserId !== continuation.actorScope.userId
    ) {
      throw new BadRequestException(
        'userId must match the personal metric continuation actor',
      );
    }
    if (
      continuation.actorScope.mode === 'ORGANIZATION' &&
      request.selectedUserId !== undefined
    ) {
      throw new BadRequestException(
        'Organization metric continuations cannot select one user',
      );
    }

    const continuationStart = this.parseDate(
      continuation.windowStart,
      'metricContinuation.windowStart',
    );
    const continuationEnd = this.parseDate(
      continuation.windowEnd,
      'metricContinuation.windowEnd',
    );
    if (
      (request.since &&
        request.since.getTime() !== continuationStart.getTime()) ||
      (request.until && request.until.getTime() !== continuationEnd.getTime())
    ) {
      throw new BadRequestException(
        'Activity time filters must match the metric continuation window',
      );
    }

    const continuationProjectIds = new Set(
      [...continuation.projectIds].map((projectId) => String(projectId)),
    );
    if (
      request.projectId !== undefined &&
      (continuationProjectIds.size !== 1 ||
        !continuationProjectIds.has(String(request.projectId)))
    ) {
      throw new BadRequestException(
        'projectId must match the metric continuation scope',
      );
    }
  }

  private dedupeAcceptedEvidence(
    records: readonly AcceptedEvidenceRecord[],
    metric?: ProjectMetricIdentity,
  ): AcceptedEvidenceRecord[] {
    const seen = new Set<string>();
    const deduplicated: AcceptedEvidenceRecord[] = [];
    records.forEach((record) => {
      const key = metric
        ? `${record.metric}:${record.projectId}:${record.eventId}`
        : `${record.projectId}:${record.eventId}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      deduplicated.push(record);
    });
    return deduplicated;
  }

  private async loadActivityMetadata(
    organizationId: OrganizationId,
    projectIds: readonly ProjectId[],
    records: readonly AcceptedEvidenceRecord[],
    drafts: readonly ActivityCorrelationRecordDraft[] = [],
  ): Promise<ActivityMetadataByKey> {
    const taskIds = [
      ...new Set([
        ...records
          .filter((record) => record.aggregateType === 'task')
          .map((record) => record.entityId),
        ...drafts
          .filter((draft) => draft.entityType === EntityType.Task)
          .map((draft) => draft.entityId),
      ]),
    ];
    const agentSessionIds = [
      ...new Set([
        ...records
          .filter((record) => record.aggregateType === 'agent_session')
          .map((record) => record.entityId),
        ...drafts
          .filter((draft) => draft.entityType === EntityType.AgentSession)
          .map((draft) => draft.entityId),
      ]),
    ];
    if (taskIds.length === 0 && agentSessionIds.length === 0) {
      return new Map();
    }

    const [tasks, agentSessions] = await Promise.all([
      taskIds.length > 0
        ? this.prisma.db.task.findMany({
            where: {
              organizationId,
              id: { in: taskIds },
              projectId: { in: [...projectIds] },
            },
            select: {
              id: true,
              assigneeId: true,
              creatorId: true,
              serviceRelations: { select: { serviceId: true } },
            },
          })
        : [],
      agentSessionIds.length > 0
        ? this.prisma.db.agentSession.findMany({
            where: {
              organizationId,
              id: { in: agentSessionIds },
              projectId: { in: [...projectIds] },
            },
            select: {
              id: true,
              userId: true,
              serviceRelations: { select: { serviceId: true } },
            },
          })
        : [],
    ]);

    const metadata = new Map<string, ActivityEntityMetadata>();
    (tasks ?? []).forEach((task) => {
      const userIds = [task.assigneeId, task.creatorId].filter(
        (value): value is string => typeof value === 'string',
      );
      const serviceIds = (task.serviceRelations ?? [])
        .map((relation) => relation.serviceId)
        .filter((value): value is string => typeof value === 'string');
      metadata.set(
        this.entityKey(EntityType.Task, task.id),
        this.metadata(userIds, serviceIds),
      );
    });
    (agentSessions ?? []).forEach((agentSession) => {
      metadata.set(
        this.entityKey(EntityType.AgentSession, agentSession.id),
        this.metadata(
          [agentSession.userId],
          (agentSession.serviceRelations ?? []).map(
            (relation) => relation.serviceId,
          ),
        ),
      );
    });
    return metadata;
  }

  private requiresEntityMetadata(request: ActivitySelectionRequest): boolean {
    return request.serviceId !== undefined || request.affectsMe === true;
  }

  private async loadLastVisits(
    organizationId: OrganizationId,
    userId: UserId,
    projectIds: readonly ProjectId[],
    records: readonly AcceptedEvidenceRecord[],
    drafts: readonly ActivityCorrelationRecordDraft[],
  ): Promise<Map<string, Date>> {
    const entityFilters = [
      ...new Map([
        ...records.map(
          (record) =>
            [
              this.entityKey(this.toEntityType(record), record.entityId),
              {
                entityId: record.entityId,
                entityType: this.toEntityType(record),
              },
            ] as const,
        ),
        ...drafts.map(
          (draft) =>
            [
              this.entityKey(draft.entityType, draft.entityId),
              {
                entityId: draft.entityId,
                entityType: draft.entityType,
              },
            ] as const,
        ),
      ]).values(),
    ];
    if (entityFilters.length === 0) {
      return new Map();
    }

    const rows = ((await this.prisma.db.attentionEvent.findMany({
      where: {
        organizationId,
        userId,
        projectId: { in: [...projectIds] },
        OR: entityFilters,
      },
      orderBy: [{ focusEnd: 'desc' }, { id: 'desc' }],
      select: { entityId: true, entityType: true, focusEnd: true },
    })) ?? []) as Array<{
      entityId: string;
      entityType: string;
      focusEnd: Date;
    }>;

    const lastVisits = new Map<string, Date>();
    rows.forEach((row) => {
      const key = this.entityKey(this.toEntityType(row), row.entityId);
      if (!lastVisits.has(key)) {
        lastVisits.set(key, row.focusEnd);
      }
    });
    this.logger.debug('[activity-query] resolved since-last-visit evidence', {
      organizationId,
      userId,
      candidateEntityCount: entityFilters.length,
      lastVisitCount: lastVisits.size,
    });
    return lastVisits;
  }

  private matchesEvidenceFilters(
    request: ActivitySelectionRequest,
    record: AcceptedEvidenceRecord,
    metadata: ActivityMetadataByKey,
    lastVisitByEntity: ReadonlyMap<string, Date>,
  ): boolean {
    const entityType = this.toEntityType(record);
    const entityMetadata =
      metadata.get(this.entityKey(entityType, record.entityId)) ??
      EMPTY_METADATA;
    const payloadMetadata = this.readPayloadMetadata(record.payload);
    const userIds = new Set([
      ...(record.userId ? [String(record.userId)] : []),
      ...entityMetadata.userIds,
      ...payloadMetadata.userIds,
    ]);
    const serviceIds = new Set([
      ...entityMetadata.serviceIds,
      ...payloadMetadata.serviceIds,
    ]);

    const matches =
      (!request.entityTypes || request.entityTypes.includes(entityType)) &&
      (!request.selectedUserId || record.userId === request.selectedUserId) &&
      (!request.serviceId || serviceIds.has(request.serviceId)) &&
      (!request.affectsMe || userIds.has(String(request.actorUserId))) &&
      (!request.sinceLastVisit ||
        !lastVisitByEntity.has(this.entityKey(entityType, record.entityId)) ||
        record.occurredAt >
          (lastVisitByEntity.get(
            this.entityKey(entityType, record.entityId),
          ) as Date));

    return matches;
  }

  private matchesCanonicalFilters(
    request: ActivitySelectionRequest,
    draft: ActivityCorrelationRecordDraft,
    metadata: ActivityMetadataByKey,
    lastVisitByEntity: ReadonlyMap<string, Date>,
  ): boolean {
    const entityKey = this.entityKey(draft.entityType, draft.entityId);
    const entityMetadata = metadata.get(entityKey) ?? EMPTY_METADATA;
    const isAttention =
      draft.source === ActivityCorrelationSource.AttentionEvent;
    const matchesUser = (userId: string): boolean =>
      isAttention || entityMetadata.userIds.has(userId);

    return (
      (!request.entityTypes ||
        request.entityTypes.includes(draft.entityType)) &&
      (!request.selectedUserId ||
        draft.eventActorUserId === request.selectedUserId) &&
      (!request.affectsMe || matchesUser(String(request.actorUserId))) &&
      (!request.serviceId ||
        (draft.entityType === EntityType.Service &&
          draft.entityId === request.serviceId) ||
        entityMetadata.serviceIds.has(request.serviceId)) &&
      (!request.sinceLastVisit ||
        !lastVisitByEntity.has(entityKey) ||
        new Date(draft.timestamp) >
          (lastVisitByEntity.get(entityKey) as Date)) &&
      this.matchesPublishedRecordFilters(request, draft)
    );
  }

  private shouldIncludeAttention(request: ActivitySelectionRequest): boolean {
    const mode = request.activityMode ?? ActivityCorrelationMode.All;
    if (mode === ActivityCorrelationMode.WithoutAttention) {
      return false;
    }
    if (mode !== ActivityCorrelationMode.All) {
      throw new BadRequestException(`Unsupported activity mode: ${mode}`);
    }
    if (
      request.affectsMe &&
      request.selectedUserId &&
      String(request.selectedUserId) !== String(request.actorUserId)
    ) {
      return false;
    }
    return (
      (!request.activityTypes ||
        request.activityTypes.includes(
          ActivityCorrelationActivityType.Viewed,
        )) &&
      (!request.sources ||
        request.sources.includes(ActivityCorrelationSource.AttentionEvent))
    );
  }

  private resolveAttentionUserId(request: ActivitySelectionRequest): UserId {
    return request.affectsMe
      ? request.actorUserId
      : (request.selectedUserId ?? request.actorUserId);
  }

  private matchesPublishedRecordFilters(
    request: ActivitySelectionRequest,
    draft: ActivityCorrelationRecordDraft,
  ): boolean {
    return (
      (!request.activityTypes || request.activityTypes.includes(draft.type)) &&
      (!request.sources || request.sources.includes(draft.source))
    );
  }

  private toActivityDraft(
    record: AcceptedEvidenceRecord,
  ): ActivityCorrelationRecordDraft {
    const payloadMetadata = this.readPayloadMetadata(record.payload);
    const entityType = this.toEntityType(record);
    const conversationId =
      record.conversationId ?? payloadMetadata.conversationId;
    return {
      entityId: record.entityId,
      entityType,
      projectId: record.projectId,
      type: ActivityCorrelationActivityType.Notification,
      timestamp: record.occurredAt.toISOString(),
      source:
        entityType === EntityType.AgentSession
          ? ActivityCorrelationSource.AgentSession
          : ActivityCorrelationSource.System,
      linkedEntities: [],
      reports: [],
      ...(conversationId ? { conversationId } : {}),
      ...(entityType === EntityType.AgentSession && payloadMetadata.sessionType
        ? { sessionType: payloadMetadata.sessionType }
        : {}),
    } satisfies ActivityCorrelationRecordDraft;
  }

  private toLifecycleDraft(
    record: WorkItemLifecycleRecord,
  ): ActivityCorrelationRecordDraft {
    return {
      entityId: record.entityId,
      entityType: EntityType.Task,
      projectId: record.projectId,
      type: ActivityCorrelationActivityType.Notification,
      timestamp: record.occurredAt.toISOString(),
      source: ActivityCorrelationSource.System,
      linkedEntities: [],
      reports: [],
      ...(record.userId ? { eventActorUserId: record.userId } : {}),
      ...(record.conversationId
        ? { conversationId: record.conversationId }
        : {}),
    } satisfies ActivityCorrelationRecordDraft;
  }

  private sortDrafts(
    drafts: ActivityCorrelationRecordDraft[],
  ): ActivityCorrelationRecordDraft[] {
    return [...drafts].sort((left, right) => {
      const timestampDifference =
        Date.parse(right.timestamp) - Date.parse(left.timestamp);
      if (timestampDifference !== 0) {
        return timestampDifference;
      }
      const leftKey = `${left.projectId}:${left.entityType}:${left.entityId}:${left.source}:${left.type}`;
      const rightKey = `${right.projectId}:${right.entityType}:${right.entityId}:${right.source}:${right.type}`;
      return rightKey.localeCompare(leftKey);
    });
  }

  private dedupeDrafts(
    drafts: ActivityCorrelationRecordDraft[],
  ): ActivityCorrelationRecordDraft[] {
    const seen = new Set<string>();
    return drafts.filter((draft) => {
      const key = `${draft.projectId}:${draft.entityType}:${draft.entityId}:${draft.source}:${draft.type}:${draft.timestamp}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  private readPayloadMetadata(payload: unknown): {
    readonly userIds: string[];
    readonly serviceIds: string[];
    readonly conversationId?: string;
    readonly sessionType?: AgentSessionType;
  } {
    const root = this.asRecord(payload);
    const task = this.asRecord(root?.task);
    const update = this.asRecord(root?.update) ?? this.asRecord(root?.content);
    const agentSession = this.asRecord(root?.agentSession);
    const userIds = [
      this.readString(root, 'userId'),
      this.readString(task, 'assigneeId'),
      this.readString(task, 'creatorId'),
      this.readString(update, 'assigneeId'),
      this.readString(agentSession, 'userId'),
    ].filter((value): value is string => !!value);
    const serviceIds = [
      this.readString(root, 'serviceId'),
      ...this.readStringArray(root, 'serviceIds'),
      this.readString(agentSession, 'serviceId'),
      ...this.readStringArray(agentSession, 'serviceIds'),
    ].filter((value): value is string => !!value);
    const conversationId =
      this.readString(root, 'conversationId') ??
      this.readString(agentSession, 'conversationId');
    const sessionType = this.readAgentSessionType(root, agentSession);
    return {
      userIds: [...new Set(userIds)],
      serviceIds: [...new Set(serviceIds)],
      ...(conversationId ? { conversationId } : {}),
      ...(sessionType ? { sessionType } : {}),
    };
  }

  private readAgentSessionType(
    root: Record<string, unknown> | undefined,
    agentSession: Record<string, unknown> | undefined,
  ): AgentSessionType | undefined {
    const candidate =
      this.readString(agentSession, 'type') ?? this.readString(root, 'type');
    return candidate &&
      (Object.values(AgentSessionType) as string[]).includes(candidate)
      ? (candidate as AgentSessionType)
      : undefined;
  }

  private metadata(
    userIds: readonly string[],
    serviceIds: readonly string[],
  ): ActivityEntityMetadata {
    return {
      userIds: new Set(userIds),
      serviceIds: new Set(serviceIds),
    };
  }

  private toEntityType(
    record:
      | Pick<AcceptedEvidenceRecord, 'aggregateType'>
      | { entityType: string },
  ): EntityType {
    const raw =
      'aggregateType' in record ? record.aggregateType : record.entityType;
    const normalized = raw.trim().toUpperCase().replace(/-/g, '_');
    switch (normalized) {
      case 'TASK':
        return EntityType.Task;
      case 'AGENT_SESSION':
      case 'CODING_SESSION':
        return EntityType.AgentSession;
    }
    if ((Object.values(EntityType) as string[]).includes(normalized)) {
      return normalized as EntityType;
    }
    throw new BadRequestException(
      `Unsupported Activity evidence entity type: ${raw}`,
    );
  }

  private entityKey(entityType: EntityType, entityId: string): string {
    return `${entityType}:${entityId}`;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private readString(
    record: Record<string, unknown> | undefined,
    key: string,
  ): string | undefined {
    const value = record?.[key];
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private readStringArray(
    record: Record<string, unknown> | undefined,
    key: string,
  ): string[] {
    const value = record?.[key];
    return Array.isArray(value)
      ? value.filter(
          (candidate): candidate is string =>
            typeof candidate === 'string' && candidate.trim().length > 0,
        )
      : [];
  }

  private parseDate(value: string, fieldName: string): Date {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new BadRequestException(`${fieldName} is required`);
    }
    const parsed = new Date(value);
    const isRfc3339DateTime =
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
        value,
      );
    if (!isRfc3339DateTime || !Number.isFinite(parsed.getTime())) {
      throw new BadRequestException(
        `${fieldName} must be a valid RFC 3339 date-time`,
      );
    }
    return parsed;
  }

  private assertValidWindow(since?: Date, until?: Date): void {
    if (since && !Number.isFinite(since.getTime())) {
      throw new BadRequestException('since must be a valid date');
    }
    if (until && !Number.isFinite(until.getTime())) {
      throw new BadRequestException('until must be a valid date');
    }
    if (since && until && since >= until) {
      throw new BadRequestException('since must be before until');
    }
  }

  private toIsoString(value?: Date): string | undefined {
    return value?.toISOString();
  }
}

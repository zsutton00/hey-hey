import { ProjectAccessService } from '../../auth/services/project-access.service';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  ProjectMetricIdentity,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  WorkStatus,
} from 'src/generated';
import { EVENT_TYPES } from 'src/core/events/types/event.types';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { WORK_ITEM_TYPE_KEYS } from '../tasks/work-item-type-keys';
import { OutboxEventStatus } from '../outbox-store.service';
import { WorkItemTypeRegistryService } from '../tasks/work-item-type-registry.service';
import {
  AcceptedEvidenceRecord,
  AcceptedEvidenceSelection,
  PROJECT_METRICS_CLOCK,
  PROJECT_METRICS_WINDOW_MS,
  PROJECT_METRIC_IDENTITIES,
  AcceptedEvidenceSelectionOptions,
  ProjectMetricsClock,
  ProjectMetricsRequest,
  WorkItemLifecycleKind,
  WorkItemLifecycleRecord,
  WorkItemLifecycleSelectionOptions,
} from './project-metrics.types';

export const PROJECT_ORGANIC_ACTIVITY_EVENT_TYPES = [
  EVENT_TYPES.TASK.CREATED,
  EVENT_TYPES.TASK.UPDATED,
  EVENT_TYPES.TASK.CONTENT_CHANGED,
  EVENT_TYPES.TASK.STATUS_CHANGED,
  EVENT_TYPES.AGENT_SESSION.CREATED,
] as const;

const WORK_ITEM_LIFECYCLE_EVENT_TYPES = [
  EVENT_TYPES.TASK.CREATED,
  EVENT_TYPES.TASK.UPDATED,
  EVENT_TYPES.TASK.CONTENT_CHANGED,
  EVENT_TYPES.TASK.STATUS_CHANGED,
] as const;

type SourceEventRow = {
  id: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  payload: Prisma.JsonValue;
  createdAt: Date;
  headers: Prisma.JsonValue;
  correlationId: string;
  causationId: string | null;
  projectId: string | null;
  userId: string | null;
  conversationId: string | null;
};

type TaskTypeRow = {
  id: string;
  type: string;
  projectId: string;
};

type ProjectClassification = {
  readonly taskTypeKeys: ReadonlySet<string>;
  readonly bugTypeKeys: ReadonlySet<string>;
  readonly projectInfoTypeKeys: ReadonlySet<string>;
};

type SelectionState = {
  readonly records: AcceptedEvidenceRecord[];
  readonly seenKeys: Set<string>;
  malformedEventCount: number;
  irrelevantEventCount: number;
  deduplicatedRecordCount: number;
};

@Injectable()
export class AcceptedEvidenceSelectorService {
  private readonly logger = new Logger(AcceptedEvidenceSelectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectAccess: ProjectAccessService,
    private readonly workItemTypeRegistry: WorkItemTypeRegistryService,
    @Inject(PROJECT_METRICS_CLOCK)
    private readonly clock: ProjectMetricsClock,
  ) {}

  async select(
    request: ProjectMetricsRequest,
    options: AcceptedEvidenceSelectionOptions = {},
  ): Promise<AcceptedEvidenceSelection> {
    if (
      options.metric !== undefined &&
      !PROJECT_METRIC_IDENTITIES.includes(options.metric)
    ) {
      throw new BadRequestException(
        `Unsupported Activity metric continuation: ${options.metric}`,
      );
    }
    const effectiveProjectIds = await this.resolveEffectiveProjectIds(
      request,
      options.projectIds,
    );
    const { windowStart, windowEnd } = this.resolveWindow(options);

    this.logger.debug('[project-metrics] resolved evidence boundary', {
      organizationId: request.organizationId,
      userId: request.userId,
      requestedProjectId: request.projectId ?? null,
      effectiveProjectIds,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      metric: options.metric ?? null,
    });

    if (effectiveProjectIds.length === 0) {
      this.logger.debug('[project-metrics] no accessible projects to query', {
        organizationId: request.organizationId,
      });
      return {
        effectiveProjectIds,
        windowStart,
        windowEnd,
        records: [],
        diagnostics: {
          sourceEventCount: 0,
          acceptedRecordCount: 0,
          malformedEventCount: 0,
          irrelevantEventCount: 0,
          deduplicatedRecordCount: 0,
        },
      };
    }

    const classifications =
      this.resolveProjectClassifications(effectiveProjectIds);
    const sourceEvents = await this.loadSourceEvents(
      request.organizationId,
      effectiveProjectIds,
      windowStart,
      windowEnd,
      PROJECT_ORGANIC_ACTIVITY_EVENT_TYPES,
    );
    const taskTypes = await this.loadTaskTypes(
      request.organizationId,
      effectiveProjectIds,
      sourceEvents,
    );

    const state: SelectionState = {
      records: [],
      seenKeys: new Set<string>(),
      malformedEventCount: 0,
      irrelevantEventCount: 0,
      deduplicatedRecordCount: 0,
    };
    const effectiveProjectIdSet = new Set(effectiveProjectIds);

    for (const sourceEvent of sourceEvents) {
      if (
        options.eventActorUserId !== undefined &&
        sourceEvent.userId !== options.eventActorUserId
      )
        continue;
      this.acceptSourceEvent(
        sourceEvent,
        effectiveProjectIdSet,
        classifications,
        taskTypes,
        windowStart,
        windowEnd,
        state,
      );
    }

    const actorScopedRecords =
      request.actorScope.mode === 'PERSONAL'
        ? state.records.filter(
            (record) =>
              record.userId ===
                ('userId' in request.actorScope
                  ? request.actorScope.userId
                  : undefined) && !record.metric.startsWith('PROJECT_INFO_'),
          )
        : state.records;
    const selectedRecords = options.metric
      ? actorScopedRecords.filter((record) => record.metric === options.metric)
      : actorScopedRecords;

    const diagnostics = {
      sourceEventCount: sourceEvents.length,
      acceptedRecordCount: selectedRecords.length,
      malformedEventCount: state.malformedEventCount,
      irrelevantEventCount: state.irrelevantEventCount,
      deduplicatedRecordCount: state.deduplicatedRecordCount,
    };
    this.logger.debug('[project-metrics] accepted evidence totals', {
      organizationId: request.organizationId,
      effectiveProjectCount: effectiveProjectIds.length,
      ...diagnostics,
    });

    return {
      effectiveProjectIds,
      windowStart,
      windowEnd,
      records: selectedRecords,
      diagnostics,
    };
  }

  /**
   * Resolve the current authorization boundary without loading evidence. The
   * Activity query uses this for canonical non-metric evidence such as
   * attention rows, while metric queries use select() so authorization and
   * classification stay on one path.
   */
  async resolveAuthorizedProjectIds(
    request: ProjectMetricsRequest,
    requestedProjectIds?: readonly ProjectId[],
  ): Promise<ProjectId[]> {
    return this.resolveEffectiveProjectIds(request, requestedProjectIds);
  }

  /**
   * Ordinary-mode Activity evidence for work-item creation, updates and status
   * entry. Shares select()'s event source, replay and window rules but not its
   * metric classification: every work-item type counts here, while rolling
   * metrics keep their closed vocabulary.
   */
  async selectWorkItemLifecycle(
    organizationId: OrganizationId,
    options: WorkItemLifecycleSelectionOptions,
  ): Promise<WorkItemLifecycleRecord[]> {
    if (options.projectIds.length === 0) {
      this.logger.debug('[work-item-lifecycle] no projects to query', {
        organizationId,
      });
      return [];
    }

    const sourceEvents = await this.loadSourceEvents(
      organizationId,
      options.projectIds,
      options.windowStart,
      options.windowEnd,
      WORK_ITEM_LIFECYCLE_EVENT_TYPES,
      options.eventActorUserId,
    );
    const taskTypes = await this.loadTaskTypes(
      organizationId,
      options.projectIds,
      sourceEvents,
    );
    const projectIdSet = new Set(options.projectIds.map(String));
    const seenKeys = new Set<string>();
    const records: WorkItemLifecycleRecord[] = [];
    let skippedEventCount = 0;
    let deduplicatedRecordCount = 0;

    for (const sourceEvent of sourceEvents) {
      const accepted = this.acceptLifecycleEvent(
        sourceEvent,
        projectIdSet,
        taskTypes,
        options.windowStart,
        options.windowEnd,
      );
      if (!accepted) {
        skippedEventCount += 1;
        continue;
      }
      const key = `${accepted.kind}:${sourceEvent.projectId}:${accepted.dedupeKey}`;
      if (seenKeys.has(key)) {
        deduplicatedRecordCount += 1;
        continue;
      }
      seenKeys.add(key);
      records.push({
        kind: accepted.kind,
        projectId: sourceEvent.projectId as ProjectId,
        entityId: sourceEvent.aggregateId,
        eventId: sourceEvent.id,
        eventType: sourceEvent.eventType,
        occurredAt: accepted.occurredAt,
        userId: sourceEvent.userId as UserId | null,
        conversationId: sourceEvent.conversationId ?? null,
      });
    }

    this.logger.debug('[work-item-lifecycle] selected lifecycle evidence', {
      organizationId,
      projectCount: options.projectIds.length,
      eventActorUserId: options.eventActorUserId ?? null,
      windowStart: options.windowStart.toISOString(),
      windowEnd: options.windowEnd.toISOString(),
      sourceEventCount: sourceEvents.length,
      recordCount: records.length,
      skippedEventCount,
      deduplicatedRecordCount,
    });
    return records;
  }

  private acceptLifecycleEvent(
    sourceEvent: SourceEventRow,
    projectIds: ReadonlySet<string>,
    taskTypes: ReadonlyMap<string, TaskTypeRow>,
    windowStart: Date,
    windowEnd: Date,
  ): {
    kind: WorkItemLifecycleKind;
    dedupeKey: string;
    occurredAt: Date;
  } | null {
    const projectId = sourceEvent.projectId;
    if (
      !projectId ||
      !projectIds.has(projectId) ||
      sourceEvent.aggregateType !== 'task' ||
      !sourceEvent.aggregateId
    ) {
      return null;
    }
    // A missing row means the work item is gone (or moved out of scope);
    // canonical hydration requires a title, so it cannot be emitted.
    const taskRow = taskTypes.get(sourceEvent.aggregateId);
    if (!taskRow || taskRow.projectId !== projectId) {
      return null;
    }
    const payload = this.asRecord(sourceEvent.payload);
    const occurredAt = payload
      ? this.resolveOccurrenceDate(sourceEvent, payload)
      : null;
    if (
      !payload ||
      !occurredAt ||
      occurredAt < windowStart ||
      occurredAt >= windowEnd
    ) {
      return null;
    }

    switch (sourceEvent.eventType) {
      case EVENT_TYPES.TASK.CREATED: {
        const taskSnapshot = this.asRecord(payload.task);
        if (
          !taskSnapshot ||
          this.readString(taskSnapshot, 'id') !== sourceEvent.aggregateId ||
          this.readString(taskSnapshot, 'projectId') !== projectId
        ) {
          return null;
        }
        return {
          kind: 'CREATED',
          dedupeKey: sourceEvent.aggregateId,
          occurredAt,
        };
      }
      case EVENT_TYPES.TASK.UPDATED:
      case EVENT_TYPES.TASK.CONTENT_CHANGED: {
        const update = this.asRecord(
          sourceEvent.eventType === EVENT_TYPES.TASK.UPDATED
            ? payload.update
            : payload.content,
        );
        if (!update) {
          return null;
        }
        return {
          kind: 'UPDATED',
          dedupeKey: this.logicalUpdateKey(sourceEvent),
          occurredAt,
        };
      }
      case EVENT_TYPES.TASK.STATUS_CHANGED: {
        const previousStatus = this.readString(payload, 'previousStatus');
        const newStatus = this.readString(payload, 'newStatus');
        if (!previousStatus || !newStatus || previousStatus === newStatus) {
          return null;
        }
        return {
          kind: 'STATUS_ENTERED',
          dedupeKey: sourceEvent.id,
          occurredAt,
        };
      }
      default:
        return null;
    }
  }

  private async resolveEffectiveProjectIds(
    request: ProjectMetricsRequest,
    requestedProjectIds?: readonly ProjectId[],
  ): Promise<ProjectId[]> {
    const accessibleProjectIds = (await this.projectAccess.accessibleProjectIds(
      request.userId,
      request.organizationId,
    )) as ProjectId[];

    if (
      request.projectId !== undefined &&
      !accessibleProjectIds.includes(request.projectId)
    ) {
      this.logger.warn('[project-metrics] project narrowing denied', {
        organizationId: request.organizationId,
        userId: request.userId,
        requestedProjectId: request.projectId,
        accessibleProjectCount: accessibleProjectIds.length,
      });
      throw new ForbiddenException(
        'Requested project is not accessible in this organization',
      );
    }

    if (requestedProjectIds !== undefined) {
      const normalizedRequestedProjectIds = [
        ...new Set(
          requestedProjectIds.map((projectId) => String(projectId).trim()),
        ),
      ].filter((projectId) => projectId.length > 0) as ProjectId[];
      const accessibleProjectIdSet = new Set(accessibleProjectIds);
      const unauthorizedProjectId = normalizedRequestedProjectIds.find(
        (projectId) => !accessibleProjectIdSet.has(projectId),
      );
      if (unauthorizedProjectId) {
        this.logger.warn('[project-metrics] continuation scope denied', {
          organizationId: request.organizationId,
          userId: request.userId,
          requestedProjectId: unauthorizedProjectId,
          accessibleProjectCount: accessibleProjectIds.length,
        });
        throw new ForbiddenException(
          'Activity continuation contains an inaccessible project',
        );
      }

      if (
        request.projectId !== undefined &&
        (normalizedRequestedProjectIds.length !== 1 ||
          normalizedRequestedProjectIds[0] !== request.projectId)
      ) {
        this.logger.warn(
          '[project-metrics] continuation scope conflicts with narrowing',
          {
            organizationId: request.organizationId,
            userId: request.userId,
            requestedProjectId: request.projectId,
            continuationProjectCount: normalizedRequestedProjectIds.length,
          },
        );
        throw new ForbiddenException(
          'Activity continuation scope does not match the requested project',
        );
      }

      return normalizedRequestedProjectIds;
    }

    const effectiveProjectIds = request.projectId
      ? [request.projectId]
      : accessibleProjectIds;
    this.logger.debug('[project-metrics] authorization scope accepted', {
      organizationId: request.organizationId,
      userId: request.userId,
      accessibleProjectCount: accessibleProjectIds.length,
      effectiveProjectCount: effectiveProjectIds.length,
      narrowed: request.projectId !== undefined,
    });
    return effectiveProjectIds;
  }

  private resolveWindow(options: AcceptedEvidenceSelectionOptions): {
    windowStart: Date;
    windowEnd: Date;
  } {
    if (options.windowStart !== undefined || options.windowEnd !== undefined) {
      if (
        options.windowStart === undefined ||
        options.windowEnd === undefined
      ) {
        throw new BadRequestException(
          'Activity evidence window requires both windowStart and windowEnd',
        );
      }

      const windowStart = new Date(options.windowStart.getTime());
      const windowEnd = new Date(options.windowEnd.getTime());
      if (
        !Number.isFinite(windowStart.getTime()) ||
        !Number.isFinite(windowEnd.getTime()) ||
        windowStart >= windowEnd
      ) {
        throw new BadRequestException(
          'Activity evidence window must be finite and have a start before its end',
        );
      }

      return { windowStart, windowEnd };
    }

    const clockValue = this.clock();
    const windowEnd = new Date(clockValue.getTime());
    if (!Number.isFinite(windowEnd.getTime())) {
      throw new Error('Project metrics clock returned an invalid date');
    }
    return {
      windowStart: new Date(windowEnd.getTime() - PROJECT_METRICS_WINDOW_MS),
      windowEnd,
    };
  }

  private resolveProjectClassifications(
    projectIds: readonly ProjectId[],
  ): Map<string, ProjectClassification> {
    const classifications = new Map<string, ProjectClassification>();

    for (const projectId of projectIds) {
      const definitions = this.workItemTypeRegistry.getDefinitions(projectId);
      const activeDefinitions = this.workItemTypeRegistry.getDefinitions(
        projectId,
        WorkItemTypeLifecycleStatus.Active,
      );
      const taskTypeKeys = new Set<string>();
      const bugTypeKeys = new Set<string>();
      const projectInfoTypeKeys = new Set<string>();

      for (const summary of definitions) {
        if (summary.definition.role !== WorkItemTypeRole.WorkItem) {
          continue;
        }
        if (summary.definition.key === WORK_ITEM_TYPE_KEYS.Standard) {
          taskTypeKeys.add(summary.definition.key);
        }
        if (summary.definition.key === WORK_ITEM_TYPE_KEYS.Bug) {
          bugTypeKeys.add(summary.definition.key);
        }
      }
      for (const summary of activeDefinitions) {
        if (summary.definition.role === WorkItemTypeRole.ProjectInfo) {
          projectInfoTypeKeys.add(summary.definition.key);
        }
      }

      classifications.set(String(projectId), {
        taskTypeKeys,
        bugTypeKeys,
        projectInfoTypeKeys,
      });
    }

    this.logger.debug('[project-metrics] resolved registry classifications', {
      projectCount: projectIds.length,
      classifications: [...classifications.entries()].map(
        ([projectId, classification]) => ({
          projectId,
          taskTypeCount: classification.taskTypeKeys.size,
          bugTypeCount: classification.bugTypeKeys.size,
          projectInfoTypeCount: classification.projectInfoTypeKeys.size,
        }),
      ),
    });
    return classifications;
  }

  private async loadSourceEvents(
    organizationId: OrganizationId,
    projectIds: readonly ProjectId[],
    windowStart: Date,
    windowEnd: Date,
    eventTypes: readonly string[],
    actorUserId?: UserId,
  ): Promise<SourceEventRow[]> {
    const rows = await this.prisma.db.outboxEvent.findMany({
      where: {
        organizationId,
        projectId: { in: [...projectIds] },
        eventType: { in: [...eventTypes] },
        status: OutboxEventStatus.PUBLISHED,
        createdAt: { gte: windowStart, lt: windowEnd },
        ...(actorUserId === undefined ? {} : { userId: actorUserId }),
      },
      select: {
        id: true,
        eventType: true,
        aggregateType: true,
        aggregateId: true,
        payload: true,
        createdAt: true,
        headers: true,
        correlationId: true,
        causationId: true,
        projectId: true,
        userId: true,
        conversationId: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows as SourceEventRow[];
  }

  private async loadTaskTypes(
    organizationId: OrganizationId,
    projectIds: readonly ProjectId[],
    sourceEvents: readonly SourceEventRow[],
  ): Promise<Map<string, TaskTypeRow>> {
    const taskIds = [
      ...new Set(
        sourceEvents
          .filter((event) => event.eventType.startsWith('task.'))
          .map((event) => event.aggregateId)
          .filter((id) => typeof id === 'string' && id.length > 0),
      ),
    ];
    if (taskIds.length === 0) {
      return new Map();
    }

    const rows = await this.prisma.db.task.findMany({
      where: {
        id: { in: taskIds },
        organizationId,
        projectId: { in: [...projectIds] },
      },
      select: { id: true, type: true, projectId: true },
    });
    return new Map(rows.map((row) => [String(row.id), row as TaskTypeRow]));
  }

  private acceptSourceEvent(
    sourceEvent: SourceEventRow,
    effectiveProjectIds: ReadonlySet<ProjectId>,
    classifications: ReadonlyMap<string, ProjectClassification>,
    taskTypes: ReadonlyMap<string, TaskTypeRow>,
    windowStart: Date,
    windowEnd: Date,
    state: SelectionState,
  ): void {
    const projectId = sourceEvent.projectId;
    if (!projectId || !effectiveProjectIds.has(projectId as ProjectId)) {
      state.irrelevantEventCount += 1;
      return;
    }

    if (!sourceEvent.aggregateId) {
      state.malformedEventCount += 1;
      return;
    }

    const expectedAggregateType = sourceEvent.eventType.startsWith('task.')
      ? 'task'
      : sourceEvent.eventType === EVENT_TYPES.AGENT_SESSION.CREATED
        ? 'agent_session'
        : null;
    if (sourceEvent.aggregateType !== expectedAggregateType) {
      state.malformedEventCount += 1;
      return;
    }

    const payload = this.asRecord(sourceEvent.payload);
    if (!payload) {
      state.malformedEventCount += 1;
      return;
    }

    const occurredAt = this.resolveOccurrenceDate(sourceEvent, payload);
    if (!occurredAt || occurredAt < windowStart || occurredAt >= windowEnd) {
      state.malformedEventCount += 1;
      return;
    }

    const classification = classifications.get(projectId);
    if (!classification) {
      state.irrelevantEventCount += 1;
      return;
    }

    if (sourceEvent.eventType.startsWith('task.')) {
      this.acceptTaskEvent(
        sourceEvent,
        projectId as ProjectId,
        occurredAt,
        payload,
        classification,
        taskTypes.get(sourceEvent.aggregateId),
        state,
      );
      return;
    }
    if (sourceEvent.eventType === EVENT_TYPES.AGENT_SESSION.CREATED) {
      this.acceptAgentSessionEvent(
        sourceEvent,
        projectId as ProjectId,
        occurredAt,
        payload,
        state,
      );
      return;
    }

    state.irrelevantEventCount += 1;
  }

  private acceptTaskEvent(
    sourceEvent: SourceEventRow,
    projectId: ProjectId,
    occurredAt: Date,
    payload: Record<string, unknown>,
    classification: ProjectClassification,
    taskRow: TaskTypeRow | undefined,
    state: SelectionState,
  ): void {
    if (taskRow && taskRow.projectId !== projectId) {
      state.malformedEventCount += 1;
      return;
    }

    switch (sourceEvent.eventType) {
      case EVENT_TYPES.TASK.CREATED: {
        const taskSnapshot = this.asRecord(payload.task);
        const taskId = taskSnapshot
          ? this.readString(taskSnapshot, 'id')
          : null;
        const snapshotProjectId = taskSnapshot
          ? this.readString(taskSnapshot, 'projectId')
          : null;
        const taskType = taskSnapshot
          ? this.readString(taskSnapshot, 'type')
          : null;
        if (
          !taskSnapshot ||
          taskId !== sourceEvent.aggregateId ||
          snapshotProjectId !== projectId ||
          !taskType
        ) {
          state.malformedEventCount += 1;
          return;
        }
        if (taskType === WORK_ITEM_TYPE_KEYS.Plan) {
          this.addRecord(
            state,
            ProjectMetricIdentity.PlanCreated,
            projectId,
            sourceEvent,
            occurredAt,
            sourceEvent.aggregateId,
          );
        }
        this.acceptTaskClassification(
          taskType,
          ProjectMetricIdentity.TaskCreated,
          ProjectMetricIdentity.BugCreated,
          ProjectMetricIdentity.ProjectInfoCreated,
          projectId,
          sourceEvent,
          occurredAt,
          classification,
          state,
        );
        return;
      }
      case EVENT_TYPES.TASK.UPDATED:
      case EVENT_TYPES.TASK.CONTENT_CHANGED: {
        const update = this.asRecord(
          sourceEvent.eventType === EVENT_TYPES.TASK.UPDATED
            ? payload.update
            : payload.content,
        );
        if (!update) {
          state.malformedEventCount += 1;
          return;
        }
        const updateTypeValue = update.type;
        const taskType =
          updateTypeValue === undefined
            ? (taskRow?.type ?? null)
            : this.readString(update, 'type');
        if (!taskType) {
          state.malformedEventCount += 1;
          return;
        }
        if (classification.projectInfoTypeKeys.has(taskType)) {
          this.addRecord(
            state,
            ProjectMetricIdentity.ProjectInfoUpdated,
            projectId,
            sourceEvent,
            occurredAt,
            this.logicalUpdateKey(sourceEvent),
          );
        } else {
          state.irrelevantEventCount += 1;
        }
        return;
      }
      case EVENT_TYPES.TASK.STATUS_CHANGED: {
        const previousStatus = this.readString(payload, 'previousStatus');
        const newStatus = this.readString(payload, 'newStatus');
        const taskType = taskRow?.type ?? null;
        if (!previousStatus || !newStatus || !taskType) {
          state.malformedEventCount += 1;
          return;
        }
        if (previousStatus === newStatus) {
          state.irrelevantEventCount += 1;
          return;
        }
        const metric =
          newStatus === WorkStatus.Completed
            ? taskType === WORK_ITEM_TYPE_KEYS.Plan
              ? ProjectMetricIdentity.PlanCompleted
              : classification.taskTypeKeys.has(taskType)
                ? ProjectMetricIdentity.TaskCompleted
                : classification.bugTypeKeys.has(taskType)
                  ? ProjectMetricIdentity.BugCompleted
                  : null
            : newStatus === WorkStatus.Verifying
              ? taskType === WORK_ITEM_TYPE_KEYS.Plan
                ? ProjectMetricIdentity.PlanVerifying
                : classification.taskTypeKeys.has(taskType)
                  ? ProjectMetricIdentity.TaskVerifying
                  : classification.bugTypeKeys.has(taskType)
                    ? ProjectMetricIdentity.BugVerifying
                    : null
              : null;
        if (!metric) {
          state.irrelevantEventCount += 1;
          return;
        }
        this.addRecord(
          state,
          metric,
          projectId,
          sourceEvent,
          occurredAt,
          sourceEvent.aggregateId,
        );
        return;
      }
      default:
        state.irrelevantEventCount += 1;
    }
  }

  private acceptTaskClassification(
    taskType: string,
    taskMetric: ProjectMetricIdentity,
    bugMetric: ProjectMetricIdentity,
    projectInfoMetric: ProjectMetricIdentity,
    projectId: ProjectId,
    sourceEvent: SourceEventRow,
    occurredAt: Date,
    classification: ProjectClassification,
    state: SelectionState,
  ): void {
    if (classification.taskTypeKeys.has(taskType)) {
      this.addRecord(
        state,
        taskMetric,
        projectId,
        sourceEvent,
        occurredAt,
        sourceEvent.aggregateId,
      );
      return;
    }
    if (classification.bugTypeKeys.has(taskType)) {
      this.addRecord(
        state,
        bugMetric,
        projectId,
        sourceEvent,
        occurredAt,
        sourceEvent.aggregateId,
      );
      return;
    }
    if (classification.projectInfoTypeKeys.has(taskType)) {
      this.addRecord(
        state,
        projectInfoMetric,
        projectId,
        sourceEvent,
        occurredAt,
        sourceEvent.aggregateId,
      );
      return;
    }
    state.irrelevantEventCount += 1;
  }

  private acceptAgentSessionEvent(
    sourceEvent: SourceEventRow,
    projectId: ProjectId,
    occurredAt: Date,
    payload: Record<string, unknown>,
    state: SelectionState,
  ): void {
    const agentSession = this.asRecord(payload.agentSession);
    if (
      !agentSession ||
      this.readString(agentSession, 'id') !== sourceEvent.aggregateId ||
      this.readString(agentSession, 'projectId') !== projectId
    ) {
      state.malformedEventCount += 1;
      return;
    }
    this.addRecord(
      state,
      ProjectMetricIdentity.AgentSessionCreated,
      projectId,
      sourceEvent,
      occurredAt,
      sourceEvent.aggregateId,
    );
  }

  private addRecord(
    state: SelectionState,
    metric: ProjectMetricIdentity,
    projectId: ProjectId,
    sourceEvent: SourceEventRow,
    occurredAt: Date,
    dedupeKey: string,
  ): void {
    const key = `${metric}:${projectId}:${dedupeKey}`;
    if (state.seenKeys.has(key)) {
      state.deduplicatedRecordCount += 1;
      return;
    }
    state.seenKeys.add(key);
    state.records.push({
      metric,
      projectId,
      entityId: sourceEvent.aggregateId,
      eventId: sourceEvent.id,
      eventType: sourceEvent.eventType,
      aggregateType: sourceEvent.aggregateType,
      occurredAt,
      correlationId: sourceEvent.correlationId ?? null,
      causationId: sourceEvent.causationId ?? null,
      payload: sourceEvent.payload,
      userId: sourceEvent.userId as UserId | null,
      conversationId: sourceEvent.conversationId ?? null,
    });
  }

  private logicalUpdateKey(sourceEvent: SourceEventRow): string {
    const lineageId = sourceEvent.causationId || sourceEvent.correlationId;
    return lineageId
      ? `${sourceEvent.aggregateType}:${sourceEvent.aggregateId}:${lineageId}`
      : `${sourceEvent.aggregateType}:${sourceEvent.aggregateId}:event:${sourceEvent.id}`;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private readString(
    record: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = record[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private resolveOccurrenceDate(
    sourceEvent: SourceEventRow,
    _payload: Record<string, unknown>,
  ): Date | null {
    const headers = this.asRecord(sourceEvent.headers);
    if (headers?.replayed === true) {
      return null;
    }
    const date = sourceEvent.createdAt;
    if (!date || !Number.isFinite(date.getTime())) {
      return null;
    }
    return date;
  }
}

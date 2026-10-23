import { BadRequestException, Injectable } from '@nestjs/common';
import {
  AgentSessionType as PrismaAgentSessionType,
  MessageType,
} from '@prisma/client';
import {
  EntityType,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
} from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { OrganizationId, ProjectId, UserId } from 'src/types';
import { ActivitySleepService } from './activity-sleep.service';
import {
  EntityRef,
  RecentActivityQuery,
  RecentSeedPage,
  RecentSeedRankingMetadata,
  toEntityKey,
} from './activity-correlation.types';
import { isRecentAllowedEntityType } from './activity-correlation.graph-mappers';
import {
  TIMELINE_MESSAGE_WHERE,
  timelineCreatedAt,
} from 'src/utils/message-timeline.util';

type AttentionSeedEvent = {
  entityId: string;
  entityType: EntityType;
  focusStart: string;
  focusEnd: string;
  durationMs: number;
};

type AgentSessionSeedRow = {
  id: string;
  updatedAt: Date;
  conversationId: string | null;
  taskId: string | null;
};

type TaskSeedRow = {
  id: string;
  updatedAt: Date;
};

@Injectable()
export class ActivityCorrelationSeedSelectorService {
  private static readonly ACTIVITY_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly activitySleepService: ActivitySleepService,
  ) {}

  async selectSeeds(
    organizationId: OrganizationId,
    query: RecentActivityQuery,
  ): Promise<RecentSeedPage> {
    const mode = query.mode ?? RecentActivityCorrelationMode.Activity;
    const sort = this.resolveSort(mode, query.sort);

    switch (mode) {
      case RecentActivityCorrelationMode.Activity:
        return this.selectActivitySeeds(organizationId, query, sort);
      case RecentActivityCorrelationMode.Task:
        return this.selectTaskSeeds(organizationId, query, sort);
      case RecentActivityCorrelationMode.AgentSession:
        return this.selectAgentSessionSeeds(
          organizationId,
          query,
          sort,
          { not: PrismaAgentSessionType.CODING },
          true,
        );
      case RecentActivityCorrelationMode.CodingSession:
        return this.selectAgentSessionSeeds(
          organizationId,
          query,
          sort,
          PrismaAgentSessionType.CODING,
        );
      default:
        throw new BadRequestException(
          `Unsupported recent activity mode: ${mode}`,
        );
    }
  }

  private resolveSort(
    mode: RecentActivityCorrelationMode,
    sort?: RecentActivityCorrelationSort,
  ): RecentActivityCorrelationSort {
    const resolvedSort =
      sort ??
      (mode === RecentActivityCorrelationMode.Activity
        ? RecentActivityCorrelationSort.Mixed
        : RecentActivityCorrelationSort.LastUpdated);

    if (
      mode === RecentActivityCorrelationMode.Activity &&
      ![
        RecentActivityCorrelationSort.MostRecent,
        RecentActivityCorrelationSort.MostActive,
        RecentActivityCorrelationSort.Mixed,
      ].includes(resolvedSort)
    ) {
      throw new BadRequestException(
        `Unsupported sort for recent activity mode ${mode}: ${resolvedSort}`,
      );
    }

    if (
      (mode === RecentActivityCorrelationMode.Task ||
        mode === RecentActivityCorrelationMode.AgentSession ||
        mode === RecentActivityCorrelationMode.CodingSession) &&
      ![
        RecentActivityCorrelationSort.LastUpdated,
        RecentActivityCorrelationSort.LastMessage,
      ].includes(resolvedSort)
    ) {
      throw new BadRequestException(
        `Unsupported sort for recent activity mode ${mode}: ${resolvedSort}`,
      );
    }

    return resolvedSort;
  }

  private async selectActivitySeeds(
    organizationId: OrganizationId,
    query: RecentActivityQuery,
    sort: RecentActivityCorrelationSort,
  ): Promise<RecentSeedPage> {
    const since = new Date(
      Date.now() - ActivityCorrelationSeedSelectorService.ACTIVITY_LOOKBACK_MS,
    );

    const rows = await this.prisma.db.attentionEvent.findMany({
      where: {
        organizationId,
        userId: query.userId,
        projectId: query.projectId,
        focusEnd: { gte: since },
      },
      orderBy: { focusEnd: 'desc' },
      select: {
        entityId: true,
        entityType: true,
        focusStart: true,
        focusEnd: true,
        durationMs: true,
      },
    });

    const events = await this.activitySleepService.filterAwakeEntities(
      organizationId,
      query.userId,
      rows
        .map((row) => ({
          entityId: row.entityId,
          entityType: row.entityType as EntityType,
          focusStart: row.focusStart.toISOString(),
          focusEnd: row.focusEnd.toISOString(),
          durationMs: row.durationMs,
        }))
        .filter((event) => isRecentAllowedEntityType(event.entityType)),
    );

    const ranked = this.rankActivityEvents(
      events,
      sort,
      query.offset + query.limit,
    );
    const deduped =
      sort === RecentActivityCorrelationSort.Mixed
        ? ranked
        : this.dedupeAttentionEventsPreservingOrder(ranked);

    const rankingMetadataBySeed = new Map<string, RecentSeedRankingMetadata>();
    const seeds: EntityRef[] = deduped.map((event) => {
      const seed = {
        entityId: event.entityId,
        entityType: event.entityType,
      } satisfies EntityRef;
      rankingMetadataBySeed.set(toEntityKey(seed), {
        timestamp: event.focusEnd,
      });
      return seed;
    });

    return this.pageSeeds(seeds, rankingMetadataBySeed, query);
  }

  private async selectTaskSeeds(
    organizationId: OrganizationId,
    query: RecentActivityQuery,
    sort: RecentActivityCorrelationSort,
  ): Promise<RecentSeedPage> {
    const interactedTaskIds = await this.loadInteractedTaskIds(
      organizationId,
      query.projectId,
      query.userId,
    );

    const taskWhere = {
      organizationId,
      archivedAt: null,
      projectId: query.projectId,
      OR: [
        { assigneeId: query.userId },
        { creatorId: query.userId },
        ...(interactedTaskIds.length > 0
          ? [{ id: { in: interactedTaskIds } }]
          : []),
      ],
    };

    const tasks = await this.filterAwakeTaskRows(
      organizationId,
      query.userId,
      (await this.prisma.db.task.findMany({
        where: taskWhere,
        select: {
          id: true,
          updatedAt: true,
        },
        orderBy:
          sort === RecentActivityCorrelationSort.LastUpdated
            ? [{ updatedAt: 'desc' }, { id: 'desc' }]
            : undefined,
      })) as TaskSeedRow[],
    );

    if (tasks.length === 0) {
      return {
        seeds: [],
        total: 0,
        rankingMetadataBySeed: new Map(),
      };
    }

    if (sort === RecentActivityCorrelationSort.LastUpdated) {
      const rankingMetadataBySeed = new Map<
        string,
        RecentSeedRankingMetadata
      >();
      const seeds = tasks.map((task) => {
        const seed = {
          entityId: task.id,
          entityType: EntityType.Task,
        } satisfies EntityRef;
        rankingMetadataBySeed.set(toEntityKey(seed), {
          timestamp: task.updatedAt.toISOString(),
        });
        return seed;
      });
      return this.pageSeeds(seeds, rankingMetadataBySeed, query);
    }

    const taskMessages = await this.loadLatestMessageTimestampByTaskId(
      organizationId,
      query.userId,
      tasks.map((task) => task.id),
    );
    const rankedTasks = [...tasks].sort((left, right) => {
      const leftMessage = taskMessages.get(left.id);
      const rightMessage = taskMessages.get(right.id);
      const leftTime =
        leftMessage?.toISOString() ?? left.updatedAt.toISOString();
      const rightTime =
        rightMessage?.toISOString() ?? right.updatedAt.toISOString();
      if (leftTime !== rightTime) {
        return rightTime.localeCompare(leftTime);
      }
      return right.id.localeCompare(left.id);
    });

    const rankingMetadataBySeed = new Map<string, RecentSeedRankingMetadata>();
    const seeds = rankedTasks.map((task) => {
      const seed = {
        entityId: task.id,
        entityType: EntityType.Task,
      } satisfies EntityRef;
      rankingMetadataBySeed.set(toEntityKey(seed), {
        timestamp:
          taskMessages.get(task.id)?.toISOString() ??
          task.updatedAt.toISOString(),
      });
      return seed;
    });
    return this.pageSeeds(seeds, rankingMetadataBySeed, query);
  }

  private async selectAgentSessionSeeds(
    organizationId: OrganizationId,
    query: RecentActivityQuery,
    sort: RecentActivityCorrelationSort,
    typeFilter: PrismaAgentSessionType | { not: PrismaAgentSessionType },
    requireUserMessages = false,
  ): Promise<RecentSeedPage> {
    const sessions = await this.filterAwakeAgentSessionRows(
      organizationId,
      query.userId,
      (await this.prisma.db.agentSession
        .findMany({
          where: {
            organizationId,
            userId: query.userId,
            projectId: query.projectId,
            type: typeFilter,
            ...(requireUserMessages && {
              conversation: {
                messages: {
                  some: {
                    type: MessageType.USER,
                  },
                },
              },
            }),
          },
          select: {
            id: true,
            updatedAt: true,
            conversationId: true,
            entityType: true,
            entityId: true,
          },
          orderBy:
            sort === RecentActivityCorrelationSort.LastUpdated
              ? [{ updatedAt: 'desc' }, { id: 'desc' }]
              : undefined,
        })
        .then((rows) =>
          rows.map((row) => ({
            id: row.id,
            updatedAt: row.updatedAt,
            conversationId: row.conversationId,
            taskId: row.entityType === 'TASK' ? row.entityId : null,
          })),
        )) as AgentSessionSeedRow[],
    );

    if (sessions.length === 0) {
      return {
        seeds: [],
        total: 0,
        rankingMetadataBySeed: new Map(),
      };
    }

    if (sort === RecentActivityCorrelationSort.LastUpdated) {
      const rankingMetadataBySeed = new Map<
        string,
        RecentSeedRankingMetadata
      >();
      const seeds = sessions.map((session) => {
        const seed = {
          entityId: session.id,
          entityType: EntityType.AgentSession,
        } satisfies EntityRef;
        rankingMetadataBySeed.set(toEntityKey(seed), {
          timestamp: session.updatedAt.toISOString(),
          conversationId: session.conversationId,
        });
        return seed;
      });
      return this.pageSeeds(seeds, rankingMetadataBySeed, query);
    }

    const latestMessageTimestamps =
      await this.loadLatestMessageTimestampByConversationId(
        organizationId,
        sessions
          .map((session) => session.conversationId)
          .filter(
            (conversationId): conversationId is string => !!conversationId,
          ),
      );
    const rankedSessions = [...sessions].sort((left, right) => {
      const leftTime =
        (left.conversationId
          ? latestMessageTimestamps.get(left.conversationId)?.toISOString()
          : undefined) ?? left.updatedAt.toISOString();
      const rightTime =
        (right.conversationId
          ? latestMessageTimestamps.get(right.conversationId)?.toISOString()
          : undefined) ?? right.updatedAt.toISOString();
      if (leftTime !== rightTime) {
        return rightTime.localeCompare(leftTime);
      }
      return right.id.localeCompare(left.id);
    });

    const rankingMetadataBySeed = new Map<string, RecentSeedRankingMetadata>();
    const seeds = rankedSessions.map((session) => {
      const seed = {
        entityId: session.id,
        entityType: EntityType.AgentSession,
      } satisfies EntityRef;
      rankingMetadataBySeed.set(toEntityKey(seed), {
        timestamp:
          (session.conversationId
            ? latestMessageTimestamps.get(session.conversationId)?.toISOString()
            : undefined) ?? session.updatedAt.toISOString(),
        conversationId: session.conversationId,
      });
      return seed;
    });
    return this.pageSeeds(seeds, rankingMetadataBySeed, query);
  }

  private async loadInteractedTaskIds(
    organizationId: OrganizationId,
    projectId: ProjectId,
    userId: string,
  ): Promise<string[]> {
    const [attentionTaskIds, agentSessionTaskIds] = await Promise.all([
      this.prisma.db.attentionEvent.findMany({
        where: {
          organizationId,
          userId,
          projectId,
          entityType: EntityType.Task,
        },
        distinct: ['entityId'],
        select: { entityId: true },
      }),
      this.prisma.db.agentSession
        .findMany({
          where: {
            organizationId,
            userId,
            type: PrismaAgentSessionType.CODING,
            entityType: 'TASK',
            entityId: { not: null },
          },
          distinct: ['entityId'],
          select: { entityId: true },
        })
        .then(async (rows) => {
          const candidateTaskIds = rows
            .map((row) => row.entityId)
            .filter((id): id is string => !!id);
          if (candidateTaskIds.length === 0) {
            return [];
          }
          const tasks = await this.prisma.db.task.findMany({
            where: {
              id: { in: candidateTaskIds },
              organizationId,
              projectId,
            },
            select: { id: true },
          });
          return tasks.map((task) => ({ entityId: task.id }));
        }),
    ]);

    return [
      ...new Set([
        ...attentionTaskIds.map((row) => row.entityId as string),
        ...agentSessionTaskIds.map((row) => row.entityId),
      ]),
    ];
  }

  private async loadLatestMessageTimestampByTaskId(
    organizationId: OrganizationId,
    userId: string,
    taskIds: string[],
  ): Promise<Map<string, Date>> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const sessions = await this.prisma.db.agentSession.findMany({
      where: {
        organizationId,
        userId,
        type: PrismaAgentSessionType.CODING,
        entityType: 'TASK',
        entityId: { in: taskIds },
      },
      select: {
        entityId: true,
        conversationId: true,
        updatedAt: true,
      },
    });

    const byConversationId =
      await this.loadLatestMessageTimestampByConversationId(
        organizationId,
        sessions
          .map((session) => session.conversationId)
          .filter(
            (conversationId): conversationId is string => !!conversationId,
          ),
      );

    const byTaskId = new Map<string, Date>();
    sessions.forEach((session) => {
      if (!session.entityId) {
        return;
      }
      const timestamp =
        (session.conversationId
          ? byConversationId.get(session.conversationId)
          : undefined) ?? session.updatedAt;
      const current = byTaskId.get(session.entityId);
      if (!current || timestamp > current) {
        byTaskId.set(session.entityId, timestamp);
      }
    });

    return byTaskId;
  }

  private async loadLatestMessageTimestampByConversationId(
    organizationId: OrganizationId,
    conversationIds: string[],
  ): Promise<Map<string, Date>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const latestMessages = await this.prisma.db.message.findMany({
      where: {
        conversationId: { in: conversationIds },
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
      select: {
        conversationId: true,
        createdAt: true,
      },
    });

    return new Map(
      latestMessages.map((message) => [
        message.conversationId,
        timelineCreatedAt({ id: message.conversationId, ...message }),
      ]),
    );
  }

  private pageSeeds(
    rankedSeeds: EntityRef[],
    rankingMetadataBySeed: Map<string, RecentSeedRankingMetadata>,
    query: RecentActivityQuery,
  ): RecentSeedPage {
    const total = rankedSeeds.length;
    const seeds = rankedSeeds.slice(query.offset, query.offset + query.limit);
    const nextOffset =
      query.offset + query.limit < total
        ? query.offset + query.limit
        : undefined;

    return {
      seeds,
      total,
      ...(nextOffset !== undefined ? { nextOffset } : {}),
      rankingMetadataBySeed,
    };
  }

  private rankActivityEvents(
    events: AttentionSeedEvent[],
    sort: RecentActivityCorrelationSort,
    rankingLimit: number,
  ): AttentionSeedEvent[] {
    switch (sort) {
      case RecentActivityCorrelationSort.MostRecent:
        return [...events].sort((left, right) =>
          right.focusEnd.localeCompare(left.focusEnd),
        );
      case RecentActivityCorrelationSort.MostActive:
        return [...events].sort(
          (left, right) => right.durationMs - left.durationMs,
        );
      case RecentActivityCorrelationSort.Mixed: {
        const merged = this.mergeAndDeduplicateAttentionEvents(events);
        const scored = this.calculateMixedScores(
          merged,
          Math.max(rankingLimit, 1),
        );
        return scored.sort(
          (left, right) => (right.totalScore ?? 0) - (left.totalScore ?? 0),
        );
      }
      default:
        throw new BadRequestException(`Unsupported activity sort: ${sort}`);
    }
  }

  private mergeAndDeduplicateAttentionEvents(
    events: AttentionSeedEvent[],
  ): AttentionSeedEvent[] {
    const eventMap = new Map<string, AttentionSeedEvent>();

    events.forEach((event) => {
      const key = `${event.entityType}:${event.entityId}`;
      const existing = eventMap.get(key);
      if (!existing) {
        eventMap.set(key, event);
        return;
      }

      if (
        event.durationMs > existing.durationMs ||
        event.focusEnd.localeCompare(existing.focusEnd) > 0
      ) {
        eventMap.set(key, event);
      }
    });

    return [...eventMap.values()];
  }

  private dedupeAttentionEventsPreservingOrder(
    events: AttentionSeedEvent[],
  ): AttentionSeedEvent[] {
    const deduped: AttentionSeedEvent[] = [];
    const seen = new Set<string>();

    events.forEach((event) => {
      const key = `${event.entityType}:${event.entityId}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      deduped.push(event);
    });

    return deduped;
  }

  private calculateMixedScores(
    events: AttentionSeedEvent[],
    limit: number,
  ): Array<AttentionSeedEvent & { totalScore?: number }> {
    const durationPoints = this.assignRankingPoints(
      events,
      (left, right) => right.durationMs - left.durationMs,
      limit,
    );
    const recencyPoints = this.assignRankingPoints(
      events,
      (left, right) => right.focusEnd.localeCompare(left.focusEnd),
      limit,
    );

    return events.map((event) => {
      const key = `${event.entityType}:${event.entityId}`;
      return {
        ...event,
        totalScore:
          (durationPoints.get(key) ?? 0) + (recencyPoints.get(key) ?? 0),
      };
    });
  }

  private assignRankingPoints(
    events: AttentionSeedEvent[],
    sorter: (left: AttentionSeedEvent, right: AttentionSeedEvent) => number,
    limit: number,
  ): Map<string, number> {
    const points = new Map<string, number>();

    [...events].sort(sorter).forEach((event, index) => {
      points.set(
        `${event.entityType}:${event.entityId}`,
        Math.max(0, limit - index),
      );
    });

    return points;
  }

  private async filterAwakeTaskRows(
    organizationId: OrganizationId,
    userId: UserId,
    tasks: TaskSeedRow[],
  ): Promise<TaskSeedRow[]> {
    const awakeEntities = await this.activitySleepService.filterAwakeEntities(
      organizationId,
      userId,
      tasks.map((task) => ({
        entityId: task.id,
        entityType: EntityType.Task,
      })),
    );
    const awakeTaskIds = new Set(
      awakeEntities.map((entity) => entity.entityId),
    );
    return tasks.filter((task) => awakeTaskIds.has(task.id));
  }

  private async filterAwakeAgentSessionRows(
    organizationId: OrganizationId,
    userId: UserId,
    sessions: AgentSessionSeedRow[],
  ): Promise<AgentSessionSeedRow[]> {
    const awakeEntities = await this.activitySleepService.filterAwakeEntities(
      organizationId,
      userId,
      sessions.map((session) => ({
        entityId: session.id,
        entityType: EntityType.AgentSession,
      })),
    );
    const awakeSessionIds = new Set(
      awakeEntities.map((entity) => entity.entityId),
    );
    return sessions.filter((session) => awakeSessionIds.has(session.id));
  }
}

import { ProjectAccessService } from '../../auth/services/project-access.service';
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EntityType } from '@prisma/client';
import { AuthenticatedUser } from 'src/auth/strategies/jwt.strategy';
import { AttentionEvent } from 'src/generated';
import { PrismaService } from 'src/prisma/prisma.service';
import { AgentSessionService } from 'src/services/agent-session.service';
import { ConversationService } from 'src/services/conversation.service';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { ProjectService } from 'src/services/project.service';
import { TaskService } from 'src/services/tasks/task.service';
import { ConversationId, OrganizationId, TaskId } from 'src/types';

export interface TrackAttentionEventsResponse {
  eventCount: number;
  timestamp: string;
}

export interface AttentionEventWithEntity {
  id: string;
  entityType: EntityType;
  entityId: string;
  entityName: string;
  entity?: unknown | null;
  tab?: string;
  focusStart: string;
  focusEnd: string;
  durationMs: number;
}

export type AttentionEventSortMode = 'mostRecent' | 'mostActive' | 'mixed';

export interface GetAttentionEventsQuery {
  limit: number;
  offset: number;
  since?: string | number;
  sort?: AttentionEventSortMode;
  includeEntity?: boolean;
  projectId?: string;
}

export interface GetAttentionEventsResponseData {
  events: AttentionEventWithEntity[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
  };
}

/**
 * Manages user attention tracking with automatic session aggregation.
 * When rapid focus events occur on the same entity within a time window,
 * they are merged into a single focus session instead of creating duplicates.
 */
@Injectable()
export class AttentionEventService {
  private readonly logger = new Logger(AttentionEventService.name);

  // 5 minute window for merging focus sessions
  private static readonly FOCUS_SESSION_WINDOW_MS = 5 * 60 * 1000;
  private static readonly MAX_EVENTS_PER_BATCH = 100;

  constructor(
    private readonly projectAccess: ProjectAccessService,
    private readonly prisma: PrismaService,
    private readonly projectService: ProjectService,
    private readonly taskService: TaskService,
    private readonly initiativeService: InitiativeService,
    private readonly designDocService: DesignDocService,
    private readonly conversationService: ConversationService,
    private readonly agentSessionService: AgentSessionService,
  ) {}

  async recordAttentionEvents(
    user: AuthenticatedUser,
    events: AttentionEvent[],
  ): Promise<TrackAttentionEventsResponse> {
    this.validateEvents(events);
    await this.projectAccess.assertOrganization(user.userId, user.currentOrgId);

    let eventsProcessed = 0;
    let eventsMerged = 0;

    try {
      await this.prisma.db.$transaction(async (tx) => {
        for (const event of events) {
          const eventTime = new Date(event.timestamp);
          const normalizedEntityType = this.normalizeEntityTypeOrThrow(
            event.entity.type,
          );
          const projectId = await this.resolveProjectIdForEntity({
            tx,
            organizationId: user.currentOrgId,
            entityType: normalizedEntityType,
            entityId: event.entity.id,
          });
          if (projectId)
            await this.projectAccess.assertProject(
              user.userId,
              user.currentOrgId,
              projectId,
            );
          const windowStart = new Date(
            event.timestamp - AttentionEventService.FOCUS_SESSION_WINDOW_MS,
          );

          if (
            (normalizedEntityType === EntityType.TASK ||
              normalizedEntityType === EntityType.AGENT_SESSION) &&
            !projectId
          ) {
            throw new BadRequestException(
              `Unable to resolve project for ${normalizedEntityType}:${event.entity.id}`,
            );
          }

          // Look for recent focus session on the same entity
          const recentSession = await tx.attentionEvent.findFirst({
            where: {
              organizationId: user.currentOrgId,
              userId: user.userId,
              entityType: normalizedEntityType,
              entityId: event.entity.id,
              projectId,
              tab: event.tab ?? null,
              focusEnd: {
                gte: windowStart,
              },
            },
            orderBy: {
              focusEnd: 'desc',
            },
          });

          if (recentSession) {
            // Merge: extend the focus session
            const durationMs = Math.max(
              recentSession.durationMs,
              eventTime.getTime() - recentSession.focusStart.getTime(),
            );

            await tx.attentionEvent.update({
              where: { id: recentSession.id },
              data: {
                projectId,
                focusEnd: eventTime,
                durationMs,
              },
            });

            eventsMerged++;
          } else {
            // New session: create attention event
            await tx.attentionEvent.create({
              data: {
                organizationId: user.currentOrgId,
                userId: user.userId,
                entityType: normalizedEntityType,
                entityId: event.entity.id,
                projectId,
                tab: event.tab,
                focusStart: eventTime,
                focusEnd: eventTime,
                durationMs: 0,
              },
            });
          }

          eventsProcessed++;
        }
      });

      this.logger.log(
        `Recorded ${eventsProcessed} attention events for user ${user.userId}: ` +
          `${eventsProcessed - eventsMerged} new sessions, ${eventsMerged} merged`,
      );

      return {
        eventCount: eventsProcessed,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to record attention events for user ${user.userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  async getAttentionEvents(
    user: AuthenticatedUser,
    query: GetAttentionEventsQuery,
  ): Promise<GetAttentionEventsResponseData> {
    // Parse 'since' to Date (default: 7 days ago)
    let sinceDate: Date;
    if (query.since) {
      sinceDate = new Date(query.since);
      if (isNaN(sinceDate.getTime())) {
        throw new BadRequestException(
          'Invalid "since" parameter. Must be ISO string or unix timestamp (ms)',
        );
      }
    } else {
      sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    }

    const accessibleProjects = await this.projectAccess.accessibleProjectIds(
      user.userId,
      user.currentOrgId,
    );
    if (query.projectId)
      await this.projectAccess.assertProject(
        user.userId,
        user.currentOrgId,
        query.projectId,
      );
    const whereClause = {
      AND: [
        {
          OR: [{ projectId: null }, { projectId: { in: accessibleProjects } }],
        },
      ],
      organizationId: user.currentOrgId,
      userId: user.userId,
      focusEnd: { gte: sinceDate },
      ...(query.projectId ? { projectId: query.projectId } : {}),
    };

    try {
      // Fetch all events within time range, ordered by recency
      const events = await this.prisma.db.attentionEvent.findMany({
        where: whereClause,
        orderBy: { focusEnd: 'desc' },
        take: query.limit * 2,
        skip: query.offset,
      });

      // Get total count for pagination (distinct entities viewed in time range)
      const totalCount = await this.prisma.db.attentionEvent.count({
        where: whereClause,
      });

      const mappedEvents: AttentionEventWithEntity[] = events.map((e) => ({
        id: e.id,
        entityType: this.normalizeEntityTypeOrThrow(e.entityType),
        entityId: e.entityId,
        entityName: '',
        tab: e.tab ?? undefined,
        focusStart: e.focusStart.toISOString(),
        focusEnd: e.focusEnd.toISOString(),
        durationMs: e.durationMs,
      }));

      const sortedEvents = this.sortAttentionEvents(
        mappedEvents,
        query.sort ?? 'mostRecent',
        query.limit,
      );

      const dedupedEvents =
        (query.sort ?? 'mostRecent') === 'mixed'
          ? sortedEvents
          : this.dedupePreservingOrder(sortedEvents);

      const limitedEvents = dedupedEvents.slice(0, query.limit);

      // Fetch entity names from EntityRegistry after de-duplication/limit
      const uniqueEntityPairs = [
        ...new Set(limitedEvents.map((e) => `${e.entityId}:${e.entityType}`)),
      ];

      const entityPairs = uniqueEntityPairs.map((pair) => {
        const [entityId, entityType] = pair.split(':') as [string, string];
        return {
          entityId,
          entityType: this.normalizeEntityTypeOrThrow(entityType),
        };
      });

      const entityRegistry =
        entityPairs.length > 0
          ? await this.prisma.db.entityRegistry.findMany({
              where: {
                OR: entityPairs.map(({ entityId, entityType }) => ({
                  entityId,
                  entityType,
                })),
              },
            })
          : [];

      // Create a map keyed by (entityId, entityType) to prevent cross-type name leakage
      const entityNameMap = new Map(
        entityRegistry.map((e) => [
          `${e.entityId}:${e.entityType}`,
          e.entityName || 'Unknown',
        ]),
      );

      const namedEvents = limitedEvents.map((event) => ({
        ...event,
        entityName:
          entityNameMap.get(`${event.entityId}:${event.entityType}`) ||
          'Unknown',
      }));

      const withEntities = query.includeEntity
        ? await this.attachEntities(user, namedEvents)
        : namedEvents;

      return {
        events: withEntities,
        pagination: {
          limit: query.limit,
          offset: query.offset,
          total: totalCount,
        },
      };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      this.logger.error(
        `Failed to retrieve attention events for user ${user.userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private validateEvents(events: AttentionEvent[]) {
    if (!events || events.length === 0) {
      throw new BadRequestException(
        'Attention events array must include at least one event',
      );
    }

    if (events.length > AttentionEventService.MAX_EVENTS_PER_BATCH) {
      throw new BadRequestException(
        `Too many events in batch (max ${AttentionEventService.MAX_EVENTS_PER_BATCH})`,
      );
    }

    for (const event of events) {
      const entityIdForError = event.entity?.id ?? 'unknown';

      if (event.eventType !== 'attention') {
        throw new BadRequestException(
          `Event for ${entityIdForError}: eventType must be "attention"`,
        );
      }

      if (!event.entity || !event.entity.type || !event.entity.id) {
        throw new BadRequestException(
          `Event for ${entityIdForError}: entity.type and entity.id are required`,
        );
      }

      this.normalizeEntityTypeOrThrow(event.entity.type);

      if (!Number.isFinite(event.timestamp) || event.timestamp <= 0) {
        throw new BadRequestException(
          `Event for ${entityIdForError}: timestamp is invalid`,
        );
      }

      if (event.tab && typeof event.tab !== 'string') {
        throw new BadRequestException(
          `Event for ${entityIdForError}: tab must be a string`,
        );
      }
    }
  }

  private static readonly LEGACY_ENTITY_TYPE_MAP: Record<string, EntityType> = {
    CODING_SESSION: EntityType.AGENT_SESSION,
  };

  private normalizeEntityTypeOrThrow(entityType: string): EntityType {
    if (!entityType) {
      throw new BadRequestException('entityType is required');
    }

    const normalized = entityType.trim().toUpperCase().replace(/-/g, '_');

    const mapped = AttentionEventService.LEGACY_ENTITY_TYPE_MAP[normalized];
    if (mapped) {
      return mapped;
    }

    if (Object.values(EntityType).includes(normalized as EntityType)) {
      return normalized as EntityType;
    }

    throw new BadRequestException(`Unsupported entityType: ${entityType}`);
  }

  private async resolveProjectIdForEntity(params: {
    tx: any;
    organizationId: OrganizationId;
    entityType: EntityType;
    entityId: string;
  }): Promise<string | null> {
    const { tx, organizationId, entityType, entityId } = params;

    switch (entityType) {
      case EntityType.PROJECT: {
        const project = await tx.project.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: { id: true },
        });
        return project?.id ?? null;
      }
      case EntityType.INITIATIVE: {
        const initiative = await tx.initiative.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: {
            originatingProjectId: true,
          },
        });
        return initiative?.originatingProjectId ?? null;
      }
      case EntityType.DESIGN_DOC: {
        const designDoc = await tx.designDoc.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: {
            projectId: true,
          },
        });
        return designDoc?.projectId ?? null;
      }
      case EntityType.SERVICE: {
        const service = await tx.service.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: {
            projectId: true,
          },
        });
        return service?.projectId ?? null;
      }
      case EntityType.CONVERSATION: {
        const conversation = await tx.conversation.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: {
            projectId: true,
          },
        });
        return conversation?.projectId ?? null;
      }
      case EntityType.PROPOSAL: {
        const proposal = await tx.proposal.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: {
            projectId: true,
          },
        });
        return proposal?.projectId ?? null;
      }
      case EntityType.TASK: {
        const task = await tx.task.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: {
            projectId: true,
            projectRelations: {
              select: {
                projectId: true,
              },
            },
          },
        });
        if (!task) {
          return null;
        }

        return this.resolveSingleProjectId([
          task.projectId,
          ...task.projectRelations.map(
            (relation: { projectId: string }) => relation.projectId,
          ),
        ]);
      }
      case EntityType.AGENT_SESSION: {
        const agentSession = await tx.agentSession.findFirst({
          where: {
            id: entityId,
            organizationId,
          },
          select: {
            entityType: true,
            entityId: true,
            service: {
              select: {
                projectId: true,
              },
            },
            conversation: {
              select: {
                projectId: true,
              },
            },
          },
        });

        if (!agentSession) {
          return null;
        }

        const aboutProjectIds: Array<string | null> = [];
        if (agentSession.entityType && agentSession.entityId) {
          switch (agentSession.entityType) {
            case 'TASK': {
              const task = await tx.task.findFirst({
                where: { id: agentSession.entityId, organizationId },
                select: {
                  projectId: true,
                  projectRelations: {
                    select: {
                      projectId: true,
                    },
                  },
                },
              });
              if (task) {
                aboutProjectIds.push(task.projectId);
                aboutProjectIds.push(
                  ...task.projectRelations.map(
                    (relation: { projectId: string }) => relation.projectId,
                  ),
                );
              }
              break;
            }
            case 'INITIATIVE': {
              const initiative = await tx.initiative.findFirst({
                where: { id: agentSession.entityId, organizationId },
                select: { originatingProjectId: true },
              });
              if (initiative) {
                aboutProjectIds.push(initiative.originatingProjectId);
              }
              break;
            }
            case 'DESIGN_DOC': {
              const designDoc = await tx.designDoc.findFirst({
                where: { id: agentSession.entityId, organizationId },
                select: { projectId: true },
              });
              if (designDoc) {
                aboutProjectIds.push(designDoc.projectId);
              }
              break;
            }
            default:
              break;
          }
        }

        return this.resolveSingleProjectId([
          ...aboutProjectIds,
          agentSession.service?.projectId ?? null,
          agentSession.conversation?.projectId ?? null,
        ]);
      }
      default:
        return null;
    }
  }

  private resolveSingleProjectId(
    candidateProjectIds: Array<string | null | undefined>,
  ): string | null {
    const distinct = [...new Set(candidateProjectIds.filter(Boolean))];
    if (distinct.length === 0) {
      return null;
    }
    if (distinct.length > 1) {
      throw new BadRequestException(
        'Entity is linked to multiple projects and cannot be tracked as a single-project attention event',
      );
    }

    return distinct[0]!;
  }

  private getEntityKey(event: AttentionEventWithEntity): string {
    return `${event.entityType}:${event.entityId}`;
  }

  private mergeAndDeduplicate(
    events: AttentionEventWithEntity[],
  ): AttentionEventWithEntity[] {
    const eventMap = new Map<string, AttentionEventWithEntity>();

    events.forEach((event) => {
      const key = this.getEntityKey(event);
      const existing = eventMap.get(key);

      if (!existing) {
        eventMap.set(key, event);
        return;
      }

      const hasBetterDuration =
        event.durationMs !== null &&
        event.durationMs !== undefined &&
        (existing.durationMs === null || existing.durationMs === undefined);

      const hasMoreRecentFocusEnd =
        event.focusEnd &&
        existing.focusEnd &&
        new Date(event.focusEnd).getTime() >
          new Date(existing.focusEnd).getTime();

      if (hasBetterDuration || hasMoreRecentFocusEnd) {
        eventMap.set(key, event);
      }
    });

    return Array.from(eventMap.values());
  }

  private dedupePreservingOrder(
    events: AttentionEventWithEntity[],
  ): AttentionEventWithEntity[] {
    const seen = new Set<string>();
    const deduped: AttentionEventWithEntity[] = [];

    for (const event of events) {
      const key = this.getEntityKey(event);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(event);
    }

    return deduped;
  }

  private assignRankingPoints(
    events: AttentionEventWithEntity[],
    sortFn: (
      a: AttentionEventWithEntity,
      b: AttentionEventWithEntity,
    ) => number,
    limit: number,
  ): Map<string, number> {
    const sorted = [...events].sort(sortFn);
    const points = new Map<string, number>();

    sorted.forEach((event, index) => {
      const key = this.getEntityKey(event);
      points.set(key, Math.max(0, limit - index));
    });

    return points;
  }

  private calculateMixedScores(
    events: AttentionEventWithEntity[],
    limit: number,
  ): Array<AttentionEventWithEntity & { totalScore?: number }> {
    const durationPoints = this.assignRankingPoints(
      events,
      (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
      limit,
    );

    const recencyPoints = this.assignRankingPoints(
      events,
      (a, b) => {
        const aTime = a.focusEnd ?? a.focusStart;
        const bTime = b.focusEnd ?? b.focusStart;
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      },
      limit,
    );

    return events.map((event) => {
      const key = this.getEntityKey(event);
      const duration = durationPoints.get(key) ?? 0;
      const recency = recencyPoints.get(key) ?? 0;

      return {
        ...event,
        totalScore: duration + recency,
      };
    });
  }

  private sortAttentionEvents(
    events: AttentionEventWithEntity[],
    sort: AttentionEventSortMode,
    limit: number,
  ): AttentionEventWithEntity[] {
    switch (sort) {
      case 'mostRecent':
        return [...events].sort((a, b) => {
          const aTime = a.focusEnd ?? a.focusStart;
          const bTime = b.focusEnd ?? b.focusStart;
          return new Date(bTime).getTime() - new Date(aTime).getTime();
        });
      case 'mostActive':
        return [...events].sort(
          (a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0),
        );
      case 'mixed': {
        const merged = this.mergeAndDeduplicate(events);
        const scored = this.calculateMixedScores(merged, limit);
        return scored.sort((a, b) => (b.totalScore ?? 0) - (a.totalScore ?? 0));
      }
      default:
        return events;
    }
  }

  private async attachEntities(
    user: AuthenticatedUser,
    events: AttentionEventWithEntity[],
  ): Promise<AttentionEventWithEntity[]> {
    const entityLookups = new Map<string, Promise<unknown | null>>();

    events.forEach((event) => {
      const normalized = this.normalizeEntityTypeOrThrow(event.entityType);
      const key = `${normalized}:${event.entityId}`;
      if (!entityLookups.has(key)) {
        entityLookups.set(
          key,
          this.fetchEntityDetails(user, normalized, event.entityId),
        );
      }
    });

    const resolvedEntities = new Map<string, unknown>();
    for (const [key, lookup] of entityLookups.entries()) {
      const entity = await lookup;
      if (entity) {
        resolvedEntities.set(key, entity);
      }
    }

    return events.map((event) => {
      const normalized = this.normalizeEntityTypeOrThrow(event.entityType);
      const key = `${normalized}:${event.entityId}`;
      return {
        ...event,
        entity: resolvedEntities.get(key) ?? null,
      };
    });
  }

  private async fetchEntityDetails(
    user: AuthenticatedUser,
    entityType: EntityType,
    entityId: string,
  ): Promise<unknown | null> {
    try {
      switch (entityType) {
        case EntityType.PROJECT:
          return this.projectService.findOneForAdapter(
            entityId,
            user.currentOrgId,
            user.userId,
          );
        case EntityType.TASK:
          return this.taskService.findOne(
            user.currentOrgId,
            entityId as TaskId,
            false,
            false,
            false,
          );
        case EntityType.INITIATIVE:
          return this.initiativeService.findOneForAdapter(
            entityId,
            user.currentOrgId,
          );
        case EntityType.DESIGN_DOC:
          return this.designDocService.findOne(entityId, user.currentOrgId);
        case EntityType.CONVERSATION:
          return this.conversationService.getConversation(
            entityId as ConversationId,
            user.currentOrgId,
          );
        case EntityType.AGENT_SESSION:
          return this.agentSessionService.findOne(user.currentOrgId, entityId);
        default:
          return null;
      }
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }
      throw error;
    }
  }
}

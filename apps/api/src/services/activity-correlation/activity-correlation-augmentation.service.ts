import { forwardRef, Inject, Injectable } from '@nestjs/common';
import {
  EntityType as PrismaEntityType,
  ReportAudience as PrismaReportAudience,
} from '@prisma/client';
import {
  ActivityCorrelationLinkType,
  ActivityCorrelationRecordDto,
  EntityType,
  MessageResponseDto,
  RecentActivityCorrelationRecordDto,
  ReportDto,
} from 'src/generated';
import { prismaMessageResultToResponseDto } from 'src/mappers/message.mapper';
import { PrismaService } from 'src/prisma/prisma.service';
import { DEFAULT_AGENT_SESSION_TITLE } from 'src/services/agent-session-title';
import { ReportService } from 'src/services/reports/report.service';
import { USER_VISIBLE_PERSISTED_REPORT_AUDIENCES } from 'src/services/reports/report-audience';
import { MessageQueryResult } from 'src/services/types';
import { WorkflowId, OrganizationId } from 'src/types';
import {
  EntityRef,
  RecentActivityCorrelationRecordDraft,
  RecentLinkedEntityDraft,
  dedupeReports,
  toEntityKey,
} from './activity-correlation.types';
import { requireEntityTitle } from './activity-correlation.graph-mappers';
import { TIMELINE_MESSAGE_WHERE } from 'src/utils/message-timeline.util';

@Injectable()
export class ActivityCorrelationAugmentationService {
  private static readonly CORRELATION_VISIBLE_REPORT_AUDIENCES: PrismaReportAudience[] =
    USER_VISIBLE_PERSISTED_REPORT_AUDIENCES;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => ReportService))
    private readonly reportService: ReportService,
  ) {}

  async augmentRecentRecords(
    organizationId: OrganizationId,
    records: RecentActivityCorrelationRecordDraft[],
    titleHints: Map<string, string>,
    statusHints: Map<string, string>,
    updatedAtHints: Map<string, string>,
  ): Promise<RecentActivityCorrelationRecordDto[]> {
    if (records.length === 0) {
      return [];
    }

    const hydratedReportsById = await this.fetchReportsById(
      organizationId,
      records.flatMap((record) => record.reportIds),
    );

    const recordsWithReports = records.map((record) => ({
      ...record,
      reports: dedupeReports(
        record.reportIds
          .map((reportId) => hydratedReportsById.get(reportId))
          .filter((report): report is ReportDto => !!report),
      ),
    }));
    const recordsWithUpdatedAt = this.attachEntityUpdatedAts(
      recordsWithReports,
      updatedAtHints,
    );
    const recordsWithStatuses = await this.attachEntityStatuses(
      organizationId,
      recordsWithUpdatedAt,
      statusHints,
    );
    const recordsWithTitles = await this.attachEntityTitlesAndPlans(
      organizationId,
      recordsWithStatuses,
      titleHints,
    );

    return this.attachAgentSessionLastMessages(
      organizationId,
      recordsWithTitles,
    );
  }

  private async fetchReportsById(
    organizationId: OrganizationId,
    reportIds: string[],
  ): Promise<Map<string, ReportDto>> {
    const uniqueIds = [...new Set(reportIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const now = new Date();
    const reports = await this.prisma.db.report.findMany({
      where: {
        organizationId,
        id: { in: uniqueIds },
        expiresAt: { gt: now },
        audience: {
          in: ActivityCorrelationAugmentationService.CORRELATION_VISIBLE_REPORT_AUDIENCES,
        },
      },
      include: {
        reportEntities: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return new Map(
      reports.map((report) => [report.id, this.reportService.toDto(report)]),
    );
  }

  private attachEntityUpdatedAts(
    records: RecentActivityCorrelationRecordDraft[],
    updatedAtHints?: Map<string, string>,
  ): RecentActivityCorrelationRecordDraft[] {
    return records.map((record) => {
      const recordUpdatedAt =
        record.updatedAt ??
        updatedAtHints?.get(
          toEntityKey({
            entityId: record.entityId,
            entityType: record.entityType,
          }),
        );

      return {
        ...record,
        updatedAt: recordUpdatedAt,
        linkedEntities: record.linkedEntities.map((linkedEntity) => ({
          ...linkedEntity,
          updatedAt:
            linkedEntity.updatedAt ??
            updatedAtHints?.get(
              toEntityKey({
                entityId: linkedEntity.entityId,
                entityType: linkedEntity.entityType,
              }),
            ),
        })),
      };
    });
  }

  private async attachEntityStatuses(
    organizationId: OrganizationId,
    records: RecentActivityCorrelationRecordDraft[],
    statusHints?: Map<string, string>,
  ): Promise<RecentActivityCorrelationRecordDraft[]> {
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

    return records.map((record) => ({
      ...record,
      status: this.resolveEntityStatus(
        { entityId: record.entityId, entityType: record.entityType },
        record.status,
        statusHints,
        taskStatuses,
        agentSessionStatuses,
      ),
      linkedEntities: record.linkedEntities.map((linkedEntity) => ({
        ...linkedEntity,
        status: this.resolveEntityStatus(
          {
            entityId: linkedEntity.entityId,
            entityType: linkedEntity.entityType,
          },
          linkedEntity.status,
          statusHints,
          taskStatuses,
          agentSessionStatuses,
        ),
      })),
    }));
  }

  private async attachEntityTitlesAndPlans(
    organizationId: OrganizationId,
    records: RecentActivityCorrelationRecordDraft[],
    titleHints: Map<string, string>,
  ): Promise<RecentActivityCorrelationRecordDto[]> {
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

    return records.map((record, index) => {
      const linkedEntities = record.linkedEntities;

      return {
        entityId: record.entityId,
        entityType: record.entityType,
        title: this.resolveActivityEntityTitle(entityTitles, {
          entityId: record.entityId,
          entityType: record.entityType,
        }),
        timestamp: record.timestamp,
        linkedEntities: linkedEntities.map((linkedEntity) => ({
          ...linkedEntity,
          title: this.resolveActivityEntityTitle(entityTitles, {
            entityId: linkedEntity.entityId,
            entityType: linkedEntity.entityType,
          }),
        })),
        reports: record.reports,
        ...(record.updatedAt ? { updatedAt: record.updatedAt } : {}),
        ...(record.status ? { status: record.status } : {}),
        ...(record.conversationId !== undefined
          ? { conversationId: record.conversationId }
          : {}),
        ...(record.sessionType ? { sessionType: record.sessionType } : {}),
      } satisfies RecentActivityCorrelationRecordDto;
    });
  }

  private async attachAgentSessionLastMessages(
    organizationId: OrganizationId,
    records: RecentActivityCorrelationRecordDto[],
  ): Promise<RecentActivityCorrelationRecordDto[]> {
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
    records: RecentActivityCorrelationRecordDto[],
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
    records: RecentActivityCorrelationRecordDto[],
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

    return new Map(
      agentSessions
        .filter((agentSession) => !!agentSession.conversationId)
        .map((agentSession) => [
          agentSession.id,
          agentSession.conversationId as string,
        ]),
    );
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

    return new Map(
      latestMessages.map((message) => [
        message.conversationId,
        prismaMessageResultToResponseDto(
          message as MessageQueryResult,
          (message.conversation?.workflowId ?? undefined) as WorkflowId,
        ),
      ]),
    );
  }

  private attachLinkedEntityLastMessage(
    linkedEntity: RecentActivityCorrelationRecordDto['linkedEntities'][number],
    conversationIdsByAgentSessionId: Map<string, string>,
    latestMessagesByConversationId: Map<string, MessageResponseDto>,
  ): RecentActivityCorrelationRecordDto['linkedEntities'][number] {
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

  private resolveAgentSessionLastMessage(
    conversationId: string | null | undefined,
    latestMessagesByConversationId: Map<string, MessageResponseDto>,
  ): MessageResponseDto | null {
    return conversationId
      ? (latestMessagesByConversationId.get(conversationId) ?? null)
      : null;
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
      statusHints?.has(toEntityKey(entity)) ||
      !this.isStatusAwareEntityType(entity.entityType)
    ) {
      return;
    }

    if (entity.entityType === EntityType.Task) {
      unresolvedTaskIds.add(entity.entityId);
    } else {
      unresolvedAgentSessionIds.add(entity.entityId);
    }
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

    const sessions = await this.prisma.db.agentSession.findMany({
      where: {
        organizationId,
        id: { in: agentSessionIds },
      },
      select: {
        id: true,
        status: true,
      },
    });

    return new Map(sessions.map((session) => [session.id, session.status]));
  }

  private resolveEntityStatus(
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
      statusHints?.get(toEntityKey(entity)) ??
      (entity.entityType === EntityType.Task
        ? taskStatuses.get(entity.entityId)
        : agentSessionStatuses.get(entity.entityId))
    );
  }

  private async resolveEntityTitles(
    organizationId: OrganizationId,
    entities: EntityRef[],
    titleHints: Map<string, string>,
  ): Promise<Map<string, string>> {
    const titles = new Map<string, string>(titleHints);

    const registryEntityFilters = entities
      .filter((entity) => this.isEntityRegistryEntityType(entity.entityType))
      .map((entity) => ({
        entityId: entity.entityId,
        entityType: entity.entityType as PrismaEntityType,
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
      if (!entity.entityName) {
        return;
      }
      titles.set(
        toEntityKey({
          entityId: entity.entityId,
          entityType: entity.entityType as EntityType,
        }),
        entity.entityName,
      );
    });

    const unresolved = entities.filter(
      (entity) => !titles.has(toEntityKey(entity)),
    );
    const byType = this.groupEntityIdsByType(unresolved);

    await Promise.all([
      this.loadTaskTitles(
        organizationId,
        byType.get(EntityType.Task) ?? [],
        titles,
      ),
      this.loadInitiativeTitles(
        organizationId,
        byType.get(EntityType.Initiative) ?? [],
        titles,
      ),
      this.loadProjectTitles(
        organizationId,
        byType.get(EntityType.Project) ?? [],
        titles,
      ),
      this.loadDesignDocTitles(
        organizationId,
        byType.get(EntityType.DesignDoc) ?? [],
        titles,
      ),
      this.loadServiceTitles(
        organizationId,
        byType.get(EntityType.Service) ?? [],
        titles,
      ),
      this.loadAgentSessionTitles(
        organizationId,
        byType.get(EntityType.AgentSession) ?? [],
        titles,
      ),
      this.loadConversationTitles(
        organizationId,
        byType.get(EntityType.Conversation) ?? [],
        titles,
      ),
    ]);

    return titles;
  }

  private async loadTaskTitles(
    organizationId: OrganizationId,
    ids: string[],
    titles: Map<string, string>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const rows = await this.prisma.db.task.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
    rows.forEach((row) => {
      titles.set(
        toEntityKey({ entityId: row.id, entityType: EntityType.Task }),
        row.name,
      );
    });
  }

  private async loadInitiativeTitles(
    organizationId: OrganizationId,
    ids: string[],
    titles: Map<string, string>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const rows = await this.prisma.db.initiative.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
    rows.forEach((row) => {
      titles.set(
        toEntityKey({ entityId: row.id, entityType: EntityType.Initiative }),
        row.name,
      );
    });
  }

  private async loadProjectTitles(
    organizationId: OrganizationId,
    ids: string[],
    titles: Map<string, string>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const rows = await this.prisma.db.project.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
    rows.forEach((row) => {
      titles.set(
        toEntityKey({ entityId: row.id, entityType: EntityType.Project }),
        row.name,
      );
    });
  }

  private async loadDesignDocTitles(
    organizationId: OrganizationId,
    ids: string[],
    titles: Map<string, string>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const rows = await this.prisma.db.designDoc.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
    rows.forEach((row) => {
      titles.set(
        toEntityKey({ entityId: row.id, entityType: EntityType.DesignDoc }),
        row.name,
      );
    });
  }

  private async loadServiceTitles(
    organizationId: OrganizationId,
    ids: string[],
    titles: Map<string, string>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const rows = await this.prisma.db.service.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
    rows.forEach((row) => {
      titles.set(
        toEntityKey({ entityId: row.id, entityType: EntityType.Service }),
        row.name,
      );
    });
  }

  private async loadAgentSessionTitles(
    organizationId: OrganizationId,
    ids: string[],
    titles: Map<string, string>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const rows = await this.prisma.db.agentSession.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, title: true },
    });
    rows.forEach((row) => {
      titles.set(
        toEntityKey({ entityId: row.id, entityType: EntityType.AgentSession }),
        row.title,
      );
    });
  }

  private resolveActivityEntityTitle(
    titleMap: Map<string, string>,
    entity: EntityRef,
  ): string {
    if (entity.entityType === EntityType.AgentSession) {
      return (
        this.normalizeTitle(titleMap.get(toEntityKey(entity))) ??
        DEFAULT_AGENT_SESSION_TITLE
      );
    }

    return requireEntityTitle(titleMap, entity);
  }

  private normalizeTitle(title?: string | null): string | undefined {
    if (typeof title !== 'string') {
      return undefined;
    }

    const trimmed = title.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private async loadConversationTitles(
    organizationId: OrganizationId,
    ids: string[],
    titles: Map<string, string>,
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const rows = await this.prisma.db.conversation.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, title: true, workflowName: true },
    });
    rows.forEach((row) => {
      const title = row.title ?? row.workflowName;
      if (!title) {
        return;
      }
      titles.set(
        toEntityKey({ entityId: row.id, entityType: EntityType.Conversation }),
        title,
      );
    });
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

  private pushEntityRef(target: EntityRef[], entity: EntityRef): void {
    const exists = target.some(
      (candidate) =>
        candidate.entityId === entity.entityId &&
        candidate.entityType === entity.entityType,
    );

    if (!exists) {
      target.push(entity);
    }
  }

  private isStatusAwareEntityType(entityType: EntityType): boolean {
    return (
      entityType === EntityType.Task || entityType === EntityType.AgentSession
    );
  }

  private isEntityRegistryEntityType(entityType: EntityType): boolean {
    return (Object.values(PrismaEntityType) as string[]).includes(entityType);
  }
}

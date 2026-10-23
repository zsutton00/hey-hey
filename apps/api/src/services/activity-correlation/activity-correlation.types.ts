import {
  ActivityCorrelationActivityType,
  ActivityCorrelationLinkedEntityDto,
  ActivityCorrelationRecordDto,
  ActivityCorrelationSource,
  AgentSessionType,
  EntityType,
  MessageResponseDto,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationRecordDto,
  RecentActivityCorrelationSort,
  ReportDto,
} from 'src/generated';
import { ProjectId, UserId } from 'src/types';

export type EntityRef = {
  entityId: string;
  entityType: EntityType;
};

/**
 * Canonical Activity's pre-hydration shape. Producers may provide identity,
 * project, ordering, and relationship data; the Activity boundary fills in
 * titles and the other canonical fields through its established hydrator.
 */
export type ActivityCorrelationLinkedEntityDraft = Omit<
  ActivityCorrelationLinkedEntityDto,
  'title'
>;

export type ActivityCorrelationRecordDraft = Omit<
  ActivityCorrelationRecordDto,
  'title' | 'linkedEntities' | 'reports'
> & {
  eventActorUserId?: UserId;
  linkedEntities: ActivityCorrelationLinkedEntityDraft[];
  reports: ReportDto[];
  type: ActivityCorrelationActivityType;
  source: ActivityCorrelationSource;
  sessionType?: AgentSessionType;
};

export type RecentActivityQuery = {
  userId: UserId;
  projectId: ProjectId;
  mode?: RecentActivityCorrelationMode;
  sort?: RecentActivityCorrelationSort;
  limit: number;
  offset: number;
};

export type RecentSeedRankingMetadata = {
  timestamp: string;
  conversationId?: string | null;
};

export type RecentSeedPage = {
  seeds: EntityRef[];
  total: number;
  nextOffset?: number;
  rankingMetadataBySeed: Map<string, RecentSeedRankingMetadata>;
};

export type RecentLinkedEntityDraft = Omit<
  ActivityCorrelationLinkedEntityDto,
  'title'
>;

export type RecentActivityCorrelationRecordDraft = Omit<
  RecentActivityCorrelationRecordDto,
  'title' | 'linkedEntities' | 'reports'
> & {
  linkedEntities: RecentLinkedEntityDraft[];
  reportIds: string[];
  reports: ReportDto[];
};

export type CorrelatedActivityResult = {
  records: ActivityCorrelationRecordDto[];
  total: number;
  nextOffset?: number;
};

export type RecentCorrelatedActivityResult = {
  records: RecentActivityCorrelationRecordDto[];
  total: number;
  nextOffset?: number;
};

export type AgentSessionLatestMessage = {
  conversationId: string;
  message: MessageResponseDto;
};

export function toEntityKey(entity: EntityRef): string {
  return `${entity.entityType}:${entity.entityId}`;
}

export function pushEntityRef(target: EntityRef[], entity: EntityRef): void {
  const existing = target.some(
    (candidate) =>
      candidate.entityId === entity.entityId &&
      candidate.entityType === entity.entityType,
  );

  if (!existing) {
    target.push(entity);
  }
}

export function dedupeReportIds(reportIds: string[]): string[] {
  return [...new Set(reportIds)];
}

export function dedupeReports(reports: ReportDto[]): ReportDto[] {
  const seen = new Set<string>();
  return reports.filter((report) => {
    if (seen.has(report.id)) {
      return false;
    }
    seen.add(report.id);
    return true;
  });
}

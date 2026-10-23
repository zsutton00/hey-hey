import type {
  ActivityCorrelationActivityType,
  ActivityCorrelationMode,
  ActivityCorrelationRecordDto,
  ActivityCorrelationSource,
  ActivityMetricContinuationDto,
  ActivityHistoryFilterDto,
  EntityType,
} from 'src/generated';
import type { OrganizationId, ProjectId, UserId } from 'src/types';

type OrdinaryActivityQuery = {
  readonly organizationId: OrganizationId;
  readonly actorUserId: UserId;
  readonly projectId?: ProjectId;
  readonly selectedUserId?: UserId;
  readonly entityTypes?: readonly EntityType[];
  readonly activityMode?: ActivityCorrelationMode;
  readonly activityTypes?: readonly ActivityCorrelationActivityType[];
  readonly sources?: readonly ActivityCorrelationSource[];
  readonly serviceId?: string;
  readonly since?: Date;
  readonly until?: Date;
  readonly affectsMe?: boolean;
  readonly sinceLastVisit?: boolean;
  readonly metricContinuation?: ActivityMetricContinuationDto;
  readonly limit: number;
  readonly offset: number;
};

export type ActivityQueryResult = {
  readonly records: ActivityCorrelationRecordDto[];
  readonly total: number;
  readonly nextOffset?: number;
};

type ActivityQueryBoundary = Pick<
  OrdinaryActivityQuery,
  'organizationId' | 'actorUserId' | 'limit' | 'offset'
>;
export type ActivityQueryRequest =
  | (Omit<OrdinaryActivityQuery, 'metricContinuation'> & {
      readonly metricContinuation?: never;
      readonly historyFilter?: never;
    })
  | (OrdinaryActivityQuery & {
      readonly metricContinuation: ActivityMetricContinuationDto;
      readonly historyFilter?: never;
    })
  | (ActivityQueryBoundary & {
      readonly historyFilter: ActivityHistoryFilterDto;
    } & {
      readonly [K in Exclude<
        keyof OrdinaryActivityQuery,
        keyof ActivityQueryBoundary
      >]?: never;
    });

type WithoutPagination<T> = T extends unknown
  ? Omit<T, 'limit' | 'offset'>
  : never;
export type ActivitySelectionRequest = WithoutPagination<ActivityQueryRequest>;

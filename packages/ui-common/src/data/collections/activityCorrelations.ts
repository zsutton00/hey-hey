import { DEFAULT_STALE_TIME_MS } from "../core/staleTime";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import {
  ActivityCorrelationMode,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
} from "../../api";
import type {
  ActivityCorrelationActivityType,
  ActivityCorrelationLinkedEntityDto,
  ActivityCorrelationRecordDto,
  ActivityCorrelationSource,
  ActivityCorrelationApiQueryActivityRequest,
  ActivityMetricContinuationDto,
  ActivityHistoryFilterDto,
  EntityType,
  MessageResponseDto,
  RecentActivityCorrelationRecordDto,
  ReportDto,
} from "../../api";
import { activityCorrelationClient } from "../../clients/serviceClients";
import {
  infiniteQueryOptions,
  type QueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";

type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type CorrelatedActivityId = Brand<string, "CorrelatedActivityId">;

export interface CorrelatedActivityPreview {
  dropdown: string;
  full: string;
}

interface CorrelatedActivityListItemBase {
  id: CorrelatedActivityId;
  activityId: string;
  entityId: string;
  entityType: EntityType;
  title: string;
  timestamp: string;
  updatedAt?: string;
  status?: string;
  linkedEntities: ActivityCorrelationLinkedEntityDto[];
  reports: ReportDto[];
  conversationId?: string | null;
  lastMessage?: MessageResponseDto | null;
  previewText: string;
  preview: CorrelatedActivityPreview;
  priorityRank: number;
}

export interface EntityCorrelatedActivityListItem
  extends CorrelatedActivityListItemBase,
    ActivityCorrelationRecordDto {
  kind: "entity";
  activityType: ActivityCorrelationActivityType;
  source: ActivityCorrelationSource;
}

export interface RecentCorrelatedActivityListItem
  extends CorrelatedActivityListItemBase,
    RecentActivityCorrelationRecordDto {
  kind: "recent";
  mode: RecentActivityCorrelationMode;
  sort?: RecentActivityCorrelationSort;
}

export type CorrelatedActivityListItem =
  | EntityCorrelatedActivityListItem
  | RecentCorrelatedActivityListItem;

export interface CorrelatedActivityPagination {
  limit: number;
  offset: number;
  totalCount: number | null;
  nextOffset: number | null;
}

export interface CorrelatedActivityData {
  items: CorrelatedActivityListItem[];
  records: CorrelatedActivityListItem[];
  pagination: CorrelatedActivityPagination;
}

export type CorrelatedActivityEntityScope =
  | {
      entityType: EntityType;
      entityId: string;
    }
  | {
      entityType?: never;
      entityId?: never;
    };

type ActivityModeSortSelection = {
  mode?: typeof RecentActivityCorrelationMode.Activity;
  sort?:
    | typeof RecentActivityCorrelationSort.Mixed
    | typeof RecentActivityCorrelationSort.MostActive
    | typeof RecentActivityCorrelationSort.MostRecent;
};

type TaskModeSortSelection = {
  mode: typeof RecentActivityCorrelationMode.Task;
  sort?:
    | typeof RecentActivityCorrelationSort.LastMessage
    | typeof RecentActivityCorrelationSort.LastUpdated;
};

type AgentSessionModeSortSelection = {
  mode: typeof RecentActivityCorrelationMode.AgentSession;
  sort?:
    | typeof RecentActivityCorrelationSort.LastMessage
    | typeof RecentActivityCorrelationSort.LastUpdated;
};

type CodingSessionModeSortSelection = {
  mode: typeof RecentActivityCorrelationMode.CodingSession;
  sort?:
    | typeof RecentActivityCorrelationSort.LastMessage
    | typeof RecentActivityCorrelationSort.LastUpdated;
};

export type RecentCorrelatedActivityModeSelection =
  | ActivityModeSortSelection
  | TaskModeSortSelection
  | AgentSessionModeSortSelection
  | CodingSessionModeSortSelection;

type CorrelatedActivityQueryParamsCommon = {
  organizationId: string;
  limit?: number;
  offset?: number;
};

export type EntityCorrelatedActivityFetchParams =
  CorrelatedActivityQueryParamsCommon &
    CorrelatedActivityEntityScope & {
      activityType?: ActivityCorrelationActivityType[];
      source?: ActivityCorrelationSource[];
      projectId?: never;
      mode?: never;
      sort?: never;
    };

export type RecentCorrelatedActivityFetchParams =
  CorrelatedActivityQueryParamsCommon &
    RecentCorrelatedActivityModeSelection & {
      projectId: string;
      entityType?: never;
      entityId?: never;
      activityType?: never;
      source?: never;
    };

export type CorrelatedActivityFetchParams =
  | EntityCorrelatedActivityFetchParams
  | RecentCorrelatedActivityFetchParams;

export type CorrelatedActivityQueryParams = CorrelatedActivityFetchParams;

type CrossProjectActivityQueryParamsCommon = {
  organizationId: string;
  projectId?: string;
  userId?: string;
  entityType?: EntityType[];
  activityMode?: ActivityCorrelationMode;
  activityType?: ActivityCorrelationActivityType[];
  source?: ActivityCorrelationSource[];
  serviceId?: string;
  since?: string;
  until?: string;
  affectsMe?: boolean;
  sinceLastVisit?: boolean;
  limit?: number;
  offset?: number;
};

export type CrossProjectActivityFilterParams =
  CrossProjectActivityQueryParamsCommon & {
    metricContinuation?: never;
    historyFilter?: never;
  };

export type CrossProjectActivityMetricParams = Pick<
  CrossProjectActivityQueryParamsCommon,
  "organizationId" | "limit" | "offset"
> & {
  metricContinuation: ActivityMetricContinuationDto;
  historyFilter?: never;
} & {
  [K in Exclude<
    keyof CrossProjectActivityQueryParamsCommon,
    "organizationId" | "limit" | "offset"
  >]?: never;
};

export type CrossProjectActivityHistoryParams = Pick<
  CrossProjectActivityQueryParamsCommon,
  "organizationId" | "limit" | "offset"
> & {
  historyFilter: ActivityHistoryFilterDto;
  metricContinuation?: never;
} & {
  [K in Exclude<
    keyof CrossProjectActivityQueryParamsCommon,
    "organizationId" | "limit" | "offset"
  >]?: never;
};

export type CrossProjectActivityFetchParams =
  | CrossProjectActivityFilterParams
  | CrossProjectActivityMetricParams
  | CrossProjectActivityHistoryParams;

export type CrossProjectActivityQueryParams = CrossProjectActivityFetchParams;

export type OrganizationActivityFilterParams = CrossProjectActivityFilterParams;
export type OrganizationActivityMetricParams = CrossProjectActivityMetricParams;
export type OrganizationActivityParams = CrossProjectActivityFetchParams;

export interface CorrelatedActivityRetryConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

const DEFAULT_LIMIT = 50;
const DEFAULT_OFFSET = 0;

const ACTIVITY_TYPE_PRIORITY: Record<ActivityCorrelationActivityType, number> =
  {
    NOTIFICATION: 40,
    UNBLOCKED: 30,
    AGENT_SESSION_COMPLETED: 20,
    VIEWED: 10,
  };

const SOURCE_PRIORITY: Record<ActivityCorrelationSource, number> = {
  SYSTEM: 50,
  TASK_RELATIONSHIP: 40,
  AGENT_SESSION: 30,
  REPORT: 20,
  ATTENTION_EVENT: 10,
};

const DEFAULT_RETRY_CONFIG: CorrelatedActivityRetryConfig = {
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 2000,
};

export const DEFAULT_CORRELATED_ACTIVITY_STALE_TIME_MS = DEFAULT_STALE_TIME_MS;
export const DEFAULT_RECENT_ACTIVITY_CORRELATION_MODE =
  RecentActivityCorrelationMode.Task;

export interface ActivitySortOption {
  label: string;
  value: RecentActivityCorrelationSort;
}

const ACTIVITY_MODE_SORT_OPTIONS: ActivitySortOption[] = [
  { label: "Most Recent", value: RecentActivityCorrelationSort.MostRecent },
  { label: "Most Active", value: RecentActivityCorrelationSort.MostActive },
];

const TASK_MODE_SORT_OPTIONS: ActivitySortOption[] = [
  { label: "Last Updated", value: RecentActivityCorrelationSort.LastUpdated },
  { label: "Last Message", value: RecentActivityCorrelationSort.LastMessage },
];

const AGENT_SESSION_MODE_SORT_OPTIONS: ActivitySortOption[] = [
  { label: "Last Updated", value: RecentActivityCorrelationSort.LastUpdated },
  { label: "Last Message", value: RecentActivityCorrelationSort.LastMessage },
];

export const getSortOptionsForMode = (
  mode: RecentActivityCorrelationMode
): ActivitySortOption[] => {
  switch (mode) {
    case RecentActivityCorrelationMode.Activity:
      return ACTIVITY_MODE_SORT_OPTIONS;
    case RecentActivityCorrelationMode.Task:
      return TASK_MODE_SORT_OPTIONS;
    case RecentActivityCorrelationMode.AgentSession:
    case RecentActivityCorrelationMode.CodingSession:
      return AGENT_SESSION_MODE_SORT_OPTIONS;
    default:
      return TASK_MODE_SORT_OPTIONS;
  }
};

export const getUiDefaultSort = (
  mode: RecentActivityCorrelationMode
): RecentActivityCorrelationSort => {
  switch (mode) {
    case RecentActivityCorrelationMode.Activity:
      return RecentActivityCorrelationSort.MostRecent;
    case RecentActivityCorrelationMode.Task:
    case RecentActivityCorrelationMode.AgentSession:
    case RecentActivityCorrelationMode.CodingSession:
      return RecentActivityCorrelationSort.LastUpdated;
    default:
      return RecentActivityCorrelationSort.LastUpdated;
  }
};

export const isValidSortForMode = (
  sort: RecentActivityCorrelationSort,
  mode: RecentActivityCorrelationMode
): boolean => {
  const options = getSortOptionsForMode(mode);
  return options.some((option) => option.value === sort);
};
const DEFAULT_RECENT_ACTIVITY_FETCH_MODE =
  RecentActivityCorrelationMode.Activity;

export const getDefaultRecentActivityCorrelationSort = (
  mode: RecentActivityCorrelationMode = DEFAULT_RECENT_ACTIVITY_CORRELATION_MODE
): RecentActivityCorrelationSort => {
  switch (mode) {
    case RecentActivityCorrelationMode.Task:
      return RecentActivityCorrelationSort.LastUpdated;
    case RecentActivityCorrelationMode.AgentSession:
    case RecentActivityCorrelationMode.CodingSession:
      return RecentActivityCorrelationSort.LastMessage;
    case RecentActivityCorrelationMode.Activity:
    default:
      return RecentActivityCorrelationSort.Mixed;
  }
};

const getDefaultRecentActivityFetchSort = (
  mode: RecentActivityCorrelationMode = DEFAULT_RECENT_ACTIVITY_FETCH_MODE
): RecentActivityCorrelationSort => {
  return getDefaultRecentActivityCorrelationSort(mode);
};

type ResolvedCorrelatedActivityRequest =
  | {
      kind: "entity";
      entityType: EntityType;
      entityId: string;
      activityType?: ActivityCorrelationActivityType[];
      source?: ActivityCorrelationSource[];
    }
  | ({
      kind: "recent";
      projectId: string;
    } & RecentCorrelatedActivityModeSelection)
  | {
      kind: "invalid";
    };

const normalizeRecentCorrelatedActivitySelection = (
  mode?: RecentActivityCorrelationMode | null,
  sort?: RecentActivityCorrelationSort | null
): RecentCorrelatedActivityModeSelection => {
  const resolvedMode = mode ?? DEFAULT_RECENT_ACTIVITY_CORRELATION_MODE;

  switch (resolvedMode) {
    case RecentActivityCorrelationMode.Task:
      return {
        mode: RecentActivityCorrelationMode.Task,
        sort:
          sort === RecentActivityCorrelationSort.LastMessage ||
          sort === RecentActivityCorrelationSort.LastUpdated
            ? sort
            : RecentActivityCorrelationSort.LastUpdated,
      };
    case RecentActivityCorrelationMode.AgentSession:
      return {
        mode: RecentActivityCorrelationMode.AgentSession,
        sort:
          sort === RecentActivityCorrelationSort.LastMessage ||
          sort === RecentActivityCorrelationSort.LastUpdated
            ? sort
            : RecentActivityCorrelationSort.LastUpdated,
      };
    case RecentActivityCorrelationMode.CodingSession:
      return {
        mode: RecentActivityCorrelationMode.CodingSession,
        sort:
          sort === RecentActivityCorrelationSort.LastMessage ||
          sort === RecentActivityCorrelationSort.LastUpdated
            ? sort
            : RecentActivityCorrelationSort.LastUpdated,
      };
    case RecentActivityCorrelationMode.Activity:
    default:
      return {
        mode: RecentActivityCorrelationMode.Activity,
        sort:
          sort === RecentActivityCorrelationSort.MostRecent ||
          sort === RecentActivityCorrelationSort.MostActive ||
          sort === RecentActivityCorrelationSort.Mixed
            ? sort
            : RecentActivityCorrelationSort.Mixed,
      };
  }
};

export const createRecentCorrelatedActivityFetchParams = (params: {
  organizationId: string;
  projectId: string;
  mode?: RecentActivityCorrelationMode | null;
  sort?: RecentActivityCorrelationSort | null;
  limit?: number;
  offset?: number;
}): RecentCorrelatedActivityFetchParams => ({
  organizationId: params.organizationId,
  projectId: params.projectId,
  ...normalizeRecentCorrelatedActivitySelection(params.mode, params.sort),
  limit: params.limit,
  offset: params.offset,
});

const resolveCorrelatedActivityRequest = (params: {
  projectId?: string | null;
  entityType?: EntityType | null;
  entityId?: string | null;
  mode?: RecentActivityCorrelationMode | null;
  sort?: RecentActivityCorrelationSort | null;
  activityType?: ActivityCorrelationActivityType[] | null;
  source?: ActivityCorrelationSource[] | null;
}): ResolvedCorrelatedActivityRequest => {
  const { projectId, entityType, entityId, mode, sort, activityType, source } =
    params;
  const hasEntityType = entityType !== null && entityType !== undefined;
  const normalizedEntityId =
    typeof entityId === "string" ? entityId.trim() : undefined;
  const hasEntityId =
    typeof normalizedEntityId === "string" && normalizedEntityId.length > 0;

  if (hasEntityType || hasEntityId) {
    if (!hasEntityType || !hasEntityId) {
      return { kind: "invalid" };
    }

    return {
      kind: "entity",
      entityType,
      entityId: normalizedEntityId,
      activityType: activityType ?? undefined,
      source: source ?? undefined,
    };
  }

  const normalizedProjectId =
    typeof projectId === "string" ? projectId.trim() : undefined;

  if (!normalizedProjectId) {
    return { kind: "invalid" };
  }

  return {
    kind: "recent",
    projectId: normalizedProjectId,
    ...normalizeRecentCorrelatedActivitySelection(mode, sort),
  };
};

const createEmptyCorrelatedActivityData = (
  limit: number,
  offset: number
): CorrelatedActivityData => ({
  items: [],
  records: [],
  pagination: {
    limit,
    offset,
    totalCount: 0,
    nextOffset: null,
  },
});

const normalizeEnumFilter = <T extends string>(values?: T[]): T[] | null => {
  if (!values || values.length === 0) {
    return null;
  }

  return [...new Set(values)].sort();
};

const isCrossProjectMetricParams = (
  params: CrossProjectActivityFetchParams
): params is CrossProjectActivityMetricParams =>
  params.metricContinuation !== undefined;

export const buildCrossProjectActivityRequest = (
  params: CrossProjectActivityFetchParams
): ActivityCorrelationApiQueryActivityRequest => {
  const {
    organizationId,
    limit = DEFAULT_LIMIT,
    offset = DEFAULT_OFFSET,
  } = params;

  return {
    organizationId,
    historyFilter: params.historyFilter,
    projectId: params.projectId,
    userId: params.userId,
    entityType: params.entityType,
    activityMode: params.activityMode,
    activityType: params.activityType,
    source: params.source,
    serviceId: params.serviceId,
    since: params.since,
    until: params.until,
    affectsMe: params.affectsMe,
    sinceLastVisit: params.sinceLastVisit,
    metricContinuation: params.metricContinuation
      ? {
          metric: params.metricContinuation.metric,
          projectIds: [...params.metricContinuation.projectIds],
          windowStart: params.metricContinuation.windowStart,
          windowEnd: params.metricContinuation.windowEnd,
          actorScope: params.metricContinuation.actorScope.mode,
          ...(params.metricContinuation.actorScope.mode === "PERSONAL"
            ? { actorUserId: params.metricContinuation.actorScope.userId }
            : {}),
        }
      : undefined,
    limit,
    offset,
  };
};

const parseNumericHeader = (value: unknown): number | null => {
  const rawValue = Array.isArray(value) ? value[0] : value;

  if (typeof rawValue === "number" && Number.isFinite(rawValue)) {
    return rawValue;
  }

  if (typeof rawValue === "string" && rawValue.trim() !== "") {
    const parsed = Number(rawValue);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isActivityCorrelationRecord = (
  value: unknown
): value is ActivityCorrelationRecordDto => {
  if (!isRecordObject(value)) {
    return false;
  }

  return (
    typeof value.entityId === "string" &&
    typeof value.entityType === "string" &&
    typeof value.projectId === "string" &&
    value.projectId.length > 0 &&
    typeof value.title === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.type === "string" &&
    typeof value.source === "string" &&
    Array.isArray(value.linkedEntities) &&
    Array.isArray(value.reports)
  );
};

const isRecentActivityCorrelationRecord = (
  value: unknown
): value is RecentActivityCorrelationRecordDto => {
  if (!isRecordObject(value)) {
    return false;
  }

  return (
    typeof value.entityId === "string" &&
    typeof value.entityType === "string" &&
    typeof value.title === "string" &&
    typeof value.timestamp === "string" &&
    Array.isArray(value.linkedEntities) &&
    Array.isArray(value.reports) &&
    !("type" in value) &&
    !("source" in value)
  );
};

const isRecordArray = <T>(
  value: unknown,
  guard: (item: unknown) => item is T
): value is T[] => Array.isArray(value) && value.every(guard);

const extractCorrelatedActivityRecords = <T>(
  responsePayload: unknown,
  guard: (item: unknown) => item is T
): T[] => {
  if (isRecordArray(responsePayload, guard)) {
    return responsePayload;
  }

  if (!isRecordObject(responsePayload)) {
    return [];
  }

  const directCandidates = [
    responsePayload.data,
    responsePayload.items,
    responsePayload.records,
  ];

  for (const candidate of directCandidates) {
    if (isRecordArray(candidate, guard)) {
      return candidate;
    }
  }

  const nestedPayload = responsePayload.data;
  if (isRecordObject(nestedPayload)) {
    const nestedCandidates = [
      nestedPayload.data,
      nestedPayload.items,
      nestedPayload.records,
    ];
    for (const candidate of nestedCandidates) {
      if (isRecordArray(candidate, guard)) {
        return candidate;
      }
    }
  }

  return [];
};

const extractTotalCount = (responsePayload: unknown): number | null => {
  if (!isRecordObject(responsePayload)) {
    return null;
  }

  const directTotalCount = parseNumericHeader(responsePayload.totalCount);
  if (directTotalCount !== null) {
    return directTotalCount;
  }

  const pagination = responsePayload.pagination;
  if (isRecordObject(pagination)) {
    return parseNumericHeader(pagination.totalCount);
  }

  return null;
};

const extractNextOffset = (responsePayload: unknown): number | null => {
  if (!isRecordObject(responsePayload)) {
    return null;
  }

  const directNextOffset = parseNumericHeader(responsePayload.nextOffset);
  if (directNextOffset !== null) {
    return directNextOffset;
  }

  const pagination = responsePayload.pagination;
  if (isRecordObject(pagination)) {
    return parseNumericHeader(pagination.nextOffset);
  }

  return null;
};

const toActivityTypeLabel = (
  value: ActivityCorrelationActivityType
): string => {
  switch (value) {
    case "VIEWED":
      return "Viewed";
    case "UNBLOCKED":
      return "Unblocked";
    case "NOTIFICATION":
      return "Notification";
    case "AGENT_SESSION_COMPLETED":
      return "Agent Session Completed";
    default:
      return value;
  }
};

const toSourceLabel = (value: ActivityCorrelationSource): string => {
  switch (value) {
    case "ATTENTION_EVENT":
      return "Attention";
    case "AGENT_SESSION":
      return "Agent Session";
    case "TASK_RELATIONSHIP":
      return "Task Relationship";
    case "REPORT":
      return "Report";
    case "SYSTEM":
      return "System";
    default:
      return value;
  }
};

const toRecentModeLabel = (value: RecentActivityCorrelationMode): string => {
  switch (value) {
    case "TASK":
      return "Recent task activity";
    case "AGENT_SESSION":
      return "Recent agent interaction activity";
    case "CODING_SESSION":
      return "Recent coding session activity";
    case "ACTIVITY":
    default:
      return "Recent activity";
  }
};

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
};

const toEntityActivityId = (record: ActivityCorrelationRecordDto): string => {
  return [
    record.entityType,
    record.entityId,
    record.type,
    record.timestamp,
    record.source,
  ].join(":");
};

const toRecentActivityId = (
  record: RecentActivityCorrelationRecordDto,
  mode: RecentActivityCorrelationMode
): string =>
  ["RECENT", mode, record.entityType, record.entityId, record.timestamp].join(
    ":"
  );

const buildEntityPreviewText = (
  record: ActivityCorrelationRecordDto
): string => {
  return `${toActivityTypeLabel(record.type)} from ${toSourceLabel(
    record.source
  )}`;
};

const buildRecentPreviewText = (
  mode: RecentActivityCorrelationMode
): string => {
  return toRecentModeLabel(mode);
};

export const getCorrelatedActivityPriorityRank = (
  record: Pick<EntityCorrelatedActivityListItem, "activityType" | "source">
): number => {
  return (
    (ACTIVITY_TYPE_PRIORITY[record.activityType] ?? 0) * 100 +
    (SOURCE_PRIORITY[record.source] ?? 0)
  );
};

export const shapeCorrelatedActivityPreview = (
  record: Pick<CorrelatedActivityListItem, "linkedEntities" | "reports">,
  previewText: string
): CorrelatedActivityPreview => {
  const linkedCount = record.linkedEntities.length;
  const reportCount = record.reports.length;
  const detailSegments: string[] = [];

  if (linkedCount > 0) {
    detailSegments.push(
      `${linkedCount} linked ${linkedCount === 1 ? "entity" : "entities"}`
    );
  }

  if (reportCount > 0) {
    detailSegments.push(
      `${reportCount} ${reportCount === 1 ? "report" : "reports"}`
    );
  }

  const detailSuffix =
    detailSegments.length > 0 ? `. ${detailSegments.join(", ")}.` : "";

  return {
    dropdown: truncateText(previewText, 120),
    full: `${previewText}${detailSuffix}`,
  };
};

export const mapCorrelatedActivityRecord = (
  record: ActivityCorrelationRecordDto
): EntityCorrelatedActivityListItem => {
  const activityId = toEntityActivityId(record);
  const previewText = buildEntityPreviewText(record);
  const preview = shapeCorrelatedActivityPreview(record, previewText);

  const mappedRecord: EntityCorrelatedActivityListItem = {
    kind: "entity",
    ...record,
    id: activityId as CorrelatedActivityId,
    activityId,
    activityType: record.type,
    source: record.source,
    previewText,
    preview,
    priorityRank: 0,
  };

  return {
    ...mappedRecord,
    priorityRank: getCorrelatedActivityPriorityRank(mappedRecord),
  };
};

export const mapRecentCorrelatedActivityRecord = (
  record: RecentActivityCorrelationRecordDto,
  mode: RecentActivityCorrelationMode,
  sort?: RecentActivityCorrelationSort
): RecentCorrelatedActivityListItem => {
  const activityId = toRecentActivityId(record, mode);
  const previewText = buildRecentPreviewText(mode);

  return {
    kind: "recent",
    ...record,
    id: activityId as CorrelatedActivityId,
    activityId,
    mode,
    sort,
    previewText,
    preview: shapeCorrelatedActivityPreview(record, previewText),
    priorityRank: 0,
  };
};

const compareCorrelatedActivityRecords = (
  left: EntityCorrelatedActivityListItem,
  right: EntityCorrelatedActivityListItem
): number => {
  const leftTime = new Date(left.timestamp).getTime();
  const rightTime = new Date(right.timestamp).getTime();

  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }

  if (left.priorityRank !== right.priorityRank) {
    return right.priorityRank - left.priorityRank;
  }

  return left.activityId.localeCompare(right.activityId);
};

const buildCorrelatedActivityDedupeKey = (
  item: CorrelatedActivityListItem
): string => {
  return item.kind === "entity"
    ? [item.activityId, item.timestamp, item.activityType, item.source].join(
        "::"
      )
    : [item.activityId, item.timestamp, item.mode].join("::");
};

export const mapEntityCorrelatedActivityRecords = (
  records: ActivityCorrelationRecordDto[]
): EntityCorrelatedActivityListItem[] => {
  const prioritizedRecords = records
    .map((record) => mapCorrelatedActivityRecord(record))
    .sort(compareCorrelatedActivityRecords);

  const dedupedRecords: EntityCorrelatedActivityListItem[] = [];
  const dedupeKeys = new Set<string>();

  prioritizedRecords.forEach((item) => {
    const dedupeKey = buildCorrelatedActivityDedupeKey(item);
    if (dedupeKeys.has(dedupeKey)) {
      return;
    }

    dedupeKeys.add(dedupeKey);
    dedupedRecords.push(item);
  });

  return dedupedRecords;
};

export const mapRecentCorrelatedActivityRecords = (
  records: RecentActivityCorrelationRecordDto[],
  mode: RecentActivityCorrelationMode,
  sort?: RecentActivityCorrelationSort
): RecentCorrelatedActivityListItem[] => {
  const dedupedRecords: RecentCorrelatedActivityListItem[] = [];
  const dedupeKeys = new Set<string>();

  records.forEach((record) => {
    const item = mapRecentCorrelatedActivityRecord(record, mode, sort);
    const dedupeKey = buildCorrelatedActivityDedupeKey(item);
    if (dedupeKeys.has(dedupeKey)) {
      return;
    }

    dedupeKeys.add(dedupeKey);
    dedupedRecords.push(item);
  });

  return dedupedRecords;
};

export const mapCorrelatedActivityRecords = (
  records: ActivityCorrelationRecordDto[]
): EntityCorrelatedActivityListItem[] => {
  return mapEntityCorrelatedActivityRecords(records);
};

const sleep = async (durationMs: number): Promise<void> => {
  await new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
};

const getErrorStatusCode = (error: unknown): number | null => {
  if (!isRecordObject(error)) {
    return null;
  }

  const response = error.response;
  if (!isRecordObject(response)) {
    return null;
  }

  return parseNumericHeader(response.status);
};

const isTransientCorrelationError = (error: unknown): boolean => {
  if (isRecordObject(error)) {
    const errorCode = error.code;
    const errorName = error.name;
    const errorMessage = error.message;

    if (errorCode === "ERR_CANCELED" || errorName === "AbortError") {
      return false;
    }

    if (
      typeof errorMessage === "string" &&
      /abort|cancel/i.test(errorMessage)
    ) {
      return false;
    }
  }

  const statusCode = getErrorStatusCode(error);

  if (statusCode === null) {
    return true;
  }

  return statusCode >= 500;
};

export async function fetchCorrelatedActivityPage(
  params: CorrelatedActivityFetchParams,
  retryConfig: CorrelatedActivityRetryConfig = DEFAULT_RETRY_CONFIG,
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<CorrelatedActivityData> {
  const {
    organizationId,
    projectId,
    entityType,
    entityId,
    mode,
    sort,
    activityType,
    source,
    limit = DEFAULT_LIMIT,
    offset = DEFAULT_OFFSET,
  } = params;
  const resolvedRecentMode = mode ?? DEFAULT_RECENT_ACTIVITY_FETCH_MODE;
  const resolvedRecentSort =
    sort ?? getDefaultRecentActivityFetchSort(resolvedRecentMode);
  const resolvedRequest = resolveCorrelatedActivityRequest({
    projectId,
    entityType,
    entityId,
    mode: resolvedRecentMode,
    sort: resolvedRecentSort,
    activityType,
    source,
  });

  if (resolvedRequest.kind === "invalid") {
    return createEmptyCorrelatedActivityData(limit, offset);
  }

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response =
        resolvedRequest.kind === "entity"
          ? await activityCorrelationClient.getCorrelatedActivityByEntity(
              {
                organizationId: organizationId,
                entityType: resolvedRequest.entityType,
                entityId: resolvedRequest.entityId,
                activityType: resolvedRequest.activityType,
                source: resolvedRequest.source,
                limit: limit,
                offset: offset,
              },
              requestOptions
            )
          : await activityCorrelationClient.getCorrelatedActivity(
              {
                organizationId: organizationId,
                projectId: resolvedRequest.projectId,
                mode: resolvedRequest.mode,
                sort: resolvedRequest.sort,
                limit: limit,
                offset: offset,
              },
              requestOptions
            );

      const responsePayload = response.data;

      const items =
        resolvedRequest.kind === "entity"
          ? mapEntityCorrelatedActivityRecords(
              extractCorrelatedActivityRecords(
                responsePayload,
                isActivityCorrelationRecord
              )
            )
          : mapRecentCorrelatedActivityRecords(
              extractCorrelatedActivityRecords(
                responsePayload,
                isRecentActivityCorrelationRecord
              ),
              resolvedRequest.mode ?? "ACTIVITY",
              resolvedRequest.sort
            );

      const totalCount =
        parseNumericHeader(response.headers?.["x-total-count"]) ??
        extractTotalCount(responsePayload);
      const nextOffset =
        parseNumericHeader(response.headers?.["x-next-offset"]) ??
        extractNextOffset(responsePayload);

      const pagination: CorrelatedActivityPagination = {
        limit,
        offset,
        totalCount,
        nextOffset,
      };

      return {
        items,
        records: items,
        pagination,
      };
    } catch (error) {
      const shouldRetry =
        attempt < retryConfig.maxRetries && isTransientCorrelationError(error);

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = Math.min(
        retryConfig.baseDelayMs * 2 ** attempt,
        retryConfig.maxDelayMs
      );
      await sleep(delayMs);
    }
  }
}

export async function fetchCrossProjectActivityPage(
  params: CrossProjectActivityFetchParams,
  retryConfig: CorrelatedActivityRetryConfig = DEFAULT_RETRY_CONFIG,
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<CorrelatedActivityData> {
  const limit = params.limit ?? DEFAULT_LIMIT;
  const offset = params.offset ?? DEFAULT_OFFSET;

  if (
    isCrossProjectMetricParams(params) &&
    params.metricContinuation.projectIds.length === 0
  ) {
    return {
      items: [],
      records: [],
      pagination: {
        limit,
        offset,
        totalCount: 0,
        nextOffset: null,
      },
    };
  }

  const request = buildCrossProjectActivityRequest(params);

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await activityCorrelationClient.queryActivity(
        request,
        requestOptions
      );
      const responsePayload = response.data;
      const items = mapEntityCorrelatedActivityRecords(
        extractCorrelatedActivityRecords(
          responsePayload,
          isActivityCorrelationRecord
        )
      );
      const totalCount =
        parseNumericHeader(response.headers?.["x-total-count"]) ??
        extractTotalCount(responsePayload);
      const nextOffset =
        parseNumericHeader(response.headers?.["x-next-offset"]) ??
        extractNextOffset(responsePayload);

      return {
        items,
        records: items,
        pagination: {
          limit,
          offset,
          totalCount,
          nextOffset,
        },
      };
    } catch (error) {
      const shouldRetry =
        attempt < retryConfig.maxRetries && isTransientCorrelationError(error);

      if (!shouldRetry) {
        throw error;
      }

      const delayMs = Math.min(
        retryConfig.baseDelayMs * 2 ** attempt,
        retryConfig.maxDelayMs
      );
      await sleep(delayMs);
    }
  }
}

function normalizeCorrelatedParams(
  params: CorrelatedActivityFetchParams
): CorrelatedActivityFetchParams {
  const request = resolveCorrelatedActivityRequest(params);
  if (request.kind === "invalid")
    throw new Error("Invalid correlated activity scope");
  const pagination = {
    limit: params.limit ?? DEFAULT_LIMIT,
    offset: params.offset ?? DEFAULT_OFFSET,
  };
  return request.kind === "entity"
    ? {
        organizationId: params.organizationId,
        entityType: request.entityType,
        entityId: request.entityId,
        activityType: normalizeEnumFilter(request.activityType) ?? undefined,
        source: normalizeEnumFilter(request.source) ?? undefined,
        ...pagination,
      }
    : createRecentCorrelatedActivityFetchParams({
        organizationId: params.organizationId,
        projectId: request.projectId,
        mode: request.mode,
        sort: request.sort,
        ...pagination,
      });
}

function normalizeCrossProjectParams(
  params: CrossProjectActivityFetchParams
): CrossProjectActivityFetchParams {
  const pagination = {
    limit: params.limit ?? DEFAULT_LIMIT,
    offset: params.offset ?? DEFAULT_OFFSET,
  };
  if (params.historyFilter !== undefined)
    return {
      organizationId: params.organizationId,
      historyFilter: params.historyFilter,
      ...pagination,
    };
  if (params.metricContinuation !== undefined)
    return {
      organizationId: params.organizationId,
      metricContinuation: params.metricContinuation,
      ...pagination,
    };
  return {
    ...params,
    entityType: normalizeEnumFilter(params.entityType) ?? undefined,
    activityType: normalizeEnumFilter(params.activityType) ?? undefined,
    source: normalizeEnumFilter(params.source) ?? undefined,
    ...pagination,
  };
}

// The hook exposes the requested offset page; additional pages belong to the infinite cache.
export const activityKeys = {
  root: () => ["activity"] as const,
  all: (organizationId: string) =>
    [...activityKeys.root(), organizationId] as const,
  correlated: (params: CorrelatedActivityFetchParams) =>
    [
      ...activityKeys.all(params.organizationId),
      "correlated",
      normalizeCorrelatedParams(params),
    ] as const,
  crossProject: (params: CrossProjectActivityFetchParams) =>
    [
      ...activityKeys.all(params.organizationId),
      "crossProject",
      normalizeCrossProjectParams(params),
    ] as const,
};

type ActivityQueryKey =
  | ReturnType<typeof activityKeys.correlated>
  | ReturnType<typeof activityKeys.crossProject>;

// Cached reads use TanStack retries, never nested page-fetch retries.
const NO_INTERNAL_RETRIES: CorrelatedActivityRetryConfig = {
  maxRetries: 0,
  baseDelayMs: 0,
  maxDelayMs: 0,
};

export function correlatedActivityQueryOptions(
  params: CorrelatedActivityFetchParams
) {
  const queryKey = activityKeys.correlated(params);
  return infiniteQueryOptions<
    CorrelatedActivityData,
    Error,
    InfiniteData<CorrelatedActivityData, number>,
    ActivityQueryKey,
    number
  >({
    ...dataLayerQueryPolicy,
    queryKey,
    initialPageParam: params.offset ?? DEFAULT_OFFSET,
    queryFn: ({ pageParam, signal }) =>
      fetchCorrelatedActivityPage(
        { ...queryKey[3], offset: pageParam },
        NO_INTERNAL_RETRIES,
        { ...captureRequestOptions(), signal }
      ),
    getNextPageParam: (page: CorrelatedActivityData) =>
      page.pagination.nextOffset ?? undefined,
  });
}

export function crossProjectActivityQueryOptions(
  params: CrossProjectActivityFetchParams
) {
  const queryKey = activityKeys.crossProject(params);
  return infiniteQueryOptions<
    CorrelatedActivityData,
    Error,
    InfiniteData<CorrelatedActivityData, number>,
    ActivityQueryKey,
    number
  >({
    ...dataLayerQueryPolicy,
    queryKey,
    initialPageParam: params.offset ?? DEFAULT_OFFSET,
    queryFn: ({ pageParam, signal }) =>
      fetchCrossProjectActivityPage(
        { ...queryKey[3], offset: pageParam },
        NO_INTERNAL_RETRIES,
        { ...captureRequestOptions(), signal }
      ),
    getNextPageParam: (page: CorrelatedActivityData) =>
      page.pagination.nextOffset ?? undefined,
  });
}

export function invalidateActivityQueries(
  queryClient: QueryClient,
  organizationId: string
): Promise<void> {
  return invalidateWithFollowUpRead(queryClient, {
    queryKey: activityKeys.all(organizationId),
  });
}

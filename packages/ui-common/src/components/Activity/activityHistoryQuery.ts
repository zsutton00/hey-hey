import type { CrossProjectActivityFeedQuery } from "./CrossProjectActivityFeed";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { ActivityHistoryFilterDto } from "../../api";
import { activityHistoryFilterSchema } from "../../generated/activity-history-contract";

const validateHistoryFilter = addFormats(
  new Ajv({
    strict: false,
    formats: { "branded-ProjectId": true, "branded-UserId": true },
  })
).compile<ActivityHistoryFilterDto>(activityHistoryFilterSchema);

export function parseActivityHistoryFilter(
  value: unknown
): ActivityHistoryFilterDto {
  if (
    !validateHistoryFilter(value) ||
    Date.parse(value.windowStart) >= Date.parse(value.windowEnd)
  ) {
    throw new Error("Invalid activity history filter");
  }
  return value;
}

export interface ActivityHistoryEdit {
  windowStart: string;
  windowEnd: string;
  userId?: string;
}

export function editActivityHistoryQuery(
  query: CrossProjectActivityFeedQuery,
  edit: ActivityHistoryEdit
): CrossProjectActivityFeedQuery {
  const metric = query.historyFilter ?? query.metricContinuation;
  if (metric) {
    return {
      historyFilter: {
        metric: metric.metric,
        projectIds: [...metric.projectIds],
        ...edit,
      },
      limit: query.limit,
      offset: 0,
    };
  }
  if (query.metricContinuation || query.historyFilter)
    throw new Error("Expected ordinary activity query");
  return {
    ...query,
    since: edit.windowStart,
    until: edit.windowEnd,
    userId: edit.userId,
    offset: 0,
  };
}

export function getActivityHistorySelection(
  query: CrossProjectActivityFeedQuery
): Partial<ActivityHistoryEdit> {
  if (query.historyFilter) return query.historyFilter;
  if (query.metricContinuation) {
    const continuation = query.metricContinuation;
    return {
      windowStart: continuation.windowStart,
      windowEnd: continuation.windowEnd,
      userId:
        continuation.actorScope.mode === "PERSONAL"
          ? continuation.actorScope.userId
          : undefined,
    };
  }
  return {
    windowStart: query.since,
    windowEnd: query.until,
    userId: query.userId,
  };
}

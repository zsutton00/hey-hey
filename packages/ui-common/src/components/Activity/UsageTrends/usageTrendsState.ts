import type {
  ReportUsageTrendGranularity,
  ReportUsageTrendKind,
  ReportUsageTrends,
} from "../../../api";
import type { ProjectReportUsageTrendsParams } from "../../../data/collections/reports";

/** URL-persisted view state. Dates are UTC calendar days, `to` inclusive. */
export interface UsageTrendsFilterState {
  from: string;
  to: string;
  granularity: ReportUsageTrendGranularity;
  reportKinds: ReportUsageTrendKind[];
  providers: string[];
  models: string[];
  efforts: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const toUtcDay = (date: Date): string => date.toISOString().slice(0, 10);

export const defaultUsageTrendsFilters = (
  now: Date = new Date(),
): UsageTrendsFilterState => ({
  from: toUtcDay(new Date(now.getTime() - 29 * DAY_MS)),
  to: toUtcDay(now),
  granularity: "day",
  reportKinds: [],
  providers: [],
  models: [],
  efforts: [],
});

const parseUtcDay = (value: string): Date | null => {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  // Round-trip rejects empty, malformed and impossible dates such as 2026-02-30.
  return Number.isNaN(parsed.getTime()) || toUtcDay(parsed) !== value
    ? null
    : parsed;
};

/** The API period is [from 00:00Z, day-after-to 00:00Z); null when the dates are not a valid period. */
export const toUsageTrendsParams = (
  filters: UsageTrendsFilterState,
): ProjectReportUsageTrendsParams | null => {
  const from = parseUtcDay(filters.from);
  const to = parseUtcDay(filters.to);

  if (!from || !to || from > to) {
    return null;
  }

  return {
    from: from.toISOString(),
    to: new Date(to.getTime() + DAY_MS).toISOString(),
    granularity: filters.granularity,
    reportKinds: filters.reportKinds,
    providers: filters.providers,
    models: filters.models,
    efforts: filters.efforts,
  };
};

export type UsageTrendsViewState =
  | { kind: "invalid-period" }
  | { kind: "loading" }
  | { kind: "error"; error: Error }
  | { kind: "empty" }
  | {
      kind: "ready";
      trends: ReportUsageTrends;
      hasCompleteMeasurements: boolean;
    };

export interface ResolveUsageTrendsViewStateInput {
  isPeriodValid: boolean;
  trends: ReportUsageTrends | null;
  error: Error | null;
  isLoading: boolean;
}

export const resolveUsageTrendsViewState = ({
  isPeriodValid,
  trends,
  error,
  isLoading,
}: ResolveUsageTrendsViewStateInput): UsageTrendsViewState => {
  if (!isPeriodValid) {
    return { kind: "invalid-period" };
  }

  if (isLoading && !trends) {
    return { kind: "loading" };
  }

  if (error && !trends) {
    return { kind: "error", error };
  }

  if (!trends || trends.executionCount === 0) {
    return { kind: "empty" };
  }

  return {
    kind: "ready",
    trends,
    hasCompleteMeasurements: trends.completeCount > 0,
  };
};

const utcFormat = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options });

const DAY_LABEL = utcFormat({ month: "short", day: "numeric" });
const MONTH_LABEL = utcFormat({ month: "short", year: "numeric" });

/** Bucket date text adapts to grouping: a day, the week's Monday, or a month. */
export const formatBucketDate = (
  start: string,
  granularity: ReportUsageTrendGranularity,
): string => {
  const date = new Date(start);

  return granularity === "month"
    ? MONTH_LABEL.format(date)
    : DAY_LABEL.format(date);
};

export const formatAverage = (value: number | null): string =>
  value === null ? "—" : Math.round(value).toLocaleString("en-US");

export const formatCount = (value: number): string =>
  value.toLocaleString("en-US");

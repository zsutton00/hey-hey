import { ReportType as PrismaReportType } from '@prisma/client';
import type {
  ReportUsageFigures,
  ReportUsageMeasurement,
  ReportUsageTrendAverages,
  ReportUsageTrendBucket,
  ReportUsageTrendGranularity,
  ReportUsageTrendOptions,
  ReportUsageTrendTotals,
  ReportUsageTrends,
} from 'src/generated';
import { ReportUsageCoverage, ReportUsageTrendKind } from 'src/generated';

/** Filter value standing for a provider or effort that was not recorded. */
export const UNKNOWN_USAGE_VALUE = 'unknown';

/** Report types that carry usage snapshots, mapped to the execution kind they represent. */
export const USAGE_TREND_REPORT_KINDS = {
  [PrismaReportType.CODING_RESEARCH]: ReportUsageTrendKind.Research,
  [PrismaReportType.IMPLEMENT]: ReportUsageTrendKind.Implementation,
  [PrismaReportType.REVIEW]: ReportUsageTrendKind.Review,
  [PrismaReportType.CHANGE_WALKTHROUGH]: ReportUsageTrendKind.Review,
} as const;

export interface UsageTrendRow {
  reportType: keyof typeof USAGE_TREND_REPORT_KINDS;
  usage: ReportUsageMeasurement;
}

export interface UsageTrendQuery {
  from: Date;
  to: Date;
  granularity: ReportUsageTrendGranularity;
  reportKinds: ReportUsageTrendKind[];
  providers: string[];
  models: string[];
  efforts: string[];
}

/** One provider/model/effort contribution to an execution's combined usage. */
interface Attribution {
  provider: string;
  model: string | null;
  effort: string;
  figures: ReportUsageFigures;
}

interface Execution {
  kind: ReportUsageTrendKind;
  capturedAt: Date;
  attributions: Attribution[];
  usage: ReportUsageMeasurement;
}

interface Sample {
  capturedAt: Date;
  figures: ReportUsageFigures;
}

type NumericFigure =
  | 'inputTokens'
  | 'freshInputTokens'
  | 'cacheReadInputTokens'
  | 'cacheCreationInputTokens'
  | 'outputTokens'
  | 'toolCalls';

const NUMERIC_FIGURES: NumericFigure[] = [
  'inputTokens',
  'freshInputTokens',
  'cacheReadInputTokens',
  'cacheCreationInputTokens',
  'outputTokens',
  'toolCalls',
];

/**
 * Aggregates stored usage snapshots into per-execution trends.
 *
 * - Snapshots are cumulative, so each execution contributes exactly one: its latest.
 * - A parent's snapshot already includes the research sub-agents it launched, so
 *   those sub-agents' own reports are not counted again.
 * - Provider, model and effort filters select breakdown contributions. An
 *   execution matches when any contribution matches all selected filters, and
 *   only the matching contributions' figures count. Missing provider or effort
 *   is the value "unknown".
 */
export function aggregateUsageTrends(
  rows: UsageTrendRow[],
  query: UsageTrendQuery,
): ReportUsageTrends {
  const inPeriod = excludeDelegatedReports(
    latestSnapshotPerExecution(rows),
  ).filter(
    (execution) =>
      execution.capturedAt >= query.from && execution.capturedAt < query.to,
  );
  const samples = inPeriod
    .filter(
      (execution) =>
        query.reportKinds.length === 0 ||
        query.reportKinds.includes(execution.kind),
    )
    .flatMap((execution) => {
      const sample = toSample(execution, query);
      return sample ? [sample] : [];
    });

  return {
    from: query.from.toISOString(),
    to: query.to.toISOString(),
    granularity: query.granularity,
    ...summarize(samples),
    buckets: bucketSamples(samples, query.granularity),
    options: collectOptions(inPeriod),
  };
}

function latestSnapshotPerExecution(rows: UsageTrendRow[]): Execution[] {
  const latest = new Map<string, Execution>();

  for (const row of rows) {
    const capturedAt = new Date(row.usage.capturedAt);
    const current = latest.get(row.usage.executionId);

    if (current && current.capturedAt >= capturedAt) {
      continue;
    }

    latest.set(row.usage.executionId, {
      kind: USAGE_TREND_REPORT_KINDS[row.reportType],
      capturedAt,
      attributions: attributionsOf(row.usage),
      usage: row.usage,
    });
  }

  return [...latest.values()];
}

type AttributedFigures = ReportUsageFigures & {
  provider: string | null;
  model: string | null;
  effort: string | null;
};

function attributionsOf(usage: ReportUsageMeasurement): Attribution[] {
  const sources: AttributedFigures[] =
    usage.breakdown.length > 0 ? usage.breakdown : [usage];

  return sources.map((source) => ({
    provider: source.provider ?? UNKNOWN_USAGE_VALUE,
    model: source.model,
    effort: source.effort ?? UNKNOWN_USAGE_VALUE,
    figures: source,
  }));
}

/**
 * Research sub-agents report on their own, but the launching parent's snapshot
 * already includes them. Drop the separate report so their usage counts once.
 */
function excludeDelegatedReports(executions: Execution[]): Execution[] {
  const included = new Set<string>();

  for (const execution of executions) {
    for (const entry of execution.usage.breakdown) {
      if (
        entry.role === 'subagent' &&
        entry.executionId !== execution.usage.executionId
      ) {
        included.add(entry.executionId);
      }
    }
  }

  return executions.filter(
    (execution) => !included.has(execution.usage.executionId),
  );
}

function matchesAttribution(
  attribution: Attribution,
  query: UsageTrendQuery,
): boolean {
  const allows = (selected: string[], value: string | null): boolean =>
    selected.length === 0 || (value !== null && selected.includes(value));

  return (
    allows(query.providers, attribution.provider) &&
    allows(query.models, attribution.model) &&
    allows(query.efforts, attribution.effort)
  );
}

function toSample(execution: Execution, query: UsageTrendQuery): Sample | null {
  const hasAttributionFilter =
    query.providers.length > 0 ||
    query.models.length > 0 ||
    query.efforts.length > 0;

  if (!hasAttributionFilter) {
    return { capturedAt: execution.capturedAt, figures: execution.usage };
  }

  const matching = execution.attributions.filter((attribution) =>
    matchesAttribution(attribution, query),
  );

  return matching.length > 0
    ? {
        capturedAt: execution.capturedAt,
        figures: combineEntries(matching.map(({ figures }) => figures)),
      }
    : null;
}

function combineEntries(entries: ReportUsageFigures[]): ReportUsageFigures {
  const sum = (figure: NumericFigure): number | null => {
    let total = 0;

    for (const entry of entries) {
      const value = entry[figure];

      if (value === null) {
        return null;
      }

      total += value;
    }

    return total;
  };

  const allCoverage = (target: ReportUsageCoverage): boolean =>
    entries.every((entry) => entry.coverage === target);
  const coverage = allCoverage(ReportUsageCoverage.Complete)
    ? ReportUsageCoverage.Complete
    : allCoverage(ReportUsageCoverage.Unavailable)
      ? ReportUsageCoverage.Unavailable
      : ReportUsageCoverage.Partial;
  const allReported = entries.every(
    (entry) => entry.cacheAvailability === 'reported',
  );

  return {
    inputTokens: sum('inputTokens'),
    freshInputTokens: sum('freshInputTokens'),
    cacheReadInputTokens: sum('cacheReadInputTokens'),
    cacheCreationInputTokens: sum('cacheCreationInputTokens'),
    outputTokens: sum('outputTokens'),
    toolCalls: sum('toolCalls'),
    cacheAvailability: allReported ? 'reported' : 'unreported',
    coverage,
  };
}

/** A sample feeds the averages only when every averaged figure was measured. */
function isComplete(figures: ReportUsageFigures): boolean {
  return (
    figures.coverage === ReportUsageCoverage.Complete &&
    figures.inputTokens !== null &&
    figures.outputTokens !== null &&
    figures.toolCalls !== null
  );
}

function summarize(
  samples: Sample[],
): Pick<
  ReportUsageTrends,
  | 'executionCount'
  | 'completeCount'
  | 'partialCount'
  | 'unavailableCount'
  | 'averages'
  | 'totals'
> {
  const complete = samples.filter((sample) => isComplete(sample.figures));
  const unavailable = samples.filter(
    (sample) => sample.figures.coverage === ReportUsageCoverage.Unavailable,
  );

  return {
    executionCount: samples.length,
    completeCount: complete.length,
    partialCount: samples.length - complete.length - unavailable.length,
    unavailableCount: unavailable.length,
    averages: averageOf(complete),
    totals: totalsOf(samples),
  };
}

function averageOf(complete: Sample[]): ReportUsageTrendAverages {
  if (complete.length === 0) {
    return { inputTokens: null, outputTokens: null, toolCalls: null };
  }

  const mean = (figure: 'inputTokens' | 'outputTokens' | 'toolCalls'): number =>
    complete.reduce((sum, sample) => sum + (sample.figures[figure] ?? 0), 0) /
    complete.length;

  return {
    inputTokens: mean('inputTokens'),
    outputTokens: mean('outputTokens'),
    toolCalls: mean('toolCalls'),
  };
}

function totalsOf(samples: Sample[]): ReportUsageTrendTotals {
  const totals: ReportUsageTrendTotals = {
    inputTokens: 0,
    freshInputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    outputTokens: 0,
    toolCalls: 0,
  };

  for (const sample of samples) {
    for (const figure of NUMERIC_FIGURES) {
      totals[figure] += sample.figures[figure] ?? 0;
    }
  }

  return totals;
}

function bucketSamples(
  samples: Sample[],
  granularity: ReportUsageTrendGranularity,
): ReportUsageTrendBucket[] {
  const groups = new Map<number, Sample[]>();

  for (const sample of samples) {
    const start = bucketStart(sample.capturedAt, granularity).getTime();
    groups.set(start, [...(groups.get(start) ?? []), sample]);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([start, group]) => {
      const {
        executionCount,
        completeCount,
        partialCount,
        unavailableCount,
        averages,
        totals,
      } = summarize(group);

      return {
        start: new Date(start).toISOString(),
        executionCount,
        completeCount,
        partialCount,
        unavailableCount,
        averages,
        totals,
      };
    });
}

/** UTC bucket start: midnight, ISO-week Monday midnight, or first of the month. */
export function bucketStart(
  date: Date,
  granularity: ReportUsageTrendGranularity,
): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (granularity === 'month') {
    return new Date(Date.UTC(year, month, 1));
  }

  if (granularity === 'week') {
    const daysSinceMonday = (date.getUTCDay() + 6) % 7;
    return new Date(Date.UTC(year, month, day - daysSinceMonday));
  }

  return new Date(Date.UTC(year, month, day));
}

function collectOptions(executions: Execution[]): ReportUsageTrendOptions {
  const distinct = (values: string[]): string[] => [...new Set(values)].sort();
  const attributions = executions.flatMap(
    (execution) => execution.attributions,
  );

  return {
    reportKinds: distinct(
      executions.map((execution) => execution.kind),
    ) as ReportUsageTrendKind[],
    providers: distinct(attributions.map(({ provider }) => provider)),
    models: distinct(
      attributions.flatMap(({ model }) => (model === null ? [] : [model])),
    ),
    efforts: distinct(attributions.map(({ effort }) => effort)),
  };
}

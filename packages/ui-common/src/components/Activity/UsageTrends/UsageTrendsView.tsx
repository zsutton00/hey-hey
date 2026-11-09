import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import { BarChart } from "@mui/x-charts/BarChart";
import { useTranslation } from "react-i18next";
import type { ReportUsageTrends } from "../../../api";
import { useProjectReportUsageTrends } from "../../../data/hooks/useProjectReportUsageTrends";
import { UsageTrendsFilters } from "./UsageTrendsFilters";
import {
  formatAverage,
  formatBucketDate,
  formatCount,
  resolveUsageTrendsViewState,
  toUsageTrendsParams,
  type UsageTrendsFilterState,
} from "./usageTrendsState";
import { useMemo } from "react";

export interface UsageTrendsViewProps {
  organizationId: string;
  projectId: string;
  filters: UsageTrendsFilterState;
  onFiltersChange: (filters: UsageTrendsFilterState) => void;
}

const CHART_HEIGHT = 260;

const SummaryCard = ({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) => (
  <Card
    variant="outlined"
    sx={{ flex: "1 1 220px", minWidth: 0 }}
    data-testid={testId}
  >
    <CardContent>
      <Typography variant="overline" color="text.secondary">
        {title}
      </Typography>
      {children}
    </CardContent>
  </Card>
);

const UsageTrendsReady = ({
  trends,
  hasCompleteMeasurements,
}: {
  trends: ReportUsageTrends;
  hasCompleteMeasurements: boolean;
}) => {
  const { t } = useTranslation();
  const bucketLabel = (start: string) => {
    const date = formatBucketDate(start, trends.granularity);

    return trends.granularity === "week"
      ? t("usageTrends.weekOf", { date })
      : date;
  };
  const labels = trends.buckets.map((bucket) => bucketLabel(bucket.start));
  const { averages, totals } = trends;

  return (
    <Stack spacing={3} data-testid="usage-trends-ready">
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="usage-trends-scope"
      >
        {t("usageTrends.scope", { count: trends.executionCount })}
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        data-testid="usage-trends-approximate"
      >
        {t("usageTrends.approximate")}
      </Typography>

      {!hasCompleteMeasurements && (
        <Alert severity="info" data-testid="usage-trends-incomplete">
          {t("usageTrends.noCompleteMeasurements")}
        </Alert>
      )}

      <Stack direction="row" flexWrap="wrap" gap={2}>
        <SummaryCard
          title={t("usageTrends.avgTokens")}
          testId="usage-trends-avg-tokens"
        >
          <Typography variant="h5">
            {formatAverage(averages.inputTokens)} {t("usageTrends.inputShort")}
          </Typography>
          <Typography variant="h5">
            {formatAverage(averages.outputTokens)}{" "}
            {t("usageTrends.outputShort")}
          </Typography>
        </SummaryCard>
        <SummaryCard
          title={t("usageTrends.avgToolCalls")}
          testId="usage-trends-avg-tools"
        >
          <Typography variant="h5">
            {formatAverage(averages.toolCalls)}
          </Typography>
        </SummaryCard>
        <SummaryCard
          title={t("usageTrends.measuredTotals")}
          testId="usage-trends-totals"
        >
          <Typography variant="body2">
            {t("usageTrends.totalInput", {
              value: formatCount(totals.inputTokens),
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary" component="div">
            {t("usageTrends.totalCache", {
              read: formatCount(totals.cacheReadInputTokens),
              creation: formatCount(totals.cacheCreationInputTokens),
            })}
          </Typography>
          <Typography variant="body2">
            {t("usageTrends.totalOutput", {
              value: formatCount(totals.outputTokens),
            })}
          </Typography>
          <Typography variant="body2">
            {t("usageTrends.totalToolCalls", {
              value: formatCount(totals.toolCalls),
            })}
          </Typography>
        </SummaryCard>
        <SummaryCard
          title={t("usageTrends.coverage")}
          testId="usage-trends-coverage"
        >
          <Typography variant="h5">
            {t("usageTrends.completeOf", {
              complete: formatCount(trends.completeCount),
              total: formatCount(trends.executionCount),
            })}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t("usageTrends.partialUnavailable", {
              partial: formatCount(trends.partialCount),
              unavailable: formatCount(trends.unavailableCount),
            })}
          </Typography>
        </SummaryCard>
      </Stack>

      <Box data-testid="usage-trends-token-chart">
        <Typography variant="subtitle2">
          {t("usageTrends.tokenChart")}
        </Typography>
        <BarChart
          height={CHART_HEIGHT}
          xAxis={[{ scaleType: "band", data: labels }]}
          series={[
            {
              label: t("usageTrends.input"),
              stack: "tokens",
              data: trends.buckets.map((bucket) => bucket.averages.inputTokens),
            },
            {
              label: t("usageTrends.output"),
              stack: "tokens",
              data: trends.buckets.map(
                (bucket) => bucket.averages.outputTokens,
              ),
            },
          ]}
        />
      </Box>

      <Box data-testid="usage-trends-tool-chart">
        <Typography variant="subtitle2">
          {t("usageTrends.toolChart")}
        </Typography>
        <BarChart
          height={CHART_HEIGHT}
          xAxis={[{ scaleType: "band", data: labels }]}
          series={[
            {
              label: t("usageTrends.toolCallsLabel"),
              data: trends.buckets.map((bucket) => bucket.averages.toolCalls),
            },
          ]}
        />
      </Box>

      <Table size="small" data-testid="usage-trends-table">
        <TableHead>
          <TableRow>
            <TableCell>{t("usageTrends.bucket")}</TableCell>
            <TableCell align="right">
              {t("usageTrends.completeMatching")}
            </TableCell>
            <TableCell align="right">{t("usageTrends.avgInput")}</TableCell>
            <TableCell align="right">{t("usageTrends.avgOutput")}</TableCell>
            <TableCell align="right">
              {t("usageTrends.avgToolCallsShort")}
            </TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {trends.buckets.map((bucket, index) => (
            <TableRow key={bucket.start} data-testid="usage-trends-row">
              <TableCell>{labels[index]}</TableCell>
              <TableCell align="right">
                {bucket.completeCount} / {bucket.executionCount}
              </TableCell>
              <TableCell align="right">
                {formatAverage(bucket.averages.inputTokens)}
              </TableCell>
              <TableCell align="right">
                {formatAverage(bucket.averages.outputTokens)}
              </TableCell>
              <TableCell align="right">
                {formatAverage(bucket.averages.toolCalls)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Typography
        variant="caption"
        color="text.secondary"
        data-testid="usage-trends-footnote"
      >
        {t("usageTrends.footnote", { count: trends.completeCount })}
      </Typography>
    </Stack>
  );
};

export const UsageTrendsView = ({
  organizationId,
  projectId,
  filters,
  onFiltersChange,
}: UsageTrendsViewProps) => {
  const { t } = useTranslation();
  const params = useMemo(() => toUsageTrendsParams(filters), [filters]);
  const isPeriodValid = params !== null;
  const { trends, isLoading, error } = useProjectReportUsageTrends(
    organizationId,
    projectId,
    params,
  );
  const state = resolveUsageTrendsViewState({
    isPeriodValid,
    trends,
    error,
    isLoading,
  });

  return (
    <Stack spacing={3} data-testid="usage-trends-view">
      <Typography variant="h6">{t("usageTrends.title")}</Typography>
      <UsageTrendsFilters
        value={filters}
        options={trends?.options ?? null}
        onChange={onFiltersChange}
      />
      {state.kind === "invalid-period" && (
        <Alert severity="warning" data-testid="usage-trends-invalid-period">
          {t("usageTrends.invalidPeriod")}
        </Alert>
      )}
      {state.kind === "loading" && (
        <Stack alignItems="center" p={4} data-testid="usage-trends-loading">
          <CircularProgress size={28} />
        </Stack>
      )}
      {state.kind === "error" && (
        <Alert severity="error" data-testid="usage-trends-error">
          {t("usageTrends.error")}
        </Alert>
      )}
      {state.kind === "empty" && (
        <Alert severity="info" data-testid="usage-trends-empty">
          {t("usageTrends.empty")}
        </Alert>
      )}
      {state.kind === "ready" && (
        <UsageTrendsReady
          trends={state.trends}
          hasCompleteMeasurements={state.hasCompleteMeasurements}
        />
      )}
    </Stack>
  );
};

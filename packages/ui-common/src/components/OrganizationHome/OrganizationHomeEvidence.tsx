import {
  Alert,
  Box,
  Button,
  Card as MuiCard,
  CardContent,
  CircularProgress,
  FormControl,
  IconButton,
  MenuItem,
  Select,
  Skeleton,
  Stack,
  Typography,
  Tooltip,
} from "@mui/material";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import React from "react";
import type { ActivityMetricContinuationDto } from "../../api";
import { usePathService } from "../../contexts";
import type { UseProjectMetricsReturn } from "../../data/hooks/useProjectMetrics";
import { useCanHover } from "../../hooks/useCanHover";
import { Card } from "../Card";
import {
  formatProjectMetricsWindow,
  groupProjectMetrics,
  hasCompleteProjectMetrics,
  type GroupedProjectMetricGroup,
} from "./organizationHomeMetrics";
import { CategoricalBarChart } from "./CategoricalBarChart";

export type OrganizationHomeMetricActivation = (path: string) => void;

type OrganizationHomeMetricContinuationActivation = (
  continuation: ActivityMetricContinuationDto
) => void;

export type OrganizationHomeEvidenceProps = Pick<
  UseProjectMetricsReturn,
  | "data"
  | "isLoading"
  | "isFetching"
  | "isFetched"
  | "isReady"
  | "error"
  | "isStale"
  | "refetch"
> & {
  /** The host owns navigation; this component owns the canonical Activity path. */
  organizationId: string | undefined;
  onMetricActivate: OrganizationHomeMetricActivation;
  title?: string;
  scopeLabel?: string;
  description?: string;
  infoDescription?: string;
  viewScope?: "project" | "organization";
  summaryAriaLabel?: string;
  includeProjectInfo?: boolean;
};

const EvidenceLoading: React.FC<{ includeProjectInfo: boolean }> = ({
  includeProjectInfo,
}) => (
  <Box data-testid="organization-home-evidence-loading">
    <Stack spacing={2}>
      {(includeProjectInfo ? ["throughput", "updates"] : ["throughput"]).map(
        (section) => (
          <MuiCard key={section} component="section">
            <CardContent sx={{ p: { xs: 2, sm: 3 } }}>
              <Skeleton variant="text" width="35%" height={32} />
              <Skeleton variant="text" width="55%" />
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {Array.from({ length: 4 }, (_, index) => (
                  <Skeleton
                    key={`${section}-${index}`}
                    variant="rounded"
                    height={44}
                  />
                ))}
              </Stack>
            </CardContent>
          </MuiCard>
        )
      )}
    </Stack>
  </Box>
);

const EvidenceError: React.FC<{
  incomplete?: boolean;
  onRetry: () => void;
}> = ({ incomplete = false, onRetry }) => (
  <Alert
    severity="error"
    data-testid="organization-home-evidence-error"
    action={
      <Button color="inherit" size="small" onClick={onRetry}>
        Retry
      </Button>
    }
  >
    {incomplete
      ? "The server returned incomplete rolling metrics."
      : "We couldn't load rolling metrics."}
  </Alert>
);

const MetricGroup: React.FC<{
  group: GroupedProjectMetricGroup;
  windowLabel: string;
  windowDetails: string;
  onActivate: OrganizationHomeMetricContinuationActivation;
}> = ({ group, windowLabel, windowDetails, onActivate }) => {
  const chartData = React.useMemo(
    () =>
      group.metrics.map((metric) => ({
        accessibleLabel: `${group.label}, ${metric.label}, ${String(
          metric.metric?.value ?? 0
        )}, ${windowLabel} (${windowDetails})`,
        label: metric.label,
        metric: metric.identity,
        value: metric.metric?.value ?? 0,
      })),
    [group.label, group.metrics, windowDetails, windowLabel]
  );

  return (
    <Box
      component="section"
      data-testid="organization-home-metric-group"
      data-group={group.key}
      aria-label={`${group.label}, ${windowLabel}`}
      sx={{
        minWidth: 0,
        p: 1.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
      }}
    >
      <Typography
        component="h3"
        variant="subtitle1"
        fontWeight={700}
        color="heyhey.main"
      >
        {group.label}
      </Typography>
      <CategoricalBarChart
        data={chartData}
        accessibleLabel={`${group.label}, ${windowLabel}`}
        onItemActivate={(dataIndex) => {
          const metric = group.metrics[dataIndex]?.metric;
          if (metric) onActivate(metric.activityContinuation);
        }}
      />
    </Box>
  );
};

const MetricSectionCard: React.FC<{
  testId: string;
  title: string;
  groups: GroupedProjectMetricGroup[];
  windowLabel: string;
  windowDetails: string;
  onActivate: OrganizationHomeMetricContinuationActivation;
  scopeLabel?: string;
  description?: string;
  infoDescription?: string;
  showTimeRange?: boolean;
}> = ({
  testId,
  title,
  groups,
  windowLabel,
  windowDetails,
  onActivate,
  scopeLabel,
  description,
  infoDescription,
  showTimeRange = false,
}) => {
  const canHover = useCanHover();
  return (
    <Card
      title={title}
      titleAccessory={
        infoDescription && canHover ? (
          <Tooltip title={infoDescription} arrow>
            <IconButton
              aria-label={`About ${title}`}
              size="small"
              data-testid="activity-section-info"
            >
              <InfoOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        ) : undefined
      }
      dataTestId={testId}
      inlineActionOnMobile
      action={
        showTimeRange ? (
          <FormControl size="small">
            <Select
              defaultValue="24h"
              inputProps={{ "aria-label": `${title} time range` }}
              sx={{ minWidth: { xs: 0, md: 112 } }}
            >
              <MenuItem value="24h">Last 24 hours</MenuItem>
            </Select>
          </FormControl>
        ) : undefined
      }
    >
      <Stack spacing={0.75} sx={{ mb: 2 }}>
        {scopeLabel && (
          <Typography variant="body2" fontWeight={700}>
            {scopeLabel}
          </Typography>
        )}
        {description && (
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        )}
      </Stack>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            sm: "repeat(2, minmax(0, 1fr))",
            md: `repeat(${groups.length}, minmax(0, 1fr))`,
          },
          gap: 2,
        }}
      >
        {groups.map((group) => (
          <MetricGroup
            key={group.key}
            group={group}
            windowLabel={windowLabel}
            windowDetails={windowDetails}
            onActivate={onActivate}
          />
        ))}
      </Box>
    </Card>
  );
};

export const OrganizationHomeEvidence: React.FC<
  OrganizationHomeEvidenceProps
> = ({
  data,
  isLoading,
  isFetching,
  isFetched,
  isReady,
  error,
  isStale,
  refetch,
  organizationId,
  onMetricActivate,
  title = "Organization Activity",
  scopeLabel = "All accessible projects",
  description = "Activity from everyone in the selected organization, limited to projects you can access.",
  infoDescription,
  viewScope,
  summaryAriaLabel = "Home activity summary",
  includeProjectInfo = true,
}) => {
  const pathService = usePathService();
  const handleMetricActivate = React.useCallback(
    (continuation: ActivityMetricContinuationDto) => {
      if (!organizationId) {
        return;
      }

      onMetricActivate(
        pathService.organizationActivity({
          organizationId,
          viewScope,
          metricContinuation: continuation,
        })
      );
    },
    [onMetricActivate, organizationId, pathService, viewScope]
  );
  const onRetry = React.useCallback(() => {
    void refetch().catch(() => undefined);
  }, [refetch]);

  if (isLoading || !isFetched) {
    return <EvidenceLoading includeProjectInfo={includeProjectInfo} />;
  }

  if (error || !isReady) {
    return <EvidenceError onRetry={onRetry} />;
  }

  if (!data) {
    return (
      <Box data-testid="organization-home-evidence-empty" sx={{ py: 2 }}>
        <Typography color="text.secondary">
          No rolling metrics are available yet.
        </Typography>
      </Box>
    );
  }

  if (!hasCompleteProjectMetrics(data.metrics, includeProjectInfo)) {
    return <EvidenceError incomplete onRetry={onRetry} />;
  }

  const groups = groupProjectMetrics(data.metrics);
  const windowLabel = "Last 24 hours";
  const windowDetails = formatProjectMetricsWindow(data);

  return (
    <Box
      component="section"
      data-testid="organization-home-evidence"
      aria-label={summaryAriaLabel}
      aria-busy={isFetching}
      sx={{ mt: { xs: 2, md: 3 } }}
    >
      <Stack spacing={0.5} sx={{ mb: 2 }}>
        {isFetching && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            data-testid="organization-home-evidence-fetching"
          >
            <CircularProgress size={16} aria-hidden="true" />
            <Typography variant="body2" color="text.secondary">
              Updating metrics…
            </Typography>
          </Stack>
        )}
        {isStale && !isFetching && (
          <Alert
            severity="info"
            data-testid="organization-home-evidence-stale"
            action={
              <Button color="inherit" size="small" onClick={onRetry}>
                Refresh
              </Button>
            }
          >
            These rolling metrics are stale.
          </Alert>
        )}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr)",
          gap: { xs: 2, md: 3 },
          alignItems: "start",
        }}
      >
        <MetricSectionCard
          testId="organization-home-throughput"
          title={title}
          groups={groups.throughput}
          windowLabel={windowLabel}
          windowDetails={windowDetails}
          onActivate={handleMetricActivate}
          scopeLabel={scopeLabel}
          description={description}
          infoDescription={infoDescription}
          showTimeRange
        />
        {includeProjectInfo && (
          <MetricSectionCard
            testId="organization-home-updates"
            title="Project Info Updates"
            groups={groups.updates}
            windowLabel={windowLabel}
            windowDetails={windowDetails}
            onActivate={handleMetricActivate}
          />
        )}
      </Box>
    </Box>
  );
};

export default OrganizationHomeEvidence;

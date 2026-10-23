import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Box,
  Typography,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Paper,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
  Alert,
  Chip,
  Pagination,
  IconButton,
  InputAdornment,
  Divider,
  Button,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import RefreshIcon from "@mui/icons-material/Refresh";
import SuccessIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import { LineChart } from "@mui/x-charts";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { KEYS } from "@hey-hey/ui-common/i18n";
import { apiClient } from "@hey-hey/ui-common/clients";
import type { LLMPromptResponseDto } from "@hey-hey/ui-common/api";

const ANALYTICS_PAGE_LIMIT = 200;
const ANALYTICS_MAX_PAGES = 10;

const toDateTimeInputValue = (value: Date): string => {
  const yyyy = value.getFullYear();
  const mm = String(value.getMonth() + 1).padStart(2, "0");
  const dd = String(value.getDate()).padStart(2, "0");
  const hh = String(value.getHours()).padStart(2, "0");
  const min = String(value.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
};

const toIsoOrUndefined = (value: string): string | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
};

interface DailyTrendPoint {
  date: string;
  cost: number;
  calls: number;
}

type TrendGranularity = "day" | "hour";

interface BreakdownRow {
  label: string;
  calls: number;
  totalCost: number;
}

interface AverageCostRow extends BreakdownRow {
  averageCost: number;
}

const toNumericValue = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const formatMoney = (amount: unknown): string => {
  const numericAmount = toNumericValue(amount);
  if (numericAmount === null) {
    return "Unknown";
  }

  return numericAmount.toLocaleString(undefined, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 6,
  });
};

const toLocalDateKey = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
};

const toLocalHourKey = (date: Date): string => {
  const dayKey = toLocalDateKey(date);
  const hh = String(date.getHours()).padStart(2, "0");
  return `${dayKey} ${hh}:00`;
};

const DailyTrendChart: React.FC<{
  data: DailyTrendPoint[];
  granularity: TrendGranularity;
}> = ({ data, granularity }) => {
  if (data.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No trend data available for the selected filters.
      </Typography>
    );
  }

  const labels = data.map((point) =>
    granularity === "hour" ? point.date.slice(5) : point.date.slice(5),
  );
  const costSeries = data.map((point) => point.cost);
  const callSeries = data.map((point) => point.calls);
  const labelPrefix = granularity === "hour" ? "Hourly" : "Daily";

  return (
    <Box sx={{ width: "100%", overflowX: "auto" }}>
      <LineChart
        height={280}
        xAxis={[
          {
            scaleType: "point",
            data: labels,
            label: granularity === "hour" ? "Hour" : "Day",
          },
        ]}
        yAxis={[
          {
            id: "cost-axis",
            label: "Cost ($)",
            valueFormatter: (value: number | null) => `$${formatMoney(value)}`,
          },
          {
            id: "calls-axis",
            label: "Calls",
            position: "right",
          },
        ]}
        series={[
          {
            id: "cost-series",
            yAxisId: "cost-axis",
            data: costSeries,
            label: `${labelPrefix} cost`,
            color: "#1565C0",
            showMark: data.length <= 20,
            valueFormatter: (value: number | null) => `$${formatMoney(value)}`,
          },
          {
            id: "calls-series",
            yAxisId: "calls-axis",
            data: callSeries,
            label: `${labelPrefix} calls`,
            color: "#2E7D32",
            showMark: data.length <= 20,
          },
        ]}
        margin={{ left: 70, right: 70, top: 24, bottom: 52 }}
      />
    </Box>
  );
};

export const LLMTrackingListPage: React.FC = (): React.ReactElement => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [records, setRecords] = useState<LLMPromptResponseDto[]>([]);
  const [analyticsRecords, setAnalyticsRecords] = useState<LLMPromptResponseDto[]>(
    [],
  );
  const [loading, setLoading] = useState(true);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsTruncated, setAnalyticsTruncated] = useState(false);
  const analyticsRequestIdRef = useRef(0);

  // Pagination
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 200;

  // Filters
  const [searchTerm, setSearchTerm] = useState("");
  const [providerFilter, setProviderFilter] = useState("");
  const [successFilter, setSuccessFilter] = useState<string>("");
  const [organizationFilter, setOrganizationFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");
  const [nodeFilter, setNodeFilter] = useState("");
  const [startDateFilter, setStartDateFilter] = useState(() => {
    const start = new Date();
    start.setHours(start.getHours() - 24);
    return toDateTimeInputValue(start);
  });
  const [endDateFilter, setEndDateFilter] = useState(() =>
    toDateTimeInputValue(new Date()),
  );
  const hasDateFilters = Boolean(startDateFilter || endDateFilter);

  // Fetch records
  const fetchRecords = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      const response = await apiClient.getLlmTrackingRecords({
        page: hasDateFilters ? undefined : page,
        limit: hasDateFilters ? undefined : limit,
        projectId: projectFilter || undefined,
        orgId: organizationFilter || undefined,
        nodeId: nodeFilter || undefined,
        provider: providerFilter || undefined,
        success: successFilter === "" ? undefined : successFilter === "true",
        startDate: toIsoOrUndefined(startDateFilter),
        endDate: toIsoOrUndefined(endDateFilter),
      });

      const data = response.data.data;
      setRecords(data?.data ?? []);
      setTotal(data?.pagination?.total ?? 0);
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { message?: string } };
      };
      console.error("Failed to fetch LLM tracking records:", error);
      setError(
        error.response?.data?.message ||
          error.message ||
          "Failed to load LLM tracking records",
      );
    } finally {
      setLoading(false);
    }
  }, [
    endDateFilter,
    hasDateFilters,
    limit,
    nodeFilter,
    organizationFilter,
    page,
    projectFilter,
    providerFilter,
    startDateFilter,
    successFilter,
  ]);

  const fetchAnalyticsRecords = useCallback(async (): Promise<void> => {
    const requestId = analyticsRequestIdRef.current + 1;
    analyticsRequestIdRef.current = requestId;

    try {
      setAnalyticsLoading(true);
      setAnalyticsError(null);
      setAnalyticsTruncated(false);

      const allRecords: LLMPromptResponseDto[] = [];
      let currentPage = 1;
      let totalPages = 1;
      const useUnboundedDateMode = hasDateFilters;

      while (currentPage <= totalPages && currentPage <= ANALYTICS_MAX_PAGES) {
        const response = await apiClient.getLlmTrackingRecords({
          page: useUnboundedDateMode ? undefined : currentPage,
          limit: useUnboundedDateMode ? undefined : ANALYTICS_PAGE_LIMIT,
          projectId: projectFilter || undefined,
          orgId: organizationFilter || undefined,
          nodeId: nodeFilter || undefined,
          provider: providerFilter || undefined,
          success: successFilter === "" ? undefined : successFilter === "true",
          startDate: toIsoOrUndefined(startDateFilter),
          endDate: toIsoOrUndefined(endDateFilter),
        });

        const pageData = response.data.data;
        const pageRecords = pageData?.data ?? [];
        allRecords.push(...pageRecords);

        if (useUnboundedDateMode) {
          break;
        }

        const totalRecords = pageData?.pagination?.total ?? allRecords.length;
        totalPages = Math.max(
          1,
          Math.ceil(totalRecords / ANALYTICS_PAGE_LIMIT),
        );

        if (pageRecords.length === 0) {
          break;
        }

        currentPage += 1;
      }

      if (analyticsRequestIdRef.current !== requestId) {
        return;
      }

      setAnalyticsRecords(allRecords);
      setAnalyticsTruncated(!useUnboundedDateMode && currentPage <= totalPages);
    } catch (err: unknown) {
      if (analyticsRequestIdRef.current !== requestId) {
        return;
      }

      const error = err as {
        message?: string;
        response?: { data?: { message?: string } };
      };
      console.error("Failed to fetch LLM analytics records:", error);
      setAnalyticsError(
        error.response?.data?.message ||
          error.message ||
          "Failed to load LLM analytics records",
      );
      setAnalyticsRecords([]);
    } finally {
      if (analyticsRequestIdRef.current === requestId) {
        setAnalyticsLoading(false);
      }
    }
  }, [
    endDateFilter,
    hasDateFilters,
    nodeFilter,
    organizationFilter,
    projectFilter,
    providerFilter,
    startDateFilter,
    successFilter,
  ]);

  useEffect(() => {
    void fetchRecords();
  }, [fetchRecords]);

  useEffect(() => {
    void fetchAnalyticsRecords();
  }, [fetchAnalyticsRecords]);

  useEffect(() => {
    setPage(1);
  }, [
    providerFilter,
    successFilter,
    projectFilter,
    nodeFilter,
    startDateFilter,
    endDateFilter,
    organizationFilter,
  ]);

  const organizationOptions = useMemo((): string[] => {
    const options = new Set<string>();
    analyticsRecords.forEach((record) => {
      if (record.organizationId) {
        options.add(record.organizationId);
      }
    });
    return Array.from(options).sort();
  }, [analyticsRecords]);

  const projectOptions = useMemo((): string[] => {
    const options = new Set<string>();
    analyticsRecords.forEach((record) => {
      if (record.projectId) {
        options.add(record.projectId);
      }
    });
    return Array.from(options).sort();
  }, [analyticsRecords]);

  const nodeOptions = useMemo((): string[] => {
    const options = new Set<string>();
    analyticsRecords.forEach((record) => {
      if (record.nodeId) {
        options.add(record.nodeId);
      }
    });
    return Array.from(options).sort();
  }, [analyticsRecords]);

  useEffect(() => {
    if (organizationFilter && !organizationOptions.includes(organizationFilter)) {
      setOrganizationFilter("");
    }
  }, [organizationFilter, organizationOptions]);

  useEffect(() => {
    if (projectFilter && !projectOptions.includes(projectFilter)) {
      setProjectFilter("");
    }
  }, [projectFilter, projectOptions]);

  useEffect(() => {
    if (nodeFilter && !nodeOptions.includes(nodeFilter)) {
      setNodeFilter("");
    }
  }, [nodeFilter, nodeOptions]);

  // Filter records by search term (client-side)
  const filteredRecords = useMemo((): LLMPromptResponseDto[] => {
    if (!searchTerm) return records;

    const lowerSearch = searchTerm.toLowerCase();
    return records.filter(
      (record) =>
        record.prompt?.toLowerCase().includes(lowerSearch) ||
        record.responseContent?.toLowerCase().includes(lowerSearch) ||
        record.model?.toLowerCase().includes(lowerSearch) ||
        record.provider?.toLowerCase().includes(lowerSearch),
    );
  }, [records, searchTerm]);

  const analyticsVisibleRecords = useMemo((): LLMPromptResponseDto[] => {
    if (!organizationFilter) {
      return analyticsRecords;
    }

    return analyticsRecords.filter(
      (record) => record.organizationId === organizationFilter,
    );
  }, [analyticsRecords, organizationFilter]);

  const totalCost = useMemo(
    () =>
      analyticsVisibleRecords.reduce(
        (sum, record) => sum + (toNumericValue(record.totalCost) ?? 0),
        0,
      ),
    [analyticsVisibleRecords],
  );

  const callsWithCost = useMemo(
    () =>
      analyticsVisibleRecords.filter(
        (record) => toNumericValue(record.totalCost) !== null,
      ).length,
    [analyticsVisibleRecords],
  );

  const averageCostPerCall = useMemo(() => {
    if (callsWithCost === 0) return null;
    return totalCost / callsWithCost;
  }, [callsWithCost, totalCost]);

  const averageTokens = useMemo(() => {
    const recordsWithTokens = analyticsVisibleRecords.filter(
      (record) => toNumericValue(record.totalTokens) !== null,
    );
    if (recordsWithTokens.length === 0) return null;
    const tokenSum = recordsWithTokens.reduce(
      (sum, record) => sum + (toNumericValue(record.totalTokens) ?? 0),
      0,
    );
    return tokenSum / recordsWithTokens.length;
  }, [analyticsVisibleRecords]);

  const totalOutputTokens = useMemo(
    () =>
      analyticsVisibleRecords.reduce(
        (sum, record) => sum + (toNumericValue(record.completionTokens) ?? 0),
        0,
      ),
    [analyticsVisibleRecords],
  );

  const averageOutputTokens = useMemo(() => {
    const recordsWithOutputTokens = analyticsVisibleRecords.filter(
      (record) => toNumericValue(record.completionTokens) !== null,
    );
    if (recordsWithOutputTokens.length === 0) return null;
    return totalOutputTokens / recordsWithOutputTokens.length;
  }, [analyticsVisibleRecords, totalOutputTokens]);

  const successCount = useMemo(
    () => analyticsVisibleRecords.filter((record) => record.success).length,
    [analyticsVisibleRecords],
  );

  const successRate = useMemo(() => {
    if (analyticsVisibleRecords.length === 0) return null;
    return (successCount / analyticsVisibleRecords.length) * 100;
  }, [analyticsVisibleRecords, successCount]);

  const trendGranularity = useMemo<TrendGranularity>(() => {
    const startIso = toIsoOrUndefined(startDateFilter);
    const endIso = toIsoOrUndefined(endDateFilter);
    if (!startIso || !endIso) {
      return "day";
    }

    const startMs = new Date(startIso).getTime();
    const endMs = new Date(endIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      return "day";
    }

    return endMs - startMs <= 24 * 60 * 60 * 1000 ? "hour" : "day";
  }, [endDateFilter, startDateFilter]);

  const dailyTrend = useMemo((): DailyTrendPoint[] => {
    const totals = new Map<string, DailyTrendPoint>();
    analyticsVisibleRecords.forEach((record) => {
      if (!record.createdAt) {
        return;
      }

      const createdAt = new Date(record.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        return;
      }

      const key =
        trendGranularity === "hour"
          ? toLocalHourKey(createdAt)
          : toLocalDateKey(createdAt);
      const current = totals.get(key) ?? { date: key, cost: 0, calls: 0 };
      current.cost += toNumericValue(record.totalCost) ?? 0;
      current.calls += 1;
      totals.set(key, current);
    });

    return Array.from(totals.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }, [analyticsVisibleRecords, trendGranularity]);

  const buildBreakdown = useCallback(
    (
      items: LLMPromptResponseDto[],
      labelForRecord: (record: LLMPromptResponseDto) => string | null | undefined,
    ): BreakdownRow[] => {
      const grouped = new Map<string, BreakdownRow>();
      items.forEach((record) => {
        const rawLabel = labelForRecord(record);
        const label = rawLabel && rawLabel.trim() ? rawLabel : "Unspecified";
        const current = grouped.get(label) ?? { label, calls: 0, totalCost: 0 };
        current.calls += 1;
        current.totalCost += toNumericValue(record.totalCost) ?? 0;
        grouped.set(label, current);
      });

      return Array.from(grouped.values())
        .sort((a, b) => {
          if (b.totalCost !== a.totalCost) {
            return b.totalCost - a.totalCost;
          }
          return b.calls - a.calls;
        })
        .slice(0, 8);
    },
    [],
  );

  const nodeBreakdown = useMemo(
    () => buildBreakdown(analyticsVisibleRecords, (record) => record.nodeId),
    [analyticsVisibleRecords, buildBreakdown],
  );

  const organizationBreakdown = useMemo(
    () =>
      buildBreakdown(analyticsVisibleRecords, (record) => record.organizationId),
    [analyticsVisibleRecords, buildBreakdown],
  );

  const projectBreakdown = useMemo(
    () => buildBreakdown(analyticsVisibleRecords, (record) => record.projectId),
    [analyticsVisibleRecords, buildBreakdown],
  );

  const mostExpensiveCalls = useMemo((): AverageCostRow[] => {
    const grouped = new Map<
      string,
      {
        label: string;
        calls: number;
        totalCost: number;
      }
    >();

    analyticsVisibleRecords.forEach((record) => {
      const numericCost = toNumericValue(record.totalCost);
      if (numericCost === null) {
        return;
      }

      const provider = record.provider?.trim() || "Unknown provider";
      const model = record.model?.trim() || "Unknown model";
      const nodeId = record.nodeId?.trim() || "Unspecified node";
      const key = `${provider}|${model}|${nodeId}`;
      const label = `${provider} • ${model} • ${nodeId}`;

      const current = grouped.get(key) ?? { label, calls: 0, totalCost: 0 };
      current.calls += 1;
      current.totalCost += numericCost;
      grouped.set(key, current);
    });

    return Array.from(grouped.values())
      .map((entry) => ({
        ...entry,
        averageCost: entry.totalCost / entry.calls,
      }))
      .sort((a, b) => {
        if (b.averageCost !== a.averageCost) {
          return b.averageCost - a.averageCost;
        }
        if (b.totalCost !== a.totalCost) {
          return b.totalCost - a.totalCost;
        }
        return b.calls - a.calls;
      })
      .slice(0, 8);
  }, [analyticsVisibleRecords]);

  const handleRecordClick = (id: string): void => {
    navigate(`/llm-tracking/${id}`);
  };

  const handleRefresh = (): void => {
    void fetchRecords();
    void fetchAnalyticsRecords();
  };

  const handlePageChange = (
    _event: React.ChangeEvent<unknown>,
    value: number,
  ): void => {
    setPage(value);
  };

  const applyDatePreset = (days: number): void => {
    const end = new Date();
    const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

    setStartDateFilter(toDateTimeInputValue(start));
    setEndDateFilter(toDateTimeInputValue(end));
  };

  const clearDatePreset = (): void => {
    setStartDateFilter("");
    setEndDateFilter("");
  };

  const formatDuration = (ms: number | null | undefined): string => {
    if (!ms) return t(KEYS.common.unknown);
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatDate = (dateString: string | undefined): string => {
    if (!dateString) return t(KEYS.common.unknown);
    return new Date(dateString).toLocaleString();
  };

  const formatCost = (cost: number | null | undefined): string => {
    if (cost === null || cost === undefined) return t(KEYS.common.unknown);
    return cost.toLocaleString(undefined, {
      minimumFractionDigits: 4,
      maximumFractionDigits: 6,
    });
  };

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" gutterBottom>
          {t(KEYS.llmTracking.title)}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {t(KEYS.llmTracking.subtitle)}
        </Typography>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3 }}>
        <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
          {/* Search */}
          <TextField
            placeholder={t(KEYS.llmTracking.search)}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            sx={{ flexGrow: 1, minWidth: 200 }}
            size="small"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon />
                  </InputAdornment>
                ),
              },
            }}
          />

          {/* Provider Filter */}
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{t(KEYS.llmTracking.filters.provider)}</InputLabel>
            <Select
              value={providerFilter}
              label={t(KEYS.llmTracking.filters.provider)}
              onChange={(e) => setProviderFilter(e.target.value)}
            >
              <MenuItem value="">
                {t(KEYS.llmTracking.filters.allProviders)}
              </MenuItem>
              <MenuItem value="anthropic">Anthropic</MenuItem>
              <MenuItem value="openai">OpenAI</MenuItem>
            </Select>
          </FormControl>

          {/* Success Filter */}
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <InputLabel>{t(KEYS.llmTracking.filters.success)}</InputLabel>
            <Select
              value={successFilter}
              label={t(KEYS.llmTracking.filters.success)}
              onChange={(e) => setSuccessFilter(e.target.value)}
            >
              <MenuItem value="">
                {t(KEYS.llmTracking.filters.allStatuses)}
              </MenuItem>
              <MenuItem value="true">
                {t(KEYS.llmTracking.filters.successful)}
              </MenuItem>
              <MenuItem value="false">
                {t(KEYS.llmTracking.filters.failed)}
              </MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Organization</InputLabel>
            <Select
              value={organizationFilter}
              label="Organization"
              onChange={(e) => setOrganizationFilter(e.target.value)}
            >
              <MenuItem value="">All organizations</MenuItem>
              {organizationOptions.map((organizationId) => (
                <MenuItem key={organizationId} value={organizationId}>
                  {organizationId}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Project</InputLabel>
            <Select
              value={projectFilter}
              label="Project"
              onChange={(e) => setProjectFilter(e.target.value)}
            >
              <MenuItem value="">All projects</MenuItem>
              {projectOptions.map((projectId) => (
                <MenuItem key={projectId} value={projectId}>
                  {projectId}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>Node</InputLabel>
            <Select
              value={nodeFilter}
              label="Node"
              onChange={(e) => setNodeFilter(e.target.value)}
            >
              <MenuItem value="">All nodes</MenuItem>
              {nodeOptions.map((currentNodeId) => (
                <MenuItem key={currentNodeId} value={currentNodeId}>
                  {currentNodeId}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Start"
            type="datetime-local"
            value={startDateFilter}
            onChange={(e) => setStartDateFilter(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 220 }}
          />

          <TextField
            label="End"
            type="datetime-local"
            value={endDateFilter}
            onChange={(e) => setEndDateFilter(e.target.value)}
            size="small"
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ minWidth: 220 }}
          />

          {/* Refresh Button */}
          <IconButton onClick={handleRefresh} color="primary">
            <RefreshIcon />
          </IconButton>
        </Box>

        <Box sx={{ display: "flex", gap: 1, mt: 2, flexWrap: "wrap" }}>
          <Button size="small" variant="outlined" onClick={() => applyDatePreset(1)}>
            1D
          </Button>
          <Button size="small" variant="outlined" onClick={() => applyDatePreset(7)}>
            Last 7d
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => applyDatePreset(30)}
          >
            Last 30d
          </Button>
          <Button
            size="small"
            variant="outlined"
            onClick={() => applyDatePreset(90)}
          >
            Last 90d
          </Button>
          <Button size="small" variant="text" onClick={clearDatePreset}>
            Clear dates
          </Button>
        </Box>
      </Paper>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Admin Analytics
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Aggregated usage and cost trends from recent LLM calls.
        </Typography>

        {analyticsLoading ? (
          <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
            <CircularProgress size={24} />
          </Box>
        ) : analyticsError ? (
          <Alert severity="error">{analyticsError}</Alert>
        ) : (
          <>
            {analyticsTruncated && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Analytics are based on the most recent{" "}
                {ANALYTICS_PAGE_LIMIT * ANALYTICS_MAX_PAGES} records.
              </Alert>
            )}

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, mb: 3 }}>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 190, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Total calls
                </Typography>
                <Typography variant="h5">
                  {analyticsVisibleRecords.length.toLocaleString()}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 190, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Total cost
                </Typography>
                <Typography variant="h5">${formatMoney(totalCost)}</Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 190, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Avg cost / call
                </Typography>
                <Typography variant="h5">
                  {averageCostPerCall === null
                    ? t(KEYS.common.unknown)
                    : `$${formatMoney(averageCostPerCall)}`}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 190, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Success rate
                </Typography>
                <Typography variant="h5">
                  {successRate === null ? "N/A" : `${successRate.toFixed(1)}%`}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 190, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Avg tokens / call
                </Typography>
                <Typography variant="h5">
                  {averageTokens === null
                    ? t(KEYS.common.unknown)
                    : Math.round(averageTokens).toLocaleString()}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 190, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Avg output tokens / call
                </Typography>
                <Typography variant="h5">
                  {averageOutputTokens === null
                    ? t(KEYS.common.unknown)
                    : Math.round(averageOutputTokens).toLocaleString()}
                </Typography>
              </Paper>
              <Paper variant="outlined" sx={{ p: 2, minWidth: 190, flex: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  Total output tokens
                </Typography>
                <Typography variant="h5">
                  {totalOutputTokens.toLocaleString()}
                </Typography>
              </Paper>
            </Box>

            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
              <Typography variant="subtitle1" sx={{ mb: 1 }}>
                {trendGranularity === "hour"
                  ? "Hourly cost and call trend"
                  : "Daily cost and call trend"}
              </Typography>
              <DailyTrendChart data={dailyTrend} granularity={trendGranularity} />
            </Paper>

            <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 280 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Cost by Node
                </Typography>
                <Divider sx={{ mb: 1 }} />
                {nodeBreakdown.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No node-level data.
                  </Typography>
                ) : (
                  nodeBreakdown.map((entry) => (
                    <Box
                      key={`node-${entry.label}`}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        py: 0.5,
                        gap: 2,
                      }}
                    >
                      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                        {entry.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {entry.calls} calls • ${formatMoney(entry.totalCost)}
                      </Typography>
                    </Box>
                  ))
                )}
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 280 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Cost by Organization
                </Typography>
                <Divider sx={{ mb: 1 }} />
                {organizationBreakdown.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No organization data.
                  </Typography>
                ) : (
                  organizationBreakdown.map((entry) => (
                    <Box
                      key={`org-${entry.label}`}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        py: 0.5,
                        gap: 2,
                      }}
                    >
                      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                        {entry.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {entry.calls} calls • ${formatMoney(entry.totalCost)}
                      </Typography>
                    </Box>
                  ))
                )}
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 280 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Cost by Project
                </Typography>
                <Divider sx={{ mb: 1 }} />
                {projectBreakdown.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No project data.
                  </Typography>
                ) : (
                  projectBreakdown.map((entry) => (
                    <Box
                      key={`project-${entry.label}`}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        py: 0.5,
                        gap: 2,
                      }}
                    >
                      <Typography variant="body2" sx={{ wordBreak: "break-all" }}>
                        {entry.label}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {entry.calls} calls • ${formatMoney(entry.totalCost)}
                      </Typography>
                    </Box>
                  ))
                )}
              </Paper>

              <Paper variant="outlined" sx={{ p: 2, flex: 1, minWidth: 280 }}>
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                  Most expensive calls (avg)
                </Typography>
                <Divider sx={{ mb: 1 }} />
                {mostExpensiveCalls.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No cost data available.
                  </Typography>
                ) : (
                  mostExpensiveCalls.map((entry) => (
                    <Box
                      key={`avg-cost-${entry.label}`}
                      sx={{
                        display: "flex",
                        justifyContent: "space-between",
                        py: 0.5,
                        gap: 2,
                      }}
                    >
                      <Typography variant="body2" sx={{ wordBreak: "break-word" }}>
                        {entry.label}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ textAlign: "right", whiteSpace: "nowrap" }}
                      >
                        {entry.calls} calls • avg ${formatMoney(entry.averageCost)}
                      </Typography>
                    </Box>
                  ))
                )}
              </Paper>
            </Box>
          </>
        )}
      </Paper>

      {/* Content */}
      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress />
        </Box>
      ) : error ? (
        <Alert severity="error">{error}</Alert>
      ) : filteredRecords.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: "center" }}>
          <Typography variant="h6" gutterBottom>
            {t(KEYS.llmTracking.noRecords)}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t(KEYS.llmTracking.adjustSearch)}
          </Typography>
        </Paper>
      ) : (
        <>
          <List>
            {filteredRecords.map((record) => (
              <Paper
                key={record.id}
                sx={{ mb: 2, cursor: "pointer" }}
                onClick={() => handleRecordClick(record.id)}
              >
                <ListItem>
                  <ListItemText
                    primary={
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mb: 1,
                        }}
                      >
                        {record.success ? (
                          <SuccessIcon color="success" fontSize="small" />
                        ) : (
                          <ErrorIcon color="error" fontSize="small" />
                        )}
                        <Typography
                          variant="subtitle1"
                          sx={{ fontWeight: 600 }}
                        >
                          {record.model}
                        </Typography>
                        <Chip label={record.provider} size="small" />
                        {record.nodeId && (
                          <Chip
                            label={`Node: ${record.nodeId}`}
                            size="small"
                            variant="outlined"
                          />
                        )}
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography
                          variant="body2"
                          color="text.primary"
                          sx={{
                            mb: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {record.prompt?.substring(0, 200)}...
                        </Typography>
                        <Box
                          sx={{ display: "flex", gap: 2, fontSize: "0.875rem" }}
                        >
                          <Typography variant="caption" color="text.secondary">
                            {formatDate(record.createdAt)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            Duration: {formatDuration(record.durationMs)}
                          </Typography>
                          {toNumericValue(record.totalTokens) !== null && (
                            <Typography variant="caption" color="text.secondary">
                              Tokens:{" "}
                              {(toNumericValue(record.totalTokens) ?? 0).toLocaleString()}
                            </Typography>
                          )}
                          {toNumericValue(record.totalCost) !== null && (
                            <Typography variant="caption" color="text.secondary">
                              Total Cost: ${formatCost(toNumericValue(record.totalCost))}
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    }
                  />
                </ListItem>
              </Paper>
            ))}
          </List>

          {/* Pagination */}
          {!hasDateFilters && total > limit && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 3 }}>
              <Pagination
                count={Math.ceil(total / limit)}
                page={page}
                onChange={handlePageChange}
                color="primary"
              />
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import React, { useState, useMemo } from "react";
import {
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Tabs,
  Tab,
  Grid,
  TextField,
  MenuItem,
  FormControl,
  InputLabel,
  Select,
  Switch,
  FormControlLabel,
  Stack,
  Divider,
  IconButton,
  Tooltip,
  Card,
  CardContent,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ExportIcon from "@mui/icons-material/GetApp";
import ClearIcon from "@mui/icons-material/Clear";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FilterIcon from "@mui/icons-material/FilterList";
import SettingsIcon from "@mui/icons-material/Settings";
import AnalyticsIcon from "@mui/icons-material/Analytics";
import TimelineIcon from "@mui/icons-material/Timeline";
import Storage from "@mui/icons-material/Storage";
// Note: Date picker functionality requires @mui/x-date-pickers package
// import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
// import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
// import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { useTranslation } from "react-i18next";
import { useWebSocketDebug } from "../../data/websockets/debug";
import { WebSocketEventsList } from "./WebSocketEventsList";
import { WebSocketStatsPanel } from "./WebSocketStatsPanel";
import { CollectionDebug } from "./CollectionDebug";
import type { WebSocketEventFilter } from "./debug.types";

interface WebSocketDebugModalProps {
  /** Whether the modal is open */
  open: boolean;
  /** Callback when modal is closed */
  onClose: () => void;
  /** Update interval in milliseconds (default: 1000) */
  updateInterval?: number;
  /** Maximum number of events to keep (default: 1000) */
  maxEvents?: number;
}

type TabType =
  | "events"
  | "subscriptions"
  | "connection"
  | "collections"
  | "analytics"
  | "settings";

export const WebSocketDebugModal: React.FC<WebSocketDebugModalProps> = ({
  open,
  onClose,
  updateInterval = 1000,
  maxEvents = 1000,
}) => {
  const { t } = useTranslation();

  const [selectedTab, setSelectedTab] = useState<TabType>("events");
  const [eventFilter, setEventFilter] = useState<WebSocketEventFilter>({});
  const [advancedFiltersOpen, setAdvancedFiltersOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"json" | "csv">("json");
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Use the WebSocket debug hook with full event history
  const {
    events,
    connectionState,
    collections,
    clearEventLog,
    exportDebugData,
  } = useWebSocketDebug({
    updateInterval: autoRefresh ? updateInterval : 0,
    maxEvents,
  });

  // Map new system data to old interface for compatibility
  const subscriptionStats = {
    totalActiveSubscriptions: collections.reduce(
      (sum, c) =>
        sum + c.activeQueries.listQueries + c.activeQueries.singleQueries,
      0,
    ),
    uniqueDataSubscriptions: collections.reduce(
      (sum, c) =>
        sum + c.activeQueries.listQueries + c.activeQueries.singleQueries,
      0,
    ),
    subscriptionCountByKey: {},
    duplicateSubscriptions: 0,
  };

  const activeSubscriptions = collections.map((collection) => ({
    subscriptionKey: `${collection.name}-collection`,
    webSocketSubscriptionId: `${collection.name}-ws`,
    referenceCount:
      collection.activeQueries.listQueries +
      collection.activeQueries.singleQueries,
    config: {
      projectIds: [],
      conversationIds: [],
      initiativeIds: [],
      eventCount: collection.totalItems,
    },
  }));

  // Advanced analytics
  const analytics = useMemo(() => {
    const now = Date.now();
    const last5Min = events.filter(
      (e) => now - new Date(e.timestamp).getTime() < 300000,
    );
    const lastHour = events.filter(
      (e) => now - new Date(e.timestamp).getTime() < 3600000,
    );

    const eventsByType = events.reduce(
      (acc, event) => {
        acc[event.type] = (acc[event.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const eventsBySource = events.reduce(
      (acc, event) => {
        acc[event.source] = (acc[event.source] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    const errorEvents = events.filter(
      (event) =>
        event.metadata?.success === false ||
        JSON.stringify(event.data).includes("error") ||
        JSON.stringify(event.data).includes("Error"),
    );

    return {
      totalEvents: events.length,
      eventsLast5Min: last5Min.length,
      eventsLastHour: lastHour.length,
      eventsByType,
      eventsBySource,
      errorEvents,
      errorRate:
        events.length > 0 ? (errorEvents.length / events.length) * 100 : 0,
      avgEventsPerMinute: lastHour.length / 60,
      peakEventRate: Math.max(
        ...Array.from({ length: 12 }, (_, i) => {
          const periodStart = now - (i + 1) * 300000; // 5-minute periods
          const periodEnd = now - i * 300000;
          return events.filter((e) => {
            const time = new Date(e.timestamp).getTime();
            return time >= periodStart && time < periodEnd;
          }).length;
        }),
      ),
    };
  }, [events]);

  const handleTabChange = (_event: React.SyntheticEvent, newValue: TabType) => {
    setSelectedTab(newValue);
  };

  const handleExport = () => {
    const data = exportDebugData();
    let content: string;
    let filename: string;
    let mimeType: string;

    if (exportFormat === "csv") {
      // Convert to CSV format
      const csvHeaders = [
        "ID",
        "Timestamp",
        "Type",
        "Source",
        "Data",
        "Success",
      ];
      const csvRows = events.map((event) => [
        event.id,
        event.timestamp,
        event.type,
        event.source,
        JSON.stringify(event.data).replace(/"/g, '""'),
        event.metadata?.success !== false ? "true" : "false",
      ]);

      content = [csvHeaders, ...csvRows]
        .map((row) => row.map((cell) => `"${cell}"`).join(","))
        .join("\n");
      filename = `websocket-debug-${Date.now()}.csv`;
      mimeType = "text/csv";
    } else {
      content = data;
      filename = `websocket-debug-${Date.now()}.json`;
      mimeType = "application/json";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const resetFilters = () => {
    setEventFilter({});
  };

  return (
    // <LocalizationProvider dateAdapter={AdapterDateFns}>
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      sx={{
        "& .MuiDialog-paper": {
          height: "90vh",
          maxHeight: "90vh",
        },
      }}
      closeControl={
        <IconButton size="small" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      }
    >
      <DialogTitle>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <AnalyticsIcon color="primary" />
            <Typography variant="h6">
              {t("debug.websocketDebugModal", "WebSocket Debug Console")}
            </Typography>
          </Box>

          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Tooltip title={t("debug.refresh", "Refresh")}>
              <IconButton size="small">
                <RefreshIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title={t("debug.export", "Export Data")}>
              <IconButton size="small" onClick={handleExport}>
                <ExportIcon />
              </IconButton>
            </Tooltip>

            <Tooltip title={t("debug.clearAll", "Clear All Data")}>
              <IconButton size="small" onClick={clearEventLog}>
                <ClearIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </DialogTitle>

      <Box sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Tabs
          value={selectedTab}
          onChange={handleTabChange}
          aria-label="debug console tabs"
        >
          <Tab
            label={t("debug.events", "Events")}
            value="events"
            icon={<TimelineIcon />}
            iconPosition="start"
          />
          <Tab
            label={t("debug.subscriptions", "Subscriptions")}
            value="subscriptions"
            icon={<SettingsIcon />}
            iconPosition="start"
          />
          <Tab
            label={t("debug.connection", "Connection")}
            value="connection"
            icon={<AnalyticsIcon />}
            iconPosition="start"
          />
          <Tab
            label={t("debug.collections", "Collections")}
            value="collections"
            icon={<Storage />}
            iconPosition="start"
          />
          <Tab
            label={t("debug.analytics", "Analytics")}
            value="analytics"
            icon={<AnalyticsIcon />}
            iconPosition="start"
          />
          <Tab
            label={t("debug.settings", "Settings")}
            value="settings"
            icon={<SettingsIcon />}
            iconPosition="start"
          />
        </Tabs>
      </Box>

      <DialogContent sx={{ p: 0, height: "100%", overflow: "hidden" }}>
        <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
          {/* Events Tab */}
          {selectedTab === "events" && (
            <>
              {/* Advanced Filters */}
              <Accordion
                expanded={advancedFiltersOpen}
                onChange={(_, expanded) => setAdvancedFiltersOpen(expanded)}
              >
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <FilterIcon fontSize="small" />
                    <Typography variant="subtitle2">
                      {t("debug.advancedFilters", "Advanced Filters")}
                    </Typography>
                    {Object.keys(eventFilter).length > 0 && (
                      <Typography variant="caption" color="primary">
                        ({Object.keys(eventFilter).length} active)
                      </Typography>
                    )}
                  </Box>
                </AccordionSummary>
                <AccordionDetails>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel>
                          {t("debug.eventType", "Event Type")}
                        </InputLabel>
                        <Select
                          value={eventFilter.type || ""}
                          label={t("debug.eventType", "Event Type")}
                          onChange={(e) => {
                            const value = e.target.value as
                              WebSocketEventFilter["type"] | "";
                            setEventFilter({
                              ...eventFilter,
                              type: value === "" ? undefined : value,
                            });
                          }}
                        >
                          <MenuItem value="">{t("debug.all", "All")}</MenuItem>
                          <MenuItem value="subscription_created">
                            Subscription Created
                          </MenuItem>
                          <MenuItem value="subscription_removed">
                            Subscription Removed
                          </MenuItem>
                          <MenuItem value="subscription_updated">
                            Subscription Updated
                          </MenuItem>
                          <MenuItem value="websocket_event">
                            WebSocket Event
                          </MenuItem>
                          <MenuItem value="cache_update">Cache Update</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <TextField
                        fullWidth
                        size="small"
                        label={t("debug.source", "Source")}
                        value={eventFilter.source || ""}
                        onChange={(e) =>
                          setEventFilter({
                            ...eventFilter,
                            source: e.target.value || undefined,
                          })
                        }
                      />
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      {/* DateTimePicker requires @mui/x-date-pickers package */}
                      <TextField
                        fullWidth
                        size="small"
                        label={t("debug.startTime", "Start Time")}
                        type="datetime-local"
                        value={
                          eventFilter.timeRange?.start
                            ?.toISOString()
                            .slice(0, 16) || ""
                        }
                        onChange={(e) => {
                          const newStart = e.target.value
                            ? new Date(e.target.value)
                            : undefined;
                          setEventFilter((prev) => {
                            const updatedRange = {
                              start: newStart,
                              end: prev.timeRange?.end,
                            };
                            const nextFilter: WebSocketEventFilter = {
                              ...prev,
                            };

                            if (!updatedRange.start && !updatedRange.end) {
                              delete nextFilter.timeRange;
                              return nextFilter;
                            }

                            return {
                              ...nextFilter,
                              timeRange: updatedRange,
                            };
                          });
                        }}
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>

                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                      <TextField
                        fullWidth
                        size="small"
                        label={t("debug.endTime", "End Time")}
                        type="datetime-local"
                        value={
                          eventFilter.timeRange?.end
                            ?.toISOString()
                            .slice(0, 16) || ""
                        }
                        onChange={(e) => {
                          const newEnd = e.target.value
                            ? new Date(e.target.value)
                            : undefined;
                          setEventFilter((prev) => {
                            const updatedRange = {
                              start: prev.timeRange?.start,
                              end: newEnd,
                            };
                            const nextFilter: WebSocketEventFilter = {
                              ...prev,
                            };

                            if (!updatedRange.start && !updatedRange.end) {
                              delete nextFilter.timeRange;
                              return nextFilter;
                            }

                            return {
                              ...nextFilter,
                              timeRange: updatedRange,
                            };
                          });
                        }}
                        InputLabelProps={{ shrink: true }}
                      />
                    </Grid>

                    <Grid size={{ xs: 12 }}>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 2 }}
                      >
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={resetFilters}
                          disabled={Object.keys(eventFilter).length === 0}
                        >
                          {t("debug.resetFilters", "Reset Filters")}
                        </Button>
                      </Box>
                    </Grid>
                  </Grid>
                </AccordionDetails>
              </Accordion>

              <Divider />

              <Box sx={{ flex: 1, overflow: "hidden" }}>
                <WebSocketEventsList
                  events={events}
                  filter={eventFilter}
                  onFilterChange={setEventFilter}
                  autoScroll={true}
                  showTimestamps={true}
                  maxHeight="100%"
                />
              </Box>
            </>
          )}

          {/* Other tabs use existing components */}
          {(selectedTab === "subscriptions" ||
            selectedTab === "connection") && (
            <WebSocketStatsPanel
              connectionState={connectionState}
              subscriptionStats={subscriptionStats}
              events={events}
              activeSubscriptions={activeSubscriptions}
            />
          )}

          {/* Collections Tab */}
          {selectedTab === "collections" && (
            <Box sx={{ p: 2, overflow: "auto", height: "100%" }}>
              <CollectionDebug
                updateInterval={updateInterval}
                showDetails={true}
              />
            </Box>
          )}

          {/* Analytics Tab */}
          {selectedTab === "analytics" && (
            <Box sx={{ p: 3, overflow: "auto" }}>
              <Grid container spacing={3}>
                {/* Summary Cards */}
                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography
                        color="textSecondary"
                        gutterBottom
                        variant="caption"
                      >
                        {t("debug.totalEvents", "Total Events")}
                      </Typography>
                      <Typography variant="h4" component="div">
                        {analytics.totalEvents}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography
                        color="textSecondary"
                        gutterBottom
                        variant="caption"
                      >
                        {t("debug.eventsLastHour", "Events (Last Hour)")}
                      </Typography>
                      <Typography variant="h4" component="div">
                        {analytics.eventsLastHour}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography
                        color="textSecondary"
                        gutterBottom
                        variant="caption"
                      >
                        {t("debug.errorRate", "Error Rate")}
                      </Typography>
                      <Typography
                        variant="h4"
                        component="div"
                        color={analytics.errorRate > 5 ? "error" : "success"}
                      >
                        {analytics.errorRate.toFixed(1)}%
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                  <Card>
                    <CardContent>
                      <Typography
                        color="textSecondary"
                        gutterBottom
                        variant="caption"
                      >
                        {t("debug.avgPerMinute", "Avg Events/Min")}
                      </Typography>
                      <Typography variant="h4" component="div">
                        {analytics.avgEventsPerMinute.toFixed(1)}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>

                {/* Event Type Breakdown */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        {t("debug.eventsByType", "Events by Type")}
                      </Typography>
                      <Stack spacing={1}>
                        {Object.entries(analytics.eventsByType)
                          .sort(([, a], [, b]) => b - a)
                          .map(([type, count]) => (
                            <Box
                              key={type}
                              sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <Typography variant="body2">
                                {type.replace("_", " ")}
                              </Typography>
                              <Typography variant="body2" fontWeight={600}>
                                {count}
                              </Typography>
                            </Box>
                          ))}
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>

                {/* Event Sources */}
                <Grid size={{ xs: 12, md: 6 }}>
                  <Card>
                    <CardContent>
                      <Typography variant="h6" gutterBottom>
                        {t("debug.eventsBySource", "Events by Source")}
                      </Typography>
                      <Stack spacing={1}>
                        {Object.entries(analytics.eventsBySource)
                          .sort(([, a], [, b]) => b - a)
                          .map(([source, count]) => (
                            <Box
                              key={source}
                              sx={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                              }}
                            >
                              <Typography variant="body2">{source}</Typography>
                              <Typography variant="body2" fontWeight={600}>
                                {count}
                              </Typography>
                            </Box>
                          ))}
                      </Stack>
                    </CardContent>
                  </Card>
                </Grid>
              </Grid>
            </Box>
          )}

          {/* Settings Tab */}
          {selectedTab === "settings" && (
            <Box sx={{ p: 3 }}>
              <Stack spacing={3}>
                <Typography variant="h6">
                  {t("debug.debugSettings", "Debug Settings")}
                </Typography>

                <FormControlLabel
                  control={
                    <Switch
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                    />
                  }
                  label={t("debug.autoRefresh", "Auto-refresh data")}
                />

                <FormControl fullWidth>
                  <InputLabel>
                    {t("debug.exportFormat", "Export Format")}
                  </InputLabel>
                  <Select
                    value={exportFormat}
                    label={t("debug.exportFormat", "Export Format")}
                    onChange={(e) =>
                      setExportFormat(e.target.value as "json" | "csv")
                    }
                  >
                    <MenuItem value="json">JSON</MenuItem>
                    <MenuItem value="csv">CSV</MenuItem>
                  </Select>
                </FormControl>

                <Typography variant="body2" color="text.secondary">
                  {t(
                    "debug.settingsNote",
                    "More debug settings will be available in future versions.",
                  )}
                </Typography>
              </Stack>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
          {t(
            "debug.keyboardShortcuts",
            "Shortcuts: Ctrl+Shift+W (toggle), Ctrl+Shift+X (clear), Ctrl+Shift+E (export)",
          )}
        </Typography>
        <Button onClick={onClose}>{t("common.close", "Close")}</Button>
      </DialogActions>
    </Dialog>
    // </LocalizationProvider>
  );
};

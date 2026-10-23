import React from "react";
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  Chip,
  LinearProgress,
  Stack,
  Divider,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  type ChipProps,
} from "@mui/material";
import ConnectedIcon from "@mui/icons-material/WifiOutlined";
import DisconnectedIcon from "@mui/icons-material/WifiOffOutlined";
import HealthyIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorIcon from "@mui/icons-material/ErrorOutline";
import WarningIcon from "@mui/icons-material/WarningAmberOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SpeedIcon from "@mui/icons-material/Speed";
import MetricsIcon from "@mui/icons-material/Timeline";
import SubscriptionIcon from "@mui/icons-material/Hub";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type {
  WebSocketConnectionHealth,
  WebSocketSubscriptionHealth,
} from "./debug.types";
import type { WebSocketEvent } from "../../data/websockets/debug";

interface SubscriptionStats {
  totalActiveSubscriptions: number;
  uniqueDataSubscriptions: number;
  subscriptionCountByKey: Record<string, number>;
  duplicateSubscriptions: number;
}

interface WebSocketStatsPanelProps {
  connectionState: {
    isConnected: boolean;
    isAuthenticated: boolean;
    connectionError: string | null;
  };
  subscriptionStats: SubscriptionStats;
  events: WebSocketEvent[];
  connectionHealth?: WebSocketConnectionHealth;
  subscriptionHealth?: WebSocketSubscriptionHealth;
  activeSubscriptions: Array<{
    subscriptionKey: string;
    webSocketSubscriptionId: string;
    referenceCount: number;
    config: {
      projectIds?: string[];
      conversationIds?: string[];
      initiativeIds?: string[];
      eventTypes?: string[];
      subscriptionType?:
        | "initiative-specific"
        | "project-specific"
        | "org-wide";
      subscriptionIndex?: number;
      eventCount: number;
    };
  }>;
}

export const WebSocketStatsPanel: React.FC<WebSocketStatsPanelProps> = ({
  connectionState,
  subscriptionStats,
  events,
  connectionHealth,
  subscriptionHealth,
  activeSubscriptions,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();

  const subscriptionHealthMetrics = React.useMemo(() => {
    if (subscriptionHealth) {
      return subscriptionHealth;
    }

    const totalActive = subscriptionStats.totalActiveSubscriptions;
    const duplicateCount = subscriptionStats.duplicateSubscriptions;
    const healthySubscriptions = subscriptionStats.uniqueDataSubscriptions;
    const totalReferenceCount = Object.values(
      subscriptionStats.subscriptionCountByKey
    ).reduce((sum, count) => sum + count, 0);
    const avgReferenceCount =
      totalActive > 0 ? totalReferenceCount / totalActive : 0;

    return {
      totalActive,
      healthySubscriptions,
      duplicateCount,
      errorCount: Math.max(
        totalActive - healthySubscriptions - duplicateCount,
        0
      ),
      avgReferenceCount,
    } satisfies WebSocketSubscriptionHealth;
  }, [subscriptionHealth, subscriptionStats]);

  // Calculate event statistics
  const eventStats = React.useMemo(() => {
    const eventCounts: Record<string, number> = {};
    const errorCounts: Record<string, number> = {};
    const recentEvents = events.filter(
      (event) => Date.now() - new Date(event.timestamp).getTime() < 300000 // Last 5 minutes
    );

    events.forEach((event) => {
      eventCounts[event.type] = (eventCounts[event.type] || 0) + 1;

      const isError =
        event.metadata?.success === false ||
        JSON.stringify(event.data).includes("error") ||
        JSON.stringify(event.data).includes("Error");

      if (isError) {
        errorCounts[event.type] = (errorCounts[event.type] || 0) + 1;
      }
    });

    return {
      total: events.length,
      recent: recentEvents.length,
      eventCounts,
      errorCounts,
      errorRate:
        events.length > 0
          ? Object.values(errorCounts).reduce((a, b) => a + b, 0) /
            events.length
          : 0,
    };
  }, [events]);

  const getConnectionStatusColor = (): string => {
    if (!connectionState.isConnected) return theme.palette.error.main;
    if (!connectionState.isAuthenticated) return theme.palette.warning.main;
    return theme.palette.success.main;
  };

  const getConnectionStatusIcon = () => {
    if (!connectionState.isConnected) return <DisconnectedIcon color="error" />;
    if (!connectionState.isAuthenticated)
      return <WarningIcon color="warning" />;
    return <ConnectedIcon color="success" />;
  };

  const getConnectionStatusText = (): string => {
    if (!connectionState.isConnected)
      return t("debug.disconnected", "Disconnected");
    if (!connectionState.isAuthenticated)
      return t("debug.unauthenticated", "Unauthenticated");
    return t("debug.connected", "Connected");
  };

  const formatUptime = (uptimeMs: number): string => {
    const seconds = Math.floor(uptimeMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatLatency = (latency: number): string => {
    if (latency < 100) return `${latency}ms`;
    if (latency < 1000) return `${latency}ms`;
    return `${(latency / 1000).toFixed(1)}s`;
  };

  return (
    <Box sx={{ p: 2, height: "100%", overflow: "auto" }}>
      <Stack spacing={3}>
        {/* Connection Status */}
        <Card elevation={1}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              {getConnectionStatusIcon()}
              <Box sx={{ flex: 1 }}>
                <Typography variant="h6" component="div">
                  {t("debug.connection", "Connection")}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {getConnectionStatusText()}
                </Typography>
              </Box>
              <Chip
                label={getConnectionStatusText()}
                size="small"
                sx={{
                  backgroundColor: getConnectionStatusColor() + "20",
                  color: getConnectionStatusColor(),
                  fontWeight: 600,
                }}
              />
            </Box>

            {connectionState.connectionError && (
              <Box
                sx={{
                  mt: 2,
                  p: 1,
                  backgroundColor: theme.palette.error.light + "20",
                  borderRadius: 1,
                }}
              >
                <Typography variant="body2" color="error">
                  {t("debug.connectionError", "Connection Error")}:{" "}
                  {connectionState.connectionError}
                </Typography>
              </Box>
            )}

            {connectionHealth && (
              <Grid container spacing={2} sx={{ mt: 1 }}>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.uptime", "Uptime")}
                  </Typography>
                  <Typography variant="body2">
                    {formatUptime(connectionHealth.uptime)}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.reconnections", "Reconnections")}
                  </Typography>
                  <Typography variant="body2">
                    {connectionHealth.reconnectionAttempts}
                  </Typography>
                </Grid>
                {connectionHealth.averageLatency && (
                  <>
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t("debug.avgLatency", "Avg Latency")}
                      </Typography>
                      <Typography variant="body2">
                        {formatLatency(connectionHealth.averageLatency)}
                      </Typography>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <Typography variant="caption" color="text.secondary">
                        {t("debug.healthScore", "Health Score")}
                      </Typography>
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <LinearProgress
                          variant="determinate"
                          value={connectionHealth.isHealthy ? 100 : 50}
                          sx={{ flex: 1, height: 6, borderRadius: 3 }}
                          color={
                            connectionHealth.isHealthy ? "success" : "warning"
                          }
                        />
                        <Typography variant="body2" color="text.secondary">
                          {connectionHealth.isHealthy ? "100%" : "50%"}
                        </Typography>
                      </Box>
                    </Grid>
                  </>
                )}
              </Grid>
            )}
          </CardContent>
        </Card>

        {/* Subscription Statistics */}
        <Card elevation={1}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <SubscriptionIcon color="primary" />
              <Typography variant="h6" component="div">
                {t("debug.subscriptions", "Subscriptions")}
              </Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.totalActive", "Total Active")}
                </Typography>
                <Typography variant="h6" color="primary">
                  {subscriptionStats.totalActiveSubscriptions}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.unique", "Unique")}
                </Typography>
                <Typography variant="h6" color="success.main">
                  {subscriptionStats.uniqueDataSubscriptions}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.duplicates", "Duplicates")}
                </Typography>
                <Typography variant="h6" color="warning.main">
                  {subscriptionStats.duplicateSubscriptions}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.avgReferenceCount", "Avg Reference Count")}
                </Typography>
                <Typography variant="h6" color="text.primary">
                  {subscriptionHealthMetrics.avgReferenceCount.toFixed(1)}
                </Typography>
              </Grid>
              <Grid size={{ xs: 6 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.efficiency", "Efficiency")}
                </Typography>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <LinearProgress
                    variant="determinate"
                    value={
                      subscriptionStats.totalActiveSubscriptions > 0
                        ? (subscriptionStats.uniqueDataSubscriptions /
                            subscriptionStats.totalActiveSubscriptions) *
                          100
                        : 0
                    }
                    sx={{ flex: 1, height: 6, borderRadius: 3 }}
                    color="success"
                  />
                  <Typography variant="body2" color="text.secondary">
                    {subscriptionStats.totalActiveSubscriptions > 0
                      ? Math.round(
                          (subscriptionStats.uniqueDataSubscriptions /
                            subscriptionStats.totalActiveSubscriptions) *
                            100
                        )
                      : 0}
                    %
                  </Typography>
                </Box>
              </Grid>
            </Grid>

            <Divider sx={{ my: 2 }} />

            <Stack
              direction="row"
              spacing={1}
              flexWrap="wrap"
              useFlexGap
              sx={{
                "& .MuiChip-root": {
                  height: 22,
                  fontSize: "0.7rem",
                },
              }}
            >
              <Chip
                label={`${subscriptionHealthMetrics.healthySubscriptions} ${t(
                  "debug.healthy",
                  "Healthy"
                )}`}
                color="success"
                variant="outlined"
              />
              <Chip
                label={`${subscriptionHealthMetrics.duplicateCount} ${t(
                  "debug.duplicates",
                  "Duplicates"
                )}`}
                color="warning"
                variant="outlined"
              />
              <Chip
                label={`${subscriptionHealthMetrics.errorCount} ${t(
                  "debug.errors",
                  "Errors"
                )}`}
                color={
                  (subscriptionHealthMetrics.errorCount > 0
                    ? "error"
                    : "default") as ChipProps["color"]
                }
                variant="outlined"
              />
              <Chip
                label={`${subscriptionHealthMetrics.totalActive} ${t(
                  "debug.totalActive",
                  "Total"
                )}`}
                color="primary"
                variant="outlined"
              />
            </Stack>
          </CardContent>
        </Card>

        {/* Event Statistics */}
        <Card elevation={1}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <MetricsIcon color="secondary" />
              <Typography variant="h6" component="div">
                {t("debug.events", "Events")}
              </Typography>
            </Box>

            <Grid container spacing={2}>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.total", "Total")}
                </Typography>
                <Typography variant="h6" color="primary">
                  {eventStats.total}
                </Typography>
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.recent", "Recent (5m)")}
                </Typography>
                <Typography variant="h6" color="info.main">
                  {eventStats.recent}
                </Typography>
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Typography variant="caption" color="text.secondary">
                  {t("debug.errorRate", "Error Rate")}
                </Typography>
                <Typography
                  variant="h6"
                  color={eventStats.errorRate > 0.1 ? "error" : "success.main"}
                >
                  {Math.round(eventStats.errorRate * 100)}%
                </Typography>
              </Grid>
            </Grid>

            {Object.keys(eventStats.eventCounts).length > 0 && (
              <Accordion sx={{ mt: 2 }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <Typography variant="subtitle2">
                    {t("debug.eventBreakdown", "Event Type Breakdown")}
                  </Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <List dense>
                    {Object.entries(eventStats.eventCounts)
                      .sort(([, a], [, b]) => b - a)
                      .map(([type, count]) => (
                        <ListItem key={type} sx={{ py: 0.5 }}>
                          <ListItemIcon sx={{ minWidth: 36 }}>
                            {eventStats.errorCounts[type] ? (
                              <ErrorIcon color="error" fontSize="small" />
                            ) : (
                              <HealthyIcon color="success" fontSize="small" />
                            )}
                          </ListItemIcon>
                          <ListItemText
                            primary={type.replace("_", " ")}
                            secondary={`${count} events${
                              eventStats.errorCounts[type]
                                ? ` (${eventStats.errorCounts[type]} errors)`
                                : ""
                            }`}
                            primaryTypographyProps={{ variant: "body2" }}
                            secondaryTypographyProps={{ variant: "caption" }}
                          />
                          <Typography variant="body2" color="text.secondary">
                            {count}
                          </Typography>
                        </ListItem>
                      ))}
                  </List>
                </AccordionDetails>
              </Accordion>
            )}
          </CardContent>
        </Card>

        {/* Active Subscriptions Details */}
        {activeSubscriptions.length > 0 && (
          <Card elevation={1}>
            <CardContent>
              <Typography variant="h6" component="div" sx={{ mb: 2 }}>
                {t("debug.activeSubscriptions", "Active Subscriptions")}
              </Typography>

              <List dense>
                {activeSubscriptions.map((sub, index) => (
                  <React.Fragment key={sub.subscriptionKey}>
                    <ListItem sx={{ px: 0 }}>
                      <ListItemText
                        primary={
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 1,
                            }}
                          >
                            <Typography
                              variant="body2"
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.8rem",
                                fontWeight: 500,
                              }}
                            >
                              {sub.subscriptionKey}
                            </Typography>
                            <Chip
                              label={`×${sub.referenceCount}`}
                              size="small"
                              variant="outlined"
                              sx={{ height: 20, fontSize: "0.7rem" }}
                            />
                            {sub.config.subscriptionType && (
                              <Chip
                                label={sub.config.subscriptionType}
                                size="small"
                                variant="outlined"
                                color={
                                  (sub.config.subscriptionType ===
                                  "initiative-specific"
                                    ? "primary"
                                    : sub.config.subscriptionType ===
                                      "project-specific"
                                    ? "success"
                                    : "default") as Extract<
                                    ChipProps["color"],
                                    "default" | "primary" | "success"
                                  >
                                }
                                sx={{ height: 20, fontSize: "0.7rem" }}
                              />
                            )}
                          </Box>
                        }
                        secondary={
                          <Box sx={{ mt: 0.5 }}>
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              WS ID: {sub.webSocketSubscriptionId}
                            </Typography>
                            <Box
                              sx={{
                                display: "flex",
                                gap: 1,
                                mt: 0.5,
                                flexWrap: "wrap",
                              }}
                            >
                              {sub.config.projectIds &&
                                sub.config.projectIds.length > 0 && (
                                  <Chip
                                    label={`${sub.config.projectIds.length} projects`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 18, fontSize: "0.65rem" }}
                                  />
                                )}
                              {sub.config.conversationIds &&
                                sub.config.conversationIds.length > 0 && (
                                  <Chip
                                    label={`${sub.config.conversationIds.length} conversations`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 18, fontSize: "0.65rem" }}
                                  />
                                )}
                              {sub.config.initiativeIds &&
                                sub.config.initiativeIds.length > 0 && (
                                  <Chip
                                    label={`${sub.config.initiativeIds.length} initiatives`}
                                    size="small"
                                    variant="outlined"
                                    sx={{ height: 18, fontSize: "0.65rem" }}
                                  />
                                )}
                              <Chip
                                label={`${sub.config.eventCount} handlers`}
                                size="small"
                                variant="outlined"
                                sx={{ height: 18, fontSize: "0.65rem" }}
                              />
                            </Box>
                          </Box>
                        }
                      />
                    </ListItem>
                    {index < activeSubscriptions.length - 1 && <Divider />}
                  </React.Fragment>
                ))}
              </List>
            </CardContent>
          </Card>
        )}

        {/* Performance Metrics */}
        <Card elevation={1}>
          <CardContent>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
              <SpeedIcon color="info" />
              <Typography variant="h6" component="div">
                {t("debug.performance", "Performance")}
              </Typography>
            </Box>

            <Typography variant="body2" color="text.secondary">
              {t(
                "debug.performanceNote",
                "Performance metrics will be available in future versions."
              )}
            </Typography>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
};

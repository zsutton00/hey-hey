/**
 * WebSocket Stats Tab Component
 * Displays WebSocket connection statistics and subscription information
 */

import React from "react";
import {
  Box,
  Typography,
  Grid,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  LinearProgress,
  IconButton,
  Collapse,
  Card,
  CardContent,
} from "@mui/material";
import ConnectedIcon from "@mui/icons-material/WifiOutlined";
import DisconnectedIcon from "@mui/icons-material/WifiOffOutlined";
import ErrorIcon from "@mui/icons-material/ErrorOutline";
import SuccessIcon from "@mui/icons-material/CheckCircleOutline";
import WarningIcon from "@mui/icons-material/WarningAmberOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { useTranslation } from "react-i18next";
import type { WebSocketStatsTabProps } from "../types/debugTypes";
import type { CollectionDebugState } from "../../../data/websockets/debug";

export const WebSocketStatsTab: React.FC<WebSocketStatsTabProps> = ({
  connectionState,
  statistics,
  collections,
  subscriptionStats,
  activeSubscriptions,
  onRefreshStats,
}) => {
  const { t } = useTranslation();
  const [expandedSections, setExpandedSections] = React.useState<
    Record<string, boolean>
  >({
    connection: true,
    subscriptions: true,
    performance: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  };

  const getCollectionHealthStatus = (
    collection: CollectionDebugState
  ): "healthy" | "warning" | "error" => {
    if (collection.errors.length > 0) {
      return "error";
    }
    if (
      collection.staleQueries.length > 0 ||
      collection.loadingQueries.length > 0
    ) {
      return "warning";
    }
    return "healthy";
  };

  const getCollectionHealthIcon = (collection: CollectionDebugState) => {
    const status = getCollectionHealthStatus(collection);
    if (status === "error") {
      return <ErrorIcon color="error" fontSize="small" />;
    }
    if (status === "warning") {
      return <WarningIcon color="warning" fontSize="small" />;
    }
    return <SuccessIcon color="success" fontSize="small" />;
  };

  const getConnectionStatusIcon = () => {
    if (!connectionState.isConnected) {
      return <DisconnectedIcon color="error" />;
    }
    if (!connectionState.isAuthenticated) {
      return <ErrorIcon color="warning" />;
    }
    return <ConnectedIcon color="success" />;
  };

  const getConnectionStatusText = () => {
    if (!connectionState.isConnected) {
      return t("debug.disconnected", "Disconnected");
    }
    if (!connectionState.isAuthenticated) {
      return t("debug.unauthenticated", "Unauthenticated");
    }
    return t("debug.connected", "Connected");
  };

  const getConnectionStatusColor = (): "success" | "error" | "warning" => {
    if (!connectionState.isConnected) return "error";
    if (!connectionState.isAuthenticated) return "warning";
    return "success";
  };

  return (
    <Box sx={{ height: "100%", overflow: "auto", p: 2 }}>
      {/* Header with Refresh */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "between",
          alignItems: "center",
          mb: 2,
        }}
      >
        <Typography variant="h6" sx={{ fontSize: "1.1rem" }}>
          {t("debug.websocketStats", "WebSocket Statistics")}
        </Typography>
        {onRefreshStats && (
          <IconButton
            size="small"
            onClick={onRefreshStats}
            title={t("debug.refresh", "Refresh")}
          >
            <RefreshIcon />
          </IconButton>
        )}
      </Box>

      {/* Connection Status */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
            }}
            onClick={() => toggleSection("connection")}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {getConnectionStatusIcon()}
              <Typography variant="subtitle2">
                {t("debug.connectionStatus", "Connection Status")}
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip
                label={getConnectionStatusText()}
                size="small"
                color={getConnectionStatusColor()}
              />
              {expandedSections.connection ? (
                <ExpandLessIcon />
              ) : (
                <ExpandMoreIcon />
              )}
            </Box>
          </Box>

          <Collapse in={expandedSections.connection}>
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.connectionUptime", "Uptime")}
                  </Typography>
                  <Typography variant="body2">
                    {formatDuration(statistics.connectionUptime)}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.reconnectionAttempts", "Reconnection Attempts")}
                  </Typography>
                  <Typography variant="body2">
                    {connectionState.reconnectionAttempts}
                  </Typography>
                </Grid>
                {connectionState.connectionError && (
                  <Grid size={{ xs: 12 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t("debug.lastError", "Last Error")}
                    </Typography>
                    <Typography variant="body2" color="error">
                      {connectionState.connectionError}
                    </Typography>
                  </Grid>
                )}
                {connectionState.lastConnectionAttempt && (
                  <Grid size={{ xs: 12 }}>
                    <Typography variant="caption" color="text.secondary">
                      {t("debug.lastAttempt", "Last Connection Attempt")}
                    </Typography>
                    <Typography variant="body2">
                      {new Date(
                        connectionState.lastConnectionAttempt
                      ).toLocaleString()}
                    </Typography>
                  </Grid>
                )}
              </Grid>
            </Box>
          </Collapse>
        </CardContent>
      </Card>

      {/* Subscription Statistics */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
            }}
            onClick={() => toggleSection("subscriptions")}
          >
            <Typography variant="subtitle2">
              {t("debug.subscriptions", "Subscriptions")}
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Chip
                label={`${subscriptionStats.totalActiveSubscriptions} active`}
                size="small"
                color={
                  subscriptionStats.totalActiveSubscriptions > 0
                    ? "success"
                    : "default"
                }
              />
              {expandedSections.subscriptions ? (
                <ExpandLessIcon />
              ) : (
                <ExpandMoreIcon />
              )}
            </Box>
          </Box>

          <Collapse in={expandedSections.subscriptions}>
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.totalActive", "Total Active")}
                  </Typography>
                  <Typography variant="h6">
                    {subscriptionStats.totalActiveSubscriptions}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.unique", "Unique")}
                  </Typography>
                  <Typography variant="h6">
                    {subscriptionStats.uniqueDataSubscriptions}
                  </Typography>
                </Grid>
                {subscriptionStats.duplicateSubscriptions > 0 && (
                  <Grid size={{ xs: 12 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <ErrorIcon color="warning" fontSize="small" />
                      <Typography variant="body2" color="warning.main">
                        {subscriptionStats.duplicateSubscriptions} duplicate
                        subscriptions detected
                      </Typography>
                    </Box>
                  </Grid>
                )}
              </Grid>

              {/* Active Subscriptions List */}
              {activeSubscriptions.length > 0 && (
                <Box>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    gutterBottom
                  >
                    {t("debug.activeSubscriptions", "Active Subscriptions")}:
                  </Typography>
                  <List dense>
                    {activeSubscriptions.slice(0, 5).map((sub) => (
                      <ListItem key={sub.subscriptionKey} sx={{ py: 0.5 }}>
                        <ListItemIcon sx={{ minWidth: 24 }}>
                          <SuccessIcon color="success" fontSize="small" />
                        </ListItemIcon>
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
                                  fontSize: "0.75rem",
                                }}
                              >
                                {sub.subscriptionKey}
                              </Typography>
                              <Chip
                                label={sub.config.subscriptionType}
                                size="small"
                                variant="outlined"
                                sx={{ fontSize: "0.65rem", height: 18 }}
                              />
                            </Box>
                          }
                          secondary={
                            <Typography
                              variant="caption"
                              color="text.secondary"
                            >
                              Refs: {sub.referenceCount} | Events:{" "}
                              {sub.config.eventCount}
                            </Typography>
                          }
                        />
                      </ListItem>
                    ))}
                    {activeSubscriptions.length > 5 && (
                      <ListItem>
                        <ListItemText>
                          <Typography variant="caption" color="text.secondary">
                            ... and {activeSubscriptions.length - 5} more
                          </Typography>
                        </ListItemText>
                      </ListItem>
                    )}
                  </List>
                </Box>
              )}
            </Box>
          </Collapse>
        </CardContent>
      </Card>

      {/* Performance Statistics */}
      <Card sx={{ mb: 2 }}>
        <CardContent sx={{ p: 2 }}>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              cursor: "pointer",
            }}
            onClick={() => toggleSection("performance")}
          >
            <Typography variant="subtitle2">
              {t("debug.performance", "Performance")}
            </Typography>
            {expandedSections.performance ? (
              <ExpandLessIcon />
            ) : (
              <ExpandMoreIcon />
            )}
          </Box>

          <Collapse in={expandedSections.performance}>
            <Box sx={{ mt: 2 }}>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.totalEvents", "Total Events")}
                  </Typography>
                  <Typography variant="h6">
                    {statistics.totalEvents.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.eventsLastHour", "Events (Last Hour)")}
                  </Typography>
                  <Typography variant="h6">
                    {statistics.eventsInLastHour.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.errorsLastHour", "Errors (Last Hour)")}
                  </Typography>
                  <Typography
                    variant="h6"
                    color={
                      statistics.errorsInLastHour > 0 ? "error" : "inherit"
                    }
                  >
                    {statistics.errorsInLastHour.toLocaleString()}
                  </Typography>
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.avgProcessingTime", "Avg Processing Time")}
                  </Typography>
                  <Typography variant="h6">
                    {statistics.avgEventProcessingTime.toFixed(2)}ms
                  </Typography>
                </Grid>
                <Grid size={{ xs: 12 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t("debug.memoryUsage", "Memory Usage")}
                  </Typography>
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mt: 0.5,
                    }}
                  >
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(
                        (statistics.memoryUsage / (50 * 1024 * 1024)) * 100,
                        100
                      )} // Assume 50MB limit
                      sx={{ flex: 1 }}
                      color={
                        statistics.memoryUsage > 25 * 1024 * 1024
                          ? "warning"
                          : "primary"
                      }
                    />
                    <Typography variant="body2">
                      {formatBytes(statistics.memoryUsage)}
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            </Box>
          </Collapse>
        </CardContent>
      </Card>

      {/* Collections Health */}
      {collections.length > 0 && (
        <Card>
          <CardContent sx={{ p: 2 }}>
            <Typography variant="subtitle2" gutterBottom>
              {t("debug.collectionsHealth", "Collections Health")}
            </Typography>
            <List dense>
              {collections.map((collection) => {
                const healthStatus = getCollectionHealthStatus(collection);
                const subscriptionCount =
                  collection.activeQueries.listQueries +
                  collection.activeQueries.singleQueries;
                const lastActivity = collection.lastActivity
                  ? new Date(collection.lastActivity).toLocaleTimeString()
                  : t("debug.never", "Never");

                return (
                  <ListItem key={collection.name} sx={{ py: 0.5 }}>
                    <ListItemIcon sx={{ minWidth: 24 }}>
                      {getCollectionHealthIcon(collection)}
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 1 }}
                        >
                          <Typography variant="body2">
                            {collection.name}
                          </Typography>
                          <Chip
                            label={healthStatus}
                            size="small"
                            color={
                              healthStatus === "healthy"
                                ? "success"
                                : healthStatus === "error"
                                ? "error"
                                : "warning"
                            }
                            sx={{ fontSize: "0.65rem", height: 18 }}
                          />
                          {collection.staleQueries.length > 0 && (
                            <Chip
                              label={`${collection.staleQueries.length} stale`}
                              size="small"
                              variant="outlined"
                              color="warning"
                              sx={{ fontSize: "0.6rem", height: 18 }}
                            />
                          )}
                          {collection.errors.length > 0 && (
                            <Chip
                              label={`${collection.errors.length} errors`}
                              size="small"
                              variant="outlined"
                              color="error"
                              sx={{ fontSize: "0.6rem", height: 18 }}
                            />
                          )}
                        </Box>
                      }
                      secondary={
                        <Typography variant="caption" color="text.secondary">
                          {t("debug.subscriptions", "Subscriptions")}:{" "}
                          {subscriptionCount} |
                          {` ${t(
                            "debug.lastActivity",
                            "Last Activity"
                          )}: ${lastActivity}`}
                        </Typography>
                      }
                    />
                  </ListItem>
                );
              })}
            </List>
          </CardContent>
        </Card>
      )}
    </Box>
  );
};

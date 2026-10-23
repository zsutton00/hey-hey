/**
 * Advanced Debug Panel Component
 * Showcases Phase 4 enhancements with real-time analytics and advanced filtering
 */

import React, { useState, useMemo } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Grid,
  Chip,
  LinearProgress,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Switch,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Divider,
} from "@mui/material";
import TimelineIcon from "@mui/icons-material/Timeline";
import PerformanceIcon from "@mui/icons-material/Speed";
import NetworkIcon from "@mui/icons-material/NetworkCheck";
import BugIcon from "@mui/icons-material/BugReport";
import RefreshIcon from "@mui/icons-material/Refresh";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import WarningIcon from "@mui/icons-material/Warning";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ErrorIcon from "@mui/icons-material/Error";
import { useTranslation } from "react-i18next";
import type { ChipProps } from "@mui/material";
import { useDebugContext } from "../../contexts/DebugContext";
import type { EnhancedWebSocketEventFilter } from "../../data/websockets/debug";

export const AdvancedDebugPanel: React.FC = () => {
  const { t } = useTranslation();
  const {
    webSocketEvents,
    webSocketStats,
    webSocketConnectionState,
    isWebSocketHealthy,
    lastEventTimestamp,
    filteredWebSocketEvents,
  } = useDebugContext();

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filter, setFilter] = useState<EnhancedWebSocketEventFilter>({});

  // Real-time analytics
  const analytics = useMemo(() => {
    const events = webSocketEvents;
    const now = Date.now();
    const lastMinute = now - 60 * 1000;
    const lastHour = now - 60 * 60 * 1000;

    const recentEvents = events.filter(
      (e) => new Date(e.timestamp).getTime() > lastMinute
    );
    const hourlyEvents = events.filter(
      (e) => new Date(e.timestamp).getTime() > lastHour
    );

    const errorEvents = events.filter((e) => e.metadata?.success === false);
    const performanceEvents = events.filter((e) => e.metadata?.duration);

    const avgPerformance =
      performanceEvents.length > 0
        ? performanceEvents.reduce(
            (sum, e) => sum + (e.metadata?.duration || 0),
            0
          ) / performanceEvents.length
        : 0;

    return {
      eventsPerMinute: recentEvents.length,
      eventsPerHour: hourlyEvents.length,
      errorRate:
        events.length > 0 ? (errorEvents.length / events.length) * 100 : 0,
      averagePerformance: avgPerformance,
      connectionUptime: webSocketConnectionState.isConnected ? "100%" : "0%",
      activeSubscriptions: webSocketStats.totalEvents || 0,
    };
  }, [webSocketEvents, webSocketStats, webSocketConnectionState]);

  // Performance health indicator
  const getHealthStatus = () => {
    if (!isWebSocketHealthy) {
      return {
        status: "error",
        label: "Unhealthy",
        icon: <ErrorIcon />,
      } as const;
    }
    if (analytics.errorRate > 10) {
      return {
        status: "warning",
        label: "Degraded",
        icon: <WarningIcon />,
      } as const;
    }
    if (analytics.averagePerformance > 100) {
      return {
        status: "warning",
        label: "Slow",
        icon: <WarningIcon />,
      } as const;
    }
    return {
      status: "success",
      label: "Healthy",
      icon: <CheckCircleIcon />,
    } as const;
  };

  const healthStatus = getHealthStatus();

  // Event categorization for visualization
  const eventCategories = useMemo(() => {
    const categories = new Map<string, number>();
    webSocketEvents.forEach((event) => {
      const category = event.type.includes("websocket")
        ? "Connection"
        : event.type.includes("subscription")
        ? "Subscription"
        : event.type.includes("message")
        ? "Message"
        : "Other";
      categories.set(category, (categories.get(category) || 0) + 1);
    });
    return Array.from(categories.entries()).map(([name, count]) => ({
      name,
      count,
    }));
  }, [webSocketEvents]);

  return (
    <Box sx={{ p: 3 }}>
      <Typography
        variant="h5"
        gutterBottom
        sx={{ display: "flex", alignItems: "center", gap: 1 }}
      >
        <BugIcon />
        {t("debug.advancedPanel", "Advanced Debug Analytics")}
        <Chip
          label={healthStatus.label}
          color={
            healthStatus.status as Extract<
              ChipProps["color"],
              "error" | "warning" | "success"
            >
          }
          icon={healthStatus.icon}
          size="small"
        />
      </Typography>

      {/* Real-time Metrics Dashboard */}
      <Grid container spacing={3} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
              >
                <PerformanceIcon color="primary" />
                <Typography variant="h6">Performance</Typography>
              </Box>
              <Typography variant="h3" color="primary">
                {analytics.averagePerformance.toFixed(1)}ms
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Average processing time
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(
                  (analytics.averagePerformance / 100) * 100,
                  100
                )}
                sx={{ mt: 1 }}
                color={
                  analytics.averagePerformance < 50
                    ? "success"
                    : analytics.averagePerformance < 100
                    ? "warning"
                    : "error"
                }
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
              >
                <NetworkIcon color="info" />
                <Typography variant="h6">Activity</Typography>
              </Box>
              <Typography variant="h3" color="info.main">
                {analytics.eventsPerMinute}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Events per minute
              </Typography>
              <Typography variant="caption" display="block" sx={{ mt: 1 }}>
                {analytics.eventsPerHour} events/hour
              </Typography>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card>
            <CardContent>
              <Box
                sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}
              >
                <TrendingUpIcon
                  color={analytics.errorRate < 5 ? "success" : "error"}
                />
                <Typography variant="h6">Error Rate</Typography>
              </Box>
              <Typography
                variant="h3"
                color={analytics.errorRate < 5 ? "success.main" : "error.main"}
              >
                {analytics.errorRate.toFixed(1)}%
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Error percentage
              </Typography>
              <LinearProgress
                variant="determinate"
                value={Math.min(analytics.errorRate, 100)}
                sx={{ mt: 1 }}
                color={
                  analytics.errorRate < 5
                    ? "success"
                    : analytics.errorRate < 15
                    ? "warning"
                    : "error"
                }
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Advanced Filtering Controls */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 2,
            }}
          >
            <Typography variant="h6">Advanced Event Filtering</Typography>
            <FormControlLabel
              control={
                <Switch
                  checked={showAdvancedFilters}
                  onChange={(e) => setShowAdvancedFilters(e.target.checked)}
                />
              }
              label="Show Advanced Options"
            />
          </Box>

          {showAdvancedFilters && (
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, md: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Performance Threshold</InputLabel>
                  <Select
                    value={filter.performanceThreshold || ""}
                    label="Performance Threshold"
                    onChange={(e) =>
                      setFilter({
                        ...filter,
                        performanceThreshold: e.target.value as number,
                      })
                    }
                  >
                    <MenuItem value="">All Events</MenuItem>
                    <MenuItem value={10}>Slow (&gt;10ms)</MenuItem>
                    <MenuItem value={50}>Very Slow (&gt;50ms)</MenuItem>
                    <MenuItem value={100}>Extremely Slow (&gt;100ms)</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Error Category</InputLabel>
                  <Select
                    value={filter.errorCategory || ""}
                    label="Error Category"
                    onChange={(e) =>
                      setFilter({
                        ...filter,
                        errorCategory: e.target.value as string,
                      })
                    }
                  >
                    <MenuItem value="">All Categories</MenuItem>
                    <MenuItem value="connection">Connection</MenuItem>
                    <MenuItem value="subscription">Subscription</MenuItem>
                    <MenuItem value="message_processing">
                      Message Processing
                    </MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Room Type</InputLabel>
                  <Select
                    value={filter.roomType || ""}
                    label="Room Type"
                    onChange={(e) =>
                      setFilter({
                        ...filter,
                        roomType: (e.target.value ||
                          undefined) as EnhancedWebSocketEventFilter["roomType"],
                      })
                    }
                  >
                    <MenuItem value="">All Rooms</MenuItem>
                    <MenuItem value="project">Project</MenuItem>
                    <MenuItem value="conversation">Conversation</MenuItem>
                    <MenuItem value="initiative">Initiative</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, md: 3 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Tooltip title="Apply filters">
                    <IconButton
                      color="primary"
                      onClick={() => {
                        // Trigger filter update - the filteredWebSocketEvents function will be used
                        console.log("Applied filters:", filter);
                      }}
                    >
                      <RefreshIcon />
                    </IconButton>
                  </Tooltip>
                  <Typography variant="body2" color="text.secondary">
                    {filteredWebSocketEvents(filter).length} events
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          )}
        </CardContent>
      </Card>

      {/* Event Category Breakdown */}
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Event Distribution
          </Typography>
          <List dense>
            {eventCategories.map(({ name, count }) => (
              <React.Fragment key={name}>
                <ListItem>
                  <ListItemIcon>
                    <TimelineIcon />
                  </ListItemIcon>
                  <ListItemText primary={name} secondary={`${count} events`} />
                  <Chip
                    label={count}
                    size="small"
                    color={
                      count > 50 ? "warning" : count > 10 ? "info" : "default"
                    }
                  />
                </ListItem>
                <Divider />
              </React.Fragment>
            ))}
          </List>

          {lastEventTimestamp && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ mt: 2, display: "block" }}
            >
              Last event: {new Date(lastEventTimestamp).toLocaleString()}
            </Typography>
          )}
        </CardContent>
      </Card>
    </Box>
  );
};

/**
 * WebSocket Events Tab Component
 * Displays real-time WebSocket event monitoring
 */

import React from "react";
import {
  Box,
  Typography,
  TextField,
  FormControlLabel,
  Switch,
  IconButton,
  Chip,
  List,
  ListItem,
  Divider,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Tooltip,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import ExportIcon from "@mui/icons-material/GetApp";
import SearchIcon from "@mui/icons-material/Search";
import FilterIcon from "@mui/icons-material/FilterList";
import ErrorIcon from "@mui/icons-material/Error";
import SuccessIcon from "@mui/icons-material/CheckCircle";
import WarningIcon from "@mui/icons-material/Warning";
import { useTranslation } from "react-i18next";
import type { WebSocketEventsTabProps } from "../types/debugTypes";

export const WebSocketEventsTab: React.FC<WebSocketEventsTabProps> = ({
  events,
  filter,
  onFilterChange,
  onClearEvents,
  onExportEvents,
  showTimestamps,
  maxHeight = "100%",
}) => {
  const { t } = useTranslation();

  // Local state for filter selections
  const [selectedCategory, setSelectedCategory] = React.useState<string>("");
  const [selectedRoomType, setSelectedRoomType] = React.useState<string>("");

  // Helper function to categorize events - defined before usage
  const getEventCategory = React.useCallback(
    (event: (typeof events)[0]): string => {
      if (
        typeof event.data === "object" &&
        event.data &&
        "event" in event.data
      ) {
        const eventName = (event.data as { event: string }).event;
        if (
          [
            "connected",
            "disconnected",
            "connection_attempt",
            "connection_failed",
          ].includes(eventName)
        ) {
          return "Connection";
        }
        if (
          ["auth_attempt", "auth_success", "auth_failed"].includes(eventName)
        ) {
          return "Authentication";
        }
        if (eventName.includes("message")) {
          return "Message";
        }
        if (eventName.includes("room")) {
          return "Room Management";
        }
        if (eventName === "performance_snapshot") {
          return "Performance";
        }
        if (eventName === "error") {
          return "Error";
        }
      }
      if (event.type.includes("subscription")) {
        return "Subscription";
      }
      return "Other";
    },
    []
  );

  // Filter events based on current filter
  const filteredEvents = React.useMemo(() => {
    let filtered = [...events].sort((a, b) => {
      if (a.timestamp > b.timestamp) {
        return -1;
      }
      if (a.timestamp < b.timestamp) {
        return 1;
      }
      return a.id! > b.id! ? 1 : -1;
    });

    // Filter by type
    if (filter.type) {
      filtered = filtered.filter((event) => event.type === filter.type);
    }

    // Filter by source
    if (filter.source) {
      filtered = filtered.filter((event) => event.source === filter.source);
    }

    // Filter by search text
    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      filtered = filtered.filter(
        (event) =>
          event.type.toLowerCase().includes(searchLower) ||
          event.source.toLowerCase().includes(searchLower) ||
          JSON.stringify(event.data).toLowerCase().includes(searchLower)
      );
    }

    // Filter errors only
    if (filter.showErrorsOnly) {
      filtered = filtered.filter(
        (event) =>
          event.metadata?.success === false ||
          JSON.stringify(event.data).includes("error") ||
          JSON.stringify(event.data).includes("Error")
      );
    }

    // Filter by selected category
    if (selectedCategory) {
      filtered = filtered.filter((event) => {
        const category = getEventCategory(event);
        return category === selectedCategory;
      });
    }

    // Filter by selected room type
    if (selectedRoomType) {
      filtered = filtered.filter((event) => {
        const data = event.data as { roomType?: string };
        if (typeof data === "object" && data && data.roomType) {
          return data.roomType === selectedRoomType;
        }
        return false;
      });
    }

    // Filter by time range
    if (filter.timeRange) {
      filtered = filtered.filter((event) => {
        const eventTime = new Date(event.timestamp);
        const { start, end } = filter.timeRange ?? {};

        if (start && eventTime < start) {
          return false;
        }

        if (end && eventTime > end) {
          return false;
        }

        return true;
      });
    }

    return filtered;
  }, [events, filter, selectedCategory, selectedRoomType, getEventCategory]);

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({
      ...filter,
      search: event.target.value || undefined,
    });
  };

  const handleErrorFilterToggle = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    onFilterChange({
      ...filter,
      showErrorsOnly: event.target.checked || undefined,
    });
  };

  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getEventColor = (event: (typeof events)[0]): string => {
    if (event.metadata?.success === false) return "error";
    if (event.type.includes("error")) return "error";
    if (event.type.includes("subscription")) return "primary";
    if (event.type.includes("websocket")) return "info";
    return "default";
  };

  const getPerformanceIndicator = (event: (typeof events)[0]) => {
    const duration = event.metadata?.duration;
    if (!duration) return null;

    const isSlowEvent = duration > 100;
    const isVerySlowEvent = duration > 500;

    return {
      color: isVerySlowEvent ? "error" : isSlowEvent ? "warning" : "success",
      icon: isVerySlowEvent ? (
        <ErrorIcon />
      ) : isSlowEvent ? (
        <WarningIcon />
      ) : (
        <SuccessIcon />
      ),
      tooltip: `Processing time: ${duration.toFixed(1)}ms ${
        isVerySlowEvent ? "(Very Slow)" : isSlowEvent ? "(Slow)" : "(Fast)"
      }`,
    };
  };

  const getString = (value: unknown): string | undefined =>
    typeof value === "string" ? value : undefined;

  const getNumber = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;

  return (
    <Box sx={{ height: maxHeight, display: "flex", flexDirection: "column" }}>
      {/* Filter Controls */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        {/* Search and Filter */}
        <Box sx={{ display: "flex", gap: 1, mb: 2 }}>
          <TextField
            size="small"
            placeholder={t("debug.searchEvents", "Search events...")}
            value={filter.search || ""}
            onChange={handleSearchChange}
            InputProps={{
              startAdornment: <SearchIcon fontSize="small" />,
            }}
            sx={{ flex: 1 }}
          />
          <IconButton
            size="small"
            onClick={onClearEvents}
            disabled={events.length === 0}
            title={t("debug.clearEvents", "Clear all events")}
          >
            <ClearIcon />
          </IconButton>
          <IconButton
            size="small"
            onClick={onExportEvents}
            disabled={filteredEvents.length === 0}
            title={t("debug.exportEvents", "Export events")}
          >
            <ExportIcon />
          </IconButton>
        </Box>

        {/* Filter Controls Row */}
        <Box
          sx={{
            display: "flex",
            gap: 2,
            flexWrap: "wrap",
            alignItems: "center",
            mb: 2,
          }}
        >
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>Event Category</InputLabel>
            <Select
              value={selectedCategory}
              label="Event Category"
              MenuProps={{
                sx: {
                  zIndex: 10001,
                },
                PaperProps: {
                  sx: {
                    maxHeight: 200,
                  },
                },
                anchorOrigin: {
                  vertical: "bottom",
                  horizontal: "left",
                },
                transformOrigin: {
                  vertical: "top",
                  horizontal: "left",
                },
              }}
              onChange={(e) => {
                const value = e.target.value as string;
                setSelectedCategory(value);
                console.log("Selected event category:", value);
              }}
            >
              <MenuItem value="">All Categories</MenuItem>
              <MenuItem value="Connection">Connection</MenuItem>
              <MenuItem value="Authentication">Authentication</MenuItem>
              <MenuItem value="Message">Message</MenuItem>
              <MenuItem value="Subscription">Subscription</MenuItem>
              <MenuItem value="Room Management">Room Management</MenuItem>
              <MenuItem value="Performance">Performance</MenuItem>
              <MenuItem value="Error">Error</MenuItem>
              <MenuItem value="Other">Other</MenuItem>
            </Select>
          </FormControl>

          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Room Type</InputLabel>
            <Select
              value={selectedRoomType}
              label="Room Type"
              MenuProps={{
                sx: {
                  zIndex: 10001,
                },
                PaperProps: {
                  sx: {
                    maxHeight: 200,
                  },
                },
                anchorOrigin: {
                  vertical: "bottom",
                  horizontal: "left",
                },
                transformOrigin: {
                  vertical: "top",
                  horizontal: "left",
                },
              }}
              onChange={(e) => {
                const value = e.target.value as string;
                setSelectedRoomType(value);
                console.log("Selected room type:", value);
              }}
            >
              <MenuItem value="">All Rooms</MenuItem>
              <MenuItem value="project">Project</MenuItem>
              <MenuItem value="conversation">Conversation</MenuItem>
              <MenuItem value="initiative">Initiative</MenuItem>
            </Select>
          </FormControl>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={filter.showErrorsOnly || false}
                onChange={handleErrorFilterToggle}
              />
            }
            label={t("debug.errorsOnly", "Errors only")}
          />
        </Box>

        {/* Filter Summary */}
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Chip
            icon={<FilterIcon />}
            label={`${filteredEvents.length} / ${events.length}`}
            size="small"
            variant="outlined"
          />
          {filter.search && (
            <Chip
              label={`Search: "${filter.search}"`}
              size="small"
              color="info"
              variant="outlined"
            />
          )}
          {filter.showErrorsOnly && (
            <Chip
              label="Errors Only"
              size="small"
              color="error"
              variant="outlined"
            />
          )}
          {selectedCategory && (
            <Chip
              label={`Category: ${selectedCategory}`}
              size="small"
              color="primary"
              variant="outlined"
            />
          )}
          {selectedRoomType && (
            <Chip
              label={`Room: ${selectedRoomType}`}
              size="small"
              color="secondary"
              variant="outlined"
            />
          )}
        </Box>
      </Box>

      {/* Events List */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {filteredEvents.length === 0 ? (
          <Box sx={{ p: 2, textAlign: "center" }}>
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {events.length === 0
                ? t("debug.noEvents", "No WebSocket events recorded")
                : t("debug.noFilteredEvents", "No events match current filter")}
            </Typography>
          </Box>
        ) : (
          <List dense sx={{ p: 0 }}>
            {filteredEvents.map((event, index) => (
              <React.Fragment key={event.id || `event-${index}`}>
                <ListItem
                  sx={{
                    flexDirection: "column",
                    alignItems: "stretch",
                    py: 1,
                  }}
                >
                  {/* Event Header */}
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mb: 0.5,
                    }}
                  >
                    <Chip
                      label={event.type}
                      size="small"
                      color={
                        getEventColor(event) as
                          | "default"
                          | "primary"
                          | "secondary"
                          | "error"
                          | "info"
                          | "success"
                          | "warning"
                      }
                      sx={{ fontSize: "0.7rem" }}
                    />
                    <Chip
                      label={getEventCategory(event)}
                      size="small"
                      variant="outlined"
                      sx={{ fontSize: "0.65rem" }}
                    />

                    {/* Performance Indicator */}
                    {(() => {
                      const perfIndicator = getPerformanceIndicator(event);
                      return perfIndicator ? (
                        <Tooltip title={perfIndicator.tooltip}>
                          <Chip
                            icon={perfIndicator.icon}
                            label={`${event.metadata?.duration?.toFixed(1)}ms`}
                            size="small"
                            color={
                              perfIndicator.color as
                                | "default"
                                | "primary"
                                | "secondary"
                                | "error"
                                | "info"
                                | "success"
                                | "warning"
                            }
                            variant="outlined"
                            sx={{ fontSize: "0.65rem", height: 20 }}
                          />
                        </Tooltip>
                      ) : null;
                    })()}

                    <Typography
                      variant="caption"
                      sx={{ color: "text.secondary" }}
                    >
                      {event.source}
                    </Typography>
                    {showTimestamps && (
                      <Typography
                        variant="caption"
                        sx={{ color: "text.secondary", ml: "auto" }}
                      >
                        {formatTimestamp(event.timestamp)}
                      </Typography>
                    )}
                  </Box>

                  {/* Event Summary */}
                  <Box sx={{ mb: 1 }}>
                    {(() => {
                      const data = event.data as Record<string, unknown>;
                      if (typeof data === "object" && data) {
                        if (data.event === "connected") {
                          const serverUrl =
                            getString(data.serverUrl) ?? "unknown";
                          const socketId =
                            getString(data.socketId) ?? "unknown";
                          const connectionDuration = getNumber(
                            data.connectionDuration
                          );
                          return (
                            <Typography
                              variant="body2"
                              sx={{ color: "success.main" }}
                            >
                              ✓ Connected to {serverUrl} (Socket: {socketId})
                              {typeof connectionDuration === "number" &&
                                ` in ${connectionDuration}ms`}
                            </Typography>
                          );
                        }
                        if (data.event === "disconnected") {
                          const reason = getString(data.reason) ?? "unknown";
                          return (
                            <Typography
                              variant="body2"
                              sx={{ color: "warning.main" }}
                            >
                              ⚠ Disconnected - Reason: {reason}
                            </Typography>
                          );
                        }
                        if (data.event === "message_received") {
                          const eventType =
                            getString(data.eventType) ?? "message";
                          const dataSize = getNumber(data.dataSize);
                          const messageId = getString(data.messageId);
                          return (
                            <Typography variant="body2">
                              📨 {eventType} message
                              {typeof dataSize === "number" &&
                                ` (Size: ${dataSize} bytes)`}
                              {messageId && ` - ID: ${messageId}`}
                            </Typography>
                          );
                        }
                        if (data.event === "room_joined") {
                          const roomType = getString(data.roomType) ?? "room";
                          const roomId = getString(data.roomId) ?? "unknown";
                          return (
                            <Typography
                              variant="body2"
                              sx={{ color: "info.main" }}
                            >
                              🏠 Joined {roomType} room: {roomId}
                            </Typography>
                          );
                        }
                        if (data.event === "room_left") {
                          const roomType = getString(data.roomType) ?? "room";
                          const roomId = getString(data.roomId) ?? "unknown";
                          return (
                            <Typography
                              variant="body2"
                              sx={{ color: "text.secondary" }}
                            >
                              🚪 Left {roomType} room: {roomId}
                            </Typography>
                          );
                        }
                        if (data.event === "performance_snapshot") {
                          return (
                            <Typography
                              variant="body2"
                              sx={{ color: "primary.main" }}
                            >
                              📊 Performance:{" "}
                              {typeof data.avgMessageProcessing === "number"
                                ? data.avgMessageProcessing.toFixed(1)
                                : "0"}
                              ms avg,{" "}
                              {typeof data.activeSubscriptions === "number"
                                ? data.activeSubscriptions
                                : "0"}{" "}
                              subs,{" "}
                              {typeof data.connectionUptime === "number"
                                ? Math.floor(data.connectionUptime / 1000)
                                : "0"}
                              s uptime
                            </Typography>
                          );
                        }
                        if (data.category && data.message) {
                          const category =
                            getString(data.category) ?? "unknown";
                          const message = getString(data.message) ?? "";
                          return (
                            <Typography
                              variant="body2"
                              sx={{ color: "error.main" }}
                            >
                              ❌ {category}: {message}
                            </Typography>
                          );
                        }
                      }
                      return null;
                    })()}
                  </Box>

                  {/* Event Data Details */}
                  <Box
                    sx={{
                      mt: 1,
                      p: 1,
                      backgroundColor: "grey.50",
                      borderRadius: 1,
                      border: 1,
                      borderColor: "divider",
                    }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ mb: 1, display: "block" }}
                    >
                      Raw <code>{event.type}</code> event data:
                    </Typography>
                    <Typography
                      variant="body2"
                      component="pre"
                      sx={{
                        fontFamily: "monospace",
                        fontSize: "0.7rem",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        maxHeight: 150,
                        overflow: "auto",
                        margin: 0,
                      }}
                    >
                      {JSON.stringify(event.data, null, 2)}
                    </Typography>
                  </Box>

                  {/* Metadata */}
                  {event.metadata && (
                    <Box
                      sx={{
                        mt: 0.5,
                        display: "flex",
                        gap: 1,
                        flexWrap: "wrap",
                      }}
                    >
                      {event.metadata.success !== undefined && (
                        <Chip
                          label={event.metadata.success ? "Success" : "Failed"}
                          size="small"
                          color={event.metadata.success ? "success" : "error"}
                          variant="outlined"
                          sx={{ fontSize: "0.65rem", height: 20 }}
                        />
                      )}
                      {event.metadata.duration && (
                        <Chip
                          label={`${event.metadata.duration}ms`}
                          size="small"
                          variant="outlined"
                          sx={{ fontSize: "0.65rem", height: 20 }}
                        />
                      )}
                      {event.metadata.error && (
                        <Chip
                          label={String(event.metadata.error)}
                          size="small"
                          color="error"
                          variant="outlined"
                          sx={{ fontSize: "0.65rem", height: 20 }}
                        />
                      )}
                    </Box>
                  )}
                </ListItem>
                {index < filteredEvents.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        )}
      </Box>

      {/* Footer Stats */}
      <Box
        sx={{
          p: 1,
          borderTop: 1,
          borderColor: "divider",
          backgroundColor: "grey.50",
        }}
      >
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t(
            "debug.eventStats",
            "Total: {{total}}, Filtered: {{filtered}}, Errors: {{errors}}",
            {
              total: events.length,
              filtered: filteredEvents.length,
              errors: events.filter(
                (e) =>
                  e.metadata?.success === false ||
                  JSON.stringify(e.data).toLowerCase().includes("error")
              ).length,
            }
          )}
        </Typography>
      </Box>
    </Box>
  );
};

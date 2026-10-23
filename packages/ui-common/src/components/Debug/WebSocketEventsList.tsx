import React, { useState, useMemo } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  Collapse,
  IconButton,
  Chip,
  TextField,
  InputAdornment,
  FormControlLabel,
  Switch,
  Stack,
  Divider,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import SearchIcon from "@mui/icons-material/Search";
import ClearIcon from "@mui/icons-material/Clear";
import TimeIcon from "@mui/icons-material/AccessTime";
import { useTheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";
import type { WebSocketEventFilter } from "./debug.types";
import type { WebSocketEvent } from "../../data/websockets/debug";

interface WebSocketEventsListProps {
  events: WebSocketEvent[];
  filter: WebSocketEventFilter;
  onFilterChange: (filter: WebSocketEventFilter) => void;
  autoScroll?: boolean;
  showTimestamps?: boolean;
  maxHeight?: string | number;
}

export const WebSocketEventsList: React.FC<WebSocketEventsListProps> = ({
  events,
  filter,
  onFilterChange,
  autoScroll = true,
  showTimestamps = true,
  maxHeight = 400,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [searchValue, setSearchValue] = useState(filter.search || "");

  // Filter events based on current filter settings
  const filteredEvents = useMemo(() => {
    let result = [...events];

    if (filter.type) {
      result = result.filter((event) => event.type === filter.type);
    }

    if (filter.source) {
      result = result.filter((event) =>
        event.source.toLowerCase().includes(filter.source!.toLowerCase())
      );
    }

    if (filter.search) {
      const searchLower = filter.search.toLowerCase();
      result = result.filter(
        (event) =>
          JSON.stringify(event.data).toLowerCase().includes(searchLower) ||
          event.source.toLowerCase().includes(searchLower) ||
          event.type.toLowerCase().includes(searchLower)
      );
    }

    if (filter.showErrorsOnly) {
      result = result.filter(
        (event) =>
          event.metadata?.success === false ||
          JSON.stringify(event.data).includes("error") ||
          JSON.stringify(event.data).includes("Error")
      );
    }

    if (filter.timeRange) {
      result = result.filter((event) => {
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

    return result.reverse(); // Show newest first
  }, [events, filter]);

  const getEventTypeColor = (type: WebSocketEvent["type"]): string => {
    switch (type) {
      case "subscription_created":
        return theme.palette.success.main;
      case "subscription_removed":
        return theme.palette.warning.main;
      case "subscription_updated":
        return theme.palette.info.main;
      case "websocket_event":
        return theme.palette.primary.main;
      case "cache_update":
        return theme.palette.secondary.main;
      default:
        return theme.palette.grey[500];
    }
  };

  const formatTimestamp = (timestamp: string): string => {
    const date = new Date(timestamp);
    const options: Intl.DateTimeFormatOptions & {
      fractionalSecondDigits?: number;
    } = {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
    };
    return date.toLocaleTimeString("en-US", options);
  };

  const formatRelativeTime = (timestamp: string): string => {
    const now = Date.now();
    const eventTime = new Date(timestamp).getTime();
    const diffMs = now - eventTime;

    if (diffMs < 1000) return "now";
    if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    return `${Math.floor(diffMs / 3600000)}h ago`;
  };

  const toggleEventExpansion = (eventId: string): void => {
    setExpandedEvents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const handleSearchChange = (value: string): void => {
    setSearchValue(value);
    onFilterChange({ ...filter, search: value || undefined });
  };

  const clearSearch = (): void => {
    setSearchValue("");
    onFilterChange({ ...filter, search: undefined });
  };

  const isEventError = (event: WebSocketEvent): boolean => {
    return (
      event.metadata?.success === false ||
      JSON.stringify(event.data).includes("error") ||
      JSON.stringify(event.data).includes("Error")
    );
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Filter Controls */}
      <Box sx={{ p: 2, pb: 1 }}>
        <Stack spacing={2}>
          <TextField
            size="small"
            placeholder={t("debug.searchEvents", "Search events...")}
            value={searchValue}
            onChange={(e) => handleSearchChange(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: searchValue && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={clearSearch}>
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={filter.showErrorsOnly || false}
                  onChange={(e) =>
                    onFilterChange({
                      ...filter,
                      showErrorsOnly: e.target.checked,
                    })
                  }
                />
              }
              label={t("debug.errorsOnly", "Errors only")}
              sx={{ ml: 0 }}
            />

            <Typography variant="caption" color="text.secondary">
              {filteredEvents.length} of {events.length} events
            </Typography>
          </Box>
        </Stack>
      </Box>

      <Divider />

      {/* Events List */}
      <Box
        sx={{
          flex: 1,
          maxHeight,
          overflow: "auto",
          ...(autoScroll && {
            "& > *:last-child": {
              scrollIntoView: "smooth",
            },
          }),
        }}
      >
        {filteredEvents.length === 0 ? (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body2" color="text.secondary">
              {t("debug.noEvents", "No events to display")}
            </Typography>
          </Box>
        ) : (
          <List dense sx={{ py: 0 }}>
            {filteredEvents.map((event, index) => {
              const eventId = event.id ?? `${event.timestamp}-${index}`;
              const isExpanded = expandedEvents.has(eventId);
              const isError = isEventError(event);

              return (
                <React.Fragment key={eventId}>
                  <ListItem
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      py: 1,
                      px: 2,
                      cursor: "pointer",
                      backgroundColor: isError
                        ? theme.palette.error.light + "10"
                        : "transparent",
                      "&:hover": {
                        backgroundColor: theme.palette.action.hover,
                      },
                    }}
                    onClick={() => toggleEventExpansion(eventId)}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
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
                          label={event.type.replace("_", " ").toUpperCase()}
                          size="small"
                          sx={{
                            backgroundColor:
                              getEventTypeColor(event.type) + "20",
                            color: getEventTypeColor(event.type),
                            fontWeight: 600,
                            fontSize: "0.7rem",
                            height: 20,
                          }}
                        />

                        {showTimestamps && (
                          <Box
                            sx={{
                              display: "flex",
                              alignItems: "center",
                              gap: 0.5,
                            }}
                          >
                            <TimeIcon fontSize="inherit" color="disabled" />
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{
                                fontFamily: "monospace",
                                fontSize: "0.7rem",
                              }}
                            >
                              {formatTimestamp(event.timestamp)}
                            </Typography>
                            <Typography
                              variant="caption"
                              color="text.disabled"
                              sx={{ fontSize: "0.65rem" }}
                            >
                              ({formatRelativeTime(event.timestamp)})
                            </Typography>
                          </Box>
                        )}

                        {isError && (
                          <Chip
                            label="ERROR"
                            size="small"
                            color="error"
                            variant="outlined"
                            sx={{ height: 18, fontSize: "0.65rem" }}
                          />
                        )}
                      </Box>

                      {/* Event Source and Quick Preview */}
                      <Box
                        sx={{ display: "flex", alignItems: "center", gap: 1 }}
                      >
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontWeight: 500 }}
                        >
                          {event.source}
                        </Typography>

                        {!isExpanded && (
                          <Typography
                            variant="caption"
                            color="text.disabled"
                            sx={{
                              flex: 1,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 200,
                            }}
                          >
                            {JSON.stringify(event.data).slice(0, 100)}
                            {JSON.stringify(event.data).length > 100 && "..."}
                          </Typography>
                        )}
                      </Box>
                    </Box>

                    <IconButton size="small" sx={{ mt: 0.5 }}>
                      {isExpanded ? (
                        <ExpandLessIcon fontSize="small" />
                      ) : (
                        <ExpandMoreIcon fontSize="small" />
                      )}
                    </IconButton>
                  </ListItem>

                  {/* Expanded Event Details */}
                  <Collapse in={isExpanded}>
                    <Box sx={{ px: 3, pb: 2 }}>
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 1,
                        }}
                      >
                        {/* Event ID */}
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Event ID:
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ fontFamily: "monospace", fontSize: "0.8rem" }}
                          >
                            {event.id}
                          </Typography>
                        </Box>

                        {/* Event Data */}
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Data:
                          </Typography>
                          <Box
                            component="pre"
                            sx={{
                              fontFamily: "monospace",
                              fontSize: "0.75rem",
                              backgroundColor: theme.palette.grey[50],
                              p: 1,
                              borderRadius: 1,
                              overflow: "auto",
                              maxHeight: 200,
                              border: `1px solid ${theme.palette.divider}`,
                              mt: 0.5,
                            }}
                          >
                            {JSON.stringify(event.data, null, 2)}
                          </Box>
                        </Box>

                        {/* Event Metadata */}
                        {event.metadata &&
                          Object.keys(event.metadata).length > 0 && (
                            <Box>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                Metadata:
                              </Typography>
                              <Box
                                component="pre"
                                sx={{
                                  fontFamily: "monospace",
                                  fontSize: "0.75rem",
                                  backgroundColor: theme.palette.grey[100],
                                  p: 1,
                                  borderRadius: 1,
                                  overflow: "auto",
                                  maxHeight: 100,
                                  border: `1px solid ${theme.palette.divider}`,
                                  mt: 0.5,
                                }}
                              >
                                {JSON.stringify(event.metadata, null, 2)}
                              </Box>
                            </Box>
                          )}
                      </Box>
                    </Box>
                  </Collapse>

                  <Divider />
                </React.Fragment>
              );
            })}
          </List>
        )}
      </Box>
    </Box>
  );
};

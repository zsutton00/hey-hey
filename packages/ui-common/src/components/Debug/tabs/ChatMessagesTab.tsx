import React, { useState, useMemo, useCallback } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemText,
  Chip,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Paper,
  Divider,
} from "@mui/material";
import ClearIcon from "@mui/icons-material/Clear";
import ExportIcon from "@mui/icons-material/GetApp";
import { useTranslation } from "react-i18next";
import type { ConversationMessage } from "../../../types/conversation";
import { MessageType } from "../../../api";

interface ChatMessagesTabProps {
  messages: ConversationMessage[];
  onExportMessages: () => void;
  maxHeight?: string;
}

interface MessageFilter {
  messageType?: MessageType | "all";
  search?: string;
  hasError?: boolean;
}

export const ChatMessagesTab: React.FC<ChatMessagesTabProps> = ({
  messages,
  onExportMessages,
  maxHeight = "400px",
}) => {
  const { t } = useTranslation();

  const [filter, setFilter] = useState<MessageFilter>({
    messageType: "all",
    search: "",
    hasError: false,
  });

  // Filter messages based on current filter settings
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      // Message type filter
      if (filter.messageType && filter.messageType !== "all") {
        if (msg.message.type !== filter.messageType) return false;
      }

      // Search filter
      if (filter.search) {
        const searchTerm = filter.search.toLowerCase();
        const content = JSON.stringify(msg.message.data).toLowerCase();
        if (
          !content.includes(searchTerm) &&
          !msg.message.id.toLowerCase().includes(searchTerm)
        ) {
          return false;
        }
      }

      // Error filter
      if (filter.hasError && msg.state !== "error") {
        return false;
      }

      return true;
    });
  }, [messages, filter]);

  const handleFilterChange = useCallback(
    (newFilter: Partial<MessageFilter>) => {
      setFilter((prev) => ({ ...prev, ...newFilter }));
    },
    []
  );

  const clearFilter = useCallback(() => {
    setFilter({ messageType: "all", search: "", hasError: false });
  }, []);

  const getMessageTypeColor = (
    type: MessageType
  ): "primary" | "secondary" | "success" | "warning" | "error" => {
    switch (type) {
      case MessageType.User:
        return "primary";
      case MessageType.System:
        return "secondary";
      default:
        return "warning";
    }
  };

  const getStateColor = (
    state: string
  ): "success" | "warning" | "error" | "default" => {
    switch (state) {
      case "completed":
        return "success";
      case "processing":
        return "warning";
      case "error":
        return "error";
      default:
        return "default";
    }
  };

  return (
    <Box
      sx={{ height: "100%", display: "flex", flexDirection: "column", p: 2 }}
    >
      {/* Filter Controls */}
      <Paper sx={{ p: 2, mb: 2 }} elevation={1}>
        <Typography variant="body2" fontWeight={600} gutterBottom>
          {t("debug.chatMessages.filters", "Message Filters")}
        </Typography>

        <Box
          sx={{
            display: "flex",
            gap: 2,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <FormControl size="small" sx={{ minWidth: 120 }}>
            <InputLabel>{t("debug.chatMessages.type", "Type")}</InputLabel>
            <Select
              value={filter.messageType || "all"}
              label={t("debug.chatMessages.type", "Type")}
              onChange={(e) =>
                handleFilterChange({
                  messageType: e.target.value as MessageType | "all",
                })
              }
            >
              <MenuItem value="all">
                {t("debug.chatMessages.allTypes", "All Types")}
              </MenuItem>
              <MenuItem value={MessageType.User}>
                {t("debug.chatMessages.user", "User")}
              </MenuItem>
              <MenuItem value={MessageType.System}>
                {t("debug.chatMessages.system", "System")}
              </MenuItem>
            </Select>
          </FormControl>

          <TextField
            size="small"
            label={t("debug.chatMessages.search", "Search")}
            value={filter.search || ""}
            onChange={(e) => handleFilterChange({ search: e.target.value })}
            sx={{ minWidth: 200 }}
          />

          <Box sx={{ display: "flex", gap: 1 }}>
            <Tooltip
              title={t("debug.chatMessages.clearFilter", "Clear Filters")}
            >
              <IconButton size="small" onClick={clearFilter}>
                <ClearIcon fontSize="small" />
              </IconButton>
            </Tooltip>

            <Tooltip title={t("debug.chatMessages.export", "Export Messages")}>
              <IconButton size="small" onClick={onExportMessages}>
                <ExportIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        <Typography
          variant="caption"
          color="textSecondary"
          sx={{ mt: 1, display: "block" }}
        >
          {t(
            "debug.chatMessages.showing",
            "Showing {{count}} of {{total}} messages",
            {
              count: filteredMessages.length,
              total: messages.length,
            }
          )}
        </Typography>
      </Paper>

      {/* Messages List */}
      <Box sx={{ flex: 1, overflow: "auto", maxHeight }}>
        {filteredMessages.length === 0 ? (
          <Box sx={{ p: 3, textAlign: "center" }}>
            <Typography variant="body2" color="textSecondary">
              {messages.length === 0
                ? t("debug.chatMessages.noMessages", "No messages available")
                : t(
                    "debug.chatMessages.noFilteredMessages",
                    "No messages match current filters"
                  )}
            </Typography>
          </Box>
        ) : (
          <List dense>
            {filteredMessages.map((msg, index) => (
              <React.Fragment key={msg.message.id}>
                <ListItem sx={{ alignItems: "flex-start" }}>
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
                        <Chip
                          label={msg.message.type}
                          size="small"
                          color={getMessageTypeColor(msg.message.type)}
                          variant="outlined"
                        />
                        <Chip
                          label={msg.state}
                          size="small"
                          color={getStateColor(msg.state)}
                          variant="filled"
                        />
                        <Typography variant="caption" color="textSecondary">
                          {new Date(msg.message.createdAt).toLocaleTimeString()}
                        </Typography>
                      </Box>
                    }
                    secondary={
                      <Box>
                        <Typography
                          variant="body2"
                          color="textPrimary"
                          sx={{ mb: 1 }}
                        >
                          ID: <code>{msg.message.id}</code>
                        </Typography>

                        {msg.message.data?.response && (
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Response:</strong>{" "}
                            {msg.message.data.response.substring(0, 200)}
                            {msg.message.data.response.length > 200 && "..."}
                          </Typography>
                        )}

                        <Box sx={{ mt: 1 }}>
                          <Typography variant="caption" color="textSecondary">
                            Data:{" "}
                            <code>
                              {JSON.stringify(
                                msg.message.data,
                                null,
                                2
                              ).substring(0, 300)}
                            </code>
                            {JSON.stringify(msg.message.data).length > 300 &&
                              "..."}
                          </Typography>
                        </Box>
                      </Box>
                    }
                  />
                </ListItem>

                {index < filteredMessages.length - 1 && <Divider />}
              </React.Fragment>
            ))}
          </List>
        )}
      </Box>
    </Box>
  );
};

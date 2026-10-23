import React, { useMemo } from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { isCommandDisabled, type Command } from "./types";

export const SLASH_COMMAND_POPUP_WIDTH = 360;

interface SlashCommandPopupProps {
  heyHey: Command[];
  mode?: "command-pick" | "arg-entry-query";
  query?: string;
  maxHeight?: number;
  selectedIndex?: number;
  onSelectedIndexChange?: (index: number) => void;
  onPickCommand?: (command: Command) => void;
}

export const SlashCommandPopup: React.FC<SlashCommandPopupProps> = ({
  heyHey,
  mode = "command-pick",
  query = "",
  maxHeight = 500,
  selectedIndex = -1,
  onSelectedIndexChange,
  onPickCommand,
}) => {
  const { t } = useTranslation();

  const flatOrder = useMemo(() => [...heyHey], [heyHey]);
  const indexOf = useMemo(() => {
    const map = new Map<string, number>();
    flatOrder.forEach((command, index) => map.set(command.id, index));
    return map;
  }, [flatOrder]);

  const renderRow = (command: Command): React.ReactNode => {
    const globalIndex = indexOf.get(command.id) ?? -1;
    const isDisabled = isCommandDisabled(command);
    const disabledReason =
      command.availability?.state === "disabled"
        ? command.availability.reason
        : undefined;
    const disabledReasonId = `slash-command-disabled-reason-${command.name}`;
    return (
      <ListItem key={command.id} disablePadding>
        <ListItemButton
          data-testid={`slash-command-row-${command.name}`}
          disabled={isDisabled}
          aria-describedby={disabledReason ? disabledReasonId : undefined}
          onMouseDown={(event) => {
            event.preventDefault();
          }}
          onMouseEnter={() => {
            if (globalIndex >= 0 && !isDisabled) {
              onSelectedIndexChange?.(globalIndex);
            }
          }}
          onClick={() => {
            if (!isDisabled) onPickCommand?.(command);
          }}
          selected={globalIndex === selectedIndex && !isDisabled}
          sx={{
            px: 2,
            py: 1,
            "&.Mui-selected": {
              backgroundColor: "action.selected",
            },
            "&.Mui-selected:hover": {
              backgroundColor: "action.selected",
            },
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "baseline",
              gap: 1.5,
              width: "100%",
              minWidth: 0,
            }}
          >
            <Typography
              component="div"
              sx={{ flexShrink: 0, fontFamily: "monospace", fontSize: 13 }}
            >
              {`/${command.name}`}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="body2"
                sx={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: "text.secondary",
                }}
              >
                {command.description}
              </Typography>
              {disabledReason ? (
                <Typography
                  id={disabledReasonId}
                  data-testid="slash-command-disabled-reason"
                  data-command-name={command.name}
                  variant="caption"
                  color="text.disabled"
                  sx={{ display: "block", whiteSpace: "normal" }}
                >
                  {disabledReason}
                </Typography>
              ) : null}
            </Box>
          </Box>
        </ListItemButton>
      </ListItem>
    );
  };

  const sectionHeaderSx = {
    px: 2,
    py: 0.5,
    display: "block",
    color: "text.secondary",
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
    fontWeight: 600,
  };

  const hasAnyRows = heyHey.length > 0;
  const isArgEntryQuery = mode === "arg-entry-query";

  return (
    <Paper
      data-testid="slash-command-popup"
      sx={{
        width: SLASH_COMMAND_POPUP_WIDTH,
        maxHeight,
        display: "flex",
        flexDirection: "column",
        boxShadow: 3,
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isArgEntryQuery ? (
          <List disablePadding>
            <ListItem disablePadding>
              <ListItemButton
                data-testid="slash-arg-entry-search"
                onMouseDown={(event) => {
                  event.preventDefault();
                }}
                sx={{
                  "&.Mui-selected": {
                    backgroundColor: "action.selected",
                  },
                  "&.Mui-selected:hover": {
                    backgroundColor: "action.selected",
                  },
                }}
              >
                <ListItemText
                  primary={
                    <Typography variant="body2">
                      {t(
                        "slashCommandPopup.searchAffordance",
                        "Press Enter to search for: {{query}}",
                        { query }
                      )}
                    </Typography>
                  }
                />
              </ListItemButton>
            </ListItem>
          </List>
        ) : (
          <>
            {heyHey.length > 0 && (
              <Box data-testid="slash-command-section-hey-hey">
                <Typography variant="caption" sx={sectionHeaderSx}>
                  {t("slashCommandPopup.heyHey", "Hey Hey commands")}
                </Typography>
                <List disablePadding>
                  {heyHey.map((command) => renderRow(command))}
                </List>
              </Box>
            )}

            {!hasAnyRows && (
              <Box sx={{ p: 2 }}>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  align="center"
                >
                  {t("slashCommandPopup.noMatches", "No commands available")}
                </Typography>
              </Box>
            )}
          </>
        )}
      </Box>
    </Paper>
  );
};

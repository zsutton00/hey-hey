import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { Box, ButtonBase, CircularProgress } from "@mui/material";
import React from "react";

export interface DiscussCircleControlProps {
  /** Accessible name and tooltip. */
  label: string;
  testId: string;
  onDiscuss: () => void;
  disabled?: boolean;
  /** Shows progress in the circle and blocks a second start. */
  isStarting?: boolean;
}

/** Inline blue chat circle plus arrow, placed right after a card's lead text. */
export const DiscussCircleControl: React.FC<DiscussCircleControlProps> = ({
  label,
  testId,
  onDiscuss,
  disabled = false,
  isStarting = false,
}) => (
  <ButtonBase
    aria-busy={isStarting}
    aria-label={label}
    title={label}
    data-testid={testId}
    disabled={disabled || isStarting}
    onClick={onDiscuss}
    sx={(theme) => ({
      display: "inline-flex",
      alignItems: "center",
      gap: 0.25,
      ml: 1,
      verticalAlign: "middle",
      borderRadius: 999,
      color: theme.palette.actionable.main,
      "& .discuss-circle": {
        backgroundColor: theme.palette.actionable.main,
        color: theme.palette.actionable.contrastText,
        transition: "filter 120ms ease",
      },
      "&:hover .discuss-circle": { filter: "brightness(1.12)" },
      "&:hover, &:focus-visible": {
        backgroundColor: theme.palette.action.hover,
      },
      "&:focus-visible": {
        outline: `2px solid ${theme.palette.actionable.main}`,
        outlineOffset: 2,
      },
      "&.Mui-disabled": { color: theme.palette.action.disabled },
      "&.Mui-disabled:not([aria-busy='true']) .discuss-circle": {
        backgroundColor: theme.palette.action.disabledBackground,
        color: theme.palette.action.disabled,
      },
    })}
  >
    <Box
      className="discuss-circle"
      sx={{
        width: 24,
        height: 24,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {isStarting ? (
        <CircularProgress
          aria-label="Starting discussion"
          color="inherit"
          size={14}
        />
      ) : (
        <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
      )}
    </Box>
    <ArrowForwardIcon aria-hidden sx={{ fontSize: 16 }} />
  </ButtonBase>
);

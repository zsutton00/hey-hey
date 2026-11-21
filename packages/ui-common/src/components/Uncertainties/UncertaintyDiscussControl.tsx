import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { Box, ButtonBase } from "@mui/material";
import React from "react";

export interface UncertaintyDiscussControlProps {
  onDiscuss: () => void;
}

/** Inline blue chat circle plus arrow, placed right after the statement text. */
export const UncertaintyDiscussControl: React.FC<
  UncertaintyDiscussControlProps
> = ({ onDiscuss }) => (
  <ButtonBase
    aria-label="Discuss this uncertainty"
    title="Discuss this uncertainty"
    data-testid="uncertainty-discuss-control"
    onClick={onDiscuss}
    sx={(theme) => ({
      display: "inline-flex",
      alignItems: "center",
      gap: 0.25,
      ml: 1,
      verticalAlign: "middle",
      borderRadius: 999,
      color: theme.palette.actionable.main,
      "& .discuss-circle": { transition: "filter 120ms ease" },
      "&:hover .discuss-circle": { filter: "brightness(1.12)" },
      "&:hover, &:focus-visible": {
        backgroundColor: theme.palette.action.hover,
      },
      "&:focus-visible": {
        outline: `2px solid ${theme.palette.actionable.main}`,
        outlineOffset: 2,
      },
    })}
  >
    <Box
      className="discuss-circle"
      sx={(theme) => ({
        width: 24,
        height: 24,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.palette.actionable.main,
        color: theme.palette.actionable.contrastText,
      })}
    >
      <ChatBubbleOutlineIcon sx={{ fontSize: 14 }} />
    </Box>
    <ArrowForwardIcon aria-hidden sx={{ fontSize: 16 }} />
  </ButtonBase>
);

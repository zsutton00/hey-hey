import ChatBubbleOutlineIcon from "@mui/icons-material/ChatBubbleOutline";
import { Box, ButtonBase, Typography } from "@mui/material";
import React from "react";

export interface UncertaintyDiscussControlProps {
  onDiscuss: () => void;
}

/** Quiet blue circle with a "Discuss" label; the blue matches the Discuss capsule. */
export const UncertaintyDiscussControl: React.FC<
  UncertaintyDiscussControlProps
> = ({ onDiscuss }) => (
  <ButtonBase
    aria-label="Discuss this uncertainty"
    data-testid="uncertainty-discuss-control"
    onClick={onDiscuss}
    sx={(theme) => ({
      flexDirection: "column",
      gap: 0.25,
      width: 44,
      borderRadius: 1,
      "& .discuss-circle": {
        transition: "filter 120ms ease",
      },
      "&:hover .discuss-circle": { filter: "brightness(1.12)" },
      "&:focus-visible": {
        outline: `2px solid ${theme.palette.actionable.main}`,
        outlineOffset: 2,
      },
    })}
  >
    <Box
      className="discuss-circle"
      sx={(theme) => ({
        width: 28,
        height: 28,
        borderRadius: "50%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.palette.actionable.main,
        color: theme.palette.actionable.contrastText,
      })}
    >
      <ChatBubbleOutlineIcon sx={{ fontSize: 16 }} />
    </Box>
    <Typography
      component="span"
      sx={(theme) => ({
        fontSize: 10,
        lineHeight: 1.2,
        fontWeight: 600,
        color:
          theme.palette.mode === "dark"
            ? theme.palette.actionable.light
            : theme.palette.actionable.main,
      })}
    >
      Discuss
    </Typography>
  </ButtonBase>
);

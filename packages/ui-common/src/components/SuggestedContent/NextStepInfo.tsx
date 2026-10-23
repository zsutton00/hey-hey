import React from "react";
import { Box, Typography, useTheme } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import LightbulbIcon from "@mui/icons-material/Lightbulb";

export interface NextStepInfoProps {
  /** The next step text to display */
  content: string;
  /** Optional title (defaults to "Next Step") */
  title?: string;
  /** Optional icon to display in the header */
  icon?: React.ReactNode;
  /** Additional styling */
  sx?: SxProps<Theme>;
}

/**
 * NextStepInfo component displays informational guidance about the next step.
 * This is a purely informational component with no accept/reject actions.
 * Styled similarly to SuggestedContent but with a different color scheme.
 */
export const NextStepInfo: React.FC<NextStepInfoProps> = ({
  content,
  title = "Next Step",
  icon,
  sx = {},
}) => {
  const theme = useTheme();

  // Don't render if no content provided
  if (!content) {
    return null;
  }

  const defaultIcon = (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
      <LightbulbIcon sx={{ fontSize: "1.2rem" }} />
      <ArrowForwardIcon sx={{ fontSize: "1rem" }} />
    </Box>
  );

  return (
    <Box
      sx={{
        backgroundColor:
          theme.palette.mode === "dark"
            ? "rgba(52, 211, 153, 0.1)" // emerald with low opacity for dark mode
            : "rgba(236, 253, 245, 1)", // emerald.50 for light mode
        borderLeft: `4px solid ${theme.palette.success.main}`,
        borderRadius: 2,
        p: 2,
        boxShadow:
          theme.palette.mode === "dark"
            ? "0 2px 8px rgba(0, 0, 0, 0.3)"
            : "0 2px 8px rgba(0, 0, 0, 0.08)",
        ...sx,
      }}
      data-testid="next-step-info"
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          mb: 1.5,
        }}
      >
        <Box
          sx={{
            color: theme.palette.success.main,
            display: "flex",
            alignItems: "center",
          }}
        >
          {icon || defaultIcon}
        </Box>
        <Typography
          variant="subtitle2"
          sx={{
            fontWeight: 600,
            color: theme.palette.success.main,
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            fontSize: "0.75rem",
          }}
        >
          {title}
        </Typography>
      </Box>

      {/* Content */}
      <Typography
        variant="body2"
        sx={{
          color: theme.palette.text.primary,
          lineHeight: 1.6,
          fontWeight: 400,
        }}
      >
        {content}
      </Typography>
    </Box>
  );
};

import React from "react";
import { Box, CircularProgress, Tooltip, Typography } from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import LabelOffOutlinedIcon from "@mui/icons-material/LabelOffOutlined";
import type { FeatureTag } from "../../api";
import {
  FEATURE_TAG_PALETTE,
  UNSET_FEATURE_TAG_LABEL,
} from "./featureTagPalette";

export interface FeatureTagBadgeProps {
  tag: FeatureTag | null | undefined;
  loading?: boolean;
  error?: string | null;
}

export const FeatureTagBadge: React.FC<FeatureTagBadgeProps> = ({
  tag,
  loading,
  error,
}) => {
  if (loading) {
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          borderRadius: 1,
          backgroundColor: "action.selected",
          color: "text.secondary",
        }}
        aria-busy="true"
        aria-label="Saving feature tag"
      >
        <CircularProgress size={12} thickness={5} color="inherit" />
        <Typography variant="caption" sx={{ fontWeight: 600 }}>
          Saving…
        </Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Tooltip title={error} arrow>
        <Box
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.75,
            px: 1.25,
            py: 0.5,
            borderRadius: 1,
            border: 1,
            borderColor: "error.main",
            color: "error.main",
            backgroundColor: "transparent",
          }}
          role="alert"
        >
          <ErrorOutlineIcon sx={{ fontSize: 14 }} />
          <Typography
            variant="caption"
            sx={{ fontWeight: 700, letterSpacing: 0.4 }}
          >
            Tag failed
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  if (!tag) {
    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          borderRadius: 1,
          border: 1,
          borderStyle: "dashed",
          borderColor: "divider",
          color: "text.secondary",
        }}
      >
        <LabelOffOutlinedIcon sx={{ fontSize: 14 }} />
        <Typography
          variant="caption"
          sx={{ fontWeight: 600, letterSpacing: 0.4 }}
        >
          {UNSET_FEATURE_TAG_LABEL}
        </Typography>
      </Box>
    );
  }

  const entry = FEATURE_TAG_PALETTE[tag];
  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        px: 1.25,
        py: 0.5,
        borderRadius: 1,
        backgroundColor: entry.color,
        color: entry.contrastText,
      }}
    >
      <Typography
        variant="caption"
        sx={{ fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase" }}
      >
        {entry.label}
      </Typography>
    </Box>
  );
};

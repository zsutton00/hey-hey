import React from "react";
import { Box, Tooltip, Typography } from "@mui/material";
import type { FeatureTag } from "../../api";
import {
  FEATURE_TAG_PALETTE,
  UNSET_FEATURE_TAG_LABEL,
} from "./featureTagPalette";

export interface FeatureTagDotProps {
  tag: FeatureTag | null | undefined;
  emphasized?: boolean;
}

export const FeatureTagDot: React.FC<FeatureTagDotProps> = ({
  tag,
  emphasized,
}) => {
  if (!tag) {
    return (
      <Tooltip title={UNSET_FEATURE_TAG_LABEL} arrow>
        <Box
          aria-label={UNSET_FEATURE_TAG_LABEL}
          sx={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            border: 1,
            borderStyle: "dashed",
            borderColor: emphasized ? "rgba(255,255,255,0.7)" : "text.disabled",
            flexShrink: 0,
          }}
        />
      </Tooltip>
    );
  }

  const entry = FEATURE_TAG_PALETTE[tag];

  return (
    <Box
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        py: 0.125,
        borderRadius: 0.75,
        backgroundColor: emphasized
          ? "rgba(255,255,255,0.15)"
          : `${entry.color}1A`,
        color: emphasized ? "inherit" : entry.color,
        flexShrink: 0,
      }}
      aria-label={entry.label}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: entry.color,
          flexShrink: 0,
        }}
      />
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          letterSpacing: 0.4,
          fontSize: 10,
          lineHeight: 1.1,
          textTransform: "uppercase",
        }}
      >
        {entry.shortLabel}
      </Typography>
    </Box>
  );
};

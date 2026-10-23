import React from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

export interface DetailPageContextualRailToggleProps {
  expanded: boolean;
  label: string;
  controlsId: string;
  onToggle: () => void;
}

export interface DetailPageContextualRailProps
  extends DetailPageContextualRailToggleProps {
  children: React.ReactNode;
  side?: "left" | "right";
  fillHeight?: boolean;
  sx?: SxProps<Theme>;
}

const SidePanelIcon: React.FC<{ expanded: boolean }> = ({ expanded }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{
      transform: expanded ? "rotate(180deg)" : undefined,
      transition: "transform 150ms ease",
    }}
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M15 3v18" />
    <path d="m10 9-3 3 3 3" />
  </svg>
);

export const DetailPageContextualRailToggle: React.FC<
  DetailPageContextualRailToggleProps
> = ({ expanded, label, controlsId, onToggle }) => {
  const action = expanded ? "Hide" : "Show";
  const accessibleLabel = `${action} ${label}`;

  return (
    <Tooltip title={accessibleLabel}>
      <IconButton
        type="button"
        size="small"
        onClick={onToggle}
        aria-label={accessibleLabel}
        aria-expanded={expanded}
        aria-controls={controlsId}
        data-testid="detail-page-contextual-rail-toggle"
      >
        <SidePanelIcon expanded={expanded} />
      </IconButton>
    </Tooltip>
  );
};

export const DetailPageContextualRail: React.FC<
  DetailPageContextualRailProps
> = ({ children, side = "right", fillHeight = false, sx, ...toggleProps }) => (
  <Box
    sx={{
      position: "relative",
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      width: "100%",
      ...(fillHeight ? { flex: 1, height: "100%", minHeight: 0 } : {}),
      ...sx,
    }}
    data-testid="detail-page-contextual-rail"
    data-rail-side={side}
  >
    <Box
      sx={{
        display: "flex",
        justifyContent: side === "right" ? "flex-end" : "flex-start",
        minHeight: 32,
      }}
      data-testid="detail-page-contextual-rail-chrome"
    >
      <DetailPageContextualRailToggle {...toggleProps} />
    </Box>
    <Box
      component="aside"
      id={toggleProps.controlsId}
      sx={{
        minWidth: 0,
        width: "100%",
        ...(fillHeight
          ? { display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }
          : {}),
      }}
    >
      {children}
    </Box>
  </Box>
);

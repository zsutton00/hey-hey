import React from "react";
import { Box, Chip, Typography, Button } from "@mui/material";
import { Pulse } from "../../animations";
import { getStatusLabel, getStatusColorMapping } from "../../utils/statusUtils";
import type { WorkStatus } from "../../api";

export interface WorkItemStatusChipProps {
  status: WorkStatus;
  itemId: string;
  testIdPrefix?: string;
}

export const WorkItemStatusChip: React.FC<WorkItemStatusChipProps> = ({
  status,
  itemId,
  testIdPrefix = "work-item",
}) => {
  return (
    <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
      <Chip
        data-testid={`${testIdPrefix}-${itemId}-status`}
        label={getStatusLabel(status)}
        color={getStatusColorMapping(status)}
        size="small"
        sx={{ fontWeight: "bold" }}
      />
    </Box>
  );
};

export interface WorkItemTitleSectionProps {
  name: string;
  tags?: string[];
}

export const WorkItemTitleSection: React.FC<WorkItemTitleSectionProps> = ({
  name,
  tags,
}) => {
  return (
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1 }}>
      <Typography variant="h6">{name}</Typography>
      {tags &&
        tags.length > 0 &&
        tags.map((tag, index) => (
          <Chip key={index} label={tag} size="small" variant="outlined" />
        ))}
    </Box>
  );
};

export interface WorkItemDescriptionSectionProps {
  displayedDescription: string;
  isTyping: boolean;
  maxWidth?: string;
  marginBottom?: number;
}

export const WorkItemDescriptionSection: React.FC<
  WorkItemDescriptionSectionProps
> = ({
  displayedDescription,
  isTyping,
  maxWidth = "100ch",
  marginBottom = 1.5,
}) => {
  return (
    <Typography
      variant="body2"
      color="text.secondary"
      sx={{ maxWidth, mb: marginBottom }}
    >
      {displayedDescription}
      {isTyping && (
        <Pulse duration={0.5} pulseScale={0}>
          <span style={{ marginLeft: "2px" }}>|</span>
        </Pulse>
      )}
    </Typography>
  );
};

export interface ActionButtonConfig {
  label: string;
  onClick: (e: React.MouseEvent) => void;
  variant?: "contained" | "outlined" | "text";
  color?: "actionable" | "error" | "info" | "success" | "warning";
  disabled?: boolean;
  startIcon?: React.ReactNode;
  sx?: object;
}

export interface WorkItemActionSectionProps {
  buttons: ActionButtonConfig[];
  gap?: number;
}

export const WorkItemActionSection: React.FC<WorkItemActionSectionProps> = ({
  buttons,
  gap = 1,
}) => {
  const defaultButtonStyle = {
    textTransform: "uppercase" as const,
    fontSize: "0.8rem",
    fontWeight: 600,
    py: 1,
    px: 2,
  };

  return (
    <Box sx={{ display: "flex", gap }}>
      {buttons.map((button, index) => (
        <Button
          key={index}
          variant={button.variant || "contained"}
          size="small"
          color={button.color || "primary"}
          onClick={(e) => {
            button.onClick(e);
          }}
          disabled={button.disabled || false}
          startIcon={button.startIcon}
          sx={{
            ...defaultButtonStyle,
            ...button.sx,
          }}
        >
          {button.label}
        </Button>
      ))}
    </Box>
  );
};

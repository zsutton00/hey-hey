import { Box, Tooltip } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import React from "react";
import type { AgentSessionType } from "../../api";
import {
  getFallbackEntityColors,
  getAgentSessionIcon,
  getEntityColors,
  getEntityIcon,
  resolveWorkItemIconPresentation,
  type WorkItemIconIdentity,
} from "../../utils/entityIcons";

export interface EntityIconProps {
  entityType: string;
  workItemIcon?: WorkItemIconIdentity;
  agentSessionType?: AgentSessionType;
  round?: boolean;
  size?: number;
  sx?: SxProps<Theme>;
  "aria-hidden"?: React.AriaAttributes["aria-hidden"];
  "data-testid"?: string;
}

const entityIconScaleMap: Record<string, number> = {
  project: 0.75,
};

export const EntityIcon: React.FC<EntityIconProps> = ({
  entityType,
  workItemIcon,
  agentSessionType,
  round,
  size = 32,
  sx,
  "aria-hidden": ariaHidden,
  "data-testid": dataTestId,
}) => {
  const workItemPresentation = workItemIcon
    ? resolveWorkItemIconPresentation(
        workItemIcon.typeKey,
        workItemIcon.definition,
        workItemIcon.effectiveSource
      )
    : undefined;
  const IconComponent = workItemIcon
    ? workItemPresentation?.Icon ?? getEntityIcon("task")
    : entityType.toLowerCase() === "agent_session"
    ? getAgentSessionIcon(agentSessionType)
    : getEntityIcon(entityType);
  const colors = workItemIcon
    ? workItemPresentation?.colors ?? getFallbackEntityColors()
    : getEntityColors(entityType);
  const normalizedType = entityType.toLowerCase();
  const scale = entityIconScaleMap[normalizedType] ?? 0.5;

  return (
    <Tooltip title={entityType}>
      <Box
        aria-hidden={ariaHidden}
        data-testid={dataTestId}
        sx={{
          width: size,
          height: size,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: colors.background,
          borderRadius: round ? "50%" : "2px",
          color: colors.color,
          ...sx,
        }}
      >
        <IconComponent sx={{ fontSize: Math.max(16, size * scale) }} />
      </Box>
    </Tooltip>
  );
};

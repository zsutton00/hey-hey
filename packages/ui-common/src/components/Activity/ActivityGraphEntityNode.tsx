import { Box, useTheme as useMuiTheme } from "@mui/material";
import React from "react";
import { Handle, Position } from "reactflow";
import { getEntityColors } from "../../utils/entityIcons";
import { getStatusColorMapping } from "../../utils/statusUtils";
import { ActivityGraphEntity } from "./ActivityGraphEntity";
import type {
  ActivityGanttEntityNode,
  ActivityGanttPlanScope,
  ActivityGanttRelationshipType,
} from "./activityGanttPrimitives";

export interface ActivityGraphEntityNodeData {
  entity: ActivityGanttEntityNode;
  signals: ActivityGanttRelationshipType[];
  emphasis: boolean;
  isParent: boolean;
  isCenter: boolean;
  hasSessionBelow: boolean;
  hasMessageBelow: boolean;
  nodeWidth: number;
  hasIncoming: boolean;
  hasOutgoing: boolean;
  projectId?: string;
  planScope?: ActivityGanttPlanScope;
}

export interface ActivityGraphEntityNodeProps {
  data: ActivityGraphEntityNodeData;
}

const hiddenHandle = { opacity: 0 };

export const ActivityGraphEntityNode: React.FC<
  ActivityGraphEntityNodeProps
> = ({ data }) => {
  const {
    entity,
    emphasis,
    isParent,
    isCenter,
    hasSessionBelow,
    hasMessageBelow,
    nodeWidth,
    hasIncoming,
    hasOutgoing,
    projectId,
    planScope,
  } = data;

  const muiTheme = useMuiTheme();
  const entityColors = isCenter ? getEntityColors(entity.entityType) : null;

  const statusPaletteKey = getStatusColorMapping(entity.status);
  const hasStatusStyle =
    statusPaletteKey !== "default" && statusPaletteKey !== "ready";
  const paletteEntry = hasStatusStyle
    ? (muiTheme.palette[statusPaletteKey] as { main: string } | undefined)
    : undefined;
  const statusMainColor = paletteEntry?.main ?? null;

  return (
    <>
      {hasIncoming && (
        <Handle type="target" position={Position.Left} style={hiddenHandle} />
      )}
      <Box
        className="nodrag"
        sx={{
          width: nodeWidth,
          opacity: isParent ? 0.7 : 1,
          "& > .MuiPaper-root": {
            ...(entityColors
              ? {
                  bgcolor: entityColors.background,
                  color: entityColors.color,
                }
              : {}),
            ...(statusMainColor
              ? {
                  border: `3px solid ${statusMainColor}`,
                  boxShadow: `0 0 0 3px color-mix(in srgb, ${statusMainColor} 25%, transparent), 0 1px 6px 2px color-mix(in srgb, ${statusMainColor} 20%, transparent)`,
                }
              : {}),
          },
        }}
      >
        <ActivityGraphEntity
          emphasis={emphasis}
          contrastChips={!!entityColors}
          entity={entity}
          planScope={planScope}
          projectId={projectId}
        />
      </Box>
      {hasOutgoing && (
        <Handle type="source" position={Position.Right} style={hiddenHandle} />
      )}
      {hasSessionBelow && (
        <Handle
          id="bottom"
          type="source"
          position={Position.Bottom}
          style={hiddenHandle}
        />
      )}
      {hasMessageBelow && (
        <Handle
          id="message-bottom"
          type="source"
          position={Position.Bottom}
          style={hiddenHandle}
        />
      )}
    </>
  );
};

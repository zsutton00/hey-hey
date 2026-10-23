import React, { useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { getStatusColorMapping } from "@hey-hey/ui-common";
import { TargetEntityType } from "@hey-hey/ui-common/api";
import { WebPathService } from "@hey-hey/ui-common/services";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTheme, type Theme } from "@mui/material/styles";
import { useNavigate } from "react-router-dom";
import { EntityIcon } from "@hey-hey/ui-common/components/Entity";
import { InteractionComponent } from "@hey-hey/ui-common/components/InteractionComponent";
import type {
  ExplorerTreeNodeProps,
  ExplorerNode,
  ExplorerEntityType,
} from "./types";

type StatusColor = ReturnType<typeof getStatusColorMapping>;

function resolveStatusIndicatorColor(theme: Theme, color: StatusColor): string {
  const palette = theme.palette as unknown as Record<
    string,
    { main?: string } | undefined
  >;
  const paletteColor = palette[color];
  return paletteColor?.main ?? theme.palette.text.disabled;
}

/**
 * Map ExplorerNode type to EntityIcon type
 */
function getEntityIconType(type: ExplorerNode["type"]): string {
  switch (type) {
    case "feature":
      return "feature";
    case "goal":
      return "goal";
    case "plan":
      return "plan";
    case "service":
      return "service";
    case "work-item":
      return "task";
    default:
      return "design_doc";
  }
}

function getNodeIconType(node: ExplorerNode): string {
  return node.iconType ?? getEntityIconType(node.type);
}

/**
 * Get navigation path for entity
 */
function getEntityPath(node: ExplorerNode, projectId: string): string {
  if (node.path) {
    return node.path;
  }

  switch (node.type) {
    case "feature":
      return WebPathService.feature({ projectId, featureId: node.id });
    case "goal":
      return WebPathService.task({ projectId, taskId: node.id });
    case "plan":
      return `/projects/${projectId}/plans/${node.id}`;
    case "service":
      return `/projects/${projectId}/services/${node.id}`;
    case "work-item":
      return WebPathService.task({ projectId, taskId: node.id });
    default:
      return `/projects/${projectId}`;
  }
}

/**
 * Map explorer entity types to TargetEntityType for InteractionComponent support.
 * Returns undefined for entity types that don't support interactions.
 */
function toTargetEntityType(
  type: ExplorerEntityType,
): TargetEntityType | (string & {}) | undefined {
  switch (type) {
    case "feature":
      return TargetEntityType.Task;
    case "goal":
      return "GOAL";
    case "plan":
      return TargetEntityType.Task;
    case "service":
      return "SERVICE" as TargetEntityType;
    case "work-item":
      return TargetEntityType.Task;
    default:
      return undefined;
  }
}

/**
 * Individual tree node component
 * Handles display and interaction
 * Note: Child loading is disabled in this version for simplicity
 */
export const ExplorerTreeNode: React.FC<ExplorerTreeNodeProps> = ({
  node,
  isExpanded,
  isSelected: _isSelected,
  onToggle,
  onSelect,
  disableDepthIndent = false,
  organizationId,
  projectId: projectIdProp,
  interactionSize = "small",
}) => {
  const navigate = useNavigate();
  const theme = useTheme();

  // Use prop if provided, otherwise extract from URL
  const projectId =
    projectIdProp ?? window.location.pathname.split("/")[2] ?? "";
  const status = node.status?.trim();
  const statusColor = status ? getStatusColorMapping(status) : undefined;
  const statusIndicatorColor = statusColor
    ? resolveStatusIndicatorColor(theme, statusColor)
    : undefined;
  const showStatusIndicator =
    node.type !== "service" && Boolean(status && statusIndicatorColor);
  const planStatusDotColor =
    node.type === "plan"
      ? status === "ACTIVE"
        ? theme.palette.success.main
        : status === "READY" || status === "BACKLOG"
          ? theme.palette.text.disabled
          : undefined
      : undefined;

  // Handle toggle expand/collapse
  const handleToggle = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();

      if (node.hasChildren) {
        onToggle();
      }
    },
    [node.hasChildren, onToggle],
  );

  // Handle click to navigate
  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Allow browser default behavior for Ctrl/Cmd+click, middle-click
      if (
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        event.button === 0
      ) {
        event.preventDefault();
        onSelect();
        navigate(getEntityPath(node, projectId));
      }
    },
    [node, projectId, navigate, onSelect],
  );

  // Apply depth-based indentation only when not in search mode
  const indent = disableDepthIndent ? 0 : node.depth * 16; // 16px per depth level

  const targetEntityType = toTargetEntityType(node.type);

  const nodeContent = (
    <Box>
      {/* Node Content - Row with chevron + link */}
      <Box
        role="treeitem"
        aria-expanded={node.hasChildren ? isExpanded : undefined}
        aria-level={node.depth + 1}
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0,
          pl: `${indent + 8}px`,
          bgcolor: "transparent",
          "&:hover": { bgcolor: "action.hover" },
          borderRadius: 1,
          transition: "background-color 0.2s",
        }}
      >
        {/* Expand/Collapse Icon - Outside the link */}
        {node.hasChildren ? (
          <Box
            component="button"
            onClick={handleToggle}
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              p: 0,
              border: "none",
              background: "none",
              cursor: "pointer",
              color: "text.secondary",
              flexShrink: 0,
              "&:hover": {
                color: "text.primary",
                bgcolor: "action.hover",
                borderRadius: 1,
              },
            }}
            aria-label={isExpanded ? "Collapse" : "Expand"}
          >
            {isExpanded ? (
              <ExpandMoreIcon fontSize="small" />
            ) : (
              <ChevronRightIcon fontSize="small" />
            )}
          </Box>
        ) : (
          <Box sx={{ width: 28, flexShrink: 0 }} /> // Spacer for alignment
        )}

        {/* Link wrapping the content */}
        <Box
          component="a"
          href={getEntityPath(node, projectId)}
          onClick={handleClick}
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flex: 1,
            px: 1,
            width: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            py: 0.75,
            cursor: "pointer",
            textDecoration: "none",
            color: "inherit",
            "&:focus": {
              outline: "2px solid",
              outlineColor: "primary.main",
              outlineOffset: "-2px",
              borderRadius: 1,
            },
          }}
          tabIndex={0}
        >
          {/* Entity Icon */}
          <Box
            sx={{
              position: "relative",
              display: "flex",
              width: 24,
              height: 24,
              alignItems: "center",
              justifyContent: "center",
              flex: "0 0 24px",
            }}
            title={showStatusIndicator ? status : undefined}
            aria-label={
              showStatusIndicator ? `${node.name} status ${status}` : undefined
            }
          >
            <EntityIcon
              entityType={getNodeIconType(node)}
              workItemIcon={node.workItemIcon}
              size={24}
            />
            {planStatusDotColor && (
              <Box
                aria-hidden="true"
                sx={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  bgcolor: planStatusDotColor,
                  border: `1.5px solid ${theme.palette.background.paper}`,
                  boxSizing: "border-box",
                }}
              />
            )}
          </Box>

          {/* Entity Name */}
          <Typography
            variant="body2"
            sx={{
              flexGrow: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.875rem",
            }}
          >
            {node.name}
          </Typography>

          {/* Child Count Badge */}
          {node.hasChildren &&
            node.childCount !== undefined &&
            node.childCount > 0 && (
              <Chip
                label={node.childCount}
                size="small"
                sx={{
                  height: 20,
                  minWidth: 20,
                  fontSize: "0.7rem",
                  bgcolor: "action.selected",
                  flexShrink: 0,
                  "& .MuiChip-label": {
                    px: 0.5,
                  },
                }}
              />
            )}
        </Box>
      </Box>
    </Box>
  );

  if (targetEntityType) {
    return (
      <Box
        sx={{
          "& [data-testid='interaction-indicator']": {
            bottom: "-4px",
            left: `${indent + 33}px`,
            top: "auto",
            right: "auto",
          },
        }}
      >
        <InteractionComponent
          entityId={node.id}
          entityType={targetEntityType}
          entitySubtype={
            node.workItemTypeKey ??
            (node.type === "feature"
              ? "FEATURE"
              : node.type === "goal"
                ? "GOAL"
                : node.type === "plan"
                  ? "PLAN"
                  : undefined)
          }
          hasProposalSupport
          organizationId={organizationId}
          projectId={projectId}
          entityTitle={node.name}
          size={interactionSize}
          guidableSurface="explorer-row"
        >
          {nodeContent}
        </InteractionComponent>
      </Box>
    );
  }

  return nodeContent;
};

import React, { useCallback } from "react";
import { Box, Tooltip, Typography, IconButton } from "@mui/material";
import ExpandIcon from "@mui/icons-material/ChevronRight";
import CollapseIcon from "@mui/icons-material/ExpandMore";
import {
  useDraggable,
  useDroppable,
  useDndContext as useCoreDndContext,
} from "@dnd-kit/core";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { FeatureTagDot } from "./FeatureTagDot";

export interface FeatureTreeNodeProps {
  feature: WorkItemResponseDto;
  isHighlighted?: boolean;
  isActive?: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
  taskCount: number;
  onToggleCollapse: () => void;
  onClick: (featureId: string, event: React.MouseEvent) => void;
  href: string;
  descendantsOfActive: Set<string>;
  errorMessage?: string;
  onClearError?: () => void;
  onReparentDrop: (draggedFeatureId: string, targetFeatureId: string) => void;
}

interface ReparentDragData {
  type: "feature-reparent";
  featureId: string;
  sourceId: string;
  previewLabel: string;
}

interface ReparentDropData {
  type: "feature-reparent";
  targetFeatureId: string;
  onDrop: (event: { sourceId: string }) => void;
}

export const FeatureTreeNode: React.FC<FeatureTreeNodeProps> = ({
  feature,
  isHighlighted,
  isActive,
  hasChildren,
  isCollapsed,
  taskCount,
  onToggleCollapse,
  onClick,
  href,
  descendantsOfActive,
  errorMessage,
  onClearError,
  onReparentDrop,
}) => {
  const { active } = useCoreDndContext();
  const activeData = active?.data.current as
    | Partial<ReparentDragData>
    | undefined;
  const isFeatureReparentDrag = activeData?.type === "feature-reparent";
  const activeFeatureId = isFeatureReparentDrag
    ? activeData?.featureId ?? null
    : null;

  const isSelf = activeFeatureId === feature.id;
  const isDescendant = descendantsOfActive.has(feature.id);
  const isInvalidTarget = isFeatureReparentDrag && (isSelf || isDescendant);

  const dragData: ReparentDragData = {
    type: "feature-reparent",
    featureId: feature.id,
    sourceId: feature.id,
    previewLabel: feature.name,
  };

  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: `feature-tree-drag-${feature.id}`,
    data: dragData,
  });

  const handleDrop = useCallback(
    ({ sourceId }: { sourceId: string }) => {
      onReparentDrop(sourceId, feature.id);
    },
    [onReparentDrop, feature.id]
  );

  const dropData: ReparentDropData = {
    type: "feature-reparent",
    targetFeatureId: feature.id,
    onDrop: handleDrop,
  };

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `feature-tree-drop-${feature.id}`,
    disabled: !isFeatureReparentDrag || isInvalidTarget,
    data: dropData,
  });

  const setRefs = useCallback(
    (el: HTMLAnchorElement | null) => {
      setDragRef(el);
      setDropRef(el);
    },
    [setDragRef, setDropRef]
  );

  const isValidHover = isOver && !isInvalidTarget;
  const hasError = !!errorMessage;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>) => {
      if (hasError) onClearError?.();
      onClick(feature.id, e);
    },
    [hasError, onClearError, onClick, feature.id]
  );

  const handlePointerLeave = useCallback(() => {
    if (hasError) onClearError?.();
  }, [hasError, onClearError]);

  const card = (
    <Box
      component="a"
      ref={setRefs}
      href={href}
      onClick={handleClick}
      onPointerLeave={handlePointerLeave}
      {...attributes}
      {...listeners}
      sx={{
        width: 220,
        pl: "24px",
        pr: 1.5,
        py: 1,
        backgroundColor: isActive ? "heyhey.main" : "background.paper",
        border: 2,
        borderColor: hasError
          ? "error.main"
          : isValidHover
          ? "primary.main"
          : isActive
          ? "heyhey.dark"
          : isHighlighted
          ? "primary.main"
          : "divider",
        borderRadius: 1,
        cursor: isInvalidTarget ? "not-allowed" : "pointer",
        boxShadow: hasError
          ? 3
          : isValidHover
          ? 4
          : isActive
          ? 4
          : isHighlighted
          ? 3
          : 1,
        transition: "all 0.15s ease",
        display: "flex",
        alignItems: "center",
        gap: 0.5,
        textDecoration: "none",
        color: isActive ? "heyhey.contrastText" : "inherit",
        opacity: isDragging ? 0.5 : isInvalidTarget ? 0.4 : 1,
        userSelect: "none",
        "&:hover": {
          boxShadow: isInvalidTarget ? 1 : isActive ? 5 : 4,
          borderColor: hasError
            ? "error.main"
            : isInvalidTarget
            ? "divider"
            : isActive
            ? "heyhey.light"
            : "primary.light",
        },
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography
          variant="body2"
          sx={{
            fontWeight: isActive ? 600 : 500,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            mb: 0.5,
          }}
        >
          {feature.name}
        </Typography>

        <Box
          sx={{ display: "flex", alignItems: "center", gap: 0.75, minWidth: 0 }}
        >
          <FeatureTagDot tag={feature.tag ?? null} emphasized={isActive} />
          {taskCount > 0 && (
            <Typography
              variant="caption"
              sx={{
                color: isActive ? "heyhey.contrastText" : "text.secondary",
                opacity: isActive ? 0.85 : 1,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {taskCount} {taskCount === 1 ? "task" : "tasks"}
            </Typography>
          )}
        </Box>
      </Box>

      {hasChildren && (
        <IconButton
          size="small"
          onClick={(e) => {
            e.stopPropagation();
            e.preventDefault();
            onToggleCollapse();
          }}
          sx={{ p: 0.25, flexShrink: 0 }}
        >
          {isCollapsed ? (
            <ExpandIcon fontSize="small" />
          ) : (
            <CollapseIcon fontSize="small" />
          )}
        </IconButton>
      )}
    </Box>
  );

  if (hasError) {
    return (
      <Tooltip
        title={errorMessage}
        open
        arrow
        placement="top"
        slotProps={{
          tooltip: { sx: { bgcolor: "error.main" } },
          arrow: { sx: { color: "error.main" } },
        }}
      >
        {card}
      </Tooltip>
    );
  }

  return card;
};

import type { DragEndEvent, UniqueIdentifier } from "@dnd-kit/core";
import {
  closestCenter,
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import AddIcon from "@mui/icons-material/Add";
import CheckIcon from "@mui/icons-material/Check";
import CloseIcon from "@mui/icons-material/Close";
import DragIndicatorIcon from "@mui/icons-material/DragIndicator";
import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import React, { useState } from "react";
import { EntityIcon, EntityLinkWithPreview } from "./Entity";
import { getEntityColors } from "../utils/entityIcons";

type SelectableListStatus = "accept" | "reject" | "pending";

export interface SelectableEntityListItem {
  id: string;
  overline?: string;
  title: string;
  badgeLabel?: string;
  badgeColor?: "default" | "primary" | "secondary" | "success" | "warning";
  description?: string;
  entityType?: string;
  notes?: string;
  overlapNotes?: string;
  meta?: string;
  status?: SelectableListStatus;
  comment?: string;
  link?: SelectableEntityLink;
  detailContent?: React.ReactNode;
  readOnly?: boolean;
  showRejectAction?: boolean;
  cornerRibbonLabel?: string;
}

interface SelectableEntityLink {
  entityId: string;
  entityType: string;
  organizationId: string;
  projectId?: string;
  href?: string;
}

interface SelectableEntityListStatusColors {
  accept?: string;
  reject?: string;
  pending?: string;
}

export interface SelectableEntityListProps {
  items: SelectableEntityListItem[];
  emptyMessage?: string;
  showActions?: boolean;
  editable?: boolean;
  reorderable?: boolean;
  showBackground?: boolean;
  showBorder?: boolean;
  disabled?: boolean;
  variant?: "list" | "timeline";
  addItemTypes?: string[];
  showEntityTypeChip?: boolean;
  entityIconPosition?: "inline" | "outside" | "hidden";
  titleFontSize?: string | number;
  statusBackgroundColors?: SelectableEntityListStatusColors;
  onAccept?: (id: string) => void;
  onReject?: (id: string) => void;
  onCommentChange?: (id: string, comment: string) => void;
  onTitleChange?: (id: string, title: string) => void;
  onDescriptionChange?: (id: string, description: string) => void;
  onReorder?: (orderedIds: string[]) => void;
  onAddItem?: (type: string) => void;
}

const getBackgroundColor = (
  status?: SelectableListStatus,
  overrides?: SelectableEntityListStatusColors,
): string => {
  switch (status) {
    case "accept":
      return overrides?.accept ?? "success.light";
    case "reject":
      // Default to same as pending - rejection is shown via opacity instead
      return overrides?.reject ?? overrides?.pending ?? "background.paper";
    default:
      return overrides?.pending ?? "background.paper";
  }
};

interface SortableItemWrapperProps {
  item: SelectableEntityListItem;
  index: number;
  disabled: boolean;
  renderListItem: (
    item: SelectableEntityListItem,
    itemIndex: number,
    dragHandle?: React.ReactNode,
    style?: React.CSSProperties,
  ) => React.ReactNode;
}

const SortableItemWrapper: React.FC<SortableItemWrapperProps> = ({
  item,
  index,
  disabled,
  renderListItem,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: item.id,
    disabled: disabled,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.7 : 1,
  };
  const handle = (
    <IconButton
      {...attributes}
      {...listeners}
      size="small"
      disabled={disabled}
      sx={{
        mr: 1,
        alignSelf: "center",
        cursor: disabled ? "default" : "grab",
        color: "text.secondary",
      }}
    >
      <DragIndicatorIcon fontSize="small" />
    </IconButton>
  );
  return (
    <Box ref={setNodeRef}>{renderListItem(item, index, handle, style)}</Box>
  );
};

export const SelectableEntityList: React.FC<SelectableEntityListProps> = ({
  items,
  emptyMessage = "No items available.",
  showActions = false,
  editable = false,
  reorderable = false,
  showBackground = true,
  showBorder = false,
  disabled = false,
  variant = "list",
  addItemTypes,
  showEntityTypeChip = true,
  entityIconPosition = "outside",
  titleFontSize,
  statusBackgroundColors,
  onAccept,
  onReject,
  onCommentChange,
  onTitleChange,
  onDescriptionChange,
  onReorder,
  onAddItem,
}) => {
  const [openCommentIds, setOpenCommentIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [addMenuAnchor, setAddMenuAnchor] = useState<HTMLElement | null>(null);
  const sensors = useSensors(useSensor(PointerSensor));
  const listItemPadding = 0.5;
  const listItemGap = 0.75;
  const isTimeline = variant === "timeline";
  const timelineGutter = 52;
  const getTitleFieldSx = (canEdit: boolean) => ({
    "& .MuiInputBase-input": {
      fontWeight: 600,
      fontSize: "0.9rem",
      cursor: canEdit ? "text" : "default",
    },
    position: "relative",
    "&:hover::after": canEdit
      ? {
          content: '"✎"',
          position: "absolute",
          right: 4,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: "0.875rem",
          color: "text.secondary",
          pointerEvents: "none",
        }
      : {},
    "&:hover": canEdit
      ? {
          backgroundColor: "action.hover",
          borderRadius: 0.5,
        }
      : {},
    pointerEvents: canEdit ? ("auto" as const) : ("none" as const),
  });
  const getBodyFieldSx = (canEdit: boolean) => ({
    "& .MuiInputBase-input": {
      fontSize: "0.8rem",
      color: "text.secondary",
      cursor: canEdit ? "text" : "default",
    },
    position: "relative",
    "&:hover::after": canEdit
      ? {
          content: '"✎"',
          position: "absolute",
          right: 4,
          top: 8,
          fontSize: "0.75rem",
          color: "text.secondary",
          pointerEvents: "none",
        }
      : {},
    "&:hover": canEdit
      ? {
          backgroundColor: "action.hover",
          borderRadius: 0.5,
        }
      : {},
    pointerEvents: canEdit ? ("auto" as const) : ("none" as const),
  });

  const handleToggleComment = (id: string) => {
    setOpenCommentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    if (!reorderable || !onReorder) {
      return;
    }
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = items.findIndex((item) => item.id === active.id);
    const newIndex = items.findIndex((item) => item.id === over.id);
    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    const reordered = arrayMove(items, oldIndex, newIndex);
    onReorder(reordered.map((item) => item.id));
  };

  const renderListItem = (
    item: SelectableEntityListItem,
    itemIndex: number,
    dragHandle?: React.ReactNode,
    style?: React.CSSProperties,
  ) => {
    const isCommentOpen = openCommentIds.has(item.id);
    const hasComment = Boolean(item.comment?.trim());
    const prefixLabel = item.overline;
    const isItemLocked = disabled || item.readOnly === true;
    const canEdit = editable && !isItemLocked;
    const showRejectAction = item.showRejectAction ?? true;
    const isFirstItem = itemIndex === 0;
    const isLastItem = itemIndex === items.length - 1;
    const titleContent = canEdit ? (
      <TextField
        size="small"
        placeholder="Title"
        value={item.title}
        onChange={(event) => onTitleChange?.(item.id, event.target.value)}
        disabled={isItemLocked}
        variant="standard"
        InputProps={{
          disableUnderline: true,
        }}
        inputProps={{
          "aria-label": "Title",
          "aria-disabled": !canEdit,
          tabIndex: canEdit ? 0 : -1,
        }}
        sx={{
          flex: 1,
          minWidth: 0,
          ...getTitleFieldSx(canEdit),
        }}
      />
    ) : item.link ? (
      <EntityLinkWithPreview
        label={item.title}
        entityId={item.link.entityId}
        entityType={item.link.entityType}
        organizationId={item.link.organizationId}
        projectId={item.link.projectId}
        href={item.link.href}
        sx={{ flex: 1, minWidth: 0 }}
      />
    ) : (
      <Typography
        sx={{
          fontWeight: 600,
          fontSize: titleFontSize ?? "0.9rem",
          minWidth: 0,
        }}
      >
        {item.title}
      </Typography>
    );

    return (
      <ListItem
        key={item.id}
        sx={{
          width: "100%",
          maxWidth: "100%",
          boxSizing: "border-box",
          px: 1,
          py: listItemPadding,
          borderRadius: 1,
          mb: listItemGap,
          alignItems: "flex-start",
          position: "relative",
          border: showBorder ? "1px solid" : "none",
          borderColor: showBorder ? "divider" : "transparent",
          backgroundColor: showBackground
            ? getBackgroundColor(item.status, statusBackgroundColors)
            : "transparent",
          opacity: item.status === "reject" ? 0.6 : 1,
          overflow: "visible",
          "& .MuiListItemText-root": {
            m: 0,
            minWidth: 0,
            flex: 1,
          },
          ...(isTimeline && {
            ml: `${timelineGutter}px`,
            width: `calc(100% - ${timelineGutter}px)`,
            "&::before": {
              content: '""',
              position: "absolute",
              left: -30,
              top: isFirstItem ? "50%" : -listItemGap * 8,
              bottom: isLastItem ? "50%" : -listItemGap * 8,
              width: 2,
              backgroundColor: "divider",
            },
          }),
        }}
        style={style}
      >
        {isTimeline && (
          <Box
            sx={{
              position: "absolute",
              left: -44,
              top: "50%",
              transform: "translateY(-50%)",
              width: 28,
              height: 28,
              borderRadius: "50%",
              backgroundColor: "grey.200",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 600,
              fontSize: "0.875rem",
              zIndex: 1,
            }}
          >
            {itemIndex + 1}
          </Box>
        )}
        {dragHandle}
        <ListItemText
          primary={
            <Box
              sx={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 1,
                minWidth: 0,
              }}
            >
              {item.entityType && entityIconPosition === "inline" && (
                <EntityIcon entityType={item.entityType} size={24} />
              )}
              {item.entityType &&
                showEntityTypeChip &&
                (() => {
                  const colors = getEntityColors(item.entityType);
                  return (
                    <Chip
                      label={item.entityType.replace("_", " ")}
                      size="small"
                      sx={{
                        height: 20,
                        fontSize: "0.65rem",
                        fontWeight: 500,
                        backgroundColor: colors.background,
                        color: colors.color,
                        flexShrink: 0,
                        "& .MuiChip-label": {
                          px: 1,
                        },
                      }}
                    />
                  );
                })()}
              {titleContent}
              {item.badgeLabel && (
                <Chip
                  label={item.badgeLabel}
                  size="small"
                  data-testid="badge"
                  color={item.badgeColor}
                  variant={item.badgeColor ? "filled" : "outlined"}
                  sx={{ height: 20, flexShrink: 0 }}
                />
              )}
              {item.entityType &&
                !isTimeline &&
                entityIconPosition === "outside" && (
                  <Box sx={{ position: "absolute", top: 5, left: -35 }}>
                    <EntityIcon entityType={item.entityType} size={24} />
                  </Box>
                )}
            </Box>
          }
          secondary={
            <Box sx={{ position: "relative" }}>
              <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                {(canEdit || item.description) && (
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Add description"
                    value={item.description ?? ""}
                    onChange={(event) =>
                      onDescriptionChange?.(item.id, event.target.value)
                    }
                    disabled={isItemLocked}
                    multiline
                    minRows={1}
                    maxRows={3}
                    variant="standard"
                    InputProps={{
                      disableUnderline: true,
                    }}
                    inputProps={{
                      "aria-label": "Description",
                      "aria-disabled": !canEdit,
                      tabIndex: canEdit ? 0 : -1,
                    }}
                    sx={{
                      minWidth: 0,
                      ...getBodyFieldSx(canEdit),
                    }}
                  />
                )}
                {item.notes && (
                  <Typography variant="caption" color="text.secondary">
                    {item.notes}
                  </Typography>
                )}
                {item.overlapNotes && (
                  <Typography variant="caption" color="text.secondary">
                    {item.overlapNotes}
                  </Typography>
                )}
                {item.meta && (
                  <Typography variant="caption" color="text.secondary">
                    {item.meta}
                  </Typography>
                )}
                {canEdit && onCommentChange ? (
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Add feedback..."
                    value={item.comment ?? ""}
                    onChange={(event) =>
                      onCommentChange(item.id, event.target.value)
                    }
                    disabled={isItemLocked}
                    multiline
                    minRows={1}
                    maxRows={3}
                    variant="standard"
                    inputProps={{
                      "aria-label": "Comment",
                      tabIndex: 0,
                    }}
                    sx={{ minWidth: 0 }}
                  />
                ) : (
                  <>
                    {hasComment && !isCommentOpen && (
                      <Typography variant="caption" color="text.secondary">
                        Comment: {item.comment}
                      </Typography>
                    )}
                    {showActions && (
                      <Box>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => handleToggleComment(item.id)}
                          disabled={isItemLocked}
                          sx={{ textTransform: "none", p: 0, minWidth: "auto" }}
                        >
                          {hasComment ? "Edit comment" : "Add comment"}
                        </Button>
                      </Box>
                    )}
                    {showActions && isCommentOpen && (
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="flex-start"
                      >
                        <TextField
                          size="small"
                          fullWidth
                          placeholder="Add a comment..."
                          value={item.comment ?? ""}
                          onChange={(event) =>
                            onCommentChange?.(item.id, event.target.value)
                          }
                          disabled={isItemLocked}
                          variant="standard"
                        />
                        <IconButton
                          size="small"
                          onClick={() => handleToggleComment(item.id)}
                          disabled={isItemLocked}
                          sx={{ mt: 0.5 }}
                        >
                          <CloseIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Stack>
                    )}
                  </>
                )}
                {item.detailContent && (
                  <Box sx={{ mt: 1 }}>{item.detailContent}</Box>
                )}
              </Stack>
            </Box>
          }
        />
        {prefixLabel && !isTimeline && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{
              position: "absolute",
              left: -18,
              top: 6,
              fontSize: "0.9rem",
              fontWeight: "bold",
              color: "heyhey.main",
            }}
          >
            {prefixLabel}
          </Typography>
        )}
        {item.cornerRibbonLabel && (
          <Box
            data-testid={`corner-ribbon-${item.id}`}
            sx={{
              position: "absolute",
              top: 10,
              left: -12,
              width: 64,
              py: 0.25,
              textAlign: "center",
              transform: "rotate(-45deg)",
              transformOrigin: "center",
              backgroundColor: "success.main",
              color: "common.white",
              fontSize: "0.6rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {item.cornerRibbonLabel}
          </Box>
        )}
        {(showActions || (onAccept && onReject)) && (
          <Box sx={{ flexShrink: 0 }}>
            <Stack direction="row" spacing={0.5}>
              {onAccept && (
                <IconButton
                  size="small"
                  onClick={() => onAccept(item.id)}
                  disabled={isItemLocked}
                  sx={{
                    width: 28,
                    height: 28,
                    bgcolor:
                      item.status === "accept" ? "success.main" : "success.50",
                    color: item.status === "accept" ? "white" : "success.main",
                    border: 1,
                    borderColor: "success.main",
                    "&:hover": {
                      bgcolor:
                        item.status === "accept"
                          ? "success.dark"
                          : "success.100",
                    },
                    "&.Mui-disabled": {
                      opacity: 1,
                      bgcolor:
                        item.status === "accept"
                          ? "success.main"
                          : "success.50",
                      color:
                        item.status === "accept" ? "white" : "success.main",
                      borderColor: "success.main",
                    },
                  }}
                >
                  <CheckIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
              {onReject && showRejectAction && (
                <IconButton
                  size="small"
                  onClick={() => onReject(item.id)}
                  disabled={isItemLocked}
                  sx={{
                    width: 28,
                    height: 28,
                    bgcolor:
                      item.status === "reject" ? "error.main" : "error.50",
                    color: item.status === "reject" ? "white" : "error.main",
                    border: 1,
                    borderColor: "error.main",
                    "&:hover": {
                      bgcolor:
                        item.status === "reject" ? "error.dark" : "error.100",
                    },
                    "&.Mui-disabled": {
                      opacity: 1,
                      bgcolor:
                        item.status === "reject" ? "error.main" : "error.50",
                      color: item.status === "reject" ? "white" : "error.main",
                      borderColor: "error.main",
                    },
                  }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              )}
            </Stack>
          </Box>
        )}
      </ListItem>
    );
  };

  const renderAddButton = () => {
    if (!addItemTypes || !onAddItem) {
      return null;
    }

    return (
      <>
        <Box
          sx={{
            ...(isTimeline && {
              ml: 5,
            }),
          }}
        >
          <Button
            variant="text"
            size="small"
            startIcon={<AddIcon />}
            onClick={(event) => setAddMenuAnchor(event.currentTarget)}
            sx={{
              textTransform: "none",
              color: "text.secondary",
            }}
          >
            Add step
          </Button>
        </Box>
        <Menu
          anchorEl={addMenuAnchor}
          open={Boolean(addMenuAnchor)}
          onClose={() => setAddMenuAnchor(null)}
        >
          {addItemTypes.map((type) => (
            <MenuItem
              key={type}
              onClick={() => {
                onAddItem(type);
                setAddMenuAnchor(null);
              }}
            >
              {type}
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  };

  if (items.length === 0) {
    return (
      <>
        <Typography variant="body2" color="text.secondary">
          {emptyMessage}
        </Typography>
        {renderAddButton()}
      </>
    );
  }

  if (!reorderable) {
    return (
      <>
        <List sx={{ py: 0, overflow: "visible", width: "100%" }}>
          {items.map((item, index) => renderListItem(item, index))}
        </List>
        {renderAddButton()}
      </>
    );
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={items.map((item) => item.id as UniqueIdentifier)}
          strategy={verticalListSortingStrategy}
        >
          <List sx={{ py: 0, overflow: "visible", width: "100%" }}>
            {items.map((item, index) => (
              <SortableItemWrapper
                key={item.id}
                item={item}
                index={index}
                disabled={disabled || item.readOnly === true}
                renderListItem={renderListItem}
              />
            ))}
          </List>
        </SortableContext>
      </DndContext>
      {renderAddButton()}
    </>
  );
};

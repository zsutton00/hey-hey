import { useMemo } from "react";
import {
  Box,
  Chip,
  IconButton,
  ListItemButton,
  ListItemText,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha, useTheme } from "@mui/material/styles";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import pluralize from "pluralize";
import capitalize from "lodash/capitalize.js";
import {
  EntityType,
  type DesignDocLibraryNodeDto,
  type DesignDocLibraryNodeType,
} from "../../api";
import { EntityIcon } from "../Entity/EntityIcon";
import { getStatusColorMapping } from "../../utils/statusUtils";

export interface LibraryListItemProps {
  node: DesignDocLibraryNodeDto;
  depth: number;
  isExpanded: boolean;
  isSelected: boolean;
  hasNestedChildren: boolean;
  isAutoExpanded: boolean;
  onToggle?: () => void;
  onClick?: (node: DesignDocLibraryNodeDto) => void;
}

const ENTITY_ICON_MAP: Record<DesignDocLibraryNodeType, EntityType> = {
  initiative: EntityType.Initiative,
  plan: EntityType.Task,
  task: EntityType.Task,
  "design-doc": EntityType.DesignDoc,
};

const CHILD_LABELS: Record<DesignDocLibraryNodeType, string> = {
  initiative: "initiative",
  plan: "plan",
  task: "task",
  "design-doc": "design doc",
};

const CHILD_TYPE_ORDER: DesignDocLibraryNodeType[] = [
  "initiative",
  "plan",
  "task",
  "design-doc",
];

const formatChildCountLabel = (
  type: DesignDocLibraryNodeType,
  count: number,
): string => {
  return capitalize(pluralize(CHILD_LABELS[type], count));
};

export function LibraryListItem({
  node,
  depth,
  isExpanded,
  isSelected,
  hasNestedChildren,
  isAutoExpanded,
  onToggle,
  onClick,
}: LibraryListItemProps) {
  const theme = useTheme();

  const childCounts = useMemo(() => {
    if (node.type === "design-doc" || node.children.length === 0) {
      return [];
    }

    const counts = new Map<DesignDocLibraryNodeType, number>();
    node.children.forEach((child) => {
      counts.set(child.type, (counts.get(child.type) ?? 0) + 1);
    });

    return CHILD_TYPE_ORDER.filter((type) => counts.has(type)).map((type) => ({
      type,
      count: counts.get(type) ?? 0,
    }));
  }, [node.children, node.type]);

  return (
    <ListItemButton
      onClick={() => onClick?.(node)}
      selected={isSelected}
      sx={{
        pl: 1 + depth * 2,
        py: 1,
        alignItems: "center",
        borderRadius: 0.75,
        mb: 0.5,
        border: "1px solid",
        borderColor: "divider",
        backgroundColor: "background.paper",
        transition: "border-color 0.2s ease, background-color 0.2s ease",
        "&:hover": {
          backgroundColor: "action.hover",
          borderColor: "text.secondary",
        },
        "&.Mui-selected": {
          backgroundColor: alpha(
            theme.palette.primary.main,
            theme.palette.mode === "dark" ? 0.2 : 0.08,
          ),
          borderColor: "primary.main",
        },
        "&.Mui-selected:hover": {
          backgroundColor: alpha(
            theme.palette.primary.main,
            theme.palette.mode === "dark" ? 0.28 : 0.12,
          ),
        },
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          minWidth: 32,
        }}
      >
        {hasNestedChildren ? (
          <IconButton
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onToggle?.();
            }}
            sx={{
              mr: 0.5,
              visibility: isAutoExpanded ? "hidden" : "visible",
            }}
            aria-label={isExpanded ? "Collapse section" : "Expand section"}
          >
            {isExpanded ? (
              <ExpandMoreIcon fontSize="small" />
            ) : (
              <ChevronRightIcon fontSize="small" />
            )}
          </IconButton>
        ) : (
          <Box sx={{ width: 32 }} />
        )}
      </Box>
      <EntityIcon
        entityType={ENTITY_ICON_MAP[node.type]}
        size={28}
        sx={{ mr: 1 }}
      />
      <Tooltip title={node.name} placement="top-start">
        <ListItemText
          primary={
            <Stack direction="row" spacing={1} alignItems="center">
              <Typography noWrap fontWeight={600}>
                {node.name}
              </Typography>
              {node.type === "design-doc" ? (
                <Chip
                  label={node.designDoc?.status ?? "Unknown"}
                  size="small"
                  variant="outlined"
                  color={getStatusColorMapping(
                    node.designDoc?.status ?? "Unknown",
                  )}
                />
              ) : null}
            </Stack>
          }
          secondary={
            node.type === "design-doc" ? (
              node.designDoc?.updatedAt ? (
                <Typography variant="caption" color="text.secondary" noWrap>
                  Updated {node.designDoc.updatedAt}
                </Typography>
              ) : undefined
            ) : childCounts.length > 0 ? (
              <Stack
                direction="row"
                spacing={2}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                mt={1}
              >
                {childCounts.map((childCount) => (
                  <Stack
                    key={childCount.type}
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                  >
                    <Box
                      sx={{
                        width: 20,
                        height: 20,
                        borderRadius: "8px",
                        border: `1px solid ${theme.palette.grey[400]}`,
                        backgroundColor: alpha(theme.palette.grey[400], 0.1),
                        color: theme.palette.text.primary,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontWeight: 700,
                        fontSize: "0.7rem",
                        flexShrink: 0,
                      }}
                    >
                      {childCount.count}
                    </Box>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontWeight: 500 }}
                    >
                      {formatChildCountLabel(childCount.type, childCount.count)}
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            ) : undefined
          }
        />
      </Tooltip>
    </ListItemButton>
  );
}

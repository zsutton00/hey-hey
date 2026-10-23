import React, { useRef } from "react";
import { Box, Button, Skeleton, Stack, Typography } from "@mui/material";
import AddIcon from "@mui/icons-material/Add";
import {
  EntityActionButton,
  type EntityActionVerb,
} from "../EntityActionButton";
import { motion } from "motion/react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import { KEYS } from "../../i18n/keys";
import type { WorkItemIconIdentity } from "../../utils/entityIcons";

/**
 * Props for EntityGrid component
 * @template T - The entity type being rendered
 */
export interface EntityGridProps<T> {
  /**
   * Array of items to render
   */
  items: T[];

  /**
   * Loading state - shows skeleton loaders when true
   */
  loading?: boolean;

  /**
   * Render function for each item
   */
  renderItem: (item: T) => React.ReactNode;

  /**
   * Function to extract unique key from item
   */
  keyExtractor: (item: T) => string;

  /**
   * Message to display when items array is empty
   */
  emptyMessage?: string;

  /**
   * Whether to show a create button in the empty state
   */
  showCreateButton?: boolean;

  /**
   * Callback when create button is clicked
   */
  onCreateItem?: () => void;

  /**
   * Create/start action rendered through the shared EntityActionButton.
   * Takes precedence over createButtonLabel.
   */
  createAction?: {
    verb: EntityActionVerb;
    noun: string;
    entityType: string;
    workItemIcon?: WorkItemIconIdentity;
  };

  /**
   * Free-text label for create buttons whose verb is not create/start
   */
  createButtonLabel?: string;

  /**
   * Expandable mode - if true, grid manages expansion state
   * @deprecated Use renderItem to handle expansion logic instead
   */
  expandable?: boolean;

  /**
   * Set of expanded item IDs (for expandable mode)
   * @deprecated Use renderItem to handle expansion logic instead
   */
  expandedIds?: Set<string>;

  /**
   * Callback when item expansion is toggled
   * @deprecated Use renderItem to handle expansion logic instead
   */
  onToggleExpand?: (id: string, expanded: boolean) => void;

  /**
   * Selectable mode - if true, grid shows selection checkboxes
   */
  selectable?: boolean;

  /**
   * Set of selected item IDs (for selectable mode)
   */
  selectedIds?: Set<string>;

  /**
   * Callback when selection changes
   */
  onSelectionChange?: (ids: Set<string>) => void;

  /**
   * Layout variant - list is the only supported variant currently
   * @future 'grid' will support card grid layout
   */
  variant?: "list" | "grid";

  /**
   * Spacing between items in pixels
   */
  spacing?: number;

  /**
   * Optional link generator for each item
   */
  linkForItem?: (item: T) => string | undefined;

  /**
   * Skeleton height in loading state
   */
  skeletonHeight?: number;
}

/**
 * Generic grid/list container for rendering entities
 *
 * Provides:
 * - Loading states with skeletons
 * - Empty states with optional create button
 * - Consistent spacing and layout
 * - Type-safe rendering with generic type parameter
 *
 * @template T - The entity type
 *
 * @example
 * ```typescript
 * <EntityGrid
 *   items={tasks}
 *   loading={isLoading}
 *   renderItem={(task) => (
 *     <TaskListItemExpandable task={task} {...props} />
 *   )}
 *   keyExtractor={(task) => task.id}
 *   emptyMessage="No tasks found"
 *   showCreateButton
 *   onCreateItem={handleCreateTask}
 * />
 * ```
 */
export function EntityGrid<T>({
  items,
  loading = false,
  renderItem,
  keyExtractor,
  emptyMessage,
  showCreateButton = false,
  onCreateItem,
  createAction,
  createButtonLabel,
  spacing = 0,
  variant = "list",
  linkForItem,
  skeletonHeight = 120,
}: EntityGridProps<T>): React.ReactElement {
  const { t } = useTranslation();

  // Track which items have been seen before (to only animate new ones)
  const seenIdsRef = useRef<Set<string>>(new Set());
  const isInitialMount = useRef(true);

  const itemsWithKeys = items.map((item) => ({
    item,
    key: keyExtractor(item),
  }));
  const isInitialRender = isInitialMount.current;

  if (isInitialRender) {
    itemsWithKeys.forEach(({ key }) => {
      seenIdsRef.current.add(key);
    });
    isInitialMount.current = false;
  }

  // Loading state
  if (loading) {
    return (
      <Stack spacing={spacing || 2.5}>
        {[1, 2, 3].map((index) => (
          <Skeleton
            key={index}
            variant="rectangular"
            height={skeletonHeight}
            sx={{ borderRadius: 0.5 }}
          />
        ))}
      </Stack>
    );
  }

  // Empty state
  if (items.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          py: 8,
          textAlign: "center",
        }}
      >
        <Typography variant="h6" color="text.secondary" sx={{ mb: 2 }}>
          {emptyMessage || t(KEYS.common.noItemsFound)}
        </Typography>
        {showCreateButton && onCreateItem && createAction && (
          <EntityActionButton
            variant="contained"
            verb={createAction.verb}
            noun={createAction.noun}
            entityType={createAction.entityType}
            workItemIcon={createAction.workItemIcon}
            onClick={onCreateItem}
          />
        )}
        {showCreateButton && onCreateItem && !createAction && (
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={onCreateItem}
          >
            {createButtonLabel || t(KEYS.common.create)}
          </Button>
        )}
      </Box>
    );
  }

  // Render items based on variant
  if (variant === "grid") {
    // Future: implement grid layout with cards
    // For now, fall through to list variant
  }

  // List variant (default)
  return (
    <Box>
      {itemsWithKeys.map(({ item, key: itemKey }) => {
        const isNewItem = !seenIdsRef.current.has(itemKey);
        const itemLink = linkForItem?.(item);

        // Mark item as seen for future renders
        if (!isInitialRender && isNewItem) {
          seenIdsRef.current.add(itemKey);
        }

        return (
          <Box
            key={itemKey}
            component={motion.div}
            initial={isNewItem ? { opacity: 0, y: -10 } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
          >
            {itemLink ? (
              <Box
                component={RouterLink}
                to={itemLink}
                sx={{
                  textDecoration: "none",
                  color: "inherit",
                  display: "block",
                }}
              >
                {renderItem(item)}
              </Box>
            ) : (
              renderItem(item)
            )}
          </Box>
        );
      })}
    </Box>
  );
}

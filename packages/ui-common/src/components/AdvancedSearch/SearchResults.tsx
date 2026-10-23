import React from "react";
import {
  Box,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Checkbox,
  Button,
  Chip,
  Typography,
  CircularProgress,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { EntityType } from "../../api";
import type { SearchEntity } from "./types";
import { EntityIcon } from "../Entity/EntityIcon";

/**
 * Props for SearchResults component
 */
export interface SearchResultsProps {
  /**
   * Search results to display
   */
  results: SearchEntity[];

  /**
   * Whether a search is currently loading
   */
  isLoading: boolean;

  /**
   * Enable multi-selection with checkboxes
   */
  allowMultiSelect: boolean;

  /**
   * Set of selected entity IDs
   */
  selectedIds: Set<string>;

  /**
   * Callback when selection changes
   */
  onSelectionChange: (
    id: string,
    event: React.MouseEvent,
    results: SearchEntity[]
  ) => void;

  /**
   * Callback when preview is requested
   */
  onPreview: (entity: SearchEntity) => void;

  /**
   * Callback when navigation is requested
   */
  onGoToEntity: (entity: SearchEntity) => void;

  /**
   * Whether to show similarity scores
   */
  showSimilarityScores?: boolean;

  /**
   * Custom empty-state text. Pass null to suppress the empty state entirely.
   */
  emptyStateText?: string | null;
}

/**
 * Entity types that have meaningful status values
 */
const ENTITY_TYPES_WITH_STATUS: string[] = [
  EntityType.Task,
  EntityType.Initiative,
  EntityType.DesignDoc,
  EntityType.Project,
];

/**
 * Check if entity type should display status
 */
const shouldShowStatus = (entityType: string): boolean => {
  return ENTITY_TYPES_WITH_STATUS.includes(entityType);
};

const formatEntityTypeLabel = (entityType: string): string => {
  return entityType
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

/**
 * Search results list component
 *
 * Displays search results with:
 * - Checkboxes (if multi-select enabled)
 * - Entity name and description
 * - Status chip (for applicable entity types)
 * - Preview button
 * - Similarity score (optional)
 */
export const SearchResults: React.FC<SearchResultsProps> = ({
  results,
  isLoading,
  allowMultiSelect,
  selectedIds,
  onSelectionChange,
  onPreview,
  onGoToEntity,
  showSimilarityScores = false,
  emptyStateText,
}) => {
  if (isLoading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          p: 4,
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (results.length === 0) {
    if (emptyStateText === null) {
      return null;
    }
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="body1" color="text.secondary">
          {emptyStateText ??
            "No results found. Try adjusting your search or filters."}
        </Typography>
      </Box>
    );
  }

  return (
    <List sx={{ width: "100%" }}>
      {results.map((entity) => {
        const isSelected = selectedIds.has(entity.id);

        return (
          <ListItem
            key={entity.id}
            disablePadding
            sx={{
              flexDirection: "column",
              alignItems: "stretch",
              borderBottom: 1,
              borderColor: "divider",
            }}
          >
            <ListItemButton
              selected={isSelected}
              onClick={(e) => onSelectionChange(entity.id, e, results)}
            >
              {allowMultiSelect && (
                <Checkbox
                  edge="start"
                  checked={isSelected}
                  tabIndex={-1}
                  disableRipple
                  sx={{ mr: 1 }}
                />
              )}

              <ListItemText
                primary={
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      flexWrap: "wrap",
                    }}
                  >
                    <EntityIcon entityType={entity.type} size={24} />

                    <Typography variant="body1" component="span">
                      {entity.name}
                    </Typography>

                    {entity.status && shouldShowStatus(entity.type) && (
                      <Chip
                        label={entity.status}
                        size="small"
                        variant="outlined"
                      />
                    )}

                    {showSimilarityScores &&
                      entity.similarity !== undefined && (
                        <Chip
                          label={`${entity.similarity.toFixed(2)}`}
                          size="small"
                          color="primary"
                          variant="outlined"
                        />
                      )}
                  </Box>
                }
                secondary={
                  entity.description && (
                    <Typography variant="body2" component="span">
                      {entity.description.length > 150
                        ? `${entity.description.slice(0, 150)}...`
                        : entity.description}
                    </Typography>
                  )
                }
              />
            </ListItemButton>

            <Box
              sx={{
                px: 2,
                pb: 2,
                pt: 1,
                display: "flex",
                gap: 1,
                flexWrap: "wrap",
              }}
            >
              <Button
                variant="text"
                size="small"
                startIcon={<VisibilityIcon />}
                onClick={(e) => {
                  e.stopPropagation();
                  onPreview(entity);
                }}
              >
                Show Preview
              </Button>
              <Button
                variant="text"
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  onGoToEntity(entity);
                }}
              >
                Go to {formatEntityTypeLabel(entity.type)}
              </Button>
            </Box>
          </ListItem>
        );
      })}
    </List>
  );
};

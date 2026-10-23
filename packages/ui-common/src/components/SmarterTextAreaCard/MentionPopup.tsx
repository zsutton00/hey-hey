import React, { useEffect, useState, useRef, useContext } from "react";
import {
  Box,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  LinearProgress,
  Typography,
  useTheme,
  Button,
  IconButton,
  Tooltip,
  Select,
  MenuItem,
  Divider,
} from "@mui/material";
import VisibilityIcon from "@mui/icons-material/Visibility";
import { useTranslation } from "react-i18next";
import { useModalService } from "../../contexts/ModalService";
import { normalizeEntityType } from "../entityTypeUtils";
import { MentionEditorContext } from "./EditorContext";
import type { SearchEntity } from "./types";
import { EntityIcon } from "../Entity";
import { EntityHoverCard } from "./EntityHoverCard";
import {
  canSelectInlineSearchResults,
  INLINE_SEARCH_RESULTS_FRESHNESS,
  type InlineSearchResultsFreshness,
} from "./inlineSearchResults";

const MENTION_POPUP_WIDTH = 420;

const ENTITY_TYPE_LABELS: Record<string, string> = {
  task: "Task",
  workflow: "Workflow",
  feature: "Feature",
  initiative: "Initiative",
  design_doc: "Design Doc",
  conversation: "Conversation",
  message: "Message",
  service: "Service",
  project: "Project",
};

interface MentionPopupProps {
  query: string;
  results: SearchEntity[];
  commonMatches?: SearchEntity[];
  selectedTypeFilter: string;
  onTypeFilterChange: (type: string) => void;
  onSelectEntity: (entity: SearchEntity) => void;
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  isLoading?: boolean;
  resultsFreshness: InlineSearchResultsFreshness;
  entityTypes?: string[];
  maxHeight?: number;
}

export const MentionPopup: React.FC<MentionPopupProps> = ({
  query: _query,
  results,
  commonMatches = [],
  selectedTypeFilter,
  onTypeFilterChange,
  onSelectEntity,
  selectedIndex,
  onSelectedIndexChange,
  isLoading = false,
  resultsFreshness,
  entityTypes = [
    "task",
    "workflow",
    "initiative",
    "design_doc",
    "project",
    "service",
    "conversation",
  ],
  maxHeight = 500,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const modalService = useModalService();
  const editorContext = useContext(MentionEditorContext);
  const [hoverAnchor, setHoverAnchor] = useState<HTMLElement | null>(null);
  const [hoveredEntity, setHoveredEntity] = useState<SearchEntity | null>(null);
  const hoverTimeoutRef = useRef<number | null>(null);
  const resultRefs = useRef<Array<HTMLElement | null>>([]);
  const canSelectResults = canSelectInlineSearchResults(resultsFreshness);

  const handleEntityMouseEnter = (
    entity: SearchEntity,
    event: React.MouseEvent<HTMLElement>,
  ) => {
    const target = event.currentTarget;
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoverAnchor(target);
      setHoveredEntity(entity);
    }, 300);
  };

  const handleEntityMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setHoverAnchor(null);
    setHoveredEntity(null);
  };

  const handleAdvancedSearch = () => {
    if (!modalService) return;

    modalService.showAdvancedSearch({
      defaultEntityTypes: entityTypes,
      allowMultiSelect: true,
      onSelect: (entities: SearchEntity[]) => {
        entities.forEach((entity) => {
          onSelectEntity(entity);
        });
      },
    });
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    resultRefs.current = [];
  }, [results, commonMatches]);

  useEffect(() => {
    if (selectedIndex < 0) {
      return;
    }

    const selectedElement = resultRefs.current[selectedIndex];
    if (
      selectedElement &&
      typeof selectedElement.scrollIntoView === "function"
    ) {
      selectedElement.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, results, commonMatches]);

  const getEntityTypeLabel = (type: string): string => {
    const lowerType = type.toLowerCase();
    return ENTITY_TYPE_LABELS[lowerType] ?? type;
  };

  const renderRow = (
    entity: SearchEntity,
    globalIndex: number,
  ): React.ReactNode => {
    const isStaleWhileUpdating =
      resultsFreshness === INLINE_SEARCH_RESULTS_FRESHNESS.staleWhileUpdating;

    return (
      <ListItem
        key={`${entity.type}:${entity.id}:${globalIndex}`}
        disablePadding
        onMouseEnter={(e) => {
          handleEntityMouseEnter(entity, e);
          if (canSelectResults) {
            onSelectedIndexChange(globalIndex);
          }
        }}
        onMouseLeave={handleEntityMouseLeave}
        secondaryAction={
          <Tooltip title={t("showPreview", "Show Preview")}>
            <IconButton
              color="primary"
              edge="end"
              onClick={(e) => {
                e.stopPropagation();
                if (!modalService || !editorContext) {
                  return;
                }

                const normalizedType = normalizeEntityType(entity.type);
                if (!normalizedType) {
                  return;
                }

                modalService.showEntityDetails({
                  source: "lookup",
                  entityId: entity.id,
                  entityType: normalizedType,
                  organizationId: editorContext.organizationId,
                  projectId: editorContext.projectId,
                });
              }}
            >
              <VisibilityIcon />
            </IconButton>
          </Tooltip>
        }
      >
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            ml: 1,
            flexShrink: 0,
          }}
        >
          <EntityIcon entityType={entity.type} />
        </Box>
        <ListItemButton
          onMouseDown={(e) => {
            e.preventDefault();
          }}
          onClick={() => {
            if (canSelectResults) {
              onSelectEntity(entity);
            }
          }}
          data-testid="mention-result-row"
          data-entity-id={entity.id}
          data-result-freshness={resultsFreshness}
          aria-disabled={!canSelectResults}
          disabled={!canSelectResults}
          ref={(node) => {
            resultRefs.current[globalIndex] = node;
          }}
          selected={globalIndex === selectedIndex}
          sx={{
            pr: 7,
            "&.Mui-selected": {
              backgroundColor: "action.selected",
            },
            "&.Mui-selected:hover": {
              backgroundColor: "action.selected",
            },
            ...(isStaleWhileUpdating
              ? {
                  opacity: 0.56,
                  cursor: "default",
                }
              : {}),
          }}
        >
          <ListItemText
            primary={
              <Typography
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                  fontSize: 13,
                }}
              >
                {entity.name}
              </Typography>
            }
            secondary={getEntityTypeLabel(entity.type)}
            secondaryTypographyProps={{
              variant: "caption",
              color: "text.secondary",
            }}
          />
        </ListItemButton>
      </ListItem>
    );
  };

  const hasAnyRows = results.length > 0 || commonMatches.length > 0;

  return (
    <Paper
      data-testid="mention-popup"
      sx={{
        width: MENTION_POPUP_WIDTH,
        maxHeight,
        display: "flex",
        flexDirection: "column",
        boxShadow: 3,
        borderRadius: 1,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Select
          variant="outlined"
          value={selectedTypeFilter}
          onChange={(e) => onTypeFilterChange(e.target.value)}
          size="small"
          fullWidth
          data-testid="mention-type-filter"
          sx={{
            "& .MuiOutlinedInput-notchedOutline": {
              borderColor: theme.palette.divider,
            },
          }}
          renderValue={(value) => (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {value !== "all" && <EntityIcon entityType={value} size={18} />}
              <Typography variant="body2">
                {value === "all"
                  ? t("mentionPopup.allTypes", "All types")
                  : getEntityTypeLabel(value)}
              </Typography>
            </Box>
          )}
        >
          <MenuItem value="all">
            {t("mentionPopup.allTypes", "All types")}
          </MenuItem>
          {entityTypes.map((type) => (
            <MenuItem key={type} value={type}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <EntityIcon entityType={type} size={18} />
                {getEntityTypeLabel(type)}
              </Box>
            </MenuItem>
          ))}
        </Select>
      </Box>

      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isLoading && results.length > 0 && (
          <Box data-testid="mention-popup-updating" sx={{ px: 2, py: 1 }}>
            <LinearProgress
              aria-label={t("mentionPopup.updating", "Updating results")}
            />
          </Box>
        )}
        {isLoading && results.length === 0 ? (
          <Box
            data-testid="mention-popup-loading"
            sx={{
              px: 2,
              py: 1,
            }}
          >
            <LinearProgress
              aria-label={t("mentionPopup.loading", "Loading results")}
            />
          </Box>
        ) : (
          results.length > 0 && (
            <List disablePadding>
              {results.map((entity, index) => renderRow(entity, index))}
            </List>
          )
        )}
        {commonMatches.length > 0 && (
          <Box data-testid="mention-common-matches">
            {(results.length > 0 || isLoading) && <Divider />}
            <Typography
              variant="caption"
              sx={{
                px: 2,
                py: 0.5,
                display: "block",
                color: "text.secondary",
                textTransform: "uppercase",
                letterSpacing: 0.5,
                fontWeight: 600,
              }}
            >
              {t("mentionPopup.frequentlyUsed", "Frequently used")}
            </Typography>
            <List disablePadding>
              {commonMatches.map((entity, index) =>
                renderRow(entity, results.length + index),
              )}
            </List>
          </Box>
        )}
        {!isLoading && !hasAnyRows && (
          <Box sx={{ p: 2 }}>
            <Typography variant="body2" color="textSecondary" align="center">
              {t("common.noMatches", { defaultValue: "No matches found" })}
            </Typography>
          </Box>
        )}
      </Box>

      <Box sx={{ p: 2, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Button
          fullWidth
          variant="outlined"
          size="small"
          onClick={handleAdvancedSearch}
          disabled={!modalService}
        >
          Advanced Search
        </Button>
      </Box>

      {editorContext && hoverAnchor && hoveredEntity && (
        <EntityHoverCard
          entityId={hoveredEntity.id}
          entityType={hoveredEntity.type}
          organizationId={editorContext.organizationId}
          projectId={editorContext.projectId}
          anchorEl={hoverAnchor}
          onPopoverMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onPopoverMouseLeave={handleEntityMouseLeave}
        />
      )}
    </Paper>
  );
};

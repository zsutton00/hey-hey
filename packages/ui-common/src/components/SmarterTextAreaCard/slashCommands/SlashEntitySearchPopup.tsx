import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Box,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Paper,
  Button,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import { EntityIcon } from "../../Entity";
import type { EntitySearchScope, SearchEntity } from "../types";
import { entityContextKeys } from "../../../data/collections/entityContext";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../mentionQuery";
import {
  canSelectInlineSearchResults,
  createInlineSearchRequestId,
  INLINE_SEARCH_RESULTS_FRESHNESS,
  isInlineSearchRequestIdCurrent,
  type InlineSearchResultsFreshness,
} from "../inlineSearchResults";
import {
  readCachedFocalContext,
  normalizeCachedFocalContextOptions,
} from "./cachedFocalContextOptions";
import {
  NO_CACHED_CONVERSATION_MENTION_OPTIONS,
  NO_SLASH_FOCAL_ENTITY,
  type SlashFocalEntityState,
} from "./types";

const SLASH_ENTITY_SEARCH_POPUP_WIDTH = 420;

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

const getEntityTypeLabel = (type: string): string =>
  ENTITY_TYPE_LABELS[type.toLowerCase()] ?? type;

const RELATED_ENTITY_TYPE_LABELS: Record<string, string> = {
  STANDARD: "tasks",
  FEATURE: "features",
  BUG: "bugs",
  GOAL: "goals",
  CONTRACT: "contracts",
  WORKFLOW: "workflows",
  TASK: "tasks",
  DESIGN_DOC: "design docs",
  PLAN: "plans",
  SERVICE: "services",
  INITIATIVE: "initiatives",
  PROJECT: "projects",
  CONVERSATION: "conversations",
  MESSAGE: "messages",
};

const getRequestedTypes = (searchScope: EntitySearchScope): string[] =>
  searchScope.kind === "entity-types"
    ? searchScope.entityTypes
    : searchScope.taskTypes;

const getRelatedEntitiesLabel = (searchScope: EntitySearchScope): string => {
  const requestedTypes = getRequestedTypes(searchScope);
  if (requestedTypes.length !== 1) return "Related entities";
  const normalizedType = requestedTypes[0].trim().toUpperCase();
  const knownLabel = RELATED_ENTITY_TYPE_LABELS[normalizedType];
  if (knownLabel) return `Related ${knownLabel}`;

  const humanizedType = normalizedType.toLowerCase().replace(/_/g, " ");
  return `Related ${humanizedType}s`;
};

interface SlashEntitySearchPopupProps {
  query: string;
  onSearchEntities: (
    query: string,
    searchScope: EntitySearchScope,
  ) => Promise<SearchEntity[]>;
  searchScope: EntitySearchScope;
  organizationId?: string | null;
  projectId?: string | null;
  focalEntity?: SlashFocalEntityState;
  cachedConversationMentionOptions: readonly SearchEntity[];
  selectedIndex: number;
  onSelectedIndexChange: (index: number) => void;
  onSelectEntity: (entity: SearchEntity) => void;
  onViewAll?: () => void;
  isViewAllSelected?: boolean;
  onViewAllAvailabilityChange?: (available: boolean) => void;
  onResultsChange?: (
    results: SearchEntity[],
    freshness: InlineSearchResultsFreshness,
  ) => void;
  maxHeight?: number;
}

export const SlashEntitySearchPopup: React.FC<SlashEntitySearchPopupProps> = ({
  query,
  onSearchEntities,
  searchScope,
  organizationId = null,
  projectId = null,
  focalEntity = NO_SLASH_FOCAL_ENTITY,
  cachedConversationMentionOptions = NO_CACHED_CONVERSATION_MENTION_OPTIONS,
  selectedIndex,
  onSelectedIndexChange,
  onSelectEntity,
  onViewAll,
  isViewAllSelected = false,
  onViewAllAvailabilityChange,
  onResultsChange,
  maxHeight = 500,
}) => {
  const { t } = useTranslation();
  const [results, setResults] = useState<SearchEntity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const queryClient = useQueryClient();
  const cachedContext = useSyncExternalStore(
    (onChange) =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.query.queryKey[0] === entityContextKeys.root()[0]) onChange();
      }),
    () =>
      readCachedFocalContext(
        queryClient,
        organizationId,
        projectId,
        focalEntity,
      ),
    () => null,
  );
  const resultRefs = useRef<Array<HTMLElement | null>>([]);
  const resultsRef = useRef<SearchEntity[]>([]);
  const onResultsChangeRef = useRef(onResultsChange);
  const latestSearchRequestIdRef = useRef(createInlineSearchRequestId(0));
  const hasQuery = query.trim().length > 0;
  const requestedTypes = getRequestedTypes(searchScope);
  const likelyOptions = useMemo(() => {
    const focalOptions = normalizeCachedFocalContextOptions(
      cachedContext,
      requestedTypes,
    );
    const compatibleConversationOptions =
      cachedConversationMentionOptions.filter(
        (entity) =>
          requestedTypes.length === 0 ||
          requestedTypes.some((requestedType) => {
            const normalizedRequest = requestedType.trim().toLowerCase();
            const normalizedEntityType = entity.type.trim().toLowerCase();
            return (
              normalizedEntityType === normalizedRequest ||
              (normalizedEntityType === "task" &&
                (normalizedRequest === "standard" ||
                  normalizedRequest === "task"))
            );
          }),
      );

    const deduplicatedOptions = new Map<string, SearchEntity>();
    for (const entity of [...focalOptions, ...compatibleConversationOptions]) {
      const key = `${entity.type}:${entity.id}`;
      if (!deduplicatedOptions.has(key)) {
        deduplicatedOptions.set(key, entity);
      }
    }
    return [...deduplicatedOptions.values()];
  }, [cachedConversationMentionOptions, cachedContext, requestedTypes]);
  const relatedEntitiesLabel = getRelatedEntitiesLabel(searchScope);
  const scopeKey = `${organizationId ?? ""}:${projectId ?? ""}:${
    focalEntity.kind === "entity"
      ? `${focalEntity.entityType}:${focalEntity.entityId}`
      : "none"
  }:${searchScope.kind}:${requestedTypes.join(",")}`;
  const showingLikelyOptionsRef = useRef(false);
  const activeScopeKeyRef = useRef(scopeKey);
  const resultsFreshness: InlineSearchResultsFreshness =
    isLoading && results.length > 0
      ? INLINE_SEARCH_RESULTS_FRESHNESS.staleWhileUpdating
      : INLINE_SEARCH_RESULTS_FRESHNESS.settled;
  const canSelectResults = canSelectInlineSearchResults(resultsFreshness);
  const showViewAll = !isLoading && results.length === 0 && Boolean(onViewAll);
  useEffect(() => {
    onResultsChangeRef.current = onResultsChange;
  }, [onResultsChange]);
  useEffect(() => {
    onViewAllAvailabilityChange?.(showViewAll);
    return () => onViewAllAvailabilityChange?.(false);
  }, [onViewAllAvailabilityChange, showViewAll]);
  useEffect(() => {
    resultsRef.current = results;
  }, [results]);

  useEffect(() => {
    const requestId = createInlineSearchRequestId(
      latestSearchRequestIdRef.current.value + 1,
    );
    latestSearchRequestIdRef.current = requestId;
    let cancelled = false;
    const scopeChanged = activeScopeKeyRef.current !== scopeKey;
    activeScopeKeyRef.current = scopeKey;
    if (!hasQuery) {
      showingLikelyOptionsRef.current = likelyOptions.length > 0;
      resultsRef.current = likelyOptions;
      setResults(likelyOptions);
      setIsLoading(false);
      onResultsChangeRef.current?.(
        likelyOptions,
        INLINE_SEARCH_RESULTS_FRESHNESS.settled,
      );
      return;
    }

    if (scopeChanged || showingLikelyOptionsRef.current) {
      showingLikelyOptionsRef.current = false;
      resultsRef.current = [];
      setResults([]);
      onResultsChangeRef.current?.([], INLINE_SEARCH_RESULTS_FRESHNESS.settled);
    }
    setIsLoading(true);
    const currentResults = resultsRef.current;
    onResultsChangeRef.current?.(
      currentResults,
      currentResults.length > 0
        ? INLINE_SEARCH_RESULTS_FRESHNESS.staleWhileUpdating
        : INLINE_SEARCH_RESULTS_FRESHNESS.settled,
    );
    const timer = setTimeout(() => {
      void onSearchEntities(query, searchScope)
        .then((next) => {
          if (
            cancelled ||
            !isInlineSearchRequestIdCurrent(
              latestSearchRequestIdRef.current,
              requestId,
            )
          ) {
            return;
          }
          resultsRef.current = next;
          setResults(next);
          onResultsChangeRef.current?.(
            next,
            INLINE_SEARCH_RESULTS_FRESHNESS.settled,
          );
        })
        .catch((error: unknown) => {
          if (
            cancelled ||
            !isInlineSearchRequestIdCurrent(
              latestSearchRequestIdRef.current,
              requestId,
            )
          ) {
            return;
          }
          console.error("Slash entity search error:", error);
          resultsRef.current = [];
          setResults([]);
          onResultsChangeRef.current?.(
            [],
            INLINE_SEARCH_RESULTS_FRESHNESS.settled,
          );
        })
        .finally(() => {
          if (
            cancelled ||
            !isInlineSearchRequestIdCurrent(
              latestSearchRequestIdRef.current,
              requestId,
            )
          ) {
            return;
          }
          setIsLoading(false);
        });
    }, MENTION_SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasQuery, likelyOptions, onSearchEntities, query, scopeKey, searchScope]);

  useEffect(() => {
    resultRefs.current = [];
  }, [results]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const el = resultRefs.current[selectedIndex];
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex, results]);

  return (
    <Paper
      data-testid="slash-entity-search-popup"
      sx={{
        width: SLASH_ENTITY_SEARCH_POPUP_WIDTH,
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
          flex: 1,
          overflow: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {isLoading && results.length > 0 && (
          <Box data-testid="slash-entity-search-updating" sx={{ px: 2, py: 1 }}>
            <LinearProgress
              aria-label={t("slashEntitySearchPopup.updating", {
                defaultValue: "Updating results",
              })}
            />
          </Box>
        )}
        {isLoading && results.length === 0 ? (
          <Box data-testid="slash-entity-search-loading" sx={{ px: 2, py: 1 }}>
            <LinearProgress
              aria-label={t("slashEntitySearchPopup.loading", {
                defaultValue: "Loading results",
              })}
            />
          </Box>
        ) : results.length > 0 ? (
          <>
            {!hasQuery && (
              <Typography
                data-testid="slash-entity-search-related-label"
                variant="overline"
                color="text.secondary"
                sx={{ px: 2, pt: 1 }}
              >
                {t("slashEntitySearchPopup.relatedEntities", {
                  defaultValue: relatedEntitiesLabel,
                })}
              </Typography>
            )}
            <List disablePadding>
              {results.map((entity, index) => (
                <ListItem
                  key={`${entity.type}:${entity.id}:${index}`}
                  disablePadding
                  onMouseEnter={() => {
                    if (canSelectResults) {
                      onSelectedIndexChange(index);
                    }
                  }}
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
                    data-testid="slash-entity-search-row"
                    data-entity-id={entity.id}
                    data-result-freshness={resultsFreshness}
                    aria-disabled={!canSelectResults}
                    disabled={!canSelectResults}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      if (canSelectResults) {
                        onSelectEntity(entity);
                      }
                    }}
                    ref={(node) => {
                      resultRefs.current[index] = node;
                    }}
                    selected={index === selectedIndex}
                    sx={{
                      "&.Mui-selected": { backgroundColor: "action.selected" },
                      "&.Mui-selected:hover": {
                        backgroundColor: "action.selected",
                      },
                      ...(resultsFreshness ===
                      INLINE_SEARCH_RESULTS_FRESHNESS.staleWhileUpdating
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
              ))}
            </List>
          </>
        ) : (
          <Box sx={{ p: 2, textAlign: "center" }}>
            <Typography
              data-testid={
                hasQuery
                  ? "slash-entity-search-empty-results"
                  : "slash-entity-search-empty-state"
              }
              variant="body2"
              color="text.secondary"
              align="center"
            >
              {hasQuery
                ? t("common.noMatches", { defaultValue: "No matches found" })
                : t("slashEntitySearchPopup.typeToSearch", {
                    defaultValue: "Type to search",
                  })}
            </Typography>
            {showViewAll && onViewAll && (
              <Button
                data-testid="slash-entity-search-view"
                size="small"
                variant={isViewAllSelected ? "contained" : "text"}
                aria-selected={isViewAllSelected}
                onMouseDown={(event) => event.preventDefault()}
                onClick={onViewAll}
                sx={{ mt: 1 }}
              >
                {t("common.viewAll", { defaultValue: "View all" })}
              </Button>
            )}
          </Box>
        )}
      </Box>
    </Paper>
  );
};

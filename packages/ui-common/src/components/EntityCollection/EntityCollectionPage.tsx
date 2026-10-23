import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  CircularProgress,
  InputAdornment,
  Pagination,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import { useTranslation } from "react-i18next";
import { TargetEntityType, type WorkItemTypeDefinitionDto } from "../../api";
import { usePathService } from "../../contexts";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { useWorkItemReferencePage } from "../../data/hooks/useWorkItemReferences";
import { useWorkItems } from "../../data/hooks/useWorkItems";
import { EntityListItem, taskAdapter } from "../Entity";
import { InteractionComponent } from "../InteractionComponent";
import {
  buildDefaultStatusTabs,
  type EntityCollectionStatusTab,
} from "./entityCollectionStatusTabs";

export const ENTITY_COLLECTION_DEFAULT_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

export interface EntityCollectionPageProps {
  organizationId: string;
  projectId: string;
  /** Registry definition of the collected work-item type. */
  typeDefinition: WorkItemTypeDefinitionDto | undefined;
  /** Overrides the default lifecycle tabs, ordered with In Progress first. */
  statusTabs?: EntityCollectionStatusTab[];
  pageSize?: number;
  /** Requests the compact GOAL tracked-work aggregate for the page's rows. */
  includeTrackedWorkSummary?: boolean;
  /** Per-row content for the list item's attention slot (e.g. derived progress). */
  renderRowAttention?: (item: WorkItemResponseDto) => React.ReactNode;
  emptyMessage?: string;
  searchPlaceholder?: string;
}

const useDebouncedValue = (value: string, delayMs: number): string => {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
};

/**
 * Full-collection surface for one work-item type. Search, status tabs and
 * pagination run against the lightweight references read so totals cover the
 * complete collection; only the visible page is hydrated through the generic
 * work-item list, without embedded tracked-entity snapshots.
 */
export const EntityCollectionPage: React.FC<EntityCollectionPageProps> = ({
  organizationId,
  projectId,
  typeDefinition,
  statusTabs,
  pageSize = ENTITY_COLLECTION_DEFAULT_PAGE_SIZE,
  includeTrackedWorkSummary = false,
  renderRowAttention,
  emptyMessage,
  searchPlaceholder,
}) => {
  const { t } = useTranslation();
  const pathService = usePathService();
  const typeKey = typeDefinition?.key;

  const tabs = useMemo(
    () => statusTabs ?? buildDefaultStatusTabs(typeDefinition),
    [statusTabs, typeDefinition]
  );

  const [activeTabId, setActiveTabId] = useState<string | undefined>(tabs[0]?.id);
  const [searchInput, setSearchInput] = useState("");
  const [page, setPage] = useState(1);
  const filter = useDebouncedValue(searchInput.trim(), SEARCH_DEBOUNCE_MS);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const statuses = activeTab?.statuses ?? [];

  useEffect(() => {
    setPage(1);
  }, [filter, activeTabId]);

  const referenceState = useWorkItemReferencePage({
    organizationId: organizationId || undefined,
    projectId: projectId || undefined,
    workItemType: typeKey,
    page,
    limit: pageSize,
    filter: filter || undefined,
    statuses: statuses.length > 0 ? statuses : undefined,
  });

  const referencePage = referenceState.page;
  const pageIds = useMemo(
    () => referencePage?.items.map((item) => item.id) ?? [],
    [referencePage]
  );

  const {
    workItems,
    isLoading: rowsLoading,
    error: rowsError,
  } = useWorkItems(organizationId, "task", projectId, undefined, {
    taskType: typeKey,
    taskIds: pageIds,
    includeTrackedEntities: false,
    includeTrackedWorkSummary,
    page: 1,
    limit: Math.max(pageIds.length, 1),
    enabled: !!organizationId && !!projectId && !!typeKey && pageIds.length > 0,
  });

  // The references read owns ordering; hydrated rows follow it.
  const orderedRows = useMemo(() => {
    const byId = new Map((workItems ?? []).map((item) => [item.id, item]));
    return pageIds
      .map((id) => byId.get(id))
      .filter((item): item is WorkItemResponseDto => item !== undefined);
  }, [workItems, pageIds]);

  const totalPages = referencePage?.pagination.totalPages ?? 0;
  const isInitialLoading =
    referenceState.status === "loading" ||
    (pageIds.length > 0 && rowsLoading && orderedRows.length === 0);

  return (
    <Box data-testid="entity-collection-page">
      <Box sx={{ mb: 1 }}>
        <TextField
          size="small"
          fullWidth
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder={
            searchPlaceholder ?? t("entityCollection.search", "Search")
          }
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
            htmlInput: { "data-testid": "entity-collection-search" },
          }}
        />
      </Box>

      <Tabs
        value={activeTab?.id ?? false}
        onChange={(_event, value: string) => setActiveTabId(value)}
        variant="scrollable"
        scrollButtons="auto"
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
        data-testid="entity-collection-status-tabs"
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            value={tab.id}
            label={tab.label}
            data-testid="entity-collection-status-tab"
            data-status-tab-id={tab.id}
          />
        ))}
      </Tabs>

      {referenceState.status === "error" && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {referenceState.error.message}
        </Alert>
      )}
      {rowsError && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {rowsError.message}
        </Alert>
      )}

      {isInitialLoading ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress size={24} />
        </Box>
      ) : referenceState.status === "empty" ? (
        <Typography
          color="text.secondary"
          sx={{ py: 4, textAlign: "center" }}
          data-testid="entity-collection-empty"
        >
          {emptyMessage ?? t("entityCollection.empty", "Nothing here yet.")}
        </Typography>
      ) : (
        <Stack spacing={1} data-testid="entity-collection-rows">
          {orderedRows.map((item) => {
            const props = taskAdapter.toEntityListItemProps(item, {
              organizationId,
              projectId,
              pathService,
              workItemTypeDefinition: typeDefinition,
            });
            return (
              <InteractionComponent
                key={item.id}
                entityId={item.id}
                entityType={TargetEntityType.Task}
                entitySubtype={item.type}
                hasProposalSupport={item.hasProposalSupport ?? false}
                entityTitle={item.name}
                organizationId={organizationId}
                projectId={projectId}
              >
                <EntityListItem
                  {...props}
                  attentionContent={renderRowAttention?.(item)}
                />
              </InteractionComponent>
            );
          })}
        </Stack>
      )}

      {totalPages > 1 && (
        <Box display="flex" justifyContent="center" sx={{ mt: 2 }}>
          <Pagination
            count={totalPages}
            page={page}
            onChange={(_event, value) => setPage(value)}
            data-testid="entity-collection-pagination"
          />
        </Box>
      )}
    </Box>
  );
};

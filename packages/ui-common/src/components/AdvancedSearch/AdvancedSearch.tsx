import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Button,
  Collapse,
  FormControl,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Typography,
} from "@mui/material";
import type {
  AdvancedSearchProps,
  SearchFilterState,
  SearchEntity,
  AdvancedSearchEntityScope,
} from "./types";
import { SearchInputs, type SearchMode } from "./SearchInputs";
import { SearchResults } from "./SearchResults";
import { SearchPreview } from "./SearchPreview";
import { useSemanticSearch } from "./hooks/useSemanticSearch";
import { useSearchSelection } from "./hooks/useSearchSelection";
import { navigateToEntity } from "../WebUtils/navigateToEntity";
import {
  AgentSessionType,
  EntityType,
  WorkStatus,
  WorkItemTypeLifecycleStatus,
  type AgentSessionDto,
} from "../../api";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { EntitySearchChat } from "../AgentSession/EntitySearchChat";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import { resolveAgentBridgeRecoveryState } from "../AgentSession/agentBridgeRecoveryState";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";
import {
  AGENT_SEARCH_SURFACE_ID,
  writeSurfaceSelection,
  type SurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../AgentSession/useSurfaceSelection";
import type {
  ConversationStartRunRequestDtoReasoningEffortEnum,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../api";
import { normalizeEntityType } from "../entityTypeUtils";
import { useUserIdentity } from "../../hooks/useUserIdentity";
import { usePastSearches } from "./usePastSearches";
import type { PastSearch } from "./pastSearches";
import { bindGraphConversationAgentSessionMachine } from "../InteractionComponent/bindGraphConversationAgentSessionMachine";

const TASK_FILTER_PREFIX = `${EntityType.Task}:`;

const isTaskFilterValue = (value: string): boolean =>
  value.startsWith(TASK_FILTER_PREFIX) &&
  value.length > TASK_FILTER_PREFIX.length;

const isTaskEntityTypeValue = (value: string): boolean =>
  !isTaskFilterValue(value) && normalizeEntityType(value) === EntityType.Task;

const taskFilterValue = (typeKey: string): string =>
  `${TASK_FILTER_PREFIX}${typeKey}`;

/**
 * Decompose composite filter values into entity types and task types.
 * e.g. ["TASK:STANDARD", "TASK:FEATURE", "INITIATIVE"] ->
 *   { entityTypes: ["TASK", "INITIATIVE"], taskTypes: ["STANDARD", "FEATURE"] }
 */
function decomposeFilterValues(values: string[]): {
  entityTypes: string[];
  taskTypes: string[] | undefined;
} {
  const entityTypes = new Set<string>();
  const taskTypes: string[] = [];

  for (const value of values) {
    if (isTaskFilterValue(value)) {
      entityTypes.add(EntityType.Task);
      taskTypes.push(value.slice(TASK_FILTER_PREFIX.length));
    } else {
      entityTypes.add(value);
    }
  }

  return {
    entityTypes: [...entityTypes],
    taskTypes: taskTypes.length > 0 ? taskTypes : undefined,
  };
}

const STATUS_OPTIONS = [
  { value: WorkStatus.Backlog, label: "Backlog" },
  { value: WorkStatus.Active, label: "Active" },
  { value: WorkStatus.OnHold, label: "On Hold" },
  { value: WorkStatus.Completed, label: "Completed" },
  { value: WorkStatus.Cancelled, label: "Cancelled" },
  { value: WorkStatus.Verifying, label: "Verifying" },
  { value: WorkStatus.Generated, label: "Generated" },
  { value: WorkStatus.RefiningDescription, label: "Refining Description" },
  { value: WorkStatus.RefiningDetails, label: "Refining Details" },
  {
    value: WorkStatus.RefiningAcceptanceCriteria,
    label: "Refining Acceptance Criteria",
  },
];

const formatMultiSelectSummary = (
  selected: string[],
  options: ReadonlyArray<{ value: string; label: string }>,
): string => {
  if (selected.length === 0) {
    return "";
  }

  const labelByValue = new Map(
    options.map((option) => [option.value, option.label]),
  );
  const firstLabel = labelByValue.get(selected[0]) ?? selected[0];

  if (selected.length === 1) {
    return firstLabel;
  }

  return `${firstLabel} +${selected.length - 1}`;
};

/**
 * Advanced search component
 *
 * Full-featured search interface with:
 * - Title and semantic search inputs
 * - Optional caller-provided entity scope and status filters
 * - Single/multi-selection with keyboard shortcuts
 * - Entity preview with type-specific rendering
 * - Responsive layout (sidebar on wide screens, stacked on narrow)
 */
export const AdvancedSearch: React.FC<AdvancedSearchProps> = ({
  organizationId,
  onSelect,
  allowMultiSelect = false,
  onClose,
  projectId,
  defaultEntityTypes,
  defaultStatuses = [],
  maxResults = 50,
  defaultQuery,
  hideFilters = false,
  entityId,
  entityType,
  onHasContent,
}) => {
  // View state
  const [view, setView] = useState<"search" | "preview">("search");
  const [previewEntity, setPreviewEntity] = useState<SearchEntity | null>(null);

  // Input state (what the user is typing)
  const [searchInput, setSearchInput] = useState(() => defaultQuery ?? "");
  const [searchMode, setSearchMode] = useState<SearchMode>("title");

  // Search query state (what gets sent to the API)
  const [titleQuery, setTitleQuery] = useState("");
  // Content (semantic) query: a non-empty value flips the embeddings queryMode
  // to Default (true vector search) inside useSemanticSearch.
  const [contentQuery, setContentQuery] = useState("");
  const [isAdvancedVisible, setIsAdvancedVisible] = useState(false);
  const [scopedEntity, setScopedEntity] =
    useState<AdvancedSearchEntityScope | null>(
      entityId && entityType ? { entityId, entityType } : null,
    );

  // Agent-search state: once the user kicks off an agent search, the modal
  // hands the conversation over to EntitySearchChat bound to this session.
  const [agentSession, setAgentSession] = useState<AgentSessionDto | null>(
    null,
  );
  const [agentInitialMessage, setAgentInitialMessage] = useState<string | null>(
    null,
  );
  const [agentSessionError, setAgentSessionError] = useState<string | null>(
    null,
  );
  const [isBindingAgentSession, setIsBindingAgentSession] = useState(false);
  const pendingAgentMachineIdRef = useRef<string | null>(null);

  const {
    machines,
    mode: machineMode,
    selectedMachine,
    setSelectedMachineId,
    isReady: machinesReady,
  } = useMachineResolution();
  const selectedMachineId = selectedMachine?.machineId ?? null;
  const machineRecoveryState = useMemo(
    () =>
      resolveAgentBridgeRecoveryState({
        type: "inventory",
        isLoading: !machinesReady,
        machines,
        selectedMachineId,
      }),
    [machines, machinesReady, selectedMachineId],
  );

  const {
    workItemTypes,
    isLoading: isWorkItemTypesLoading,
    isFetched: isWorkItemTypesFetched,
    error: workItemTypesError,
  } = useWorkItemTypes(organizationId, {
    projectId,
    status: WorkItemTypeLifecycleStatus.Active,
  });

  const activeTaskFilterValues = useMemo(
    () =>
      Array.from(
        new Set(
          workItemTypes
            .filter(
              (workItemType) =>
                workItemType.status === WorkItemTypeLifecycleStatus.Active,
            )
            .map(({ definition }) => taskFilterValue(definition.key)),
        ),
      ),
    [workItemTypes],
  );

  const activeWorkItemTypesResolved =
    isWorkItemTypesFetched ?? (!isWorkItemTypesLoading && !workItemTypesError);

  const resolvedDefaultEntityTypes = useMemo(() => {
    if (defaultEntityTypes === undefined) {
      return undefined;
    }

    if (!activeWorkItemTypesResolved || workItemTypesError) {
      return defaultEntityTypes;
    }

    const selectedTaskFilterValues =
      defaultEntityTypes.filter(isTaskFilterValue);
    const selectedAllTasks = defaultEntityTypes.some(isTaskEntityTypeValue);
    const nextTaskFilterValues = selectedAllTasks
      ? activeTaskFilterValues
      : selectedTaskFilterValues.filter((value) =>
          activeTaskFilterValues.includes(value),
        );

    return [
      ...nextTaskFilterValues,
      ...defaultEntityTypes.filter(
        (value) => !isTaskFilterValue(value) && !isTaskEntityTypeValue(value),
      ),
    ];
  }, [
    activeTaskFilterValues,
    activeWorkItemTypesResolved,
    defaultEntityTypes,
    workItemTypesError,
  ]);

  const { mutate: createAgentSession, isPending: isCreatingAgentSession } =
    useCreateAgentSession({
      onSuccess: (session) => {
        const pendingMachineId = pendingAgentMachineIdRef.current;
        if (!pendingMachineId) {
          setAgentSessionError(
            "Select an execution-ready machine before starting an agent search.",
          );
          return;
        }

        setIsBindingAgentSession(true);
        void bindGraphConversationAgentSessionMachine({
          organizationId,
          projectId,
          agentSessionId: session.id,
          machineId: pendingMachineId,
        })
          .then((boundSession) => {
            setAgentSession(boundSession);
            setAgentSessionError(null);
          })
          .catch((err: unknown) => {
            setAgentSessionError(
              err instanceof Error
                ? err.message
                : "Failed to bind the selected machine for agent search",
            );
          })
          .finally(() => {
            setIsBindingAgentSession(false);
          });
      },
      onError: (err) => {
        setAgentSessionError(
          err instanceof Error ? err.message : "Failed to start agent search",
        );
      },
    });

  // Agent-search provider/model/effort triple, persisted under
  // AGENT_SEARCH_SURFACE_ID so the toolbar pick survives reloads and is
  // forwarded into EntitySearchChat as the start-run envelope's triple.
  const agentCatalogSource = useMemo(
    () =>
      selectedMachineId
        ? { organizationId, projectId, machineId: selectedMachineId }
        : null,
    [organizationId, projectId, selectedMachineId],
  );
  const { selection: agentSelection, updateSelection: patchAgentSelection } =
    useSurfaceSelection({
      surfaceId: AGENT_SEARCH_SURFACE_ID,
      catalogSource: agentCatalogSource,
      resetKey: null,
    });
  // The running chat keeps the triple it was started with even if the picked
  // machine's catalog is momentarily unavailable.
  const chatSelectionRef = useRef(agentSelection);
  if (agentSelection) {
    chatSelectionRef.current = agentSelection;
  }
  const chatSelection = agentSelection ?? chatSelectionRef.current;

  const updateAgentSelection = useCallback(
    (patch: (prev: SurfaceSelection) => SurfaceSelection) => {
      patchAgentSelection((prev) => {
        const next = patch(prev);
        writeSurfaceSelection(AGENT_SEARCH_SURFACE_ID, next);
        return next;
      });
    },
    [patchAgentSelection],
  );

  const handleProviderChange = useCallback(
    (provider: ConversationStartRunRequestDtoProviderEnum) => {
      updateAgentSelection((prev) => ({ ...prev, provider }));
    },
    [updateAgentSelection],
  );

  const handleModelChange = useCallback(
    (model: string) => {
      updateAgentSelection((prev) => ({ ...prev, model }));
    },
    [updateAgentSelection],
  );

  const handleReasoningEffortChange = useCallback(
    (
      reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null,
    ) => {
      updateAgentSelection((prev) => ({ ...prev, reasoningEffort }));
    },
    [updateAgentSelection],
  );

  const handleFastModeChange = useCallback(
    (fastMode: boolean) => {
      updateAgentSelection((prev) => ({ ...prev, fastMode }));
    },
    [updateAgentSelection],
  );

  const [filters, setFilters] = useState<SearchFilterState>({
    statuses: defaultStatuses,
    initiativeId: undefined,
    parentTaskId: undefined,
    threshold: 0.15,
    boostRecent: false,
  });

  // Decompose composite filter values into API-compatible entity types + task types
  // Memoize to keep stable array references — useSemanticSearch depends on these
  // by reference in its useEffect, so new arrays on every render cause a search loop.
  const apiFilters: SearchFilterState = useMemo(() => {
    if (resolvedDefaultEntityTypes === undefined) {
      return filters;
    }

    const decomposed = decomposeFilterValues(resolvedDefaultEntityTypes);
    return {
      ...filters,
      entityTypes: decomposed.entityTypes,
      taskTypes: decomposed.taskTypes,
    };
  }, [filters, resolvedDefaultEntityTypes]);

  // Title search runs via unified search; agent search runs via an agent session.
  const { results, isLoading, error } = useSemanticSearch(
    organizationId,
    titleQuery,
    contentQuery,
    apiFilters,
    projectId,
    { maxResults },
    scopedEntity ?? undefined,
  );

  // Past searches: surfaced only in agent mode; backed by the user's prior
  // AGENT_SEARCH agent sessions whose title was set to the executed query.
  const userIdentity = useUserIdentity();
  const { pastSearches } = usePastSearches(
    organizationId,
    projectId,
    userIdentity?.userId,
  );

  const filteredPastSearches = useMemo(
    () =>
      searchMode === "agent" && !agentSession
        ? pastSearches.filter((p) =>
            p.query.toLowerCase().includes(searchInput.toLowerCase()),
          )
        : [],
    [pastSearches, searchInput, searchMode, agentSession],
  );

  // Handle search button click. An explicit mode (passed by the mode icon
  // buttons) takes precedence over searchMode state, which may still be the
  // stale prior mode in the same tick the user clicks a different mode's button.
  const handleSearch = (mode?: SearchMode): void => {
    const activeMode = mode ?? searchMode;
    const trimmed = searchInput.trim();
    if (activeMode === "title") {
      setTitleQuery(trimmed);
      setContentQuery("");
      return;
    }

    // Content (semantic) search: route the query into the embeddings vector
    // search via useSemanticSearch's semanticQuery argument.
    if (activeMode === "content") {
      setContentQuery(trimmed);
      setTitleQuery("");
      return;
    }

    // Agent search: create an AGENT_SEARCH session seeded with the initial message.
    if (
      !trimmed ||
      agentSession ||
      isCreatingAgentSession ||
      isBindingAgentSession
    )
      return;
    if (!selectedMachineId) {
      setAgentSessionError(
        machines.length === 0
          ? "No CLI machine is paired. Connect or pair a CLI machine to start an agent search."
          : machineMode === "zero"
            ? "No paired CLI machine is ready for local execution. Review the machine state below."
            : "Please select a CLI machine to start an agent search.",
      );
      return;
    }

    if (!agentSelection) {
      setAgentSessionError(
        "The selected machine's model choices have not loaded yet. Try again in a moment.",
      );
      return;
    }

    setAgentInitialMessage(trimmed);
    setAgentSessionError(null);
    pendingAgentMachineIdRef.current = selectedMachineId;
    createAgentSession({
      organizationId,
      agentSession: {
        projectId,
        type: AgentSessionType.AgentSearch,
        sessionDate: new Date().toISOString(),
        title: trimmed,
      },
    });
  };

  const handleClearScopedEntity = (): void => {
    setScopedEntity(null);
  };

  const handleSearchModeChange = (mode: SearchMode): void => {
    setSearchMode(mode);
    // Switching modes resets the transient state of the modes being left so the
    // user never sees stale results from a previous mode.
    if (mode === "title") {
      setContentQuery("");
      setAgentSession(null);
      setAgentInitialMessage(null);
      setAgentSessionError(null);
    } else if (mode === "content") {
      setTitleQuery("");
      setAgentSession(null);
      setAgentInitialMessage(null);
      setAgentSessionError(null);
    } else {
      // agent
      setTitleQuery("");
      setContentQuery("");
    }
  };

  const handleNewAgentSearch = (): void => {
    setAgentSession(null);
    setAgentInitialMessage(null);
    setAgentSessionError(null);
    setSearchInput("");
  };

  // Selecting a past search opens the existing AGENT_SEARCH session and its
  // conversation; no new session is created and no initial prompt is sent.
  const handleSelectPastSearch = (pastSearch: PastSearch): void => {
    setAgentInitialMessage(null);
    setAgentSessionError(null);
    setSearchInput(pastSearch.query);
    setAgentSession(pastSearch.session);
  };

  const isAgentSearchActive = agentSession !== null;
  const hasSearched =
    titleQuery.trim().length > 0 || contentQuery.trim().length > 0;

  useEffect(() => {
    onHasContent?.(
      results.length > 0 ||
        agentSession !== null ||
        isCreatingAgentSession ||
        isBindingAgentSession,
    );
  }, [
    results.length,
    agentSession,
    isCreatingAgentSession,
    isBindingAgentSession,
    onHasContent,
  ]);

  // Use selection hook
  const { selectedIds, handleSelect, addToSelection } =
    useSearchSelection(allowMultiSelect);

  const handleResultSelect = (
    id: string,
    event: React.MouseEvent,
    results: SearchEntity[],
  ): void => {
    handleSelect(id, event, results);

    if (!allowMultiSelect) {
      const selectedEntity = results.find((result) => result.id === id);
      if (selectedEntity) {
        onSelect([selectedEntity]);
      }
    }
  };

  // Handle preview
  const handlePreview = (entity: SearchEntity): void => {
    setPreviewEntity(entity);
    setView("preview");
  };

  // Handle select from preview
  const handleSelectFromPreview = (): void => {
    if (!previewEntity) return;

    if (allowMultiSelect) {
      // Add to selection and return to search
      addToSelection(previewEntity.id);
      setView("search");
    } else {
      // Single select: call onSelect immediately
      onSelect([previewEntity]);
    }
  };

  const handleGoToEntity = (entity: SearchEntity): void => {
    if (typeof window === "undefined") {
      return;
    }

    void navigateToEntity({
      entity,
      navigate: (url: string) => window.location.assign(url),
      projectId,
    });
  };

  // Handle return from preview
  const handleReturnFromPreview = (): void => {
    setView("search");
  };

  // Handle final selection (from search view)
  const handleFinalSelect = (): void => {
    const selectedEntities = results.filter((r) => selectedIds.has(r.id));
    onSelect(selectedEntities);
  };

  // Render preview view
  if (view === "preview" && previewEntity) {
    return (
      <SearchPreview
        entity={previewEntity}
        organizationId={organizationId}
        projectId={projectId}
        onClose={handleReturnFromPreview}
        onSelect={handleSelectFromPreview}
        allowSelection={true}
        isSelected={selectedIds.has(previewEntity.id)}
      />
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Search inputs */}
        <Box sx={{ px: 2, pt: 2, pb: 1 }}>
          <SearchInputs
            titleQuery={searchInput}
            onTitleQueryChange={setSearchInput}
            searchMode={searchMode}
            onSearchModeChange={handleSearchModeChange}
            isLoading={
              isLoading ||
              isCreatingAgentSession ||
              isBindingAgentSession ||
              isAgentSearchActive
            }
            onSearch={handleSearch}
            scopedEntity={scopedEntity}
            onClearScopedEntity={handleClearScopedEntity}
            pastSearchOptions={filteredPastSearches}
            onPastSearchSelect={handleSelectPastSearch}
          />
        </Box>

        {searchMode === "content" && (
          <Box sx={{ px: 2, pt: 0, pb: 0.5 }}>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              Matches are approximate — results are ranked by meaning rather
              than exact text.
            </Typography>
          </Box>
        )}

        {searchMode === "agent" && (
          <Box
            sx={{
              px: 2,
              pt: 0.5,
              pb: 0.5,
              display: "flex",
              flexWrap: "wrap",
              gap: 2,
              alignItems: "center",
            }}
          >
            <RuntimeModelSelector
              testIdPrefix="agent-search-model-selector"
              catalogSource={agentCatalogSource}
              provider={agentSelection?.provider ?? null}
              model={agentSelection?.model ?? null}
              reasoningEffort={agentSelection?.reasoningEffort ?? null}
              fastMode={agentSelection?.fastMode ?? false}
              onProviderChange={handleProviderChange}
              onModelChange={handleModelChange}
              onReasoningEffortChange={handleReasoningEffortChange}
              onFastModeChange={handleFastModeChange}
              disabled={
                isAgentSearchActive ||
                isCreatingAgentSession ||
                isBindingAgentSession
              }
              machineSelection={{
                machines,
                machineMode,
                selectedMachineId,
                onSelectMachine: setSelectedMachineId,
                recoveryState: machineRecoveryState,
              }}
            />
          </Box>
        )}

        {searchMode === "agent" && isAgentSearchActive && (
          <Box
            sx={{
              px: 2,
              pt: 0,
              pb: 0.5,
              display: "flex",
              justifyContent: "flex-end",
            }}
          >
            <Button
              variant="text"
              size="small"
              onClick={handleNewAgentSearch}
              data-testid="agent-search-new"
              sx={{ textTransform: "none" }}
            >
              New search
            </Button>
          </Box>
        )}

        {searchMode === "title" && !hideFilters && (
          <Box sx={{ px: 2, pt: 0, pb: 0.5 }}>
            <Button
              variant="text"
              size="small"
              onClick={() => setIsAdvancedVisible((previous) => !previous)}
              sx={{
                p: 0,
                minWidth: "auto",
                textTransform: "none",
              }}
            >
              {isAdvancedVisible ? "(hide advanced)" : "(show advanced)"}
            </Button>
          </Box>
        )}

        {searchMode === "title" && !hideFilters && (
          <Collapse in={isAdvancedVisible} unmountOnExit>
            <Box
              sx={{
                borderBottom: 1,
                borderColor: "divider",
                px: 2,
                pb: 1.5,
                pt: 0.25,
              }}
            >
              <FormControl fullWidth>
                <InputLabel>Status</InputLabel>
                <Select<string[]>
                  multiple
                  value={filters.statuses}
                  onChange={(event) => {
                    const value =
                      typeof event.target.value === "string"
                        ? event.target.value.split(",")
                        : event.target.value;
                    setFilters((previous) => ({
                      ...previous,
                      statuses: value,
                    }));
                  }}
                  input={<OutlinedInput label="Status" />}
                  renderValue={(selected: string[]) =>
                    formatMultiSelectSummary(selected, STATUS_OPTIONS)
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                      {option.label}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Box>
          </Collapse>
        )}

        {/* Results / agent chat */}
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {searchMode === "agent" && agentSessionError && !agentSession ? (
            <Box sx={{ p: 2 }}>
              <Alert severity="error">{agentSessionError}</Alert>
            </Box>
          ) : searchMode === "agent" && agentSession && chatSelection ? (
            <EntitySearchChat
              organizationId={organizationId}
              projectId={projectId}
              agentSession={agentSession}
              selection={chatSelection}
              {...(agentInitialMessage
                ? { initialUserMessage: agentInitialMessage }
                : {})}
            />
          ) : searchMode === "agent" ? (
            <Box
              sx={{
                p: 3,
                color: "text.secondary",
                textAlign: "center",
              }}
              data-testid="agent-search-empty"
            >
              Type a query and click Search to start an agent-assisted search.
            </Box>
          ) : error ? (
            <Box sx={{ p: 3, color: "error.main" }}>Error: {error.message}</Box>
          ) : (
            <SearchResults
              results={results}
              isLoading={isLoading}
              allowMultiSelect={allowMultiSelect}
              selectedIds={selectedIds}
              onSelectionChange={handleResultSelect}
              onPreview={handlePreview}
              onGoToEntity={handleGoToEntity}
              showSimilarityScores={searchMode === "content"}
              emptyStateText={!hasSearched ? null : undefined}
            />
          )}
        </Box>

        {/* Action buttons (if multi-select and items selected) */}
        {allowMultiSelect && selectedIds.size > 0 && (
          <Box
            sx={{
              p: 2,
              borderTop: 1,
              borderColor: "divider",
              display: "flex",
              gap: 2,
              justifyContent: "flex-start",
            }}
          >
            {onClose && (
              <button type="button" onClick={onClose}>
                Cancel
              </button>
            )}
            <button type="button" onClick={handleFinalSelect}>
              Select {selectedIds.size}{" "}
              {selectedIds.size === 1 ? "item" : "items"}
            </button>
          </Box>
        )}
      </Box>
    </Box>
  );
};

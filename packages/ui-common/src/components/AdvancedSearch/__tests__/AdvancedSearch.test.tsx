import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { AdvancedSearch } from "../AdvancedSearch";
import { createMockSearchEntities, renderWithProviders } from "./testUtils";
import type { SearchEntity } from "../types";
import { EntityType, WorkItemTypeLifecycleStatus } from "../../../api";
import type { WorkItemTypeSummaryDto } from "../../../api";

// Mock child components and hooks to keep tests focused on AdvancedSearch logic
vi.mock("../hooks/useSemanticSearch", () => ({
  useSemanticSearch: vi.fn(),
}));

vi.mock("../hooks/useSearchSelection", () => ({
  useSearchSelection: vi.fn(),
}));

vi.mock("../usePastSearches", () => ({
  usePastSearches: vi.fn(),
}));

const registryState = vi.hoisted(() => ({
  workItemTypes: [] as WorkItemTypeSummaryDto[],
  isLoading: false,
  isFetched: true,
  error: null as Error | null,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypes: vi.fn(() => registryState),
}));

const searchInputsPropsSpy = vi.hoisted(() => vi.fn());

vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: vi.fn(),
}));

const mockCreateAgentSession = vi.fn();
const { bindAgentSessionMachineMock, machineResolutionState } = vi.hoisted(
  () => ({
    bindAgentSessionMachineMock: vi.fn(),
    machineResolutionState: {
      machines: [],
      mode: "one" as const,
      selectedMachine: { machineId: "machine-1" },
      setSelectedMachineId: vi.fn(),
      isReady: true,
    },
  })
);
let createAgentSessionOnSuccess:
  | ((session: { id: string; conversationId: string; status: string }) => void)
  | undefined;
vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: ({
    onSuccess,
  }: {
    onSuccess?: (session: {
      id: string;
      conversationId: string;
      status: string;
    }) => void;
    onError?: (err: unknown) => void;
  } = {}) => {
    createAgentSessionOnSuccess = onSuccess;
    return { mutate: mockCreateAgentSession, isPending: false };
  },
}));

vi.mock("../../AgentSession/runtime/coding/useMachineResolution", () => ({
  useMachineResolution: () => machineResolutionState,
}));

vi.mock(
  "../../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({
    bindGraphConversationAgentSessionMachine: bindAgentSessionMachineMock,
  })
);

vi.mock("../SearchResults", () => ({
  SearchResults: ({
    results,
    isLoading,
    emptyStateText,
    onSelectionChange,
    onPreview,
    onGoToEntity,
    allowMultiSelect,
    selectedIds,
    showSimilarityScores,
  }: {
    results: SearchEntity[];
    isLoading: boolean;
    emptyStateText?: string | null;
    onSelectionChange: (
      id: string,
      event: React.MouseEvent,
      results: SearchEntity[]
    ) => void;
    onPreview: (entity: SearchEntity) => void;
    onGoToEntity: (entity: SearchEntity) => void;
    allowMultiSelect: boolean;
    selectedIds: Set<string>;
    showSimilarityScores?: boolean;
  }) => (
    <div data-testid="search-results">
      <span data-testid="show-similarity-scores">
        {String(showSimilarityScores)}
      </span>
      {isLoading && <div>Loading...</div>}
      {emptyStateText && results.length === 0 && !isLoading && (
        <div>{emptyStateText}</div>
      )}
      {results.map((r) => (
        <div key={r.id}>
          <span
            data-testid={`result-${r.id}`}
            onClick={(e) =>
              onSelectionChange(r.id, e as React.MouseEvent, results)
            }
          >
            {r.name}
          </span>
          <button onClick={() => onPreview(r)}>preview-{r.id}</button>
          <button onClick={() => onGoToEntity(r)}>goto-{r.id}</button>
          {allowMultiSelect && (
            <input
              type="checkbox"
              readOnly
              checked={selectedIds.has(r.id)}
              aria-label={r.name}
            />
          )}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("../SearchInputs", () => ({
  SearchInputs: ({
    titleQuery,
    onSearch,
    onTitleQueryChange,
    onSearchModeChange,
    pastSearchOptions,
    onPastSearchSelect,
  }: {
    titleQuery: string;
    onSearch: () => void;
    onTitleQueryChange: (v: string) => void;
    onSearchModeChange: (mode: "title" | "content" | "agent") => void;
    pastSearchOptions?: Array<{
      sessionId: string;
      query: string;
      session: unknown;
    }>;
    onPastSearchSelect?: (search: {
      sessionId: string;
      query: string;
      session: unknown;
    }) => void;
  }) => {
    searchInputsPropsSpy({
      titleQuery,
      onSearch,
      onTitleQueryChange,
      onSearchModeChange,
      pastSearchOptions,
      onPastSearchSelect,
    });

    return (
      <div data-testid="search-inputs">
        <input
          data-testid="search-input"
          value={titleQuery}
          onChange={(e) => onTitleQueryChange(e.target.value)}
        />
        <button onClick={() => onSearch()}>Search</button>
        <button
          data-testid="set-agent-mode"
          onClick={() => onSearchModeChange("agent")}
        >
          agent-mode
        </button>
        <button
          data-testid="set-content-mode"
          onClick={() => onSearchModeChange("content")}
        >
          content-mode
        </button>
        {pastSearchOptions &&
          pastSearchOptions.length > 0 &&
          onPastSearchSelect && (
            <div data-testid="past-searches-list">
              {pastSearchOptions.map((p) => (
                <button
                  key={p.sessionId}
                  data-testid="past-search-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPastSearchSelect(p)}
                >
                  {p.query}
                </button>
              ))}
            </div>
          )}
      </div>
    );
  },
}));

vi.mock("../../AgentSession/RuntimeModelSelector", () => ({
  RuntimeModelSelector: ({
    provider,
    model,
    reasoningEffort,
    onProviderChange,
    onModelChange,
    onReasoningEffortChange,
    fastMode,
    onFastModeChange,
    testIdPrefix,
  }: {
    provider: string;
    model: string;
    reasoningEffort: string | null;
    fastMode: boolean;
    onProviderChange: (p: string) => void;
    onModelChange: (m: string) => void;
    onReasoningEffortChange: (e: string | null) => void;
    onFastModeChange: (fastMode: boolean) => void;
    testIdPrefix: string;
  }) => (
    <div data-testid={`${testIdPrefix}-root`}>
      <span data-testid={`${testIdPrefix}-state`}>
        {`${provider}|${model}|${reasoningEffort ?? ""}|${fastMode}`}
      </span>
      <button
        data-testid={`${testIdPrefix}-set-provider-codex`}
        onClick={() => onProviderChange("codex")}
      >
        codex
      </button>
      <button
        data-testid={`${testIdPrefix}-set-model`}
        onClick={() => onModelChange("claude-sonnet-5-5")}
      >
        model
      </button>
      <button
        data-testid={`${testIdPrefix}-set-effort-high`}
        onClick={() => onReasoningEffortChange("high")}
      >
        high
      </button>
      <button
        data-testid={`${testIdPrefix}-set-fast-mode`}
        onClick={() => onFastModeChange(true)}
      >
        fast
      </button>
    </div>
  ),
}));

const entitySearchChatPropsSpy = vi.fn();
vi.mock("../../AgentSession/EntitySearchChat", () => ({
  EntitySearchChat: (props: { selection: unknown }) => {
    entitySearchChatPropsSpy(props);
    return (
      <div data-testid="entity-search-chat">
        <span data-testid="entity-search-chat-selection">
          {JSON.stringify(props.selection)}
        </span>
      </div>
    );
  },
}));

vi.mock("../SearchPreview", () => ({
  SearchPreview: ({
    entity,
    onClose,
    onSelect,
  }: {
    entity: SearchEntity;
    onClose: () => void;
    onSelect: () => void;
  }) => (
    <div data-testid="search-preview">
      <span>{entity.name}</span>
      <button onClick={onClose}>Back</button>
      <button onClick={onSelect}>Select from preview</button>
    </div>
  ),
}));

vi.mock("../../../components/WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));

import { useSemanticSearch } from "../hooks/useSemanticSearch";
import { useSearchSelection } from "../hooks/useSearchSelection";
import { usePastSearches } from "../usePastSearches";
import { useUserIdentity } from "../../../hooks/useUserIdentity";

const mockUseSemanticSearch = vi.mocked(useSemanticSearch);
const mockUseSearchSelection = vi.mocked(useSearchSelection);
const mockUsePastSearches = vi.mocked(usePastSearches);
const mockUseUserIdentity = vi.mocked(useUserIdentity);

const DEFAULT_PROPS = {
  organizationId: "org-1",
  projectId: "proj-1",
  onSelect: vi.fn(),
};

function makeWorkItemType(
  key: string,
  name: string,
  status: WorkItemTypeLifecycleStatus = WorkItemTypeLifecycleStatus.Active
): WorkItemTypeSummaryDto {
  return {
    definition: {
      key,
      name,
      sections: [],
      allowedStatuses: [],
    },
    status,
    projectId: "proj-1",
  };
}

function makeSelectionHook(selectedIds: Set<string> = new Set()) {
  return {
    selectedIds,
    handleSelect: vi.fn(),
    addToSelection: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  registryState.workItemTypes = [];
  registryState.isLoading = false;
  registryState.isFetched = true;
  registryState.error = null;
  mockUseSemanticSearch.mockReturnValue({
    results: [],
    isLoading: false,
    error: null,
  });
  mockUseSearchSelection.mockReturnValue(makeSelectionHook());
  mockUsePastSearches.mockReturnValue({ pastSearches: [], isLoading: false });
  bindAgentSessionMachineMock.mockResolvedValue({
    id: "session-bound",
    machineId: "machine-1",
  });
  mockUseUserIdentity.mockReturnValue({
    userId: "user-1",
    email: "u@example.com",
    name: "User",
    currentOrgId: "org-1",
    orgMemberships: [],
    isDevAdmin: false,
    devAdminMode: false,
    isTokenExpired: false,
    currentOrgRole: null,
  });
});

describe("AdvancedSearch", () => {
  it("renders the search input and results area", () => {
    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    expect(screen.getByTestId("search-inputs")).toBeInTheDocument();
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
  });

  it("does not expose a Service or entity type control", () => {
    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    expect(
      screen.queryByTestId("agent-search-service-selector")
    ).not.toBeInTheDocument();

    const lastProps = searchInputsPropsSpy.mock.calls.at(-1)?.[0] as Record<
      string,
      unknown
    >;
    expect(lastProps).not.toHaveProperty("entityTypes");
    expect(lastProps).not.toHaveProperty("onEntityTypesChange");
    expect(lastProps).not.toHaveProperty("entityTypeOptions");
  });

  it("runs unscoped title searches without a UI-supplied entity type filter", () => {
    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    const lastCall = mockUseSemanticSearch.mock.calls.at(-1);
    expect(lastCall?.[3]).not.toHaveProperty("entityTypes");
    expect(lastCall?.[3]).not.toHaveProperty("taskTypes");
  });

  it("keeps immutable default entity scopes for non-agent searches", () => {
    registryState.workItemTypes = [
      makeWorkItemType("STANDARD", "Project Task"),
      makeWorkItemType("CUSTOM", "Research Brief"),
    ];

    renderWithProviders(
      <AdvancedSearch
        {...DEFAULT_PROPS}
        defaultEntityTypes={[
          "TASK:CUSTOM",
          EntityType.Initiative,
        ]}
      />
    );

    const lastCall = mockUseSemanticSearch.mock.calls.at(-1);
    expect(lastCall?.[3]).toEqual(
      expect.objectContaining({
        entityTypes: [EntityType.Task, EntityType.Initiative],
        taskTypes: ["CUSTOM"],
      })
    );
  });

  it("expands a plain task default to the active project task choices", () => {
    registryState.workItemTypes = [
      makeWorkItemType("STANDARD", "Project Task"),
      makeWorkItemType("CUSTOM", "Research Brief"),
    ];

    renderWithProviders(
      <AdvancedSearch
        {...DEFAULT_PROPS}
        defaultEntityTypes={["task", EntityType.Initiative]}
      />
    );

    const lastCall = mockUseSemanticSearch.mock.calls.at(-1);
    expect(lastCall?.[3]).toEqual(
      expect.objectContaining({
        entityTypes: [EntityType.Task, EntityType.Initiative],
        taskTypes: ["STANDARD", "CUSTOM"],
      })
    );
  });

  it("prefills the search input from defaultQuery on mount", () => {
    renderWithProviders(
      <AdvancedSearch {...DEFAULT_PROPS} defaultQuery="foo" />
    );

    expect(screen.getByDisplayValue("foo")).toBeInTheDocument();
  });

  it('shows "(show advanced)" toggle when hideFilters is false', () => {
    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    expect(screen.getByText("(show advanced)")).toBeInTheDocument();
  });

  it("hides the advanced filter toggle when hideFilters is true", () => {
    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} hideFilters />);

    expect(screen.queryByText("(show advanced)")).not.toBeInTheDocument();
  });

  it("toggles advanced filters visibility on button click", () => {
    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    const toggle = screen.getByText("(show advanced)");
    fireEvent.click(toggle);
    expect(screen.getByText("(hide advanced)")).toBeInTheDocument();

    fireEvent.click(screen.getByText("(hide advanced)"));
    expect(screen.getByText("(show advanced)")).toBeInTheDocument();
  });

  it("displays an error message when search returns an error", () => {
    mockUseSemanticSearch.mockReturnValue({
      results: [],
      isLoading: false,
      error: new Error("Search failed"),
    });

    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    expect(screen.getByText(/Search failed/)).toBeInTheDocument();
  });

  it("calls onSelect with the clicked entity in single-select mode", () => {
    const mockResults = createMockSearchEntities(2);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });
    mockUseSearchSelection.mockReturnValue(makeSelectionHook());

    const onSelect = vi.fn();
    renderWithProviders(
      <AdvancedSearch {...DEFAULT_PROPS} onSelect={onSelect} />
    );

    fireEvent.click(screen.getByTestId(`result-${mockResults[0].id}`));

    expect(onSelect).toHaveBeenCalledWith([mockResults[0]]);
  });

  it("does not call onSelect immediately in multi-select mode on result click", () => {
    const mockResults = createMockSearchEntities(2);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });
    const handleSelect = vi.fn();
    mockUseSearchSelection.mockReturnValue({
      selectedIds: new Set(),
      handleSelect,
      addToSelection: vi.fn(),
    });

    const onSelect = vi.fn();
    renderWithProviders(
      <AdvancedSearch {...DEFAULT_PROPS} onSelect={onSelect} allowMultiSelect />
    );

    fireEvent.click(screen.getByTestId(`result-${mockResults[0].id}`));

    expect(handleSelect).toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shows selection action bar when multi-select has selections", () => {
    const mockResults = createMockSearchEntities(2);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });
    mockUseSearchSelection.mockReturnValue(
      makeSelectionHook(new Set([mockResults[0].id]))
    );

    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} allowMultiSelect />);

    expect(screen.getByText(/Select 1 item/)).toBeInTheDocument();
  });

  it('calls onSelect with selected entities when "Select N items" is clicked', () => {
    const mockResults = createMockSearchEntities(3);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });
    mockUseSearchSelection.mockReturnValue(
      makeSelectionHook(new Set([mockResults[0].id, mockResults[1].id]))
    );

    const onSelect = vi.fn();
    renderWithProviders(
      <AdvancedSearch {...DEFAULT_PROPS} onSelect={onSelect} allowMultiSelect />
    );

    fireEvent.click(screen.getByText(/Select 2 items/));

    expect(onSelect).toHaveBeenCalledWith([mockResults[0], mockResults[1]]);
  });

  it("shows preview when onPreview is triggered", () => {
    const mockResults = createMockSearchEntities(1);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByText(`preview-${mockResults[0].id}`));

    expect(screen.getByTestId("search-preview")).toBeInTheDocument();
    expect(screen.getByText(mockResults[0].name)).toBeInTheDocument();
  });

  it("returns to search view from preview on back click", () => {
    const mockResults = createMockSearchEntities(1);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });

    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    fireEvent.click(screen.getByText(`preview-${mockResults[0].id}`));
    expect(screen.getByTestId("search-preview")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByTestId("search-inputs")).toBeInTheDocument();
    expect(screen.queryByTestId("search-preview")).not.toBeInTheDocument();
  });

  it("calls onSelect from preview in single-select mode", () => {
    const mockResults = createMockSearchEntities(1);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });

    const onSelect = vi.fn();
    renderWithProviders(
      <AdvancedSearch {...DEFAULT_PROPS} onSelect={onSelect} />
    );

    fireEvent.click(screen.getByText(`preview-${mockResults[0].id}`));
    fireEvent.click(screen.getByText("Select from preview"));

    expect(onSelect).toHaveBeenCalledWith([mockResults[0]]);
  });

  it("does not show empty state before a search is performed", () => {
    renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

    expect(
      screen.queryByText(
        "No results found. Try adjusting your search or filters."
      )
    ).not.toBeInTheDocument();
  });

  describe("past searches", () => {
    const pastSession = {
      id: "sess-1",
      organizationId: "org-1",
      projectId: "proj-1",
      userId: "user-1",
      status: "COMPLETED",
      conversationId: "conv-1",
      sessionDate: "2026-04-12T00:00:00.000Z",
      title: "find recent design docs",
      hasUnsyncedChanges: false,
      type: "AGENT_SEARCH",
      serviceIds: ["service-1"],
      launchServiceId: "service-1",
    } as never;
    const pastSearches = [
      {
        sessionId: "sess-1",
        conversationId: "conv-1",
        query: "find recent design docs",
        sessionDate: "2026-04-12T00:00:00.000Z",
        session: pastSession,
      },
    ];

    it("passes title to createAgentSession when running a fresh agent search", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      fireEvent.click(screen.getByTestId("set-agent-mode"));
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "look up tasks" },
      });
      fireEvent.click(screen.getByText("Search"));

      expect(mockCreateAgentSession).toHaveBeenCalledTimes(1);
      const arg = mockCreateAgentSession.mock.calls[0][0];
      expect(arg.agentSession.title).toBe("look up tasks");
      expect(arg.agentSession.type).toBe("AGENT_SEARCH");
      expect(arg.agentSession).not.toHaveProperty("serviceIds");
      expect(arg.agentSession).not.toHaveProperty("launchServiceId");
    });

    it("hides the past-searches list in title mode", () => {
      mockUsePastSearches.mockReturnValue({ pastSearches, isLoading: false });
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      expect(
        screen.queryByTestId("past-searches-list")
      ).not.toBeInTheDocument();
    });

    it("renders the past-searches list once switched to agent mode and input is focused", () => {
      mockUsePastSearches.mockReturnValue({ pastSearches, isLoading: false });
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      fireEvent.click(screen.getByTestId("set-agent-mode"));
      fireEvent.focus(screen.getByTestId("search-input"));
      expect(screen.getByTestId("past-searches-list")).toBeInTheDocument();
      expect(screen.getByTestId("past-search-item")).toHaveTextContent(
        "find recent design docs"
      );
    });

    it("hides the (show advanced) toggle in agent mode", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      expect(screen.getByText("(show advanced)")).toBeInTheDocument();
      fireEvent.click(screen.getByTestId("set-agent-mode"));
      expect(screen.queryByText("(show advanced)")).not.toBeInTheDocument();
    });

    it("opens the existing session chat when a past search is selected (no new session created)", () => {
      mockUsePastSearches.mockReturnValue({ pastSearches, isLoading: false });
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      fireEvent.click(screen.getByTestId("set-agent-mode"));
      fireEvent.focus(screen.getByTestId("search-input"));
      fireEvent.click(screen.getByTestId("past-search-item"));

      expect(mockCreateAgentSession).not.toHaveBeenCalled();
      expect(screen.getByTestId("entity-search-chat")).toBeInTheDocument();
      expect(
        screen.queryByTestId("agent-search-service-selector")
      ).not.toBeInTheDocument();
      expect(entitySearchChatPropsSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          agentSession: expect.objectContaining({
            serviceIds: ["service-1"],
            launchServiceId: "service-1",
          }),
        })
      );
    });

    it("shows a New search button on the second toolbar row when an agent session is active", async () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      fireEvent.click(screen.getByTestId("set-agent-mode"));
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "q1" },
      });
      // Pre-condition: starting search requires entity types selected.
      // The hook mock returns no past searches by default; verify "New search"
      // appears after the agent-session onSuccess fires.
      fireEvent.click(screen.getByText("Search"));
      act(() => {
        createAgentSessionOnSuccess?.({
          id: "session-x",
          conversationId: "conv-x",
          status: "IN_PROGRESS",
        });
      });
      await waitFor(() => {
        expect(screen.getByTestId("agent-search-new")).toBeInTheDocument();
      });
    });

    it("persists the selected machine before exposing a fresh agent-search session", async () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      fireEvent.click(screen.getByTestId("set-agent-mode"));
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "find tasks" },
      });
      fireEvent.click(screen.getByText("Search"));

      act(() => {
        createAgentSessionOnSuccess?.({
          id: "session-machine-binding",
          conversationId: "conv-machine-binding",
          status: "IN_PROGRESS",
        });
      });

      await waitFor(() => {
        expect(bindAgentSessionMachineMock).toHaveBeenCalledWith({
          organizationId: "org-1",
          projectId: "proj-1",
          agentSessionId: "session-machine-binding",
          machineId: "machine-1",
        });
        expect(entitySearchChatPropsSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            agentSession: expect.objectContaining({
              id: "session-bound",
              machineId: "machine-1",
            }),
          })
        );
      });
    });
  });

  describe("agent-search ModelSelector toolbar", () => {
    const SURFACE_KEY = "hey-hey:agent-selection:agent-search";

    beforeEach(() => {
      localStorage.clear();
    });

    it("does not render the ModelSelector in title mode", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      expect(
        screen.queryByTestId("agent-search-model-selector-root")
      ).not.toBeInTheDocument();
    });

    it("renders the ModelSelector once switched to agent mode", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      fireEvent.click(screen.getByTestId("set-agent-mode"));
      expect(
        screen.getByTestId("agent-search-model-selector-root")
      ).toBeInTheDocument();
    });

    it("persists provider/model/effort changes under the agent-search key", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      fireEvent.click(screen.getByTestId("set-agent-mode"));

      fireEvent.click(
        screen.getByTestId("agent-search-model-selector-set-provider-codex")
      );
      const afterProvider = JSON.parse(
        localStorage.getItem(SURFACE_KEY) ?? "{}"
      );
      expect(afterProvider.provider).toBe("codex");

      fireEvent.click(
        screen.getByTestId("agent-search-model-selector-set-model")
      );
      const afterModel = JSON.parse(localStorage.getItem(SURFACE_KEY) ?? "{}");
      expect(afterModel.model).toBe("claude-sonnet-5-5");

      fireEvent.click(
        screen.getByTestId("agent-search-model-selector-set-effort-high")
      );
      const afterEffort = JSON.parse(localStorage.getItem(SURFACE_KEY) ?? "{}");
      expect(afterEffort.reasoningEffort).toBe("high");
    });

    it("persists Fast mode changes under the agent-search key", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      fireEvent.click(screen.getByTestId("set-agent-mode"));
      fireEvent.click(
        screen.getByTestId("agent-search-model-selector-set-fast-mode")
      );

      expect(
        JSON.parse(localStorage.getItem(SURFACE_KEY) ?? "{}").fastMode
      ).toBe(true);
    });

    it("hydrates the ModelSelector from a prefilled memory entry on mount", () => {
      localStorage.setItem(
        SURFACE_KEY,
        JSON.stringify({
          provider: "claude",
          model: "claude-sonnet-5-5",
          reasoningEffort: "high",
        })
      );

      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);
      fireEvent.click(screen.getByTestId("set-agent-mode"));

      expect(
        screen.getByTestId("agent-search-model-selector-state").textContent
      ).toBe("claude|claude-sonnet-5-5|high|false");
    });

    it("forwards the toolbar selection into EntitySearchChat once a session is active", async () => {
      localStorage.setItem(
        SURFACE_KEY,
        JSON.stringify({
          provider: "claude",
          model: "claude-sonnet-5-5",
          reasoningEffort: "high",
        })
      );

      entitySearchChatPropsSpy.mockClear();
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      fireEvent.click(screen.getByTestId("set-agent-mode"));
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "find docs" },
      });
      fireEvent.click(screen.getByText("Search"));
      act(() => {
        createAgentSessionOnSuccess?.({
          id: "session-y",
          conversationId: "conv-y",
          status: "IN_PROGRESS",
        });
      });

      await waitFor(() => {
        expect(entitySearchChatPropsSpy).toHaveBeenCalled();
      });
      const lastCall =
        entitySearchChatPropsSpy.mock.calls[
          entitySearchChatPropsSpy.mock.calls.length - 1
        ][0];
      expect(lastCall.selection).toEqual({
        provider: "claude",
        model: "claude-sonnet-5-5",
        reasoningEffort: "high",
      });
      expect(lastCall).not.toHaveProperty("entityTypes");
    });
  });

  describe("content search mode", () => {
    it("routes the query into the semantic search content argument", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      fireEvent.click(screen.getByTestId("set-content-mode"));
      fireEvent.change(screen.getByTestId("search-input"), {
        target: { value: "things about billing" },
      });
      fireEvent.click(screen.getByText("Search"));

      const calls = mockUseSemanticSearch.mock.calls;
      const lastCall = calls[calls.length - 1];
      // Positional args: (orgId, titleQuery, contentQuery, ...)
      expect(lastCall[1]).toBe("");
      expect(lastCall[2]).toBe("things about billing");
    });

    it("shows similarity scores on results in content mode", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      expect(screen.getByTestId("show-similarity-scores")).toHaveTextContent(
        "false"
      );

      fireEvent.click(screen.getByTestId("set-content-mode"));

      expect(screen.getByTestId("show-similarity-scores")).toHaveTextContent(
        "true"
      );
    });

    it("shows the imprecision helper caption only in content mode", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      expect(
        screen.queryByText(/ranked by meaning rather than/i)
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByTestId("set-content-mode"));

      expect(
        screen.getByText(/ranked by meaning rather than/i)
      ).toBeInTheDocument();
    });

    it("hides the ModelSelector and the advanced/status panel in content mode", () => {
      renderWithProviders(<AdvancedSearch {...DEFAULT_PROPS} />);

      fireEvent.click(screen.getByTestId("set-content-mode"));

      expect(
        screen.queryByTestId("agent-search-model-selector-root")
      ).not.toBeInTheDocument();
      expect(screen.queryByText("(show advanced)")).not.toBeInTheDocument();
    });
  });

  it("shows Cancel button in multi-select action bar when onClose is provided", () => {
    const mockResults = createMockSearchEntities(1);
    mockUseSemanticSearch.mockReturnValue({
      results: mockResults,
      isLoading: false,
      error: null,
    });
    mockUseSearchSelection.mockReturnValue(
      makeSelectionHook(new Set([mockResults[0].id]))
    );

    const onClose = vi.fn();
    renderWithProviders(
      <AdvancedSearch {...DEFAULT_PROPS} allowMultiSelect onClose={onClose} />
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });
});

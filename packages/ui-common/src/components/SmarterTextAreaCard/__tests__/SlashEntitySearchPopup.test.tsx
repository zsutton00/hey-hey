import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SlashEntitySearchPopup } from "../slashCommands/SlashEntitySearchPopup";
import { MENTION_SEARCH_DEBOUNCE_MS } from "../mentionQuery";
import type { EntitySearchScope, SearchEntity } from "../types";

const entityTypeScope = (...entityTypes: string[]): EntitySearchScope => ({
  kind: "entity-types",
  entityTypes,
});

const workItemTypeScope = (...taskTypes: string[]): EntitySearchScope => ({
  kind: "work-item-types",
  taskTypes,
});
import {
  EntityType,
  RelationshipValue,
  type FullEntityContextDto,
} from "../../../api";
import { entityContextKeys } from "../../../data/collections/entityContext";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | { defaultValue?: string }) =>
      typeof fallback === "string" ? fallback : fallback.defaultValue ?? "",
  }),
}));

const createSearchEntity = (
  overrides: Partial<SearchEntity> = {}
): SearchEntity => ({
  id: "entity-1",
  type: "task",
  name: "Entity One",
  description: "Entity description",
  ...overrides,
});

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

const createDeferred = <T,>(): Deferred<T> => {
  let resolveDeferred: ((value: T) => void) | null = null;
  let rejectDeferred: ((reason: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });

  return {
    promise,
    resolve: (value: T) => {
      resolveDeferred?.(value);
    },
    reject: (reason: unknown) => {
      rejectDeferred?.(reason);
    },
  };
};

const seedCachedContext = (
  store: QueryClient,
  context: FullEntityContextDto
): void => {
  const queryKey = entityContextKeys.context({
    organizationId: "org-1",
    projectId: "project-1",
    entityType: context.entityType,
    entityId: context.entityId,
    includeRelatedEntities: true,
  });
  store.setQueryData(queryKey, context);
};

describe("SlashEntitySearchPopup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows type-to-search guidance for an empty query", async () => {
    const onSearchEntities = vi.fn().mockResolvedValue([]);

    render(
      <SlashEntitySearchPopup
        query=""
        onSearchEntities={onSearchEntities}
        searchScope={entityTypeScope("task")}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(
      screen.getByTestId("slash-entity-search-empty-state")
    ).toHaveTextContent("Type to search");
    expect(
      screen.queryByTestId("slash-entity-search-empty-results")
    ).not.toBeInTheDocument();
    expect(onSearchEntities).not.toHaveBeenCalled();
  });

  it("shows exactly one View action for a settled typed empty state", async () => {
    const onViewAll = vi.fn();
    const onViewAllAvailabilityChange = vi.fn();
    render(
      <SlashEntitySearchPopup
        query="missing"
        onSearchEntities={vi.fn().mockResolvedValue([])}
        searchScope={workItemTypeScope("CONTRACT")}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={vi.fn()}
        onViewAll={onViewAll}
        isViewAllSelected
        onViewAllAvailabilityChange={onViewAllAvailabilityChange}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    const viewActions = screen.getAllByTestId("slash-entity-search-view");
    expect(viewActions).toHaveLength(1);
    expect(viewActions[0]).toHaveTextContent("View all");
    expect(viewActions[0]).toHaveAttribute("aria-selected", "true");
    expect(onViewAllAvailabilityChange).toHaveBeenCalledWith(true);
    fireEvent.click(viewActions[0]);
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it("shows cached likely options, selects them canonically, and replaces them on search", async () => {
    const store = new QueryClient();
    seedCachedContext(store, {
      entityId: "focus-1",
      entityType: EntityType.Task,
      displayName: "Focus task",
      createdAt: "2026-07-15T00:00:00.000Z",
      relatedEntities: [
        {
          entityId: "likely-task",
          entityType: EntityType.Task,
          displayName: "Likely task",
          relationship: RelationshipValue.RelatedTo,
          taskType: "STANDARD",
          status: "ACTIVE",
        },
        {
          entityId: "archived-task",
          entityType: EntityType.Task,
          displayName: "Archived task",
          relationship: RelationshipValue.RelatedTo,
          taskType: "STANDARD",
          status: "ARCHIVED",
        },
      ],
    });
    const searchedResult = createSearchEntity({
      id: "searched-task",
      name: "Searched task",
    });
    const onSearchEntities = vi.fn().mockResolvedValue([searchedResult]);
    const onSelectEntity = vi.fn();
    const commonProps = {
      onSearchEntities,
      searchScope: workItemTypeScope("STANDARD"),
      organizationId: "org-1",
      projectId: "project-1",
      focalEntity: {
        kind: "entity" as const,
        entityType: EntityType.Task,
        entityId: "focus-1",
      },
      selectedIndex: 0,
      onSelectedIndexChange: vi.fn(),
      onSelectEntity,
    };

    const { rerender } = render(
      <QueryClientProvider client={store}>
        <SlashEntitySearchPopup {...commonProps} query="" />
      </QueryClientProvider>
    );

    expect(
      screen.getByTestId("slash-entity-search-related-label")
    ).toHaveTextContent("Related tasks");
    expect(screen.getByText("Likely task")).toBeInTheDocument();
    expect(screen.queryByText("Archived task")).not.toBeInTheDocument();
    expect(onSearchEntities).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("slash-entity-search-row"));
    expect(onSelectEntity).toHaveBeenCalledWith(
      expect.objectContaining({ id: "likely-task", type: "task" })
    );

    rerender(
      <QueryClientProvider client={store}>
        <SlashEntitySearchPopup {...commonProps} query="searched" />
      </QueryClientProvider>
    );
    expect(screen.queryByText("Likely task")).not.toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });
    expect(screen.getByText("Searched task")).toBeInTheDocument();
    expect(
      screen.queryByTestId("slash-entity-search-related-label")
    ).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={store}>
        <SlashEntitySearchPopup
          {...commonProps}
          query=""
          focalEntity={{ kind: "none" }}
        />
      </QueryClientProvider>
    );
    expect(
      screen.getByTestId("slash-entity-search-empty-state")
    ).toHaveTextContent("Type to search");
    expect(screen.queryByText("Searched task")).not.toBeInTheDocument();
  });

  it("merges conversation options with focal options, deduplicates, and filters by the active type", () => {
    const store = new QueryClient();
    seedCachedContext(store, {
      entityId: "focus-1",
      entityType: EntityType.Task,
      displayName: "Focus task",
      createdAt: "2026-07-15T00:00:00.000Z",
      relatedEntities: [
        {
          entityId: "shared-task",
          entityType: EntityType.Task,
          displayName: "Focal title wins",
          relationship: RelationshipValue.RelatedTo,
          taskType: "STANDARD",
          status: "ACTIVE",
        },
      ],
    });

    render(
      <QueryClientProvider client={store}>
        <SlashEntitySearchPopup
          query=""
          onSearchEntities={vi.fn().mockResolvedValue([])}
          searchScope={workItemTypeScope("STANDARD")}
          organizationId="org-1"
          projectId="project-1"
          focalEntity={{
            kind: "entity",
            entityType: EntityType.Task,
            entityId: "focus-1",
          }}
          cachedConversationMentionOptions={[
            { id: "shared-task", type: "task", name: "Conversation title" },
            { id: "new-task", type: "task", name: "Conversation task" },
            { id: "feature-1", type: "feature", name: "Wrong type" },
          ]}
          selectedIndex={-1}
          onSelectedIndexChange={vi.fn()}
          onSelectEntity={vi.fn()}
        />
      </QueryClientProvider>
    );

    expect(screen.getAllByTestId("slash-entity-search-row")).toHaveLength(2);
    expect(screen.getByText("Focal title wins")).toBeInTheDocument();
    expect(screen.getByText("Conversation task")).toBeInTheDocument();
    expect(screen.queryByText("Wrong type")).not.toBeInTheDocument();
  });

  it("updates an open popup when focal Context arrives and scopes feature, task, and contract commands", () => {
    const store = new QueryClient();
    const onSearchEntities = vi.fn().mockResolvedValue([]);
    const focalEntity = {
      kind: "entity" as const,
      entityType: EntityType.Task,
      entityId: "slash-commands-feature",
    };
    const commonProps = {
      query: "",
      onSearchEntities,
      organizationId: "org-1",
      projectId: "project-1",
      focalEntity,
      selectedIndex: 0,
      onSelectedIndexChange: vi.fn(),
      onSelectEntity: vi.fn(),
    };
    const { rerender } = render(
      <QueryClientProvider client={store}>
        <SlashEntitySearchPopup
          {...commonProps}
          searchScope={workItemTypeScope("FEATURE")}
        />
      </QueryClientProvider>
    );

    expect(
      screen.getByTestId("slash-entity-search-empty-state")
    ).toBeInTheDocument();

    act(() => {
      seedCachedContext(store, {
        entityId: "slash-commands-feature",
        entityType: EntityType.Task,
        displayName: "Slash Commands",
        createdAt: "2026-07-15T00:00:00.000Z",
        relatedEntities: [
          {
            entityId: "standard-task",
            entityType: EntityType.Task,
            displayName: "Standard task",
            relationship: RelationshipValue.RelatedTo,
            taskType: "STANDARD",
            status: "ACTIVE",
          },
          {
            entityId: "contract-task",
            entityType: EntityType.Task,
            displayName: "Contract task",
            relationship: RelationshipValue.RelatedTo,
            taskType: "CONTRACT",
            status: "ACTIVE",
          },
        ],
        featureHierarchy: [
          {
            id: "related-feature",
            name: "Related feature",
            relationshipType: "RELATED_TO",
            direction: "outbound",
          },
        ],
      });
    });

    expect(
      screen.getByTestId("slash-entity-search-related-label")
    ).toHaveTextContent("Related features");
    expect(screen.getByText("Related feature")).toBeInTheDocument();
    expect(screen.queryByText("Standard task")).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={store}>
        <SlashEntitySearchPopup
          {...commonProps}
          searchScope={workItemTypeScope("STANDARD")}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText("Standard task")).toBeInTheDocument();
    expect(
      screen.getByTestId("slash-entity-search-related-label")
    ).toHaveTextContent("Related tasks");
    expect(screen.queryByText("Related feature")).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={store}>
        <SlashEntitySearchPopup
          {...commonProps}
          searchScope={workItemTypeScope("CONTRACT")}
        />
      </QueryClientProvider>
    );
    expect(screen.getByText("Contract task")).toBeInTheDocument();
    expect(
      screen.getByTestId("slash-entity-search-related-label")
    ).toHaveTextContent("Related contracts");
    expect(screen.queryByText("Standard task")).not.toBeInTheDocument();
    expect(onSearchEntities).not.toHaveBeenCalled();
  });

  it("keeps the no-results message once a real search returns nothing", async () => {
    const onSearchEntities = vi.fn().mockResolvedValue([]);

    render(
      <SlashEntitySearchPopup
        query="billing"
        onSearchEntities={onSearchEntities}
        searchScope={entityTypeScope("task")}
        selectedIndex={-1}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(
      screen.getByTestId("slash-entity-search-empty-results")
    ).toHaveTextContent("No matches found");
    expect(
      screen.queryByTestId("slash-entity-search-empty-state")
    ).not.toBeInTheDocument();
    expect(onSearchEntities).toHaveBeenCalledWith(
      "billing",
      entityTypeScope("task")
    );
  });

  it("renders results when the search returns matches", async () => {
    const onSearchEntities = vi.fn().mockResolvedValue([createSearchEntity()]);

    render(
      <SlashEntitySearchPopup
        query="billing"
        onSearchEntities={onSearchEntities}
        searchScope={entityTypeScope("task")}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    const row = screen.getByTestId("slash-entity-search-row");
    expect(row).toBeInTheDocument();
    expect(row).toHaveAttribute("data-entity-id", "entity-1");
    expect(
      screen.queryByTestId("slash-entity-search-empty-state")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("slash-entity-search-empty-results")
    ).not.toBeInTheDocument();
  });

  it("renders workflow result labels", async () => {
    const onSearchEntities = vi.fn().mockResolvedValue([
      createSearchEntity({
        id: "workflow-1",
        type: "workflow",
        name: "Plan review workflow",
      }),
    ]);

    render(
      <SlashEntitySearchPopup
        query="plan"
        onSearchEntities={onSearchEntities}
        searchScope={workItemTypeScope("workflow")}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      await Promise.resolve();
    });

    expect(screen.getByText("Workflow")).toBeInTheDocument();
    expect(screen.queryByText("workflow")).not.toBeInTheDocument();
  });

  it("keeps previous results visible while a refined query is updating and blocks stale clicks", async () => {
    const firstSearch = createDeferred<SearchEntity[]>();
    const secondSearch = createDeferred<SearchEntity[]>();
    const previousResult = createSearchEntity({
      id: "task-old",
      name: "Old Task",
    });
    const onSearchEntities = vi
      .fn()
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise);
    const onSelectEntity = vi.fn();
    const searchScope = entityTypeScope("task");

    const { rerender } = render(
      <SlashEntitySearchPopup
        query="old"
        onSearchEntities={onSearchEntities}
        searchScope={searchScope}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={onSelectEntity}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      firstSearch.resolve([previousResult]);
      await Promise.resolve();
    });

    expect(screen.getByText("Old Task")).toBeInTheDocument();

    rerender(
      <SlashEntitySearchPopup
        query="old t"
        onSearchEntities={onSearchEntities}
        searchScope={searchScope}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={onSelectEntity}
      />
    );

    expect(
      screen.getByTestId("slash-entity-search-updating")
    ).toBeInTheDocument();
    const staleRow = screen.getByTestId("slash-entity-search-row");
    expect(staleRow).toHaveAttribute(
      "data-result-freshness",
      "stale-while-updating"
    );
    expect(staleRow).toHaveAttribute("aria-disabled", "true");

    fireEvent.click(staleRow);

    expect(onSelectEntity).not.toHaveBeenCalled();
  });

  it("ignores out-of-order responses so an older query cannot replace newer results", async () => {
    const firstSearch = createDeferred<SearchEntity[]>();
    const secondSearch = createDeferred<SearchEntity[]>();
    const onSearchEntities = vi
      .fn()
      .mockReturnValueOnce(firstSearch.promise)
      .mockReturnValueOnce(secondSearch.promise);
    const searchScope = entityTypeScope("task");

    const { rerender } = render(
      <SlashEntitySearchPopup
        query="alpha"
        onSearchEntities={onSearchEntities}
        searchScope={searchScope}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
    });

    rerender(
      <SlashEntitySearchPopup
        query="beta"
        onSearchEntities={onSearchEntities}
        searchScope={searchScope}
        selectedIndex={0}
        onSelectedIndexChange={vi.fn()}
        onSelectEntity={vi.fn()}
      />
    );

    await act(async () => {
      vi.advanceTimersByTime(MENTION_SEARCH_DEBOUNCE_MS);
      secondSearch.resolve([
        createSearchEntity({
          id: "beta-result",
          name: "Beta Result",
        }),
      ]);
      await Promise.resolve();
    });

    expect(screen.getByText("Beta Result")).toBeInTheDocument();

    await act(async () => {
      firstSearch.resolve([
        createSearchEntity({
          id: "alpha-result",
          name: "Alpha Result",
        }),
      ]);
      await Promise.resolve();
    });

    expect(screen.getByText("Beta Result")).toBeInTheDocument();
    expect(screen.queryByText("Alpha Result")).not.toBeInTheDocument();
  });
});

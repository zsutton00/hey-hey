import { createElement, type PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EntityType,
  TaskSource,
  WorkStatus,
  type FullEntityContextDto,
  type TopologyEntitySummaryDto,
  type TopologyCategorySummaryDto,
  type TopologySubfacetDto,
  type WorkItemGraphAggregateResponseDto,
} from "../../../api";
import {
  platformClient,
  unifiedApiClient,
  entityContextClient,
} from "../../../clients/serviceClients";
import { useTopologyEntitySummaries } from "../../hooks/useTopologyEntitySummaries";
import { useTopologyCategorySummaries } from "../../hooks/useTopologyCategorySummaries";
import { useTopologySubfacets } from "../../hooks/useTopologySubfacets";
import { useWorkItemGraph } from "../../hooks/useWorkItemGraph";
import { useFullEntityContext } from "../../hooks/useFullEntityContext";
import { topologyKeys } from "../../collections/topologyKeys";
import { workItemGraphKeys } from "../../collections/workItemGraphs";
import { entityContextKeys } from "../../collections/entityContext";
import { WebSocketHandler } from "../../websockets/handler";
import { invalidateAllDataLayerQueries } from "../dataLayerInvalidation";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    listTopologyEntitySummaries: vi.fn(),
    listTopologyCategorySummaries: vi.fn(),
    listTopologySubfacets: vi.fn(),
  },
  unifiedApiClient: { getWorkItemGraph: vi.fn() },
  entityContextClient: { getEntityContext: vi.fn() },
}));

const timestamp = "2026-08-18T00:00:00.000Z";
const summaries: TopologyEntitySummaryDto[] = [
  {
    entityId: "entity",
    entityType: "TASK",
    category: "technology",
    summary: "Summary",
    updatedAt: timestamp,
    subfacets: [],
  },
];
const categories: TopologyCategorySummaryDto[] = [
  { category: "technology", summary: "Technology", lastUpdated: timestamp },
];
const subfacets: TopologySubfacetDto[] = [
  {
    id: "facet",
    name: "Data",
    slug: "data",
    category: "technology",
    status: "ACTIVE",
    createdAt: timestamp,
    updatedAt: timestamp,
  },
];
const graph: WorkItemGraphAggregateResponseDto = {
  root: {
    id: "root",
    name: "Workflow",
    type: "workflow",
    sections: [],
    organizationId: "org",
    projectId: "project",
    status: WorkStatus.Backlog,
    source: TaskSource.System,
    createdAt: timestamp,
    updatedAt: timestamp,
  },
  children: [],
  relationships: [],
  layout: null,
  derivedReferences: [],
};
const context: FullEntityContextDto = {
  entityId: "root",
  entityType: EntityType.Task,
  displayName: "Root",
  createdAt: timestamp,
};
const contextParams = {
  organizationId: "org",
  projectId: "project",
  entityId: "root",
  entityType: EntityType.Task,
  includeRelatedEntities: true,
};

const datasets = [
  {
    name: "entity summaries",
    use: (enabled = true) =>
      useTopologyEntitySummaries("org", "project", { enabled }),
    api: platformClient.listTopologyEntitySummaries,
    data: summaries,
    empty: [],
    key: topologyKeys.entitySummaries("org", "project"),
  },
  {
    name: "category summaries",
    use: (enabled = true) =>
      useTopologyCategorySummaries("org", "project", { enabled }),
    api: platformClient.listTopologyCategorySummaries,
    data: categories,
    empty: [],
    key: topologyKeys.categorySummaries("org", "project"),
  },
  {
    name: "subfacets",
    use: (enabled = true) =>
      useTopologySubfacets("org", "project", { enabled }),
    api: platformClient.listTopologySubfacets,
    data: subfacets,
    empty: [],
    key: topologyKeys.subfacets("org", "project"),
  },
  {
    name: "graph",
    use: (enabled = true) =>
      useWorkItemGraph("org", "project", "root", { enabled }),
    api: unifiedApiClient.getWorkItemGraph,
    data: graph,
    empty: null,
    key: workItemGraphKeys.byId("org", "project", "root"),
  },
  {
    name: "context",
    use: (enabled = true) =>
      useFullEntityContext({ ...contextParams, enabled }),
    api: entityContextClient.getEntityContext,
    data: context,
    empty: null,
    key: entityContextKeys.context(contextParams),
  },
];

function harness() {
  const client = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  return {
    client,
    wrapper: ({ children }: PropsWithChildren) =>
      createElement(QueryClientProvider, { client }, children),
  };
}

beforeEach(() => vi.clearAllMocks());

describe.each(datasets)("$name", (dataset) => {
  it("shares initial reads and fresh remounts, then reconnects once for mounted consumers", async () => {
    // Deferred response proves a second consumer joins the actual in-flight read.
    let resolve!: (value: unknown) => void;
    vi.mocked(dataset.api).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }) as never
    );
    const { client, wrapper } = harness();
    const first = renderHook(() => dataset.use(), { wrapper });
    const second = renderHook(() => dataset.use(), { wrapper });
    expect(dataset.api).toHaveBeenCalledTimes(1);
    expect(first.result.current).toMatchObject({
      isLoading: true,
      isFetched: false,
      error: null,
    });
    await act(async () => resolve({ data: { data: dataset.data } }));
    await waitFor(() =>
      expect(second.result.current.data).toEqual(dataset.data)
    );
    const third = renderHook(() => dataset.use(), { wrapper });
    expect(third.result.current.data).toEqual(dataset.data);
    expect(dataset.api).toHaveBeenCalledTimes(1);
    vi.mocked(dataset.api).mockResolvedValue({
      data: { data: dataset.data },
    } as never);
    await act(async () => {
      new WebSocketHandler(createStore(), undefined, client).markAllStale();
    });
    await waitFor(() => expect(dataset.api).toHaveBeenCalledTimes(2));
    first.unmount();
    second.unmount();
    third.unmount();
    await act(async () => {
      await invalidateAllDataLayerQueries(client);
    });
    expect(dataset.api).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(dataset.key)?.isInvalidated).toBe(true);
  });

  it("keeps unstarted reads non-error and only reports empty after success", async () => {
    vi.mocked(dataset.api).mockResolvedValue({
      data: { data: dataset.empty },
    } as never);
    const { wrapper } = harness();
    const { result, rerender } = renderHook(
      ({ enabled }) => dataset.use(enabled),
      { wrapper, initialProps: { enabled: false } }
    );
    expect(result.current).toMatchObject({
      isLoading: false,
      isFetched: false,
      error: null,
    });
    expect(dataset.api).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.isFetched).toBe(true));
    expect(result.current.data).toEqual(dataset.empty);
    expect(result.current.error).toBeNull();
  });

  it("reports settled failure and recovers through explicit refresh", async () => {
    const error = Object.assign(new Error("Forbidden"), { status: 403 });
    vi.mocked(dataset.api).mockRejectedValue(error);
    const { wrapper } = harness();
    const { result } = renderHook(() => dataset.use(), { wrapper });
    await waitFor(() =>
      expect(result.current.error).toEqual(
        dataset.name === "context" ? error.message : error
      )
    );
    expect(result.current.isLoading).toBe(false);
    expect(dataset.api).toHaveBeenCalledTimes(1);
    vi.mocked(dataset.api).mockResolvedValue({
      data: { data: dataset.data },
    } as never);
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data).toEqual(dataset.data));
    expect(result.current.error).toBeNull();
  });

  it("starts a new read after reconnect during the first request", async () => {
    vi.mocked(dataset.api)
      .mockImplementationOnce(() => new Promise(() => {}) as never)
      .mockResolvedValue({ data: { data: dataset.data } } as never);
    const { client, wrapper } = harness();
    const { result } = renderHook(() => dataset.use(), { wrapper });
    expect(dataset.api).toHaveBeenCalledTimes(1);
    await act(async () => {
      await invalidateAllDataLayerQueries(client);
    });
    await waitFor(() => expect(result.current.data).toEqual(dataset.data));
    expect(dataset.api).toHaveBeenCalledTimes(2);
  });
});

it("normalizes set filters without collapsing genuinely different variants", () => {
  expect(
    topologyKeys.entitySummaries("org", "project", {
      subfacetId: ["b", "a", "a"],
    })
  ).toEqual(
    topologyKeys.entitySummaries("org", "project", { subfacetId: ["a", "b"] })
  );
  expect(
    workItemGraphKeys.byId("org", "project", "root", ["CONSUMES", "IMPLEMENTS"])
  ).toEqual(
    workItemGraphKeys.byId("org", "project", "root", ["IMPLEMENTS", "CONSUMES"])
  );
  expect(entityContextKeys.context(contextParams)).not.toEqual(
    entityContextKeys.context({
      ...contextParams,
      includeRelatedEntities: false,
    })
  );
  expect(
    topologyKeys.entitySummaries("org", "project", { since: timestamp })
  ).not.toEqual(topologyKeys.entitySummaries("org", "project"));
});

it("invalidating one topology key refreshes its consumers without waking other datasets", async () => {
  vi.mocked(platformClient.listTopologyEntitySummaries).mockResolvedValue({
    data: { data: summaries },
  } as never);
  vi.mocked(platformClient.listTopologyCategorySummaries).mockResolvedValue({
    data: { data: categories },
  } as never);
  const { wrapper } = harness();
  const first = renderHook(() => useTopologyEntitySummaries("org", "project"), {
    wrapper,
  });
  renderHook(() => useTopologyEntitySummaries("org", "project"), { wrapper });
  const other = renderHook(
    () => useTopologyCategorySummaries("org", "project"),
    { wrapper }
  );
  await waitFor(() =>
    expect(first.result.current.isReady && other.result.current.isReady).toBe(
      true
    )
  );
  let resolve!: (value: unknown) => void;
  vi.mocked(platformClient.listTopologyEntitySummaries).mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }) as never
  );
  act(() => first.result.current.markStale());
  await waitFor(() => expect(first.result.current.isFetching).toBe(true));
  expect(first.result.current.data).toEqual(summaries);
  expect(first.result.current.error).toBeNull();
  expect(platformClient.listTopologyEntitySummaries).toHaveBeenCalledTimes(2);
  expect(platformClient.listTopologyCategorySummaries).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ data: { data: [] } }));
  await waitFor(() => expect(first.result.current.data).toEqual([]));
  expect(first.result.current.isReady).toBe(true);
});

it("passes canonical filters, graph participation and context flags through to their providers", async () => {
  vi.mocked(platformClient.listTopologyEntitySummaries).mockResolvedValue({
    data: { data: summaries },
  } as never);
  vi.mocked(platformClient.listTopologySubfacets).mockResolvedValue({
    data: { data: subfacets },
  } as never);
  vi.mocked(unifiedApiClient.getWorkItemGraph).mockResolvedValue({
    data: { data: graph },
  } as never);
  vi.mocked(entityContextClient.getEntityContext).mockResolvedValue({
    data: { data: context },
  } as never);
  const { wrapper } = harness();
  const read = renderHook(
    () => ({
      summaries: useTopologyEntitySummaries("org", "project", {
        category: "technology",
        subfacetId: ["b", "a", "a"],
        since: timestamp,
        limitPerSubfacet: 7,
      }),
      subfacets: useTopologySubfacets("org", "project", {
        category: "technology",
        status: "ACTIVE",
      }),
      graph: useWorkItemGraph("org", "project", "root", {
        incidentRelationshipTypes: ["IMPLEMENTS", "CONSUMES", "CONSUMES"],
      }),
      context: useFullEntityContext({
        ...contextParams,
        includeFeatureHierarchy: true,
        includeProposals: false,
        includeAvailableMcpTools: true,
      }),
    }),
    { wrapper }
  );
  await waitFor(() => expect(read.result.current.context.isFetched).toBe(true));
  const requestOptions = expect.objectContaining({
    signal: expect.any(AbortSignal),
  });
  expect(platformClient.listTopologyEntitySummaries).toHaveBeenCalledWith(
    {
      organizationId: "org",
      projectId: "project",
      category: "technology",
      subfacetId: ["a", "b"],
      since: timestamp,
      limitPerSubfacet: 7,
    },
    requestOptions
  );
  expect(platformClient.listTopologySubfacets).toHaveBeenCalledWith(
    {
      organizationId: "org",
      projectId: "project",
      category: "technology",
      status: "ACTIVE",
    },
    requestOptions
  );
  expect(unifiedApiClient.getWorkItemGraph).toHaveBeenCalledWith(
    {
      organizationId: "org",
      projectId: "project",
      workItemId: "root",
      incidentRelationshipTypes: new Set(["CONSUMES", "IMPLEMENTS"]),
    },
    requestOptions
  );
  expect(entityContextClient.getEntityContext).toHaveBeenCalledWith(
    {
      ...contextParams,
      includeFeatureHierarchy: true,
      includeProposals: false,
      includeAvailableMcpTools: true,
      relatedEntityDepth: 1,
    },
    requestOptions
  );
});

it("markStale during an initial read requires a read starting after the invalidation", async () => {
  vi.mocked(platformClient.listTopologyEntitySummaries)
    .mockImplementationOnce(() => new Promise(() => {}) as never)
    .mockResolvedValue({ data: { data: summaries } } as never);
  const { wrapper } = harness();
  const { result } = renderHook(
    () => useTopologyEntitySummaries("org", "project"),
    { wrapper }
  );
  expect(platformClient.listTopologyEntitySummaries).toHaveBeenCalledTimes(1);
  act(() => result.current.markStale());
  await waitFor(() => expect(result.current.data).toEqual(summaries));
  expect(platformClient.listTopologyEntitySummaries).toHaveBeenCalledTimes(2);
});

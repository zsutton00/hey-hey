import { ApolloProvider } from "@apollo/client/react";
import axios, { type InternalAxiosRequestConfig } from "axios";
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus } from "../../../api";
import { nodeOf, referenceOf } from "../../../test/workItemGraphQLAnswers";
import { fetchFeaturePages } from "../../collections/featureDocumentContent";
import { WebUiGraphQLClient } from "../../graphql/client";
import { refreshWorkItemLists } from "../../graphql/workItemCache";
import { WebSocketHandler } from "../../websockets/handler";
import { invalidateProjectWorkItemQueries } from "../../query/dataLayerInvalidation";
import {
  useFeatureHierarchy,
  useFeatureTreePageData,
} from "../useFeatureHierarchy";
import { useFeatureDocumentContent } from "../useFeatureDocumentContent";
import { useRelationshipMutationInvalidation } from "../relationshipMutationInvalidation";

const mocks = vi.hoisted(() => ({
  getTasks: vi.fn(),
  listWorkItemReferences: vi.fn(),
  updateTask: vi.fn(),
}));
vi.mock("../../../clients/serviceClients", () => ({ unifiedApiClient: mocks }));

/**
 * The GraphQL endpoint, answering work-item reads from the same fakes the
 * REST list and reference reads were mocked with: each read is translated
 * into the request it stands for, and the answer into GraphQL nodes.
 */
let graphql: WebUiGraphQLClient;
const answer = async (config: InternalAxiosRequestConfig) => {
  const { operationName, variables } = JSON.parse(String(config.data));
  const respond = (body: unknown, status = 200) => ({
    data: JSON.stringify(body),
    status,
    statusText: "",
    headers: { "content-type": "application/json" },
    config,
  });
  try {
    if (operationName === "GetWorkItems") {
      const request = Object.fromEntries(
        Object.entries({
          taskIds: variables.ids,
          parentTaskId: variables.parentTaskId,
          includeDescendants: variables.includeDescendants,
          type: variables.type,
          includeSectionKeys: variables.sectionKeys,
          page: variables.page,
          limit: variables.limit,
        }).filter(([, value]) => value !== undefined),
      );
      const { data } = await mocks.getTasks(request);
      return respond({
        data: {
          workItems: data.data.map((item: never) => nodeOf(item, variables)),
        },
      });
    }
    // GetAllWorkItemReferences: every page, as the server reads them.
    const references: unknown[] = [];
    for (let page = 1; ; page += 1) {
      const { data } = await mocks.listWorkItemReferences({ page });
      references.push(...data.data.items.map(referenceOf));
      if (!data.data.pagination.hasNext) break;
    }
    return respond({ data: { references } });
  } catch (error) {
    return respond({ errors: [{ message: (error as Error).message }] }, 500);
  }
};
const graphqlWrapper = ({ children }: { children: React.ReactNode }) => (
  <ApolloProvider client={graphql.apollo}>{children}</ApolloProvider>
);
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));
const task = (id: string, name = id) => ({
  id,
  name,
  type: "FEATURE",
  organizationId: "org",
  projectId: "project",
  status: WorkStatus.Backlog,
  source: TaskSource.User,
});
const response = (ids: string[]) => ({
  data: { data: ids.map((id) => task(id)) },
});
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const clientWrapper =
  (client: QueryClient, store = createStore()) =>
  ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <Provider store={store}>{graphqlWrapper({ children })}</Provider>
    </QueryClientProvider>
  );
const echoTasks = () =>
  mocks.getTasks.mockImplementation(({ taskIds }: { taskIds: string[] }) =>
    Promise.resolve(response(taskIds)),
  );

beforeEach(() => {
  vi.resetAllMocks();
  graphql = new WebUiGraphQLClient(() =>
    axios.create({ adapter: (config) => answer(config) }),
  );
});

describe("feature content queries", () => {
  it("settles a large feature set without per-result work growing with the set", async () => {
    echoTasks();
    const client = createClient();
    const ids = Array.from({ length: 400 }, (_, i) => `feature-${i}`);
    const { result } = renderHook(
      () => useFeatureDocumentContent("org", "project", ids),
      { wrapper: clientWrapper(client) },
    );
    const started = performance.now();
    await waitFor(
      () =>
        expect(
          [...result.current.entries.values()].every(
            (entry) => entry.status === "ready",
          ),
        ).toBe(true),
      { timeout: 20_000 },
    );
    // Each settled id notifies the whole set; that must stay linear per
    // notification (the regression was cubic and froze the page for seconds).
    expect(performance.now() - started).toBeLessThan(1_500);
  });

  it("coalesces concurrent consumers into bounded batches and reads each id once", async () => {
    echoTasks();
    const client = createClient();
    const wrapper = clientWrapper(client);
    const many = Array.from({ length: 205 }, (_, i) => `new-${i}`);
    const { result } = renderHook(
      () => ({
        first: useFeatureDocumentContent("org", "project", ["a", "b"]),
        second: useFeatureDocumentContent("org", "project", ["b", "c"]),
      }),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.second.entries.get("c")?.status).toBe("ready"),
    );
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
    expect(mocks.getTasks.mock.calls[0][0].taskIds).toEqual(["a", "b", "c"]);

    const { result: later } = renderHook(
      () =>
        useFeatureDocumentContent("org", "project", ["a", "b", "c", ...many]),
      { wrapper },
    );
    expect(later.current.entries.get("a")?.status).toBe("ready");
    await waitFor(() =>
      expect(later.current.entries.get("new-204")?.status).toBe("ready"),
    );
    expect(
      mocks.getTasks.mock.calls
        .slice(1)
        .map(([request]) => request.taskIds.length),
    ).toEqual([100, 100, 5]);
    for (const [request] of mocks.getTasks.mock.calls) {
      expect(request.includeSectionKeys).toEqual([
        "description",
        "requirements",
      ]);
      expect(request.type).toBe("FEATURE");
    }
  });

  it("reads the root by id and traverses every descendant page once", async () => {
    mocks.getTasks.mockImplementation(
      ({ taskIds, page }: { taskIds?: string[]; page: number }) =>
        Promise.resolve(
          taskIds
            ? response(taskIds)
            : response(
                page === 1
                  ? Array.from({ length: 500 }, (_, i) => `child-${i}`)
                  : ["last-child"],
              ),
        ),
    );
    const client = createClient();
    const wrapper = clientWrapper(client);
    const selectedRoot = { id: "root", descendantIds: ["last-child", "gone"] };
    const { result } = renderHook(
      () => useFeatureDocumentContent("org", "project", [], selectedRoot),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.entries.get("last-child")?.status).toBe("ready"),
    );
    expect(result.current.entries.get("root")?.status).toBe("ready");
    expect(result.current.entries.get("gone")?.status).toBe("error");
    expect(
      mocks.getTasks.mock.calls
        .filter(([request]) => request.parentTaskId)
        .map(([request]) => request.page),
    ).toEqual([1, 2]);
    expect(mocks.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskId: "root",
        includeDescendants: true,
        type: "FEATURE",
        includeSectionKeys: ["description", "requirements"],
      }),
    );
    const calls = mocks.getTasks.mock.calls.length;
    renderHook(
      () => ({
        subtree: useFeatureDocumentContent("org", "project", [], selectedRoot),
        // Descendants loaded by the traversal are served by id from cache.
        byId: useFeatureDocumentContent("org", "project", ["child-7"]),
      }),
      { wrapper },
    );
    expect(mocks.getTasks).toHaveBeenCalledTimes(calls);
  });

  it("requests a terminal page for exact page multiples", async () => {
    mocks.getTasks
      .mockResolvedValueOnce(
        response(Array.from({ length: 500 }, (_, i) => String(i))),
      )
      .mockResolvedValueOnce(response([]));
    expect(
      await fetchFeaturePages(
        graphql.apollo,
        "org",
        "project",
        { parentTaskId: "root", includeDescendants: true },
        ["description", "requirements"],
      ),
    ).toHaveLength(500);
    expect(mocks.getTasks).toHaveBeenCalledTimes(2);
  });

  it("keeps failures per feature and retries only on request", async () => {
    mocks.getTasks
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response(["a"]));
    const client = createClient();
    const wrapper = clientWrapper(client);
    const { result } = renderHook(
      () => useFeatureDocumentContent("org", "project", ["a"]),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.entries.get("a")?.status).toBe("error"),
    );
    renderHook(() => useFeatureDocumentContent("org", "project", ["a"]), {
      wrapper,
    });
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.retry("a");
    });
    await waitFor(() =>
      expect(result.current.entries.get("a")?.status).toBe("ready"),
    );
    expect(mocks.getTasks).toHaveBeenCalledTimes(2);
  });

  it("keeps displayed content while invalidated and only the newest read wins", async () => {
    const old = deferred<ReturnType<typeof response>>();
    mocks.getTasks
      .mockResolvedValueOnce(response(["a"]))
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ data: { data: [task("a", "Newest")] } });
    const client = createClient();
    const wrapper = clientWrapper(client);
    const { result } = renderHook(
      () => useFeatureDocumentContent("org", "project", ["a"]),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.entries.get("a")?.status).toBe("ready"),
    );
    act(() => {
      void invalidateProjectWorkItemQueries(client, "org", "project");
    });
    await waitFor(() =>
      expect(result.current.entries.get("a")).toMatchObject({
        status: "loading",
        data: { name: "a" },
      }),
    );
    await waitFor(() => expect(mocks.getTasks).toHaveBeenCalledTimes(2));
    act(() => {
      void invalidateProjectWorkItemQueries(client, "org", "project");
    });
    await waitFor(() =>
      expect(result.current.entries.get("a")?.data?.name).toBe("Newest"),
    );
    await act(async () => {
      old.resolve({ data: { data: [task("a", "Obsolete")] } });
      await old.promise;
    });
    expect(result.current.entries.get("a")?.data?.name).toBe("Newest");
  });

  it("keeps entry data identity when a re-read returns unchanged content", async () => {
    echoTasks();
    const client = createClient();
    const wrapper = clientWrapper(client);
    const { result } = renderHook(
      () => useFeatureDocumentContent("org", "project", ["a"]),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.entries.get("a")?.status).toBe("ready"),
    );
    const before = result.current.entries.get("a")?.data;
    await act(async () => {
      await invalidateProjectWorkItemQueries(client, "org", "project");
    });
    await waitFor(() =>
      expect(result.current.entries.get("a")?.status).toBe("ready"),
    );
    expect(mocks.getTasks).toHaveBeenCalledTimes(2);
    expect(result.current.entries.get("a")?.data).toBe(before);
  });

  it("does not re-read content for another project's invalidation", async () => {
    echoTasks();
    const client = createClient();
    const wrapper = clientWrapper(client);
    const { result } = renderHook(
      () => useFeatureDocumentContent("org", "project", ["a"]),
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.entries.get("a")?.status).toBe("ready"),
    );
    await act(async () => {
      await invalidateProjectWorkItemQueries(client, "org", "other");
    });
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
  });

  it("metadata reads do not request document sections", async () => {
    mocks.getTasks.mockResolvedValue(response(["a"]));
    const { result } = renderHook(
      () =>
        useFeatureDocumentContent(
          "org",
          "project",
          ["a"],
          undefined,
          "metadata",
        ),
      { wrapper: clientWrapper(createClient()) },
    );
    await waitFor(() =>
      expect(result.current.entries.get("a")?.status).toBe("ready"),
    );
    expect(mocks.getTasks.mock.calls[0][0].includeSectionKeys).toBeUndefined();
  });
});

describe("hierarchy and hydration wiring", () => {
  it("isolates project changes from an older pending content response", async () => {
    const old = deferred<ReturnType<typeof response>>();
    mocks.getTasks
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ data: { data: [task("a", "New project")] } });
    const wrapper = clientWrapper(createClient());
    const { result, rerender } = renderHook(
      ({ projectId }) => useFeatureDocumentContent("org", projectId, ["a"]),
      { wrapper, initialProps: { projectId: "old" } },
    );
    rerender({ projectId: "new" });
    await waitFor(() =>
      expect(result.current.entries.get("a")?.data?.name).toBe("New project"),
    );
    await act(async () => {
      old.resolve(response(["a"]));
      await old.promise;
    });
    expect(result.current.entries.get("a")?.data?.name).toBe("New project");
  });

  it("keeps Tree identity authoritative and rolls back failed reparenting", async () => {
    const references = [
      { id: "root", name: "Root", type: "FEATURE", parentTaskId: null },
      { id: "other", name: "Other", type: "FEATURE", parentTaskId: null },
      {
        id: "child",
        name: "Canonical name",
        type: "FEATURE",
        parentTaskId: "root",
      },
    ];
    mocks.listWorkItemReferences.mockResolvedValue({
      data: {
        data: {
          items: references,
          pagination: {
            page: 1,
            limit: 500,
            total: 3,
            totalPages: 1,
            hasNext: false,
            hasPrevious: false,
          },
        },
      },
    });
    mocks.getTasks.mockImplementation(({ taskIds }: { taskIds: string[] }) =>
      Promise.resolve({
        data: {
          data: taskIds.map((id) => ({
            ...task(id, "Outdated name"),
            parentTaskId: "wrong-parent",
            childCounts: { total: 9 },
            tag: "frontend",
          })),
        },
      }),
    );
    const wrapper = clientWrapper(createClient());
    const { result } = renderHook(
      () => useFeatureTreePageData("org", "project"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isReady).toBe(true));
    expect(
      result.current.allFeatures.find((item) => item.id === "child"),
    ).toMatchObject({
      name: "Canonical name",
      parentTaskId: "root",
      tag: "frontend",
      childCounts: { total: 9 },
    });
    await expect(result.current.reparent("root", "child")).rejects.toThrow(
      "descendants",
    );
    expect(mocks.updateTask).not.toHaveBeenCalled();
    mocks.updateTask.mockRejectedValueOnce(new Error("Denied"));
    await act(async () => {
      await expect(result.current.reparent("child", "other")).rejects.toThrow(
        "Denied",
      );
    });
    expect(
      result.current.allFeatures.find((item) => item.id === "child")
        ?.parentTaskId,
    ).toBe("root");
    expect(result.current.errorMap.get("child")).toBe("Denied");
    mocks.updateTask.mockImplementationOnce(async () => {
      references[2] = { ...references[2], parentTaskId: "other" };
      return {
        data: {
          data: {
            status: "APPLIED",
            task: { ...task("child"), parentTaskId: "other" },
          },
        },
      };
    });
    await act(async () => {
      await result.current.reparent("child", "other");
    });
    await waitFor(() =>
      expect(
        result.current.allFeatures.find((item) => item.id === "child")
          ?.parentTaskId,
      ).toBe("other"),
    );
    expect(result.current.errorMap.has("child")).toBe(false);
    expect(
      mocks.getTasks.mock.calls.every(
        ([request]) => request.includeSectionKeys === undefined,
      ),
    ).toBe(true);
  });

  it("loads complete references, hydrates only requested IDs, and refreshes after authoritative invalidation", async () => {
    const store = createStore();
    let name = "Original";
    mocks.listWorkItemReferences.mockImplementation(
      ({ page }: { page: number }) =>
        Promise.resolve({
          data: {
            data: {
              items:
                page === 1
                  ? Array.from({ length: 500 }, (_, i) => ({
                      id: `feature-${i}`,
                      name: `${name} ${i}`,
                      type: "FEATURE",
                      parentTaskId: null,
                    }))
                  : [
                      {
                        id: "last",
                        name: "Last",
                        type: "FEATURE",
                        parentTaskId: "feature-0",
                      },
                    ],
              pagination: {
                page,
                limit: 500,
                total: 501,
                totalPages: 2,
                hasNext: page === 1,
                hasPrevious: page > 1,
              },
            },
          },
        }),
    );
    mocks.getTasks.mockImplementation(({ taskIds }: { taskIds: string[] }) =>
      Promise.resolve({ data: { data: taskIds.map((id) => task(id, name)) } }),
    );
    const client = createClient();
    const wrapper = clientWrapper(client, store);
    const { result } = renderHook(
      () => {
        const hierarchy = useFeatureHierarchy("org", "project");
        const content = useFeatureDocumentContent(
          "org",
          "project",
          hierarchy.isReady ? ["feature-0", "last"] : [],
        );
        const invalidate = useRelationshipMutationInvalidation();
        return { hierarchy, content, invalidate };
      },
      { wrapper },
    );
    await waitFor(() =>
      expect(result.current.content.entries.get("last")?.status).toBe("ready"),
    );
    expect(result.current.hierarchy.nodes.size).toBe(501);
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);
    expect(mocks.getTasks.mock.calls[0][0].taskIds).toEqual([
      "feature-0",
      "last",
    ]);
    // Re-reading references with unchanged ids reads no feature content.
    const referenceReads = mocks.listWorkItemReferences.mock.calls.length;
    await act(async () => {
      await refreshWorkItemLists(graphql.apollo, {
        organizationId: "org",
        projectId: "project",
      });
    });
    expect(mocks.listWorkItemReferences.mock.calls.length).toBeGreaterThan(
      referenceReads,
    );
    expect(mocks.getTasks).toHaveBeenCalledTimes(1);

    name = "Updated";
    await act(async () => {
      // The server's change event: content is invalidated, references re-read.
      await invalidateProjectWorkItemQueries(client, "org", "project");
      await refreshWorkItemLists(graphql.apollo, {
        organizationId: "org",
        projectId: "project",
      });
    });
    await waitFor(() =>
      expect(result.current.content.entries.get("last")?.data?.name).toBe(
        "Updated",
      ),
    );
    expect(result.current.hierarchy.nodes.get("feature-0")?.feature.name).toBe(
      "Updated 0",
    );
    // A mutation on another item re-reads references but not this content.
    name = "Created";
    const contentReads = mocks.getTasks.mock.calls.length;
    const referenceReadsBeforeCreate =
      mocks.listWorkItemReferences.mock.calls.length;
    // The write reaches the references through the server's change event.
    act(() =>
      new WebSocketHandler(
        createStore(),
        undefined,
        client,
        graphql.apollo,
      ).handleEvent({
        type: "task.created",
        timestamp: "2026-11-01T00:00:00.000Z",
        organizationId: "org",
        projectId: "project",
        taskId: "new",
      }),
    );
    await waitFor(() =>
      expect(mocks.listWorkItemReferences.mock.calls.length).toBeGreaterThan(
        referenceReadsBeforeCreate,
      ),
    );
    expect(mocks.getTasks).toHaveBeenCalledTimes(contentReads);
    expect(result.current.content.entries.get("last")?.data?.name).toBe(
      "Updated",
    );

    // A mutation on the item itself re-reads its content.
    act(() =>
      result.current.invalidate({
        entityType: "Task",
        operation: "update",
        organizationId: "org",
        projectId: "project",
        sourceEntity: task("last"),
      }),
    );
    await waitFor(() =>
      expect(result.current.content.entries.get("last")?.data?.name).toBe(
        "Created",
      ),
    );
  });
});

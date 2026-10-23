import React, { StrictMode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionCurrentState,
  AgentSessionStatus,
  AgentSessionType,
  type PaginatedAgentSessionItemDto,
} from "../../../api";
import { agentSessionsClient } from "../../../clients";
import {
  agentSessionKeys,
  invalidateAgentSessionFeeds,
  type PaginatedAgentSessionsPage,
} from "../../collections/agentSessions";
import { useAgentSessionCurrentStates } from "../useAgentSessionCurrentState";
import { usePaginatedAgentSessions } from "../usePaginatedAgentSessions";

vi.mock("../../../clients", () => ({
  agentSessionsClient: { listAgentSessionsPaginated: vi.fn() },
  dataClient: { request: vi.fn() },
}));

vi.mock("../useAgentSessionCurrentState", () => ({
  useAgentSessionCurrentStates: vi.fn(),
}));

const listMock = vi.mocked(agentSessionsClient.listAgentSessionsPaginated);
const useAgentSessionCurrentStatesMock = vi.mocked(
  useAgentSessionCurrentStates
);

const item = (id: string, title = id): PaginatedAgentSessionItemDto => ({
  agentSession: {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    userId: "user-1",
    status: AgentSessionStatus.InProgress,
    conversationId: null,
    sessionDate: "2026-07-17T00:00:00.000Z",
    title,
    hasUnsyncedChanges: false,
    monitoringEnabled: false,
    autoDecide: false,
    type: AgentSessionType.Coding,
  },
  lastMessage: null,
  parentEntity: null,
  services: [],
  reports: [],
});

const page = (
  ids: Array<string | PaginatedAgentSessionItemDto>,
  nextCursor: string | null = null
): PaginatedAgentSessionsPage => ({
  items: ids.map((entry) => (typeof entry === "string" ? item(entry) : entry)),
  nextCursor,
});

type Request = Parameters<typeof listMock>[0];
type Responder = (
  request: Request
) => PaginatedAgentSessionsPage | Promise<PaginatedAgentSessionsPage>;

/** Pages served by cursor ("" is page one); a responder may override. */
let pages: Record<string, PaginatedAgentSessionsPage>;
let responders: Responder[];
const serve = () =>
  listMock.mockImplementation(async (request) => {
    const responder = responders.shift();
    const body = responder
      ? await responder(request)
      : pages[request.cursor ?? ""] ?? page([]);
    return { data: { data: body } } as never;
  });
const readsOf = (cursor: string | undefined) =>
  listMock.mock.calls.filter(([request]) => request.cursor === cursor);

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
const wrapperFor =
  (client: QueryClient, strict = false) =>
  ({ children }: { children: React.ReactNode }) => {
    const tree = (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };

const ids = (result: { current: { items: PaginatedAgentSessionItemDto[] } }) =>
  result.current.items.map((entry) => entry.agentSession.id);

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const refresh = (client: QueryClient) =>
  act(async () => {
    await invalidateAgentSessionFeeds(client, "org-1", "project-1");
  });

describe("usePaginatedAgentSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pages = {
      "": page(["a", "b"], "next"),
      next: page(["b", "c"]),
    };
    responders = [];
    serve();
    useAgentSessionCurrentStatesMock.mockReturnValue({
      currentStateById: {},
      isFetching: false,
    });
  });

  it("sends normalized filters and shares one feed read across consumers", async () => {
    const client = createClient();
    const options = {
      type: AgentSessionType.Coding,
      statuses: [AgentSessionStatus.InProgress, AgentSessionStatus.Completed],
      taskId: "task-1",
    };
    const { result } = renderHook(
      () => [
        usePaginatedAgentSessions("org-1", "project-1", options),
        usePaginatedAgentSessions("org-1", "project-1", {
          ...options,
          statuses: [AgentSessionStatus.Completed, AgentSessionStatus.InProgress],
        }),
      ],
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(ids({ current: result.current[0] })).toEqual(["a", "b"]));
    expect(ids({ current: result.current[1] })).toEqual(["a", "b"]);
    expect(listMock).toHaveBeenCalledOnce();
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        type: AgentSessionType.Coding,
        taskId: "task-1",
        status: [AgentSessionStatus.Completed, AgentSessionStatus.InProgress],
        cursor: undefined,
      }),
      expect.anything()
    );
  });

  it("appends cursor pages in order without duplicate session IDs", async () => {
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1"),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
    expect(result.current.hasNextPage).toBe(true);

    act(() => result.current.loadNextPage());
    await waitFor(() => expect(ids(result)).toEqual(["a", "b", "c"]));
    expect(result.current.hasNextPage).toBe(false);
    expect(readsOf("next")).toHaveLength(1);
  });

  it("applies newer current-state overlays to accumulated pages", async () => {
    useAgentSessionCurrentStatesMock.mockReturnValue({
      currentStateById: {
        a: {
          currentState: AgentSessionCurrentState.Thinking,
          revision: 2,
          transitionedAt: "2026-08-11T00:00:00.000Z",
        },
      },
      isFetching: false,
    });
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1", { taskId: "t" }),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() =>
      expect(result.current.items[0]?.agentSession.currentState).toBe(
        AgentSessionCurrentState.Thinking
      )
    );
    expect(useAgentSessionCurrentStatesMock).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      ["a", "b"],
      { enabled: true }
    );
  });

  it("hides accumulated pages immediately when filters change", async () => {
    listMock.mockImplementation(async (request) => {
      return {
        data: { data: page([request.taskId === "two" ? "two-row" : "one-row"]) },
      } as never;
    });
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) =>
        usePaginatedAgentSessions("org-1", "project-1", { taskId }),
      { wrapper: wrapperFor(createClient()), initialProps: { taskId: "one" } }
    );
    await waitFor(() => expect(ids(result)).toEqual(["one-row"]));

    rerender({ taskId: "two" });
    expect(ids(result)).not.toContain("one-row");
    await waitFor(() => expect(ids(result)).toEqual(["two-row"]));
  });

  it("defers first-page additions until explicit application", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1"),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));

    pages[""] = page(["new", "a", "b"], "next");
    await refresh(client);
    await waitFor(() => expect(result.current.hasPendingUpdates).toBe(true));
    expect(ids(result)).toEqual(["a", "b"]);
    // A refresh re-reads page one once.
    expect(readsOf(undefined)).toHaveLength(2);
  });

  it("keeps accumulated pages visible while expired data re-reads", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { result } = renderHook(
        () =>
          usePaginatedAgentSessions("org-1", "project-1", {
            maxCacheAgeMs: 1_000,
          }),
        { wrapper: wrapperFor(createClient()) }
      );
      await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
      act(() => result.current.loadNextPage());
      await waitFor(() => expect(ids(result)).toEqual(["a", "b", "c"]));

      const reload = deferred<PaginatedAgentSessionsPage>();
      responders.push(() => reload.promise);
      await act(async () => {
        vi.advanceTimersByTime(1_000);
      });
      await waitFor(() => expect(result.current.isFetching).toBe(true));
      expect(ids(result)).toEqual(["a", "b", "c"]);
      expect(result.current.isLoading).toBe(false);
      await act(async () => reload.resolve(pages[""]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("patches refreshed rows in place and applies only a fresh page one", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1"),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
    act(() => result.current.loadNextPage());
    await waitFor(() => expect(ids(result)).toEqual(["a", "b", "c"]));

    pages[""] = page([item("b", "Updated title"), "new", "a"], "fresh-next");
    await refresh(client);
    await waitFor(() =>
      expect(result.current.items[1].agentSession.title).toBe("Updated title")
    );
    expect(ids(result)).toEqual(["a", "b", "c"]);
    expect(result.current.hasPendingUpdates).toBe(true);

    const applied = deferred<PaginatedAgentSessionsPage>();
    responders.push(() => applied.promise);
    const readsBefore = listMock.mock.calls.length;
    let applying!: Promise<"applied" | "superseded">;
    act(() => {
      applying = result.current.refetch();
    });
    await waitFor(() => expect(result.current.isApplyingUpdates).toBe(true));
    await waitFor(() => expect(listMock.mock.calls.length).toBe(readsBefore + 1));
    expect(listMock.mock.calls.at(-1)?.[0].cursor).toBeUndefined();
    expect(ids(result)).toEqual(["a", "b", "c"]);
    await expect(result.current.refetch()).resolves.toBe("superseded");
    act(() => result.current.loadNextPage());
    expect(listMock.mock.calls.length).toBe(readsBefore + 1);

    await act(async () => {
      applied.resolve(pages[""]);
      expect(await applying).toBe("applied");
    });
    expect(ids(result)).toEqual(["b", "new", "a"]);
    expect(result.current.nextCursor).toBe("fresh-next");
    expect(result.current.hasPendingUpdates).toBe(false);
    // Only page one was re-read to apply.
    expect(listMock.mock.calls.length).toBe(readsBefore + 1);

    pages["fresh-next"] = page(["c", "d"]);
    const continuationReads = readsOf("fresh-next").length;
    act(() => result.current.loadNextPage());
    await waitFor(() => expect(ids(result)).toEqual(["b", "new", "a", "c", "d"]));
    expect(readsOf("fresh-next")).toHaveLength(continuationReads + 1);
  });

  it("keeps the pending snapshot on failure and permits an empty successful retry", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1"),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
    pages[""] = page([]);
    await refresh(client);
    await waitFor(() => expect(result.current.hasPendingUpdates).toBe(true));

    responders.push(() => {
      // A client error: the Data Layer policy does not retry it.
      throw Object.assign(new Error("Refresh failed"), { status: 400 });
    });
    await act(async () => {
      await expect(result.current.refetch()).rejects.toThrow("Refresh failed");
    });
    expect(ids(result)).toEqual(["a", "b"]);
    expect(result.current.hasPendingUpdates).toBe(true);
    expect(result.current.error?.message).toBe("Refresh failed");
    expect(result.current.isApplyingUpdates).toBe(false);

    await act(async () => {
      expect(await result.current.refetch()).toBe("applied");
    });
    expect(result.current.items).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasPendingUpdates).toBe(false);

    pages[""] = page(["later"]);
    await refresh(client);
    await waitFor(() => expect(result.current.hasPendingUpdates).toBe(true));
    expect(result.current.items).toEqual([]);
  });

  it("rejects a late next-page completion after application", async () => {
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1"),
      { wrapper: wrapperFor(createClient()) }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
    const late = deferred<PaginatedAgentSessionsPage>();
    responders.push(() => late.promise);
    act(() => result.current.loadNextPage());
    await waitFor(() => expect(readsOf("next")).toHaveLength(1));

    pages[""] = page(["fresh"]);
    await act(async () => {
      expect(await result.current.refetch()).toBe("applied");
    });
    await act(async () => late.resolve(page(["late"], "old")));
    expect(ids(result)).toEqual(["fresh"]);
    expect(result.current.nextCursor).toBeNull();
  });

  it("supersedes an application when its filter scope changes", async () => {
    const pending = deferred<PaginatedAgentSessionsPage>();
    let firstScopeReads = 0;
    listMock.mockImplementation(async (request) => {
      if (request.taskId === "one" && ++firstScopeReads === 2) {
        return { data: { data: await pending.promise } } as never;
      }
      return { data: { data: pages[""] } } as never;
    });
    const { result, rerender } = renderHook(
      ({ taskId }: { taskId: string }) =>
        usePaginatedAgentSessions("org-1", "project-1", { taskId }),
      { wrapper: wrapperFor(createClient()), initialProps: { taskId: "one" } }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
    let applying!: Promise<"applied" | "superseded">;
    act(() => {
      applying = result.current.refetch();
    });
    rerender({ taskId: "two" });
    await act(async () => {
      pending.resolve(page(["wrong-scope"]));
      expect(await applying).toBe("superseded");
    });
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
    expect(result.current.isApplyingUpdates).toBe(false);
  });

  it("initializes from cached pages under StrictMode without another read", async () => {
    const client = createClient();
    client.setQueryData(agentSessionKeys.paginated("org-1", "project-1", {}), {
      pages: [pages[""], pages.next],
      pageParams: [null, "next"],
    });
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1"),
      { wrapper: wrapperFor(client, true) }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b", "c"]));
    expect(result.current.nextCursor).toBeNull();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("patches refreshed later pages without moving accumulated rows", async () => {
    const client = createClient();
    const { result } = renderHook(
      () => usePaginatedAgentSessions("org-1", "project-1"),
      { wrapper: wrapperFor(client) }
    );
    await waitFor(() => expect(ids(result)).toEqual(["a", "b"]));
    act(() => result.current.loadNextPage());
    await waitFor(() => expect(ids(result)).toEqual(["a", "b", "c"]));

    pages.next = page([item("c", "Current title"), "b", "extra"], "changed");
    await refresh(client);
    await waitFor(() =>
      expect(result.current.items[2].agentSession.title).toBe("Current title")
    );
    expect(ids(result)).toEqual(["a", "b", "c"]);
    expect(result.current.nextCursor).toBeNull();
    expect(result.current.hasPendingUpdates).toBe(true);
    // One read per loaded page.
    expect(readsOf(undefined)).toHaveLength(2);
    expect(readsOf("next")).toHaveLength(2);
  });
});

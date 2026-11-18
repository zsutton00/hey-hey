import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  type PaginatedAgentSessionItemDto,
} from "../../../api";
import { agentSessionsClient } from "../../../clients";
import { useAgentSessionTitleOptions } from "../useAgentSessionTitleOptions";

vi.mock("../../../clients", () => ({
  agentSessionsClient: { listAgentSessionsPaginated: vi.fn() },
  dataClient: { request: vi.fn() },
}));

const listMock = vi.mocked(agentSessionsClient.listAgentSessionsPaginated);

const item = (id: string, title: string): PaginatedAgentSessionItemDto => ({
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

/** A 4xx is not retried by the data layer, so the failure surfaces at once. */
const rejection = (message: string) =>
  Object.assign(new Error(message), { status: 403 });

const respond = (
  items: PaginatedAgentSessionItemDto[],
  nextCursor: string | null = null,
) => ({ data: { data: { items, nextCursor } } }) as never;

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

const render = (initial: { search: string; enabled: boolean }) =>
  renderHook(
    (props: { search: string; enabled: boolean }) =>
      useAgentSessionTitleOptions("org-1", "project-1", props),
    { wrapper, initialProps: initial },
  );

describe("useAgentSessionTitleOptions", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it("requests nothing until the picker opens, then one bounded page", async () => {
    listMock.mockResolvedValue(respond([item("a", "Alpha")]));
    const { result, rerender } = render({ search: "", enabled: false });

    expect(listMock).not.toHaveBeenCalled();
    rerender({ search: "", enabled: true });

    await waitFor(() => expect(result.current.options).toHaveLength(1));
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(listMock.mock.calls[0]?.[0]).toMatchObject({ limit: 20 });
    expect(listMock.mock.calls[0]?.[0].search).toBeUndefined();
  });

  it("appends the next page on request, de-duplicating by id", async () => {
    listMock
      .mockResolvedValueOnce(respond([item("a", "Alpha")], "c1"))
      .mockResolvedValueOnce(respond([item("a", "Alpha"), item("b", "Beta")]));
    const { result } = render({ search: "", enabled: true });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => result.current.loadNextPage());

    await waitFor(() =>
      expect(result.current.options.map((o) => o.id)).toEqual(["a", "b"]),
    );
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(listMock.mock.calls[1]?.[0].cursor).toBe("c1");
    expect(result.current.hasNextPage).toBe(false);
  });

  it("searches on the server and ignores a late response for an earlier term", async () => {
    let resolveOld: (value: never) => void = () => {};
    listMock.mockImplementation((request) =>
      request.search === "old"
        ? new Promise((resolve) => {
            resolveOld = resolve;
          })
        : Promise.resolve(respond([item("n", "Newer match")])),
    );
    const { result, rerender } = render({ search: "old", enabled: true });
    rerender({ search: "new", enabled: true });

    await waitFor(() =>
      expect(result.current.options.map((o) => o.title)).toEqual([
        "Newer match",
      ]),
    );
    resolveOld(respond([item("o", "Stale match")]));
    await act(async () => {});

    expect(result.current.options.map((o) => o.id)).toEqual(["n"]);
    expect(listMock.mock.calls.map(([r]) => r.search)).toEqual(["old", "new"]);
  });

  it("reports a first-page failure separately from an empty result, and retries", async () => {
    listMock
      .mockRejectedValueOnce(rejection("boom"))
      .mockResolvedValueOnce(respond([item("a", "Alpha")]));
    const { result } = render({ search: "", enabled: true });

    await waitFor(() => expect(result.current.initialError).not.toBeNull());
    expect(result.current.options).toEqual([]);
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.options).toHaveLength(1));
    expect(result.current.initialError).toBeNull();
  });

  it("keeps loaded results usable when the next page fails", async () => {
    listMock
      .mockResolvedValueOnce(respond([item("a", "Alpha")], "c1"))
      .mockRejectedValueOnce(rejection("later"))
      .mockResolvedValueOnce(respond([item("b", "Beta")]));
    const { result } = render({ search: "", enabled: true });

    await waitFor(() => expect(result.current.hasNextPage).toBe(true));
    act(() => result.current.loadNextPage());
    await waitFor(() => expect(result.current.nextPageError).not.toBeNull());
    expect(result.current.initialError).toBeNull();
    expect(result.current.options.map((o) => o.id)).toEqual(["a"]);

    act(() => result.current.retry());
    await waitFor(() =>
      expect(result.current.options.map((o) => o.id)).toEqual(["a", "b"]),
    );
  });
});

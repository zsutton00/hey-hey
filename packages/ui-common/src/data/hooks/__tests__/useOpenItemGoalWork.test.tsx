import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionCurrentState,
  EntityType,
  TaskSource,
  WorkStatus,
  type AgentSessionDto,
  type TrackedEntitySnapshot,
} from "../../../api";
import { dataClient } from "../../../clients";
import { agentSessionKeys } from "../../collections/agentSessions";
import { useWorkItem } from "../useWorkItem";
import { useOpenItemGoalWork } from "../useOpenItemGoalWork";

vi.mock("../useWorkItem", () => ({ useWorkItem: vi.fn() }));
vi.mock("../../../clients", () => ({ dataClient: { request: vi.fn() } }));

const snapshot = (id: string, status: WorkStatus): TrackedEntitySnapshot => ({
  targetEntityType: EntityType.Task,
  targetEntityId: id,
  title: `Work ${id}`,
  status,
});
const tracked = [
  snapshot("active", WorkStatus.Active),
  snapshot("backlog", WorkStatus.Backlog),
  snapshot("idle", WorkStatus.Backlog),
  snapshot("finished", WorkStatus.Completed),
  snapshot("cancelled", WorkStatus.Cancelled),
];
const ids = (work: TrackedEntitySnapshot[]) =>
  work.map((item) => item.targetEntityId);
const goalResult: ReturnType<typeof useWorkItem> = {
  workItem: {
    id: "goal",
    name: "Outcome",
    type: "GOAL",
    organizationId: "org",
    projectId: "project",
    status: WorkStatus.Active,
    source: TaskSource.User,
    trackedEntities: tracked,
  },
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  isStale: false,
  error: null,
  refetch: vi.fn(async () => null),
  markStale: vi.fn(),
};
function setup(filter: "ACTIVE" | "ACTIVE_AND_BACKLOG" | "ALL" | "NONE") {
  const client = new QueryClient();
  const hook = renderHook(
    ({ filter }) => useOpenItemGoalWork("org", "project", "goal", filter),
    {
      initialProps: { filter },
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  return { client, ...hook };
}
const request = vi.mocked(dataClient.request);

describe("expanded Open Item Goal work", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useWorkItem).mockReturnValue(goalResult);
    request.mockResolvedValue({ data: { data: [] } } as never);
  });

  it("reads the existing Goal projection and applies backlog/all/none without session reads", () => {
    const { result, rerender } = setup("ACTIVE_AND_BACKLOG");
    expect(useWorkItem).toHaveBeenCalledWith("org", "task", "goal", {
      projectId: "project",
    });
    expect(ids(result.current.work)).toEqual(["active", "backlog", "idle"]);
    rerender({ filter: "ALL" });
    expect(ids(result.current.work)).toEqual(ids(tracked));
    rerender({ filter: "NONE" });
    expect(result.current.work).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });

  it("uses running sessions and canonical state, including reviewing, without output-attention reads", async () => {
    const { client, result, rerender } = setup("ALL");
    const session = (
      id: string,
      status: "IN_PROGRESS" | "COMPLETED",
    ): AgentSessionDto =>
      ({
        id,
        status,
        currentState: AgentSessionCurrentState.Thinking,
      }) as AgentSessionDto;
    for (const id of ["backlog", "idle", "finished", "cancelled"]) {
      client.setQueryData(
        agentSessionKeys.list("org", "project", {
          entityType: EntityType.Task,
          entityId: id,
        }),
        [session(id, id === "finished" ? "COMPLETED" : "IN_PROGRESS")],
      );
      client.setQueryData(agentSessionKeys.currentState("org", "project", id), {
        currentState:
          id === "backlog" ? "REVIEWING" : AgentSessionCurrentState.Idle,
        revision: 2,
        transitionedAt: "2026-10-13T00:00:00Z",
      });
    }
    rerender({ filter: "ACTIVE" });
    await waitFor(() =>
      expect(ids(result.current.work)).toEqual(["active", "backlog"]),
    );
    await act(async () => {
      client.setQueryData(
        agentSessionKeys.currentState("org", "project", "idle"),
        {
          currentState: AgentSessionCurrentState.Writing,
          revision: 3,
          transitionedAt: "2026-10-13T00:01:00Z",
        },
      );
    });
    await waitFor(() =>
      expect(ids(result.current.work)).toEqual(["active", "backlog", "idle"]),
    );
    const observed = client
      .getQueryCache()
      .getAll()
      .filter((query) => query.getObserversCount() > 0);
    expect(
      observed.some((query) => query.queryKey.includes("outputAttention")),
    ).toBe(false);
    expect(
      observed.some(
        (query) =>
          query.queryKey.includes("finished") &&
          query.queryKey.includes("currentState"),
      ),
    ).toBe(false);
    rerender({ filter: "NONE" });
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.getObserversCount() === 0),
    ).toBe(true);
  });

  it("discovers sessions only for relevant tracked work and drops observers on unmount", async () => {
    const { result, unmount, client } = setup("ACTIVE");
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(request).toHaveBeenCalledTimes(4);
    expect(
      request.mock.calls.every(
        ([config]) =>
          config.params?.entityType === EntityType.Task &&
          ["backlog", "idle", "finished", "cancelled"].includes(
            config.params?.entityId,
          ),
      ),
    ).toBe(true);
    expect(ids(result.current.work)).toEqual(["active"]);
    unmount();
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.getObserversCount() === 0),
    ).toBe(true);
  });

  it("exposes Goal loading and errors locally and retries the owning read", async () => {
    vi.mocked(useWorkItem).mockReturnValue({
      ...goalResult,
      workItem: null,
      isLoading: true,
    });
    const { result, rerender } = setup("ALL");
    expect(result.current.isLoading).toBe(true);
    const failure = new Error("Read failed");
    vi.mocked(useWorkItem).mockReturnValue({ ...goalResult, error: failure });
    rerender({ filter: "ALL" });
    expect(result.current.error).toBe(failure);
    await result.current.retry();
    expect(goalResult.refetch).toHaveBeenCalledOnce();
  });
});

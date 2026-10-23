import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionListSort,
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "../../../api";
import { agentSessionsClient } from "../../../clients";
import {
  agentSessionKeys,
  fetchPaginatedAgentSessions,
  removeAgentSession,
  writeAgentSession,
} from "../agentSessions";

vi.mock("../../../clients", () => ({
  agentSessionsClient: { listAgentSessionsPaginated: vi.fn() },
  dataClient: { request: vi.fn() },
}));

const listAgentSessionsPaginatedMock = vi.mocked(
  agentSessionsClient.listAgentSessionsPaginated
);

const session = (id: string, title = id): AgentSessionDto => ({
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
});

describe("paginated agent sessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requests the generated paginated endpoint with normalized filters", async () => {
    listAgentSessionsPaginatedMock.mockResolvedValue({
      data: { data: { items: [], nextCursor: "next-cursor" } },
    } as never);

    await expect(
      fetchPaginatedAgentSessions(
        "org-1",
        "project-1",
        {
          excludeType: AgentSessionType.Coding,
          hasUserMessage: true,
          userId: "user-1",
          serviceId: "service-1",
          taskId: "task-1",
          statuses: [
            AgentSessionStatus.InProgress,
            AgentSessionStatus.Completed,
            AgentSessionStatus.InProgress,
          ],
          sort: AgentSessionListSort.LastMessage,
          limit: 10,
        },
        "current-cursor",
        {}
      )
    ).resolves.toEqual({ items: [], nextCursor: "next-cursor" });
    expect(listAgentSessionsPaginatedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        excludeType: AgentSessionType.Coding,
        hasUserMessage: true,
        userId: "user-1",
        serviceId: "service-1",
        taskId: "task-1",
        status: [AgentSessionStatus.Completed, AgentSessionStatus.InProgress],
        sort: AgentSessionListSort.LastMessage,
        limit: 10,
        cursor: "current-cursor",
      }),
      {}
    );
  });
});

describe("agent session keys", () => {
  it("normalizes id and status sets so equivalent reads share one key", () => {
    expect(
      agentSessionKeys.list("org-1", "project-1", { ids: ["b", "a", "b"] })
    ).toEqual(agentSessionKeys.list("org-1", "project-1", { ids: ["a", "b"] }));
    expect(
      agentSessionKeys.paginated("org-1", "project-1", {
        statuses: [AgentSessionStatus.InProgress, AgentSessionStatus.Completed],
      })
    ).toEqual(
      agentSessionKeys.paginated("org-1", "project-1", {
        statuses: [AgentSessionStatus.Completed, AgentSessionStatus.InProgress],
      })
    );
  });

  it("keeps every filter in the key, including the conversation", () => {
    const keyFor = (filters: object) =>
      JSON.stringify(agentSessionKeys.paginated("org-1", "project-1", filters));
    expect(keyFor({ hasUserMessage: true })).not.toBe(
      keyFor({ hasUserMessage: false })
    );
    expect(keyFor({ userId: "user-1" })).not.toBe(keyFor({ userId: "user-2" }));
    expect(keyFor({ serviceId: "s-1" })).not.toBe(keyFor({ serviceId: "s-2" }));
    expect(keyFor({ taskId: "t-1" })).not.toBe(keyFor({ taskId: "t-2" }));
    expect(
      agentSessionKeys.list("org-1", "project-1", {
        conversationId: "conversation-1",
        type: AgentSessionType.Coding,
      })[4]
    ).toMatchObject({
      conversationId: "conversation-1",
      type: AgentSessionType.Coding,
    });
  });

  it("places every per-session dataset under the session prefix", () => {
    const prefix = agentSessionKeys.session("org-1", "project-1", "s-1");
    for (const key of [
      agentSessionKeys.detail("org-1", "project-1", "s-1"),
      agentSessionKeys.currentState("org-1", "project-1", "s-1"),
      agentSessionKeys.contextSize("org-1", "project-1", "s-1"),
      agentSessionKeys.outputAttention("org-1", "project-1", "s-1"),
    ]) {
      expect(key.slice(0, prefix.length)).toEqual(prefix);
    }
  });
});

describe("agent session cache writes", () => {
  it("patches lists that hold a written session and never inserts it into others", () => {
    const client = new QueryClient();
    const holding = agentSessionKeys.list("org-1", "project-1", {});
    const other = agentSessionKeys.list("org-1", "project-1", {
      userId: "user-2",
    });
    client.setQueryData(holding, [session("a"), session("b")]);
    client.setQueryData(other, [session("c")]);

    writeAgentSession(client, "org-1", "project-1", session("b", "Renamed"));
    writeAgentSession(client, "org-1", "project-1", session("new"));

    expect(
      client.getQueryData<AgentSessionDto[]>(holding)?.map((row) => row.title)
    ).toEqual(["a", "Renamed"]);
    expect(client.getQueryData(other)).toEqual([session("c")]);
    expect(
      client.getQueryData(agentSessionKeys.detail("org-1", "project-1", "new"))
    ).toEqual(session("new"));
  });

  it("drops a deleted session's data and removes it from cached lists", async () => {
    const client = new QueryClient();
    const list = agentSessionKeys.list("org-1", "project-1", {});
    client.setQueryData(list, [session("a"), session("b")]);
    client.setQueryData(agentSessionKeys.detail("org-1", "project-1", "a"), session("a"));
    client.setQueryData(
      agentSessionKeys.currentState("org-1", "project-1", "a"),
      { currentState: "IDLE", revision: 1, transitionedAt: "t" }
    );

    await removeAgentSession(client, "org-1", undefined, "a");

    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: agentSessionKeys.session("org-1", "project-1", "a") })
    ).toHaveLength(0);
    expect(client.getQueryData(list)).toEqual([session("b")]);
    expect(client.getQueryState(list)?.isInvalidated).toBe(true);
  });
});

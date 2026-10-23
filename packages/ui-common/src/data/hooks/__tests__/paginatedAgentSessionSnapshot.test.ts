import { describe, expect, it } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  type PaginatedAgentSessionItemDto,
} from "../../../api";
import {
  acceptAgentSessionPage,
  emptyAgentSessionSnapshot,
  reconcileAgentSessionPage,
} from "../paginatedAgentSessionSnapshot";
const item = (id: string, title = id): PaginatedAgentSessionItemDto => ({
  agentSession: {
    id,
    title,
    organizationId: "org",
    projectId: "project",
    userId: "user",
    status: AgentSessionStatus.InProgress,
    type: AgentSessionType.Coding,
    conversationId: null,
    sessionDate: "2026-09-28",
    hasUnsyncedChanges: false,
    monitoringEnabled: false,
    autoDecide: false,
  },
  lastMessage: null,
  parentEntity: null,
  services: [],
  reports: [],
});
const page = (
  items: PaginatedAgentSessionItemDto[],
  nextCursor: string | null = null
) => ({ id: "stable-cache-id", items, nextCursor });
describe("agent session snapshots", () => {
  it("patches fields across pages without accepting new membership, order, or cursor", () => {
    const first = acceptAgentSessionPage(
      emptyAgentSessionSnapshot(),
      "first",
      page([item("a"), item("b")], "next")
    );
    const all = acceptAgentSessionPage(
      first,
      "next",
      page([item("b"), item("c")], "last")
    );
    const refreshed = reconcileAgentSessionPage(
      all,
      "first",
      page([item("c", "Updated"), item("new"), item("a")])
    );
    expect(refreshed.items.map((row) => row.agentSession.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(refreshed.items[2].agentSession.title).toBe("Updated");
    expect(refreshed.nextCursor).toBe("last");
    expect(refreshed.hasPendingUpdates).toBe(true);
    expect(
      reconcileAgentSessionPage(refreshed, "next", page([item("new")])).items
    ).toHaveLength(3);
  });
  it("accepts successful empty initialization and defers later additions", () => {
    const empty = acceptAgentSessionPage(
      emptyAgentSessionSnapshot(),
      "first",
      page([])
    );
    const refreshed = reconcileAgentSessionPage(
      empty,
      "first",
      page([item("a")])
    );
    expect(refreshed.items).toEqual([]);
    expect(refreshed.hasPendingUpdates).toBe(true);
  });
  it("updates fields without declaring ordering changes and ignores unrequested pages", () => {
    const snapshot = acceptAgentSessionPage(
      emptyAgentSessionSnapshot(),
      "first",
      page([item("a")])
    );
    expect(
      reconcileAgentSessionPage(snapshot, "unknown", page([item("b")]))
    ).toBe(snapshot);
    const refreshed = reconcileAgentSessionPage(
      snapshot,
      "first",
      page([item("a", "Updated")])
    );
    expect(refreshed.hasPendingUpdates).toBe(false);
    expect(refreshed.items[0].agentSession.title).toBe("Updated");
  });
});

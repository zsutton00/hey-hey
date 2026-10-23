import { describe, it, expect } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  type AgentSessionDto,
} from "../../../api";
import {
  buildPastSearch,
  buildPastSearches,
  canonicalKey,
  dedupePastSearches,
  orderPastSearches,
} from "../pastSearches";

const makeSession = (overrides: Partial<AgentSessionDto>): AgentSessionDto => ({
  id: "session-1",
  organizationId: "org-1",
  projectId: "proj-1",
  userId: "user-1",
  status: AgentSessionStatus.Completed,
  conversationId: "conv-1",
  sessionDate: "2026-04-10T00:00:00.000Z",
  title: "find recent design docs",
  hasUnsyncedChanges: false,
  type: AgentSessionType.AgentSearch,
  ...overrides,
});

describe("pastSearches helpers", () => {
  describe("canonicalKey", () => {
    it("normalizes case and surrounding whitespace", () => {
      expect(canonicalKey("  Find Tasks  ")).toBe("find tasks");
      expect(canonicalKey("Find Tasks")).toBe(canonicalKey("find tasks"));
    });
  });

  describe("buildPastSearch", () => {
    it("returns a PastSearch when the session has a title", () => {
      const session = makeSession({ id: "s1" });
      const past = buildPastSearch(session);
      expect(past).toEqual({
        sessionId: "s1",
        conversationId: "conv-1",
        query: "find recent design docs",
        sessionDate: "2026-04-10T00:00:00.000Z",
        session,
      });
    });

    it("returns null when the title is empty or whitespace", () => {
      expect(buildPastSearch(makeSession({ title: "" }))).toBeNull();
      expect(buildPastSearch(makeSession({ title: "   " }))).toBeNull();
    });
  });

  describe("orderPastSearches", () => {
    it("sorts by sessionDate descending", () => {
      const a = buildPastSearch(
        makeSession({ id: "a", sessionDate: "2026-04-09T00:00:00.000Z" })
      )!;
      const b = buildPastSearch(
        makeSession({ id: "b", sessionDate: "2026-04-12T00:00:00.000Z" })
      )!;
      const c = buildPastSearch(
        makeSession({ id: "c", sessionDate: "2026-04-11T00:00:00.000Z" })
      )!;
      expect(orderPastSearches([a, b, c]).map((p) => p.sessionId)).toEqual([
        "b",
        "c",
        "a",
      ]);
    });
  });

  describe("dedupePastSearches", () => {
    it("collapses duplicate queries case-insensitively, keeping the first occurrence", () => {
      const first = buildPastSearch(
        makeSession({ id: "first", title: "Find Tasks" })
      )!;
      const second = buildPastSearch(
        makeSession({ id: "second", title: "find tasks" })
      )!;
      const other = buildPastSearch(
        makeSession({ id: "other", title: "Find Initiatives" })
      )!;
      const deduped = dedupePastSearches([first, second, other]);
      expect(deduped.map((p) => p.sessionId)).toEqual(["first", "other"]);
    });
  });

  describe("buildPastSearches", () => {
    it("orders by date desc, dedupes duplicates, and applies the limit", () => {
      const sessions: AgentSessionDto[] = [
        makeSession({
          id: "old-dup",
          title: "Find Tasks",
          sessionDate: "2026-04-08T00:00:00.000Z",
        }),
        makeSession({
          id: "new-dup",
          title: "find tasks",
          sessionDate: "2026-04-12T00:00:00.000Z",
        }),
        makeSession({
          id: "no-title",
          title: "",
          sessionDate: "2026-04-11T00:00:00.000Z",
        }),
        makeSession({
          id: "other",
          title: "Look up services",
          sessionDate: "2026-04-10T00:00:00.000Z",
        }),
      ];
      const result = buildPastSearches(sessions, { limit: 2 });
      expect(result.map((p) => p.sessionId)).toEqual(["new-dup", "other"]);
    });
  });
});

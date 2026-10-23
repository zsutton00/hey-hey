import { describe, it, expect, beforeEach } from "vitest";
import { COMMON_MATCH_MIN_COUNT, getCommonMatches } from "../commonMatches";
import {
  loadRecentSelections,
  pruneStore,
  recordSelection,
} from "../recentMentionSelections";
import type { RecentSelection } from "../recentMentionSelections";

const makeSelection = (
  overrides: Partial<RecentSelection> = {}
): RecentSelection => ({
  id: overrides.id ?? "entity-1",
  type: overrides.type ?? "service",
  name: overrides.name ?? "UI Common",
  timestamps: overrides.timestamps ?? [Date.now(), Date.now(), Date.now()],
});

describe("getCommonMatches", () => {
  it("returns entities matching by initial substring across any type", () => {
    const selections = [
      makeSelection({ id: "s1", type: "service", name: "UI Common" }),
      makeSelection({ id: "s2", type: "service", name: "API Gateway" }),
    ];
    const matches = getCommonMatches("ui", selections, []);
    expect(matches.map((m) => m.id)).toEqual(["s1"]);
  });

  it("returns entities matching within small edit distance", () => {
    const selections = [
      makeSelection({ id: "s1", type: "task", name: "Login" }),
    ];
    const matches = getCommonMatches("logn", selections, []);
    expect(matches).toHaveLength(1);
    expect(matches[0].id).toBe("s1");
  });

  it("filters out entities already present in primary results", () => {
    const selections = [
      makeSelection({ id: "s1", type: "service", name: "UI Common" }),
    ];
    const matches = getCommonMatches("ui", selections, [
      { id: "s1", type: "service", name: "UI Common" },
    ]);
    expect(matches).toHaveLength(0);
  });

  it("requires at least COMMON_MATCH_MIN_COUNT selections", () => {
    const selections = [
      makeSelection({
        id: "s1",
        name: "UI Common",
        timestamps: Array(COMMON_MATCH_MIN_COUNT - 1).fill(Date.now()),
      }),
    ];
    expect(getCommonMatches("ui", selections, [])).toHaveLength(0);
  });

  it("returns nothing when query is empty", () => {
    const selections = [makeSelection()];
    expect(getCommonMatches("", selections, [])).toHaveLength(0);
  });

  it("sorts by frequency descending", () => {
    const now = Date.now();
    const selections = [
      makeSelection({ id: "a", name: "UI Alpha", timestamps: [now, now, now] }),
      makeSelection({
        id: "b",
        name: "UI Beta",
        timestamps: [now, now, now, now, now],
      }),
    ];
    const matches = getCommonMatches("ui", selections, []);
    expect(matches.map((m) => m.id)).toEqual(["b", "a"]);
  });

  it("matches the full stored name as the query grows to equal it", () => {
    const selections = [
      makeSelection({ id: "api", type: "service", name: "API" }),
    ];
    expect(getCommonMatches("A", selections, [])).toHaveLength(1);
    expect(getCommonMatches("AP", selections, [])).toHaveLength(1);
    expect(getCommonMatches("API", selections, [])).toHaveLength(1);
  });

  it("still surfaces the recent selection when a same-named entity appears in primary results", () => {
    const selections = [
      makeSelection({ id: "api", type: "service", name: "API" }),
    ];
    const existing = [{ id: "api", type: "service", name: "API" }];
    expect(getCommonMatches("API", selections, existing)).toHaveLength(0);
  });
});

describe("recentMentionSelections persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("records and reads selections from localStorage", () => {
    recordSelection({ id: "t1", type: "task", name: "Alpha" });
    recordSelection({ id: "t1", type: "task", name: "Alpha" });
    const loaded = loadRecentSelections();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].timestamps).toHaveLength(2);
  });

  it("prunes entries older than 90 days", () => {
    const now = Date.now();
    const old = now - 91 * 24 * 60 * 60 * 1000;
    const store = {
      "task:old": { id: "old", type: "task", name: "Old", timestamps: [old] },
      "task:new": { id: "new", type: "task", name: "New", timestamps: [now] },
    };
    const pruned = pruneStore(store, now);
    expect(Object.keys(pruned)).toEqual(["task:new"]);
  });

  it("keeps fresh timestamps and drops stale ones for the same entity", () => {
    const now = Date.now();
    const old = now - 91 * 24 * 60 * 60 * 1000;
    const store = {
      "task:mixed": {
        id: "mixed",
        type: "task",
        name: "Mixed",
        timestamps: [old, now],
      },
    };
    const pruned = pruneStore(store, now);
    expect(pruned["task:mixed"].timestamps).toEqual([now]);
  });
});

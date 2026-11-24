import { describe, expect, it } from "vitest";
import { buildPlaceOptions, RECENT_PLACE_LIMIT } from "../placeOptions";
import type { ServicePlacesEntry } from "../useServicePlaces";

type Ready = Extract<ServicePlacesEntry, { status: "ready" }>;

const entry = (overrides: Partial<Ready> = {}): Ready => ({
  status: "ready",
  mainFolder: { path: "/repo", branch: "dev" },
  worktrees: [],
  recentBranches: [],
  branchMatches: [],
  branchMatchesTruncated: false,
  ...overrides,
});

const recorded = (branch: string) => ({
  branch,
  kind: "WORKTREE" as const,
  lastRecordedAt: "2026-11-01T00:00:00Z",
});

const summary = (options: ReturnType<typeof buildPlaceOptions>) =>
  options.map((option) =>
    option.kind === "place"
      ? `${option.group}:${option.branch}:${option.tag}`
      : option.kind,
  );

describe("buildPlaceOptions", () => {
  it("merges Recent and Worktrees so every branch appears once, in the right group", () => {
    const options = buildPlaceOptions({
      entry: entry({
        worktrees: [
          { branch: "a", worktreePath: "/w/a" },
          { branch: "b", worktreePath: "/w/b" },
          { branch: null, worktreePath: "/w/d" },
        ],
        recentBranches: [recorded("b"), recorded("gone"), recorded("dev")],
      }),
      query: "",
      searchError: null,
    });

    expect(summary(options)).toEqual([
      "Recent:dev:main folder",
      "Recent:b:worktree",
      "Recent:gone:new worktree",
      "Worktrees:a:worktree",
      "detached",
    ]);
  });

  it("caps Recent at ten and keeps the main folder's branch in it", () => {
    const options = buildPlaceOptions({
      entry: entry({
        recentBranches: Array.from({ length: 15 }, (_, i) => recorded(`r${i}`)),
      }),
      query: "",
      searchError: null,
    });

    expect(options).toHaveLength(RECENT_PLACE_LIMIT);
    expect(summary(options)[0]).toBe("Recent:dev:main folder");
  });

  it("shows branches checked out nowhere only for matching typed text", () => {
    const base = entry({ branchMatches: ["fix/login", "dev-tools"] });

    expect(
      buildPlaceOptions({ entry: base, query: "", searchError: null }),
    ).toHaveLength(1);
    expect(
      summary(
        buildPlaceOptions({ entry: base, query: "FIX", searchError: null }),
      ),
    ).toEqual(["Branches:fix/login:opens in a new worktree"]);
  });
});

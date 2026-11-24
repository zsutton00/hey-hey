import type { ServicePlacesEntry } from "./useServicePlaces";

type ReadyEntry = Extract<ServicePlacesEntry, { status: "ready" }>;

/** Most branches the unfiltered Recent group shows. */
export const RECENT_PLACE_LIMIT = 10;

export type PlaceGroup = "Recent" | "Worktrees" | "Branches";

export type PlaceTag =
  "main folder" | "worktree" | "new worktree" | "opens in a new worktree";

export const MAIN_FOLDER_OPTION_KEY = "main-folder";

export type PlaceOption =
  | {
      kind: "place";
      key: string;
      group: PlaceGroup;
      /** Null only for the main folder while it is detached. */
      branch: string | null;
      tag: PlaceTag;
    }
  | { kind: "detached"; key: string; group: "Worktrees" }
  | {
      kind: "notice";
      key: "search-error" | "search-truncated";
      group: "Branches";
      text: string;
    };

export const branchOptionKey = (branch: string): string => `branch:${branch}`;

const matches = (branch: string, query: string): boolean =>
  branch.toLowerCase().includes(query.toLowerCase());

export interface BuildPlaceOptionsInput {
  entry: ReadyEntry;
  /** The text typed in the field; empty shows only Recent and Worktrees. */
  query: string;
  searchError: string | null;
}

/**
 * The menu for one Service, grouped Recent, Worktrees, Branches. Each branch
 * appears once. Branches checked out nowhere appear only while text is typed.
 */
export const buildPlaceOptions = ({
  entry,
  query,
  searchError,
}: BuildPlaceOptionsInput): PlaceOption[] => {
  const typed = query.trim();
  const mainBranch = entry.mainFolder.branch;
  const worktreeBranches = new Set(
    entry.worktrees.flatMap((worktree) =>
      worktree.branch === null ? [] : [worktree.branch],
    ),
  );
  const shown = new Set<string>();
  const keep = (branch: string): boolean =>
    typed === "" || matches(branch, typed);

  const recent: PlaceOption[] = [];
  const mainLabel = mainBranch ?? "detached";
  if (keep(mainLabel)) {
    recent.push({
      kind: "place",
      key: MAIN_FOLDER_OPTION_KEY,
      group: "Recent",
      branch: mainBranch,
      tag: "main folder",
    });
  }
  if (mainBranch !== null) {
    shown.add(mainBranch);
  }

  const recentBranches = entry.recentBranches
    .map((recorded) => recorded.branch)
    .filter((branch) => branch !== mainBranch);
  for (const branch of new Set(recentBranches)) {
    if (recent.length >= RECENT_PLACE_LIMIT) {
      break;
    }
    if (!keep(branch)) {
      continue;
    }
    shown.add(branch);
    recent.push({
      kind: "place",
      key: branchOptionKey(branch),
      group: "Recent",
      branch,
      tag: worktreeBranches.has(branch) ? "worktree" : "new worktree",
    });
  }

  const worktrees: PlaceOption[] = [];
  for (const worktree of entry.worktrees) {
    if (worktree.branch === null) {
      if (typed === "") {
        worktrees.push({
          kind: "detached",
          key: `detached:${worktree.worktreePath}`,
          group: "Worktrees",
        });
      }
      continue;
    }
    if (shown.has(worktree.branch) || !keep(worktree.branch)) {
      continue;
    }
    shown.add(worktree.branch);
    worktrees.push({
      kind: "place",
      key: branchOptionKey(worktree.branch),
      group: "Worktrees",
      branch: worktree.branch,
      tag: "worktree",
    });
  }

  if (typed === "") {
    return [...recent, ...worktrees];
  }

  const branches: PlaceOption[] = entry.branchMatches
    .filter((branch) => !shown.has(branch) && matches(branch, typed))
    .map((branch) => ({
      kind: "place",
      key: branchOptionKey(branch),
      group: "Branches",
      branch,
      tag: "opens in a new worktree",
    }));
  if (searchError !== null) {
    branches.push({
      kind: "notice",
      key: "search-error",
      group: "Branches",
      text: "Branch search failed",
    });
  }
  if (entry.branchMatchesTruncated) {
    branches.push({
      kind: "notice",
      key: "search-truncated",
      group: "Branches",
      text: "More branches match. Keep typing to narrow them.",
    });
  }

  return [...recent, ...worktrees, ...branches];
};

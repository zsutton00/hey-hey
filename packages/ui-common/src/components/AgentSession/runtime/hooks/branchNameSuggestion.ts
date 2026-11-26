import { slugifyBranchName } from "../../../Plans/planWorktreeBranch";
import type { ServicePlacesRead } from "./readServicePlaces";

export const SUGGESTED_BRANCH_MAX_LENGTH = 40;

/** Most extra reads spent ruling candidates out when a search was cut off. */
export const MAX_CANDIDATE_SEARCHES = 5;

/**
 * The branch name a work item's name stands for, before any number is added.
 * Cut at the last word that fits. Empty when the name has no usable characters.
 */
export const suggestedBranchBase = (workItemName: string): string => {
  const slug = slugifyBranchName(workItemName);
  if (slug.length <= SUGGESTED_BRANCH_MAX_LENGTH) {
    return slug;
  }

  // A dash just past the limit means the word before it fits whole.
  const lastDash = slug.lastIndexOf("-", SUGGESTED_BRANCH_MAX_LENGTH);

  return slug.slice(0, lastDash > 0 ? lastDash : SUGGESTED_BRANCH_MAX_LENGTH);
};

interface BranchSearch {
  /** Branches seen: main folders, worktrees and search matches. */
  branches: readonly string[];
  truncated: boolean;
}

export type ReadPlacesForBranch = (
  branchQuery: string,
) => Promise<ServicePlacesRead>;

/**
 * What one read says about the Services. A Service that cannot be read is
 * logged and skipped; null means nothing could be read at all.
 */
const searchBranches = async (
  readPlaces: ReadPlacesForBranch,
  serviceIds: readonly string[],
  branchQuery: string,
): Promise<BranchSearch | null> => {
  let read: ServicePlacesRead;
  try {
    read = await readPlaces(branchQuery);
  } catch (error: unknown) {
    console.warn("Suggested branch name could not be checked", error);

    return null;
  }

  const branches: string[] = [];
  let truncated = false;
  for (const serviceId of serviceIds) {
    const entry = read.get(serviceId);
    if (entry?.status !== "ok") {
      console.warn("Suggested branch name was not checked for a Service", {
        serviceId,
        code: entry?.code ?? "NOT_RETURNED",
        message: entry?.message,
      });
      continue;
    }

    const checkedOut = [
      entry.mainFolder.branch,
      ...entry.worktrees.map((worktree) => worktree.branch),
    ].filter((branch): branch is string => branch !== null);
    branches.push(...checkedOut, ...entry.branchMatches);
    truncated ||= entry.branchMatchesTruncated;
  }

  return { branches, truncated };
};

/** Git cannot create a branch that exists, or that other branches sit under. */
const isTaken = (candidate: string, branches: readonly string[]): boolean =>
  branches.some((branch) => {
    const existing = branch.toLowerCase();

    return existing === candidate || existing.startsWith(`${candidate}/`);
  });

/**
 * The base name, or the base with the next free number, that none of the
 * Services has. When that cannot be established the name is still offered: the
 * launch refuses a new branch that already exists.
 */
export const findUnusedBranchName = async (
  base: string,
  serviceIds: readonly string[],
  readPlaces: ReadPlacesForBranch,
): Promise<string> => {
  const first = await searchBranches(readPlaces, serviceIds, base);
  if (first === null) {
    return base;
  }

  const known = [...first.branches];
  let candidateSearches = 0;
  for (let number = 1; ; number += 1) {
    const candidate = number === 1 ? base : `${base}-${number}`;
    if (isTaken(candidate, known)) {
      continue;
    }
    // The first search was already the base name's own search.
    const canSearchMore =
      first.truncated && candidateSearches < MAX_CANDIDATE_SEARCHES;
    if (candidate === base || !canSearchMore) {
      return candidate;
    }

    candidateSearches += 1;
    const own = await searchBranches(readPlaces, serviceIds, candidate);
    if (own === null || !isTaken(candidate, own.branches)) {
      return candidate;
    }
    known.push(...own.branches);
  }
};

const DEFAULT_PLAN_WORKTREE_BRANCH = "plan-worktree";

/** Lowercase a-z and 0-9, with everything else turned into single dashes. */
export const slugifyBranchName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const resolveDefaultPlanWorktreeBranch = (title: string): string =>
  slugifyBranchName(title) || DEFAULT_PLAN_WORKTREE_BRANCH;

const DEFAULT_PLAN_WORKTREE_BRANCH = "plan-worktree";

const slugifyPlanBranchName = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const resolveDefaultPlanWorktreeBranch = (title: string): string =>
  slugifyPlanBranchName(title) || DEFAULT_PLAN_WORKTREE_BRANCH;

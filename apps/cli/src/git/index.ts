export {
  attachWorktree,
  createWorktree,
  getBranchWorktreeState,
  switchWorktreeToBranch,
  toBranchSafeName,
  type WorktreeInfo,
  type BranchWorktreeState,
} from './worktree';

export {
  describeGitFailure,
  getGitDiff,
  getGitChangedFileDetail,
  getGitChangedFilesInventory,
  listGitChangedFilePaths,
  listGitChangedFilePathsExcludingIgnored,
  resolveGitRoot,
  type GitFailureDetail,
} from './diff';

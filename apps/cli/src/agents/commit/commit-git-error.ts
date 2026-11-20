/** Git diagnostics safe to publish without the command's commit-message argument. */
export class CommitGitError extends Error {
  constructor(operation: string, reason: string) {
    super(`Commit failed during git ${operation}: ${reason}`);
    this.name = 'CommitGitError';
  }
}

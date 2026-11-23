/** Git diagnostics safe to publish without the command's commit-message argument. */
export class CommitGitError extends Error {
  constructor(operation: string, reason: string) {
    super(`Commit failed during git ${operation}: ${reason}`);
    this.name = 'CommitGitError';
  }
}

/** User-facing failure for a Git outcome retained for report retry. */
export class CommitReportError extends Error {
  constructor(cause: unknown) {
    super('Could not save the commit report. Retry to report the saved Git outcome.', { cause });
    this.name = 'CommitReportError';
  }
}

export class PartialCommitError extends Error {
  constructor(serviceId: string) {
    super(
      `Git failed for service ${serviceId}. Other changes were committed and are listed in the attached report.`,
    );
    this.name = 'PartialCommitError';
  }
}

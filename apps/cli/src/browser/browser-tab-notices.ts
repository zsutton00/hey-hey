/** A tab the user opened for a Run from the session page, not yet told to the agent. */
export interface BrowserTabNotice {
  id: string;
  url: string;
}

/** How the Run's Turn preparation reads and settles its pending user-opened-tab notice. */
export interface BrowserTabNoticeDelivery {
  pending(runId: string): BrowserTabNotice | null;
  delivered(runId: string, noticeId: string): void;
}

/** The agent-facing block for a user-opened tab. */
export const formatBrowserTabNotice = (notice: BrowserTabNotice): string =>
  `Browser tab: the user opened a browser tab at ${notice.url}. It is now the selected page for your browser tools.`;

/**
 * Each Run's latest user-opened tab. Memory only. A newer open replaces an
 * undelivered one, since only the latest tab is still selected.
 */
export class BrowserTabNotices implements BrowserTabNoticeDelivery {
  private readonly runs = new Map<string, BrowserTabNotice>();

  public record(runId: string, notice: BrowserTabNotice): void {
    this.runs.set(runId, notice);
  }
  public pending(runId: string): BrowserTabNotice | null {
    return this.runs.get(runId) ?? null;
  }
  /** Clears only the delivered notice, so one recorded during the Turn's preparation survives. */
  public delivered(runId: string, noticeId: string): void {
    if (this.runs.get(runId)?.id === noticeId) this.runs.delete(runId);
  }
  public drop(runId: string): void {
    this.runs.delete(runId);
  }
}

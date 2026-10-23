import type { ServerLogger } from '../logger';

/** Stores only validated reports. Failed loads are immediately retryable. */
export class ProviderCostReportCache<Report> {
  private readonly reports = new Map<string, { report: Report; receivedAt: number }>();
  private readonly pending = new Map<string, Promise<Report>>();

  public constructor(private readonly canRetain: (report: Report) => boolean = () => true) {}

  public read(key: string, load: () => Promise<Report>, logger?: ServerLogger): Promise<Report> {
    // Session-scoped queries create many keys; release expired reports even when
    // the next request selects another session rather than revisiting that key.
    const now = Date.now();
    for (const [storedKey, entry] of this.reports) {
      if (now - entry.receivedAt >= 30_000) this.reports.delete(storedKey);
    }
    const cached = this.reports.get(key);
    if (cached && Date.now() - cached.receivedAt < 30_000) {
      logger?.debug('local.service.cost_report.cache_hit');
      return Promise.resolve(cached.report);
    }
    const pending = this.pending.get(key);
    if (pending) {
      logger?.debug('local.service.cost_report.coalesced');
      return pending;
    }
    this.reports.delete(key);
    const startedAt = Date.now();
    logger?.debug('local.service.cost_report.refresh_started');
    const request = load()
      .then(
        (report) => {
          const cached = this.canRetain(report);
          if (cached) this.reports.set(key, { report, receivedAt: Date.now() });
          logger?.debug('local.service.cost_report.refresh_completed', {
            durationMs: Date.now() - startedAt,
            cached,
          });
          return report;
        },
        (error) => {
          logger?.debug('local.service.cost_report.refresh_failed', {
            durationMs: Date.now() - startedAt,
          });
          throw error;
        },
      )
      .finally(() => this.pending.delete(key));
    this.pending.set(key, request);
    return request;
  }
}

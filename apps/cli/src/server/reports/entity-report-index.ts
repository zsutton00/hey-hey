import type { ServerLogger } from '../logger';

export interface EntityRef {
  entityType: string;
  entityId: string;
}

export interface EntityReportIndexOptions {
  logger?: ServerLogger;
}

export class EntityReportIndex {
  private readonly logger: ServerLogger | undefined;
  private readonly reportToEntities = new Map<string, Set<string>>();
  private readonly entityToReports = new Map<string, Set<string>>();

  public constructor(options: EntityReportIndexOptions = {}) {
    this.logger = options.logger;
  }

  /**
   * Register (or replace) the set of entity refs a report references. The
   * registration overrides any prior refs for the report so the index always
   * reflects the report's latest shape.
   */
  public registerReport(reportId: string, entityRefs: readonly EntityRef[]): void {
    // Remove any stale reverse-index entries for this report before adding.
    const previous = this.reportToEntities.get(reportId);
    if (previous) {
      for (const key of previous) {
        const reports = this.entityToReports.get(key);
        if (reports) {
          reports.delete(reportId);
          if (reports.size === 0) this.entityToReports.delete(key);
        }
      }
    }

    const keys = new Set<string>();
    for (const ref of entityRefs) {
      if (!ref.entityType || !ref.entityId) continue;
      keys.add(entityKey(ref.entityType, ref.entityId));
    }

    if (keys.size === 0) {
      this.reportToEntities.delete(reportId);
      this.logger?.debug('report-update.index.register.empty', { reportId });
      return;
    }

    this.reportToEntities.set(reportId, keys);
    for (const key of keys) {
      let reports = this.entityToReports.get(key);
      if (!reports) {
        reports = new Set<string>();
        this.entityToReports.set(key, reports);
      }
      reports.add(reportId);
    }

    this.logger?.debug('report-update.index.register', {
      reportId,
      entityCount: keys.size,
    });
  }

  /** Remove a report and its reverse index entries. */
  public unregisterReport(reportId: string): void {
    const keys = this.reportToEntities.get(reportId);
    if (!keys) return;
    for (const key of keys) {
      const reports = this.entityToReports.get(key);
      if (!reports) continue;
      reports.delete(reportId);
      if (reports.size === 0) this.entityToReports.delete(key);
    }
    this.reportToEntities.delete(reportId);
    this.logger?.debug('report-update.index.unregister', { reportId });
  }

  /** Return the report IDs that reference the given entity, or an empty set. */
  public lookupReports(entityType: string, entityId: string): readonly string[] {
    const reports = this.entityToReports.get(entityKey(entityType, entityId));
    return reports ? [...reports] : [];
  }

  /** Return the number of distinct entity refs registered for a report. */
  public getReferencedEntityCount(reportId: string): number {
    return this.reportToEntities.get(reportId)?.size ?? 0;
  }

  /** Return true if the report has any registered refs. */
  public hasReport(reportId: string): boolean {
    return this.reportToEntities.has(reportId);
  }

  /** Return a debug snapshot: reportId → { totalRefs, refs[] }. */
  public snapshot(): Record<string, { totalRefs: number; refs: EntityRef[] }> {
    const out: Record<string, { totalRefs: number; refs: EntityRef[] }> = {};
    for (const [reportId, keys] of this.reportToEntities) {
      const refs: EntityRef[] = [];
      for (const key of keys) refs.push(parseEntityKey(key));
      out[reportId] = { totalRefs: keys.size, refs };
    }
    return out;
  }
}

export const entityKey = (entityType: string, entityId: string): string =>
  `${entityType}:${entityId}`;

export const parseEntityKey = (key: string): EntityRef => {
  const separator = key.indexOf(':');
  return {
    entityType: key.slice(0, separator),
    entityId: key.slice(separator + 1),
  };
};

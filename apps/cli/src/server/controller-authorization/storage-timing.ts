import type { AuthorizationIntegrityKeyTiming } from '../../credentials/keypair';

export type StorageSubstep = 'integrityKey' | 'fileRead' | 'validation' | 'serialize' | 'persist';

/**
 * Accumulates monotonic substep durations for one locked authorization-store operation.
 * Fields carry durations, sources, and counts only — never keys, identities, or contents.
 */
export class StorageTimings {
  private readonly totals: Partial<Record<StorageSubstep, number>> = {};
  private integrityKey: AuthorizationIntegrityKeyTiming | { source: 'supplied' } | undefined;
  private recordCount: number | undefined;

  public async measure<T>(substep: StorageSubstep, operation: () => T | Promise<T>): Promise<T> {
    const started = performance.now();
    try {
      return await operation();
    } finally {
      this.totals[substep] = (this.totals[substep] ?? 0) + performance.now() - started;
    }
  }

  /** The first integrity-key read of an operation decides whether protected storage was touched. */
  public noteIntegrityKey(timing: AuthorizationIntegrityKeyTiming | { source: 'supplied' }): void {
    this.integrityKey ??= timing;
  }

  public noteRecordCount(count: number): void {
    this.recordCount = count;
  }

  public fields(): Record<string, number | string> {
    return {
      integrityKeyMs: this.totals.integrityKey ?? 0,
      fileReadMs: this.totals.fileRead ?? 0,
      validationMs: this.totals.validation ?? 0,
      serializeMs: this.totals.serialize ?? 0,
      persistMs: this.totals.persist ?? 0,
      ...(this.integrityKey ? { integrityKeySource: this.integrityKey.source } : {}),
      ...(this.integrityKey && 'retrieveMs' in this.integrityKey
        ? {
            protectedKeyRetrieveMs: this.integrityKey.retrieveMs,
            protectedKeyStoreMs: this.integrityKey.storeMs,
          }
        : {}),
      ...(this.recordCount !== undefined ? { recordCount: this.recordCount } : {}),
    };
  }
}

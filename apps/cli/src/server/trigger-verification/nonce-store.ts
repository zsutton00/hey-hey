/**
 * In-process replay store. Records seen nonces with a per-entry expiry so a
 * captured envelope cannot be re-delivered inside the freshness window. The
 * TTL is matched to the timestamp freshness bound: an envelope older than the
 * timestamp window is rejected by the timestamp check, so the nonce entry can
 * be evicted as soon as the window closes.
 */

export interface NonceStoreOptions {
  /** Entry TTL in milliseconds. Should equal the timestamp freshness window. */
  ttlMs: number;
  now?: () => number;
}

export class NonceStore {
  private readonly now: () => number;
  private readonly entries = new Map<string, number>();

  public constructor(private readonly options: NonceStoreOptions) {
    this.now = options.now ?? (() => Date.now());
  }

  private evictExpired(currentTime: number): void {
    for (const [nonce, expiresAt] of this.entries) {
      if (expiresAt <= currentTime) {
        this.entries.delete(nonce);
      }
    }
  }

  /** Returns `true` for a new nonce and `false` for a replay. */
  public recordIfFresh(nonce: string): boolean {
    const currentTime = this.now();
    this.evictExpired(currentTime);
    const existing = this.entries.get(nonce);
    if (existing !== undefined && existing > currentTime) return false;
    this.entries.set(nonce, currentTime + this.options.ttlMs);
    return true;
  }

  public size(): number {
    return this.entries.size;
  }
}

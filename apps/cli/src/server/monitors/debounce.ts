/**
 * Key-based debouncer for the monitor pre-subscribe filter. Decoupled from the
 * old trigger-rule model: callers build the dedup key from whatever identity
 * matters (here, the canonical event's type + conversation) and pass the
 * cooldown per call.
 */
export class Debouncer {
  private readonly lastFiredAt = new Map<string, number>();

  /** True when `key` has not fired within `cooldownMs`; records the fire. */
  public shouldTrigger(key: string, cooldownMs: number): boolean {
    const now = Date.now();
    const existing = this.lastFiredAt.get(key);
    if (existing !== undefined && now - existing < cooldownMs) {
      return false;
    }
    this.lastFiredAt.set(key, now);
    return true;
  }

  /** Remove entries older than maxAge (defaults to 5 minutes). */
  public cleanup(maxAgeMs = 300_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, firedAt] of this.lastFiredAt) {
      if (firedAt < cutoff) {
        this.lastFiredAt.delete(key);
      }
    }
  }
}

/**
 * In-process token-bucket rate limiter for the trigger-frame ingress path.
 *
 * There is one CLI process per machine, so "per-machine" reduces to a single
 * process-wide bucket. The bucket sits in front of the signature verifier so
 * a flood of bogus frames cannot pin the verifier hot path.
 *
 * Constants are hardcoded — they are a defensible upper bound on legitimate
 * trigger volume, not a tuning knob.
 */

export interface TriggerRateLimiterOptions {
  /** Maximum tokens the bucket can hold. */
  capacity?: number;
  /** Tokens added per second (steady-state ceiling). */
  refillPerSecond?: number;
  /** Time source, injectable for tests. */
  now?: () => number;
}

/**
 * Defaults sized to comfortably absorb a reconnect redelivery burst and any
 * realistic mix of UI-driven conversation + platform-event triggers, while
 * still cutting off a flood well before it can pin the Ed25519 verifier.
 * The signature itself is the load-bearing defense against a determined
 * attacker; this bucket protects the verifier from volumetric bugs and
 * hostile socket peers.
 */
const DEFAULT_CAPACITY = 120;
const DEFAULT_REFILL_PER_SECOND = 20;

export class TriggerRateLimiter {
  private readonly capacity: number;
  private readonly refillPerSecond: number;
  private readonly now: () => number;
  private tokens: number;
  private lastRefillMs: number;

  public constructor(options: TriggerRateLimiterOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_CAPACITY;
    this.refillPerSecond = options.refillPerSecond ?? DEFAULT_REFILL_PER_SECOND;
    this.now = options.now ?? (() => Date.now());
    this.tokens = this.capacity;
    this.lastRefillMs = this.now();
  }

  private refill(currentMs: number): void {
    const elapsedMs = currentMs - this.lastRefillMs;
    if (elapsedMs <= 0) return;
    const added = (elapsedMs / 1000) * this.refillPerSecond;
    this.tokens = Math.min(this.capacity, this.tokens + added);
    this.lastRefillMs = currentMs;
  }

  /** Returns `true` and consumes a token; returns `false` when empty. */
  public tryConsume(): boolean {
    const currentMs = this.now();
    this.refill(currentMs);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return true;
    }
    return false;
  }
}

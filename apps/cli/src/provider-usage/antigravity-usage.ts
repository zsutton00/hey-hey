import { z } from 'zod';
import {
  AntigravityNotReadyError,
  runAntigravityPrint,
} from '../agents/providers/antigravity/antigravity-readiness';
import { ProviderNotInstalledError } from '../server/model-catalog/provider-process';
import type { ServerLogger } from '../server/logger';
import type { LimitWindow, ProviderUsage } from './provider-usage';
import { unreportedUsage } from './provider-usage';
import type { ProviderUsageStore } from './provider-usage-store';

const MIN_POLL_INTERVAL_MS = 60_000;

const bucketSchema = z.object({
  window: z.string(),
  remaining_fraction: z.number().min(0).max(1),
  reset_time: z.string().datetime(),
});
const quotaSchema = z.object({
  groups: z.array(z.object({ name: z.string(), buckets: z.array(z.unknown()) })),
});

const toWindow = (bucket: z.infer<typeof bucketSchema>): LimitWindow => ({
  usedPercent: (1 - bucket.remaining_fraction) * 100,
  resetsAt: bucket.reset_time,
});

/**
 * Reads the account's quota from the structured data `agy -p /quota` attaches
 * (a read that costs no tokens). `agy` reports a separate set of limits per model
 * group (Gemini, Claude and GPT, Argon). Provider Usage has one five-hour and one
 * weekly slot, so each slot shows the most-used limit of that window across all
 * groups: the one that stops work first. That choice does not depend on the order
 * `agy` lists the groups in. A window no group reports stays null so it renders as
 * not reported.
 */
export const antigravityUsageFromQuota = (
  commandData: unknown,
  observedAt: string,
): ProviderUsage => {
  const quota = quotaSchema.parse(commandData);
  const buckets = quota.groups
    .flatMap((group) => group.buckets)
    .flatMap((raw) => {
      const parsed = bucketSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    });
  const tightest = (window: string): LimitWindow | null => {
    const limits = buckets.filter((bucket) => bucket.window === window);
    const [first, ...rest] = limits;
    if (!first) {
      return null;
    }

    const most = rest.reduce(
      (current, bucket) =>
        bucket.remaining_fraction < current.remaining_fraction ? bucket : current,
      first,
    );
    return toWindow(most);
  };

  return {
    ...unreportedUsage('antigravity'),
    observedAt,
    fiveHour: tightest('5h'),
    weekly: tightest('weekly'),
  };
};

export class AntigravityUsagePoller {
  private lastAttempt = 0;
  private inflight: Promise<void> | null = null;

  public constructor(
    private readonly store: ProviderUsageStore,
    private readonly logger: ServerLogger,
    private readonly now: () => number = Date.now,
    private readonly readQuota: typeof runAntigravityPrint = runAntigravityPrint,
  ) {}

  /** Refreshes the stored snapshot at most once a minute; never throws. */
  public refresh(): Promise<void> {
    if (this.inflight) {
      return this.inflight;
    }
    if (this.now() - this.lastAttempt < MIN_POLL_INTERVAL_MS) {
      return Promise.resolve();
    }
    this.lastAttempt = this.now();
    this.inflight = this.poll().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async poll(): Promise<void> {
    try {
      const { commandData } = await this.readQuota('/quota');
      const usage = antigravityUsageFromQuota(commandData, new Date(this.now()).toISOString());
      await this.store.save(usage);
    } catch (error) {
      if (error instanceof ProviderNotInstalledError) {
        this.logger.debug('antigravity.usage.not_installed', {});
        return;
      }
      this.logger.warn('antigravity.usage.poll_failed', {
        cause: error instanceof AntigravityNotReadyError ? error.cause_ : 'unknown',
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

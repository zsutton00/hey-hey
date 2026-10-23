import { z } from 'zod';
import { NOOP_LOGGER, type ServerLogger } from '../server/logger';
import { ProviderUsageStore } from './provider-usage-store';
import { resetTimestamp, unreportedUsage, windowKey, type ProviderUsage } from './provider-usage';

const number = z.number().finite().nonnegative();
const codexWindow = z.object({
  windowDurationMins: number.nullish(),
  usedPercent: number.nullish(),
  resetsAt: number.nullish(),
});
const codexReport = z.object({
  rateLimits: z.object({
    limitId: z.string().nullish(),
    primary: z.unknown(),
    secondary: z.unknown(),
  }),
});

export class ProviderUsageCapture {
  public constructor(
    private readonly store = new ProviderUsageStore(),
    private readonly logger: ServerLogger = NOOP_LOGGER,
  ) {}
  // External payloads are narrowed here, before any feature or persistence logic.
  public observeCodex(
    method: string,
    payload: unknown,
    observedAt = new Date().toISOString(),
  ): void {
    if (method !== 'account/rateLimits/updated') return;
    const parsed = codexReport.safeParse(payload);
    if (!parsed.success) {
      this.logger.warn('provider_usage.capture.invalid', { provider: 'codex' });
      return;
    }
    const report = parsed.data.rateLimits;
    if (report.limitId != null && report.limitId !== 'codex') return;
    const usage = { ...unreportedUsage('codex'), observedAt };
    let validWindows = 0;
    let malformedWindow = false;
    const reportedKeys: Array<'fiveHour' | 'weekly'> = [];
    for (const payloadWindow of [report.primary, report.secondary]) {
      if (payloadWindow == null) continue;
      const parsedWindow = codexWindow.safeParse(payloadWindow);
      if (!parsedWindow.success) {
        malformedWindow = true;
        this.logger.warn('provider_usage.capture.invalid_window', { provider: 'codex' });
        continue;
      }
      validWindows++;
      const window = parsedWindow.data;
      if (window.windowDurationMins == null) continue;
      const key = windowKey(window.windowDurationMins);
      if (key === null) continue;
      reportedKeys.push(key);
      usage[key] = {
        usedPercent: window.usedPercent ?? null,
        resetsAt: resetTimestamp(window.resetsAt),
      };
    }
    if (malformedWindow) {
      // Preserve prior evidence for the invalid window while accepting its healthy sibling.
      for (const key of reportedKeys) this.persist(usage, key);
    } else if (validWindows > 0 || (report.primary == null && report.secondary == null)) {
      this.persist(usage);
    }
  }
  private persist(usage: ProviderUsage, reportedWindow?: 'fiveHour' | 'weekly'): void {
    this.logger.debug('provider_usage.capture.accepted', {
      provider: usage.provider,
      observedAt: usage.observedAt,
    });
    void this.store.save(usage, reportedWindow).catch(() => {
      this.logger.warn('provider_usage.capture.write_failed', { provider: usage.provider });
    });
  }
  public async flush(): Promise<void> {
    await this.store.flush();
  }
}

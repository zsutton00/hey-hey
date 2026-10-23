import type { ServerLogger } from '../logger';
import type { CanonicalMonitorEvent } from './normalizer';
import { Debouncer } from './debounce';
import { isQuietHours } from './quiet-hours';
import type { TriggerConfig } from './trigger-config';

export interface MonitorPreSubscribeFilterDependencies {
  config: Pick<TriggerConfig, 'quietHours' | 'debounceMs'>;
  logger: ServerLogger;
}

/**
 * The pre-subscribe filter the composed pipeline applies to platform-lane
 * events before fanning them to any monitor's subscribe/gate. It folds the two
 * pipeline-level suppressions the deleted trigger engine owned — quiet-hours
 * windows and per-entity debounce — neither of which is gate state. Returns
 * true to admit the event, false to drop it.
 *
 * Report emissions (origin `'self'`) never reach this filter: each report must
 * drive exactly one session-monitor evaluation, so quiet-hours and debounce do
 * not apply to the CLI's own agent work.
 */
export class MonitorPreSubscribeFilter {
  private readonly debouncer = new Debouncer();
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  public constructor(private readonly dependencies: MonitorPreSubscribeFilterDependencies) {
    this.cleanupInterval = setInterval(() => this.debouncer.cleanup(), 60_000);
    this.cleanupInterval.unref();
  }

  public accept(event: CanonicalMonitorEvent): boolean {
    const { config, logger } = this.dependencies;
    if (config.quietHours && isQuietHours(config.quietHours)) {
      logger.debug('monitors.pre-filter.quiet-hours', { eventType: event.eventType });
      return false;
    }

    const key = `${event.eventType}:${event.entityId ?? ''}`;
    if (!this.debouncer.shouldTrigger(key, config.debounceMs)) {
      logger.debug('monitors.pre-filter.debounced', { key });
      return false;
    }

    return true;
  }

  public dispose(): void {
    clearInterval(this.cleanupInterval);
  }
}

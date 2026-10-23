import { LocalPromptType } from '../../../shared/agent-bridge-contract/generated';
import {
  DEFAULT_DAILY_SESSION_LAUNCH,
  DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
  type DailySessionSettings,
} from '../daily-session-settings';
import type { CanonicalMonitorEvent } from '../normalizer';
import { CountToNGate } from '../rules/gate';
import { dailySessionSubscribe } from '../rules/subscribe';
import type { Monitor, MonitorGate } from './types';

// The provider-built catalog does not exist yet when this module loads, so the
// default launch is not checked against it; the provider judges it at launch.
const DEFAULT_SETTINGS: DailySessionSettings = {
  ...DEFAULT_DAILY_SESSION_SETTINGS_INPUT,
  eventTypes: [...new Set(DEFAULT_DAILY_SESSION_SETTINGS_INPUT.eventTypes)],
  ...DEFAULT_DAILY_SESSION_LAUNCH,
};

/**
 * Daily-session monitor: watches genuine platform activity and fires a fresh
 * daily-session run once enough activity has accumulated. The count-to-N gate
 * owns the accumulation and the resolved project settings supply the threshold,
 * subscribed event types, admission state, and launch selection.
 */
export class DailySessionMonitor implements Monitor {
  public readonly id = 'daily-session';
  public readonly route = LocalPromptType.DailySession;
  public readonly gate: CountToNGate;
  private eventTypes: ReadonlySet<string>;

  public constructor(public settings: DailySessionSettings = DEFAULT_SETTINGS) {
    this.gate = new CountToNGate(settings.countThreshold);
    this.eventTypes = new Set(settings.eventTypes);
  }

  public applySettings(settings: DailySessionSettings): void {
    this.settings = settings;
    this.eventTypes = new Set(settings.eventTypes);
    this.gate.reconfigure(settings.countThreshold);
  }

  public subscribes(event: CanonicalMonitorEvent): boolean {
    return dailySessionSubscribe(event, this.eventTypes);
  }

  public admits(_event: CanonicalMonitorEvent): Promise<boolean> {
    return Promise.resolve(this.settings.enabled);
  }

  public watchesEventType(eventType: string): boolean {
    return this.eventTypes.has(eventType);
  }
}

const DEFAULT_DAILY_SESSION_MONITOR_SETTINGS: DailySessionSettings = {
  ...DEFAULT_SETTINGS,
  ...DEFAULT_DAILY_SESSION_LAUNCH,
};

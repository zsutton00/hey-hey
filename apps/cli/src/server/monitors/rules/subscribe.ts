import { DEFAULT_TRIGGER_CONFIG } from '../trigger-config';
import { isSettledTurnEvent, type CanonicalMonitorEvent } from '../normalizer';

/**
 * The platform activity event types the daily-session monitor watches, derived
 * from the trigger config rules so the watched set and the rule set never drift
 * apart. These are the genuine project-activity signals (session and task
 * lifecycle changes) that should count toward a daily-session re-run.
 */
const DAILY_SESSION_ACTIVITY_EVENT_TYPES: ReadonlySet<string> = new Set(
  DEFAULT_TRIGGER_CONFIG.rules.map((rule) => rule.eventType),
);

/**
 * Whether a platform frame belongs on the Daily Session monitor lane at all.
 * `PlatformEventDispatcher` uses this before normalization so high-volume
 * control and conversation frames do not fan out through declarations that
 * can never subscribe to them.
 */
export const isDailySessionActivityEventType = (eventType: string): boolean =>
  DAILY_SESSION_ACTIVITY_EVENT_TYPES.has(eventType);

/**
 * Daily-session subscribe predicate. Matches genuine platform activity of the
 * configured types. Events the normalizer stamped origin `'self'` — the CLI's
 * own agent echoes — are dropped here; this predicate is the home of the
 * self-origin drop once the trigger coordinator is removed.
 */
export const dailySessionSubscribe = (
  event: CanonicalMonitorEvent,
  eventTypes: ReadonlySet<string> = DAILY_SESSION_ACTIVITY_EVENT_TYPES,
): boolean => event.origin === 'platform' && eventTypes.has(event.eventType);

/**
 * Session Monitor evaluates settled Turns and excludes its own Turns to avoid
 * recursively supervising monitor output.
 */
export const sessionMonitorSubscribe = (event: CanonicalMonitorEvent): boolean =>
  isSettledTurnEvent(event) && event.promptType !== 'session_monitor';

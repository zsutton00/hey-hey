/**
 * Cross-tab coordination primitives for the `session_report_ready` toast.
 *
 * Two independent primitives, both scoped per project so tabs on different
 * projects neither cross-suppress nor cross-dismiss:
 *
 * - A localStorage "shown record": one key per project holding a map of
 *   `reportId -> timestamp`. The first tab to make the display decision writes
 *   the record; sibling tabs and post-reconnect / replayed frames read it to
 *   avoid showing a duplicate toast for a report already handled. Every write
 *   prunes entries past the TTL and caps the map, so storage stays bounded
 *   without a separate cleanup pass. `reportId`s are unique, so an expired
 *   entry can never wrongly suppress a new report — the TTL is storage
 *   hygiene, not correctness.
 * - A `BroadcastChannel` carrying only the `dismissed:<reportId>` signal so a
 *   dismissal in one tab clears the matching toast in every other tab. It is a
 *   signal bus, not the display arbiter — the shown record owns suppression.
 */

const SHOWN_RECORD_PREFIX = "heyhey:sessionReportToastShown:";
const DISMISS_CHANNEL_PREFIX = "heyhey:sessionReportToastDismiss:";
const DISMISSAL_MESSAGE_PREFIX = "dismissed:";

/**
 * How long a shown record stays valid. Long enough to outlive a WebSocket
 * reconnect / replayed frame and a deferred toast for a backgrounded tab.
 */
const SHOWN_RECORD_TTL_MS = 24 * 60 * 60 * 1000;

/** Hard ceiling on shown records kept per project; oldest are evicted first. */
const SHOWN_RECORD_MAX_ENTRIES = 50;

/** Map of `reportId -> epoch-ms timestamp the record was written. */
type ShownRecordMap = Record<string, number>;

const shownRecordKey = (projectId: string): string =>
  `${SHOWN_RECORD_PREFIX}${projectId}`;

const readShownRecordMap = (projectId: string): ShownRecordMap => {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(shownRecordKey(projectId));
    if (raw === null) {
      return {};
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const map: ShownRecordMap = {};
    for (const [reportId, timestamp] of Object.entries(parsed)) {
      if (typeof timestamp === "number") {
        map[reportId] = timestamp;
      }
    }
    return map;
  } catch {
    return {};
  }
};

/** Drop entries past the TTL, then keep only the most recent up to the cap. */
const pruneShownRecordMap = (
  map: ShownRecordMap,
  now: number,
): ShownRecordMap => {
  const live = Object.entries(map)
    .filter(([, timestamp]) => now - timestamp < SHOWN_RECORD_TTL_MS)
    .sort(([, left], [, right]) => right - left)
    .slice(0, SHOWN_RECORD_MAX_ENTRIES);
  return Object.fromEntries(live);
};

/**
 * True when this browser has already shown (or deliberately suppressed) the
 * `session_report_ready` toast for the given report under the given project,
 * within the TTL window.
 */
export const hasShownRecord = (
  projectId: string,
  reportId: string,
): boolean => {
  const timestamp = readShownRecordMap(projectId)[reportId];
  return (
    timestamp !== undefined && Date.now() - timestamp < SHOWN_RECORD_TTL_MS
  );
};

/**
 * Record that the `session_report_ready` toast for this report has been
 * handled (shown or deliberately suppressed) so sibling tabs and replays skip
 * it. Each call also prunes the project's map so it never grows unbounded.
 */
export const writeShownRecord = (
  projectId: string,
  reportId: string,
): void => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const now = Date.now();
    const map = readShownRecordMap(projectId);
    map[reportId] = now;
    window.localStorage.setItem(
      shownRecordKey(projectId),
      JSON.stringify(pruneShownRecordMap(map, now)),
    );
  } catch {
    // Ignore quota / privacy-mode errors — dedup just degrades to per-tab.
  }
};

const dismissChannelName = (projectId: string): string =>
  `${DISMISS_CHANNEL_PREFIX}${projectId}`;

export interface SessionReportDismissalChannel {
  /** Tell sibling tabs that the toast for this report has been dismissed. */
  broadcastDismissal: (reportId: string) => void;
  /** Listen for dismissals broadcast by sibling tabs. Returns an unsubscribe. */
  subscribe: (onDismissal: (reportId: string) => void) => () => void;
  /** Tear down the underlying channel. */
  close: () => void;
}

/**
 * Create a per-project dismissal signal bus. When `BroadcastChannel` is
 * unavailable (e.g. SSR or an unsupported browser) every method is a safe
 * no-op and toast dedup simply degrades to per-tab.
 */
export const createSessionReportDismissalChannel = (
  projectId: string,
): SessionReportDismissalChannel => {
  const channel =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel(dismissChannelName(projectId))
      : null;

  return {
    broadcastDismissal: (reportId: string): void => {
      channel?.postMessage(`${DISMISSAL_MESSAGE_PREFIX}${reportId}`);
    },
    subscribe: (onDismissal): (() => void) => {
      if (!channel) {
        return () => {};
      }
      const handler = (event: MessageEvent): void => {
        const data: unknown = event.data;
        if (
          typeof data !== "string" ||
          !data.startsWith(DISMISSAL_MESSAGE_PREFIX)
        ) {
          return;
        }
        onDismissal(data.slice(DISMISSAL_MESSAGE_PREFIX.length));
      };
      channel.addEventListener("message", handler);
      return () => {
        channel.removeEventListener("message", handler);
      };
    },
    close: (): void => {
      channel?.close();
    },
  };
};

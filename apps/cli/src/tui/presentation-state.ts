/**
 * The immutable state the presentation owner publishes once per frame. View
 * models are pure functions of this state; nothing here is read from a Run,
 * an event or the platform directly.
 */

import type { MachineEnrollmentCeremonyStep } from '../auth/machine-enrollment-ceremony';
import type { MachineActionId, MachineStatusSnapshot } from '../commands/machine-actions';
import type { DiagnosticMetadata, DiagnosticRecord } from '../server/diagnostic-feed';
import type { LocalSessionMetadata } from '../server/local-session-metadata-source';
import type { LocalSessionSnapshot } from '../server/local-session-read-source';
import type { SessionActivityEntry, SessionActivityGap } from '../server/session-activity-source';
import type { SharedBrowserSnapshot } from './browser-source';
import type { NavigationState, RunIdentity } from './navigation';
import type { OptionsSnapshot } from './options-source';

export type MenuItem =
  | { readonly kind: 'action'; readonly id: MachineActionId }
  | { readonly kind: 'session'; readonly run: RunIdentity }
  | { readonly kind: 'browser-toggle' }
  | { readonly kind: 'browser'; readonly projectId: string }
  | { readonly kind: 'options' }
  | { readonly kind: 'debug' };

export type StartupStatus =
  | { readonly kind: 'starting' }
  | { readonly kind: 'running' }
  | { readonly kind: 'failed'; readonly heading: string; readonly body: string }
  | { readonly kind: 'stopping' };

/**
 * Scroll position of a live feed. Following live shows the newest rows.
 * Scrolling pins the feed at the newest sequence then shown, so later
 * arrivals never move what the user is reading until they return to live.
 */
export type FeedScroll =
  | { readonly mode: 'live' }
  | {
      readonly mode: 'paused';
      readonly pinnedThroughSeq: number;
      /** Rows above the bottom of the pinned content. */
      readonly offset: number;
    };

export interface CeremonyState {
  readonly actionId: 'pair' | 'add-controller';
  readonly step: MachineEnrollmentCeremonyStep | null;
  /** Browser destination for the current handoff code, when one was issued. */
  readonly browserUrl: string | null;
}

interface FocusedActivity {
  readonly run: RunIdentity;
  /** Ordered by sequence. */
  readonly entries: readonly SessionActivityEntry[];
  readonly gap: SessionActivityGap;
}

interface DiagnosticsView extends DiagnosticMetadata {
  readonly records: readonly DiagnosticRecord[];
  readonly evictedCount: number;
  readonly droppedReentrantCount: number;
  readonly exportResult: DiagnosticExportResult | null;
}

export type DiagnosticExportResult =
  | { readonly kind: 'choosing' }
  | { readonly kind: 'cancelled' }
  | {
      readonly kind: 'success';
      readonly path: string;
      readonly count: number;
      readonly evictedCount: number;
      readonly expiredCount: number;
    }
  | { readonly kind: 'failure'; readonly message: string };

export interface Viewport {
  readonly columns: number;
  readonly rows: number;
}

/** Which profile and platform environment this CLI targets; null is the default. */
export interface RuntimeTarget {
  readonly profile: string | null;
  /** The platform API host; null = production. */
  readonly environment: string | null;
}

/** The rows on the Options screen, in display order. */
export const OPTIONS_ROWS = [
  'intent-first',
  'remote-tool-call-viewing',
  'jev-parent-feature-filter',
] as const;
export type OptionsRow = (typeof OPTIONS_ROWS)[number];

export interface PresentationState {
  readonly navigation: NavigationState;
  readonly startup: StartupStatus;
  readonly sessions: readonly LocalSessionSnapshot[];
  readonly metadata: ReadonlyMap<string, LocalSessionMetadata>;
  /** Null until the local server is running. */
  readonly machine: MachineStatusSnapshot | null;
  /** Null until the local server is running. */
  readonly sharedBrowser: SharedBrowserSnapshot | null;
  /** Null until the local server is running. */
  readonly options: OptionsSnapshot | null;
  /** The highlighted row on the Options screen. */
  readonly optionsRow: OptionsRow;
  /** Null selects the first menu item. */
  readonly selection: MenuItem | null;
  readonly activity: FocusedActivity | null;
  readonly activityScroll: FeedScroll;
  readonly diagnostics: DiagnosticsView | null;
  readonly diagnosticsScroll: FeedScroll;
  readonly ceremony: CeremonyState | null;
  /** Runs holding active work, by the runtime's own predicate. */
  readonly activeWorkCount: number;
  readonly viewport: Viewport;
  readonly nowMs: number;
  readonly webOrigin: string;
  readonly target: RuntimeTarget;
  readonly color: boolean;
}

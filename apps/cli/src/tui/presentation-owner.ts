/**
 * PresentationOwner — the terminal menu's single state owner.
 *
 * It holds the screen stack, menu selection, display interest, source
 * subscriptions, ceremony input, viewport and feed scroll positions. Sources
 * are consumed as typed snapshots and updates; nothing here joins graph data,
 * parses provider output or reconstructs execution state. Leaving a screen
 * only unsubscribes a view: it never stops a Run or provider.
 *
 * Changes are coalesced and published at most once per frame interval, so a
 * burst of streamed output costs one render. React connects through
 * `subscribe`/`getSnapshot` (useSyncExternalStore) in exactly one place.
 *
 * Quit and Ctrl+C arrive here. The owner decides whether to confirm, then
 * resolves `exitRequested`; the foreground server command owns shutdown.
 */

import {
  MachineEnrollmentCeremony,
  type MachineEnrollmentCeremonyPorts,
  type MachineEnrollmentCeremonyStep,
} from '../auth/machine-enrollment-ceremony';
import type { MachineEnrollmentConfirmationResult } from '../auth/machine-enrollment-confirmation';
import type {
  MachineActionId,
  MachineActionUnavailableReason,
  MachineStatusSnapshot,
} from '../commands/machine-actions';
import type { PairingWebRoute } from '../commands/pairing-web-url';
import type {
  DiagnosticFeed,
  DiagnosticFeedUpdate,
  DiagnosticMetadata,
  DiagnosticRecord,
} from '../server/diagnostic-feed';
import { diagnosticExportFilename, writeDiagnosticExport } from '../server/diagnostic-feed-export';
import type { SaveFilePicker } from '../server/directory-picker';
import type {
  LocalSessionMetadata,
  LocalSessionMetadataUpdate,
} from '../server/local-session-metadata-source';
import type {
  LocalSessionReadSource,
  LocalSessionSnapshot,
  LocalSessionUpdate,
} from '../server/local-session-read-source';
import type { LocalSessionMetadataSource } from '../server/local-session-metadata-source';
import type { SessionActivitySource } from '../server/session-activity-source';
import type { MachineActions } from '../commands/machine-actions';
import type {
  SessionActivityEntry,
  SessionActivityGap,
  SessionActivityUpdate,
} from '../server/session-activity-source';
import type { SharedBrowserSnapshot, SharedBrowserSource } from './browser-source';
import type { OptionsSnapshot, OptionsSource } from './options-source';
import type { PresentationCommand, ScrollAmount } from './keybindings';
import { menuItems, sameMenuItem, selectedIndex } from './menu-items';
import {
  initialNavigation,
  navigate,
  topScreen,
  type NavigationCommand,
  type RunIdentity,
  type Screen,
} from './navigation';
import {
  OPTIONS_ROWS,
  type CeremonyState,
  type DiagnosticExportResult,
  type FeedScroll,
  type MenuItem,
  type OptionsRow,
  type PresentationState,
  type RuntimeTarget,
  type StartupStatus,
  type Viewport,
} from './presentation-state';
import { conversationWebHandoff } from './web-handoff';
import { activityFeedHeight, activityMaxOffset } from './screens/session/view-model';
import {
  diagnosticsFeedHeight,
  diagnosticsMaxOffset,
  diagnosticsResultHeight,
} from './screens/debug/view-model';

/** Publications to React are capped at this rate (about 20 frames per second). */
const PRESENTATION_FRAME_INTERVAL_MS = 50;
/** Running durations refresh at this interval while the menu is mounted. */
const CLOCK_INTERVAL_MS = 1_000;

/** The parts of the running server's presentation sources this owner reads. */
export interface PresentationSources {
  readonly sessions: Pick<LocalSessionReadSource, 'observe' | 'activeWorkCount'>;
  readonly sessionMetadata: Pick<LocalSessionMetadataSource, 'observe' | 'setDisplayInterest'>;
  readonly sessionActivity: Pick<SessionActivitySource, 'observe'>;
  readonly machineActions: Pick<MachineActions, 'observe' | 'start'>;
  readonly sharedBrowser: Pick<SharedBrowserSource, 'observe' | 'close' | 'setEnabled'>;
  readonly options: Pick<
    OptionsSource,
    'observe' | 'setIntentFirst' | 'setRemoteToolCallViewing' | 'setJevEnabled'
  >;
}

export interface PresentationOwnerDependencies {
  /** The Debug feed; it exists before the server starts so startup output is kept. */
  diagnostics: Pick<DiagnosticFeed, 'observe' | 'snapshot'>;
  webOrigin: string;
  target: RuntimeTarget;
  pairingUrl: (userCode: string, route: PairingWebRoute) => string;
  openUrl: (url: string) => Promise<void>;
  /** Opens the native save dialog for a Debug export. */
  chooseSaveFile: SaveFilePicker;
  /** Records a problem the owner itself hit; never routed back through the terminal. */
  report: (event: string, details: Record<string, unknown>) => void;
  color: boolean;
  viewport: Viewport;
  frameIntervalMs?: number;
  now?: () => number;
}

const UNAVAILABLE_ACTION_NOTICE: Record<MachineActionUnavailableReason, string> = {
  'operation-in-progress': 'Another machine action is still running.',
  'signed-out': 'You are already signed out of your account.',
  'machine-not-paired': 'Pair this machine before adding a controller.',
  'machine-authority-unusable': 'Pair this machine again before adding a controller.',
  'already-paired': 'This machine is already paired.',
};

const CONFIRMED_NOTICE: Record<CeremonyState['actionId'], string> = {
  pair: 'This machine is paired.',
  'add-controller': 'The controller was added.',
};

interface ActiveCeremony {
  readonly ceremony: MachineEnrollmentCeremony;
  readonly unsubscribe: () => void;
}

export class PresentationOwner {
  private readonly listeners = new Set<() => void>();
  private readonly now: () => number;
  private readonly frameIntervalMs: number;
  private sources: PresentationSources | null = null;
  private readonly sourceSubscriptions: Array<() => void> = [];

  private navigation = initialNavigation();
  private startup: StartupStatus = { kind: 'starting' };
  private sessions = new Map<string, LocalSessionSnapshot>();
  private metadata = new Map<string, LocalSessionMetadata>();
  private machine: MachineStatusSnapshot | null = null;
  private sharedBrowser: SharedBrowserSnapshot | null = null;
  private options: OptionsSnapshot | null = null;
  private optionsRow: OptionsRow = 'intent-first';
  private selection: PresentationState['selection'] = null;
  private viewport: Viewport;
  private activeWorkCount = 0;
  private displayInterest: readonly string[] = [];

  private activityRun: RunIdentity | null = null;
  private activityEntries = new Map<string, SessionActivityEntry>();
  private activityGap: SessionActivityGap = { evictedCount: 0, throughSeq: null };
  private unsubscribeActivity: (() => void) | null = null;
  private activityScroll: FeedScroll = { mode: 'live' };

  private diagnosticRecords: DiagnosticRecord[] | null = null;
  private diagnosticEvicted = 0;
  private diagnosticMetadata: DiagnosticMetadata | null = null;
  private diagnosticDropped = 0;
  private diagnosticExportResult: DiagnosticExportResult | null = null;
  private diagnosticExportRequest = 0;
  private unsubscribeDiagnostics: (() => void) | null = null;
  private diagnosticsScroll: FeedScroll = { mode: 'live' };

  private ceremonyState: CeremonyState | null = null;
  private activeCeremony: ActiveCeremony | null = null;

  private published: PresentationState;
  private frameTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPublishedAt = Number.NEGATIVE_INFINITY;
  private readonly clockTimer: ReturnType<typeof setInterval>;
  private interactive = true;
  private exiting = false;
  private disposed = false;
  private resolveExit!: () => void;

  /** Resolves once the user asked to leave and, if needed, confirmed stopping Runs. */
  public readonly exitRequested: Promise<void>;

  public constructor(private readonly dependencies: PresentationOwnerDependencies) {
    this.now = dependencies.now ?? Date.now;
    this.frameIntervalMs = dependencies.frameIntervalMs ?? PRESENTATION_FRAME_INTERVAL_MS;
    this.viewport = dependencies.viewport;
    this.exitRequested = new Promise<void>((resolve) => {
      this.resolveExit = resolve;
    });
    this.published = this.buildState();
    this.clockTimer = setInterval(() => this.markDirty(), CLOCK_INTERVAL_MS);
    this.clockTimer.unref();
  }

  // --- React connection --------------------------------------------------

  public readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  public readonly getSnapshot = (): PresentationState => this.published;

  // --- lifecycle ----------------------------------------------------------

  /** Connects the running server's sources. Called once startup succeeds. */
  public attach(sources: PresentationSources): void {
    if (this.disposed || this.sources) return;
    this.sources = sources;
    this.startup = { kind: 'running' };

    const sessions = sources.sessions.observe((update) => this.applySessionUpdate(update));
    for (const session of sessions.snapshot.sessions) this.sessions.set(session.runId, session);
    const metadata = sources.sessionMetadata.observe((update) => this.applyMetadataUpdate(update));
    for (const entry of metadata.snapshot.sessions) this.metadata.set(entry.runId, entry);
    const machine = sources.machineActions.observe((snapshot) => {
      this.machine = snapshot;
      this.markDirty();
    });
    this.machine = machine.snapshot;
    const sharedBrowser = sources.sharedBrowser.observe((snapshot) => {
      this.sharedBrowser = snapshot;
      this.markDirty();
    });
    this.sharedBrowser = sharedBrowser.snapshot;
    const options = sources.options.observe((snapshot) => {
      this.options = snapshot;
      this.markDirty();
    });
    this.options = options.snapshot;
    this.sourceSubscriptions.push(
      sessions.unsubscribe,
      metadata.unsubscribe,
      machine.unsubscribe,
      sharedBrowser.unsubscribe,
      options.unsubscribe,
    );
    this.activeWorkCount = sources.sessions.activeWorkCount();
    this.syncScreenSubscriptions();
    this.markDirty();
  }

  public presentStartupFailure(heading: string, body: string): void {
    this.startup = { kind: 'failed', heading, body };
    this.markDirty();
  }

  public resize(viewport: Viewport): void {
    if (viewport.columns === this.viewport.columns && viewport.rows === this.viewport.rows) return;
    this.viewport = viewport;
    this.markDirty();
  }

  /**
   * The terminal view stopped rendering (a render failure). Execution goes on;
   * quitting no longer asks for confirmation because nothing can show it.
   */
  public detachInteractive(): void {
    this.interactive = false;
  }

  /** SIGINT delivered to the process while the menu owns the terminal. */
  public interrupt(): void {
    this.dispatch({ kind: 'interrupt' });
  }

  /**
   * Runs startup pairing recovery as the pairing screen. Resolves true only
   * when the machine was paired; leaving the screen cancels the attempt.
   */
  public async recoverPairing(
    pair: (ports: MachineEnrollmentCeremonyPorts) => Promise<MachineEnrollmentConfirmationResult>,
  ): Promise<boolean> {
    if (this.exiting) return false;
    const ceremony = new MachineEnrollmentCeremony();
    const result = ceremony.run(pair, (error) => {
      this.dependencies.report('presentation.startup_pairing_failed', { error: error.message });
      return { outcome: 'failed' } satisfies MachineEnrollmentConfirmationResult;
    });
    this.beginCeremony('pair', ceremony);
    const settled = await result;
    return settled.outcome === 'confirmed';
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.clockTimer);
    if (this.frameTimer) clearTimeout(this.frameTimer);
    this.frameTimer = null;
    this.endCeremony(true);
    this.unsubscribeActivity?.();
    this.unsubscribeActivity = null;
    this.unsubscribeDiagnostics?.();
    this.unsubscribeDiagnostics = null;
    for (const unsubscribe of this.sourceSubscriptions.splice(0)) unsubscribe();
    this.sources?.sessionMetadata.setDisplayInterest([]);
    this.listeners.clear();
  }

  // --- commands -----------------------------------------------------------

  public dispatch(command: PresentationCommand): void {
    if (this.disposed) return;
    switch (command.kind) {
      case 'move-selection':
        this.moveSelection(command.delta);
        break;
      case 'activate-selection':
        this.activateSelection();
        break;
      case 'open-web':
        this.openWeb();
        break;
      case 'open-debug':
        this.navigateTo({ kind: 'open', screen: { kind: 'debug' } });
        break;
      case 'export-debug':
        if (topScreen(this.navigation).kind === 'debug') void this.exportDiagnostics();
        break;
      case 'back':
        this.back();
        break;
      case 'scroll':
        this.scroll(command.direction, command.amount);
        break;
      case 'follow-live':
        this.setScroll({ mode: 'live' });
        break;
      case 'quit':
      case 'interrupt':
        this.requestQuit(command.kind);
        break;
      case 'confirm-quit':
        this.exit();
        break;
      case 'answer-review':
        this.activeCeremony?.ceremony.respond({ kind: 'confirm', approved: command.approved });
        break;
    }
    this.markDirty();
  }

  private navigateTo(command: NavigationCommand): void {
    this.navigation = navigate(this.navigation, command);
    this.syncScreenSubscriptions();
  }

  private back(): void {
    const top = topScreen(this.navigation);
    if ((top.kind === 'pairing' || top.kind === 'add-controller') && this.activeCeremony) {
      // Leaving a ceremony cancels it; its finished step releases the screen's input.
      this.activeCeremony.ceremony.cancel();
    }
    this.navigateTo({ kind: 'back' });
  }

  private moveSelection(delta: -1 | 1): void {
    if (topScreen(this.navigation).kind === 'options') {
      const index = OPTIONS_ROWS.indexOf(this.optionsRow) + delta;
      this.optionsRow =
        OPTIONS_ROWS[Math.min(OPTIONS_ROWS.length - 1, Math.max(0, index))] ?? this.optionsRow;
      return;
    }
    const items = this.currentMenuItems();
    const index = selectedIndex(items, this.selection);
    // From nothing selected, Down takes the first item and Up the last.
    const target = index === -1 ? (delta === 1 ? 0 : items.length - 1) : index + delta;
    const next = items[Math.min(items.length - 1, Math.max(0, target))];
    if (next) this.selection = next;
  }

  private activateSelection(): void {
    if (topScreen(this.navigation).kind === 'options') {
      this.toggleOption();
      return;
    }
    const items = this.currentMenuItems();
    const item = items[selectedIndex(items, this.selection)];
    if (!item) return;
    this.selection = item;
    switch (item.kind) {
      case 'session':
        this.activityScroll = { mode: 'live' };
        this.navigateTo({ kind: 'open', screen: { kind: 'session', run: item.run } });
        return;
      case 'options':
        this.optionsRow = 'intent-first';
        this.navigateTo({ kind: 'open', screen: { kind: 'options' } });
        return;
      case 'debug':
        this.navigateTo({ kind: 'open', screen: { kind: 'debug' } });
        return;
      case 'action':
        this.startAction(item.id);
        return;
      case 'browser-toggle':
        this.toggleSharedBrowser();
        return;
      case 'browser':
        this.closeSharedBrowser(item.projectId);
        return;
    }
  }

  private currentMenuItems(): MenuItem[] {
    return menuItems({ sessions: [...this.sessions.values()], sharedBrowser: this.sharedBrowser });
  }

  private toggleOption(): void {
    const row = this.optionsRow;
    const current = {
      'intent-first': this.options?.intentFirst,
      'remote-tool-call-viewing': this.options?.remoteToolCallViewing,
      jev: this.options?.jevEnabled,
    }[row];
    if (!this.sources || current === null || current === undefined) {
      this.navigateTo({ kind: 'notice', message: 'Options are still loading.' });
      return;
    }
    if (row === 'jev' && this.options?.jevKeyDefined === false) {
      this.navigateTo({
        kind: 'notice',
        message: 'Define a Jev key in your environment to turn this on.',
      });
      return;
    }
    const options = this.sources.options;
    // The source publishes the new value once it is saved, so the screen updates straight away.
    const save = {
      'intent-first': () => options.setIntentFirst(!current),
      'remote-tool-call-viewing': () => options.setRemoteToolCallViewing(!current),
      jev: () => options.setJevEnabled(!current),
    }[row]();
    void save.then(
      () => this.markDirty(),
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.dependencies.report('presentation.options_write_failed', { error: message });
        this.navigateTo({ kind: 'notice', message: `Could not save this option: ${message}` });
        this.markDirty();
      },
    );
  }

  private toggleSharedBrowser(): void {
    const enabled = this.sharedBrowser?.enabled ?? null;
    if (!this.sources || enabled === null) {
      this.navigateTo({ kind: 'notice', message: 'Shared Browser is still starting.' });
      return;
    }
    this.runBrowserAction(
      this.sources.sharedBrowser.setEnabled(!enabled),
      enabled ? 'Shared Browser turned off.' : 'Shared Browser turned on.',
      enabled ? 'Could not turn Shared Browser off' : 'Could not turn Shared Browser on',
    );
  }

  private closeSharedBrowser(projectId: string): void {
    const project = this.sharedBrowser?.projects.find((known) => known.projectId === projectId);
    if (!this.sources || project?.status !== 'running') {
      this.navigateTo({ kind: 'notice', message: "This project's browser is not running." });
      return;
    }
    this.runBrowserAction(
      this.sources.sharedBrowser.close(projectId),
      "Closed this project's browser. It opens again when an agent needs it.",
      "Could not close this project's browser",
    );
  }

  private runBrowserAction(operation: Promise<void>, done: string, failed: string): void {
    void operation.then(
      () => {
        this.navigateTo({ kind: 'notice', message: done });
        this.markDirty();
      },
      (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.dependencies.report('presentation.shared_browser_action_failed', { error: message });
        this.navigateTo({ kind: 'notice', message: `${failed}: ${message}` });
        this.markDirty();
      },
    );
  }

  private startAction(id: MachineActionId): void {
    if (!this.sources) {
      this.navigateTo({
        kind: 'notice',
        message: 'Machine actions are available once Hey Hey has started.',
      });
      return;
    }
    const start = this.sources.machineActions.start(id);
    if (!start.started) {
      this.navigateTo({ kind: 'notice', message: UNAVAILABLE_ACTION_NOTICE[start.reason] });
      return;
    }
    const operation = start.operation;
    if (operation.kind === 'ceremony') {
      this.beginCeremony(operation.actionId, operation.ceremony);
      return;
    }
    this.navigateTo({ kind: 'notice', message: 'Signing out of your account…' });
    void operation.completion.then((result) => {
      const message =
        result.outcome === 'failed'
          ? `Sign-out failed: ${result.message}`
          : 'Signed out of your account. This machine stays paired.';
      this.navigateTo({ kind: 'notice', message });
      this.markDirty();
    });
  }

  private openWeb(): void {
    const top = topScreen(this.navigation);
    let run: RunIdentity | null = null;
    if (top.kind === 'session') run = top.run;
    else if (top.kind === 'menu') {
      const items = this.currentMenuItems();
      const item = items[selectedIndex(items, this.selection)];
      if (item?.kind === 'session') run = item.run;
    }
    const session = run ? this.sessions.get(run.runId) : undefined;
    if (!session || session.runInstanceId !== run?.runInstanceId) {
      this.navigateTo({ kind: 'notice', message: 'Select a session to open it in the web app.' });
      return;
    }
    const handoff = conversationWebHandoff(this.dependencies.webOrigin, session);
    if (!handoff.available) {
      this.navigateTo({ kind: 'notice', message: handoff.reason });
      return;
    }
    const url = handoff.url;
    void this.dependencies.openUrl(url).catch((error: unknown) => {
      this.dependencies.report('presentation.open_web_failed', {
        url,
        error: error instanceof Error ? error.message : String(error),
      });
      this.navigateTo({ kind: 'notice', message: `Could not open a browser. Visit ${url}` });
      this.markDirty();
    });
  }

  // --- quit ---------------------------------------------------------------

  private requestQuit(kind: 'quit' | 'interrupt'): void {
    if (this.exiting) return;
    const top = topScreen(this.navigation);
    if (top.kind === 'quit-confirmation') {
      // A second Ctrl+C while confirming stops the same way a confirmation does.
      if (kind === 'interrupt') this.exit();
      return;
    }
    this.activeWorkCount = this.sources?.sessions.activeWorkCount() ?? 0;
    if (this.activeWorkCount === 0 || !this.interactive) {
      this.exit();
      return;
    }
    this.navigateTo({ kind: 'open', screen: { kind: 'quit-confirmation' } });
  }

  private exit(): void {
    if (this.exiting) return;
    this.exiting = true;
    this.startup = { kind: 'stopping' };
    // The menu shows shutdown progress while the server command stops Runs.
    this.navigateTo({ kind: 'open', screen: { kind: 'menu' } });
    // A startup pairing attempt cannot outlive the process.
    this.activeCeremony?.ceremony.cancel();
    this.resolveExit();
    this.markDirty();
  }

  // --- ceremonies -----------------------------------------------------------

  private beginCeremony(
    actionId: CeremonyState['actionId'],
    ceremony: MachineEnrollmentCeremony,
  ): void {
    this.endCeremony(true);
    const observation = ceremony.observe((step) => this.applyCeremonyStep(actionId, step));
    this.activeCeremony = { ceremony, unsubscribe: observation.unsubscribe };
    this.ceremonyState = { actionId, step: null, browserUrl: null };
    this.navigateTo({
      kind: 'open',
      screen: actionId === 'pair' ? { kind: 'pairing' } : { kind: 'add-controller' },
    });
    if (observation.step) this.applyCeremonyStep(actionId, observation.step);
    this.markDirty();
  }

  private applyCeremonyStep(
    actionId: CeremonyState['actionId'],
    step: MachineEnrollmentCeremonyStep,
  ): void {
    const previous = this.ceremonyState;
    const browserUrl =
      step.kind === 'browser-handoff'
        ? this.dependencies.pairingUrl(
            step.userCode,
            actionId === 'pair' ? 'pairing' : 'add-controller',
          )
        : (previous?.browserUrl ?? null);
    this.ceremonyState = { actionId, step, browserUrl };
    if (step.kind === 'finished') {
      this.endCeremony(false);
      const top = topScreen(this.navigation);
      const onScreen = top.kind === (actionId === 'pair' ? 'pairing' : 'add-controller');
      if (step.outcome === 'confirmed' && onScreen) {
        this.navigateTo({ kind: 'back' });
        this.navigateTo({ kind: 'notice', message: CONFIRMED_NOTICE[actionId] });
      }
    }
    this.markDirty();
  }

  private endCeremony(cancel: boolean): void {
    const active = this.activeCeremony;
    if (!active) return;
    this.activeCeremony = null;
    active.unsubscribe();
    if (cancel) active.ceremony.cancel();
  }

  // --- source updates -----------------------------------------------------

  private applySessionUpdate(update: LocalSessionUpdate): void {
    if (update.kind === 'removed') {
      const current = this.sessions.get(update.runId);
      if (current?.runInstanceId === update.runInstanceId) {
        this.reselectBeforeRemoval(update.runId);
        this.sessions.delete(update.runId);
      }
      this.navigateTo({
        kind: 'run-removed',
        run: { runId: update.runId, runInstanceId: update.runInstanceId },
      });
    } else {
      this.sessions.set(update.session.runId, update.session);
    }
    this.activeWorkCount = this.sources?.sessions.activeWorkCount() ?? 0;
    this.syncDisplayInterest();
    this.markDirty();
  }

  /**
   * Keeps the selection at the departed session's position among the remaining
   * sessions; when the last one leaves, nothing is selected rather than a
   * machine action.
   */
  private reselectBeforeRemoval(runId: string): void {
    const selection = this.selection;
    if (selection?.kind !== 'session' || selection.run.runId !== runId) return;
    const sessions = this.currentMenuItems().filter((item) => item.kind === 'session');
    const index = sessions.findIndex((item) => sameMenuItem(item, selection));
    const remaining = sessions.filter((item) => !sameMenuItem(item, selection));
    this.selection = remaining[Math.min(Math.max(0, index), remaining.length - 1)] ?? null;
  }

  private applyMetadataUpdate(update: LocalSessionMetadataUpdate): void {
    if (update.metadata === null) {
      const current = this.metadata.get(update.runId);
      if (current?.runInstanceId === update.runInstanceId) this.metadata.delete(update.runId);
    } else {
      this.metadata.set(update.runId, update.metadata);
    }
    this.markDirty();
  }

  private applyActivityUpdate(update: SessionActivityUpdate): void {
    const run = this.activityRun;
    if (update.runId !== run?.runId || update.runInstanceId !== run.runInstanceId) return;
    switch (update.kind) {
      case 'entry':
        this.activityEntries.set(update.entry.entryId, update.entry);
        break;
      case 'evicted':
        for (const entryId of update.entryIds) this.activityEntries.delete(entryId);
        this.activityGap = update.gap;
        break;
      case 'disposed':
        this.activityEntries.clear();
        break;
    }
    this.markDirty();
  }

  private applyDiagnosticUpdate(update: DiagnosticFeedUpdate): void {
    const records = this.diagnosticRecords;
    if (!records) return;
    if (update.kind === 'appended') {
      records.push(update.record);
    } else {
      const removed = new Set(update.sequences);
      this.diagnosticRecords = records.filter((record) => !removed.has(record.seq));
      this.diagnosticEvicted =
        update.metadata.losses.routine.evicted + update.metadata.losses.incident.evicted;
    }
    this.diagnosticMetadata = update.metadata;
    this.markDirty();
  }

  private async exportDiagnostics(): Promise<void> {
    if (this.diagnosticExportResult?.kind === 'choosing') return;
    const request = ++this.diagnosticExportRequest;
    // Captured before the dialog so entries appended while it is open are not exported.
    const snapshot = this.dependencies.diagnostics.snapshot();
    this.diagnosticExportResult = { kind: 'choosing' };
    this.markDirty();
    const current = (): boolean =>
      request === this.diagnosticExportRequest && this.diagnosticRecords !== null;
    try {
      const choice = await this.dependencies.chooseSaveFile(
        diagnosticExportFilename(new Date(this.now())),
      );
      if (!current()) return;
      if (choice.status === 'cancelled') {
        this.diagnosticExportResult = { kind: 'cancelled' };
      } else {
        const result = await writeDiagnosticExport(snapshot, choice.path);
        if (!current()) return;
        this.diagnosticExportResult = { kind: 'success', ...result };
      }
    } catch (error) {
      if (!current()) return;
      this.diagnosticExportResult = {
        kind: 'failure',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.markDirty();
  }

  // --- screen-scoped subscriptions -----------------------------------------

  /** Subscribes exactly the feeds the top screen shows; unsubscribing never touches a Run. */
  private syncScreenSubscriptions(): void {
    const top = topScreen(this.navigation);
    this.syncActivitySubscription(top);
    this.syncDiagnosticsSubscription(top);
    this.syncDisplayInterest();
  }

  private syncActivitySubscription(top: Screen): void {
    const wanted = top.kind === 'session' ? top.run : null;
    const current = this.activityRun;
    if (
      wanted?.runId === current?.runId &&
      wanted?.runInstanceId === current?.runInstanceId &&
      (wanted === null || this.unsubscribeActivity !== null || !this.sources)
    ) {
      return;
    }
    this.unsubscribeActivity?.();
    this.unsubscribeActivity = null;
    this.activityEntries = new Map();
    this.activityGap = { evictedCount: 0, throughSeq: null };
    this.activityRun = wanted;
    if (!wanted || !this.sources) return;
    const observation = this.sources.sessionActivity.observe((update) =>
      this.applyActivityUpdate(update),
    );
    this.unsubscribeActivity = observation.unsubscribe;
    const run = observation.snapshot.runs.find(
      (candidate) =>
        candidate.runId === wanted.runId && candidate.runInstanceId === wanted.runInstanceId,
    );
    if (run) {
      for (const entry of run.entries) this.activityEntries.set(entry.entryId, entry);
      this.activityGap = run.gap;
    }
  }

  private syncDiagnosticsSubscription(top: Screen): void {
    const wanted = top.kind === 'debug';
    if (wanted === (this.diagnosticRecords !== null)) return;
    this.unsubscribeDiagnostics?.();
    this.unsubscribeDiagnostics = null;
    this.diagnosticRecords = null;
    this.diagnosticExportRequest += 1;
    this.diagnosticExportResult = null;
    if (!wanted) return;
    this.diagnosticsScroll = { mode: 'live' };
    const observation = this.dependencies.diagnostics.observe((update) =>
      this.applyDiagnosticUpdate(update),
    );
    this.unsubscribeDiagnostics = observation.unsubscribe;
    this.diagnosticRecords = [...observation.snapshot.records];
    this.diagnosticEvicted = observation.snapshot.evictedCount;
    this.diagnosticMetadata = observation.snapshot;
    this.diagnosticDropped = observation.snapshot.droppedReentrantCount;
  }

  /** Titles load only for the sessions on screen. */
  private syncDisplayInterest(): void {
    if (!this.sources) return;
    const top = topScreen(this.navigation);
    const interest =
      top.kind === 'menu'
        ? [...this.sessions.keys()]
        : top.kind === 'session'
          ? [top.run.runId]
          : [];
    if (
      interest.length === this.displayInterest.length &&
      interest.every((runId, index) => this.displayInterest[index] === runId)
    ) {
      return;
    }
    this.displayInterest = interest;
    this.sources.sessionMetadata.setDisplayInterest(interest);
  }

  // --- scrolling ----------------------------------------------------------

  private scroll(direction: -1 | 1, amount: ScrollAmount): void {
    const top = topScreen(this.navigation);
    if (top.kind !== 'session' && top.kind !== 'debug') return;
    const latestSeq =
      top.kind === 'session'
        ? this.latestActivitySeq()
        : (this.diagnosticRecords?.at(-1)?.seq ?? null);
    if (latestSeq === null) return;
    const current = top.kind === 'session' ? this.activityScroll : this.diagnosticsScroll;
    const pinned: FeedScroll = {
      mode: 'paused',
      pinnedThroughSeq: current.mode === 'paused' ? current.pinnedThroughSeq : latestSeq,
      offset: current.mode === 'paused' ? current.offset : 0,
    };
    // Measure against the pinned content so the offset never runs past the top.
    const measured = { ...this.buildState(), activityScroll: pinned, diagnosticsScroll: pinned };
    const maxOffset =
      top.kind === 'session' ? activityMaxOffset(measured) : diagnosticsMaxOffset(measured);
    const page = Math.max(
      1,
      top.kind === 'session'
        ? activityFeedHeight(this.viewport.rows) - 1
        : diagnosticsFeedHeight(this.viewport.rows, diagnosticsResultHeight(measured)) - 1,
    );
    const step = amount === 'line' ? 1 : amount === 'page' ? page : maxOffset;
    const offset = Math.max(0, Math.min(maxOffset, pinned.offset - direction * step));
    // Reaching the bottom keeps the pin; only `f` returns to following live.
    this.setScroll({ ...pinned, offset });
  }

  private setScroll(scroll: FeedScroll): void {
    const top = topScreen(this.navigation);
    if (top.kind === 'session') this.activityScroll = scroll;
    if (top.kind === 'debug') this.diagnosticsScroll = scroll;
  }

  private latestActivitySeq(): number | null {
    let latest: number | null = null;
    for (const entry of this.activityEntries.values()) {
      if (latest === null || entry.seq > latest) latest = entry.seq;
    }
    return latest;
  }

  // --- publication -----------------------------------------------------------

  private markDirty(): void {
    if (this.disposed || this.frameTimer) return;
    const wait = Math.max(0, this.lastPublishedAt + this.frameIntervalMs - this.now());
    this.frameTimer = setTimeout(() => {
      this.frameTimer = null;
      this.publish();
    }, wait);
  }

  private publish(): void {
    if (this.disposed) return;
    this.lastPublishedAt = this.now();
    this.published = this.buildState();
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch (error) {
        this.dependencies.report('presentation.listener_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private buildState(): PresentationState {
    const activityRun = this.activityRun;
    return Object.freeze({
      navigation: this.navigation,
      startup: this.startup,
      sessions: Object.freeze([...this.sessions.values()]),
      metadata: new Map(this.metadata),
      machine: this.machine,
      sharedBrowser: this.sharedBrowser,
      options: this.options,
      optionsRow: this.optionsRow,
      selection: this.selection,
      activity: activityRun
        ? Object.freeze({
            run: activityRun,
            entries: Object.freeze(
              [...this.activityEntries.values()].sort((a, b) => a.seq - b.seq),
            ),
            gap: this.activityGap,
          })
        : null,
      activityScroll: this.activityScroll,
      diagnostics:
        this.diagnosticRecords && this.diagnosticMetadata
          ? Object.freeze({
              ...this.diagnosticMetadata,
              records: Object.freeze([...this.diagnosticRecords]),
              evictedCount: this.diagnosticEvicted,
              droppedReentrantCount: this.diagnosticDropped,
              exportResult: this.diagnosticExportResult,
            })
          : null,
      diagnosticsScroll: this.diagnosticsScroll,
      ceremony: this.ceremonyState,
      activeWorkCount: this.activeWorkCount,
      viewport: this.viewport,
      nowMs: this.now(),
      webOrigin: this.dependencies.webOrigin,
      target: this.dependencies.target,
      color: this.dependencies.color,
    });
  }
}

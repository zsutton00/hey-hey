import { vi } from 'vitest';
import {
  MachineEnrollmentCancelledError,
  MachineEnrollmentCeremony,
  type MachineEnrollmentOutcome,
} from '../auth/machine-enrollment-ceremony';
import type {
  MachineActionId,
  MachineActionStart,
  MachineStatusObserver,
  MachineStatusSnapshot,
} from '../commands/machine-actions';
import { DiagnosticFeed } from '../server/diagnostic-feed';
import type {
  LocalSessionMetadata,
  LocalSessionMetadataObserver,
} from '../server/local-session-metadata-source';
import type {
  LocalSessionObserver,
  LocalSessionSnapshot,
} from '../server/local-session-read-source';
import type {
  SessionActivityEntry,
  SessionActivityObserver,
  SessionNarrationEntry,
  SessionToolEntry,
} from '../server/session-activity-source';
import type { OptionsObserver } from './options-source';
import type { ProjectBrowserChange } from '../browser/project-browser-manager';
import type {
  SharedBrowserManager,
  SharedBrowserObserver,
  SharedBrowserProject,
} from './browser-source';
import { PresentationOwner, type PresentationOwnerDependencies } from './presentation-owner';
import type { PresentationState } from './presentation-state';
import { initialNavigation } from './navigation';

export const NOW = Date.parse('2026-10-04T12:00:00.000Z');

export const session = (overrides: Partial<LocalSessionSnapshot> = {}): LocalSessionSnapshot => ({
  runId: 'run-1',
  runInstanceId: 1,
  agentSessionId: 'agent-session-1',
  conversationId: 'conversation-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  provider: 'codex',
  providerSessionId: null,
  providerConversationId: null,
  entity: null,
  effectiveState: { state: 'THINKING', observedAt: new Date(NOW - 134_000).toISOString() },
  hasActiveWork: true,
  createdAt: new Date(NOW - 600_000).toISOString(),
  activeSince: new Date(NOW - 300_000).toISOString(),
  loadedEntityContext: null,
  entityContextLoadStatus: null,
  ...overrides,
});

export const metadata = (overrides: Partial<LocalSessionMetadata> = {}): LocalSessionMetadata => ({
  runId: 'run-1',
  runInstanceId: 1,
  conversationId: 'conversation-1',
  title: { status: 'available', value: 'Investigate a failing build', fetchedAt: '' },
  focalContext: { status: 'unavailable', reason: 'no_focal_entity' },
  ...overrides,
});

const entryBase = {
  lane: { subagentTurnId: null, providerThreadId: null, parentToolUseId: null },
  turnId: 'turn-1',
  providerTurnId: null,
  createdAt: new Date(NOW - 10_000).toISOString(),
  updatedAt: new Date(NOW - 10_000).toISOString(),
};

export const narration = (seq: number, text: string): SessionNarrationEntry => ({
  ...entryBase,
  kind: 'narration',
  entryId: `narration-${String(seq)}`,
  seq,
  text: { text, truncatedBytes: 0 },
  open: false,
});

export const tool = (seq: number, overrides: Partial<SessionToolEntry> = {}): SessionToolEntry => ({
  ...entryBase,
  kind: 'tool',
  entryId: `tool-${String(seq)}`,
  seq,
  toolUseId: `use-${String(seq)}`,
  toolName: 'Shell',
  input: { text: 'pnpm test', truncatedBytes: 0 },
  status: 'running',
  output: { text: '', truncatedBytes: 0 },
  result: null,
  exitCode: null,
  ...overrides,
});

export const machineStatus = (
  overrides: Partial<MachineStatusSnapshot> = {},
): MachineStatusSnapshot => ({
  revision: 1,
  account: 'signed-in',
  connection: 'connected',
  readiness: 'ready',
  actions: (['pair', 'add-controller', 'log-out'] as const).map((id) => ({
    id,
    label: id,
    availability: { available: true as const },
  })),
  ...overrides,
});

/** Controllable stand-ins for the running server's presentation sources. */
export class FakeSources {
  public sessionList: LocalSessionSnapshot[] = [];
  public metadataList: LocalSessionMetadata[] = [];
  public activityByRun = new Map<string, SessionActivityEntry[]>();
  public machine = machineStatus();
  public activeWork = 0;
  public readonly sessionObservers = new Set<LocalSessionObserver>();
  public readonly metadataObservers = new Set<LocalSessionMetadataObserver>();
  public readonly activityObservers = new Set<SessionActivityObserver>();
  public readonly machineObservers = new Set<MachineStatusObserver>();
  public readonly setDisplayInterest = vi.fn<(runIds: Iterable<string>) => void>();
  public readonly startAction = vi.fn<(id: MachineActionId) => MachineActionStart>();
  public browserEnabled = true;
  public browserProjects: SharedBrowserProject[] = [];
  public readonly browserObservers = new Set<SharedBrowserObserver>();
  public readonly closeBrowser = vi.fn<(projectId: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  public readonly setBrowserEnabled = vi.fn<(enabled: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
  public intentFirst: boolean | null = false;
  public remoteToolCallViewing: boolean | null = true;
  public jevEnabled: boolean | null = true;
  public jevKeyDefined = true;
  public readonly optionsObservers = new Set<OptionsObserver>();
  public readonly setIntentFirst = vi.fn<(intentFirst: boolean) => Promise<void>>((intentFirst) => {
    this.setOptions(intentFirst, this.remoteToolCallViewing, this.jevEnabled);
    return Promise.resolve();
  });
  public readonly setRemoteToolCallViewing = vi.fn<(enabled: boolean) => Promise<void>>(
    (enabled) => {
      this.setOptions(this.intentFirst, enabled, this.jevEnabled);
      return Promise.resolve();
    },
  );
  public readonly setJevEnabled = vi.fn<(enabled: boolean) => Promise<void>>((enabled) => {
    this.setOptions(this.intentFirst, this.remoteToolCallViewing, enabled);
    return Promise.resolve();
  });
  private revision = 0;

  public readonly sources = {
    sessions: {
      observe: (observer: LocalSessionObserver) => {
        this.sessionObservers.add(observer);
        return {
          snapshot: { revision: this.revision, sessions: [...this.sessionList] },
          unsubscribe: () => this.sessionObservers.delete(observer),
        };
      },
      activeWorkCount: () => this.activeWork,
    },
    sessionMetadata: {
      observe: (observer: LocalSessionMetadataObserver) => {
        this.metadataObservers.add(observer);
        return {
          snapshot: { revision: this.revision, sessions: [...this.metadataList] },
          unsubscribe: () => this.metadataObservers.delete(observer),
        };
      },
      setDisplayInterest: (runIds: Iterable<string>) => this.setDisplayInterest([...runIds]),
    },
    sessionActivity: {
      observe: (observer: SessionActivityObserver) => {
        this.activityObservers.add(observer);
        return {
          snapshot: {
            revision: this.revision,
            runs: this.sessionList.map((listed) => ({
              runId: listed.runId,
              runInstanceId: listed.runInstanceId,
              entries: this.activityByRun.get(listed.runId) ?? [],
              gap: { evictedCount: 0, throughSeq: null },
            })),
          },
          unsubscribe: () => this.activityObservers.delete(observer),
        };
      },
    },
    machineActions: {
      observe: (observer: MachineStatusObserver) => {
        this.machineObservers.add(observer);
        return {
          snapshot: this.machine,
          unsubscribe: () => this.machineObservers.delete(observer),
        };
      },
      start: (id: MachineActionId) => this.startAction(id),
    },
    /** Read by the interactive launch when it builds the Shared Browser source. */
    readProjectName: () => Promise.resolve<string | null>(null),
    sharedBrowser: {
      observe: (observer: SharedBrowserObserver) => {
        this.browserObservers.add(observer);
        return {
          snapshot: { enabled: this.browserEnabled, projects: [...this.browserProjects] },
          unsubscribe: () => this.browserObservers.delete(observer),
        };
      },
      close: (projectId: string) => this.closeBrowser(projectId),
      setEnabled: (enabled: boolean) => this.setBrowserEnabled(enabled),
    },
    options: {
      observe: (observer: OptionsObserver) => {
        this.optionsObservers.add(observer);
        return {
          snapshot: {
            intentFirst: this.intentFirst,
            remoteToolCallViewing: this.remoteToolCallViewing,
            jevEnabled: this.jevEnabled,
            jevKeyDefined: this.jevKeyDefined,
          },
          unsubscribe: () => this.optionsObservers.delete(observer),
        };
      },
      setIntentFirst: (intentFirst: boolean) => this.setIntentFirst(intentFirst),
      setRemoteToolCallViewing: (enabled: boolean) => this.setRemoteToolCallViewing(enabled),
      setJevEnabled: (enabled: boolean) => this.setJevEnabled(enabled),
    },
  };

  public setOptions(
    intentFirst: boolean | null,
    remoteToolCallViewing: boolean | null = true,
    jevEnabled: boolean | null = true,
    jevKeyDefined = this.jevKeyDefined,
  ): void {
    this.jevKeyDefined = jevKeyDefined;
    this.intentFirst = intentFirst;
    this.remoteToolCallViewing = remoteToolCallViewing;
    this.jevEnabled = jevEnabled;
    for (const observer of this.optionsObservers) {
      observer({ intentFirst, remoteToolCallViewing, jevEnabled, jevKeyDefined });
    }
  }

  public setSharedBrowser(enabled: boolean, projects: SharedBrowserProject[]): void {
    this.browserEnabled = enabled;
    this.browserProjects = projects;
    for (const observer of this.browserObservers) observer({ enabled, projects: [...projects] });
  }

  public register(listed: LocalSessionSnapshot): void {
    this.sessionList.push(listed);
    for (const observer of this.sessionObservers) {
      observer({ revision: ++this.revision, kind: 'registered', session: listed });
    }
  }

  public update(listed: LocalSessionSnapshot): void {
    this.sessionList = this.sessionList.map((existing) =>
      existing.runId === listed.runId ? listed : existing,
    );
    for (const observer of this.sessionObservers) {
      observer({ revision: ++this.revision, kind: 'updated', session: listed });
    }
  }

  public remove(runId: string, runInstanceId = 1): void {
    this.sessionList = this.sessionList.filter((existing) => existing.runId !== runId);
    for (const observer of this.sessionObservers) {
      observer({ revision: ++this.revision, kind: 'removed', runId, runInstanceId });
    }
  }

  public setMetadata(entry: LocalSessionMetadata): void {
    for (const observer of this.metadataObservers) {
      observer({
        revision: ++this.revision,
        runId: entry.runId,
        runInstanceId: entry.runInstanceId,
        metadata: entry,
      });
    }
  }

  public emitActivity(runId: string, entry: SessionActivityEntry, runInstanceId = 1): void {
    for (const observer of this.activityObservers) {
      observer({ revision: ++this.revision, kind: 'entry', runId, runInstanceId, entry });
    }
  }

  public setMachine(snapshot: MachineStatusSnapshot): void {
    this.machine = snapshot;
    for (const observer of this.machineObservers) observer(snapshot);
  }
}

/**
 * The shared browser manager stand-in: launches and closes are driven by the
 * test; close and setEnabled behave like the real manager's notifications.
 */
export class ControlledBrowserManager implements SharedBrowserManager {
  public enabled = true;
  public readonly running = new Set<string>();
  public readonly close = vi.fn((projectId: string) => {
    if (this.running.delete(projectId)) this.emit({ type: 'status', projectId, status: 'stopped' });
    return Promise.resolve();
  });
  public readonly setEnabled = vi.fn(async (enabled: boolean) => {
    this.enabled = enabled;
    if (!enabled) await Promise.all([...this.running].map((projectId) => this.close(projectId)));
    this.emit({ type: 'enabled', enabled });
  });
  private readonly listeners = new Set<(change: ProjectBrowserChange) => void>();

  public onChange(listener: (change: ProjectBrowserChange) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public isEnabled(): Promise<boolean> {
    return Promise.resolve(this.enabled);
  }

  /** An agent's browser call launched this project's browser. */
  public launch(projectId: string): void {
    this.running.add(projectId);
    this.emit({ type: 'status', projectId, status: 'running' });
  }

  private emit(change: ProjectBrowserChange): void {
    for (const listener of [...this.listeners]) listener(change);
  }
}

/** A ceremony operation the fake machine actions hand out, driven by the test. */
export const startedCeremony = (
  actionId: 'pair' | 'add-controller',
): {
  start: MachineActionStart;
  ceremony: MachineEnrollmentCeremony;
  finish: (outcome: MachineEnrollmentOutcome) => void;
} => {
  const ceremony = new MachineEnrollmentCeremony();
  let finish!: (outcome: MachineEnrollmentOutcome) => void;
  const completion = ceremony
    .run(
      (ports) =>
        new Promise<{ outcome: MachineEnrollmentOutcome }>((resolve, reject) => {
          finish = (outcome) => resolve({ outcome });
          ports.signal.addEventListener('abort', () =>
            reject(new MachineEnrollmentCancelledError()),
          );
        }),
      () => ({ outcome: 'failed' as const }),
    )
    .then((settled) => settled.outcome);
  return {
    start: { started: true, operation: { kind: 'ceremony', actionId, ceremony, completion } },
    ceremony,
    finish: (outcome) => finish(outcome),
  };
};

export const createOwner = (
  overrides: Partial<PresentationOwnerDependencies> = {},
): {
  owner: PresentationOwner;
  feed: DiagnosticFeed;
  report: ReturnType<typeof vi.fn>;
  openUrl: ReturnType<typeof vi.fn>;
} => {
  const feed = new DiagnosticFeed();
  const report = vi.fn();
  const openUrl = vi.fn(() => Promise.resolve());
  const owner = new PresentationOwner({
    diagnostics: feed,
    webOrigin: 'https://heyhey.dev',
    target: { profile: null, environment: null },
    pairingUrl: (code, route) => `https://heyhey.dev/${route}?code=${code}`,
    openUrl,
    chooseSaveFile: () => Promise.resolve({ status: 'cancelled' }),
    report,
    color: false,
    viewport: { columns: 100, rows: 30 },
    frameIntervalMs: 50,
    now: () => Date.now(),
    ...overrides,
  });
  return { owner, feed, report, openUrl };
};

/** Advances fake timers past one frame so the latest state is published. */
export const flushFrame = (): void => {
  vi.advanceTimersByTime(60);
};

/** A complete state for view-model tests. */
export const state = (overrides: Partial<PresentationState> = {}): PresentationState => ({
  navigation: initialNavigation(),
  startup: { kind: 'running' },
  sessions: [],
  metadata: new Map(),
  machine: machineStatus(),
  sharedBrowser: null,
  options: null,
  optionsRow: 'intent-first',
  selection: null,
  activity: null,
  activityScroll: { mode: 'live' },
  diagnostics: null,
  diagnosticsScroll: { mode: 'live' },
  ceremony: null,
  activeWorkCount: 0,
  viewport: { columns: 100, rows: 30 },
  nowMs: NOW,
  webOrigin: 'https://heyhey.dev',
  target: { profile: null, environment: null },
  color: false,
  ...overrides,
});

/**
 * Presents the shared browser manager as a snapshot/update source for the
 * menu. Every behavior (launch, close, the persisted on/off setting and closing
 * browsers when it is turned off) stays with the manager; this only remembers
 * which projects it has seen change this process, because the manager keeps
 * no list of them.
 */

import type {
  ProjectBrowser,
  ProjectBrowserChange,
  ProjectBrowserStatus,
} from '../browser/project-browser-manager';

export interface SharedBrowserProject {
  readonly projectId: string;
  /** Null while loading or when the project's name cannot be read. */
  readonly name: string | null;
  readonly status: ProjectBrowserStatus;
}

export interface SharedBrowserSnapshot {
  /** Null until the persisted setting has been read. */
  readonly enabled: boolean | null;
  /** Projects whose browser launched at least once this process, in first-seen order. */
  readonly projects: readonly SharedBrowserProject[];
}

export type SharedBrowserObserver = (snapshot: SharedBrowserSnapshot) => void;

export type SharedBrowserManager = Pick<
  ProjectBrowser,
  'onChange' | 'isEnabled' | 'setEnabled' | 'close'
>;

export class SharedBrowserSource {
  private readonly observers = new Set<SharedBrowserObserver>();
  private readonly statuses = new Map<string, ProjectBrowserStatus>();
  private readonly names = new Map<string, string>();
  private enabled: boolean | null = null;
  private unsubscribeManager: (() => void) | null = null;

  public constructor(
    private readonly manager: SharedBrowserManager,
    private readonly readProjectName: (projectId: string) => Promise<string | null>,
    private readonly report: (event: string, details: Record<string, unknown>) => void,
  ) {}

  public observe(observer: SharedBrowserObserver): {
    snapshot: SharedBrowserSnapshot;
    unsubscribe: () => void;
  } {
    this.observers.add(observer);
    if (!this.unsubscribeManager) this.start();
    return {
      snapshot: this.snapshot(),
      unsubscribe: () => {
        this.observers.delete(observer);
        if (this.observers.size > 0) return;
        this.unsubscribeManager?.();
        this.unsubscribeManager = null;
      },
    };
  }

  public close(projectId: string): Promise<void> {
    return this.manager.close(projectId);
  }

  public setEnabled(enabled: boolean): Promise<void> {
    return this.manager.setEnabled(enabled);
  }

  private start(): void {
    this.unsubscribeManager = this.manager.onChange((change) => this.apply(change));
    void this.manager.isEnabled().then(
      (enabled) => {
        // A change event that arrived while reading is newer than the read.
        if (this.enabled !== null) return;
        this.enabled = enabled;
        this.publish();
      },
      (error: unknown) => {
        this.report('presentation.shared_browser_setting_read_failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  private apply(change: ProjectBrowserChange): void {
    if (change.type === 'enabled') this.enabled = change.enabled;
    else {
      if (!this.statuses.has(change.projectId)) this.loadName(change.projectId);
      this.statuses.set(change.projectId, change.status);
    }
    this.publish();
  }

  private loadName(projectId: string): void {
    void this.readProjectName(projectId).then(
      (name) => {
        if (name === null) return;
        this.names.set(projectId, name);
        this.publish();
      },
      (error: unknown) => {
        this.report('presentation.shared_browser_project_name_failed', {
          projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    );
  }

  private snapshot(): SharedBrowserSnapshot {
    return Object.freeze({
      enabled: this.enabled,
      projects: Object.freeze(
        [...this.statuses].map(([projectId, status]) =>
          Object.freeze({ projectId, name: this.names.get(projectId) ?? null, status }),
        ),
      ),
    });
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const observer of [...this.observers]) observer(snapshot);
  }
}

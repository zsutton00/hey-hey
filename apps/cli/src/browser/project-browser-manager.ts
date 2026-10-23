import path from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { resolveBaseDir } from '../session/paths';
import type { ServerLogger } from '../server/logger';
import {
  InstalledChromeLauncher,
  type ChromeLauncher,
  type LaunchedChrome,
} from './chrome-launcher';
import { SharedBrowserSettingsStore } from './shared-browser-settings';

export class SharedBrowserDisabledError extends Error {
  public readonly code = 'SHARED_BROWSER_DISABLED' as const;

  public constructor() {
    super('The shared browser is turned off on this machine.');
    this.name = 'SharedBrowserDisabledError';
  }
}

export type ProjectBrowserStatus = 'stopped' | 'running';

export type ProjectBrowserChange =
  | { type: 'status'; projectId: string; status: ProjectBrowserStatus }
  | { type: 'enabled'; enabled: boolean };

export interface ProjectBrowser {
  getBrowser(projectId: string): Promise<Browser>;
  close(projectId: string): Promise<void>;
  status(projectId: string): ProjectBrowserStatus;
  closeAll(): Promise<void>;
  isEnabled(): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  onChange(listener: (change: ProjectBrowserChange) => void): () => void;
}

export interface ProjectBrowserManagerDependencies {
  logger: ServerLogger;
  settings?: Pick<SharedBrowserSettingsStore, 'read' | 'write'>;
  launcher?: ChromeLauncher;
  connect?: (wsEndpoint: string) => Promise<Browser>;
  profileRoot?: string;
}

interface ProjectBrowserEntry {
  launch: Promise<Browser>;
  chrome: LaunchedChrome | null;
  browser: Browser | null;
}

/**
 * Owns one visible Chrome per project for the life of the CLI process. Held in
 * memory only: nothing survives a CLI restart.
 */
export class ProjectBrowserManager implements ProjectBrowser {
  private readonly entries = new Map<string, ProjectBrowserEntry>();
  private readonly listeners = new Set<(change: ProjectBrowserChange) => void>();
  private readonly settings: Pick<SharedBrowserSettingsStore, 'read' | 'write'>;
  private readonly launcher: ChromeLauncher;
  private readonly connect: (wsEndpoint: string) => Promise<Browser>;
  private readonly profileRoot: string;

  public constructor(private readonly dependencies: ProjectBrowserManagerDependencies) {
    this.settings = dependencies.settings ?? new SharedBrowserSettingsStore();
    this.launcher =
      dependencies.launcher ??
      new InstalledChromeLauncher({
        logger: dependencies.logger.child({ component: 'chrome-launcher' }),
      });
    this.connect = dependencies.connect ?? ((wsEndpoint) => chromium.connectOverCDP(wsEndpoint));
    this.profileRoot = dependencies.profileRoot ?? path.join(resolveBaseDir(), 'browser');
  }

  public async getBrowser(projectId: string): Promise<Browser> {
    const existing = this.entries.get(projectId);
    if (existing) return existing.launch;

    // Memoizing the in-flight launch gives concurrent callers the same browser.
    const entry = { chrome: null, browser: null } as ProjectBrowserEntry;
    entry.launch = this.launch(projectId, entry);
    this.entries.set(projectId, entry);
    entry.launch.catch(() => {
      if (this.entries.get(projectId) === entry) this.entries.delete(projectId);
    });
    return entry.launch;
  }

  public status(projectId: string): ProjectBrowserStatus {
    return this.entries.get(projectId)?.browser ? 'running' : 'stopped';
  }

  public async close(projectId: string): Promise<void> {
    const entry = this.entries.get(projectId);
    if (!entry) return;
    this.entries.delete(projectId);
    await entry.launch.catch(() => undefined);
    await this.shutDown(projectId, entry);
  }

  public async closeAll(): Promise<void> {
    await Promise.all([...this.entries.keys()].map((projectId) => this.close(projectId)));
  }

  public async isEnabled(): Promise<boolean> {
    return (await this.settings.read()).enabled;
  }

  public async setEnabled(enabled: boolean): Promise<void> {
    await this.settings.write({ enabled });
    this.dependencies.logger.info('shared_browser.setting.changed', { enabled });
    if (!enabled) await this.closeAll();
    this.emit({ type: 'enabled', enabled });
  }

  public onChange(listener: (change: ProjectBrowserChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async launch(projectId: string, entry: ProjectBrowserEntry): Promise<Browser> {
    // Read inside the memoized launch so a concurrent close or setEnabled(false)
    // sees the entry; turning the setting off closes every entry, so a live
    // entry always implies the setting was on.
    if (!(await this.isEnabled())) throw new SharedBrowserDisabledError();
    const userDataDir = path.join(this.profileRoot, projectId);
    this.dependencies.logger.info('shared_browser.launch.started', { projectId });
    let chrome: LaunchedChrome;
    try {
      chrome = await this.launcher.launch(userDataDir);
    } catch (error) {
      this.dependencies.logger.error('shared_browser.launch.failed', {
        projectId,
        userDataDir,
        errorName: error instanceof Error ? error.name : 'NonError',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    entry.chrome = chrome;
    let browser: Browser;
    try {
      browser = await this.connect(chrome.wsEndpoint);
    } catch (error) {
      this.dependencies.logger.error('shared_browser.connect.failed', {
        projectId,
        wsEndpoint: chrome.wsEndpoint,
        message: error instanceof Error ? error.message : String(error),
      });
      await chrome.kill();
      throw error;
    }
    entry.browser = browser;
    // The user closing the window (or Chrome exiting) ends this entry so the
    // next request relaunches with the same profile.
    browser.on('disconnected', () => {
      if (this.entries.get(projectId) !== entry) return;
      this.entries.delete(projectId);
      void this.shutDown(projectId, entry);
    });
    this.dependencies.logger.info('shared_browser.launch.completed', { projectId });
    this.emit({ type: 'status', projectId, status: 'running' });
    return browser;
  }

  private async shutDown(projectId: string, entry: ProjectBrowserEntry): Promise<void> {
    const wasRunning = entry.browser !== null;
    await entry.browser?.close().catch(() => undefined);
    await entry.chrome?.kill();
    entry.browser = null;
    entry.chrome = null;
    if (!wasRunning) return;
    this.dependencies.logger.info('shared_browser.closed', { projectId });
    this.emit({ type: 'status', projectId, status: 'stopped' });
  }

  private emit(change: ProjectBrowserChange): void {
    for (const listener of this.listeners) listener(change);
  }
}

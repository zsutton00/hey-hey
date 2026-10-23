import { randomBytes } from 'node:crypto';
import type { ProjectBrowser } from '../../browser/project-browser-manager';
import type { RunRegistry } from '../../run/run-registry';
import type { RunLifecycleEvents } from '../../server/run-lifecycle-events';
import type { RunTabs } from '../../browser/run-tabs';
import type { ServerLogger } from '../../server/logger';

export interface BrowserMcpMount {
  token: string;
  runId: string;
  turnId: string;
  projectId: string;
}
export class BrowserMcpAccess {
  private readonly mounts = new Map<string, BrowserMcpMount>();
  private readonly tokens = new Map<string, BrowserMcpMount>();
  private registry: RunRegistry | null = null;
  private readonly unsubscribe: () => void;
  private readonly unsubscribeBrowser: () => void;
  public constructor(
    private readonly browsers: ProjectBrowser,
    lifecycle: RunLifecycleEvents,
    private readonly tabs: RunTabs,
    private readonly logger: ServerLogger,
  ) {
    this.unsubscribe = lifecycle.onRunRemoved((runId, cause) => {
      this.revoke(runId);
      this.logger.debug('browser.access.revoked', { runId, cause });
      if (cause === 'permanent') void this.tabs.remove(runId);
    });
    this.unsubscribeBrowser = browsers.onChange((change) => {
      if (change.type === 'enabled' && !change.enabled) {
        this.mounts.clear();
        this.tokens.clear();
        this.logger.debug('browser.access.disabled');
      }
    });
  }
  public bindRegistry(registry: RunRegistry): void {
    this.registry = registry;
  }
  public async mount(
    runId: string,
    projectId: string,
    turnId: string,
  ): Promise<BrowserMcpMount | undefined> {
    this.revoke(runId);
    try {
      if (!(await this.browsers.isEnabled())) return undefined;
    } catch {
      this.logger.warn('browser.access.settings_unavailable', { runId });
      return undefined;
    }
    const mount = { runId, projectId, turnId, token: randomBytes(32).toString('hex') };
    this.mounts.set(runId, mount);
    this.tokens.set(mount.token, mount);
    this.logger.debug('browser.access.mounted', { runId, turnId });
    return mount;
  }
  public resolve(token: string): BrowserMcpMount | null {
    const mount = this.tokens.get(token);
    return mount && this.admitted(mount) ? mount : null;
  }
  public admitted(mount: BrowserMcpMount): boolean {
    const run = this.registry?.get(mount.runId);
    return (
      this.mounts.get(mount.runId) === mount &&
      run?.projectId === mount.projectId &&
      run.activeTurn?.turnId === mount.turnId &&
      run.activeTurn.platformMcpProxy?.active === true
    );
  }
  public async enabled(): Promise<boolean> {
    return this.browsers.isEnabled();
  }
  private revoke(runId: string): void {
    const mount = this.mounts.get(runId);
    if (mount) this.tokens.delete(mount.token);
    this.mounts.delete(runId);
  }
  public async dispose(): Promise<void> {
    this.unsubscribe();
    this.unsubscribeBrowser();
    this.mounts.clear();
    this.tokens.clear();
    await this.tabs.dispose();
  }
}

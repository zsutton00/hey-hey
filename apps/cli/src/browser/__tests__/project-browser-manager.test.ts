import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Browser } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StructuredServerLogger } from '../../server/logger';
import type { ChromeLauncher } from '../chrome-launcher';
import {
  ProjectBrowserManager,
  SharedBrowserDisabledError,
  type ProjectBrowserChange,
} from '../project-browser-manager';
import { SharedBrowserSettingsStore } from '../shared-browser-settings';

class FakeBrowser extends EventEmitter {
  public closed = false;
  public close = vi.fn(() => {
    this.closed = true;
    this.emit('disconnected');
    return Promise.resolve();
  });
}

const createHarness = async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'project-browser-'));
  const settings = new SharedBrowserSettingsStore({ filePath: path.join(dir, 'settings.json') });
  const launchedDirs: string[] = [];
  const kills: string[] = [];
  const browsers: FakeBrowser[] = [];
  const launch = vi.fn(async (userDataDir: string) => {
    launchedDirs.push(userDataDir);
    await new Promise((resolve) => setTimeout(resolve, 5));
    return {
      wsEndpoint: `ws://127.0.0.1:1/${String(launchedDirs.length)}`,
      kill: () => {
        kills.push(userDataDir);
        return Promise.resolve();
      },
    };
  });
  const launcher: ChromeLauncher = { launch };
  const manager = new ProjectBrowserManager({
    logger: new StructuredServerLogger({ writeLine: () => undefined }),
    settings,
    launcher,
    profileRoot: path.join(dir, 'browser'),
    connect: () => {
      const browser = new FakeBrowser();
      browsers.push(browser);
      return Promise.resolve(browser as unknown as Browser);
    },
  });
  const browserAt = (index: number): FakeBrowser => {
    const browser = browsers[index];
    if (!browser) throw new Error(`no browser at ${String(index)}`);
    return browser;
  };
  return { dir, settings, launch, launchedDirs, kills, browsers, browserAt, manager };
};

describe('ProjectBrowserManager', () => {
  let harness: Awaited<ReturnType<typeof createHarness>>;

  beforeEach(async () => {
    harness = await createHarness();
  });

  afterEach(async () => {
    await fs.rm(harness.dir, { recursive: true, force: true });
  });

  it('reuses one browser per project and launches only once for concurrent requests', async () => {
    const [first, second] = await Promise.all([
      harness.manager.getBrowser('p1'),
      harness.manager.getBrowser('p1'),
    ]);
    const third = await harness.manager.getBrowser('p1');

    expect(first).toBe(second);
    expect(third).toBe(first);
    expect(harness.launch).toHaveBeenCalledTimes(1);
    expect(harness.manager.status('p1')).toBe('running');
    expect(harness.manager.status('p2')).toBe('stopped');
  });

  it('relaunches with the same profile after the window is closed', async () => {
    await harness.manager.getBrowser('p1');
    harness.browserAt(0).emit('disconnected');
    await vi.waitFor(() => expect(harness.manager.status('p1')).toBe('stopped'));

    const relaunched = await harness.manager.getBrowser('p1');

    expect(relaunched).toBe(harness.browsers[1]);
    expect(harness.launchedDirs).toEqual([
      path.join(harness.dir, 'browser', 'p1'),
      path.join(harness.dir, 'browser', 'p1'),
    ]);
  });

  it('refuses to launch when disabled, and turning it off closes and persists', async () => {
    await harness.manager.getBrowser('p1');
    await harness.manager.setEnabled(false);

    expect(harness.browserAt(0).closed).toBe(true);
    expect(harness.manager.status('p1')).toBe('stopped');
    expect(await harness.settings.read()).toEqual({ enabled: false });
    await expect(harness.manager.getBrowser('p1')).rejects.toBeInstanceOf(
      SharedBrowserDisabledError,
    );
    expect(harness.launch).toHaveBeenCalledTimes(1);
  });

  it('closeAll closes every launched browser', async () => {
    await Promise.all([harness.manager.getBrowser('p1'), harness.manager.getBrowser('p2')]);
    await harness.manager.closeAll();

    expect(harness.browsers.every((browser) => browser.closed)).toBe(true);
    expect(harness.kills).toHaveLength(2);
    expect(harness.manager.status('p1')).toBe('stopped');
    expect(harness.manager.status('p2')).toBe('stopped');
  });

  it('closes a browser whose launch was still in flight', async () => {
    const pending = harness.manager.getBrowser('p1');
    await harness.manager.close('p1');
    await pending;

    expect(harness.browserAt(0).closed).toBe(true);
    expect(harness.manager.status('p1')).toBe('stopped');
  });

  it('notifies listeners of launch, close and setting changes', async () => {
    const changes: ProjectBrowserChange[] = [];
    harness.manager.onChange((change) => changes.push(change));

    await harness.manager.getBrowser('p1');
    await harness.manager.close('p1');
    await harness.manager.setEnabled(false);

    expect(changes).toEqual([
      { type: 'status', projectId: 'p1', status: 'running' },
      { type: 'status', projectId: 'p1', status: 'stopped' },
      { type: 'enabled', enabled: false },
    ]);
  });

  it('allows a retry after a failed launch', async () => {
    harness.launch.mockRejectedValueOnce(new Error('boom'));
    await expect(harness.manager.getBrowser('p1')).rejects.toThrow('boom');

    await expect(harness.manager.getBrowser('p1')).resolves.toBeDefined();
    expect(harness.launch).toHaveBeenCalledTimes(2);
  });
});

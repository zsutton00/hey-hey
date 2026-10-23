import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SharedBrowserSettingsStore } from '../shared-browser-settings';

describe('SharedBrowserSettingsStore', () => {
  let dir: string;
  let filePath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-browser-settings-'));
    filePath = path.join(dir, 'nested', 'shared-browser-settings.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('defaults to enabled when nothing is stored', async () => {
    await expect(new SharedBrowserSettingsStore({ filePath }).read()).resolves.toEqual({
      enabled: true,
    });
  });

  it('persists the setting across store instances', async () => {
    await new SharedBrowserSettingsStore({ filePath }).write({ enabled: false });

    await expect(new SharedBrowserSettingsStore({ filePath }).read()).resolves.toEqual({
      enabled: false,
    });
  });

  it('rejects a malformed settings file', async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ version: 1, enabled: 'yes' }));

    await expect(new SharedBrowserSettingsStore({ filePath }).read()).rejects.toThrow();
  });
});

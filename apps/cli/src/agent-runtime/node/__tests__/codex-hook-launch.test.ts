import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { executionHookCommand } from '../../../agents/providers/execution-recorder/hook-command';
import {
  codexHookOverrides,
  confirmCodexHookLaunch,
  manualCodexHookConfig,
} from '../codex-hook-launch';

const codexInstalled = ((): boolean => {
  try {
    execFileSync('codex', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const directories: string[] = [];
const originalHome = process.env['CODEX_HOME'];
const originalPath = process.env['PATH'];

afterEach(() => {
  process.env['CODEX_HOME'] = originalHome;
  process.env['PATH'] = originalPath;
  for (const directory of directories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const tempDirectory = (): string => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex-hooks-')));
  directories.push(directory);
  return directory;
};

describe('Codex launch hooks', () => {
  it('describes the Pre and Post tool hooks as launch overrides, never as a file', () => {
    const command = executionHookCommand();

    const overrides = codexHookOverrides(command);

    expect(overrides.map((override) => override.split('=')[0])).toEqual([
      'hooks.PreToolUse',
      'hooks.PostToolUse',
    ]);
    expect(manualCodexHookConfig(command)).toContain('[[hooks.PreToolUse.hooks]]');
  });

  it.skipIf(!codexInstalled)(
    'is registered and trusted by the installed Codex without touching its config file',
    async () => {
      const home = tempDirectory();
      fs.writeFileSync(path.join(home, 'config.toml'), '# my settings\nmodel = "gpt-5"\n');
      process.env['CODEX_HOME'] = home;

      const launch = await confirmCodexHookLaunch(executionHookCommand(), tempDirectory());

      expect(launch.some((override) => override.startsWith('hooks.state='))).toBe(true);
      expect(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')).toBe(
        '# my settings\nmodel = "gpt-5"\n',
      );
      expect(fs.readdirSync(home)).not.toContain('hooks.json');
    },
    60_000,
  );

  it('reports why when Codex cannot be started, so nothing is recorded', async () => {
    process.env['PATH'] = tempDirectory();

    await expect(
      confirmCodexHookLaunch(`${executionHookCommand()} # unreachable`, tempDirectory()),
    ).rejects.toThrow(/ENOENT|codex/u);
  });
});

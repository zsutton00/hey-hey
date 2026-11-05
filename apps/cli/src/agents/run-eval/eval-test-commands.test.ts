import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runEvalTestCommands } from './eval-test-commands';

describe('runEvalTestCommands', () => {
  const base = { directory: process.cwd(), environment: process.env };

  it('runs nothing when the case names no commands', async () => {
    expect(await runEvalTestCommands({ ...base, commands: [] })).toEqual([]);
  });

  it('stops a hanging command at its timeout, records it failed, and still runs the next', async () => {
    const checks = await runEvalTestCommands({
      ...base,
      commands: ['sleep 30', 'echo after'],
      timeoutMs: 200,
    });

    expect(checks.map((check) => check.passed)).toEqual([false, true]);
    expect(checks[0]?.exitCode).toBeNull();
    expect(checks[1]?.output).toContain('after');
  });

  it('caps long output to its tail', async () => {
    const [check] = await runEvalTestCommands({
      ...base,
      commands: ['yes x | head -n 5000; echo END'],
      outputCap: 100,
    });

    expect(check?.truncated).toBe(true);
    expect(check?.output.length).toBe(100);
    expect(check?.output).toContain('END');
  });

  it('cuts the remaining commands short on a stop and records them as not run', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);

    const checks = await runEvalTestCommands({
      ...base,
      commands: ['sleep 30', 'echo never'],
      signal: controller.signal,
    });

    expect(checks.map((check) => check.passed)).toEqual([false, false]);
    expect(checks[0]?.elapsedMs).toBeLessThan(10_000);
    expect(checks[1]?.output).toContain('Not run');
    expect(checks[1]?.output).not.toContain('never\n');
  });

  it('returns promptly when a descendant outside the process group holds the output pipes', async () => {
    // Node's `detached` spawn is a portable setsid; the stray sleep ends on its own.
    const escape = `${process.execPath} -e "require('child_process').spawn('sleep',['15'],{detached:true,stdio:'inherit'}).unref()"`;
    const startedAt = Date.now();

    const [check] = await runEvalTestCommands({
      ...base,
      commands: [`${escape}; sleep 60`],
      timeoutMs: 1000,
    });

    expect(Date.now() - startedAt).toBeLessThan(8000);
    expect(check?.passed).toBe(false);
  });

  it('does not leave a background process running after the check returns', async () => {
    const pidFile = path.join(os.tmpdir(), `heyhey-bg-${process.pid}-${Date.now()}`);
    await runEvalTestCommands({ ...base, commands: [`sleep 30 & echo $! > ${pidFile}`] });
    const pid = Number((await readFile(pidFile, 'utf8')).trim());
    await rm(pidFile);

    const isRunning = (): boolean => {
      try {
        process.kill(pid, 0);

        return true;
      } catch {
        return false;
      }
    };
    for (let attempt = 0; attempt < 20 && isRunning(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    expect(isRunning()).toBe(false);
  });
});

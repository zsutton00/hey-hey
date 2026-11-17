import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyHostedPlatformEnvironment,
  isPlatformEnvironmentFlag,
  selectPlatformEnvironment,
} from './platform-environment-flags';
import { formatTerminalTitle } from './terminal-title';
import { accountNamespace } from '../credentials/keypair';
import { resolveEnvironmentHost, resolveProfileDataDir } from '../session/paths';

const argv = (...flags: string[]) => ['node', 'heyhey', ...flags];

describe('platform environment flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('selects one environment per flag, production without one', () => {
    expect(selectPlatformEnvironment(argv())).toEqual({ ok: true, environment: 'production' });
    expect(selectPlatformEnvironment(argv('--eval', 'pair'))).toEqual({
      ok: true,
      environment: 'eval',
    });
    expect(selectPlatformEnvironment(argv('--staging'))).toEqual({
      ok: true,
      environment: 'staging',
    });
  });

  it.each([
    ['--eval', '--local'],
    ['--staging', '--eval'],
    ['--local', '--staging'],
  ])('rejects %s with %s', (first, second) => {
    const selection = selectPlatformEnvironment(argv(first, second));
    expect(selection.ok).toBe(false);
  });

  it('keeps environment flags out of the command arguments', () => {
    const args = argv('--eval', 'pair', '--profile', 'work').slice(2);
    expect(args.filter((arg) => !isPlatformEnvironmentFlag(arg))).toEqual([
      'pair',
      '--profile',
      'work',
    ]);
  });

  it('points --eval at the eval instance on its own bridge port, with nothing else set', () => {
    const env: NodeJS.ProcessEnv = {};

    const bridgePort = applyHostedPlatformEnvironment('eval', env);

    expect(bridgePort).toBe(3852);
    expect(env).toEqual({
      HEYHEY_API_URL: 'https://evals.heyhey.dev',
      HEYHEY_WEB_ORIGIN: 'https://evals.heyhey.dev',
      HEYHEY_CONTROLLER_ORIGIN: 'https://evals.heyhey.dev',
      HEYHEY_CONTROLLER_RP_ID: 'evals.heyhey.dev',
    });
  });

  it('keeps web and controller values the person already set, but not a stale API URL', () => {
    const env: NodeJS.ProcessEnv = {
      HEYHEY_API_URL: 'http://localhost:3000',
      HEYHEY_WEB_ORIGIN: 'http://localhost:5173',
      HEYHEY_CONTROLLER_ORIGIN: 'http://localhost:5173',
      HEYHEY_CONTROLLER_RP_ID: 'localhost',
    };

    applyHostedPlatformEnvironment('eval', env);

    expect(env).toEqual({
      HEYHEY_API_URL: 'https://evals.heyhey.dev',
      HEYHEY_WEB_ORIGIN: 'http://localhost:5173',
      HEYHEY_CONTROLLER_ORIGIN: 'http://localhost:5173',
      HEYHEY_CONTROLLER_RP_ID: 'localhost',
    });
  });

  it('gives every environment its own bridge port, clear of local Hey Hey', () => {
    const ports = [3847, 3848, 3850, 3851];
    for (const name of ['staging', 'eval'] as const) {
      const port = applyHostedPlatformEnvironment(name, {});
      expect(ports).not.toContain(port);
      ports.push(port);
    }
  });

  it('stores --eval data and credentials apart from production and staging, with profiles beneath', () => {
    vi.stubEnv('HEYHEY_SESSION_DIR', '');
    vi.stubEnv('HEYHEY_PROFILE', '');
    vi.stubEnv('HEYHEY_API_URL', '');
    const productionDir = resolveProfileDataDir();

    const evalEnv: NodeJS.ProcessEnv = {};
    applyHostedPlatformEnvironment('eval', evalEnv);
    vi.stubEnv('HEYHEY_API_URL', evalEnv['HEYHEY_API_URL']);

    expect(resolveEnvironmentHost()).toBe('evals.heyhey.dev');
    expect(resolveProfileDataDir()).toBe(
      path.join(productionDir, 'environments', 'evals.heyhey.dev'),
    );
    expect(accountNamespace()).toBe('evals.heyhey.dev/');

    vi.stubEnv('HEYHEY_PROFILE', 'work');
    expect(resolveProfileDataDir()).toBe(
      path.join(productionDir, 'environments', 'evals.heyhey.dev', 'profiles', 'work'),
    );
    expect(accountNamespace()).toBe('evals.heyhey.dev/work/');
    expect(accountNamespace('https://staging.heyhey.dev')).toBe('staging.heyhey.dev/work/');
  });

  it('names the eval environment in the terminal title', () => {
    expect(formatTerminalTitle('eval', 'work')).toBe('Hey Hey (eval · work)');
  });
});

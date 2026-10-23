import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBaseDir, resolveProfileDataDir } from './paths';

describe('profile data directory', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const prodRoot = (): string => {
    vi.stubEnv('HEYHEY_API_URL', '');
    vi.stubEnv('HEYHEY_PROFILE', '');
    vi.stubEnv('HEYHEY_SESSION_DIR', '');
    return resolveProfileDataDir();
  };

  it('keeps production at the original root, with or without its explicit URL', () => {
    const root = prodRoot();
    vi.stubEnv('HEYHEY_API_URL', 'https://heyhey.dev');
    expect(resolveProfileDataDir()).toBe(root);
    vi.stubEnv('HEYHEY_PROFILE', 'work');
    expect(resolveProfileDataDir()).toBe(path.join(root, 'profiles', 'work'));
  });

  it('gives each non-production server its own folder, ports included', () => {
    const root = prodRoot();
    vi.stubEnv('HEYHEY_API_URL', 'https://staging.heyhey.dev');
    expect(resolveProfileDataDir()).toBe(path.join(root, 'environments', 'staging.heyhey.dev'));
    vi.stubEnv('HEYHEY_API_URL', 'http://localhost:3000');
    const local = resolveProfileDataDir();
    vi.stubEnv('HEYHEY_API_URL', 'http://localhost:3100');
    const migration = resolveProfileDataDir();
    expect(local).toBe(path.join(root, 'environments', 'localhost_3000'));
    expect(migration).toBe(path.join(root, 'environments', 'localhost_3100'));
  });

  it('separates a profile on another environment from the same profile on production', () => {
    const root = prodRoot();
    vi.stubEnv('HEYHEY_PROFILE', 'work');
    vi.stubEnv('HEYHEY_API_URL', 'https://staging.heyhey.dev');
    expect(resolveProfileDataDir()).toBe(
      path.join(root, 'environments', 'staging.heyhey.dev', 'profiles', 'work'),
    );
  });

  it('rejects an unparseable API URL instead of guessing an environment', () => {
    vi.stubEnv('HEYHEY_API_URL', 'not-a-url');
    expect(() => resolveProfileDataDir()).toThrow(/not a valid URL/);
  });

  it('keeps the unprofiled data directory unchanged', () => {
    vi.stubEnv('HEYHEY_API_URL', '');
    vi.stubEnv('HEYHEY_PROFILE', '');
    vi.stubEnv('HEYHEY_SESSION_DIR', '');

    expect(path.basename(resolveProfileDataDir())).toBe('heyhey');
    expect(resolveBaseDir()).toBe(resolveProfileDataDir());
  });

  it('gives each profile its own data directory beneath the shared root', () => {
    vi.stubEnv('HEYHEY_API_URL', '');
    vi.stubEnv('HEYHEY_SESSION_DIR', '');
    vi.stubEnv('HEYHEY_PROFILE', '');
    const root = resolveProfileDataDir();

    vi.stubEnv('HEYHEY_PROFILE', 'work');
    const work = resolveBaseDir();
    vi.stubEnv('HEYHEY_PROFILE', 'personal');
    const personal = resolveBaseDir();

    expect(work).toBe(path.join(root, 'profiles', 'work'));
    expect(personal).toBe(path.join(root, 'profiles', 'personal'));
    expect(work).not.toBe(personal);
  });

  it('rejects profile names that would escape the profile directory', () => {
    for (const profile of ['..', '.', 'a/b', 'a\\b']) {
      vi.stubEnv('HEYHEY_PROFILE', profile);
      expect(() => resolveProfileDataDir()).toThrow(/Invalid profile name/);
    }
  });

  it('honors an explicit session directory override', () => {
    vi.stubEnv('HEYHEY_PROFILE', 'work');
    vi.stubEnv('HEYHEY_SESSION_DIR', '/tmp/heyhey-explicit');

    expect(resolveBaseDir()).toBe('/tmp/heyhey-explicit');
  });
});

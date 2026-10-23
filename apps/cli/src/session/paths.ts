import os from 'node:os';
import path from 'node:path';

const resolvePlatformDataRoot = (): string => {
  if (process.platform === 'win32') {
    return path.join(
      process.env['APPDATA'] ?? path.join(os.homedir(), 'AppData', 'Roaming'),
      'heyhey',
    );
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'heyhey');
  }
  return path.join(os.homedir(), '.config', 'heyhey');
};

/** The active profile name, or null when none is set. */
export const resolveActiveProfile = (): string | null =>
  process.env['HEYHEY_PROFILE']?.trim() || null;

const PROD_API_HOST = new URL('https://heyhey.dev').host;

/**
 * The platform environment this CLI targets: the host of `HEYHEY_API_URL`
 * (which `--local` / `--staging` set), or null for production. Logins and local
 * data are both keyed by this one value so they can never disagree about which
 * environment is active. An unparseable URL throws rather than guessing.
 */
export const resolveEnvironmentHost = (
  apiUrl: string | undefined = process.env['HEYHEY_API_URL'],
): string | null => {
  const raw = apiUrl?.trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(raw).host;
  } catch {
    throw new Error(`HEYHEY_API_URL is not a valid URL: ${JSON.stringify(raw)}`);
  }
  return host === PROD_API_HOST ? null : host;
};

const assertDirectorySegment = (kind: string, segment: string): void => {
  if (segment === '.' || segment === '..' || /[\0/\\]/.test(segment)) {
    throw new Error(`Invalid ${kind} name for a data directory: ${JSON.stringify(segment)}`);
  }
};

/**
 * The local data directory for the active environment and profile. Every
 * persisted store — runs, repo mappings, settings, browser state — resolves
 * beneath it, so work against staging or a local stack never touches
 * production's data, and one profile's runs never restore into another's.
 * Production keeps the original root; other environments live under
 * `environments/<host>/` (port separators made folder-safe), and a profile adds
 * `profiles/<profile>/` beneath that.
 */
export const resolveProfileDataDir = (): string => {
  let dir = resolvePlatformDataRoot();
  const host = resolveEnvironmentHost();
  if (host) {
    const folder = host.replace(/[^A-Za-z0-9.-]/g, '_');
    assertDirectorySegment('environment', folder);
    dir = path.join(dir, 'environments', folder);
  }
  const profile = resolveActiveProfile();
  if (!profile) return dir;
  assertDirectorySegment('profile', profile);
  return path.join(dir, 'profiles', profile);
};

export const resolveBaseDir = (): string => {
  if (process.env['HEYHEY_SESSION_DIR']) {
    return process.env['HEYHEY_SESSION_DIR'];
  }
  return resolveProfileDataDir();
};

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  NATIVE_PERMISSION_MODES,
  type AgentProviderId,
  type ProviderPermissionMode,
} from './provider-config';

const execFileAsync = promisify(execFile);
const VERSION_PROBE_TIMEOUT_MS = 10_000;
const PROVIDER_BINARY: Readonly<Record<AgentProviderId, string>> = {
  claude: 'claude',
  codex: 'codex',
  opencode: 'opencode',
  antigravity: 'agy',
};

export type NativePermissionModeResolution =
  | { mode: ProviderPermissionMode; installedVersion: string }
  | { mode: null; reason: 'provider_has_no_native_mode' }
  | { mode: null; reason: 'installed_version_too_old'; installedVersion: string }
  | { mode: null; reason: 'version_unreadable'; cause: string };

const parseVersion = (text: string): number[] | null => {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);

  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
};

const isAtLeast = (installed: number[], minimum: number[]): boolean => {
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (installed[index] ?? 0) - (minimum[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }

  return true;
};

const readInstalledVersionOutput = async (providerId: AgentProviderId): Promise<string> => {
  const { stdout } = await execFileAsync(PROVIDER_BINARY[providerId], ['--version'], {
    timeout: VERSION_PROBE_TIMEOUT_MS,
  });

  return stdout;
};

/**
 * Decides whether the installed provider supports its native permission mode.
 * An unavailable mode is not a denial: the caller keeps explicit permission
 * handling and logs the reason. Successful reads are cached per provider;
 * failures are retried on the next launch.
 */
export class NativePermissionModeProbe {
  private readonly supported = new Map<AgentProviderId, NativePermissionModeResolution>();

  public constructor(
    private readonly readVersionOutput: (
      providerId: AgentProviderId,
    ) => Promise<string> = readInstalledVersionOutput,
  ) {}

  public async resolve(providerId: AgentProviderId): Promise<NativePermissionModeResolution> {
    const declared = NATIVE_PERMISSION_MODES[providerId];
    if (!declared) {
      return { mode: null, reason: 'provider_has_no_native_mode' };
    }

    const cached = this.supported.get(providerId);
    if (cached) {
      return cached;
    }

    let output: string;
    try {
      output = await this.readVersionOutput(providerId);
    } catch (error) {
      return {
        mode: null,
        reason: 'version_unreadable',
        cause: error instanceof Error ? error.message : String(error),
      };
    }

    const installed = parseVersion(output);
    if (!installed) {
      return { mode: null, reason: 'version_unreadable', cause: `unparseable: ${output.trim()}` };
    }

    const installedVersion = installed.join('.');
    const minimum = parseVersion(declared.minimumVersion) ?? [0, 0, 0];
    if (!isAtLeast(installed, minimum)) {
      return { mode: null, reason: 'installed_version_too_old', installedVersion };
    }

    const resolution = { mode: declared.mode, installedVersion };
    this.supported.set(providerId, resolution);

    return resolution;
  }
}

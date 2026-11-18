import {
  HOSTED_PLATFORM_ENVIRONMENTS,
  type HostedPlatformEnvironmentName,
} from '@hey-hey/contracts/platform-environments';

/** The platform environment this CLI process targets, chosen by at most one flag. */
export type PlatformEnvironment = 'production' | 'local' | HostedPlatformEnvironmentName;

const ENVIRONMENT_FLAGS = {
  '--local': 'local',
  '--staging': 'staging',
  '--eval': 'eval',
} as const satisfies Record<string, Exclude<PlatformEnvironment, 'production'>>;

type EnvironmentFlag = keyof typeof ENVIRONMENT_FLAGS;

const isEnvironmentFlag = (arg: string): arg is EnvironmentFlag => arg in ENVIRONMENT_FLAGS;

export type PlatformEnvironmentSelection =
  | { readonly ok: true; readonly environment: PlatformEnvironment }
  | { readonly ok: false; readonly message: string };

export function selectPlatformEnvironment(argv: readonly string[]): PlatformEnvironmentSelection {
  const flags = [...new Set(argv.filter(isEnvironmentFlag))];
  const [flag] = flags;

  if (flags.length > 1) {
    const names = Object.keys(ENVIRONMENT_FLAGS).join(', ');
    return { ok: false, message: `Use only one of ${names} (got ${flags.join(' and ')})` };
  }
  if (flag === undefined) {
    return { ok: true, environment: 'production' };
  }
  return { ok: true, environment: ENVIRONMENT_FLAGS[flag] };
}

/** Environment flags are consumed here and never reach the command's own arguments. */
export const isPlatformEnvironmentFlag = (arg: string): boolean => isEnvironmentFlag(arg);

/**
 * Point the process at a hosted environment: the API URL is forced, while a web or controller
 * value the person already set is kept. Data folders and credentials follow from the API host, so
 * nothing else needs to know which environment was chosen. Returns the environment's bridge port.
 */
export function applyHostedPlatformEnvironment(
  name: HostedPlatformEnvironmentName,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const { host, bridgePort } = HOSTED_PLATFORM_ENVIRONMENTS[name];
  const origin = `https://${host}`;

  env['HEYHEY_API_URL'] = origin;
  env['HEYHEY_WEB_ORIGIN'] ??= origin;
  env['HEYHEY_CONTROLLER_ORIGIN'] ??= origin;
  env['HEYHEY_CONTROLLER_RP_ID'] ??= host;
  return bridgePort;
}

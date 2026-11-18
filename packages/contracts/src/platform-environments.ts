/**
 * Hosted platform environments the CLI can target by flag, and the loopback
 * port each one's agent bridge listens on. The CLI (`--staging`, `--eval`) and
 * the browser (which bridge to call from a given hostname) both read this one
 * table, so the two sides cannot disagree about a port.
 *
 * Taken ports: production 3847, `--local` 3848, staging 3849, local Hey Hey web
 * 3850, local Hey Hey bridge 3851, eval 3852.
 */
export interface HostedPlatformEnvironment {
  /** Shown in the CLI menu and terminal title. */
  readonly label: string;
  /** API host, web origin host and WebAuthn RP ID. */
  readonly host: string;
  readonly bridgePort: number;
}

export const PRODUCTION_BRIDGE_PORT = 3847;

export const HOSTED_PLATFORM_ENVIRONMENTS = {
  staging: { label: "Staging", host: "staging.heyhey.dev", bridgePort: 3849 },
  eval: { label: "Eval", host: "evals.heyhey.dev", bridgePort: 3852 },
} as const satisfies Record<string, HostedPlatformEnvironment>;

export type HostedPlatformEnvironmentName =
  keyof typeof HOSTED_PLATFORM_ENVIRONMENTS;

export const hostedPlatformEnvironmentForHost = (
  host: string,
): HostedPlatformEnvironment | undefined =>
  Object.values(HOSTED_PLATFORM_ENVIRONMENTS).find(
    (environment) => environment.host === host,
  );

import type { MachineReadinessSnapshot } from '../auth/machine-controller-authority';
import type {
  PairingRequiredScenario,
  PlatformUnavailableScenario,
} from '../views/common-cli-scenario-view';

const FIRST_PAIRING_SCENARIO = {
  kind: 'pairing-required',
  heading: 'Pairing required',
  body: 'This machine is not paired with Hey Hey yet. Pair it to continue.',
  primaryAction: { kind: 'pair-now', label: 'Pair Now' },
} satisfies PairingRequiredScenario;

const REPAIRING_SCENARIO = {
  kind: 'pairing-required',
  heading: 'Pairing required',
  body: 'Hey Hey no longer recognizes this machine. Pair it again to continue.',
  primaryAction: { kind: 'pair-now', label: 'Pair Now' },
} satisfies PairingRequiredScenario;

export type StartupReadinessOutcome =
  | { kind: 'ready'; snapshot: MachineReadinessSnapshot }
  | {
      kind: 'pairing-required';
      snapshot: MachineReadinessSnapshot;
      scenario: PairingRequiredScenario;
    }
  | { kind: 'blocked'; snapshot: MachineReadinessSnapshot; guidance: string };

export const classifyStartupReadiness = (
  snapshot: MachineReadinessSnapshot,
  guidance: string,
): StartupReadinessOutcome => {
  if (snapshot.state === 'ready') return { kind: 'ready', snapshot };
  if (snapshot.state === 'unpaired') {
    return { kind: 'pairing-required', snapshot, scenario: FIRST_PAIRING_SCENARIO };
  }
  if (snapshot.state === 'machine-revoked' || snapshot.state === 'machine-unrecognized') {
    return { kind: 'pairing-required', snapshot, scenario: REPAIRING_SCENARIO };
  }
  return { kind: 'blocked', snapshot, guidance };
};

export class StartupReadinessError extends Error {
  public constructor(public readonly outcome: Exclude<StartupReadinessOutcome, { kind: 'ready' }>) {
    super(
      outcome.kind === 'pairing-required'
        ? 'Execution is blocked until this machine is paired.'
        : `Execution is not ready (${outcome.snapshot.state}). ${outcome.guidance}`,
    );
    this.name = 'StartupReadinessError';
  }
}

const isLocalPlatformUrl = (apiBaseUrl: string): boolean => {
  try {
    const hostname = new URL(apiBaseUrl).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
};

export const platformUnavailableScenario = (apiBaseUrl: string): PlatformUnavailableScenario =>
  isLocalPlatformUrl(apiBaseUrl)
    ? {
        kind: 'platform-unavailable',
        heading: 'Local Hey Hey is unavailable',
        body: 'Start the Hey Hey development server, then run this command again.',
      }
    : {
        kind: 'platform-unavailable',
        heading: 'Hey Hey is unavailable',
        body: 'We could not connect to Hey Hey. Check your internet connection and try again.',
      };

export class PlatformUnavailableStartupError extends Error {
  public readonly scenario: PlatformUnavailableScenario;

  public constructor(apiBaseUrl: string, cause: Error) {
    super('The Hey Hey platform is unavailable.', { cause });
    this.name = 'PlatformUnavailableStartupError';
    this.scenario = platformUnavailableScenario(apiBaseUrl);
  }
}

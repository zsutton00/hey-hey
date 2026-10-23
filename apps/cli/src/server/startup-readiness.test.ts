import { describe, expect, it } from 'vitest';
import type {
  LocalMachineReadinessState,
  MachineReadinessSnapshot,
} from '../auth/machine-controller-authority';
import {
  classifyStartupReadiness,
  platformUnavailableScenario,
  PlatformUnavailableStartupError,
  StartupReadinessError,
} from './startup-readiness';

const readiness = (state: LocalMachineReadinessState): MachineReadinessSnapshot => ({
  state,
  machineId: null,
  machine: null,
  localControllers: [],
  serverControllers: [],
  serverExecutionReadiness: null,
});

describe('classifyStartupReadiness', () => {
  it('preserves a ready snapshot', () => {
    const snapshot = readiness('ready');

    expect(classifyStartupReadiness(snapshot, 'unused')).toEqual({ kind: 'ready', snapshot });
  });

  it.each(['machine-revoked', 'machine-unrecognized'] satisfies LocalMachineReadinessState[])(
    'classifies %s as pairing required',
    (state) => {
      const snapshot = readiness(state);

      expect(classifyStartupReadiness(snapshot, 'pair again')).toEqual({
        kind: 'pairing-required',
        snapshot,
        scenario: {
          kind: 'pairing-required',
          heading: 'Pairing required',
          body: 'Hey Hey no longer recognizes this machine. Pair it again to continue.',
          primaryAction: { kind: 'pair-now', label: 'Pair Now' },
        },
      });
    },
  );

  it('classifies an unpaired machine as pairing required', () => {
    const snapshot = readiness('unpaired');

    expect(classifyStartupReadiness(snapshot, 'pair')).toEqual({
      kind: 'pairing-required',
      snapshot,
      scenario: {
        kind: 'pairing-required',
        heading: 'Pairing required',
        body: 'This machine is not paired with Hey Hey yet. Pair it to continue.',
        primaryAction: { kind: 'pair-now', label: 'Pair Now' },
      },
    });
  });

  it.each([
    'legacy-controller-enrollment-required',
    'enrollment-pending',
    'no-controller',
    'locally-inconsistent',
  ] satisfies LocalMachineReadinessState[])('keeps %s blocked with its exact guidance', (state) => {
    const snapshot = readiness(state);
    const guidance = `guidance for ${state}`;

    expect(classifyStartupReadiness(snapshot, guidance)).toEqual({
      kind: 'blocked',
      snapshot,
      guidance,
    });
  });
});

describe('StartupReadinessError', () => {
  it('retains the typed pairing-required outcome', () => {
    const outcome = classifyStartupReadiness(readiness('machine-revoked'), 'pair again');
    if (outcome.kind === 'ready') throw new Error('Expected startup to be blocked.');

    const error = new StartupReadinessError(outcome);

    expect(error.outcome).toBe(outcome);
    expect(error.message).toBe('Execution is blocked until this machine is paired.');
  });

  it('retains blocked state guidance in the error', () => {
    const outcome = classifyStartupReadiness(readiness('locally-inconsistent'), 'repair state');
    if (outcome.kind === 'ready') throw new Error('Expected startup to be blocked.');

    const error = new StartupReadinessError(outcome);

    expect(error.outcome).toBe(outcome);
    expect(error.message).toBe('Execution is not ready (locally-inconsistent). repair state');
  });
});

describe('platformUnavailableScenario', () => {
  it.each(['http://localhost:3000', 'http://127.0.0.1:3000/api/v1'])(
    'provides development-server guidance for %s',
    (apiBaseUrl) => {
      expect(platformUnavailableScenario(apiBaseUrl)).toEqual({
        kind: 'platform-unavailable',
        heading: 'Local Hey Hey is unavailable',
        body: 'Start the Hey Hey development server, then run this command again.',
      });
    },
  );

  it('provides connectivity guidance for the hosted platform', () => {
    expect(platformUnavailableScenario('https://heyhey.dev/api/v1')).toEqual({
      kind: 'platform-unavailable',
      heading: 'Hey Hey is unavailable',
      body: 'We could not connect to Hey Hey. Check your internet connection and try again.',
    });
  });

  it('retains the diagnostic cause outside the presentation scenario', () => {
    const cause = new Error('connect ECONNREFUSED');

    const error = new PlatformUnavailableStartupError('http://localhost:3000', cause);

    expect(error.cause).toBe(cause);
    expect(error.scenario.kind).toBe('platform-unavailable');
  });
});

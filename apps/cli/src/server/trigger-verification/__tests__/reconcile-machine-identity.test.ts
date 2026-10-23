import { describe, expect, it, vi } from 'vitest';

import { MachineIdentityReconciler, type MachineDirectoryEntry } from '../reconcile-machine-identity';
import type { KeyPairStore } from '../../../credentials/index';
import { createTestKeyPairStore } from '../../../credentials/keypair.test-support';
import type { ServerLogger } from '../../logger';

const noopLogger: ServerLogger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => noopLogger,
};

const machine = (machineId: string, revokedAt?: string | null): MachineDirectoryEntry => ({
  machineId,
  name: machineId,
  pairedAt: '2026-01-01T00:00:00Z',
  active: false,
  ...(revokedAt !== undefined ? { revokedAt } : {}),
});

/**
 * Keychain stub backed by two maps keyed on machineId. A machine is treated as
 * "credentialed" only when it has BOTH a private key and a server signing
 * public key — exactly the reconciler's candidate test.
 */
const buildKeyPairStore = (
  privateKeys: Record<string, string>,
  serverKeys: Record<string, string>,
): { store: KeyPairStore; setCurrentMachineId: ReturnType<typeof vi.fn> } => {
  const store = createTestKeyPairStore();
  vi.spyOn(store, 'loadPrivateKey').mockImplementation(async (id) => privateKeys[id] ?? null);
  vi.spyOn(store, 'loadServerSigningPublicKey').mockImplementation(
    async (id) => serverKeys[id] ?? null,
  );
  const setCurrentMachineId = vi.spyOn(store, 'setCurrentMachineId').mockResolvedValue(undefined);
  return { store, setCurrentMachineId };
};

describe('MachineIdentityReconciler', () => {
  it('persists and returns the unique keychain-backed active machine', async () => {
    const { store, setCurrentMachineId } = buildKeyPairStore(
      { 'machine-new': 'priv-new' },
      { 'machine-new': 'srv-new' },
    );
    const reconciler = new MachineIdentityReconciler({
      machineDirectory: {
        listMachines: async () => [machine('machine-stale'), machine('machine-new')],
      },
      keyPairStore: store,
      logger: noopLogger,
    });

    const outcome = await reconciler.reconcile('machine-stale');

    expect(outcome).toEqual({
      kind: 'reloaded',
      machineId: 'machine-new',
      serverSigningPublicKeyB64: 'srv-new',
    });
    expect(setCurrentMachineId).toHaveBeenCalledExactlyOnceWith('machine-new');
  });

  it('returns needs_repair (no_candidate) when no active machine has both credentials', async () => {
    // machine-new has a private key but no server signing key → not a candidate.
    const { store, setCurrentMachineId } = buildKeyPairStore({ 'machine-new': 'priv-new' }, {});
    const reconciler = new MachineIdentityReconciler({
      machineDirectory: {
        listMachines: async () => [machine('machine-stale'), machine('machine-new')],
      },
      keyPairStore: store,
      logger: noopLogger,
    });

    const outcome = await reconciler.reconcile('machine-stale');

    expect(outcome).toEqual({ kind: 'needs_repair', reason: 'no_candidate', candidateCount: 0 });
    expect(setCurrentMachineId).not.toHaveBeenCalled();
  });

  it('returns needs_repair (multiple_candidates) when more than one machine qualifies', async () => {
    const { store, setCurrentMachineId } = buildKeyPairStore(
      { 'machine-a': 'priv-a', 'machine-b': 'priv-b' },
      { 'machine-a': 'srv-a', 'machine-b': 'srv-b' },
    );
    const reconciler = new MachineIdentityReconciler({
      machineDirectory: {
        listMachines: async () => [
          machine('machine-stale'),
          machine('machine-a'),
          machine('machine-b'),
        ],
      },
      keyPairStore: store,
      logger: noopLogger,
    });

    const outcome = await reconciler.reconcile('machine-stale');

    expect(outcome).toEqual({
      kind: 'needs_repair',
      reason: 'multiple_candidates',
      candidateCount: 2,
    });
    expect(setCurrentMachineId).not.toHaveBeenCalled();
  });

  it('excludes revoked machines from the candidate set', async () => {
    // The only credentialed machine is revoked → no candidate remains.
    const { store } = buildKeyPairStore(
      { 'machine-revoked': 'priv-r' },
      { 'machine-revoked': 'srv-r' },
    );
    const reconciler = new MachineIdentityReconciler({
      machineDirectory: {
        listMachines: async () => [
          machine('machine-stale'),
          machine('machine-revoked', '2026-02-01T00:00:00Z'),
        ],
      },
      keyPairStore: store,
      logger: noopLogger,
    });

    const outcome = await reconciler.reconcile('machine-stale');

    expect(outcome.kind).toBe('needs_repair');
    if (outcome.kind === 'needs_repair') expect(outcome.reason).toBe('no_candidate');
  });

  it('never selects the stale machineId even if it is credentialed', async () => {
    // Both machines are credentialed, but the stale one must be excluded,
    // leaving exactly one candidate.
    const { store, setCurrentMachineId } = buildKeyPairStore(
      { 'machine-stale': 'priv-s', 'machine-new': 'priv-new' },
      { 'machine-stale': 'srv-s', 'machine-new': 'srv-new' },
    );
    const reconciler = new MachineIdentityReconciler({
      machineDirectory: {
        listMachines: async () => [machine('machine-stale'), machine('machine-new')],
      },
      keyPairStore: store,
      logger: noopLogger,
    });

    const outcome = await reconciler.reconcile('machine-stale');

    expect(outcome).toEqual({
      kind: 'reloaded',
      machineId: 'machine-new',
      serverSigningPublicKeyB64: 'srv-new',
    });
    expect(setCurrentMachineId).toHaveBeenCalledExactlyOnceWith('machine-new');
  });
});

/**
 * Machine-identity reconciliation.
 *
 * When the CLI's `current/machine_id` points at a stale pairing, the running
 * verifier loads that machineId's server signing key and rejects every inbound
 * trigger (`machine_id_mismatch`, or `signature_invalid` against the wrong
 * key). This routine recovers without a manual re-pair: it intersects the API's
 * set of non-revoked machines with the credentials the keychain actually holds,
 * and acts only on a unique match.
 *
 * Identity is resolved by intersection, not by key comparison: `MachineDto`
 * from `GET /machines` exposes no public key, so the CLI cannot match "this
 * machine" by the API's signing key. Instead, the right machine is the one the
 * API still considers active AND for which the keychain holds both a private
 * key and a server signing public key (i.e. a completed pairing) AND whose
 * machineId differs from the currently-loaded stale one. On a unique such
 * match, `current/machine_id` is repointed; on zero or more than one, the
 * routine returns `needs_repair` rather than guessing.
 */

import type { ApiRuntime } from '@hey-hey/ui-common/clients';
import type { KeyPairStore } from '../../credentials/index';
import type { ServerLogger } from '../logger';

export interface MachineDirectoryEntry {
  machineId: string;
  name: string;
  pairedAt: string;
  active?: boolean;
  revokedAt?: string | null;
}

export type ReconcileOutcome =
  | {
      kind: 'reloaded';
      machineId: string;
      serverSigningPublicKeyB64: string;
    }
  | {
      kind: 'needs_repair';
      reason: 'no_candidate' | 'multiple_candidates';
      candidateCount: number;
    };

interface MachineDirectory {
  /** Fetch the user's paired machines from the API (`GET /machines`). */
  listMachines(): Promise<MachineDirectoryEntry[]>;
}

/** Generated-client adapter for the machine-directory boundary. */
export class GeneratedMachineDirectory implements MachineDirectory {
  public constructor(private readonly machinesApi: ApiRuntime['clients']['machines']) {}

  public async listMachines(): Promise<MachineDirectoryEntry[]> {
    const response = await this.machinesApi.listMachines();
    return (response.data.data?.machines ?? []).map((machine) => ({
      machineId: machine.machineId,
      name: machine.name,
      pairedAt: machine.pairedAt,
      ...(machine.active !== undefined ? { active: machine.active } : {}),
      ...(machine.revokedAt !== undefined ? { revokedAt: machine.revokedAt } : {}),
    }));
  }
}

export interface MachineIdentityReconcilerDependencies {
  machineDirectory: MachineDirectory;
  keyPairStore: KeyPairStore;
  logger: ServerLogger;
}

export class MachineIdentityReconciler {
  public constructor(private readonly dependencies: MachineIdentityReconcilerDependencies) {}

  /**
   * Reconcile the active machine identity, given the machineId the verifier is
   * currently (and wrongly) bound to. Persists the resolved machineId via
   * `setCurrentMachineId` on a unique match and returns the credentials the
   * verifier should reload with; otherwise returns `needs_repair`.
   */
  public async reconcile(staleMachineId: string): Promise<ReconcileOutcome> {
    const machines = await this.dependencies.machineDirectory.listMachines();
    const active = machines.filter((m) => !m.revokedAt);

    const candidates: Array<{ machineId: string; serverSigningPublicKeyB64: string }> = [];
    for (const machine of active) {
      if (machine.machineId === staleMachineId) continue;
      const [privateKey, serverSigningPublicKeyB64] = await Promise.all([
        this.dependencies.keyPairStore.loadPrivateKey(machine.machineId),
        this.dependencies.keyPairStore.loadServerSigningPublicKey(machine.machineId),
      ]);
      // A completed pairing leaves both the private key and the server signing
      // public key in the keychain; require both before treating this machine
      // as a credentialed candidate.
      if (privateKey && serverSigningPublicKeyB64) {
        candidates.push({ machineId: machine.machineId, serverSigningPublicKeyB64 });
      }
    }

    if (candidates.length !== 1) {
      const reason = candidates.length === 0 ? 'no_candidate' : 'multiple_candidates';
      this.dependencies.logger.warn('trigger-verification.reconcile.needs_repair', {
        reason,
        staleMachineId,
        activeMachineCount: active.length,
        candidateCount: candidates.length,
      });
      return { kind: 'needs_repair', reason, candidateCount: candidates.length };
    }

    const [match] = candidates;
    if (!match) {
      // Unreachable: the length check above guarantees exactly one candidate.
      // Returning needs_repair keeps the exactly-one invariant load-bearing
      // without a non-null assertion.
      return { kind: 'needs_repair', reason: 'no_candidate', candidateCount: 0 };
    }
    await this.dependencies.keyPairStore.setCurrentMachineId(match.machineId);
    this.dependencies.logger.info('trigger-verification.reconcile.reloaded', {
      staleMachineId,
      machineId: match.machineId,
    });
    return {
      kind: 'reloaded',
      machineId: match.machineId,
      serverSigningPublicKeyB64: match.serverSigningPublicKeyB64,
    };
  }
}

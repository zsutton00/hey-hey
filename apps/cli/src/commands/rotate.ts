import { createPublicKey } from 'node:crypto';

import { KeyPairStore } from '../credentials/index';
import { Configuration, MachinesApi } from '../shared/api/index';
import type { RotateMachineKey200Response } from '../shared/api/index';

/**
 * Narrow surface of the generated `MachinesApi` the rotate command uses.
 * Returning a structural `{ data }` shape keeps the contract independent of the
 * axios version behind it — the command only reads `response.data`.
 */
export interface MachinesRotateClient {
  rotateMachineKey(
    machineId: string,
    newPublicKeyPem: string,
  ): Promise<{ data: RotateMachineKey200Response }>;
}

export interface RotateCommandDependencies {
  keyPairStore: KeyPairStore;
  /**
   * Builds the rotate client for a given machine credential. Defered to call
   * time because the credential is the bearer (MachineCredentialAuth), and it
   * is only known after the keychain is read.
   */
  makeMachinesApi: (machineCredential: string) => MachinesRotateClient;
  log: (message: string) => void;
  logError: (message: string) => void;
}

/** Converts the DER-encoded SPKI public key from the keypair store into PEM. */
const encodePublicKeyPem = (publicKey: Buffer): string =>
  createPublicKey({ key: publicKey, format: 'der', type: 'spki' })
    .export({ type: 'spki', format: 'pem' })
    .toString();

const resolveApiBaseUrl = (): string => {
  const raw = process.env['HEYHEY_API_URL']?.trim() || 'https://heyhey.dev';
  return raw.endsWith('/api/v1') ? raw : `${raw.replace(/\/$/u, '')}/api/v1`;
};

/**
 * Builds a {@link MachinesRotateClient} backed by the CLI's own generated
 * `MachinesApi`. The rotate-key endpoint authenticates with the durable machine
 * token presented as a bearer credential — NOT the OAuth user JWT — so the
 * credential is wired straight into the axios `Configuration.accessToken`.
 */
const createDefaultMachinesApi = (machineCredential: string): MachinesRotateClient => {
  const api = new MachinesApi(
    new Configuration({ accessToken: machineCredential, basePath: resolveApiBaseUrl() }),
  );
  return {
    rotateMachineKey: (machineId, newPublicKeyPem) =>
      api.rotateMachineKey({
        machineId,
        rotateMachineKeyRequestDto: { newPublicKey: newPublicKeyPem },
      }),
  };
};

/**
 * Rotates this machine's Ed25519 keypair without a fresh pairing code. The new
 * private key is staged so the old key keeps verifying WebSocket challenges
 * until the server confirms the swap; only on a successful rotate-key response
 * is the staged key committed live. A failed request leaves the old key in
 * place and discards the stage, so a rotation that does not reach the server can
 * never strand the machine without a usable key.
 */
export const runRotateCommand = async (
  dependencies: Partial<RotateCommandDependencies> = {},
): Promise<boolean> => {
  const deps: RotateCommandDependencies = {
    keyPairStore: dependencies.keyPairStore ?? new KeyPairStore(),
    makeMachinesApi: dependencies.makeMachinesApi ?? createDefaultMachinesApi,
    log: dependencies.log ?? console.log,
    logError: dependencies.logError ?? console.error,
  };

  const machineId = await deps.keyPairStore.loadCurrentMachineId();
  if (!machineId) {
    deps.logError('This machine is not paired with Hey Hey. Run `heyhey pair` first.');
    return false;
  }

  const machineCredential = await deps.keyPairStore.loadMachineCredential(machineId);
  if (!machineCredential) {
    deps.logError(
      'This machine has no stored credential to authorize a key rotation. Run `heyhey pair` to re-pair.',
    );
    return false;
  }

  // Finish any rotation a prior run left half-applied before staging a new one,
  // so we never stack two stages on top of an unresolved swap.
  await deps.keyPairStore.resumeKeyRotation(machineId);

  let newPublicKeyPem: string;
  try {
    const { publicKey } = await deps.keyPairStore.stageKeyRotation(machineId);
    newPublicKeyPem = encodePublicKeyPem(publicKey);
  } catch (error) {
    deps.logError(
      `Key rotation failed: could not generate a new machine key. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }

  try {
    await deps.makeMachinesApi(machineCredential).rotateMachineKey(machineId, newPublicKeyPem);
  } catch (error) {
    // The server never accepted the new key, so the old one is still
    // authoritative. Discard the stage and keep the machine usable.
    await deps.keyPairStore.abortKeyRotation(machineId);
    deps.logError(`Key rotation failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }

  try {
    await deps.keyPairStore.commitKeyRotation(machineId);
  } catch (error) {
    deps.logError(
      `Key rotation succeeded on the server but committing the new key locally failed: ${
        error instanceof Error ? error.message : String(error)
      }. Restart Hey Hey to finish the swap.`,
    );
    return false;
  }

  deps.log(`This machine's key has been rotated (machine id: ${machineId}).`);
  return true;
};

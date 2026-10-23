/**
 * Machine-credential challenge signing.
 *
 * The signing inverse of `trigger-verification/verify.ts`: there the CLI
 * verifies the platform's Ed25519 signatures over inbound triggers; here the
 * CLI proves possession of its paired machine credential by signing the
 * platform's random connection challenge with the same Ed25519 keypair
 * generated at pairing.
 */

import crypto from 'node:crypto';

import type { KeyPairStore } from '../credentials';

/**
 * Signs raw challenge bytes with the current machine's stored Ed25519 private
 * key, returning a base64 signature. Resolves null when the CLI is unpaired or
 * no private key is present — callers must treat null as "cannot prove this
 * machine" and never emit a forged or empty response in its place.
 */
export class MachineChallengeSigner {
  public constructor(private readonly keyPairStore: KeyPairStore) {}

  public async sign(challenge: Buffer): Promise<string | null> {
    const machineId = await this.keyPairStore.loadCurrentMachineId();
    if (!machineId) return null;

    const privateKeyPem = await this.keyPairStore.loadPrivateKey(machineId);
    if (!privateKeyPem) return null;

    const privateKey = crypto.createPrivateKey(privateKeyPem);
    // Ed25519 takes a null algorithm — the curve fixes the hash.
    return crypto.sign(null, challenge, privateKey).toString('base64');
  }
}

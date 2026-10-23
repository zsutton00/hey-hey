import crypto from 'node:crypto';

import type { SignedControllerRevocationReductionEnvelope } from '../shared/api/index';
import { canonicalizeJson, type CanonicalJsonValue } from '../shared/canonical-json';

const ED25519_SPKI_DER_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

export type ControllerRevocationReductionResult =
  | { accepted: true }
  | { accepted: false; reason: 'invalid' | 'signature_invalid' | 'stale' | 'address_mismatch' };

const rawEd25519PublicKey = (base64Key: string): crypto.KeyObject | null => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(base64Key) || base64Key.length % 4 === 1) return null;
  const raw = Buffer.from(base64Key, 'base64');
  if (raw.length !== 32 || raw.toString('base64') !== base64Key) return null;
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_DER_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
};

const asCanonicalReduction = (
  envelope: SignedControllerRevocationReductionEnvelope,
): CanonicalJsonValue => ({
  event: {
    action: envelope.event.action,
    controllerCredentialId: envelope.event.controllerCredentialId,
    enrollmentState: envelope.event.enrollmentState,
    executionReadiness: envelope.event.executionReadiness,
    kind: envelope.event.kind,
    machineId: envelope.event.machineId,
    revokedAt: envelope.event.revokedAt,
    version: envelope.event.version,
  },
  controllerCredentialId: envelope.controllerCredentialId,
  machineId: envelope.machineId,
  nonce: envelope.nonce,
  protocolVersion: envelope.protocolVersion,
  timestampMs: envelope.timestampMs,
  userId: envelope.userId,
});

/** Verify the server-authored reduction before mutating any local authority. */
export const verifyControllerRevocationReduction = (
  envelope: SignedControllerRevocationReductionEnvelope,
  options: {
    machineId: string;
    serverSigningPublicKeyB64: string;
    now?: number;
    maxAgeMs?: number;
  },
): ControllerRevocationReductionResult => {
  if (
    envelope.protocolVersion !== 2 ||
    envelope.event.version !== 2 ||
    envelope.event.kind !== 'controller_revocation_reduction' ||
    envelope.event.action !== 'CONTROLLER_REVOKE' ||
    envelope.machineId !== options.machineId ||
    envelope.event.machineId !== envelope.machineId ||
    envelope.event.controllerCredentialId !== envelope.controllerCredentialId ||
    !(
      envelope.event.enrollmentState === 'READY' ||
      envelope.event.enrollmentState === 'CONTROLLER_ENROLLMENT_REQUIRED' ||
      envelope.event.enrollmentState === 'NO_CONTROLLER'
    ) ||
    envelope.nonce.length === 0 ||
    envelope.signature.length === 0
  ) {
    return { accepted: false, reason: 'invalid' };
  }

  const now = options.now ?? Date.now();
  const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
  if (
    !Number.isSafeInteger(envelope.timestampMs) ||
    Math.abs(now - envelope.timestampMs) > maxAgeMs
  ) {
    return { accepted: false, reason: 'stale' };
  }

  const publicKey = rawEd25519PublicKey(options.serverSigningPublicKeyB64);
  if (!publicKey || !/^[A-Za-z0-9+/]+={0,2}$/u.test(envelope.signature)) {
    return { accepted: false, reason: 'signature_invalid' };
  }
  const signature = Buffer.from(envelope.signature, 'base64');
  if (signature.length === 0 || signature.toString('base64') !== envelope.signature) {
    return { accepted: false, reason: 'signature_invalid' };
  }

  let valid = false;
  try {
    valid = crypto.verify(
      null,
      Buffer.from(canonicalizeJson(asCanonicalReduction(envelope)), 'utf8'),
      publicKey,
      signature,
    );
  } catch {
    valid = false;
  }
  return valid ? { accepted: true } : { accepted: false, reason: 'signature_invalid' };
};

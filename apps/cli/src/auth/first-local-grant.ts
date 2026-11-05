import { createHash, createPublicKey } from 'node:crypto';

import type {
  ControllerCredentialPublicKey,
  ControllerDeviceGrantDescriptor,
  FirstLocalGrantIntent,
  MachineEnrollmentPollReadyDto,
} from '../shared/api/index';
import { canonicalizeJson, type CanonicalJsonValue } from '../shared/canonical-json';
import {
  CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS,
  hashControllerDeviceGrantDescriptor,
} from '../server/controller-authorization/controller-assertion-verifier';
import {
  CURRENT_AGENT_OPERATION_CATEGORY,
  hasExactCurrentAgentOperations,
} from '../server/controller-authorization/types';

/**
 * First-time `heyhey local` pairing: the passkey registration that pairs this
 * computer also authorizes its first ordinary controller-device grant. This
 * CLI checks that commitment itself and derives the grant descriptor it signs,
 * so the API cannot widen, retarget or substitute the grant.
 */

const CHALLENGE_DOMAIN = 'heyhey-first-local-grant-v1';
const NONCE_BYTES = 32;

/** Lowercase hex SHA-256 of the key's DER SubjectPublicKeyInfo. */
export const controllerPublicKeySha256 = (publicKey: ControllerCredentialPublicKey): string =>
  createHash('sha256')
    .update(
      createPublicKey({ key: { ...publicKey }, format: 'jwk' }).export({
        type: 'spki',
        format: 'der',
      }),
    )
    .digest('hex');

const asIntentJson = (intent: FirstLocalGrantIntent): CanonicalJsonValue => ({
  version: intent.version,
  enrollmentId: intent.enrollmentId,
  machineId: intent.machineId,
  userId: intent.userId,
  organizationId: intent.organizationId,
  projectId: intent.projectId,
  controllerInstallationId: intent.controllerInstallationId,
  cadence: intent.cadence,
  policyRevision: intent.policyRevision,
  allowedActionTypes: [...intent.allowedActionTypes],
  allowedActionCategories: [...intent.allowedActionCategories],
  target: { kind: intent.target.kind, id: intent.target.id },
  issuedAtMs: intent.issuedAtMs,
  nonce: intent.nonce,
});

/** The registration challenge: the nonce bytes, then the domain-separated intent digest. */
const challengeForIntent = (intent: FirstLocalGrantIntent): string =>
  Buffer.concat([
    Buffer.from(intent.nonce, 'base64url'),
    createHash('sha256')
      .update(CHALLENGE_DOMAIN, 'utf8')
      .update(Buffer.from([0]))
      .update(canonicalizeJson(asIntentJson(intent)), 'utf8')
      .digest(),
  ]).toString('base64url');

const sameMembers = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  new Set(left).size === left.length &&
  left.every((value) => right.includes(value));

/**
 * The grant a locally approved claim may create, or null when it requested
 * none or its intent does not describe exactly this enrollment, machine,
 * account and the current operation bundle under the verified challenge.
 */
export const verifiedFirstLocalGrantIntent = (
  claim: MachineEnrollmentPollReadyDto,
): FirstLocalGrantIntent | null => {
  const intent = claim.firstLocalGrant;
  if (!intent) return null;

  const currentCategories = [...new Set(Object.values(CURRENT_AGENT_OPERATION_CATEGORY))];
  const matches =
    intent.version === 1 &&
    intent.enrollmentId === claim.enrollmentId &&
    intent.machineId === claim.machineId &&
    intent.userId === claim.accountId &&
    intent.organizationId === claim.organizationId &&
    intent.target.kind === 'CLI_READ' &&
    intent.target.id === claim.machineId &&
    CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS.has(intent.cadence) &&
    Number.isSafeInteger(intent.policyRevision) &&
    intent.policyRevision >= 1 &&
    hasExactCurrentAgentOperations([...intent.allowedActionTypes]) &&
    sameMembers([...intent.allowedActionCategories], currentCategories) &&
    Buffer.from(intent.nonce, 'base64url').length === NONCE_BYTES &&
    challengeForIntent(intent) === claim.registrationChallenge;
  return matches ? intent : null;
};

/** The ordinary controller-device descriptor, with its window starting at `issuedAtMs`. */
export const firstLocalGrantDescriptor = (
  intent: FirstLocalGrantIntent,
  controllerCredentialId: string,
  issuedAtMs: number,
): ControllerDeviceGrantDescriptor => {
  const ttlMs = CONTROLLER_AUTHORIZATION_CADENCE_TTL_MS.get(intent.cadence);
  if (ttlMs === undefined) throw new Error('First grant cadence is not supported.');
  return {
    scope: 'controller_device_window',
    controllerCredentialId,
    controllerInstallationId: intent.controllerInstallationId,
    machineId: intent.machineId,
    userId: intent.userId,
    organizationId: intent.organizationId,
    cadence: intent.cadence,
    policyRevision: intent.policyRevision,
    allowedActionTypes: [...intent.allowedActionTypes],
    allowedActionCategories: [...intent.allowedActionCategories],
    issuedAtMs,
    effectiveExpiresAtMs: issuedAtMs + ttlMs,
  };
};

export { hashControllerDeviceGrantDescriptor };

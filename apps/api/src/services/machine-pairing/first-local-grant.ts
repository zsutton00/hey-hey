import * as crypto from 'node:crypto';
import {
  ControllerAuthorizationCadence,
  ControllerDeviceGrantDescriptor,
  FirstLocalGrantIntent,
  RuntimeModelCatalogHostActionPreparation,
} from '../../generated';
import { hashControllerAction } from '../../generated/controller-action-contract';
import { canonicalizeJcs } from '../../core/websockets/trigger-canonicalization';
import { AnyTransactionClient } from '../../prisma/prisma.service';
import { OrganizationId, UserId } from '../../types';
import { findLocalDefaultProjectId } from '../local-default-project.service';
import { toControllerAuthorizationCadence } from '../controller-authorization/controller-authorization-operations';
import {
  buildControllerDeviceGrantDescriptor,
  hashControllerDeviceGrantDescriptor,
} from '../controller-authorization/controller-authorization.service';
import {
  CONTROLLER_DEVICE_POLICY_REVISION,
  CURRENT_AGENT_OPERATION_CATEGORIES,
  CURRENT_AGENT_OPERATIONS,
} from '../controller-authorization/controller-authorization-operations';

/**
 * First-time `heyhey local` pairing: one passkey registration both enrolls the
 * controller and authorizes the first ordinary controller-device grant. The
 * registration challenge commits to this intent before the credential exists;
 * the CLI later derives the same descriptor and signs its hash.
 */

export const FIRST_LOCAL_GRANT_CHALLENGE_DOMAIN = 'heyhey-first-local-grant-v1';
const NONCE_BYTES = 32;

/**
 * Marks the authorization behind a first local grant: it was approved by the
 * pairing passkey registration and the CLI's local approval proof, not by a
 * WebAuthn assertion, so it carries no assertion evidence.
 */
export const FIRST_LOCAL_GRANT_OUTCOME_REASON =
  'first_local_pairing_registration';

/** The CLI and API clocks may differ slightly; the window is otherwise exact. */
export const FIRST_LOCAL_GRANT_ACTIVATION_SKEW_MS = 60_000;

export function buildFirstLocalGrantIntent(params: {
  enrollmentId: string;
  machineId: string;
  userId: string;
  organizationId: string;
  projectId: string;
  controllerInstallationId: string;
  cadence: ControllerAuthorizationCadence;
  issuedAt: Date;
  nonce: string;
}): FirstLocalGrantIntent {
  return {
    version: 1,
    enrollmentId: params.enrollmentId,
    machineId: params.machineId,
    userId: params.userId as UserId,
    organizationId: params.organizationId as OrganizationId,
    projectId: params.projectId,
    controllerInstallationId: params.controllerInstallationId,
    cadence: params.cadence,
    policyRevision: CONTROLLER_DEVICE_POLICY_REVISION,
    allowedActionTypes: [...CURRENT_AGENT_OPERATIONS],
    allowedActionCategories: [...CURRENT_AGENT_OPERATION_CATEGORIES],
    target: { kind: 'CLI_READ', id: params.machineId },
    issuedAtMs: params.issuedAt.getTime(),
    nonce: params.nonce,
  } satisfies FirstLocalGrantIntent;
}

export function newFirstLocalGrantNonce(): string {
  return crypto.randomBytes(NONCE_BYTES).toString('base64url');
}

/** SHA-256 over the domain-separated canonical intent. */
export function firstLocalGrantIntentDigest(
  intent: FirstLocalGrantIntent,
): Buffer {
  return crypto
    .createHash('sha256')
    .update(FIRST_LOCAL_GRANT_CHALLENGE_DOMAIN, 'utf8')
    .update(Buffer.from([0]))
    .update(canonicalizeJcs(intent), 'utf8')
    .digest();
}

/** The registration challenge: the nonce bytes, then the intent digest. */
export function firstLocalGrantChallenge(
  intent: FirstLocalGrantIntent,
): string {
  return Buffer.concat([
    Buffer.from(intent.nonce, 'base64url'),
    firstLocalGrantIntentDigest(intent),
  ]).toString('base64url');
}

/** Recovers the nonce a first-local challenge carries, or null for any other challenge. */
export function firstLocalGrantNonce(challenge: string): string | null {
  const bytes = Buffer.from(challenge, 'base64url');
  if (
    bytes.length !== NONCE_BYTES * 2 ||
    bytes.toString('base64url') !== challenge
  ) {
    return null;
  }
  return bytes.subarray(0, NONCE_BYTES).toString('base64url');
}

/** The exact machine-addressed CLI read that is the grant's initial context. */
export function firstLocalGrantAction(
  intent: FirstLocalGrantIntent,
  requestId: string,
): RuntimeModelCatalogHostActionPreparation {
  return {
    requestId,
    actionCategory: 'CLI_READ',
    actionType: 'CLI_READ',
    targetKind: 'CLI_READ',
    targetId: intent.target.id,
  } satisfies RuntimeModelCatalogHostActionPreparation;
}

/** The ordinary controller-device descriptor this intent authorizes. */
export function firstLocalGrantDescriptor(
  intent: FirstLocalGrantIntent,
  controllerCredentialId: string,
  issuedAt: Date,
  action: RuntimeModelCatalogHostActionPreparation,
): ControllerDeviceGrantDescriptor {
  return buildControllerDeviceGrantDescriptor({
    controllerCredentialId,
    controllerInstallationId: intent.controllerInstallationId,
    machineId: intent.machineId,
    userId: intent.userId,
    organizationId: intent.organizationId,
    projectId: intent.projectId,
    action,
    actionPayloadHash: hashControllerAction(action),
    target: {
      kind: 'CLI_READ',
      id: intent.target.id,
      revision: null,
      agentSessionId: null,
      taskMonitorId: null,
    },
    allowedActions: [...CURRENT_AGENT_OPERATIONS],
    cadence: intent.cadence,
    policyRevision: intent.policyRevision,
    issuedAt,
  });
}

export { hashControllerDeviceGrantDescriptor };

/**
 * Rebuilds the intent a claim's stored challenge committed to. Returns null
 * when no first grant was requested, or when the stored state no longer
 * reproduces the challenge (for example, the default project changed), so no
 * grant can be issued for it.
 */
export async function resolveFirstLocalGrantIntent(
  db: Pick<AnyTransactionClient, 'project'>,
  enrollment: {
    id: string;
    machineId: string;
    claimantUserId: string | null;
    claimantOrganizationId: string | null;
    controllerInstallationId: string | null;
    webauthnChallenge: string | null;
    challengeIssuedAt: Date | null;
    requestedCadence:
      | Parameters<typeof toControllerAuthorizationCadence>[0]
      | null;
  },
): Promise<FirstLocalGrantIntent | null> {
  const cadence =
    enrollment.requestedCadence === null
      ? null
      : toControllerAuthorizationCadence(enrollment.requestedCadence);
  const nonce = enrollment.webauthnChallenge
    ? firstLocalGrantNonce(enrollment.webauthnChallenge)
    : null;
  if (
    !cadence ||
    !nonce ||
    !enrollment.claimantUserId ||
    !enrollment.claimantOrganizationId ||
    !enrollment.controllerInstallationId ||
    !enrollment.challengeIssuedAt
  ) {
    return null;
  }

  const projectId = await findLocalDefaultProjectId(
    db,
    enrollment.claimantOrganizationId,
  );
  if (!projectId) {
    return null;
  }

  const intent = buildFirstLocalGrantIntent({
    enrollmentId: enrollment.id,
    machineId: enrollment.machineId,
    userId: enrollment.claimantUserId,
    organizationId: enrollment.claimantOrganizationId,
    projectId,
    controllerInstallationId: enrollment.controllerInstallationId,
    cadence,
    issuedAt: enrollment.challengeIssuedAt,
    nonce,
  });
  return firstLocalGrantChallenge(intent) === enrollment.webauthnChallenge
    ? intent
    : null;
}
